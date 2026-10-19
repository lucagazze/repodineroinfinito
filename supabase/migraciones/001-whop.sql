-- Cobrar con Whop ademas de Stripe.
--
-- Mismo molde que store_stripe: una fila por tienda, las llaves cifradas con
-- secrets.ts (AES-256-GCM, SECRETS_KEY). Un volcado de la base no entrega la
-- llave de cobro de nadie.
create table if not exists public.store_whop (
  store_id            uuid primary key references public.stores(id) on delete cascade,
  company_id          text not null,            -- biz_...: la cuenta de Whop
  api_key_enc         text not null,            -- llave de la API, cifrada
  webhook_secret_enc  text,                     -- ws_...: firma los webhooks
  webhook_id          text,                     -- para poder borrarlo al desconectar
  livemode            boolean not null default true,
  connected_at        timestamptz not null default now(),
  last_event_at       timestamptz
);
comment on table public.store_whop is
  'Conexion de una tienda con su cuenta de Whop. Equivalente a store_stripe.';

-- En Whop todo lo que se cobra es un PLAN (no hay montos libres como en un
-- PaymentIntent). Cada producto nuestro necesita saber a que plan corresponde,
-- para que el webhook pueda mapear un pago -> que archivo entregar.
alter table public.products   add column if not exists whop_plan_id text;
alter table public.products   add column if not exists whop_product_id text;
create index if not exists products_whop_plan_id_idx on public.products(whop_plan_id)
  where whop_plan_id is not null;

-- El checkout tambien: un pago que llega sin metadata utilizable se resuelve
-- por el plan del producto principal.
alter table public.funnels    add column if not exists whop_plan_id text;

-- Los pedidos guardan de donde vino el pago. La columna existente
-- stripe_payment_intent pasa a aceptar ids de Whop con prefijo 'whop:', y esta
-- columna dice cual pasarela cobro, para no adivinarlo por el prefijo.
alter table public.orders     add column if not exists provider text not null default 'stripe';
alter table public.orders     add constraint orders_provider_check
  check (provider in ('stripe', 'whop'));

-- El medio de pago guardado del comprador (payt_...), para el upsell de 1 clic.
-- Whop lo devuelve en el webhook del pago, no en la respuesta inmediata.
alter table public.orders     add column if not exists whop_member_id text;
alter table public.orders     add column if not exists whop_payment_method_id text;
