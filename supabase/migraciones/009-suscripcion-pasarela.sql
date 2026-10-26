-- La suscripcion deja de ser de Whop.
--
-- POR QUE AHORA Y NO CUANDO HAGA FALTA
--   Las dos tablas de suscripcion llevan la pasarela en el NOMBRE de sus
--   columnas: whop_membership_id, whop_payment_id. Eso no es cosmetico. Lo que
--   impide contar dos veces una renovacion son dos indices unicos sobre
--   whop_payment_id (migracion 007, escrita despues de medir 4 pagos y USD 76
--   donde hubo 3 y USD 57). Un cobro de Mercado Pago no entra en esa columna,
--   asi que entraria SIN esa proteccion -- y Mercado Pago reintenta.
--   Hoy hay CERO filas en subscriptions. Renombrar es gratis. El dia que haya
--   suscriptores vivos, la misma migracion se hace con plata adentro.
--
-- QUE SE RENOMBRA Y QUE NO
--   Se renombra lo de las DOS tablas de suscripcion, y nada mas.
--   NO se toca products.whop_plan_id ni funnels.whop_plan_id: esos los comparte
--   el camino del upsell, los leen ocho scripts, y Mercado Pago no necesita un
--   plan -- su suscripcion se crea con el monto y la frecuencia adentro
--   (preapproval sin plan asociado), asi que no hay id de plan que guardar.
--   NO se toca orders.whop_member_id ni orders.whop_payment_method_id: son del
--   cobro sobre tarjeta guardada, que sigue bloqueado por la autorizacion
--   comercial de Mercado Pago.
--
-- COMO SE LLAMAN AHORA
--   external_id        la identidad de la suscripcion en la pasarela
--                      (membresia en Whop, preapproval en Mercado Pago)
--   external_plan_id   el plan, cuando la pasarela tiene planes
--   external_customer_id / external_payment_method_id
--   external_payment_id  el pago, en la bitacora
--   provider           quien cobra. Sin esto, dos pasarelas con el mismo id
--                      numerico se pisarian en los indices unicos.

-- ------------------------------------------------------- 0 · la vista, afuera

-- SE DROPEA ANTES DE RENOMBRAR, y no alcanza con recrearla despues.
--   `create or replace view` NO puede cambiarle el nombre a una columna:
--   «cannot change name of view column whop_membership_id to external_id»
--   (42P16, medido contra la base el 26/10/2026 -- la migracion entera
--   rollbackeo, asi que no quedo a medias).
--   La vista se creo con `select s.*`, que resuelve la lista de columnas en el
--   momento de crearse: renombrar la columna de la tabla NO renombra la de la
--   vista, y la vista se queda exponiendo el nombre viejo.
--   Nada depende de ella: comprobado en pg_depend antes de dropear.
drop view if exists public.subscriptions_activas;

-- ------------------------------------------------------- 1 · las suscripciones

alter table public.subscriptions
  add column if not exists provider text not null default 'whop';

alter table public.subscriptions
  drop constraint if exists subscriptions_provider_check;
alter table public.subscriptions
  add constraint subscriptions_provider_check
  check (provider in ('whop','stripe','mercadopago'));

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='subscriptions'
                and column_name='whop_membership_id') then
    alter table public.subscriptions rename column whop_membership_id to external_id;
    alter table public.subscriptions rename column whop_plan_id to external_plan_id;
    alter table public.subscriptions rename column whop_member_id to external_customer_id;
    alter table public.subscriptions rename column whop_payment_method_id to external_payment_method_id;
  end if;
end $$;

comment on column public.subscriptions.provider is
  'Quien cobra esta suscripcion. Es dato del HECHO, no de la tienda: una tienda puede cambiar de pasarela y las suscripciones viejas las sigue cobrando la vieja.';
comment on column public.subscriptions.external_id is
  'La identidad de la suscripcion en su pasarela: membership en Whop, preapproval en Mercado Pago. Unica por pasarela, no en absoluto.';

-- El id externo no puede repetirse DENTRO de una pasarela. Antes el indice era
-- global sobre whop_membership_id, que alcanzaba con una sola pasarela; con dos
-- deja de alcanzar, porque los ids de Mercado Pago son numericos y nada
-- garantiza que no choquen con los de otra.
drop index if exists public.subscriptions_membership_uniq;
create unique index if not exists subscriptions_externo_uniq
  on public.subscriptions(provider, external_id) where external_id is not null;
create index if not exists subscriptions_provider_idx
  on public.subscriptions(store_id, provider);

-- ---------------------------------------------------------- 2 · la bitacora

alter table public.subscription_events
  add column if not exists provider text not null default 'whop';

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='subscription_events'
                and column_name='whop_payment_id') then
    alter table public.subscription_events rename column whop_payment_id to external_payment_id;
    alter table public.subscription_events rename column whop_membership_id to external_id;
  end if;
end $$;

-- LA IDEMPOTENCIA, con la pasarela adentro de la clave.
-- Siguen siendo DOS indices y no uno, por la razon de la migracion 007: un pago
-- rechazado que al reintento se cobra deja dos hechos distintos del mismo id
-- -- un fallo y un cobro -- y los dos tienen que poder convivir. Con un indice
-- solo, el cobro bueno se descartaria por choque con el fallo anterior.
drop index if exists public.subscription_events_cobro_uniq;
drop index if exists public.subscription_events_fallo_uniq;

create unique index if not exists subscription_events_cobro_uniq
  on public.subscription_events(provider, external_payment_id)
  where external_payment_id is not null and kind in ('created','renewed');

create unique index if not exists subscription_events_fallo_uniq
  on public.subscription_events(provider, external_payment_id)
  where external_payment_id is not null and kind = 'payment_failed';

comment on table public.subscription_events is
  'Bitacora de la suscripcion. Los indices unicos sobre (provider, external_payment_id) son lo que hace que un webhook repetido no cuente dos veces el mismo cobro.';

-- --------------------------------------------------------- 3 · la vista

-- Recreada ya con los nombres nuevos. Ver la seccion 0 por que hubo que
-- dropearla en vez de reemplazarla.
create view public.subscriptions_activas as
  select s.*
    from public.subscriptions s
   where s.status in ('active','past_due')
      or (s.status = 'canceled' and s.current_period_end is not null
          and s.current_period_end > now());
comment on view public.subscriptions_activas is
  'Los que HOY tienen derecho a la edicion paga. Unica definicion de acceso.';

-- ------------------------------------------------------------ 4 · el cobro

-- Se DROPEA antes de crear, no se usa `create or replace`: la firma cambia al
-- sumar p_provider, y en Postgres eso crea una SEGUNDA funcion en vez de
-- reemplazar la primera. Con las dos vivas, PostgREST tiene que elegir entre
-- dos sobrecargas y falla por ambiguedad.
drop function if exists public.sub_cobro(uuid,uuid,text,text,numeric,text,text,text,text,text,text,text,text,int,timestamptz,boolean);

create function public.sub_cobro(
  p_store uuid, p_product uuid, p_email text,
  p_payment text, p_amount numeric, p_currency text,
  p_name text default null, p_locale text default null, p_country text default null,
  p_membership text default null, p_plan text default null,
  p_member text default null, p_pm text default null,
  p_period_days int default null, p_period_end timestamptz default null,
  p_founder boolean default false,
  p_provider text default 'whop'
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  mail text := lower(trim(p_email));
  via text := coalesce(nullif(trim(p_provider),''), 'whop');
  s public.subscriptions;
  nueva boolean := false;
  venia text;
  via_vieja text;
  dias int;
  n int;
begin
  if mail is null or mail = '' then
    raise exception 'sub_cobro: sin email';
  end if;

  select * into s from public.subscriptions
   where store_id = p_store and product_id = p_product and email = mail;

  if not found then
    insert into public.subscriptions (
      store_id, product_id, email, name, locale, country, status, founder, provider,
      external_id, external_plan_id, external_customer_id, external_payment_method_id,
      currency, amount, billing_period_days)
    values (p_store, p_product, mail, p_name, p_locale, nullif(upper(p_country),''), 'active',
      coalesce(p_founder,false), via,
      p_membership, p_plan, p_member, p_pm,
      lower(coalesce(p_currency,'usd')), p_amount, p_period_days)
    returning * into s;
    nueva := true;
  end if;
  venia := s.status;
  via_vieja := s.provider;

  -- LA PUERTA. Si este pago ya se anoto, no se vuelve a contar. Todo lo que
  -- sigue -- contadores, estado, periodo -- queda del lado de adentro.
  insert into public.subscription_events (
    subscription_id, store_id, email, kind, amount, currency, provider,
    external_payment_id, external_id, detail)
  values (s.id, p_store, mail, case when nueva then 'created' else 'renewed' end,
    p_amount, lower(coalesce(p_currency,'usd')), via,
    p_payment, coalesce(p_membership, s.external_id),
    case when nueva then 'alta' else 'renovacion' end)
  on conflict do nothing;
  get diagnostics n = row_count;

  if n = 0 then
    -- Webhook repetido. Se contesta que ya estaba, no se toca nada.
    return jsonb_build_object('repetido', true, 'id', s.id, 'status', s.status,
                              'pagos', s.payments_count, 'creada', false);
  end if;

  dias := coalesce(p_period_days, s.billing_period_days, 30);

  update public.subscriptions set
    status = 'active',
    provider = via,
    payments_count = payments_count + 1,
    paid_total = paid_total + coalesce(p_amount, 0),
    last_payment_at = now(),
    -- Un cobro bueno limpia la mora: los fallos que cuentan son los seguidos.
    failed_count = 0, last_failure_at = null, last_failure_reason = null, dunning_sent_at = null,
    current_period_end = coalesce(p_period_end, now() + make_interval(days => dias)),
    billing_period_days = coalesce(p_period_days, billing_period_days, dias),
    amount = coalesce(p_amount, amount),
    -- Los ids de la pasarela solo se completan, nunca se borran con un nulo.
    external_id = coalesce(p_membership, external_id),
    external_plan_id = coalesce(p_plan, external_plan_id),
    external_customer_id = coalesce(p_member, external_customer_id),
    external_payment_method_id = coalesce(p_pm, external_payment_method_id),
    name = coalesce(name, p_name), locale = coalesce(locale, p_locale),
    country = coalesce(country, nullif(upper(p_country),'')),
    ended_at = null, canceled_at = case when status = 'canceled' then null else canceled_at end,
    updated_at = now()
   where id = s.id
   returning * into s;

  -- UNA SUSCRIPCION QUE CAMBIO DE PASARELA.
  --   La clave unica es (tienda, producto, mail), sin pasarela: alguien que ya
  --   estaba suscripto por Whop y se suscribe de nuevo por Mercado Pago NO
  --   crea una fila nueva, actualiza la que habia. El cobro se cuenta igual
  --   -- pago, le corresponde -- pero el external_id de Whop se perdio de
  --   vista, y si aquella membresia sigue viva lo estan cobrando DOS VECES.
  --   No se puede resolver aca: cancelar en la pasarela vieja es una llamada
  --   HTTP y esto es una transaccion. Se deja anotado y se avisa a quien llamo.
  if not nueva and via_vieja is distinct from via then
    insert into public.subscription_events (subscription_id, store_id, email, kind, provider, detail)
    values (s.id, p_store, mail, 'desconocido', via,
      'cambio de pasarela: ' || via_vieja || ' -> ' || via ||
      '. Revisar que la suscripcion vieja no siga cobrando.');
  end if;

  -- Se recupero de una mora o volvio de una baja: queda anotado aparte, porque
  -- es lo que se mira para saber si el aviso de tarjeta rechazada sirve.
  if venia = 'past_due' then
    insert into public.subscription_events (subscription_id, store_id, email, kind, provider, detail)
    values (s.id, p_store, mail, 'recovered', via, 'cobro al dia despues de una tarjeta rechazada');
  elsif venia in ('canceled','expired') then
    insert into public.subscription_events (subscription_id, store_id, email, kind, provider, detail)
    values (s.id, p_store, mail, 'reactivated', via, 'volvio desde ' || venia);
  end if;

  return jsonb_build_object('repetido', false, 'creada', nueva, 'id', s.id,
    'status', s.status, 'pagos', s.payments_count, 'total', s.paid_total,
    'founder', s.founder, 'hasta', s.current_period_end,
    'cambio_pasarela', (not nueva and via_vieja is distinct from via));
end;
$$;
comment on function public.sub_cobro is
  'Alta o renovacion de una suscripcion. Idempotente por (provider, external_payment_id): el reintento de un webhook no cuenta dos veces.';

-- ------------------------------------------------------------ 5 · el fallo

drop function if exists public.sub_fallo(uuid,text,text,uuid,text,text);

create function public.sub_fallo(
  p_store uuid, p_email text, p_payment text,
  p_product uuid default null, p_membership text default null, p_motivo text default null,
  p_provider text default 'whop'
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  mail text := lower(trim(p_email));
  via text := coalesce(nullif(trim(p_provider),''), 'whop');
  s public.subscriptions;
  n int;
begin
  -- El id externo se busca CON la pasarela: un preapproval de Mercado Pago y
  -- una membresia de Whop pueden escribirse igual y no son lo mismo.
  select * into s from public.subscriptions
   where store_id = p_store
     and (  (p_membership is not null and provider = via and external_id = p_membership)
         or (mail <> '' and email = mail and (p_product is null or product_id = p_product)))
   order by (p_membership is not null and provider = via and external_id = p_membership) desc
   limit 1;
  if not found then
    return jsonb_build_object('sin_suscripcion', true);
  end if;

  insert into public.subscription_events (
    subscription_id, store_id, email, kind, provider, external_payment_id, external_id, detail)
  values (s.id, p_store, s.email, 'payment_failed', via, p_payment, s.external_id,
          left(coalesce(p_motivo,''), 400))
  on conflict do nothing;
  get diagnostics n = row_count;
  if n = 0 then
    return jsonb_build_object('repetido', true, 'id', s.id, 'fallos', s.failed_count);
  end if;

  update public.subscriptions set
    failed_count = failed_count + 1,
    last_failure_at = now(),
    last_failure_reason = left(coalesce(p_motivo,''), 400),
    -- Una baja ya pedida no se convierte en mora: ya no se le cobra mas.
    status = case when status = 'active' then 'past_due' else status end,
    updated_at = now()
   where id = s.id
   returning * into s;

  if s.failed_count = 1 and s.status = 'past_due' then
    insert into public.subscription_events (subscription_id, store_id, email, kind, provider, detail)
    values (s.id, p_store, s.email, 'past_due', via, 'primer rechazo: conserva el acceso');
  end if;

  return jsonb_build_object('repetido', false, 'id', s.id, 'email', s.email,
    'fallos', s.failed_count, 'status', s.status, 'avisado', s.dunning_sent_at is not null);
end;
$$;
comment on function public.sub_fallo is
  'Tarjeta rechazada: cuenta el fallo y pasa a past_due SIN cortar el acceso. Idempotente por (provider, external_payment_id).';

-- --------------------------------------------------------- 6 · la baja

-- sub_baja no cambia de firma -- trabaja sobre el id de NUESTRA tabla y no
-- toca ningun campo de pasarela -- pero escribe en la bitacora, que ahora
-- tiene provider not null. Se recrea para que el evento herede la pasarela de
-- la suscripcion en vez del default 'whop'.
create or replace function public.sub_baja(
  p_id uuid, p_motivo text default null, p_ya boolean default false
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare s public.subscriptions;
begin
  update public.subscriptions set
    -- Por defecto la baja respeta el periodo pagado: `canceled` sigue teniendo
    -- acceso hasta current_period_end. `p_ya` corta en el acto y es solo para
    -- un reembolso.
    status = case when p_ya then 'expired' else 'canceled' end,
    canceled_at = coalesce(canceled_at, now()),
    ended_at = case when p_ya then now() else ended_at end,
    updated_at = now()
   where id = p_id and status <> 'expired'
   returning * into s;
  if not found then return jsonb_build_object('sin_cambio', true); end if;

  insert into public.subscription_events (subscription_id, store_id, email, kind, provider, detail)
  values (s.id, s.store_id, s.email, case when p_ya then 'expired' else 'canceled' end,
          s.provider, left(coalesce(p_motivo, 'baja pedida por el suscriptor'), 400));

  return jsonb_build_object('id', s.id, 'status', s.status, 'hasta', s.current_period_end,
                            'provider', s.provider);
end;
$$;
comment on function public.sub_baja is
  'Baja. Por defecto conserva el acceso hasta terminar el periodo pagado; p_ya corta en el acto (reembolso). Devuelve la pasarela, que es lo que decide donde hay que cancelar de verdad.';

-- ------------------------------------------------------- 7 · el barrido

-- sub_vencer tampoco cambia de firma, pero insertaba en la bitacora sin
-- provider: con la columna nueva not null default 'whop', cada corte de una
-- suscripcion de Mercado Pago quedaria anotado como si fuera de Whop. El
-- `returning` ahora arrastra la pasarela de la fila que se esta venciendo.
create or replace function public.sub_vencer(p_gracia_dias integer default 14)
returns table(vencidas integer, cortadas integer)
language plpgsql security definer set search_path to 'public' as $$
declare v int; c int;
begin
  -- Baja cumplida: pago hasta aca y aca termina.
  with x as (
    update public.subscriptions set status = 'expired', ended_at = now(), updated_at = now()
     where status = 'canceled' and current_period_end is not null and current_period_end <= now()
     returning id, store_id, email, provider)
  insert into public.subscription_events (subscription_id, store_id, email, kind, provider, detail)
  select id, store_id, email, 'expired', provider, 'termino el periodo pagado' from x;
  get diagnostics v = row_count;

  -- Moroso sin recuperacion: se le corta despues de la gracia.
  with y as (
    update public.subscriptions set status = 'expired', ended_at = now(), updated_at = now()
     where status = 'past_due' and last_failure_at is not null
       and last_failure_at <= now() - make_interval(days => p_gracia_dias)
     returning id, store_id, email, failed_count, provider)
  insert into public.subscription_events (subscription_id, store_id, email, kind, provider, detail)
  select id, store_id, email, 'access_revoked', provider,
         'sin cobrar tras ' || p_gracia_dias || ' dias de gracia (' || failed_count || ' intentos)' from y;
  get diagnostics c = row_count;

  return query select coalesce(v,0), coalesce(c,0);
end;
$$;
comment on function public.sub_vencer is
  'Barrido diario: vence las bajas cumplidas y corta a los morosos pasada la gracia. Cada evento queda con la pasarela de su suscripcion.';

-- ------------------------------------------- 8 · la vista respeta el RLS

-- APARECIO AL RECREAR LA VISTA, y no lo introdujo esta migracion: la vista
-- original tampoco lo tenia.
--   Una vista sin `security_invoker` corre con los permisos de su DUENO
--   (postgres) y se saltea el row level security de la tabla de abajo.
--   Medido con un suscriptor de prueba adentro: como `anon`,
--   `subscriptions` devolvia 0 filas -- el RLS andaba -- y
--   `subscriptions_activas` devolvia 1, con mail, nombre, pais e importe.
--
-- Hoy no es explotable por nada que la app publique: la clave anon no esta en
-- su entorno ni en su codigo de cliente. Pero es una clave publicable por
-- diseno, asi que la fuga empieza el dia que alguna pagina la use.
--
-- La app no se ve afectada: entra con la service_role, que tiene BYPASSRLS.
-- Comprobado despues de aplicarlo: anon 0 filas, service_role 1.
alter view public.subscriptions_activas set (security_invoker = on);
