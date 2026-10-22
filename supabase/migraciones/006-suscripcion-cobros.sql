-- El cobro de una suscripcion, en UNA transaccion.
--
-- POR QUE EN SQL Y NO EN TYPESCRIPT
--   Registrar un cobro son tres escrituras: la bitacora, el contador de pagos y
--   el estado. Hechas desde la app son tres viajes, y si el segundo falla queda
--   un cobro anotado que no sumo -- o peor: la bitacora ya tiene la clave unica
--   del pago, asi que el reintento de Whop la ve repetida y NO corrige. El
--   contador quedaria mal para siempre, y ese contador es el MRR que se mira
--   para decidir si la suscripcion funciona.
--   Adentro de una funcion las tres son atomicas: o las tres, o ninguna.

-- Los mails de la suscripcion necesitan su propio tipo en la bitacora de
-- correo: el aviso de tarjeta rechazada no es una entrega ni un upsell.
alter table public.email_log drop constraint if exists email_log_kind_check;
alter table public.email_log add constraint email_log_kind_check
  check (kind in ('delivery','upsell','recovery','test','reply','access','subscription'));

-- ------------------------------------------------------------------ el cobro
create or replace function public.sub_cobro(
  p_store uuid, p_product uuid, p_email text,
  p_payment text, p_amount numeric, p_currency text,
  p_name text default null, p_locale text default null, p_country text default null,
  p_membership text default null, p_plan text default null,
  p_member text default null, p_pm text default null,
  p_period_days int default null, p_period_end timestamptz default null,
  p_founder boolean default false
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  mail text := lower(trim(p_email));
  s public.subscriptions;
  nueva boolean := false;
  venia text;
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
      store_id, product_id, email, name, locale, country, status, founder,
      whop_membership_id, whop_plan_id, whop_member_id, whop_payment_method_id,
      currency, amount, billing_period_days)
    values (p_store, p_product, mail, p_name, p_locale, nullif(upper(p_country),''), 'active', coalesce(p_founder,false),
      p_membership, p_plan, p_member, p_pm,
      lower(coalesce(p_currency,'usd')), p_amount, p_period_days)
    returning * into s;
    nueva := true;
  end if;
  venia := s.status;

  -- LA PUERTA. Si este pago ya se anoto, no se vuelve a contar. Todo lo que
  -- sigue -- contadores, estado, periodo -- queda del lado de adentro.
  insert into public.subscription_events (
    subscription_id, store_id, email, kind, amount, currency, whop_payment_id, whop_membership_id, detail)
  values (s.id, p_store, mail, case when nueva then 'created' else 'renewed' end,
    p_amount, lower(coalesce(p_currency,'usd')), p_payment, coalesce(p_membership, s.whop_membership_id),
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
    payments_count = payments_count + 1,
    paid_total = paid_total + coalesce(p_amount, 0),
    last_payment_at = now(),
    -- Un cobro bueno limpia la mora: los fallos que cuentan son los seguidos.
    failed_count = 0, last_failure_at = null, last_failure_reason = null, dunning_sent_at = null,
    current_period_end = coalesce(p_period_end, now() + make_interval(days => dias)),
    billing_period_days = coalesce(p_period_days, billing_period_days, dias),
    amount = coalesce(p_amount, amount),
    -- Los ids de Whop solo se completan, nunca se borran con un nulo.
    whop_membership_id = coalesce(p_membership, whop_membership_id),
    whop_plan_id = coalesce(p_plan, whop_plan_id),
    whop_member_id = coalesce(p_member, whop_member_id),
    whop_payment_method_id = coalesce(p_pm, whop_payment_method_id),
    name = coalesce(name, p_name), locale = coalesce(locale, p_locale),
    country = coalesce(country, nullif(upper(p_country),'')),
    ended_at = null, canceled_at = case when status = 'canceled' then null else canceled_at end,
    updated_at = now()
   where id = s.id
   returning * into s;

  -- Se recupero de una mora o volvio de una baja: queda anotado aparte, porque
  -- es lo que se mira para saber si el aviso de tarjeta rechazada sirve.
  if venia = 'past_due' then
    insert into public.subscription_events (subscription_id, store_id, email, kind, detail)
    values (s.id, p_store, mail, 'recovered', 'cobro al dia despues de una tarjeta rechazada');
  elsif venia in ('canceled','expired') then
    insert into public.subscription_events (subscription_id, store_id, email, kind, detail)
    values (s.id, p_store, mail, 'reactivated', 'volvio desde ' || venia);
  end if;

  return jsonb_build_object('repetido', false, 'creada', nueva, 'id', s.id,
    'status', s.status, 'pagos', s.payments_count, 'total', s.paid_total,
    'founder', s.founder, 'hasta', s.current_period_end);
end;
$$;
comment on function public.sub_cobro is
  'Alta o renovacion de una suscripcion. Idempotente por whop_payment_id: el reintento de un webhook no cuenta dos veces.';

-- ------------------------------------------------------------------ el fallo
-- Una tarjeta rechazada NO corta el acceso. Whop reintenta varios dias, y
-- cortarle a alguien que termina pagando es perder un suscriptor por nada. Se
-- marca `past_due` -- sigue entrando -- y el corte lo decide sub_vencer pasada
-- la gracia.
create or replace function public.sub_fallo(
  p_store uuid, p_email text, p_payment text,
  p_product uuid default null, p_membership text default null, p_motivo text default null
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  mail text := lower(trim(p_email));
  s public.subscriptions;
  n int;
begin
  select * into s from public.subscriptions
   where store_id = p_store
     and (  (p_membership is not null and whop_membership_id = p_membership)
         or (mail <> '' and email = mail and (p_product is null or product_id = p_product)))
   order by (whop_membership_id is not null and whop_membership_id = p_membership) desc
   limit 1;
  if not found then
    return jsonb_build_object('sin_suscripcion', true);
  end if;

  insert into public.subscription_events (
    subscription_id, store_id, email, kind, whop_payment_id, whop_membership_id, detail)
  values (s.id, p_store, s.email, 'payment_failed', p_payment, s.whop_membership_id, left(coalesce(p_motivo,''), 400))
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
    insert into public.subscription_events (subscription_id, store_id, email, kind, detail)
    values (s.id, p_store, s.email, 'past_due', 'primer rechazo: conserva el acceso');
  end if;

  return jsonb_build_object('repetido', false, 'id', s.id, 'email', s.email,
    'fallos', s.failed_count, 'status', s.status, 'avisado', s.dunning_sent_at is not null);
end;
$$;
comment on function public.sub_fallo is
  'Tarjeta rechazada: cuenta el fallo y pasa a past_due SIN cortar el acceso. Idempotente por whop_payment_id.';

-- ------------------------------------------------------------------- la baja
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

  insert into public.subscription_events (subscription_id, store_id, email, kind, detail)
  values (s.id, s.store_id, s.email, case when p_ya then 'expired' else 'canceled' end,
          left(coalesce(p_motivo, 'baja pedida por el suscriptor'), 400));

  return jsonb_build_object('id', s.id, 'status', s.status, 'hasta', s.current_period_end);
end;
$$;
comment on function public.sub_baja is
  'Baja. Por defecto conserva el acceso hasta terminar el periodo pagado; p_ya corta en el acto (reembolso).';
