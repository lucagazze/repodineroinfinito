-- Las credenciales de Mercado Pago de una tienda.
--
-- Mismo molde que `store_whop`: una fila por tienda, los secretos cifrados con
-- AES-256-GCM via lib/secrets.ts (`SECRETS_KEY`), y nunca en texto plano.
--
-- POR QUE UNA TABLA Y NO UNA VARIABLE DE ENTORNO
--   Cada tienda cobra en su propia cuenta. Con las claves en el entorno habria
--   una sola cuenta para todas, y el dia que Physics y Finance cobren por
--   Mercado Pago el dinero de una caeria en la cuenta de la otra.
--
-- `site_id` NO es decorativo: Mercado Pago opera por pais (MLA Argentina, MLM
-- Mexico, MLU Uruguay...) y la moneda que acepta una cuenta depende de eso. Una
-- cuenta MLA no puede cobrar en EUR. Guardarlo permite rechazar la combinacion
-- antes de intentar cobrar, en vez de descubrirla con el primer comprador.
create table if not exists public.store_mercadopago (
  store_id            uuid primary key references public.stores(id) on delete cascade,

  -- El id de la cuenta de Mercado Pago (users/me -> id). Sirve para comprobar
  -- que la llave guardada es de la cuenta que se cree.
  user_id             text,
  site_id             text,

  access_token_enc    text not null,
  -- El secreto de firma del webhook. Sin esto NADA se acredita: cada cobro
  -- real se rechaza por firma invalida. Mismo riesgo que el ws_ de Whop.
  webhook_secret_enc  text,

  livemode            boolean not null default true,
  connected_at        timestamptz not null default now(),
  last_event_at       timestamptz
);
comment on table public.store_mercadopago is
  'Credenciales de Mercado Pago por tienda. Los secretos van cifrados; sin webhook_secret_enc ningun cobro se acredita.';

alter table public.store_mercadopago enable row level security;

-- La pasarela de la tienda ya acepta el valor nuevo: el check de `stores`
-- tenia que dejar pasar 'mercadopago' antes de que se pueda conectar una.
-- Comprobada contra la base antes de escribir esto: la restriccion existe, se
-- llama `stores_gateway_check` y hoy dice `in ('stripe','whop')`. Se dropea por
-- nombre y no buscandola por su definicion: buscarla es ingenio que, si
-- hubiera dos, elegiria una en silencio.
alter table public.stores drop constraint if exists stores_gateway_check;
alter table public.stores
  add constraint stores_gateway_check
  check (gateway in ('stripe','whop','mercadopago'));
