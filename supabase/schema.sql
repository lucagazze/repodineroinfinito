-- Esquema completo de la base (solo estructura, sin datos).
-- Lo aplica `npm run setup` (Management API de Supabase) o se pega entero en el SQL Editor de un proyecto nuevo.
-- Es idempotente: se puede volver a correr sobre una base que ya lo tiene.

set check_function_bodies = false;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------- Secuencias ----------
create sequence if not exists public.bid_pilot_log_id_seq;
create sequence if not exists public.downloads_id_seq;
create sequence if not exists public.email_events_id_seq;
create sequence if not exists public.login_attempts_id_seq;
create sequence if not exists public.meta_auto_log_id_seq;
create sequence if not exists public.meta_insights_daily_id_seq;
create sequence if not exists public.mkt_events_id_seq;
create sequence if not exists public.order_number_seq;
create sequence if not exists public.rec_chunks_id_seq;
create sequence if not exists public.site_events_id_seq;
create sequence if not exists public.uptime_checks_id_seq;

-- ---------- Tablas ----------
create table if not exists public.ad_creatives (
  id uuid default gen_random_uuid() not null,
  offer_id uuid not null,
  funnel_id uuid,
  title text not null,
  kind text default 'video'::text not null,
  drive_file_id text,
  url text,
  thumbnail_url text,
  language text default ''::text not null,
  angle text,
  status text default 'borrador'::text not null,
  meta_ad_ids text[] default '{}'::text[] not null,
  notes text default ''::text not null,
  sort_order integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  constraint ad_creatives_pkey PRIMARY KEY (id),
  constraint ad_creatives_kind_check CHECK ((kind = ANY (ARRAY['video'::text, 'image'::text, 'folder'::text]))),
  constraint ad_creatives_status_check CHECK ((status = ANY (ARRAY['activo'::text, 'pausado'::text, 'borrador'::text])))
);
alter table public.ad_creatives enable row level security;

create table if not exists public.alerts (
  id uuid default gen_random_uuid() not null,
  store_id uuid,
  kind text not null,
  severity text default 'info'::text not null,
  title text not null,
  body text,
  link text,
  ref_id text,
  created_at timestamp with time zone default now() not null,
  resolved_at timestamp with time zone,
  constraint alerts_pkey PRIMARY KEY (id),
  constraint alerts_kind_ref_id_key UNIQUE (kind, ref_id),
  constraint alerts_severity_check CHECK ((severity = ANY (ARRAY['info'::text, 'warn'::text, 'error'::text])))
);
alter table public.alerts enable row level security;

create table if not exists public.api_tokens (
  id uuid default gen_random_uuid() not null,
  name text not null,
  token_hash text not null,
  last_used_at timestamp with time zone,
  revoked_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  constraint api_tokens_pkey PRIMARY KEY (id),
  constraint api_tokens_token_hash_key UNIQUE (token_hash)
);
alter table public.api_tokens enable row level security;

create table if not exists public.app_settings (
  key text not null,
  value jsonb default '{}'::jsonb not null,
  updated_at timestamp with time zone default now() not null,
  constraint app_settings_pkey PRIMARY KEY (key)
);
alter table public.app_settings enable row level security;

create table if not exists public.bid_pilot_adsets (
  adset_id text not null,
  campaign_id text not null,
  account_id text not null,
  name text,
  status text,
  bid numeric(10,2),
  last_set_bid numeric(10,2),
  last_change_at timestamp with time zone,
  last_change_reason text,
  last_raise_at timestamp with time zone,
  last_lower_at timestamp with time zone,
  manual_until timestamp with time zone,
  first_seen_at timestamp with time zone default now() not null,
  spend_12h numeric(12,2),
  spend_24h numeric(12,2),
  purchases_24h numeric(10,2),
  spend_72h numeric(12,2),
  purchases_72h numeric(10,2),
  state text,
  reason text,
  updated_at timestamp with time zone default now() not null,
  ladder boolean default false not null,
  ladder_pct numeric(4,2),
  constraint bid_pilot_adsets_pkey PRIMARY KEY (adset_id)
);
alter table public.bid_pilot_adsets enable row level security;

create table if not exists public.bid_pilot_campaigns (
  campaign_id text not null,
  account_id text not null,
  name text not null,
  enabled boolean default true not null,
  target_cpa numeric(10,2) not null,
  max_bid numeric(10,2) not null,
  floor_bid numeric(10,2) not null,
  daily_budget numeric(12,2),
  status text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  max_manual boolean default false not null,
  front_usd numeric(10,2),
  front_label text,
  front_funnel text,
  front_via text,
  cpa_alert text,
  cpa_alert_at timestamp with time zone,
  constraint bid_pilot_campaigns_pkey PRIMARY KEY (campaign_id)
);
alter table public.bid_pilot_campaigns enable row level security;

create table if not exists public.bid_pilot_log (
  id bigint default nextval('bid_pilot_log_id_seq'::regclass) not null,
  run_id uuid,
  at timestamp with time zone default now() not null,
  campaign_id text not null,
  adset_id text not null,
  campaign_name text,
  action text not null,
  rule text,
  bid_before numeric(10,2),
  bid_after numeric(10,2),
  applied boolean default false not null,
  confirmed_bid numeric(10,2),
  reason text,
  numbers jsonb default '{}'::jsonb not null,
  constraint bid_pilot_log_pkey PRIMARY KEY (id),
  constraint bid_pilot_log_action_check CHECK ((action = ANY (ARRAY['raise'::text, 'lower'::text, 'hold'::text, 'pause'::text, 'error'::text])))
);
alter table public.bid_pilot_log enable row level security;

create table if not exists public.bid_pilot_runs (
  id uuid default gen_random_uuid() not null,
  at timestamp with time zone default now() not null,
  dry_run boolean default false not null,
  ok boolean default true not null,
  skipped text,
  error text,
  changes integer default 0 not null,
  ms integer,
  constraint bid_pilot_runs_pkey PRIMARY KEY (id)
);
alter table public.bid_pilot_runs enable row level security;

create table if not exists public.checkouts (
  id uuid default gen_random_uuid() not null,
  store_id uuid not null,
  funnel_id uuid,
  stripe_payment_intent text,
  email text,
  name text,
  country character(2),
  locale text,
  currency character(3),
  amount numeric(10,2),
  bumps text[] default '{}'::text[] not null,
  utm jsonb default '{}'::jsonb not null,
  status text default 'open'::text not null,
  order_id uuid,
  recovery_sent_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  tracking jsonb default '{}'::jsonb not null,
  recovery_pct integer,
  recovery_expires_at timestamp with time zone,
  recovery_email_log_id uuid,
  recovery_source text,
  recovery_skip text,
  recovered_order_id uuid,
  constraint checkouts_pkey PRIMARY KEY (id),
  constraint checkouts_stripe_payment_intent_key UNIQUE (stripe_payment_intent),
  constraint checkouts_status_check CHECK ((status = ANY (ARRAY['open'::text, 'paid'::text])))
);
alter table public.checkouts enable row level security;

create table if not exists public.coach_recs (
  id uuid default gen_random_uuid() not null,
  run_id uuid not null,
  created_at timestamp with time zone default now() not null,
  kind text default 'mejora'::text not null,
  offer_key text,
  store_slug text,
  fingerprint text not null,
  area text not null,
  severity text not null,
  title text not null,
  weak text,
  why text,
  change text,
  prompt text not null,
  impact_usd_week numeric(12,2),
  evidence jsonb,
  checks jsonb,
  sort integer default 0 not null,
  status text default 'nueva'::text not null,
  status_at timestamp with time zone,
  constraint coach_recs_pkey PRIMARY KEY (id),
  constraint coach_recs_kind_check CHECK ((kind = ANY (ARRAY['mejora'::text, 'postpago'::text]))),
  constraint coach_recs_severity_check CHECK ((severity = ANY (ARRAY['alta'::text, 'media'::text, 'baja'::text]))),
  constraint coach_recs_status_check CHECK ((status = ANY (ARRAY['nueva'::text, 'hecha'::text, 'descartada'::text])))
);
alter table public.coach_recs enable row level security;

create table if not exists public.coach_runs (
  id uuid default gen_random_uuid() not null,
  created_at timestamp with time zone default now() not null,
  finished_at timestamp with time zone,
  status text default 'running'::text not null,
  trigger text default 'cron'::text not null,
  since date not null,
  until date not null,
  prev_since date not null,
  prev_until date not null,
  facts jsonb,
  summary text,
  model text,
  ai_calls integer default 0 not null,
  error text,
  ms integer,
  constraint coach_runs_pkey PRIMARY KEY (id),
  constraint coach_runs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'ok'::text, 'error'::text])))
);
alter table public.coach_runs enable row level security;

create table if not exists public.delivery_mirror (
  drive_id text not null,
  path text not null,
  name text not null,
  bytes bigint,
  created_at timestamp with time zone default now() not null,
  constraint delivery_mirror_pkey PRIMARY KEY (drive_id)
);
alter table public.delivery_mirror enable row level security;

create table if not exists public.downloads (
  id bigint default nextval('downloads_id_seq'::regclass) not null,
  order_id uuid not null,
  product_id uuid,
  ip text,
  at timestamp with time zone default now() not null,
  constraint downloads_pkey PRIMARY KEY (id)
);
alter table public.downloads enable row level security;

create table if not exists public.email_events (
  id bigint default nextval('email_events_id_seq'::regclass) not null,
  email_log_id uuid not null,
  kind text not null,
  url text,
  ip text,
  ua text,
  at timestamp with time zone default now() not null,
  constraint email_events_pkey PRIMARY KEY (id),
  constraint email_events_kind_check CHECK ((kind = ANY (ARRAY['open'::text, 'click'::text, 'bounce'::text])))
);
alter table public.email_events enable row level security;

create table if not exists public.email_log (
  id uuid default gen_random_uuid() not null,
  store_id uuid,
  order_id uuid,
  kind text not null,
  to_email text not null,
  provider text,
  provider_id text,
  status text not null,
  error text,
  created_at timestamp with time zone default now() not null,
  subject text,
  tracked boolean default false not null,
  opened_at timestamp with time zone,
  open_count integer default 0 not null,
  clicked_at timestamp with time zone,
  click_count integer default 0 not null,
  downloaded_at timestamp with time zone,
  bounced_at timestamp with time zone,
  bounce_reason text,
  ai boolean default false not null,
  body_html text,
  constraint email_log_pkey PRIMARY KEY (id),
  constraint email_log_kind_check CHECK ((kind = ANY (ARRAY['delivery'::text, 'upsell'::text, 'recovery'::text, 'test'::text, 'reply'::text, 'access'::text]))),
  constraint email_log_status_check CHECK ((status = ANY (ARRAY['sent'::text, 'failed'::text])))
);
alter table public.email_log enable row level security;

create table if not exists public.funnel_items (
  id uuid default gen_random_uuid() not null,
  funnel_id uuid not null,
  product_id uuid not null,
  role text not null,
  sort_order integer default 0 not null,
  constraint funnel_items_pkey PRIMARY KEY (id),
  constraint funnel_items_funnel_id_product_id_role_key UNIQUE (funnel_id, product_id, role),
  constraint funnel_items_role_check CHECK ((role = ANY (ARRAY['included'::text, 'bonus'::text, 'upsell'::text, 'bump'::text])))
);
alter table public.funnel_items enable row level security;

create table if not exists public.funnels (
  id uuid default gen_random_uuid() not null,
  store_id uuid not null,
  slug text not null,
  name text not null,
  main_product_id uuid,
  active boolean default true not null,
  sort_order integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  pixel_ids uuid[] default '{}'::uuid[] not null,
  settings jsonb default '{}'::jsonb not null,
  offer_id uuid,
  market_label text default ''::text not null,
  landing_url text,
  meta_campaign_ids text[] default '{}'::text[] not null,
  checkout_host text,
  checkout_path text,
  meta_campaign_auto text[] default '{}'::text[] not null,
  record_sessions boolean default true not null,
  constraint funnels_pkey PRIMARY KEY (id),
  constraint funnels_store_id_slug_key UNIQUE (store_id, slug)
);
alter table public.funnels enable row level security;

create table if not exists public.inbox_messages (
  id uuid default gen_random_uuid() not null,
  store_id uuid not null,
  mailbox text default 'INBOX'::text not null,
  uid bigint,
  direction text default 'in'::text not null,
  message_id text not null,
  in_reply_to text,
  refs text,
  from_email text,
  from_name text,
  to_email text,
  subject text,
  date timestamp with time zone,
  text text,
  html text,
  is_bounce boolean default false not null,
  email_log_id uuid,
  order_id uuid,
  read_at timestamp with time zone,
  replied_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  reply_to text,
  attachments jsonb default '[]'::jsonb not null,
  ai boolean default false not null,
  automated boolean default false not null,
  ai_draft jsonb,
  ai_pilot_at timestamp with time zone,
  money_pushed_at timestamp with time zone,
  mail_push_due_at timestamp with time zone,
  mail_pushed_at timestamp with time zone,
  ai_auto_due_at timestamp with time zone,
  ai_auto_done_at timestamp with time zone,
  constraint inbox_messages_pkey PRIMARY KEY (id),
  constraint inbox_messages_store_id_message_id_key UNIQUE (store_id, message_id),
  constraint inbox_messages_direction_check CHECK ((direction = ANY (ARRAY['in'::text, 'out'::text])))
);
alter table public.inbox_messages enable row level security;

create table if not exists public.inbox_sync_state (
  store_id uuid not null,
  mailbox text default 'INBOX'::text not null,
  uid_validity text,
  last_uid bigint default 0 not null,
  synced_at timestamp with time zone,
  error text,
  constraint inbox_sync_state_pkey PRIMARY KEY (store_id, mailbox)
);
alter table public.inbox_sync_state enable row level security;

create table if not exists public.library_grants (
  id uuid default gen_random_uuid() not null,
  store_id uuid not null,
  email text not null,
  product_id uuid not null,
  created_at timestamp with time zone default now() not null,
  constraint library_grants_pkey PRIMARY KEY (id),
  constraint library_grants_store_id_email_product_id_key UNIQUE (store_id, email, product_id)
);
alter table public.library_grants enable row level security;

create table if not exists public.login_attempts (
  id bigint default nextval('login_attempts_id_seq'::regclass) not null,
  ip text not null,
  ok boolean not null,
  at timestamp with time zone default now() not null,
  constraint login_attempts_pkey PRIMARY KEY (id)
);
alter table public.login_attempts enable row level security;

create table if not exists public.mail_unsubscribes (
  store_id uuid not null,
  email text not null,
  source text,
  created_at timestamp with time zone default now() not null,
  constraint mail_unsubscribes_pkey PRIMARY KEY (store_id, email)
);
alter table public.mail_unsubscribes enable row level security;

create table if not exists public.markets (
  id uuid default gen_random_uuid() not null,
  store_id uuid not null,
  name text not null,
  currency character(3) not null,
  countries text[] default '{}'::text[] not null,
  is_default boolean default false not null,
  created_at timestamp with time zone default now() not null,
  constraint markets_pkey PRIMARY KEY (id),
  constraint markets_store_id_currency_key UNIQUE (store_id, currency)
);
alter table public.markets enable row level security;

create table if not exists public.mcp_audit (
  id uuid default gen_random_uuid() not null,
  tool text not null,
  args jsonb default '{}'::jsonb not null,
  result_summary text,
  ok boolean default true not null,
  token_name text,
  created_at timestamp with time zone default now() not null,
  constraint mcp_audit_pkey PRIMARY KEY (id)
);
alter table public.mcp_audit enable row level security;

create table if not exists public.meta_auto_campaigns (
  campaign_id text not null,
  account_id text not null,
  name text not null,
  cbo_guard boolean default true not null,
  status text,
  daily_budget numeric(12,2),
  last_eval_at timestamp with time zone,
  last_spend numeric(12,2),
  last_revenue numeric(12,2),
  last_roas numeric(10,3),
  last_source text,
  last_days_run integer,
  last_verdict text,
  last_reason text,
  last_auto_pause_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint meta_auto_campaigns_pkey PRIMARY KEY (campaign_id)
);
alter table public.meta_auto_campaigns enable row level security;

create table if not exists public.meta_auto_log (
  id bigint default nextval('meta_auto_log_id_seq'::regclass) not null,
  at timestamp with time zone default now() not null,
  kind text not null,
  account_id text,
  campaign_id text,
  campaign_name text,
  ad_id text,
  title text not null,
  body text,
  link text,
  numbers jsonb default '{}'::jsonb not null,
  constraint meta_auto_log_pkey PRIMARY KEY (id)
);
alter table public.meta_auto_log enable row level security;

create table if not exists public.meta_auto_runs (
  id uuid default gen_random_uuid() not null,
  at timestamp with time zone default now() not null,
  ok boolean default true not null,
  skipped text,
  error text,
  paused integer default 0 not null,
  proposed integer default 0 not null,
  ms integer,
  constraint meta_auto_runs_pkey PRIMARY KEY (id)
);
alter table public.meta_auto_runs enable row level security;

create table if not exists public.meta_auto_winners (
  ad_id text not null,
  account_id text not null,
  campaign_id text not null,
  campaign_name text,
  adset_id text,
  ad_name text,
  status text default 'proposed'::text not null,
  proposed_at timestamp with time zone default now() not null,
  expires_at timestamp with time zone not null,
  spend numeric(12,2),
  purchases numeric(10,2),
  cpa numeric(10,2),
  target numeric(10,2),
  days_run integer,
  window_since date,
  window_until date,
  new_name text,
  new_campaign_id text,
  new_adset_id text,
  new_ad_id text,
  new_creative_id text,
  error text,
  decided_at timestamp with time zone,
  updated_at timestamp with time zone default now() not null,
  constraint meta_auto_winners_pkey PRIMARY KEY (ad_id),
  constraint meta_auto_winners_status_check CHECK ((status = ANY (ARRAY['proposed'::text, 'creating'::text, 'created'::text, 'dismissed'::text, 'expired'::text, 'failed'::text])))
);
alter table public.meta_auto_winners enable row level security;

create table if not exists public.meta_insights_daily (
  id bigint generated always as identity not null,
  account_id text not null,
  date date not null,
  level text not null,
  campaign_id text,
  campaign_name text,
  adset_id text,
  adset_name text,
  ad_id text,
  ad_name text,
  status text,
  effective_status text,
  daily_budget numeric,
  spend numeric default 0 not null,
  impressions bigint default 0 not null,
  clicks bigint default 0 not null,
  inline_link_clicks bigint default 0 not null,
  purchases numeric default 0 not null,
  purchase_value numeric default 0 not null,
  video_3s_views bigint default 0 not null,
  thruplays bigint default 0 not null,
  updated_at timestamp with time zone default now() not null,
  initiate_checkout numeric default 0 not null,
  landing_page_views numeric default 0 not null,
  constraint meta_insights_daily_pkey PRIMARY KEY (id),
  constraint meta_insights_daily_level_check CHECK ((level = ANY (ARRAY['campaign'::text, 'adset'::text, 'ad'::text])))
);
alter table public.meta_insights_daily enable row level security;

create table if not exists public.meta_objects (
  level text not null,
  id text not null,
  account_id text not null,
  name text,
  status text,
  effective_status text,
  campaign_id text,
  adset_id text,
  daily_budget numeric,
  lifetime_budget numeric,
  thumb text,
  video_id text,
  links text[] default '{}'::text[] not null,
  updated_at timestamp with time zone default now() not null,
  start_time timestamp with time zone,
  created_time timestamp with time zone,
  details jsonb,
  details_at timestamp with time zone,
  bid_amount numeric,
  bid_strategy text,
  constraint meta_objects_pkey PRIMARY KEY (level, id),
  constraint meta_objects_level_check CHECK ((level = ANY (ARRAY['campaign'::text, 'adset'::text, 'ad'::text])))
);
alter table public.meta_objects enable row level security;

create table if not exists public.meta_platform_daily (
  account_id text not null,
  date date not null,
  campaign_id text not null,
  platform text not null,
  spend numeric(14,2) default 0 not null,
  impressions bigint default 0 not null,
  link_clicks bigint default 0 not null,
  purchases numeric(12,2) default 0 not null,
  purchase_value numeric(14,2) default 0 not null,
  updated_at timestamp with time zone default now() not null,
  constraint meta_platform_daily_pkey PRIMARY KEY (account_id, date, campaign_id, platform)
);
alter table public.meta_platform_daily enable row level security;

create table if not exists public.meta_platform_sync (
  account_id text not null,
  backfilled_from date,
  updated_at timestamp with time zone default now() not null,
  constraint meta_platform_sync_pkey PRIMARY KEY (account_id)
);
alter table public.meta_platform_sync enable row level security;

create table if not exists public.meta_snapshots (
  key text not null,
  account text not null,
  data jsonb,
  fetched_at timestamp with time zone,
  last_error text,
  error_at timestamp with time zone,
  retry_at timestamp with time zone,
  fails integer default 0 not null,
  updated_at timestamp with time zone default now() not null,
  constraint meta_snapshots_pkey PRIMARY KEY (key)
);
alter table public.meta_snapshots enable row level security;

create table if not exists public.meta_sync (
  account_id text not null,
  name text,
  currency text,
  timezone text,
  last_ok_at timestamp with time zone,
  last_error text,
  error_at timestamp with time zone,
  retry_at timestamp with time zone,
  fails integer default 0 not null,
  running_until timestamp with time zone,
  backfilled_from date,
  ads_at timestamp with time zone,
  rows_written integer,
  took_ms integer,
  updated_at timestamp with time zone default now() not null,
  constraint meta_sync_pkey PRIMARY KEY (account_id)
);
alter table public.meta_sync enable row level security;

create table if not exists public.mkt_campaigns (
  id uuid default gen_random_uuid() not null,
  store_id uuid not null,
  kind text default 'broadcast'::text not null,
  flow_id uuid,
  name text not null,
  status text default 'draft'::text not null,
  segment_id uuid,
  segment jsonb default '{}'::jsonb not null,
  versions jsonb default '{}'::jsonb not null,
  fallback_locale text,
  goal text,
  discount_pct integer,
  discount_hours integer default 72 not null,
  discount_expires_at timestamp with time zone,
  discount_revoked_at timestamp with time zone,
  scheduled_at timestamp with time zone,
  confirmed_at timestamp with time zone,
  started_at timestamp with time zone,
  finished_at timestamp with time zone,
  total integer default 0 not null,
  last_error text,
  finish_pushed_at timestamp with time zone,
  results_pushed_at timestamp with time zone,
  created_via text default 'panel'::text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint mkt_campaigns_pkey PRIMARY KEY (id),
  constraint mkt_campaigns_discount_hours_check CHECK (((discount_hours >= 1) AND (discount_hours <= 720))),
  constraint mkt_campaigns_discount_pct_check CHECK (((discount_pct >= 1) AND (discount_pct <= 90))),
  constraint mkt_campaigns_kind_check CHECK ((kind = ANY (ARRAY['broadcast'::text, 'flow'::text]))),
  constraint mkt_campaigns_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'scheduled'::text, 'sending'::text, 'paused'::text, 'sent'::text, 'cancelled'::text])))
);
alter table public.mkt_campaigns enable row level security;

create table if not exists public.mkt_contacts (
  id uuid default gen_random_uuid() not null,
  store_id uuid not null,
  email text not null,
  name text,
  locale text,
  country text,
  kind text default 'buyer'::text not null,
  source text default 'app'::text not null,
  status text default 'subscribed'::text not null,
  status_at timestamp with time zone,
  status_reason text,
  marketing_ok boolean default true not null,
  first_purchase_at timestamp with time zone,
  last_purchase_at timestamp with time zone,
  orders_count integer default 0 not null,
  spent_usd numeric(12,2) default 0 not null,
  products uuid[] default '{}'::uuid[] not null,
  offers uuid[] default '{}'::uuid[] not null,
  categories text[] default '{}'::text[] not null,
  markets text[] default '{}'::text[] not null,
  refunded boolean default false not null,
  disputed boolean default false not null,
  imp_products uuid[] default '{}'::uuid[] not null,
  imp_names text[] default '{}'::text[] not null,
  imp_first_at timestamp with time zone,
  imp_last_at timestamp with time zone,
  imp_orders integer default 0 not null,
  imp_spent_usd numeric(12,2) default 0 not null,
  imp_refunded boolean default false not null,
  last_sent_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint mkt_contacts_pkey PRIMARY KEY (id),
  constraint mkt_contacts_store_id_email_key UNIQUE (store_id, email),
  constraint mkt_contacts_email_check CHECK ((email = lower(email))),
  constraint mkt_contacts_kind_check CHECK ((kind = ANY (ARRAY['buyer'::text, 'lead'::text]))),
  constraint mkt_contacts_source_check CHECK ((source = ANY (ARRAY['app'::text, 'import'::text, 'cart'::text]))),
  constraint mkt_contacts_status_check CHECK ((status = ANY (ARRAY['subscribed'::text, 'unsubscribed'::text, 'bounced'::text, 'complained'::text])))
);
alter table public.mkt_contacts enable row level security;

create table if not exists public.mkt_events (
  id bigint default nextval('mkt_events_id_seq'::regclass) not null,
  send_id uuid not null,
  kind text not null,
  url text,
  ip text,
  ua text,
  detail text,
  at timestamp with time zone default now() not null,
  constraint mkt_events_pkey PRIMARY KEY (id),
  constraint mkt_events_kind_check CHECK ((kind = ANY (ARRAY['open'::text, 'click'::text, 'delivered'::text, 'bounce'::text, 'complaint'::text, 'unsubscribe'::text, 'blocked'::text, 'error'::text])))
);
alter table public.mkt_events enable row level security;

create table if not exists public.mkt_import_orders (
  store_id uuid not null,
  ref text not null,
  email text not null,
  name text,
  country text,
  locale text,
  ordered_at timestamp with time zone,
  names text[] default '{}'::text[] not null,
  products uuid[] default '{}'::uuid[] not null,
  total numeric(12,2),
  currency text,
  usd numeric(12,2) default 0 not null,
  status text default 'paid'::text not null,
  import_id uuid,
  created_at timestamp with time zone default now() not null,
  constraint mkt_import_orders_pkey PRIMARY KEY (store_id, ref),
  constraint mkt_import_orders_email_check CHECK ((email = lower(email))),
  constraint mkt_import_orders_status_check CHECK ((status = ANY (ARRAY['paid'::text, 'refunded'::text])))
);
alter table public.mkt_import_orders enable row level security;

create table if not exists public.mkt_imports (
  id uuid default gen_random_uuid() not null,
  store_id uuid not null,
  file_name text,
  rows integer default 0 not null,
  contacts integer default 0 not null,
  created integer default 0 not null,
  updated integer default 0 not null,
  skipped integer default 0 not null,
  mapping jsonb,
  created_at timestamp with time zone default now() not null,
  constraint mkt_imports_pkey PRIMARY KEY (id)
);
alter table public.mkt_imports enable row level security;

create table if not exists public.mkt_segments (
  id uuid default gen_random_uuid() not null,
  store_id uuid not null,
  name text not null,
  filters jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint mkt_segments_pkey PRIMARY KEY (id)
);
alter table public.mkt_segments enable row level security;

create table if not exists public.mkt_sends (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  store_id uuid not null,
  contact_id uuid,
  email text not null,
  locale text,
  is_test boolean default false not null,
  status text default 'queued'::text not null,
  attempts integer default 0 not null,
  claimed_at timestamp with time zone,
  error text,
  provider_id text,
  subject text,
  sent_at timestamp with time zone,
  delivered_at timestamp with time zone,
  opened_at timestamp with time zone,
  open_count integer default 0 not null,
  clicked_at timestamp with time zone,
  click_count integer default 0 not null,
  bounced_at timestamp with time zone,
  bounce_type text,
  complained_at timestamp with time zone,
  unsubscribed_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  constraint mkt_sends_pkey PRIMARY KEY (id),
  constraint mkt_sends_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'sending'::text, 'sent'::text, 'failed'::text, 'skipped'::text])))
);
alter table public.mkt_sends enable row level security;

create table if not exists public.mkt_store_settings (
  store_id uuid not null,
  from_email text,
  reply_to text,
  synced_at timestamp with time zone,
  updated_at timestamp with time zone default now() not null,
  constraint mkt_store_settings_pkey PRIMARY KEY (store_id)
);
alter table public.mkt_store_settings enable row level security;

create table if not exists public.offer_tasks (
  id uuid default gen_random_uuid() not null,
  offer_id uuid,
  text text not null,
  done boolean default false not null,
  created_at timestamp with time zone default now() not null,
  done_at timestamp with time zone,
  constraint offer_tasks_pkey PRIMARY KEY (id),
  constraint offer_tasks_text_check CHECK (((length(text) >= 1) AND (length(text) <= 500)))
);
alter table public.offer_tasks enable row level security;

create table if not exists public.offers (
  id uuid default gen_random_uuid() not null,
  store_id uuid not null,
  slug text not null,
  name text not null,
  image_url text,
  notes text default ''::text not null,
  active boolean default true not null,
  sort_order integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  ads_folder_url text,
  category text,
  constraint offers_pkey PRIMARY KEY (id),
  constraint offers_store_id_slug_key UNIQUE (store_id, slug)
);
alter table public.offers enable row level security;

create table if not exists public.order_items (
  id uuid default gen_random_uuid() not null,
  order_id uuid not null,
  product_id uuid,
  kind text not null,
  amount numeric(10,2) default 0 not null,
  currency character(3),
  stripe_payment_intent text,
  created_at timestamp with time zone default now() not null,
  refunded_amount numeric(10,2) default 0 not null,
  constraint order_items_pkey PRIMARY KEY (id),
  constraint order_items_kind_check CHECK ((kind = ANY (ARRAY['main'::text, 'included'::text, 'bonus'::text, 'upsell'::text, 'bump'::text])))
);
alter table public.order_items enable row level security;

create table if not exists public.orders (
  id uuid default gen_random_uuid() not null,
  store_id uuid not null,
  funnel_id uuid,
  stripe_session_id text,
  stripe_payment_intent text,
  stripe_customer text,
  email text,
  name text,
  phone text,
  country character(2),
  locale text,
  currency character(3),
  amount_total numeric(10,2),
  status text default 'pending'::text not null,
  delivered_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  fulfill_claimed_at timestamp with time zone,
  pp_funnel_id uuid,
  utm jsonb default '{}'::jsonb not null,
  refunded_at timestamp with time zone,
  amount_refunded numeric(10,2) default 0 not null,
  delivery_attempts integer default 0 not null,
  delivery_error text,
  capi_sent_at timestamp with time zone,
  tracking jsonb default '{}'::jsonb not null,
  consents jsonb default '{}'::jsonb not null,
  sale_pushed_at timestamp with time zone,
  recovered_from uuid,
  discount jsonb,
  number bigint,
  is_test boolean default false not null,
  sale_push_due_at timestamp with time zone,
  constraint orders_pkey PRIMARY KEY (id),
  constraint orders_stripe_session_id_key UNIQUE (stripe_session_id),
  constraint orders_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'paid'::text, 'refunded'::text, 'failed'::text, 'test'::text])))
);
alter table public.orders enable row level security;

create table if not exists public.partners (
  email text not null,
  name text default ''::text not null,
  password_hash text not null,
  offer_ids uuid[] default '{}'::uuid[] not null,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  last_login_at timestamp with time zone,
  mcp_token_hash text,
  mcp_token_hint text,
  constraint partners_pkey PRIMARY KEY (email),
  constraint partners_mcp_token_hash_key UNIQUE (mcp_token_hash)
);
alter table public.partners enable row level security;

create table if not exists public.pi_rate (
  ip text not null,
  at timestamp with time zone default now() not null
);
alter table public.pi_rate enable row level security;

create table if not exists public.pixels (
  id uuid default gen_random_uuid() not null,
  store_id uuid not null,
  pixel_id text not null,
  name text default ''::text not null,
  capi_token_enc text,
  test_event_code text,
  all_funnels boolean default false not null,
  created_at timestamp with time zone default now() not null,
  constraint pixels_pkey PRIMARY KEY (id),
  constraint pixels_store_id_pixel_id_key UNIQUE (store_id, pixel_id)
);
alter table public.pixels enable row level security;

create table if not exists public.pp_funnels (
  id uuid default gen_random_uuid() not null,
  store_id uuid not null,
  checkout_funnel_id uuid,
  name text not null,
  trigger_product_ids uuid[] not null,
  active boolean default true not null,
  reserve_minutes integer default 10 not null,
  auto_generated boolean default false not null,
  sort_order integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  constraint pp_funnels_pkey PRIMARY KEY (id)
);
alter table public.pp_funnels enable row level security;

create table if not exists public.pp_steps (
  id uuid default gen_random_uuid() not null,
  pp_funnel_id uuid not null,
  product_id uuid not null,
  sort_order integer default 0 not null,
  kind text default 'oto'::text not null,
  downsell_of uuid,
  show_if jsonb,
  level smallint,
  constraint pp_steps_pkey PRIMARY KEY (id),
  constraint pp_steps_funnel_product_kind_key UNIQUE (pp_funnel_id, product_id, kind),
  constraint pp_steps_downsell_parent_check CHECK (((kind = 'downsell'::text) = (downsell_of IS NOT NULL))),
  constraint pp_steps_kind_check CHECK ((kind = ANY (ARRAY['oto'::text, 'downsell'::text]))),
  constraint pp_steps_level_check CHECK (((level IS NULL) OR ((level >= 1) AND (level <= 3))))
);
alter table public.pp_steps enable row level security;

create table if not exists public.presale_notices (
  order_id uuid not null,
  product_id uuid not null,
  sent_at timestamp with time zone default now() not null,
  constraint presale_notices_pkey PRIMARY KEY (order_id, product_id)
);
alter table public.presale_notices enable row level security;

create table if not exists public.product_prices (
  id uuid default gen_random_uuid() not null,
  product_id uuid not null,
  currency character(3) not null,
  amount numeric(10,2),
  compare_at numeric(10,2),
  display_value numeric(10,2),
  stripe_price_id text,
  stripe_synced_at timestamp with time zone,
  constraint product_prices_pkey PRIMARY KEY (id),
  constraint product_prices_product_id_currency_key UNIQUE (product_id, currency)
);
alter table public.product_prices enable row level security;

create table if not exists public.products (
  id uuid default gen_random_uuid() not null,
  store_id uuid not null,
  slug text not null,
  name text not null,
  short_name text not null,
  description text default ''::text not null,
  kind text default 'main'::text not null,
  delivery_url text,
  image_url text,
  sort_order integer default 0 not null,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  updated_by_admin_at timestamp with time zone,
  email_image_url text,
  delivery_links jsonb default '[]'::jsonb not null,
  show_in_catalog boolean default true not null,
  postcompra_page jsonb default '{}'::jsonb not null,
  delivery_file text,
  delivery_file_name text,
  postcompra_html text,
  includes uuid[] default '{}'::uuid[] not null,
  variant_of uuid,
  book_count integer,
  is_library boolean default false not null,
  presale boolean default false not null,
  presale_days integer default 3 not null,
  presale_since timestamp with time zone,
  content_ready_at timestamp with time zone,
  ready_files jsonb,
  presale_pages integer,
  presale_outline text,
  leftover_notices jsonb,
  partner_email text,
  constraint products_pkey PRIMARY KEY (id),
  constraint products_store_id_slug_key UNIQUE (store_id, slug),
  constraint products_kind_check CHECK ((kind = ANY (ARRAY['main'::text, 'bonus'::text, 'upsell'::text, 'postcompra'::text]))),
  constraint products_presale_days_check CHECK (((presale_days >= 1) AND (presale_days <= 60)))
);
alter table public.products enable row level security;

create table if not exists public.push_subscriptions (
  id uuid default gen_random_uuid() not null,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  device_label text,
  kinds text[] default '{sale,alert,mail,refund,dispute,delivery,oto,unpaid,bid}'::text[] not null,
  created_at timestamp with time zone default now() not null,
  last_ok_at timestamp with time zone,
  fail_count integer default 0 not null,
  device_id text,
  last_seen_at timestamp with time zone,
  client jsonb,
  constraint push_subscriptions_pkey PRIMARY KEY (id),
  constraint push_subscriptions_endpoint_key UNIQUE (endpoint)
);
alter table public.push_subscriptions enable row level security;

create table if not exists public.rec_chunks (
  id bigint default nextval('rec_chunks_id_seq'::regclass) not null,
  at timestamp with time zone default now() not null,
  session_id text not null,
  pv text,
  seq integer not null,
  page text,
  path text,
  t0 bigint,
  t1 bigint,
  n integer,
  bytes integer not null,
  gz bytea not null,
  constraint rec_chunks_pkey PRIMARY KEY (id)
);
alter table public.rec_chunks enable row level security;

create table if not exists public.rec_daily (
  day date not null,
  bytes bigint default 0 not null,
  sessions integer default 0 not null,
  constraint rec_daily_pkey PRIMARY KEY (day)
);
alter table public.rec_daily enable row level security;

create table if not exists public.rec_sessions (
  session_id text not null,
  visitor_id text,
  store_id uuid,
  funnel_id uuid,
  first_at timestamp with time zone default now() not null,
  last_at timestamp with time zone default now() not null,
  chunks integer default 0 not null,
  bytes bigint default 0 not null,
  constraint rec_sessions_pkey PRIMARY KEY (session_id)
);
alter table public.rec_sessions enable row level security;

create table if not exists public.site_events (
  id bigint default nextval('site_events_id_seq'::regclass) not null,
  at timestamp with time zone default now() not null,
  visitor_id text,
  session_id text,
  store_id uuid,
  funnel_id uuid,
  order_id uuid,
  page text not null,
  event text not null,
  host text,
  path text,
  country text,
  device text,
  utm jsonb,
  referrer text,
  data jsonb,
  city text,
  region text,
  browser text,
  os text,
  device_model text,
  ip_masked text,
  returning_visitor boolean,
  ref_host text generated always as (lower("substring"(referrer, '^[A-Za-z][A-Za-z0-9+.-]*://(?:www\.)?([^/?#:]+)'::text))) stored,
  utm_source text generated always as ((utm ->> 'utm_source'::text)) stored,
  utm_campaign text generated always as ((utm ->> 'utm_campaign'::text)) stored,
  ad_name text generated always as ((utm ->> 'utm_content'::text)) stored,
  is_bot boolean default false not null,
  bot_reason text,
  lat numeric(4,1),
  lon numeric(4,1),
  constraint site_events_pkey PRIMARY KEY (id),
  constraint site_events_device_check CHECK ((device = ANY (ARRAY['mobile'::text, 'desktop'::text, 'tablet'::text]))),
  constraint site_events_page_check CHECK ((page = ANY (ARRAY['landing'::text, 'checkout'::text, 'oferta'::text, 'gracias'::text])))
);
alter table public.site_events enable row level security;

create table if not exists public.store_ai (
  store_id uuid not null,
  autopilot boolean default false not null,
  updated_at timestamp with time zone default now() not null,
  constraint store_ai_pkey PRIMARY KEY (store_id)
);
alter table public.store_ai enable row level security;

create table if not exists public.store_mail (
  store_id uuid not null,
  host text default ''::text not null,
  port integer default 465 not null,
  username text not null,
  password_enc text not null,
  updated_at timestamp with time zone default now() not null,
  constraint store_mail_pkey PRIMARY KEY (store_id)
);
alter table public.store_mail enable row level security;

create table if not exists public.store_stripe (
  store_id uuid not null,
  account_id text not null,
  account_name text,
  livemode boolean not null,
  secret_key_enc text not null,
  publishable_key text not null,
  webhook_endpoint_id text,
  webhook_secret_enc text,
  apple_pay_domains text[] default '{}'::text[] not null,
  connected_at timestamp with time zone default now() not null,
  last_event_at timestamp with time zone,
  constraint store_stripe_pkey PRIMARY KEY (store_id)
);
alter table public.store_stripe enable row level security;

create table if not exists public.stores (
  id uuid default gen_random_uuid() not null,
  slug text not null,
  name text not null,
  domain text,
  support_email text not null,
  default_locale text default 'en'::text not null,
  guarantee_days integer default 7 not null,
  brand jsonb default '{}'::jsonb not null,
  meta_pixel_id text,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  display_name text,
  logo_url text,
  timezone text default 'America/Argentina/Buenos_Aires'::text not null,
  email_from text,
  legal_name text,
  legal_address text,
  statement_descriptor text,
  thankyou jsonb default '{}'::jsonb not null,
  delivery_email jsonb default '{}'::jsonb not null,
  meta_ad_account_id text,
  sales_webhook_url text,
  catalog_domain text,
  business jsonb default '{}'::jsonb not null,
  catalog_url text,
  stripe_pmc text,
  is_test boolean default false not null,
  library_domain text,
  constraint stores_pkey PRIMARY KEY (id),
  constraint stores_slug_key UNIQUE (slug)
);
alter table public.stores enable row level security;

create table if not exists public.stripe_balance_sync (
  store_id uuid not null,
  synced_until bigint default 0 not null,
  backfill_cursor text,
  backfill_done boolean default false not null,
  floor_at timestamp with time zone,
  synced_at timestamp with time zone,
  error text,
  constraint stripe_balance_sync_pkey PRIMARY KEY (store_id)
);
alter table public.stripe_balance_sync enable row level security;

create table if not exists public.stripe_balance_txns (
  store_id uuid not null,
  txn_id text not null,
  type text not null,
  reporting_category text,
  created_at timestamp with time zone not null,
  amount numeric(12,2) not null,
  fee numeric(12,2) not null,
  net numeric(12,2) not null,
  currency character(3) not null,
  source_id text,
  payment_intent text,
  buyer text,
  ext_order text,
  ext_store text,
  ext_post boolean,
  charge_amount numeric(12,2),
  charge_currency text,
  notified_at timestamp with time zone,
  constraint stripe_balance_txns_pkey PRIMARY KEY (store_id, txn_id)
);
alter table public.stripe_balance_txns enable row level security;

create table if not exists public.stripe_events (
  id text not null,
  store_id uuid,
  type text not null,
  received_at timestamp with time zone default now() not null,
  processed_at timestamp with time zone,
  error text,
  constraint stripe_events_pkey PRIMARY KEY (id)
);
alter table public.stripe_events enable row level security;

create table if not exists public.upsell_events (
  id uuid default gen_random_uuid() not null,
  store_id uuid not null,
  order_id uuid not null,
  pp_funnel_id uuid,
  product_id uuid,
  event text not null,
  created_at timestamp with time zone default now() not null,
  constraint upsell_events_pkey PRIMARY KEY (id),
  constraint upsell_events_order_id_product_id_event_key UNIQUE (order_id, product_id, event),
  constraint upsell_events_event_check CHECK ((event = ANY (ARRAY['view'::text, 'accept'::text, 'decline'::text, 'fail'::text])))
);
alter table public.upsell_events enable row level security;

create table if not exists public.uptime_checks (
  id bigint default nextval('uptime_checks_id_seq'::regclass) not null,
  target_id text not null,
  at timestamp with time zone default now() not null,
  request_id bigint,
  ok boolean,
  status integer,
  ms integer,
  error text,
  constraint uptime_checks_pkey PRIMARY KEY (id)
);
alter table public.uptime_checks enable row level security;

create table if not exists public.uptime_state (
  target_id text not null,
  down boolean default false not null,
  down_since timestamp with time zone,
  last_ok_at timestamp with time zone,
  last_check_at timestamp with time zone,
  last_notified_at timestamp with time zone,
  last_error text,
  constraint uptime_state_pkey PRIMARY KEY (target_id)
);
alter table public.uptime_state enable row level security;

create table if not exists public.uptime_targets (
  id text not null,
  label text not null,
  url text not null,
  expect text,
  active boolean default true not null,
  sort_order integer default 0 not null,
  auto boolean default false not null,
  kind text,
  name text,
  link text,
  store_id uuid,
  funnel_id uuid,
  constraint uptime_targets_pkey PRIMARY KEY (id)
);
alter table public.uptime_targets enable row level security;

-- Columnas que se agregaron después (si la tabla ya existía de una versión anterior del esquema).
alter table public.ad_creatives add column if not exists id uuid default gen_random_uuid() not null;
alter table public.ad_creatives add column if not exists offer_id uuid;
alter table public.ad_creatives add column if not exists funnel_id uuid;
alter table public.ad_creatives add column if not exists title text;
alter table public.ad_creatives add column if not exists kind text default 'video'::text not null;
alter table public.ad_creatives add column if not exists drive_file_id text;
alter table public.ad_creatives add column if not exists url text;
alter table public.ad_creatives add column if not exists thumbnail_url text;
alter table public.ad_creatives add column if not exists language text default ''::text not null;
alter table public.ad_creatives add column if not exists angle text;
alter table public.ad_creatives add column if not exists status text default 'borrador'::text not null;
alter table public.ad_creatives add column if not exists meta_ad_ids text[] default '{}'::text[] not null;
alter table public.ad_creatives add column if not exists notes text default ''::text not null;
alter table public.ad_creatives add column if not exists sort_order integer default 0 not null;
alter table public.ad_creatives add column if not exists created_at timestamp with time zone default now() not null;
alter table public.alerts add column if not exists id uuid default gen_random_uuid() not null;
alter table public.alerts add column if not exists store_id uuid;
alter table public.alerts add column if not exists kind text;
alter table public.alerts add column if not exists severity text default 'info'::text not null;
alter table public.alerts add column if not exists title text;
alter table public.alerts add column if not exists body text;
alter table public.alerts add column if not exists link text;
alter table public.alerts add column if not exists ref_id text;
alter table public.alerts add column if not exists created_at timestamp with time zone default now() not null;
alter table public.alerts add column if not exists resolved_at timestamp with time zone;
alter table public.api_tokens add column if not exists id uuid default gen_random_uuid() not null;
alter table public.api_tokens add column if not exists name text;
alter table public.api_tokens add column if not exists token_hash text;
alter table public.api_tokens add column if not exists last_used_at timestamp with time zone;
alter table public.api_tokens add column if not exists revoked_at timestamp with time zone;
alter table public.api_tokens add column if not exists created_at timestamp with time zone default now() not null;
alter table public.app_settings add column if not exists key text;
alter table public.app_settings add column if not exists value jsonb default '{}'::jsonb not null;
alter table public.app_settings add column if not exists updated_at timestamp with time zone default now() not null;
alter table public.bid_pilot_adsets add column if not exists adset_id text;
alter table public.bid_pilot_adsets add column if not exists campaign_id text;
alter table public.bid_pilot_adsets add column if not exists account_id text;
alter table public.bid_pilot_adsets add column if not exists name text;
alter table public.bid_pilot_adsets add column if not exists status text;
alter table public.bid_pilot_adsets add column if not exists bid numeric(10,2);
alter table public.bid_pilot_adsets add column if not exists last_set_bid numeric(10,2);
alter table public.bid_pilot_adsets add column if not exists last_change_at timestamp with time zone;
alter table public.bid_pilot_adsets add column if not exists last_change_reason text;
alter table public.bid_pilot_adsets add column if not exists last_raise_at timestamp with time zone;
alter table public.bid_pilot_adsets add column if not exists last_lower_at timestamp with time zone;
alter table public.bid_pilot_adsets add column if not exists manual_until timestamp with time zone;
alter table public.bid_pilot_adsets add column if not exists first_seen_at timestamp with time zone default now() not null;
alter table public.bid_pilot_adsets add column if not exists spend_12h numeric(12,2);
alter table public.bid_pilot_adsets add column if not exists spend_24h numeric(12,2);
alter table public.bid_pilot_adsets add column if not exists purchases_24h numeric(10,2);
alter table public.bid_pilot_adsets add column if not exists spend_72h numeric(12,2);
alter table public.bid_pilot_adsets add column if not exists purchases_72h numeric(10,2);
alter table public.bid_pilot_adsets add column if not exists state text;
alter table public.bid_pilot_adsets add column if not exists reason text;
alter table public.bid_pilot_adsets add column if not exists updated_at timestamp with time zone default now() not null;
alter table public.bid_pilot_adsets add column if not exists ladder boolean default false not null;
alter table public.bid_pilot_adsets add column if not exists ladder_pct numeric(4,2);
alter table public.bid_pilot_campaigns add column if not exists campaign_id text;
alter table public.bid_pilot_campaigns add column if not exists account_id text;
alter table public.bid_pilot_campaigns add column if not exists name text;
alter table public.bid_pilot_campaigns add column if not exists enabled boolean default true not null;
alter table public.bid_pilot_campaigns add column if not exists target_cpa numeric(10,2);
alter table public.bid_pilot_campaigns add column if not exists max_bid numeric(10,2);
alter table public.bid_pilot_campaigns add column if not exists floor_bid numeric(10,2);
alter table public.bid_pilot_campaigns add column if not exists daily_budget numeric(12,2);
alter table public.bid_pilot_campaigns add column if not exists status text;
alter table public.bid_pilot_campaigns add column if not exists created_at timestamp with time zone default now() not null;
alter table public.bid_pilot_campaigns add column if not exists updated_at timestamp with time zone default now() not null;
alter table public.bid_pilot_campaigns add column if not exists max_manual boolean default false not null;
alter table public.bid_pilot_campaigns add column if not exists front_usd numeric(10,2);
alter table public.bid_pilot_campaigns add column if not exists front_label text;
alter table public.bid_pilot_campaigns add column if not exists front_funnel text;
alter table public.bid_pilot_campaigns add column if not exists front_via text;
alter table public.bid_pilot_campaigns add column if not exists cpa_alert text;
alter table public.bid_pilot_campaigns add column if not exists cpa_alert_at timestamp with time zone;
alter table public.bid_pilot_log add column if not exists id bigint default nextval('bid_pilot_log_id_seq'::regclass) not null;
alter table public.bid_pilot_log add column if not exists run_id uuid;
alter table public.bid_pilot_log add column if not exists at timestamp with time zone default now() not null;
alter table public.bid_pilot_log add column if not exists campaign_id text;
alter table public.bid_pilot_log add column if not exists adset_id text;
alter table public.bid_pilot_log add column if not exists campaign_name text;
alter table public.bid_pilot_log add column if not exists action text;
alter table public.bid_pilot_log add column if not exists rule text;
alter table public.bid_pilot_log add column if not exists bid_before numeric(10,2);
alter table public.bid_pilot_log add column if not exists bid_after numeric(10,2);
alter table public.bid_pilot_log add column if not exists applied boolean default false not null;
alter table public.bid_pilot_log add column if not exists confirmed_bid numeric(10,2);
alter table public.bid_pilot_log add column if not exists reason text;
alter table public.bid_pilot_log add column if not exists numbers jsonb default '{}'::jsonb not null;
alter table public.bid_pilot_runs add column if not exists id uuid default gen_random_uuid() not null;
alter table public.bid_pilot_runs add column if not exists at timestamp with time zone default now() not null;
alter table public.bid_pilot_runs add column if not exists dry_run boolean default false not null;
alter table public.bid_pilot_runs add column if not exists ok boolean default true not null;
alter table public.bid_pilot_runs add column if not exists skipped text;
alter table public.bid_pilot_runs add column if not exists error text;
alter table public.bid_pilot_runs add column if not exists changes integer default 0 not null;
alter table public.bid_pilot_runs add column if not exists ms integer;
alter table public.checkouts add column if not exists id uuid default gen_random_uuid() not null;
alter table public.checkouts add column if not exists store_id uuid;
alter table public.checkouts add column if not exists funnel_id uuid;
alter table public.checkouts add column if not exists stripe_payment_intent text;
alter table public.checkouts add column if not exists email text;
alter table public.checkouts add column if not exists name text;
alter table public.checkouts add column if not exists country character(2);
alter table public.checkouts add column if not exists locale text;
alter table public.checkouts add column if not exists currency character(3);
alter table public.checkouts add column if not exists amount numeric(10,2);
alter table public.checkouts add column if not exists bumps text[] default '{}'::text[] not null;
alter table public.checkouts add column if not exists utm jsonb default '{}'::jsonb not null;
alter table public.checkouts add column if not exists status text default 'open'::text not null;
alter table public.checkouts add column if not exists order_id uuid;
alter table public.checkouts add column if not exists recovery_sent_at timestamp with time zone;
alter table public.checkouts add column if not exists created_at timestamp with time zone default now() not null;
alter table public.checkouts add column if not exists updated_at timestamp with time zone default now() not null;
alter table public.checkouts add column if not exists tracking jsonb default '{}'::jsonb not null;
alter table public.checkouts add column if not exists recovery_pct integer;
alter table public.checkouts add column if not exists recovery_expires_at timestamp with time zone;
alter table public.checkouts add column if not exists recovery_email_log_id uuid;
alter table public.checkouts add column if not exists recovery_source text;
alter table public.checkouts add column if not exists recovery_skip text;
alter table public.checkouts add column if not exists recovered_order_id uuid;
alter table public.coach_recs add column if not exists id uuid default gen_random_uuid() not null;
alter table public.coach_recs add column if not exists run_id uuid;
alter table public.coach_recs add column if not exists created_at timestamp with time zone default now() not null;
alter table public.coach_recs add column if not exists kind text default 'mejora'::text not null;
alter table public.coach_recs add column if not exists offer_key text;
alter table public.coach_recs add column if not exists store_slug text;
alter table public.coach_recs add column if not exists fingerprint text;
alter table public.coach_recs add column if not exists area text;
alter table public.coach_recs add column if not exists severity text;
alter table public.coach_recs add column if not exists title text;
alter table public.coach_recs add column if not exists weak text;
alter table public.coach_recs add column if not exists why text;
alter table public.coach_recs add column if not exists change text;
alter table public.coach_recs add column if not exists prompt text;
alter table public.coach_recs add column if not exists impact_usd_week numeric(12,2);
alter table public.coach_recs add column if not exists evidence jsonb;
alter table public.coach_recs add column if not exists checks jsonb;
alter table public.coach_recs add column if not exists sort integer default 0 not null;
alter table public.coach_recs add column if not exists status text default 'nueva'::text not null;
alter table public.coach_recs add column if not exists status_at timestamp with time zone;
alter table public.coach_runs add column if not exists id uuid default gen_random_uuid() not null;
alter table public.coach_runs add column if not exists created_at timestamp with time zone default now() not null;
alter table public.coach_runs add column if not exists finished_at timestamp with time zone;
alter table public.coach_runs add column if not exists status text default 'running'::text not null;
alter table public.coach_runs add column if not exists trigger text default 'cron'::text not null;
alter table public.coach_runs add column if not exists since date;
alter table public.coach_runs add column if not exists until date;
alter table public.coach_runs add column if not exists prev_since date;
alter table public.coach_runs add column if not exists prev_until date;
alter table public.coach_runs add column if not exists facts jsonb;
alter table public.coach_runs add column if not exists summary text;
alter table public.coach_runs add column if not exists model text;
alter table public.coach_runs add column if not exists ai_calls integer default 0 not null;
alter table public.coach_runs add column if not exists error text;
alter table public.coach_runs add column if not exists ms integer;
alter table public.delivery_mirror add column if not exists drive_id text;
alter table public.delivery_mirror add column if not exists path text;
alter table public.delivery_mirror add column if not exists name text;
alter table public.delivery_mirror add column if not exists bytes bigint;
alter table public.delivery_mirror add column if not exists created_at timestamp with time zone default now() not null;
alter table public.downloads add column if not exists id bigint default nextval('downloads_id_seq'::regclass) not null;
alter table public.downloads add column if not exists order_id uuid;
alter table public.downloads add column if not exists product_id uuid;
alter table public.downloads add column if not exists ip text;
alter table public.downloads add column if not exists at timestamp with time zone default now() not null;
alter table public.email_events add column if not exists id bigint default nextval('email_events_id_seq'::regclass) not null;
alter table public.email_events add column if not exists email_log_id uuid;
alter table public.email_events add column if not exists kind text;
alter table public.email_events add column if not exists url text;
alter table public.email_events add column if not exists ip text;
alter table public.email_events add column if not exists ua text;
alter table public.email_events add column if not exists at timestamp with time zone default now() not null;
alter table public.email_log add column if not exists id uuid default gen_random_uuid() not null;
alter table public.email_log add column if not exists store_id uuid;
alter table public.email_log add column if not exists order_id uuid;
alter table public.email_log add column if not exists kind text;
alter table public.email_log add column if not exists to_email text;
alter table public.email_log add column if not exists provider text;
alter table public.email_log add column if not exists provider_id text;
alter table public.email_log add column if not exists status text;
alter table public.email_log add column if not exists error text;
alter table public.email_log add column if not exists created_at timestamp with time zone default now() not null;
alter table public.email_log add column if not exists subject text;
alter table public.email_log add column if not exists tracked boolean default false not null;
alter table public.email_log add column if not exists opened_at timestamp with time zone;
alter table public.email_log add column if not exists open_count integer default 0 not null;
alter table public.email_log add column if not exists clicked_at timestamp with time zone;
alter table public.email_log add column if not exists click_count integer default 0 not null;
alter table public.email_log add column if not exists downloaded_at timestamp with time zone;
alter table public.email_log add column if not exists bounced_at timestamp with time zone;
alter table public.email_log add column if not exists bounce_reason text;
alter table public.email_log add column if not exists ai boolean default false not null;
alter table public.email_log add column if not exists body_html text;
alter table public.funnel_items add column if not exists id uuid default gen_random_uuid() not null;
alter table public.funnel_items add column if not exists funnel_id uuid;
alter table public.funnel_items add column if not exists product_id uuid;
alter table public.funnel_items add column if not exists role text;
alter table public.funnel_items add column if not exists sort_order integer default 0 not null;
alter table public.funnels add column if not exists id uuid default gen_random_uuid() not null;
alter table public.funnels add column if not exists store_id uuid;
alter table public.funnels add column if not exists slug text;
alter table public.funnels add column if not exists name text;
alter table public.funnels add column if not exists main_product_id uuid;
alter table public.funnels add column if not exists active boolean default true not null;
alter table public.funnels add column if not exists sort_order integer default 0 not null;
alter table public.funnels add column if not exists created_at timestamp with time zone default now() not null;
alter table public.funnels add column if not exists updated_at timestamp with time zone default now() not null;
alter table public.funnels add column if not exists pixel_ids uuid[] default '{}'::uuid[] not null;
alter table public.funnels add column if not exists settings jsonb default '{}'::jsonb not null;
alter table public.funnels add column if not exists offer_id uuid;
alter table public.funnels add column if not exists market_label text default ''::text not null;
alter table public.funnels add column if not exists landing_url text;
alter table public.funnels add column if not exists meta_campaign_ids text[] default '{}'::text[] not null;
alter table public.funnels add column if not exists checkout_host text;
alter table public.funnels add column if not exists checkout_path text;
alter table public.funnels add column if not exists meta_campaign_auto text[] default '{}'::text[] not null;
alter table public.funnels add column if not exists record_sessions boolean default true not null;
alter table public.inbox_messages add column if not exists id uuid default gen_random_uuid() not null;
alter table public.inbox_messages add column if not exists store_id uuid;
alter table public.inbox_messages add column if not exists mailbox text default 'INBOX'::text not null;
alter table public.inbox_messages add column if not exists uid bigint;
alter table public.inbox_messages add column if not exists direction text default 'in'::text not null;
alter table public.inbox_messages add column if not exists message_id text;
alter table public.inbox_messages add column if not exists in_reply_to text;
alter table public.inbox_messages add column if not exists refs text;
alter table public.inbox_messages add column if not exists from_email text;
alter table public.inbox_messages add column if not exists from_name text;
alter table public.inbox_messages add column if not exists to_email text;
alter table public.inbox_messages add column if not exists subject text;
alter table public.inbox_messages add column if not exists date timestamp with time zone;
alter table public.inbox_messages add column if not exists text text;
alter table public.inbox_messages add column if not exists html text;
alter table public.inbox_messages add column if not exists is_bounce boolean default false not null;
alter table public.inbox_messages add column if not exists email_log_id uuid;
alter table public.inbox_messages add column if not exists order_id uuid;
alter table public.inbox_messages add column if not exists read_at timestamp with time zone;
alter table public.inbox_messages add column if not exists replied_at timestamp with time zone;
alter table public.inbox_messages add column if not exists created_at timestamp with time zone default now() not null;
alter table public.inbox_messages add column if not exists reply_to text;
alter table public.inbox_messages add column if not exists attachments jsonb default '[]'::jsonb not null;
alter table public.inbox_messages add column if not exists ai boolean default false not null;
alter table public.inbox_messages add column if not exists automated boolean default false not null;
alter table public.inbox_messages add column if not exists ai_draft jsonb;
alter table public.inbox_messages add column if not exists ai_pilot_at timestamp with time zone;
alter table public.inbox_messages add column if not exists money_pushed_at timestamp with time zone;
alter table public.inbox_messages add column if not exists mail_push_due_at timestamp with time zone;
alter table public.inbox_messages add column if not exists mail_pushed_at timestamp with time zone;
alter table public.inbox_messages add column if not exists ai_auto_due_at timestamp with time zone;
alter table public.inbox_messages add column if not exists ai_auto_done_at timestamp with time zone;
alter table public.inbox_sync_state add column if not exists store_id uuid;
alter table public.inbox_sync_state add column if not exists mailbox text default 'INBOX'::text not null;
alter table public.inbox_sync_state add column if not exists uid_validity text;
alter table public.inbox_sync_state add column if not exists last_uid bigint default 0 not null;
alter table public.inbox_sync_state add column if not exists synced_at timestamp with time zone;
alter table public.inbox_sync_state add column if not exists error text;
alter table public.library_grants add column if not exists id uuid default gen_random_uuid() not null;
alter table public.library_grants add column if not exists store_id uuid;
alter table public.library_grants add column if not exists email text;
alter table public.library_grants add column if not exists product_id uuid;
alter table public.library_grants add column if not exists created_at timestamp with time zone default now() not null;
alter table public.login_attempts add column if not exists id bigint default nextval('login_attempts_id_seq'::regclass) not null;
alter table public.login_attempts add column if not exists ip text;
alter table public.login_attempts add column if not exists ok boolean;
alter table public.login_attempts add column if not exists at timestamp with time zone default now() not null;
alter table public.mail_unsubscribes add column if not exists store_id uuid;
alter table public.mail_unsubscribes add column if not exists email text;
alter table public.mail_unsubscribes add column if not exists source text;
alter table public.mail_unsubscribes add column if not exists created_at timestamp with time zone default now() not null;
alter table public.markets add column if not exists id uuid default gen_random_uuid() not null;
alter table public.markets add column if not exists store_id uuid;
alter table public.markets add column if not exists name text;
alter table public.markets add column if not exists currency character(3);
alter table public.markets add column if not exists countries text[] default '{}'::text[] not null;
alter table public.markets add column if not exists is_default boolean default false not null;
alter table public.markets add column if not exists created_at timestamp with time zone default now() not null;
alter table public.mcp_audit add column if not exists id uuid default gen_random_uuid() not null;
alter table public.mcp_audit add column if not exists tool text;
alter table public.mcp_audit add column if not exists args jsonb default '{}'::jsonb not null;
alter table public.mcp_audit add column if not exists result_summary text;
alter table public.mcp_audit add column if not exists ok boolean default true not null;
alter table public.mcp_audit add column if not exists token_name text;
alter table public.mcp_audit add column if not exists created_at timestamp with time zone default now() not null;
alter table public.meta_auto_campaigns add column if not exists campaign_id text;
alter table public.meta_auto_campaigns add column if not exists account_id text;
alter table public.meta_auto_campaigns add column if not exists name text;
alter table public.meta_auto_campaigns add column if not exists cbo_guard boolean default true not null;
alter table public.meta_auto_campaigns add column if not exists status text;
alter table public.meta_auto_campaigns add column if not exists daily_budget numeric(12,2);
alter table public.meta_auto_campaigns add column if not exists last_eval_at timestamp with time zone;
alter table public.meta_auto_campaigns add column if not exists last_spend numeric(12,2);
alter table public.meta_auto_campaigns add column if not exists last_revenue numeric(12,2);
alter table public.meta_auto_campaigns add column if not exists last_roas numeric(10,3);
alter table public.meta_auto_campaigns add column if not exists last_source text;
alter table public.meta_auto_campaigns add column if not exists last_days_run integer;
alter table public.meta_auto_campaigns add column if not exists last_verdict text;
alter table public.meta_auto_campaigns add column if not exists last_reason text;
alter table public.meta_auto_campaigns add column if not exists last_auto_pause_at timestamp with time zone;
alter table public.meta_auto_campaigns add column if not exists created_at timestamp with time zone default now() not null;
alter table public.meta_auto_campaigns add column if not exists updated_at timestamp with time zone default now() not null;
alter table public.meta_auto_log add column if not exists id bigint default nextval('meta_auto_log_id_seq'::regclass) not null;
alter table public.meta_auto_log add column if not exists at timestamp with time zone default now() not null;
alter table public.meta_auto_log add column if not exists kind text;
alter table public.meta_auto_log add column if not exists account_id text;
alter table public.meta_auto_log add column if not exists campaign_id text;
alter table public.meta_auto_log add column if not exists campaign_name text;
alter table public.meta_auto_log add column if not exists ad_id text;
alter table public.meta_auto_log add column if not exists title text;
alter table public.meta_auto_log add column if not exists body text;
alter table public.meta_auto_log add column if not exists link text;
alter table public.meta_auto_log add column if not exists numbers jsonb default '{}'::jsonb not null;
alter table public.meta_auto_runs add column if not exists id uuid default gen_random_uuid() not null;
alter table public.meta_auto_runs add column if not exists at timestamp with time zone default now() not null;
alter table public.meta_auto_runs add column if not exists ok boolean default true not null;
alter table public.meta_auto_runs add column if not exists skipped text;
alter table public.meta_auto_runs add column if not exists error text;
alter table public.meta_auto_runs add column if not exists paused integer default 0 not null;
alter table public.meta_auto_runs add column if not exists proposed integer default 0 not null;
alter table public.meta_auto_runs add column if not exists ms integer;
alter table public.meta_auto_winners add column if not exists ad_id text;
alter table public.meta_auto_winners add column if not exists account_id text;
alter table public.meta_auto_winners add column if not exists campaign_id text;
alter table public.meta_auto_winners add column if not exists campaign_name text;
alter table public.meta_auto_winners add column if not exists adset_id text;
alter table public.meta_auto_winners add column if not exists ad_name text;
alter table public.meta_auto_winners add column if not exists status text default 'proposed'::text not null;
alter table public.meta_auto_winners add column if not exists proposed_at timestamp with time zone default now() not null;
alter table public.meta_auto_winners add column if not exists expires_at timestamp with time zone;
alter table public.meta_auto_winners add column if not exists spend numeric(12,2);
alter table public.meta_auto_winners add column if not exists purchases numeric(10,2);
alter table public.meta_auto_winners add column if not exists cpa numeric(10,2);
alter table public.meta_auto_winners add column if not exists target numeric(10,2);
alter table public.meta_auto_winners add column if not exists days_run integer;
alter table public.meta_auto_winners add column if not exists window_since date;
alter table public.meta_auto_winners add column if not exists window_until date;
alter table public.meta_auto_winners add column if not exists new_name text;
alter table public.meta_auto_winners add column if not exists new_campaign_id text;
alter table public.meta_auto_winners add column if not exists new_adset_id text;
alter table public.meta_auto_winners add column if not exists new_ad_id text;
alter table public.meta_auto_winners add column if not exists new_creative_id text;
alter table public.meta_auto_winners add column if not exists error text;
alter table public.meta_auto_winners add column if not exists decided_at timestamp with time zone;
alter table public.meta_auto_winners add column if not exists updated_at timestamp with time zone default now() not null;
alter table public.meta_insights_daily add column if not exists account_id text;
alter table public.meta_insights_daily add column if not exists date date;
alter table public.meta_insights_daily add column if not exists level text;
alter table public.meta_insights_daily add column if not exists campaign_id text;
alter table public.meta_insights_daily add column if not exists campaign_name text;
alter table public.meta_insights_daily add column if not exists adset_id text;
alter table public.meta_insights_daily add column if not exists adset_name text;
alter table public.meta_insights_daily add column if not exists ad_id text;
alter table public.meta_insights_daily add column if not exists ad_name text;
alter table public.meta_insights_daily add column if not exists status text;
alter table public.meta_insights_daily add column if not exists effective_status text;
alter table public.meta_insights_daily add column if not exists daily_budget numeric;
alter table public.meta_insights_daily add column if not exists spend numeric default 0 not null;
alter table public.meta_insights_daily add column if not exists impressions bigint default 0 not null;
alter table public.meta_insights_daily add column if not exists clicks bigint default 0 not null;
alter table public.meta_insights_daily add column if not exists inline_link_clicks bigint default 0 not null;
alter table public.meta_insights_daily add column if not exists purchases numeric default 0 not null;
alter table public.meta_insights_daily add column if not exists purchase_value numeric default 0 not null;
alter table public.meta_insights_daily add column if not exists video_3s_views bigint default 0 not null;
alter table public.meta_insights_daily add column if not exists thruplays bigint default 0 not null;
alter table public.meta_insights_daily add column if not exists updated_at timestamp with time zone default now() not null;
alter table public.meta_insights_daily add column if not exists initiate_checkout numeric default 0 not null;
alter table public.meta_insights_daily add column if not exists landing_page_views numeric default 0 not null;
alter table public.meta_objects add column if not exists level text;
alter table public.meta_objects add column if not exists id text;
alter table public.meta_objects add column if not exists account_id text;
alter table public.meta_objects add column if not exists name text;
alter table public.meta_objects add column if not exists status text;
alter table public.meta_objects add column if not exists effective_status text;
alter table public.meta_objects add column if not exists campaign_id text;
alter table public.meta_objects add column if not exists adset_id text;
alter table public.meta_objects add column if not exists daily_budget numeric;
alter table public.meta_objects add column if not exists lifetime_budget numeric;
alter table public.meta_objects add column if not exists thumb text;
alter table public.meta_objects add column if not exists video_id text;
alter table public.meta_objects add column if not exists links text[] default '{}'::text[] not null;
alter table public.meta_objects add column if not exists updated_at timestamp with time zone default now() not null;
alter table public.meta_objects add column if not exists start_time timestamp with time zone;
alter table public.meta_objects add column if not exists created_time timestamp with time zone;
alter table public.meta_objects add column if not exists details jsonb;
alter table public.meta_objects add column if not exists details_at timestamp with time zone;
alter table public.meta_objects add column if not exists bid_amount numeric;
alter table public.meta_objects add column if not exists bid_strategy text;
alter table public.meta_platform_daily add column if not exists account_id text;
alter table public.meta_platform_daily add column if not exists date date;
alter table public.meta_platform_daily add column if not exists campaign_id text;
alter table public.meta_platform_daily add column if not exists platform text;
alter table public.meta_platform_daily add column if not exists spend numeric(14,2) default 0 not null;
alter table public.meta_platform_daily add column if not exists impressions bigint default 0 not null;
alter table public.meta_platform_daily add column if not exists link_clicks bigint default 0 not null;
alter table public.meta_platform_daily add column if not exists purchases numeric(12,2) default 0 not null;
alter table public.meta_platform_daily add column if not exists purchase_value numeric(14,2) default 0 not null;
alter table public.meta_platform_daily add column if not exists updated_at timestamp with time zone default now() not null;
alter table public.meta_platform_sync add column if not exists account_id text;
alter table public.meta_platform_sync add column if not exists backfilled_from date;
alter table public.meta_platform_sync add column if not exists updated_at timestamp with time zone default now() not null;
alter table public.meta_snapshots add column if not exists key text;
alter table public.meta_snapshots add column if not exists account text;
alter table public.meta_snapshots add column if not exists data jsonb;
alter table public.meta_snapshots add column if not exists fetched_at timestamp with time zone;
alter table public.meta_snapshots add column if not exists last_error text;
alter table public.meta_snapshots add column if not exists error_at timestamp with time zone;
alter table public.meta_snapshots add column if not exists retry_at timestamp with time zone;
alter table public.meta_snapshots add column if not exists fails integer default 0 not null;
alter table public.meta_snapshots add column if not exists updated_at timestamp with time zone default now() not null;
alter table public.meta_sync add column if not exists account_id text;
alter table public.meta_sync add column if not exists name text;
alter table public.meta_sync add column if not exists currency text;
alter table public.meta_sync add column if not exists timezone text;
alter table public.meta_sync add column if not exists last_ok_at timestamp with time zone;
alter table public.meta_sync add column if not exists last_error text;
alter table public.meta_sync add column if not exists error_at timestamp with time zone;
alter table public.meta_sync add column if not exists retry_at timestamp with time zone;
alter table public.meta_sync add column if not exists fails integer default 0 not null;
alter table public.meta_sync add column if not exists running_until timestamp with time zone;
alter table public.meta_sync add column if not exists backfilled_from date;
alter table public.meta_sync add column if not exists ads_at timestamp with time zone;
alter table public.meta_sync add column if not exists rows_written integer;
alter table public.meta_sync add column if not exists took_ms integer;
alter table public.meta_sync add column if not exists updated_at timestamp with time zone default now() not null;
alter table public.mkt_campaigns add column if not exists id uuid default gen_random_uuid() not null;
alter table public.mkt_campaigns add column if not exists store_id uuid;
alter table public.mkt_campaigns add column if not exists kind text default 'broadcast'::text not null;
alter table public.mkt_campaigns add column if not exists flow_id uuid;
alter table public.mkt_campaigns add column if not exists name text;
alter table public.mkt_campaigns add column if not exists status text default 'draft'::text not null;
alter table public.mkt_campaigns add column if not exists segment_id uuid;
alter table public.mkt_campaigns add column if not exists segment jsonb default '{}'::jsonb not null;
alter table public.mkt_campaigns add column if not exists versions jsonb default '{}'::jsonb not null;
alter table public.mkt_campaigns add column if not exists fallback_locale text;
alter table public.mkt_campaigns add column if not exists goal text;
alter table public.mkt_campaigns add column if not exists discount_pct integer;
alter table public.mkt_campaigns add column if not exists discount_hours integer default 72 not null;
alter table public.mkt_campaigns add column if not exists discount_expires_at timestamp with time zone;
alter table public.mkt_campaigns add column if not exists discount_revoked_at timestamp with time zone;
alter table public.mkt_campaigns add column if not exists scheduled_at timestamp with time zone;
alter table public.mkt_campaigns add column if not exists confirmed_at timestamp with time zone;
alter table public.mkt_campaigns add column if not exists started_at timestamp with time zone;
alter table public.mkt_campaigns add column if not exists finished_at timestamp with time zone;
alter table public.mkt_campaigns add column if not exists total integer default 0 not null;
alter table public.mkt_campaigns add column if not exists last_error text;
alter table public.mkt_campaigns add column if not exists finish_pushed_at timestamp with time zone;
alter table public.mkt_campaigns add column if not exists results_pushed_at timestamp with time zone;
alter table public.mkt_campaigns add column if not exists created_via text default 'panel'::text not null;
alter table public.mkt_campaigns add column if not exists created_at timestamp with time zone default now() not null;
alter table public.mkt_campaigns add column if not exists updated_at timestamp with time zone default now() not null;
alter table public.mkt_contacts add column if not exists id uuid default gen_random_uuid() not null;
alter table public.mkt_contacts add column if not exists store_id uuid;
alter table public.mkt_contacts add column if not exists email text;
alter table public.mkt_contacts add column if not exists name text;
alter table public.mkt_contacts add column if not exists locale text;
alter table public.mkt_contacts add column if not exists country text;
alter table public.mkt_contacts add column if not exists kind text default 'buyer'::text not null;
alter table public.mkt_contacts add column if not exists source text default 'app'::text not null;
alter table public.mkt_contacts add column if not exists status text default 'subscribed'::text not null;
alter table public.mkt_contacts add column if not exists status_at timestamp with time zone;
alter table public.mkt_contacts add column if not exists status_reason text;
alter table public.mkt_contacts add column if not exists marketing_ok boolean default true not null;
alter table public.mkt_contacts add column if not exists first_purchase_at timestamp with time zone;
alter table public.mkt_contacts add column if not exists last_purchase_at timestamp with time zone;
alter table public.mkt_contacts add column if not exists orders_count integer default 0 not null;
alter table public.mkt_contacts add column if not exists spent_usd numeric(12,2) default 0 not null;
alter table public.mkt_contacts add column if not exists products uuid[] default '{}'::uuid[] not null;
alter table public.mkt_contacts add column if not exists offers uuid[] default '{}'::uuid[] not null;
alter table public.mkt_contacts add column if not exists categories text[] default '{}'::text[] not null;
alter table public.mkt_contacts add column if not exists markets text[] default '{}'::text[] not null;
alter table public.mkt_contacts add column if not exists refunded boolean default false not null;
alter table public.mkt_contacts add column if not exists disputed boolean default false not null;
alter table public.mkt_contacts add column if not exists imp_products uuid[] default '{}'::uuid[] not null;
alter table public.mkt_contacts add column if not exists imp_names text[] default '{}'::text[] not null;
alter table public.mkt_contacts add column if not exists imp_first_at timestamp with time zone;
alter table public.mkt_contacts add column if not exists imp_last_at timestamp with time zone;
alter table public.mkt_contacts add column if not exists imp_orders integer default 0 not null;
alter table public.mkt_contacts add column if not exists imp_spent_usd numeric(12,2) default 0 not null;
alter table public.mkt_contacts add column if not exists imp_refunded boolean default false not null;
alter table public.mkt_contacts add column if not exists last_sent_at timestamp with time zone;
alter table public.mkt_contacts add column if not exists created_at timestamp with time zone default now() not null;
alter table public.mkt_contacts add column if not exists updated_at timestamp with time zone default now() not null;
alter table public.mkt_events add column if not exists id bigint default nextval('mkt_events_id_seq'::regclass) not null;
alter table public.mkt_events add column if not exists send_id uuid;
alter table public.mkt_events add column if not exists kind text;
alter table public.mkt_events add column if not exists url text;
alter table public.mkt_events add column if not exists ip text;
alter table public.mkt_events add column if not exists ua text;
alter table public.mkt_events add column if not exists detail text;
alter table public.mkt_events add column if not exists at timestamp with time zone default now() not null;
alter table public.mkt_import_orders add column if not exists store_id uuid;
alter table public.mkt_import_orders add column if not exists ref text;
alter table public.mkt_import_orders add column if not exists email text;
alter table public.mkt_import_orders add column if not exists name text;
alter table public.mkt_import_orders add column if not exists country text;
alter table public.mkt_import_orders add column if not exists locale text;
alter table public.mkt_import_orders add column if not exists ordered_at timestamp with time zone;
alter table public.mkt_import_orders add column if not exists names text[] default '{}'::text[] not null;
alter table public.mkt_import_orders add column if not exists products uuid[] default '{}'::uuid[] not null;
alter table public.mkt_import_orders add column if not exists total numeric(12,2);
alter table public.mkt_import_orders add column if not exists currency text;
alter table public.mkt_import_orders add column if not exists usd numeric(12,2) default 0 not null;
alter table public.mkt_import_orders add column if not exists status text default 'paid'::text not null;
alter table public.mkt_import_orders add column if not exists import_id uuid;
alter table public.mkt_import_orders add column if not exists created_at timestamp with time zone default now() not null;
alter table public.mkt_imports add column if not exists id uuid default gen_random_uuid() not null;
alter table public.mkt_imports add column if not exists store_id uuid;
alter table public.mkt_imports add column if not exists file_name text;
alter table public.mkt_imports add column if not exists rows integer default 0 not null;
alter table public.mkt_imports add column if not exists contacts integer default 0 not null;
alter table public.mkt_imports add column if not exists created integer default 0 not null;
alter table public.mkt_imports add column if not exists updated integer default 0 not null;
alter table public.mkt_imports add column if not exists skipped integer default 0 not null;
alter table public.mkt_imports add column if not exists mapping jsonb;
alter table public.mkt_imports add column if not exists created_at timestamp with time zone default now() not null;
alter table public.mkt_segments add column if not exists id uuid default gen_random_uuid() not null;
alter table public.mkt_segments add column if not exists store_id uuid;
alter table public.mkt_segments add column if not exists name text;
alter table public.mkt_segments add column if not exists filters jsonb default '{}'::jsonb not null;
alter table public.mkt_segments add column if not exists created_at timestamp with time zone default now() not null;
alter table public.mkt_segments add column if not exists updated_at timestamp with time zone default now() not null;
alter table public.mkt_sends add column if not exists id uuid default gen_random_uuid() not null;
alter table public.mkt_sends add column if not exists campaign_id uuid;
alter table public.mkt_sends add column if not exists store_id uuid;
alter table public.mkt_sends add column if not exists contact_id uuid;
alter table public.mkt_sends add column if not exists email text;
alter table public.mkt_sends add column if not exists locale text;
alter table public.mkt_sends add column if not exists is_test boolean default false not null;
alter table public.mkt_sends add column if not exists status text default 'queued'::text not null;
alter table public.mkt_sends add column if not exists attempts integer default 0 not null;
alter table public.mkt_sends add column if not exists claimed_at timestamp with time zone;
alter table public.mkt_sends add column if not exists error text;
alter table public.mkt_sends add column if not exists provider_id text;
alter table public.mkt_sends add column if not exists subject text;
alter table public.mkt_sends add column if not exists sent_at timestamp with time zone;
alter table public.mkt_sends add column if not exists delivered_at timestamp with time zone;
alter table public.mkt_sends add column if not exists opened_at timestamp with time zone;
alter table public.mkt_sends add column if not exists open_count integer default 0 not null;
alter table public.mkt_sends add column if not exists clicked_at timestamp with time zone;
alter table public.mkt_sends add column if not exists click_count integer default 0 not null;
alter table public.mkt_sends add column if not exists bounced_at timestamp with time zone;
alter table public.mkt_sends add column if not exists bounce_type text;
alter table public.mkt_sends add column if not exists complained_at timestamp with time zone;
alter table public.mkt_sends add column if not exists unsubscribed_at timestamp with time zone;
alter table public.mkt_sends add column if not exists created_at timestamp with time zone default now() not null;
alter table public.mkt_store_settings add column if not exists store_id uuid;
alter table public.mkt_store_settings add column if not exists from_email text;
alter table public.mkt_store_settings add column if not exists reply_to text;
alter table public.mkt_store_settings add column if not exists synced_at timestamp with time zone;
alter table public.mkt_store_settings add column if not exists updated_at timestamp with time zone default now() not null;
alter table public.offer_tasks add column if not exists id uuid default gen_random_uuid() not null;
alter table public.offer_tasks add column if not exists offer_id uuid;
alter table public.offer_tasks add column if not exists text text;
alter table public.offer_tasks add column if not exists done boolean default false not null;
alter table public.offer_tasks add column if not exists created_at timestamp with time zone default now() not null;
alter table public.offer_tasks add column if not exists done_at timestamp with time zone;
alter table public.offers add column if not exists id uuid default gen_random_uuid() not null;
alter table public.offers add column if not exists store_id uuid;
alter table public.offers add column if not exists slug text;
alter table public.offers add column if not exists name text;
alter table public.offers add column if not exists image_url text;
alter table public.offers add column if not exists notes text default ''::text not null;
alter table public.offers add column if not exists active boolean default true not null;
alter table public.offers add column if not exists sort_order integer default 0 not null;
alter table public.offers add column if not exists created_at timestamp with time zone default now() not null;
alter table public.offers add column if not exists updated_at timestamp with time zone default now() not null;
alter table public.offers add column if not exists ads_folder_url text;
alter table public.offers add column if not exists category text;
alter table public.order_items add column if not exists id uuid default gen_random_uuid() not null;
alter table public.order_items add column if not exists order_id uuid;
alter table public.order_items add column if not exists product_id uuid;
alter table public.order_items add column if not exists kind text;
alter table public.order_items add column if not exists amount numeric(10,2) default 0 not null;
alter table public.order_items add column if not exists currency character(3);
alter table public.order_items add column if not exists stripe_payment_intent text;
alter table public.order_items add column if not exists created_at timestamp with time zone default now() not null;
alter table public.order_items add column if not exists refunded_amount numeric(10,2) default 0 not null;
alter table public.orders add column if not exists id uuid default gen_random_uuid() not null;
alter table public.orders add column if not exists store_id uuid;
alter table public.orders add column if not exists funnel_id uuid;
alter table public.orders add column if not exists stripe_session_id text;
alter table public.orders add column if not exists stripe_payment_intent text;
alter table public.orders add column if not exists stripe_customer text;
alter table public.orders add column if not exists email text;
alter table public.orders add column if not exists name text;
alter table public.orders add column if not exists phone text;
alter table public.orders add column if not exists country character(2);
alter table public.orders add column if not exists locale text;
alter table public.orders add column if not exists currency character(3);
alter table public.orders add column if not exists amount_total numeric(10,2);
alter table public.orders add column if not exists status text default 'pending'::text not null;
alter table public.orders add column if not exists delivered_at timestamp with time zone;
alter table public.orders add column if not exists created_at timestamp with time zone default now() not null;
alter table public.orders add column if not exists updated_at timestamp with time zone default now() not null;
alter table public.orders add column if not exists fulfill_claimed_at timestamp with time zone;
alter table public.orders add column if not exists pp_funnel_id uuid;
alter table public.orders add column if not exists utm jsonb default '{}'::jsonb not null;
alter table public.orders add column if not exists refunded_at timestamp with time zone;
alter table public.orders add column if not exists amount_refunded numeric(10,2) default 0 not null;
alter table public.orders add column if not exists delivery_attempts integer default 0 not null;
alter table public.orders add column if not exists delivery_error text;
alter table public.orders add column if not exists capi_sent_at timestamp with time zone;
alter table public.orders add column if not exists tracking jsonb default '{}'::jsonb not null;
alter table public.orders add column if not exists consents jsonb default '{}'::jsonb not null;
alter table public.orders add column if not exists sale_pushed_at timestamp with time zone;
alter table public.orders add column if not exists recovered_from uuid;
alter table public.orders add column if not exists discount jsonb;
alter table public.orders add column if not exists number bigint;
alter table public.orders add column if not exists is_test boolean default false not null;
alter table public.orders add column if not exists sale_push_due_at timestamp with time zone;
alter table public.partners add column if not exists email text;
alter table public.partners add column if not exists name text default ''::text not null;
alter table public.partners add column if not exists password_hash text;
alter table public.partners add column if not exists offer_ids uuid[] default '{}'::uuid[] not null;
alter table public.partners add column if not exists active boolean default true not null;
alter table public.partners add column if not exists created_at timestamp with time zone default now() not null;
alter table public.partners add column if not exists last_login_at timestamp with time zone;
alter table public.partners add column if not exists mcp_token_hash text;
alter table public.partners add column if not exists mcp_token_hint text;
alter table public.pi_rate add column if not exists ip text;
alter table public.pi_rate add column if not exists at timestamp with time zone default now() not null;
alter table public.pixels add column if not exists id uuid default gen_random_uuid() not null;
alter table public.pixels add column if not exists store_id uuid;
alter table public.pixels add column if not exists pixel_id text;
alter table public.pixels add column if not exists name text default ''::text not null;
alter table public.pixels add column if not exists capi_token_enc text;
alter table public.pixels add column if not exists test_event_code text;
alter table public.pixels add column if not exists all_funnels boolean default false not null;
alter table public.pixels add column if not exists created_at timestamp with time zone default now() not null;
alter table public.pp_funnels add column if not exists id uuid default gen_random_uuid() not null;
alter table public.pp_funnels add column if not exists store_id uuid;
alter table public.pp_funnels add column if not exists checkout_funnel_id uuid;
alter table public.pp_funnels add column if not exists name text;
alter table public.pp_funnels add column if not exists trigger_product_ids uuid[];
alter table public.pp_funnels add column if not exists active boolean default true not null;
alter table public.pp_funnels add column if not exists reserve_minutes integer default 10 not null;
alter table public.pp_funnels add column if not exists auto_generated boolean default false not null;
alter table public.pp_funnels add column if not exists sort_order integer default 0 not null;
alter table public.pp_funnels add column if not exists created_at timestamp with time zone default now() not null;
alter table public.pp_steps add column if not exists id uuid default gen_random_uuid() not null;
alter table public.pp_steps add column if not exists pp_funnel_id uuid;
alter table public.pp_steps add column if not exists product_id uuid;
alter table public.pp_steps add column if not exists sort_order integer default 0 not null;
alter table public.pp_steps add column if not exists kind text default 'oto'::text not null;
alter table public.pp_steps add column if not exists downsell_of uuid;
alter table public.pp_steps add column if not exists show_if jsonb;
alter table public.pp_steps add column if not exists level smallint;
alter table public.presale_notices add column if not exists order_id uuid;
alter table public.presale_notices add column if not exists product_id uuid;
alter table public.presale_notices add column if not exists sent_at timestamp with time zone default now() not null;
alter table public.product_prices add column if not exists id uuid default gen_random_uuid() not null;
alter table public.product_prices add column if not exists product_id uuid;
alter table public.product_prices add column if not exists currency character(3);
alter table public.product_prices add column if not exists amount numeric(10,2);
alter table public.product_prices add column if not exists compare_at numeric(10,2);
alter table public.product_prices add column if not exists display_value numeric(10,2);
alter table public.product_prices add column if not exists stripe_price_id text;
alter table public.product_prices add column if not exists stripe_synced_at timestamp with time zone;
alter table public.products add column if not exists id uuid default gen_random_uuid() not null;
alter table public.products add column if not exists store_id uuid;
alter table public.products add column if not exists slug text;
alter table public.products add column if not exists name text;
alter table public.products add column if not exists short_name text;
alter table public.products add column if not exists description text default ''::text not null;
alter table public.products add column if not exists kind text default 'main'::text not null;
alter table public.products add column if not exists delivery_url text;
alter table public.products add column if not exists image_url text;
alter table public.products add column if not exists sort_order integer default 0 not null;
alter table public.products add column if not exists active boolean default true not null;
alter table public.products add column if not exists created_at timestamp with time zone default now() not null;
alter table public.products add column if not exists updated_at timestamp with time zone default now() not null;
alter table public.products add column if not exists updated_by_admin_at timestamp with time zone;
alter table public.products add column if not exists email_image_url text;
alter table public.products add column if not exists delivery_links jsonb default '[]'::jsonb not null;
alter table public.products add column if not exists show_in_catalog boolean default true not null;
alter table public.products add column if not exists postcompra_page jsonb default '{}'::jsonb not null;
alter table public.products add column if not exists delivery_file text;
alter table public.products add column if not exists delivery_file_name text;
alter table public.products add column if not exists postcompra_html text;
alter table public.products add column if not exists includes uuid[] default '{}'::uuid[] not null;
alter table public.products add column if not exists variant_of uuid;
alter table public.products add column if not exists book_count integer;
alter table public.products add column if not exists is_library boolean default false not null;
alter table public.products add column if not exists presale boolean default false not null;
alter table public.products add column if not exists presale_days integer default 3 not null;
alter table public.products add column if not exists presale_since timestamp with time zone;
alter table public.products add column if not exists content_ready_at timestamp with time zone;
alter table public.products add column if not exists ready_files jsonb;
alter table public.products add column if not exists presale_pages integer;
alter table public.products add column if not exists presale_outline text;
alter table public.products add column if not exists leftover_notices jsonb;
alter table public.products add column if not exists partner_email text;
alter table public.push_subscriptions add column if not exists id uuid default gen_random_uuid() not null;
alter table public.push_subscriptions add column if not exists endpoint text;
alter table public.push_subscriptions add column if not exists p256dh text;
alter table public.push_subscriptions add column if not exists auth text;
alter table public.push_subscriptions add column if not exists user_agent text;
alter table public.push_subscriptions add column if not exists device_label text;
alter table public.push_subscriptions add column if not exists kinds text[] default '{sale,alert,mail,refund,dispute,delivery,oto,unpaid,bid}'::text[] not null;
alter table public.push_subscriptions add column if not exists created_at timestamp with time zone default now() not null;
alter table public.push_subscriptions add column if not exists last_ok_at timestamp with time zone;
alter table public.push_subscriptions add column if not exists fail_count integer default 0 not null;
alter table public.push_subscriptions add column if not exists device_id text;
alter table public.push_subscriptions add column if not exists last_seen_at timestamp with time zone;
alter table public.push_subscriptions add column if not exists client jsonb;
alter table public.rec_chunks add column if not exists id bigint default nextval('rec_chunks_id_seq'::regclass) not null;
alter table public.rec_chunks add column if not exists at timestamp with time zone default now() not null;
alter table public.rec_chunks add column if not exists session_id text;
alter table public.rec_chunks add column if not exists pv text;
alter table public.rec_chunks add column if not exists seq integer;
alter table public.rec_chunks add column if not exists page text;
alter table public.rec_chunks add column if not exists path text;
alter table public.rec_chunks add column if not exists t0 bigint;
alter table public.rec_chunks add column if not exists t1 bigint;
alter table public.rec_chunks add column if not exists n integer;
alter table public.rec_chunks add column if not exists bytes integer;
alter table public.rec_chunks add column if not exists gz bytea;
alter table public.rec_daily add column if not exists day date;
alter table public.rec_daily add column if not exists bytes bigint default 0 not null;
alter table public.rec_daily add column if not exists sessions integer default 0 not null;
alter table public.rec_sessions add column if not exists session_id text;
alter table public.rec_sessions add column if not exists visitor_id text;
alter table public.rec_sessions add column if not exists store_id uuid;
alter table public.rec_sessions add column if not exists funnel_id uuid;
alter table public.rec_sessions add column if not exists first_at timestamp with time zone default now() not null;
alter table public.rec_sessions add column if not exists last_at timestamp with time zone default now() not null;
alter table public.rec_sessions add column if not exists chunks integer default 0 not null;
alter table public.rec_sessions add column if not exists bytes bigint default 0 not null;
alter table public.site_events add column if not exists id bigint default nextval('site_events_id_seq'::regclass) not null;
alter table public.site_events add column if not exists at timestamp with time zone default now() not null;
alter table public.site_events add column if not exists visitor_id text;
alter table public.site_events add column if not exists session_id text;
alter table public.site_events add column if not exists store_id uuid;
alter table public.site_events add column if not exists funnel_id uuid;
alter table public.site_events add column if not exists order_id uuid;
alter table public.site_events add column if not exists page text;
alter table public.site_events add column if not exists event text;
alter table public.site_events add column if not exists host text;
alter table public.site_events add column if not exists path text;
alter table public.site_events add column if not exists country text;
alter table public.site_events add column if not exists device text;
alter table public.site_events add column if not exists utm jsonb;
alter table public.site_events add column if not exists referrer text;
alter table public.site_events add column if not exists data jsonb;
alter table public.site_events add column if not exists city text;
alter table public.site_events add column if not exists region text;
alter table public.site_events add column if not exists browser text;
alter table public.site_events add column if not exists os text;
alter table public.site_events add column if not exists device_model text;
alter table public.site_events add column if not exists ip_masked text;
alter table public.site_events add column if not exists returning_visitor boolean;
alter table public.site_events add column if not exists is_bot boolean default false not null;
alter table public.site_events add column if not exists bot_reason text;
alter table public.site_events add column if not exists lat numeric(4,1);
alter table public.site_events add column if not exists lon numeric(4,1);
alter table public.store_ai add column if not exists store_id uuid;
alter table public.store_ai add column if not exists autopilot boolean default false not null;
alter table public.store_ai add column if not exists updated_at timestamp with time zone default now() not null;
alter table public.store_mail add column if not exists store_id uuid;
alter table public.store_mail add column if not exists host text default ''::text not null;
alter table public.store_mail add column if not exists port integer default 465 not null;
alter table public.store_mail add column if not exists username text;
alter table public.store_mail add column if not exists password_enc text;
alter table public.store_mail add column if not exists updated_at timestamp with time zone default now() not null;
alter table public.store_stripe add column if not exists store_id uuid;
alter table public.store_stripe add column if not exists account_id text;
alter table public.store_stripe add column if not exists account_name text;
alter table public.store_stripe add column if not exists livemode boolean;
alter table public.store_stripe add column if not exists secret_key_enc text;
alter table public.store_stripe add column if not exists publishable_key text;
alter table public.store_stripe add column if not exists webhook_endpoint_id text;
alter table public.store_stripe add column if not exists webhook_secret_enc text;
alter table public.store_stripe add column if not exists apple_pay_domains text[] default '{}'::text[] not null;
alter table public.store_stripe add column if not exists connected_at timestamp with time zone default now() not null;
alter table public.store_stripe add column if not exists last_event_at timestamp with time zone;
alter table public.stores add column if not exists id uuid default gen_random_uuid() not null;
alter table public.stores add column if not exists slug text;
alter table public.stores add column if not exists name text;
alter table public.stores add column if not exists domain text;
alter table public.stores add column if not exists support_email text;
alter table public.stores add column if not exists default_locale text default 'en'::text not null;
alter table public.stores add column if not exists guarantee_days integer default 7 not null;
alter table public.stores add column if not exists brand jsonb default '{}'::jsonb not null;
alter table public.stores add column if not exists meta_pixel_id text;
alter table public.stores add column if not exists active boolean default true not null;
alter table public.stores add column if not exists created_at timestamp with time zone default now() not null;
alter table public.stores add column if not exists updated_at timestamp with time zone default now() not null;
alter table public.stores add column if not exists display_name text;
alter table public.stores add column if not exists logo_url text;
alter table public.stores add column if not exists timezone text default 'America/Argentina/Buenos_Aires'::text not null;
alter table public.stores add column if not exists email_from text;
alter table public.stores add column if not exists legal_name text;
alter table public.stores add column if not exists legal_address text;
alter table public.stores add column if not exists statement_descriptor text;
alter table public.stores add column if not exists thankyou jsonb default '{}'::jsonb not null;
alter table public.stores add column if not exists delivery_email jsonb default '{}'::jsonb not null;
alter table public.stores add column if not exists meta_ad_account_id text;
alter table public.stores add column if not exists sales_webhook_url text;
alter table public.stores add column if not exists catalog_domain text;
alter table public.stores add column if not exists business jsonb default '{}'::jsonb not null;
alter table public.stores add column if not exists catalog_url text;
alter table public.stores add column if not exists stripe_pmc text;
alter table public.stores add column if not exists is_test boolean default false not null;
alter table public.stores add column if not exists library_domain text;
alter table public.stripe_balance_sync add column if not exists store_id uuid;
alter table public.stripe_balance_sync add column if not exists synced_until bigint default 0 not null;
alter table public.stripe_balance_sync add column if not exists backfill_cursor text;
alter table public.stripe_balance_sync add column if not exists backfill_done boolean default false not null;
alter table public.stripe_balance_sync add column if not exists floor_at timestamp with time zone;
alter table public.stripe_balance_sync add column if not exists synced_at timestamp with time zone;
alter table public.stripe_balance_sync add column if not exists error text;
alter table public.stripe_balance_txns add column if not exists store_id uuid;
alter table public.stripe_balance_txns add column if not exists txn_id text;
alter table public.stripe_balance_txns add column if not exists type text;
alter table public.stripe_balance_txns add column if not exists reporting_category text;
alter table public.stripe_balance_txns add column if not exists created_at timestamp with time zone;
alter table public.stripe_balance_txns add column if not exists amount numeric(12,2);
alter table public.stripe_balance_txns add column if not exists fee numeric(12,2);
alter table public.stripe_balance_txns add column if not exists net numeric(12,2);
alter table public.stripe_balance_txns add column if not exists currency character(3);
alter table public.stripe_balance_txns add column if not exists source_id text;
alter table public.stripe_balance_txns add column if not exists payment_intent text;
alter table public.stripe_balance_txns add column if not exists buyer text;
alter table public.stripe_balance_txns add column if not exists ext_order text;
alter table public.stripe_balance_txns add column if not exists ext_store text;
alter table public.stripe_balance_txns add column if not exists ext_post boolean;
alter table public.stripe_balance_txns add column if not exists charge_amount numeric(12,2);
alter table public.stripe_balance_txns add column if not exists charge_currency text;
alter table public.stripe_balance_txns add column if not exists notified_at timestamp with time zone;
alter table public.stripe_events add column if not exists id text;
alter table public.stripe_events add column if not exists store_id uuid;
alter table public.stripe_events add column if not exists type text;
alter table public.stripe_events add column if not exists received_at timestamp with time zone default now() not null;
alter table public.stripe_events add column if not exists processed_at timestamp with time zone;
alter table public.stripe_events add column if not exists error text;
alter table public.upsell_events add column if not exists id uuid default gen_random_uuid() not null;
alter table public.upsell_events add column if not exists store_id uuid;
alter table public.upsell_events add column if not exists order_id uuid;
alter table public.upsell_events add column if not exists pp_funnel_id uuid;
alter table public.upsell_events add column if not exists product_id uuid;
alter table public.upsell_events add column if not exists event text;
alter table public.upsell_events add column if not exists created_at timestamp with time zone default now() not null;
alter table public.uptime_checks add column if not exists id bigint default nextval('uptime_checks_id_seq'::regclass) not null;
alter table public.uptime_checks add column if not exists target_id text;
alter table public.uptime_checks add column if not exists at timestamp with time zone default now() not null;
alter table public.uptime_checks add column if not exists request_id bigint;
alter table public.uptime_checks add column if not exists ok boolean;
alter table public.uptime_checks add column if not exists status integer;
alter table public.uptime_checks add column if not exists ms integer;
alter table public.uptime_checks add column if not exists error text;
alter table public.uptime_state add column if not exists target_id text;
alter table public.uptime_state add column if not exists down boolean default false not null;
alter table public.uptime_state add column if not exists down_since timestamp with time zone;
alter table public.uptime_state add column if not exists last_ok_at timestamp with time zone;
alter table public.uptime_state add column if not exists last_check_at timestamp with time zone;
alter table public.uptime_state add column if not exists last_notified_at timestamp with time zone;
alter table public.uptime_state add column if not exists last_error text;
alter table public.uptime_targets add column if not exists id text;
alter table public.uptime_targets add column if not exists label text;
alter table public.uptime_targets add column if not exists url text;
alter table public.uptime_targets add column if not exists expect text;
alter table public.uptime_targets add column if not exists active boolean default true not null;
alter table public.uptime_targets add column if not exists sort_order integer default 0 not null;
alter table public.uptime_targets add column if not exists auto boolean default false not null;
alter table public.uptime_targets add column if not exists kind text;
alter table public.uptime_targets add column if not exists name text;
alter table public.uptime_targets add column if not exists link text;
alter table public.uptime_targets add column if not exists store_id uuid;
alter table public.uptime_targets add column if not exists funnel_id uuid;

-- ---------- Dueño de las secuencias ----------
alter sequence public.bid_pilot_log_id_seq owned by public.bid_pilot_log.id;
alter sequence public.downloads_id_seq owned by public.downloads.id;
alter sequence public.email_events_id_seq owned by public.email_events.id;
alter sequence public.login_attempts_id_seq owned by public.login_attempts.id;
alter sequence public.meta_auto_log_id_seq owned by public.meta_auto_log.id;
alter sequence public.meta_insights_daily_id_seq owned by public.meta_insights_daily.id;
alter sequence public.mkt_events_id_seq owned by public.mkt_events.id;
alter sequence public.rec_chunks_id_seq owned by public.rec_chunks.id;
alter sequence public.site_events_id_seq owned by public.site_events.id;
alter sequence public.uptime_checks_id_seq owned by public.uptime_checks.id;

-- ---------- Claves foráneas ----------
do $$ begin alter table public.ad_creatives add constraint ad_creatives_funnel_id_fkey FOREIGN KEY (funnel_id) REFERENCES funnels(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.ad_creatives add constraint ad_creatives_offer_id_fkey FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.alerts add constraint alerts_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.bid_pilot_log add constraint bid_pilot_log_run_id_fkey FOREIGN KEY (run_id) REFERENCES bid_pilot_runs(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.checkouts add constraint checkouts_funnel_id_fkey FOREIGN KEY (funnel_id) REFERENCES funnels(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.checkouts add constraint checkouts_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.checkouts add constraint checkouts_recovered_order_id_fkey FOREIGN KEY (recovered_order_id) REFERENCES orders(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.checkouts add constraint checkouts_recovery_email_log_id_fkey FOREIGN KEY (recovery_email_log_id) REFERENCES email_log(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.checkouts add constraint checkouts_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.coach_recs add constraint coach_recs_run_id_fkey FOREIGN KEY (run_id) REFERENCES coach_runs(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.downloads add constraint downloads_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.downloads add constraint downloads_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.email_events add constraint email_events_email_log_id_fkey FOREIGN KEY (email_log_id) REFERENCES email_log(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.email_log add constraint email_log_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.email_log add constraint email_log_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.funnel_items add constraint funnel_items_funnel_id_fkey FOREIGN KEY (funnel_id) REFERENCES funnels(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.funnel_items add constraint funnel_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.funnels add constraint funnels_main_product_id_fkey FOREIGN KEY (main_product_id) REFERENCES products(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.funnels add constraint funnels_offer_id_fkey FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.funnels add constraint funnels_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.inbox_messages add constraint inbox_messages_email_log_id_fkey FOREIGN KEY (email_log_id) REFERENCES email_log(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.inbox_messages add constraint inbox_messages_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.inbox_messages add constraint inbox_messages_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.inbox_sync_state add constraint inbox_sync_state_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.library_grants add constraint library_grants_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.library_grants add constraint library_grants_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.mail_unsubscribes add constraint mail_unsubscribes_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.markets add constraint markets_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.mkt_campaigns add constraint mkt_campaigns_segment_id_fkey FOREIGN KEY (segment_id) REFERENCES mkt_segments(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.mkt_campaigns add constraint mkt_campaigns_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.mkt_contacts add constraint mkt_contacts_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.mkt_events add constraint mkt_events_send_id_fkey FOREIGN KEY (send_id) REFERENCES mkt_sends(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.mkt_import_orders add constraint mkt_import_orders_import_id_fkey FOREIGN KEY (import_id) REFERENCES mkt_imports(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.mkt_import_orders add constraint mkt_import_orders_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.mkt_imports add constraint mkt_imports_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.mkt_segments add constraint mkt_segments_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.mkt_sends add constraint mkt_sends_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES mkt_campaigns(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.mkt_sends add constraint mkt_sends_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES mkt_contacts(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.mkt_sends add constraint mkt_sends_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.mkt_store_settings add constraint mkt_store_settings_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.offer_tasks add constraint offer_tasks_offer_id_fkey FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.offers add constraint offers_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.order_items add constraint order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.order_items add constraint order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id); exception when duplicate_object then null; end $$;
do $$ begin alter table public.orders add constraint orders_funnel_id_fkey FOREIGN KEY (funnel_id) REFERENCES funnels(id); exception when duplicate_object then null; end $$;
do $$ begin alter table public.orders add constraint orders_pp_funnel_id_fkey FOREIGN KEY (pp_funnel_id) REFERENCES pp_funnels(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.orders add constraint orders_recovered_from_fkey FOREIGN KEY (recovered_from) REFERENCES checkouts(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.orders add constraint orders_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores(id); exception when duplicate_object then null; end $$;
do $$ begin alter table public.pixels add constraint pixels_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.pp_funnels add constraint pp_funnels_checkout_funnel_id_fkey FOREIGN KEY (checkout_funnel_id) REFERENCES funnels(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.pp_funnels add constraint pp_funnels_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.pp_steps add constraint pp_steps_downsell_of_fkey FOREIGN KEY (downsell_of) REFERENCES pp_steps(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.pp_steps add constraint pp_steps_pp_funnel_id_fkey FOREIGN KEY (pp_funnel_id) REFERENCES pp_funnels(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.pp_steps add constraint pp_steps_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.presale_notices add constraint presale_notices_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.presale_notices add constraint presale_notices_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.product_prices add constraint product_prices_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.products add constraint products_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.products add constraint products_variant_of_fkey FOREIGN KEY (variant_of) REFERENCES products(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.store_ai add constraint store_ai_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.store_mail add constraint store_mail_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.store_stripe add constraint store_stripe_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.stripe_balance_sync add constraint stripe_balance_sync_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.stripe_balance_txns add constraint stripe_balance_txns_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.stripe_events add constraint stripe_events_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.upsell_events add constraint upsell_events_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.upsell_events add constraint upsell_events_pp_funnel_id_fkey FOREIGN KEY (pp_funnel_id) REFERENCES pp_funnels(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.upsell_events add constraint upsell_events_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.upsell_events add constraint upsell_events_store_id_fkey FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.uptime_checks add constraint uptime_checks_target_id_fkey FOREIGN KEY (target_id) REFERENCES uptime_targets(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.uptime_state add constraint uptime_state_target_id_fkey FOREIGN KEY (target_id) REFERENCES uptime_targets(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;

-- ---------- Índices ----------
CREATE INDEX IF NOT EXISTS ad_creatives_offer ON public.ad_creatives USING btree (offer_id, sort_order);
CREATE UNIQUE INDEX IF NOT EXISTS ad_creatives_offer_drive ON public.ad_creatives USING btree (offer_id, drive_file_id) WHERE (drive_file_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS alerts_feed ON public.alerts USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS alerts_open ON public.alerts USING btree (created_at DESC) WHERE (resolved_at IS NULL);
CREATE INDEX IF NOT EXISTS bid_pilot_adsets_campaign ON public.bid_pilot_adsets USING btree (campaign_id);
CREATE INDEX IF NOT EXISTS bid_pilot_log_adset ON public.bid_pilot_log USING btree (adset_id, at DESC);
CREATE INDEX IF NOT EXISTS bid_pilot_log_at ON public.bid_pilot_log USING btree (at DESC);
CREATE INDEX IF NOT EXISTS bid_pilot_runs_at ON public.bid_pilot_runs USING btree (at DESC);
CREATE INDEX IF NOT EXISTS checkouts_abandoned ON public.checkouts USING btree (store_id, status) WHERE (email IS NOT NULL);
CREATE INDEX IF NOT EXISTS checkouts_store_created ON public.checkouts USING btree (store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS coach_recs_fp ON public.coach_recs USING btree (fingerprint, status_at DESC) WHERE (status <> 'nueva'::text);
CREATE INDEX IF NOT EXISTS coach_recs_run ON public.coach_recs USING btree (run_id, sort);
CREATE INDEX IF NOT EXISTS coach_runs_recent ON public.coach_runs USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS downloads_order ON public.downloads USING btree (order_id);
CREATE INDEX IF NOT EXISTS email_events_log ON public.email_events USING btree (email_log_id, at DESC);
CREATE INDEX IF NOT EXISTS email_log_order ON public.email_log USING btree (order_id);
CREATE INDEX IF NOT EXISTS email_log_provider_id ON public.email_log USING btree (provider_id);
CREATE INDEX IF NOT EXISTS email_log_store ON public.email_log USING btree (store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS email_log_store_kind ON public.email_log USING btree (store_id, created_at DESC) INCLUDE (kind, status);
CREATE INDEX IF NOT EXISTS email_log_to ON public.email_log USING btree (store_id, lower(to_email), created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS funnels_checkout_url_uq ON public.funnels USING btree (checkout_host, checkout_path) WHERE (checkout_path IS NOT NULL);
CREATE INDEX IF NOT EXISTS funnels_offer ON public.funnels USING btree (offer_id);
CREATE INDEX IF NOT EXISTS inbox_messages_ai_auto_due ON public.inbox_messages USING btree (ai_auto_due_at) WHERE ((ai_auto_due_at IS NOT NULL) AND (ai_auto_done_at IS NULL));
CREATE INDEX IF NOT EXISTS inbox_messages_list ON public.inbox_messages USING btree (store_id, mailbox, date DESC);
CREATE INDEX IF NOT EXISTS inbox_messages_order ON public.inbox_messages USING btree (order_id);
CREATE INDEX IF NOT EXISTS inbox_messages_pilot ON public.inbox_messages USING btree (date DESC) WHERE ((direction = 'in'::text) AND (replied_at IS NULL) AND (ai_pilot_at IS NULL) AND (is_bounce = false));
CREATE INDEX IF NOT EXISTS inbox_messages_push_due ON public.inbox_messages USING btree (mail_push_due_at) WHERE ((mail_push_due_at IS NOT NULL) AND (mail_pushed_at IS NULL));
CREATE INDEX IF NOT EXISTS inbox_messages_reply ON public.inbox_messages USING btree (store_id, in_reply_to);
CREATE INDEX IF NOT EXISTS library_grants_store_email ON public.library_grants USING btree (store_id, email);
CREATE INDEX IF NOT EXISTS login_attempts_ip ON public.login_attempts USING btree (ip, at DESC);
CREATE INDEX IF NOT EXISTS mcp_audit_created ON public.mcp_audit USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS mcp_audit_tool ON public.mcp_audit USING btree (tool, created_at DESC);
CREATE INDEX IF NOT EXISTS meta_auto_log_at ON public.meta_auto_log USING btree (at DESC);
CREATE INDEX IF NOT EXISTS meta_auto_log_campaign ON public.meta_auto_log USING btree (campaign_id, at DESC);
CREATE INDEX IF NOT EXISTS meta_auto_runs_at ON public.meta_auto_runs USING btree (at DESC);
CREATE INDEX IF NOT EXISTS meta_auto_winners_proposed ON public.meta_auto_winners USING btree (proposed_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS meta_insights_daily_key ON public.meta_insights_daily USING btree (account_id, date, level, COALESCE(campaign_id, ''::text), COALESCE(adset_id, ''::text), COALESCE(ad_id, ''::text));
CREATE INDEX IF NOT EXISTS meta_insights_daily_read ON public.meta_insights_daily USING btree (account_id, level, date);
CREATE INDEX IF NOT EXISTS meta_objects_account ON public.meta_objects USING btree (account_id, level);
CREATE INDEX IF NOT EXISTS meta_objects_new ON public.meta_objects USING btree (created_time DESC) WHERE (level = 'campaign'::text);
CREATE INDEX IF NOT EXISTS meta_platform_daily_campaign ON public.meta_platform_daily USING btree (campaign_id, date);
CREATE INDEX IF NOT EXISTS meta_snapshots_account ON public.meta_snapshots USING btree (account);
CREATE INDEX IF NOT EXISTS mkt_campaigns_live ON public.mkt_campaigns USING btree (status) WHERE (status = ANY (ARRAY['scheduled'::text, 'sending'::text]));
CREATE INDEX IF NOT EXISTS mkt_campaigns_store ON public.mkt_campaigns USING btree (store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS mkt_contacts_email ON public.mkt_contacts USING btree (email);
CREATE INDEX IF NOT EXISTS mkt_contacts_store ON public.mkt_contacts USING btree (store_id, kind, status);
CREATE INDEX IF NOT EXISTS mkt_events_send ON public.mkt_events USING btree (send_id, kind, at DESC);
CREATE INDEX IF NOT EXISTS mkt_import_orders_email ON public.mkt_import_orders USING btree (store_id, email);
CREATE INDEX IF NOT EXISTS mkt_sends_campaign ON public.mkt_sends USING btree (campaign_id, status);
CREATE INDEX IF NOT EXISTS mkt_sends_email ON public.mkt_sends USING btree (store_id, email);
CREATE UNIQUE INDEX IF NOT EXISTS mkt_sends_once ON public.mkt_sends USING btree (campaign_id, email) WHERE (NOT is_test);
CREATE INDEX IF NOT EXISTS mkt_sends_provider ON public.mkt_sends USING btree (provider_id) WHERE (provider_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS mkt_sends_queue ON public.mkt_sends USING btree (campaign_id, created_at) WHERE (status = 'queued'::text);
CREATE INDEX IF NOT EXISTS mkt_sends_sent_at ON public.mkt_sends USING btree (sent_at) WHERE ((sent_at IS NOT NULL) AND (NOT is_test));
CREATE INDEX IF NOT EXISTS offer_tasks_offer_idx ON public.offer_tasks USING btree (offer_id, done, created_at);
CREATE INDEX IF NOT EXISTS order_items_order ON public.order_items USING btree (order_id);
CREATE UNIQUE INDEX IF NOT EXISTS order_items_upsell_pi_key ON public.order_items USING btree (stripe_payment_intent) WHERE ((kind = 'upsell'::text) AND (stripe_payment_intent IS NOT NULL));
CREATE INDEX IF NOT EXISTS orders_email ON public.orders USING btree (store_id, lower(email));
CREATE INDEX IF NOT EXISTS orders_is_test ON public.orders USING btree (store_id) WHERE is_test;
CREATE UNIQUE INDEX IF NOT EXISTS orders_number ON public.orders USING btree (number);
CREATE INDEX IF NOT EXISTS orders_recovered_from ON public.orders USING btree (recovered_from) WHERE (recovered_from IS NOT NULL);
CREATE INDEX IF NOT EXISTS orders_sale_push_due_idx ON public.orders USING btree (sale_push_due_at) WHERE (sale_pushed_at IS NULL);
CREATE INDEX IF NOT EXISTS orders_status ON public.orders USING btree (status);
CREATE INDEX IF NOT EXISTS orders_store_created ON public.orders USING btree (store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_test ON public.orders USING btree (store_id, created_at DESC) WHERE (status = 'test'::text);
CREATE INDEX IF NOT EXISTS pi_rate_ip ON public.pi_rate USING btree (ip, at DESC);
CREATE INDEX IF NOT EXISTS pp_funnels_store ON public.pp_funnels USING btree (store_id, active);
CREATE INDEX IF NOT EXISTS pp_steps_downsell_of ON public.pp_steps USING btree (downsell_of);
CREATE INDEX IF NOT EXISTS products_partner_email ON public.products USING btree (partner_email) WHERE (partner_email IS NOT NULL);
CREATE INDEX IF NOT EXISTS products_presale_idx ON public.products USING btree (store_id) WHERE presale;
CREATE INDEX IF NOT EXISTS push_subscriptions_device ON public.push_subscriptions USING btree (device_id);
CREATE INDEX IF NOT EXISTS rec_chunks_at ON public.rec_chunks USING btree (at);
CREATE INDEX IF NOT EXISTS rec_chunks_session ON public.rec_chunks USING btree (session_id, id);
CREATE INDEX IF NOT EXISTS rec_sessions_last ON public.rec_sessions USING btree (last_at);
CREATE INDEX IF NOT EXISTS rec_sessions_visitor ON public.rec_sessions USING btree (visitor_id);
CREATE INDEX IF NOT EXISTS site_events_at ON public.site_events USING btree (at DESC);
CREATE INDEX IF NOT EXISTS site_events_feed ON public.site_events USING btree (at DESC) WHERE (event <> 'heartbeat'::text);
CREATE INDEX IF NOT EXISTS site_events_funnel_at ON public.site_events USING btree (funnel_id, at DESC);
CREATE INDEX IF NOT EXISTS site_events_hb ON public.site_events USING btree (page, at DESC) WHERE (event = 'heartbeat'::text);
CREATE INDEX IF NOT EXISTS site_events_human_at ON public.site_events USING btree (at DESC) WHERE (NOT is_bot);
CREATE INDEX IF NOT EXISTS site_events_order ON public.site_events USING btree (order_id) WHERE (order_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS site_events_session ON public.site_events USING btree (session_id, at) WHERE (event <> 'heartbeat'::text);
CREATE INDEX IF NOT EXISTS site_events_visitor ON public.site_events USING btree (visitor_id, at DESC) WHERE (event <> 'heartbeat'::text);
CREATE UNIQUE INDEX IF NOT EXISTS stores_catalog_domain ON public.stores USING btree (lower(catalog_domain)) WHERE (catalog_domain IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS stores_domain ON public.stores USING btree (lower(domain)) WHERE (domain IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS stores_library_domain_key ON public.stores USING btree (library_domain) WHERE (library_domain IS NOT NULL);
CREATE INDEX IF NOT EXISTS stripe_balance_txns_buyer_idx ON public.stripe_balance_txns USING btree (store_id, buyer, created_at);
CREATE INDEX IF NOT EXISTS stripe_balance_txns_created ON public.stripe_balance_txns USING btree (store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS stripe_balance_txns_ext ON public.stripe_balance_txns USING btree (created_at DESC) WHERE (ext_order IS NOT NULL);
CREATE INDEX IF NOT EXISTS stripe_balance_txns_pi ON public.stripe_balance_txns USING btree (payment_intent) WHERE (payment_intent IS NOT NULL);
CREATE INDEX IF NOT EXISTS stripe_events_store ON public.stripe_events USING btree (store_id, received_at DESC);
CREATE INDEX IF NOT EXISTS upsell_events_store ON public.upsell_events USING btree (store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS uptime_checks_pending ON public.uptime_checks USING btree (request_id) WHERE (ok IS NULL);
CREATE INDEX IF NOT EXISTS uptime_checks_target_at ON public.uptime_checks USING btree (target_id, at DESC);

-- ---------- Funciones ----------
CREATE OR REPLACE FUNCTION public.admin_search(p_q text, p_limit integer DEFAULT 8)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  with q as (
    select trim(p_q) t,
      -- Para ILIKE: los comodines que escriba la persona valen como texto.
      replace(replace(replace(trim(p_q), '\', '\\'), '%', '\%'), '_', '\_') l,
      lower(regexp_replace(trim(p_q), '^#', '')) id
  ),
  test_stores as (select id from public.stores where is_test),
  o as (
    select o.id, o.number, o.created_at, o.status, o.email, o.name, o.phone, o.country, o.currency, o.amount_total, o.funnel_id, o.store_id,
      o.stripe_payment_intent,
      (select coalesce(sum(i.amount), 0) from public.order_items i where i.order_id = o.id and i.kind = 'upsell') ups
    from public.orders o, q
    where o.status in ('paid', 'refunded', 'pending') and not o.is_test
      and (o.email ilike '%' || q.l || '%' or o.name ilike '%' || q.l || '%' or o.phone ilike '%' || q.l || '%'
        or (q.id ~ '^[0-9]{1,12}$' and o.number = q.id::bigint)
        or (length(q.id) >= 6 and o.id::text like q.id || '%')
        or o.stripe_payment_intent = q.t or o.stripe_session_id = q.t
        or exists (select 1 from public.order_items i where i.order_id = o.id and i.stripe_payment_intent = q.t)
        or (length(q.t) = 2 and upper(o.country) = upper(q.t)))
    order by o.created_at desc
    limit p_limit
  ),
  c as (
    select c.id, c.created_at, c.status, c.email, c.name, c.country, c.currency, c.amount, c.funnel_id, c.store_id
    from public.checkouts c, q
    where c.email is not null and c.order_id is null and c.status <> 'paid'
      and c.store_id not in (select id from test_stores)
      and (c.email ilike '%' || q.l || '%' or c.name ilike '%' || q.l || '%'
        or (length(q.id) >= 6 and c.id::text like q.id || '%') or c.stripe_payment_intent = q.t)
    order by c.created_at desc
    limit p_limit
  ),
  v as (
    select * from (
      select distinct on (e.visitor_id) e.visitor_id, e.at, e.country, e.data->>'email' email, e.funnel_id
      from public.site_events e, q
      where e.event = 'lead' and e.visitor_id is not null and e.data->>'email' ilike '%' || q.l || '%'
        and (e.store_id is null or e.store_id not in (select id from test_stores))
      order by e.visitor_id, e.at desc
    ) x order by at desc limit p_limit
  )
  select jsonb_build_object(
    'orders', coalesce((select jsonb_agg(to_jsonb(o) order by o.created_at desc) from o), '[]'::jsonb),
    'carts', coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at desc) from c), '[]'::jsonb),
    'visitors', coalesce((select jsonb_agg(to_jsonb(v) order by v.at desc) from v), '[]'::jsonb))
$function$;

CREATE OR REPLACE FUNCTION public.mail_track(p_id uuid, p_kind text, p_url text, p_ip text, p_ua text, p_download boolean DEFAULT false)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare l record;
begin
  select id, created_at, order_id into l from public.email_log where id = p_id;
  if not found then return 'unknown'; end if;
  if p_kind = 'open' then
    if now() - l.created_at < interval '2 seconds' then return 'too_soon'; end if;
    if exists (select 1 from public.email_events where email_log_id = p_id and kind = 'open' and at > now() - interval '30 seconds') then
      return 'dup';
    end if;
    insert into public.email_events (email_log_id, kind, ip, ua) values (p_id, 'open', p_ip, left(p_ua, 300));
    update public.email_log set open_count = open_count + 1, opened_at = coalesce(opened_at, now()) where id = p_id;
  else
    insert into public.email_events (email_log_id, kind, url, ip, ua) values (p_id, 'click', left(p_url, 1000), p_ip, left(p_ua, 300));
    -- Un clic también es una apertura (con las imágenes bloqueadas el píxel no llega).
    update public.email_log set click_count = click_count + 1, clicked_at = coalesce(clicked_at, now()),
      opened_at = coalesce(opened_at, now()),
      downloaded_at = case when p_download then coalesce(downloaded_at, now()) else downloaded_at end
    where id = p_id;
  end if;
  -- Ya lo abrió: el aviso «no abrió la entrega» de ese pedido se cierra solo.
  if l.order_id is not null then
    update public.alerts set resolved_at = now()
    where kind = 'not_opened_24h' and ref_id = l.order_id::text and resolved_at is null;
  end if;
  return 'ok';
end $function$;

CREATE OR REPLACE FUNCTION public.meta_daily(p_account text, p_since date, p_until date, p_campaigns text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  select coalesce(jsonb_agg(jsonb_build_array(date, campaign_id, spend, impressions, inline_link_clicks, purchases, purchase_value, campaign_name,
    initiate_checkout, landing_page_views, clicks) order by date), '[]'::jsonb)
  from public.meta_insights_daily
  where account_id = p_account and level = 'campaign' and date between p_since and p_until
    and (p_campaigns is null or campaign_id = any(p_campaigns))
$function$;

CREATE OR REPLACE FUNCTION public.meta_sync_rows(p_account text, p_since date, p_until date, p_rows jsonb, p_started timestamp with time zone)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare n integer;
begin
  insert into public.meta_insights_daily (account_id, date, level, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name,
    status, effective_status, daily_budget, spend, impressions, clicks, inline_link_clicks, purchases, purchase_value, video_3s_views, thruplays,
    initiate_checkout, landing_page_views, updated_at)
  select p_account, (r->>'date')::date, r->>'level',
    nullif(r->>'campaign_id', ''), r->>'campaign_name', nullif(r->>'adset_id', ''), r->>'adset_name', nullif(r->>'ad_id', ''), r->>'ad_name',
    r->>'status', r->>'effective_status', nullif(r->>'daily_budget', '')::numeric,
    coalesce((r->>'spend')::numeric, 0), coalesce((r->>'impressions')::numeric, 0)::bigint, coalesce((r->>'clicks')::numeric, 0)::bigint,
    coalesce((r->>'inline_link_clicks')::numeric, 0)::bigint, coalesce((r->>'purchases')::numeric, 0), coalesce((r->>'purchase_value')::numeric, 0),
    coalesce((r->>'video_3s_views')::numeric, 0)::bigint, coalesce((r->>'thruplays')::numeric, 0)::bigint,
    coalesce((r->>'initiate_checkout')::numeric, 0), coalesce((r->>'landing_page_views')::numeric, 0), now()
  from jsonb_array_elements(p_rows) r
  on conflict (account_id, date, level, coalesce(campaign_id, ''), coalesce(adset_id, ''), coalesce(ad_id, '')) do update set
    campaign_name = excluded.campaign_name, adset_name = excluded.adset_name, ad_name = excluded.ad_name,
    status = excluded.status, effective_status = excluded.effective_status, daily_budget = excluded.daily_budget,
    spend = excluded.spend, impressions = excluded.impressions, clicks = excluded.clicks, inline_link_clicks = excluded.inline_link_clicks,
    purchases = excluded.purchases, purchase_value = excluded.purchase_value, video_3s_views = excluded.video_3s_views,
    thruplays = excluded.thruplays, initiate_checkout = excluded.initiate_checkout, landing_page_views = excluded.landing_page_views,
    updated_at = now();
  get diagnostics n = row_count;
  delete from public.meta_insights_daily
   where account_id = p_account and date between p_since and p_until and updated_at < p_started;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.meta_windows(p_account text, p_ranges jsonb, p_campaigns text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  with rg as (
    select (ord - 1)::int i, (r->>0)::date s, (r->>1)::date u from jsonb_array_elements(p_ranges) with ordinality t(r, ord)
  ), span as (select min(s) s, max(u) u from rg),
  base as (
    select m.date, m.ad_id, m.adset_id, m.campaign_id, m.ad_name, m.adset_name, m.campaign_name, m.spend, m.impressions,
      m.inline_link_clicks, m.purchases, m.purchase_value, m.video_3s_views, m.thruplays
    from public.meta_insights_daily m, span
    where m.account_id = p_account and m.level = 'ad' and m.date between span.s and span.u
      and (p_campaigns is null or m.campaign_id = any(p_campaigns))
  ), agg as (
    select rg.i, b.ad_id, max(b.adset_id) adset_id, max(b.campaign_id) campaign_id, sum(b.spend) spend, sum(b.impressions) imp,
      sum(b.inline_link_clicks) clk, sum(b.purchases) pur, sum(b.purchase_value) val, sum(b.video_3s_views) v3, sum(b.thruplays) thru
    from rg join base b on b.date between rg.s and rg.u
    group by rg.i, b.ad_id
  ), nm as (
    select distinct on (id) id, name from (
      select ad_id id, ad_name name, date from base
      union all select adset_id, adset_name, date from base
      union all select campaign_id, campaign_name, date from base
    ) z where id is not null and name is not null order by id, date desc
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(jsonb_build_array(i, ad_id, adset_id, campaign_id, spend, imp, clk, pur, val, v3, thru)) from agg), '[]'::jsonb),
    'names', coalesce((select jsonb_object_agg(id, name) from nm), '{}'::jsonb))
$function$;

CREATE OR REPLACE FUNCTION public.mkt_arr(j jsonb)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(j) = 'array' then j else '[]'::jsonb end)), '{}')
$function$;

CREATE OR REPLACE FUNCTION public.mkt_campaign_stats(p_campaign uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with c as (select id, store_id from mkt_campaigns where id = p_campaign),
  s as (select * from mkt_sends where campaign_id = p_campaign and not is_test),
  att as (
    select distinct on (o.id) o.id, o.created_at
    from s join c on true
    join orders o on o.store_id = c.store_id and lower(trim(o.email)) = s.email
    where s.sent_at is not null and o.status = 'paid' and not coalesce(o.is_test, false)
      and o.created_at >= s.sent_at and o.created_at < s.sent_at + interval '7 days'
      and (o.utm ->> 'utm_campaign' = c.id::text or (s.clicked_at is not null and o.created_at >= s.clicked_at - interval '5 minutes'))
  ),
  rev as (
    select upper(oi.currency) cur, sum(oi.amount - coalesce(oi.refunded_amount, 0)) amt
    from att join order_items oi on oi.order_id = att.id group by 1
  ),
  loc as (
    select coalesce(locale, '?') l, count(*) filter (where sent_at is not null) sent, count(*) filter (where opened_at is not null) opened,
      count(*) filter (where clicked_at is not null) clicked
    from s group by 1
  )
  select jsonb_build_object(
    'recipients', (select count(*) from s),
    'queued', (select count(*) from s where status in ('queued', 'sending')),
    'sent', (select count(*) from s where sent_at is not null),
    'failed', (select count(*) from s where status = 'failed'),
    'skipped', (select count(*) from s where status = 'skipped'),
    'delivered', (select count(*) from s where delivered_at is not null),
    'opened', (select count(*) from s where opened_at is not null),
    'clicked', (select count(*) from s where clicked_at is not null),
    'unsubscribed', (select count(*) from s where unsubscribed_at is not null),
    'bounced', (select count(*) from s where bounced_at is not null),
    'complained', (select count(*) from s where complained_at is not null),
    'orders', (select count(*) from att),
    'revenue', coalesce((select jsonb_object_agg(cur, round(amt, 2)) from rev), '{}'::jsonb),
    'by_locale', coalesce((select jsonb_object_agg(l, jsonb_build_object('sent', sent, 'opened', opened, 'clicked', clicked)) from loc), '{}'::jsonb),
    'order_ids', coalesce((select jsonb_agg(id order by created_at desc) from (select id, created_at from att order by created_at desc limit 50) x), '[]'::jsonb))
$function$;

CREATE OR REPLACE FUNCTION public.mkt_claim(p_limit integer)
 RETURNS SETOF mkt_sends
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update mkt_sends s set status = 'sending', claimed_at = now(), attempts = s.attempts + 1
  where s.id in (
    select s2.id from mkt_sends s2 join mkt_campaigns c on c.id = s2.campaign_id
    where s2.status = 'queued' and c.status = 'sending'
    order by c.started_at nulls last, s2.created_at
    limit greatest(p_limit, 0)
    for update of s2 skip locked)
  returning s.*
$function$;

CREATE OR REPLACE FUNCTION public.mkt_contact_stats(p_store uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with c as (
    select *,
      case when kind = 'lead' then 'lead'
           when status <> 'subscribed' then status
           when refunded then 'refunded' when disputed then 'disputed'
           when not marketing_ok then 'no_ok'
           else 'active' end as bucket
    from mkt_contacts where store_id = p_store
  )
  select jsonb_build_object(
    'buyers', count(*) filter (where kind = 'buyer'),
    'imported', count(*) filter (where kind = 'buyer' and source = 'import'),
    'leads', count(*) filter (where kind = 'lead'),
    'leads_ok', count(*) filter (where kind = 'lead' and marketing_ok and status = 'subscribed'),
    'active', count(*) filter (where bucket = 'active'),
    'unsubscribed', count(*) filter (where bucket = 'unsubscribed'),
    'bounced', count(*) filter (where bucket = 'bounced'),
    'complained', count(*) filter (where bucket = 'complained'),
    'refunded', count(*) filter (where bucket = 'refunded'),
    'disputed', count(*) filter (where bucket = 'disputed'),
    'by_locale', coalesce((select jsonb_object_agg(l, n) from (select coalesce(locale, '?') l, count(*) n from c where bucket = 'active' group by 1) x), '{}'::jsonb))
  from c
$function$;

CREATE OR REPLACE FUNCTION public.mkt_enqueue(p_campaign uuid, p_versions text[], p_fallback text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n int;
begin
  insert into mkt_sends (campaign_id, store_id, contact_id, email, locale)
  select c.id, c.store_id, s.id, s.email, case when s.locale = any(p_versions) then s.locale else p_fallback end
  from mkt_campaigns c cross join lateral mkt_segment_ids(c.store_id, c.segment) s
  where c.id = p_campaign and (s.locale = any(p_versions) or (p_fallback is not null and p_fallback = any(p_versions)))
  on conflict (campaign_id, email) where not is_test do nothing;
  get diagnostics n = row_count;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.mkt_import_apply(p_store uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n_new int; n_upd int;
begin
  insert into mkt_contacts (store_id, email, name, locale, country, kind, source)
  select distinct on (i.email) i.store_id, i.email, i.name, coalesce(i.locale, s.default_locale), i.country, 'buyer', 'import'
  from mkt_import_orders i join stores s on s.id = i.store_id
  where i.store_id = p_store
  order by i.email, i.ordered_at desc nulls last
  on conflict (store_id, email) do nothing;
  get diagnostics n_new = row_count;

  update mkt_contacts c set
    imp_products = x.products, imp_names = x.names, imp_first_at = x.first_at, imp_last_at = x.last_at,
    imp_orders = x.n, imp_spent_usd = x.usd, imp_refunded = x.refunded,
    name = coalesce(c.name, x.name), country = coalesce(c.country, x.country), locale = coalesce(c.locale, x.locale)
  from (
    select i.email,
      coalesce((select array_agg(distinct p) from mkt_import_orders j cross join lateral unnest(j.products) p where j.store_id = p_store and j.email = i.email), '{}') products,
      coalesce((select array_agg(distinct n) from mkt_import_orders j cross join lateral unnest(j.names) n where j.store_id = p_store and j.email = i.email), '{}') names,
      min(i.ordered_at) first_at, max(i.ordered_at) last_at, count(*) filter (where i.status = 'paid') n,
      coalesce(sum(i.usd) filter (where i.status = 'paid'), 0) usd, bool_or(i.status = 'refunded') refunded,
      (array_agg(i.name order by i.ordered_at desc nulls last) filter (where i.name is not null))[1] name,
      (array_agg(i.country order by i.ordered_at desc nulls last) filter (where i.country is not null))[1] country,
      (array_agg(i.locale order by i.ordered_at desc nulls last) filter (where i.locale is not null))[1] locale
    from mkt_import_orders i where i.store_id = p_store group by i.email
  ) x
  where c.store_id = p_store and c.email = x.email;
  get diagnostics n_upd = row_count;

  -- Con un lote de productos importados, también los packs y las variantes cuentan como tenidos.
  update mkt_contacts c set imp_products = array(select distinct y from (
      select unnest(c.imp_products) y
      union select p.variant_of from products p where p.id = any(c.imp_products) and p.variant_of is not null
      union select unnest(p.includes) from products p where p.id = any(c.imp_products) and p.includes is not null) z)
  where c.store_id = p_store and cardinality(c.imp_products) > 0;

  perform mkt_sync(p_store);
  return jsonb_build_object('nuevos', n_new, 'actualizados', n_upd);
end $function$;

CREATE OR REPLACE FUNCTION public.mkt_offer_products(p_offers uuid[])
 RETURNS uuid[]
 LANGUAGE sql
 STABLE
AS $function$
  select coalesce(array_agg(distinct x), '{}') from (
    select f.main_product_id x from public.funnels f where f.offer_id = any(p_offers) and f.main_product_id is not null
    union
    select p.variant_of from public.funnels f join public.products p on p.id = f.main_product_id
    where f.offer_id = any(p_offers) and p.variant_of is not null
  ) t
$function$;

CREATE OR REPLACE FUNCTION public.mkt_segment_count(p_store uuid, f jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with s as (select coalesce(locale, '?') l from mkt_segment_ids(p_store, f))
  select jsonb_build_object(
    'total', (select count(*) from s),
    'by_locale', coalesce((select jsonb_object_agg(l, n) from (select l, count(*) n from s group by l) x), '{}'::jsonb))
$function$;

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
        or (eng_k = 'not_opened' and s.opened_at is null))));
end $function$;

CREATE OR REPLACE FUNCTION public.mkt_sync(p_store uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_rates jsonb;
  n_new int := 0;
  n_leads int := 0;
  n_unsub int := 0;
  n_bounce int := 0;
begin
  select value -> 'rates' into v_rates from app_settings where key = 'fx_rates';
  v_rates := coalesce(v_rates, '{}'::jsonb);

  create temp table _mkt_o on commit drop as
  select o.id, o.store_id, lower(trim(o.email)) email, nullif(trim(o.name), '') name, o.locale,
         nullif(trim(o.country), '') country, o.created_at, o.funnel_id,
         (o.status = 'refunded' or o.refunded_at is not null or coalesce(o.amount_refunded, 0) > 0) refunded
  from orders o join stores s on s.id = o.store_id
  where o.status in ('paid', 'refunded') and not coalesce(o.is_test, false) and not coalesce(s.is_test, false)
    and o.email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    and (p_store is null or o.store_id = p_store);

  create temp table _mkt_a on commit drop as
  with it as (
    select o.store_id, o.email, oi.product_id, oi.amount, coalesce(oi.refunded_amount, 0) ref, upper(oi.currency) cur
    from _mkt_o o join order_items oi on oi.order_id = o.id
  ),
  owned as (
    select store_id, email, product_id pid from it where product_id is not null
    union select it.store_id, it.email, p.variant_of from it join products p on p.id = it.product_id where p.variant_of is not null
    union select it.store_id, it.email, x from it join products p on p.id = it.product_id cross join lateral unnest(coalesce(p.includes, '{}')) x
  ),
  prods as (select store_id, email, array_agg(distinct pid) pids from owned group by 1, 2),
  spent as (
    select store_id, email, sum((amount - ref) / coalesce(nullif((v_rates ->> cur)::numeric, 0), 1)) usd from it group by 1, 2
  ),
  mk as (
    select o.store_id, o.email,
      array_agg(distinct f.market_label) filter (where coalesce(f.market_label, '') <> '') labels,
      array_agg(distinct f.offer_id) filter (where f.offer_id is not null) offers
    from _mkt_o o join funnels f on f.id = o.funnel_id group by 1, 2
  ),
  agg as (
    select store_id, email, min(created_at) first_at, max(created_at) last_at, count(*) n, bool_or(refunded) refunded,
      (array_agg(name order by created_at desc) filter (where name is not null))[1] name,
      (array_agg(locale order by created_at desc) filter (where locale is not null))[1] locale,
      (array_agg(country order by created_at desc) filter (where country is not null))[1] country
    from _mkt_o group by 1, 2
  )
  select agg.*, coalesce(prods.pids, '{}') pids, coalesce(mk.labels, '{}') labels, coalesce(mk.offers, '{}') offers, coalesce(spent.usd, 0) usd
  from agg left join prods using (store_id, email) left join mk using (store_id, email) left join spent using (store_id, email);

  insert into mkt_contacts (store_id, email, name, locale, country, kind, source)
  select a.store_id, a.email, a.name, coalesce(a.locale, s.default_locale), a.country, 'buyer', 'app'
  from _mkt_a a join stores s on s.id = a.store_id
  on conflict (store_id, email) do nothing;
  get diagnostics n_new = row_count;

  -- Leads de carrito que nunca compraron: separados y SIN marketing.
  insert into mkt_contacts (store_id, email, name, locale, country, kind, source, marketing_ok)
  select distinct on (k.store_id, lower(trim(k.email))) k.store_id, lower(trim(k.email)), nullif(trim(k.name), ''),
         coalesce(k.locale, s.default_locale), nullif(trim(k.country), ''), 'lead', 'cart', false
  from checkouts k join stores s on s.id = k.store_id
  where k.email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' and not coalesce(s.is_test, false)
    and (p_store is null or k.store_id = p_store)
  order by k.store_id, lower(trim(k.email)), k.created_at desc
  on conflict (store_id, email) do nothing;
  get diagnostics n_leads = row_count;

  update mkt_contacts c set
    kind = case when a.email is not null or c.imp_orders > 0 then 'buyer' else c.kind end,
    marketing_ok = case when c.kind = 'lead' and (a.email is not null or c.imp_orders > 0) then true else c.marketing_ok end,
    name = coalesce(a.name, c.name),
    locale = coalesce(a.locale, c.locale),
    country = coalesce(a.country, c.country),
    first_purchase_at = least(a.first_at, c.imp_first_at),
    last_purchase_at = greatest(a.last_at, c.imp_last_at),
    orders_count = coalesce(a.n, 0) + c.imp_orders,
    spent_usd = round(coalesce(a.usd, 0) + c.imp_spent_usd, 2),
    products = array(select distinct x from unnest(coalesce(a.pids, '{}') || c.imp_products) x),
    markets = coalesce(a.labels, '{}'),
    offers = coalesce(a.offers, '{}'),
    refunded = coalesce(a.refunded, false) or c.imp_refunded,
    updated_at = now()
  from mkt_contacts c2 left join _mkt_a a on a.store_id = c2.store_id and a.email = c2.email
  where c.id = c2.id and (p_store is null or c.store_id = p_store);

  -- Ofertas y categorías por lo que TIENE (sirve igual para lo importado).
  update mkt_contacts c set
    offers = array(select distinct x from unnest(c.offers || coalesce((
      select array_agg(distinct f.offer_id) from funnels f left join products p on p.id = f.main_product_id
      where f.store_id = c.store_id and f.offer_id is not null
        and (f.main_product_id = any(c.products) or p.variant_of = any(c.products))), '{}')) x)
  where (p_store is null or c.store_id = p_store) and cardinality(c.products) > 0;
  update mkt_contacts c set
    categories = coalesce((select array_agg(distinct o.category) from offers o where o.id = any(c.offers) and coalesce(o.category, '') <> ''), '{}')
  where (p_store is null or c.store_id = p_store);

  -- Contracargos (el aviso de Stripe apunta al pedido).
  update mkt_contacts c set disputed = true
  from alerts al join orders o on o.id::text = substring(al.link from '/pedido/([0-9a-f-]{36})')
  where al.kind = 'stripe_dispute' and o.store_id = c.store_id and lower(trim(o.email)) = c.email and not c.disputed
    and (p_store is null or c.store_id = p_store);

  -- Bajas (también las del mail de carrito) y rebotes de cualquier mail de la tienda.
  update mkt_contacts c set status = 'unsubscribed', status_at = u.created_at, status_reason = 'se dio de baja (' || coalesce(u.source, 'link') || ')'
  from mail_unsubscribes u
  where u.store_id = c.store_id and u.email = c.email and c.status = 'subscribed' and (p_store is null or c.store_id = p_store);
  get diagnostics n_unsub = row_count;
  update mkt_contacts c set status = 'bounced', status_at = now(), status_reason = 'rebotó un mail de entrega'
  where c.status = 'subscribed' and (p_store is null or c.store_id = p_store)
    and exists (select 1 from email_log l where l.store_id = c.store_id and lower(l.to_email) = c.email and l.bounced_at is not null);
  get diagnostics n_bounce = row_count;

  if p_store is not null then
    insert into mkt_store_settings (store_id, synced_at) values (p_store, now())
    on conflict (store_id) do update set synced_at = now();
  else
    insert into mkt_store_settings (store_id, synced_at) select id, now() from stores
    on conflict (store_id) do update set synced_at = now();
  end if;

  return jsonb_build_object('nuevos', n_new, 'leads_nuevos', n_leads, 'bajas', n_unsub, 'rebotes', n_bounce);
end $function$;

CREATE OR REPLACE FUNCTION public.mkt_track(p_id uuid, p_kind text, p_url text, p_ip text, p_ua text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare l record;
begin
  select id, sent_at, created_at into l from mkt_sends where id = p_id;
  if not found then return 'unknown'; end if;
  if p_kind = 'open' then
    if now() - coalesce(l.sent_at, l.created_at) < interval '2 seconds' then return 'too_soon'; end if;
    if exists (select 1 from mkt_events where send_id = p_id and kind = 'open' and at > now() - interval '30 seconds') then return 'dup'; end if;
    insert into mkt_events (send_id, kind, ip, ua) values (p_id, 'open', p_ip, left(p_ua, 300));
    update mkt_sends set open_count = open_count + 1, opened_at = coalesce(opened_at, now()) where id = p_id;
  else
    insert into mkt_events (send_id, kind, url, ip, ua) values (p_id, 'click', left(p_url, 1000), p_ip, left(p_ua, 300));
    update mkt_sends set click_count = click_count + 1, clicked_at = coalesce(clicked_at, now()), opened_at = coalesce(opened_at, now())
    where id = p_id;
  end if;
  return 'ok';
end $function$;

CREATE OR REPLACE FUNCTION public.orders_assign_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.number is null and new.status in ('pending', 'paid', 'refunded') and not new.is_test
     and not exists (select 1 from public.store_stripe ss where ss.store_id = new.store_id and ss.livemode = false) then
    update public.orders set number = nextval('public.order_number_seq')
    where id = new.id and number is null;
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.orders_mark_test()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not new.is_test and exists (select 1 from public.stores where id = new.store_id and is_test) then
    new.is_test := true;
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.rec_put(p_session text, p_visitor text, p_store uuid, p_funnel uuid, p_pv text, p_seq integer, p_page text, p_path text, p_t0 bigint, p_t1 bigint, p_n integer, p_gz bytea, p_session_cap bigint, p_day_cap bigint)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  d date := (now() at time zone 'utc')::date;
  sz int := octet_length(p_gz);
  cur_day bigint;
  cur_ses bigint;
begin
  select bytes into cur_day from rec_daily where day = d;
  if coalesce(cur_day, 0) + sz > p_day_cap then return 'day_cap'; end if;
  select bytes into cur_ses from rec_sessions where session_id = p_session;
  if coalesce(cur_ses, 0) + sz > p_session_cap then return 'session_cap'; end if;

  insert into rec_chunks (session_id, pv, seq, page, path, t0, t1, n, bytes, gz)
  values (p_session, p_pv, p_seq, p_page, p_path, p_t0, p_t1, p_n, sz, p_gz);

  insert into rec_sessions (session_id, visitor_id, store_id, funnel_id, chunks, bytes)
  values (p_session, p_visitor, p_store, p_funnel, 1, sz)
  on conflict (session_id) do update set
    last_at = now(),
    chunks = rec_sessions.chunks + 1,
    bytes = rec_sessions.bytes + excluded.bytes,
    visitor_id = coalesce(rec_sessions.visitor_id, excluded.visitor_id),
    store_id = coalesce(rec_sessions.store_id, excluded.store_id),
    funnel_id = coalesce(rec_sessions.funnel_id, excluded.funnel_id);

  insert into rec_daily (day, bytes, sessions)
  values (d, sz, case when cur_ses is null then 1 else 0 end)
  on conflict (day) do update set
    bytes = rec_daily.bytes + excluded.bytes,
    sessions = rec_daily.sessions + excluded.sessions;
  return 'ok';
end $function$;

CREATE OR REPLACE FUNCTION public.store_stripe_sync_test()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.stores set is_test = not new.livemode
  where id = new.store_id and is_test is distinct from (not new.livemode);
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin new.updated_at = now(); return new; end $function$;

CREATE OR REPLACE FUNCTION public.uptime_app_push(p_target text, p_label text, p_state text, p_detail text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  cfg jsonb := coalesce((select value from public.app_settings where key = 'uptime'), '{}'::jsonb);
begin
  if coalesce(cfg->>'app_base', '') = '' or coalesce(cfg->>'cron_secret', '') = '' then return; end if;
  perform net.http_get(
    url := (cfg->>'app_base') || '/api/cron/uptime-alert',
    params := jsonb_build_object('target', p_target, 'label', p_label, 'state', p_state, 'detail', coalesce(p_detail, '')),
    headers := jsonb_build_object('Authorization', 'Bearer ' || (cfg->>'cron_secret')),
    timeout_milliseconds := 15000
  );
end $function$;

CREATE OR REPLACE FUNCTION public.uptime_app_push(p_target text, p_label text, p_state text, p_detail text, p_title text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  cfg jsonb := coalesce((select value from public.app_settings where key = 'uptime'), '{}'::jsonb);
begin
  if coalesce(cfg->>'app_base', '') = '' or coalesce(cfg->>'cron_secret', '') = '' then return; end if;
  perform net.http_get(
    url := (cfg->>'app_base') || '/api/cron/uptime-alert',
    params := jsonb_build_object('target', p_target, 'label', p_label, 'state', p_state, 'detail', coalesce(p_detail, ''), 'title', coalesce(p_title, '')),
    headers := jsonb_build_object('Authorization', 'Bearer ' || (cfg->>'cron_secret')),
    timeout_milliseconds := 15000
  );
end $function$;

CREATE OR REPLACE FUNCTION public.uptime_ntfy(p_title text, p_message text, p_priority integer, p_tags text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  topic text := (select value->>'ntfy_topic' from public.app_settings where key = 'uptime');
begin
  if coalesce(topic, '') = '' then return; end if;
  perform net.http_post(
    url := 'https://ntfy.sh/',
    body := jsonb_build_object('topic', topic, 'title', p_title, 'message', p_message, 'priority', p_priority, 'tags', to_jsonb(p_tags)),
    timeout_milliseconds := 10000
  );
end $function$;

CREATE OR REPLACE FUNCTION public.uptime_sync_targets()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  app text := rtrim(coalesce((select value->>'app_base' from public.app_settings where key = 'uptime'), ''), '/');
  n_up int;
  n_del int;
begin
  -- Lo que hay que vigilar ahora.
  create temp table if not exists _uptime_want (
    id text primary key, kind text, name text, label text, url text, expect text, link text, store_id uuid, funnel_id uuid, sort_order int
  ) on commit drop;
  truncate _uptime_want;

  insert into _uptime_want
  with m as (
    select f.id fid, s.id sid, s.slug store, s.domain, f.slug, o.slug offer_slug,
      o.name || ' (' || coalesce(nullif(f.market_label, ''), f.name) || ')' nm,
      nullif(regexp_replace(coalesce(f.checkout_host, ''), '^https?://|/.*$', '', 'g'), '') host,
      nullif(f.checkout_path, '') path,
      nullif(f.landing_url, '') landing,
      row_number() over (order by s.slug, o.sort_order, f.sort_order, f.slug) rn
    from public.funnels f
    join public.offers o on o.id = f.offer_id
    join public.stores s on s.id = f.store_id
    where o.active and f.active and s.active and not s.is_test
      and f.slug not like '%-solo'          -- links de producto suelto: no son mercados
  ),
  u as (
    select m.*,
      case
        when host is not null and path is not null then 'https://' || host || path
        when host is not null then 'https://' || host || '/c/' || store || '/' || slug
        when domain is not null and domain <> '' then 'https://' || domain || '/' || slug
        else app || '/c/' || store || '/' || slug
      end ck_url,
      '/admin/o/' || store || '~' || offer_slug || '~' || slug link
    from m
  )
  select 'ck:' || fid, 'checkout', nm, 'Checkout ' || nm, ck_url, 'pk_live_', link, sid, fid, 100 + rn * 2 from u
  union all
  -- La landing tiene que tener el link a SU checkout: su ruta pública (o el slug del checkout).
  select 'ld:' || fid, 'landing', nm, 'Landing ' || nm, landing, coalesce(path, slug), link, sid, fid, 101 + rn * 2 from u where landing is not null;

  -- Altas y cambios.
  insert into public.uptime_targets (id, label, url, expect, active, sort_order, auto, kind, name, link, store_id, funnel_id)
  select id, label, url, expect, true, sort_order, true, kind, name, link, store_id, funnel_id from _uptime_want
  on conflict (id) do update set
    label = excluded.label, url = excluded.url, expect = excluded.expect, active = true, sort_order = excluded.sort_order,
    auto = true, kind = excluded.kind, name = excluded.name, link = excluded.link, store_id = excluded.store_id, funnel_id = excluded.funnel_id
  where (uptime_targets.label, uptime_targets.url, uptime_targets.expect, uptime_targets.active, uptime_targets.sort_order, uptime_targets.link)
    is distinct from (excluded.label, excluded.url, excluded.expect, true, excluded.sort_order, excluded.link);
  get diagnostics n_up = row_count;

  -- Bajas: ofertas o mercados que se apagaron. Su aviso abierto se cierra.
  update public.alerts set resolved_at = now()
  where kind = 'checkout_down' and resolved_at is null
    and ref_id in (select id from public.uptime_targets where auto and id not in (select id from _uptime_want));
  delete from public.uptime_targets where auto and id not in (select id from _uptime_want);
  get diagnostics n_del = row_count;

  return jsonb_build_object('targets', (select count(*) from _uptime_want), 'upserted', n_up, 'removed', n_del);
end $function$;

CREATE OR REPLACE FUNCTION public.uptime_tick()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  c record;
  r record;
  t record;
  s record;
  ok_now boolean;
  last2 boolean[];
  first_fail timestamptz;
  last_err text;
  v_title text;
begin
  -- 1. Respuestas de la pasada anterior (y se borran: no hace falta guardar los HTML).
  for c in
    select k.id, k.request_id, k.at, g.expect
    from public.uptime_checks k join public.uptime_targets g on g.id = k.target_id
    where k.ok is null and k.request_id is not null
  loop
    select status_code, timed_out, error_msg, content, created into r from net._http_response where id = c.request_id;
    if not found then
      if c.at < now() - interval '100 seconds' then
        update public.uptime_checks set ok = false, error = 'sin respuesta' where id = c.id;
      end if;
      continue;
    end if;
    ok_now := coalesce(r.status_code between 200 and 299, false)
      and not coalesce(r.timed_out, false)
      and (c.expect is null or position(c.expect in coalesce(r.content, '')) > 0);
    update public.uptime_checks set
      ok = ok_now,
      status = r.status_code,
      ms = greatest(0, (extract(epoch from (r.created - c.at)) * 1000)::int),
      error = case when ok_now then null
                   when coalesce(r.timed_out, false) then 'timeout'
                   when r.error_msg is not null then left(r.error_msg, 200)
                   when r.status_code between 200 and 299 then 'respondió pero sin «' || c.expect || '»'
                   else 'HTTP ' || coalesce(r.status_code::text, '?') end
    where id = c.id;
    delete from net._http_response where id = c.request_id;
  end loop;

  -- 2. Estado de cada URL: caída con 2 fallas seguidas, vuelta con 1 acierto.
  for t in select * from public.uptime_targets where active order by sort_order loop
    insert into public.uptime_state (target_id) values (t.id) on conflict (target_id) do nothing;
    select * into s from public.uptime_state where target_id = t.id;
    select array_agg(ok order by at desc) into last2
      from (select ok, at from public.uptime_checks where target_id = t.id and ok is not null order by at desc limit 2) z;
    if last2 is null then continue; end if;
    select error into last_err from public.uptime_checks where target_id = t.id and ok = false order by at desc limit 1;
    -- «Checkout caído: Mi Oferta (España) · 404»
    v_title := case t.kind
      when 'checkout' then 'Checkout caído: ' || t.name || ' · ' || regexp_replace(coalesce(last_err, 'falla'), '^HTTP ', '')
      when 'landing' then 'Landing caída: ' || t.name || ' · ' || regexp_replace(coalesce(last_err, 'falla'), '^HTTP ', '')
      else 'CAÍDO: ' || t.label end;

    if last2[1] then
      update public.uptime_state set last_ok_at = now(), last_check_at = now() where target_id = t.id;
      if s.down then
        update public.uptime_state set down = false, down_since = null, last_notified_at = now() where target_id = t.id;
        update public.alerts set resolved_at = now() where kind = 'checkout_down' and ref_id = t.id and resolved_at is null;
        perform public.uptime_ntfy('✅ Volvió: ' || t.label,
          'Responde bien otra vez. Estuvo caído ' || coalesce(to_char(now() - s.down_since, 'HH24"h "MI"m"'), '?') || '. ' || t.url, 3, array['white_check_mark']);
        perform public.uptime_app_push(t.id, t.label, 'up', null, '✅ Volvió: ' || t.label);
      end if;
    else
      update public.uptime_state set last_check_at = now(), last_error = last_err where target_id = t.id;
      if coalesce(array_length(last2, 1), 0) >= 2 and not last2[2] then
        if not s.down then
          select min(at) into first_fail from (
            select at from public.uptime_checks where target_id = t.id and ok = false
              and at > coalesce((select max(at) from public.uptime_checks where target_id = t.id and ok), '-infinity')
          ) f;
          update public.uptime_state set down = true, down_since = coalesce(first_fail, now()), last_notified_at = now() where target_id = t.id;
          insert into public.alerts (kind, severity, title, body, link, ref_id, store_id, created_at, resolved_at)
          values ('checkout_down', 'error', v_title, coalesce(last_err, 'falla') || ' (2 controles seguidos) · ' || t.url, coalesce(t.link, '/admin/avisos'), t.id, t.store_id, now(), null)
          on conflict (kind, ref_id) do update set title = excluded.title, body = excluded.body, link = excluded.link, created_at = now(), resolved_at = null, severity = 'error';
          perform public.uptime_ntfy('🚨 ' || v_title, coalesce(last_err, 'falla') || ' (2 controles seguidos). ' || t.url, 5, array['rotating_light']);
          perform public.uptime_app_push(t.id, t.label, 'down', last_err, '🚨 ' || v_title);
        elsif s.last_notified_at < now() - interval '30 minutes' then
          update public.uptime_state set last_notified_at = now() where target_id = t.id;
          perform public.uptime_ntfy('🚨 SIGUE CAÍDO: ' || coalesce(t.name, t.label),
            'Desde ' || to_char(s.down_since at time zone 'America/Argentina/Buenos_Aires', 'HH24:MI') || ' (hora AR). ' || coalesce(last_err, '') || ' · ' || t.url, 5, array['rotating_light']);
        end if;
      end if;
    end if;
  end loop;

  -- 3. Nueva pasada.
  for t in select * from public.uptime_targets where active order by sort_order loop
    insert into public.uptime_checks (target_id, request_id)
    values (t.id, net.http_get(
      url := t.url,
      headers := jsonb_build_object('User-Agent', 'CheckoutUptime/1.0 (+monitor)', 'Cache-Control', 'no-cache'),
      timeout_milliseconds := 20000
    ));
  end loop;

  -- 4. Limpieza: 30 días de historia.
  delete from public.uptime_checks where at < now() - interval '30 days';
end $function$;

-- ---------- Triggers ----------
drop trigger if exists checkouts_touch on public.checkouts;
CREATE TRIGGER checkouts_touch BEFORE UPDATE ON public.checkouts FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
drop trigger if exists funnels_touch on public.funnels;
CREATE TRIGGER funnels_touch BEFORE UPDATE ON public.funnels FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
drop trigger if exists offers_touch on public.offers;
CREATE TRIGGER offers_touch BEFORE UPDATE ON public.offers FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
drop trigger if exists orders_mark_test on public.orders;
CREATE TRIGGER orders_mark_test BEFORE INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION orders_mark_test();
drop trigger if exists orders_number on public.orders;
CREATE TRIGGER orders_number AFTER INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION orders_assign_number();
drop trigger if exists orders_touch on public.orders;
CREATE TRIGGER orders_touch BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
drop trigger if exists products_touch on public.products;
CREATE TRIGGER products_touch BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
drop trigger if exists store_stripe_test on public.store_stripe;
CREATE TRIGGER store_stripe_test AFTER INSERT OR UPDATE OF livemode ON public.store_stripe FOR EACH ROW EXECUTE FUNCTION store_stripe_sync_test();
drop trigger if exists stores_touch on public.stores;
CREATE TRIGGER stores_touch BEFORE UPDATE ON public.stores FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------- Permisos ----------
-- La app usa solo la service key. RLS prendido y sin políticas = anon/authenticated no leen nada.
revoke execute on all functions in schema public from public, anon, authenticated;

-- ---------- Storage ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('entregas', 'entregas', false, 524288000, array['application/pdf','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel','text/csv']) on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('media', 'media', true, 10000000, null) on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
