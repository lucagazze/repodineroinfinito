# Whop: estado de la integracion

## Hecho en la cuenta de Whop (biz_nFCs9HXHHv3PLw, "Financestudylab")

| Qué | Id |
|---|---|
| Producto principal | `prod_eqRJU015F7rVD` — The Leader Screen |
| Variante (precio) | `plan_5WHxVDM1memJE` — 37 usd, pago unico |

Los dos llevan `metadata` con `tienda`, `embudo` y `producto`: asi un pago que
entra por el webhook se mapea a que archivo entregar, sin depender del precio
ni del titulo.

Guardados en la base: `products.whop_product_id`, `products.whop_plan_id` y
`funnels.whop_plan_id` del checkout `kit`.

## Hecho en el codigo

- `supabase/migraciones/001-whop.sql`: tabla `store_whop` (llaves cifradas),
  columnas `whop_plan_id` / `whop_product_id`, `orders.provider`.
- `src/lib/whop-firma.ts`: verificacion de firma. Sin dependencias, probada
  con 11 casos (`npm run test:whop`).
- `src/lib/whop.ts`: cliente de la API y cobro con tarjeta guardada.

## Bloqueado: hace falta la llave de API

El CLI autenticado por OAuth **no alcanza** para todo. Crear el webhook
devuelve:

    HTTP_403 — OAuth token is not authorized for the developer:manage_webhook
    scope. This resource requires an API-key login.

### Permisos que tiene que llevar la llave (27)

Verificados contra `whop api-keys permissions`. Ojo con los nombres: Whop
llama **access_pass** a los productos y **plan** a los precios.

    access_pass:create                 access_pass:basic:read
    access_pass:update

    plan:create                        plan:basic:read
    plan:update

    payment:charge                     payment:basic:read
    payment:manage                     payment:setup_intent:manage
    payment:setup_intent:read

    checkout_configuration:create      checkout_configuration:basic:read

    member:basic:read                  member:email:read
    member:payment_methods:read        member:payment_methods:use

    membership:create                  membership:cancel
    membership:update

    developer:manage_webhook           <- sin esto no se registra el webhook

    webhook_receive:payments           <- sin esto no se entera de los pagos
    webhook_receive:refunds            webhook_receive:disputes
    webhook_receive:setup_intents      webhook_receive:memberships
    webhook_receive:members

### Lo que NO tiene que llevar

`payout:*` y todo lo que mueva fondos (transfer, deposit, card, swap, trade,
ledger). La app solo cobra, entrega y reembolsa: nunca saca plata de la cuenta.
Si la llave se filtra sin esos permisos, el peor caso es cobrarle a los propios
clientes, que es reversible.

## Lo que falta despues de la llave

1. `connect_whop` por MCP: guardar llave y secreto cifrados en `store_whop`.
2. `POST /api/whop/webhook/[storeId]`: verificar firma -> crear pedido ->
   entregar (reusando `fulfill`) -> mandar el Purchase a Meta.
3. Desacoplar `fulfill()` de `Stripe.PaymentIntent`.
4. Las 2 variantes de los bonos y el checkout configuration.
5. Reemplazar el formulario de pago de Stripe por los elementos de Whop, con
   `setupFutureUsage: "off_session"` para guardar la tarjeta.
6. Post-pago de 1 clic: `off_session: false` + `return_url`, y esperar el
   webhook porque el cobro es asincrono.
