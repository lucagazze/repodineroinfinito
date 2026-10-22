-- Un pago cuenta UNA vez, se llame como se llame el evento.
--
-- EL ERROR QUE ESTO ARREGLA (medido, no supuesto)
--   La clave unica era (whop_payment_id, kind). El alta se anota como
--   'created' y la renovacion como 'renewed', asi que el reintento del MISMO
--   pago entraba con otro kind -- distinta clave, sin conflicto -- y se
--   contaba dos veces. En la prueba: 4 pagos y USD 76 donde hubo 3 y USD 57.
--   Justo el numero que se mira para decidir si la suscripcion funciona.
--
-- Dos indices y no uno: un pago rechazado que al reintento se cobra deja DOS
-- hechos distintos del mismo id -- un fallo y un cobro -- y los dos tienen que
-- poder convivir. Con un indice sobre el id solo, el cobro bueno se habria
-- descartado por choque con el fallo anterior: perder una venta cobrada.
drop index if exists public.subscription_events_pago_uniq;

create unique index if not exists subscription_events_cobro_uniq
  on public.subscription_events(whop_payment_id)
  where whop_payment_id is not null and kind in ('created','renewed');

create unique index if not exists subscription_events_fallo_uniq
  on public.subscription_events(whop_payment_id)
  where whop_payment_id is not null and kind = 'payment_failed';
