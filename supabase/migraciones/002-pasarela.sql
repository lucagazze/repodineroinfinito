-- Con que pasarela cobra cada tienda.
--
-- Hace falta que sea EXPLICITO y no deducido de que conexion existe: una tienda
-- puede tener Stripe y Whop conectados a la vez -- durante una migracion los dos
-- conviven -- y adivinar por presencia haria que cobre la que se conecto ultimo.
-- Quien cobra lo decide la tienda, no el orden en que se conectaron las llaves.
alter table public.stores add column if not exists gateway text not null default 'stripe';
alter table public.stores drop constraint if exists stores_gateway_check;
alter table public.stores add constraint stores_gateway_check check (gateway in ('stripe', 'whop'));

comment on column public.stores.gateway is
  'Pasarela con la que cobra esta tienda: stripe | whop. El checkout monta una sola.';
