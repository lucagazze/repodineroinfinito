-- El monitor de checkouts, para una tienda que cobra con Whop.
--
-- EL ERROR (medido el 22/10/2026)
--   uptime_sync_targets exigia encontrar 'pk_live_' -- la clave publica de
--   Stripe -- en el HTML de CUALQUIER checkout. Finance Study Lab cobra con
--   Whop, asi que ese texto no esta ni va a estar: el monitor la daba por
--   caida aunque la pagina respondiera 200, y levantaba un aviso de «checkout
--   caido» que nunca se iba a cerrar solo.
--   Peor que el falso positivo: un aviso que siempre esta encendido deja de
--   mirarse, y el dia que el checkout se caiga de verdad nadie va a reaccionar.
--
-- Se reemplaza la funcion entera a partir de su definicion real traida de la
-- base, tocando una sola expresion.

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
    select f.id fid, s.id sid, s.slug store, s.domain, coalesce(s.gateway,'stripe') gateway, f.slug, o.slug offer_slug,
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
  -- Lo que prueba que el checkout esta montado DE VERDAD depende de la
  -- pasarela: 'pk_live_' es la clave publica de Stripe y en una tienda que
  -- cobra con Whop no existe ni va a existir. El monitor la daba por caida
  -- para siempre aunque respondiera 200. 'js.whop.com' es su equivalente: el
  -- script de cobro de Whop, sin el cual no hay formulario de pago.
  select 'ck:' || fid, 'checkout', nm, 'Checkout ' || nm, ck_url,
         case when gateway = 'whop' then 'js.whop.com' else 'pk_live_' end,
         link, sid, fid, 100 + rn * 2 from u
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
