-- Tareas programadas (pg_cron). `npm run setup` lo aplica solo (reemplaza TU_APP por PUBLIC_BASE_URL y TU_CRON_SECRET por CRON_SECRET).
-- A mano: reemplazar TU_APP (ej. https://mi-checkout.vercel.app) y TU_CRON_SECRET y correrlo DESPUÉS de schema.sql en el SQL Editor.

insert into public.app_settings (key, value) values ('uptime', jsonb_build_object('app_base', 'TU_APP', 'cron_secret', 'TU_CRON_SECRET', 'ntfy_topic', ''))
on conflict (key) do update set value = excluded.value;

select cron.schedule('limpiar-heartbeats', '17 4 * * *', $cron$delete from public.site_events where event = 'heartbeat' and at < now() - interval '3 days'$cron$);
select cron.schedule('sincronizar-buzones', '*/5 * * * *', $cron$select net.http_get(
    url := 'TU_APP/api/cron/inbox',
    headers := jsonb_build_object('Authorization', 'Bearer TU_CRON_SECRET'),
    timeout_milliseconds := 55000
  );$cron$);
select cron.schedule('revisar-links', '23 6 * * *', $cron$select net.http_get(
    url := 'TU_APP/api/cron/links',
    headers := jsonb_build_object('Authorization', 'Bearer TU_CRON_SECRET'),
    timeout_milliseconds := 55000
  );$cron$);
select cron.schedule('sincronizar-meta', '*/15 * * * *', $cron$select net.http_get(
    url := 'TU_APP/api/cron/meta',
    headers := jsonb_build_object('Authorization', 'Bearer TU_CRON_SECRET'),
    timeout_milliseconds := 55000
  );$cron$);
select cron.schedule('limpiar-grabaciones', '41 * * * *', $cron$delete from public.rec_chunks where at < now() - interval '72 hours';
    delete from public.rec_sessions where last_at < now() - interval '72 hours';
    delete from public.rec_daily where day < current_date - 30$cron$);
select cron.schedule('monitor-checkout', '*/2 * * * *', $cron$select public.uptime_tick()$cron$);
select cron.schedule('reconciliar-pagos', '*/10 * * * *', $cron$select net.http_get(
    url := 'TU_APP/api/cron/reconcile',
    headers := jsonb_build_object('Authorization', 'Bearer TU_CRON_SECRET'),
    timeout_milliseconds := 55000
  );$cron$);
select cron.schedule('recuperar-carritos', '*/10 * * * *', $cron$select net.http_get(
    url := 'TU_APP/api/cron/recover',
    headers := jsonb_build_object('Authorization', 'Bearer TU_CRON_SECRET'),
    timeout_milliseconds := 55000
  );$cron$);
select cron.schedule('monitor-ofertas', '*/10 * * * *', $cron$select public.uptime_sync_targets()$cron$);
select cron.schedule('piloto-pujas', '7 * * * *', $cron$select net.http_get(
    url := 'TU_APP/api/cron/pujas',
    headers := jsonb_build_object('Authorization', 'Bearer TU_CRON_SECRET'),
    timeout_milliseconds := 55000
  );$cron$);
select cron.schedule('analizar-mejoras', '0 10 * * *', $cron$select net.http_get(
    url := 'TU_APP/api/cron/coach',
    headers := jsonb_build_object('Authorization', 'Bearer TU_CRON_SECRET'),
    timeout_milliseconds := 55000
  );$cron$);
select cron.schedule('avisar-pedidos', '* * * * *', $cron$select net.http_get(
    url := 'TU_APP/api/cron/pedidos',
    headers := jsonb_build_object('Authorization', 'Bearer TU_CRON_SECRET'),
    timeout_milliseconds := 55000
  );$cron$);
select cron.schedule('email-marketing', '* * * * *', $cron$select net.http_get(
    url := 'TU_APP/api/cron/mkt',
    headers := jsonb_build_object('Authorization', 'Bearer TU_CRON_SECRET'),
    timeout_milliseconds := 55000
  );$cron$);
select cron.schedule('piloto-pujas-reintento', '37 * * * *', $cron$select net.http_get(
    url := 'TU_APP/api/cron/pujas?retry=1',
    headers := jsonb_build_object('Authorization', 'Bearer TU_CRON_SECRET'),
    timeout_milliseconds := 55000
  );$cron$);
select cron.schedule('piloto-meta-ads', '17 12 * * *', $cron$select net.http_get(
    url := 'TU_APP/api/cron/autopiloto',
    headers := jsonb_build_object('Authorization', 'Bearer TU_CRON_SECRET'),
    timeout_milliseconds := 55000
  );$cron$);
select cron.schedule('piloto-meta-ads-reintento', '47 12 * * *', $cron$select net.http_get(
    url := 'TU_APP/api/cron/autopiloto?retry=1',
    headers := jsonb_build_object('Authorization', 'Bearer TU_CRON_SECRET'),
    timeout_milliseconds := 55000
  );$cron$);
