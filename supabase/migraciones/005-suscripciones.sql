-- Cobro recurrente: el nivel pago de la carta semanal.
--
-- POR QUE ES UNA MIGRACION Y NO UNA CONFIGURACION
--   Hasta hoy la app sabia cobrar UNA vez. Todo plan de Whop se creaba con
--   `plan_type: 'one_time'`, y los textos del catalogo dicen «pago unico, sin
--   cargos recurrentes». Una suscripcion no es otro precio: es un ESTADO que
--   cambia solo con el tiempo -- se renueva, se cae una tarjeta, alguien se da
--   de baja -- y sin ese estado guardado no hay manera de saber a quien le toca
--   recibir la edicion del domingo. Un envio que se le escapa a un dado de baja
--   es un reclamo; uno que NO le llega a quien pago es una baja.

-- ---------------------------------------------------------------- el producto
-- La suscripcion es un producto como cualquier otro (tiene nombre, precio y
-- entrega), con cuatro datos que los demas no necesitan.
alter table public.products add column if not exists subscription boolean not null default false;
alter table public.products add column if not exists billing_period_days integer;
-- El plan con precio de FUNDADOR. Es un plan aparte en Whop, no un descuento:
-- Whop fija el precio al crear la suscripcion, asi que el precio de por vida
-- solo se puede prometer poniendo a esa persona en otro plan.
alter table public.products add column if not exists whop_founder_plan_id text;
-- Quien compro ANTES de este instante entra como fundador. Se fija el dia del
-- lanzamiento: sin fecha no hay fundadores, que es el estado correcto hasta que
-- exista el nivel pago.
alter table public.products add column if not exists founder_cutoff timestamptz;
alter table public.products add constraint products_billing_period_check
  check (billing_period_days is null or billing_period_days between 1 and 365);

-- ------------------------------------------------------------ la suscripcion
create table if not exists public.subscriptions (
  id                   uuid primary key default gen_random_uuid(),
  store_id             uuid not null references public.stores(id) on delete cascade,
  product_id           uuid not null references public.products(id),
  email                text not null,
  name                 text,
  locale               text,
  country              char(2),

  -- active    cobra y tiene acceso
  -- past_due  se le rechazo la tarjeta; CONSERVA el acceso mientras se reintenta
  -- canceled  pidio la baja; tiene acceso hasta terminar el periodo que pago
  -- expired   sin acceso
  status               text not null default 'active',
  founder              boolean not null default false,

  -- Lo de Whop. La membresia es la identidad de la suscripcion alla.
  whop_membership_id   text,
  whop_plan_id         text,
  whop_member_id       text,
  whop_payment_method_id text,

  currency             char(3) not null default 'usd',
  amount               numeric(10,2),
  billing_period_days  integer,

  started_at           timestamptz not null default now(),
  -- Hasta cuando tiene acceso pagado. Lo dice Whop en la renovacion; si no
  -- viene, se calcula sumando el periodo al ultimo cobro.
  current_period_end   timestamptz,
  canceled_at          timestamptz,
  ended_at             timestamptz,

  payments_count       integer not null default 0,
  paid_total           numeric(12,2) not null default 0,
  last_payment_at      timestamptz,

  -- Fallos CONSECUTIVOS: un cobro bueno lo vuelve a cero. Acumulado no sirve
  -- para decidir un corte -- alguien con dos anos de historia y una tarjeta
  -- vencida no es un moroso.
  failed_count         integer not null default 0,
  last_failure_at      timestamptz,
  last_failure_reason  text,
  dunning_sent_at      timestamptz,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint subscriptions_status_check
    check (status in ('active','past_due','canceled','expired')),
  constraint subscriptions_email_lower check (email = lower(email)),
  constraint subscriptions_unica unique (store_id, product_id, email)
);
comment on table public.subscriptions is
  'Una fila por suscriptor y suscripcion. El estado manda sobre la entrega: la edicion paga sale por la vista subscriptions_activas, no por esta tabla.';

-- La membresia de Whop no puede repetirse entre filas: si llegara dos veces,
-- serian dos suscripciones cobrando por la misma.
create unique index if not exists subscriptions_membership_uniq
  on public.subscriptions(whop_membership_id) where whop_membership_id is not null;
create index if not exists subscriptions_store_status_idx
  on public.subscriptions(store_id, status);
create index if not exists subscriptions_email_idx on public.subscriptions(lower(email));
-- Para el barrido diario que vence lo cancelado y corta lo moroso.
create index if not exists subscriptions_period_end_idx
  on public.subscriptions(current_period_end)
  where status in ('canceled','past_due');

alter table public.subscriptions enable row level security;

-- --------------------------------------------------------------- la bitacora
-- Cada cosa que le pasa a una suscripcion. Sirve para dos cosas distintas:
-- entender por que alguien se fue, y NO cobrar dos veces el mismo evento.
create table if not exists public.subscription_events (
  id                 bigserial primary key,
  subscription_id    uuid references public.subscriptions(id) on delete cascade,
  store_id           uuid not null references public.stores(id) on delete cascade,
  email              text,
  kind               text not null,
  amount             numeric(10,2),
  currency           char(3),
  whop_payment_id    text,
  whop_membership_id text,
  detail             text,
  -- El evento tal como llego. Un campo que cambia de nombre del lado de Whop se
  -- diagnostica leyendo esto, no adivinando.
  raw                jsonb,
  at                 timestamptz not null default now(),
  constraint subscription_events_kind_check check (kind in (
    'created','renewed','payment_failed','past_due','recovered',
    'canceled','reactivated','expired','dunning_mail','access_revoked','desconocido'))
);
comment on table public.subscription_events is
  'Bitacora de la suscripcion. El indice unico sobre (whop_payment_id, kind) es lo que hace que un webhook repetido no cuente dos veces el mismo cobro.';

-- IDEMPOTENCIA. Whop reintenta los webhooks, y un reintento de `renewed` que
-- se registra dos veces infla payments_count y paid_total -- o sea, el MRR que
-- se mira para decidir. Este indice lo hace imposible.
create unique index if not exists subscription_events_pago_uniq
  on public.subscription_events(whop_payment_id, kind)
  where whop_payment_id is not null;
create index if not exists subscription_events_sub_idx
  on public.subscription_events(subscription_id, at desc);

alter table public.subscription_events enable row level security;

-- --------------------------------------------------------- quien tiene acceso
-- UNA sola definicion de «tiene acceso», y todo lo demas la lee: el segmento
-- del envio, el panel y la pagina de la suscripcion. Con la regla escrita en
-- dos lados, un dia el muro y el panel opinan distinto y alguien que pago se
-- queda afuera.
create or replace view public.subscriptions_activas as
  select s.*
    from public.subscriptions s
   where s.status in ('active','past_due')
      -- Cancelada pero paga hasta fin de periodo: sigue entrando. Se dio de
      -- baja, no pidio que se le devuelva lo que ya pago.
      or (s.status = 'canceled' and s.current_period_end is not null
          and s.current_period_end > now());
comment on view public.subscriptions_activas is
  'Los que HOY tienen derecho a la edicion paga. Unica definicion de acceso.';

-- ------------------------------------------------- el muro, en el segmento
-- El filtro `sub` del segmento de email:
--   "active"  solo quien tiene acceso    -> la edicion paga
--   "none"    solo quien no lo tiene     -> a quien se le ofrece la suscripcion
CREATE OR REPLACE FUNCTION public.mkt_segment_ids(p_store uuid, f jsonb)
 RETURNS TABLE(id uuid, email text, locale text, name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  offers_any uuid[] := mkt_arr(f -> 'offers_any')::uuid[];
  offers_none uuid[] := mkt_arr(f -> 'offers_none')::uuid[];
  p_any uuid[] := mkt_offer_products(mkt_arr(f -> 'offers_any')::uuid[]);
  p_none uuid[] := mkt_offer_products(mkt_arr(f -> 'offers_none')::uuid[]);
  cats text[] := mkt_arr(f -> 'categories');
  cats_none text[] := mkt_arr(f -> 'categories_none');
  mkts text[] := mkt_arr(f -> 'markets');
  ctry text[] := mkt_arr(f -> 'countries');
  locs text[] := mkt_arr(f -> 'locales');
  d_from timestamptz := (nullif(f ->> 'from', '')::date)::timestamp at time zone 'America/Argentina/Buenos_Aires';
  d_to timestamptz := ((nullif(f ->> 'to', '')::date) + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires';
  spent numeric := nullif(f ->> 'spent_min', '')::numeric;
  recent int := nullif(f ->> 'exclude_recent_days', '')::int;
  eng_c uuid := nullif(f -> 'engaged' ->> 'campaign', '')::uuid;
  eng_k text := coalesce(f -> 'engaged' ->> 'kind', 'opened');
  leads boolean := coalesce((f ->> 'leads')::boolean, false);
  sub text := nullif(f ->> 'sub', '');
begin
  return query
  select c.id, c.email, c.locale, c.name from mkt_contacts c
  where c.store_id = p_store
    and c.status = 'subscribed' and c.marketing_ok and not c.refunded and not c.disputed
    and (c.kind = 'buyer' or leads)
    and not exists (select 1 from mail_unsubscribes u where u.store_id = c.store_id and u.email = c.email)
    and (cardinality(offers_any) = 0 or c.offers && offers_any or c.products && p_any)
    and (cardinality(offers_none) = 0 or not (c.offers && offers_none or c.products && p_none))
    and (cardinality(cats) = 0 or c.categories && cats)
    and (cardinality(cats_none) = 0 or not (c.categories && cats_none))
    and (cardinality(mkts) = 0 or c.markets && mkts)
    and (cardinality(ctry) = 0 or upper(c.country) = any(ctry))
    and (cardinality(locs) = 0 or c.locale = any(locs))
    and (d_from is null or c.last_purchase_at >= d_from)
    and (d_to is null or c.last_purchase_at < d_to)
    and (spent is null or c.spent_usd >= spent)
    and (recent is null or recent <= 0 or c.last_purchase_at is null or c.last_purchase_at < now() - make_interval(days => recent))
    and (eng_c is null or exists (
      select 1 from mkt_sends s where s.campaign_id = eng_c and s.email = c.email and not s.is_test and s.sent_at is not null and (
        (eng_k = 'opened' and s.opened_at is not null) or (eng_k = 'clicked' and s.clicked_at is not null)
        or (eng_k = 'not_opened' and s.opened_at is null))))
    -- EL MURO. La edicion paga no sale de una lista aparte que hay que
    -- acordarse de mantener: se filtra contra el estado real del cobro.
    --   'active' = quien tiene acceso hoy   -> la edicion paga
    --   'none'   = quien no lo tiene        -> a quien se le ofrece
    and (sub is null or (case sub
      when 'active' then exists (select 1 from subscriptions_activas a
                                  where a.store_id = c.store_id and a.email = lower(c.email))
      when 'none'   then not exists (select 1 from subscriptions_activas a
                                  where a.store_id = c.store_id and a.email = lower(c.email))
      else true end));
end $function$;

-- ------------------------------------------------------- el barrido del dia
-- Lo que cambia por el PASO DEL TIEMPO, no por un webhook: una baja cuyo
-- periodo termino, y un moroso que ya no se recupera. Whop no manda un evento
-- por «se termino el periodo de alguien que se dio de baja hace 29 dias».
create or replace function public.sub_vencer(p_gracia_dias int default 14)
  returns table(vencidas int, cortadas int)
  language plpgsql security definer set search_path to 'public' as $$
declare v int; c int;
begin
  -- Baja cumplida: pago hasta aca y aca termina.
  with x as (
    update public.subscriptions set status = 'expired', ended_at = now(), updated_at = now()
     where status = 'canceled' and current_period_end is not null and current_period_end <= now()
     returning id, store_id, email)
  insert into public.subscription_events (subscription_id, store_id, email, kind, detail)
  select id, store_id, email, 'expired', 'termino el periodo pagado' from x;
  get diagnostics v = row_count;

  -- Moroso sin recuperacion: se le corta despues de la gracia.
  with y as (
    update public.subscriptions set status = 'expired', ended_at = now(), updated_at = now()
     where status = 'past_due' and last_failure_at is not null
       and last_failure_at <= now() - make_interval(days => p_gracia_dias)
     returning id, store_id, email, failed_count)
  insert into public.subscription_events (subscription_id, store_id, email, kind, detail)
  select id, store_id, email, 'access_revoked',
         'sin cobrar tras ' || p_gracia_dias || ' dias de gracia (' || failed_count || ' intentos)' from y;
  get diagnostics c = row_count;

  return query select coalesce(v,0), coalesce(c,0);
end;
$$;
comment on function public.sub_vencer is
  'Barrido diario: vence las bajas cumplidas y corta a los morosos pasada la gracia. Lo llama el cron.';
