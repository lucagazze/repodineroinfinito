-- Lo que de verdad entra al balance, despues de las comisiones de la pasarela.
--
-- `amount_total` es lo que PAGO el comprador. No es lo que cobra el vendedor:
-- en la primera venta real, 1.00 USD cobrados dejaron 0.56 en el balance de
-- Whop. Sin guardar el neto no hay forma de ver el margen real por pedido ni
-- de notar si la comision cambia.
alter table public.orders add column if not exists net_amount numeric;

comment on column public.orders.net_amount is
  'Lo cobrado menos las comisiones de la pasarela, en la moneda del pedido. '
  'Whop lo da como amount_after_fees. Null = la pasarela no lo informo.';
