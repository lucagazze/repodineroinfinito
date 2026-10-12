# Cobrar con Whop en vez de Stripe: evaluación

**Resumen:** hoy la app cobra **solo con Stripe**. Whop se puede sumar, pero no cambiando una llave. Hay dos caminos:

- **A. Whop cobra y la app entrega.** Es rápido: 2 o 3 días de trabajo.
- **B. Whop como pasarela completa**, con checkout propio, bumps y upsells de 1 clic. Son 2 o 3 semanas y tiene riesgos.

Recomendación: empezar por **A**. Pasar a **B** solo si los upsells de 1 clic resultan imprescindibles y el modelo de Whop lo permite (ver más abajo).

## Por qué no es un cambio chico

Stripe está metido en unos 40 archivos, no detrás de una interfaz:

| Parte | Qué usa de Stripe |
|---|---|
| Checkout (`/c/[store]/[funnel]`, `/api/pi`) | PaymentIntents + Payment Element / Express Checkout (tarjeta, Apple Pay, Google Pay, Link, medios locales). El precio y los bumps se cotizan en el servidor. |
| Entrega (`src/lib/fulfill.ts`) | Recibe un `PaymentIntent` y su `metadata` (store, funnel, locale, bumps). |
| Webhooks (`/api/stripe/webhook/[storeId]`, `src/lib/stripe-events.ts`) | `payment_intent.succeeded/processing/payment_failed`, `charge.refunded`, `charge.dispute.created`, con un webhook por tienda que la app crea sola (`connect_stripe`). |
| Post-pago de 1 clic (`/api/upsell`, `src/lib/upsell.ts`) | Cobra *off_session* con la tarjeta guardada (`setup_future_usage`), sin volver a pedirla. |
| Biblioteca (`/api/biblioteca/comprar`) | Igual: compra de 1 clic con la tarjeta guardada. |
| Plata del panel (`stripe-balance.ts`, `/api/admin/sync-plata`) | Balance transactions: comisiones reales, reembolsos y neto. |
| Reembolsos, disputas, reconciliación (`refund.ts`, `reconcile.ts`), Apple Pay domains, catálogo «lo que revisa Stripe» | API de Stripe. |

## Qué ofrece Whop (según su documentación para desarrolladores)

- **Checkout hospedado o embebido**, con *checkout configurations* que llevan `metadata`. Esa metadata vuelve en los pagos y las membresías que salen de ese checkout.
- **Webhooks**: `payment.succeeded`, `payment.failed`, `setup_intent.succeeded`, entre otros.
- **Guardar la tarjeta y cobrar después**: el checkout embebido acepta `setupFutureUsage: "off_session"`. Después, `payments.create` con `plan_id`, `member_id` y `payment_method_id` cobra sin el comprador presente. Ese cobro es **asíncrono**: la respuesta es el pago «abierto» y el resultado llega por webhook.
- Cada cosa que se vende es un **producto con un plan** (precio) dentro de Whop. No hay montos libres por línea como en un PaymentIntent.

Docs: <https://docs.whop.com/developer/guides/save-payment-methods>, <https://docs.whop.com/api-reference/payments/payment-succeeded>, <https://docs.whop.com/api-reference/checkout-configurations/retrieve-checkout-configuration>.

## Camino A: Whop cobra, la app entrega y hace todo lo demás (recomendado para empezar)

El checkout es el de Whop. La app se queda con la entrega por mail, la biblioteca de clientes, el buzón con IA, los avisos, las métricas y el email marketing.

1. En Whop, un producto/plan por cada oferta, con su link de checkout. En la landing, el botón de compra va a ese link.
2. Una ruta nueva `POST /api/whop/webhook/[storeId]` que verifica la firma del webhook (secreto en `store_whop`, cifrado con `secrets.ts`, igual que Stripe) y en `payment.succeeded`:
   - busca el checkout de la app por el `plan_id` (una columna nueva `funnels.whop_plan_id`) o por la `metadata` del checkout configuration;
   - crea el `order` y sus `order_items` (estado `paid`, `stripe_payment_intent` = id del pago de Whop con prefijo `whop:`) y llama a la misma lógica de entrega de `fulfill.ts`. Para eso hay que separar de `fulfill()` la parte que no depende de Stripe: recibir `{ provider, paymentId, email, name, country, currency, amount, metadata }` en vez de un `Stripe.PaymentIntent`.
   - en un reembolso del webhook de Whop, aplica lo mismo que `applyRefund`.
3. Bumps: si el checkout de Whop los ofrece, cada bump es otro plan y llega como línea del pago (mapear plan → producto de la app). Si no, se venden en la página de gracias.
4. Post-pago: sin tarjeta guardada en la app, el «1 clic» pasa a ser un link al checkout de Whop del upsell, con el email precargado. Convierte menos que un 1 clic real, pero funciona desde el primer día.
5. Panel: las ventas aparecen solas, porque salen de `orders`. «Plata» (comisiones y neto) muestra Stripe; para Whop, usar el monto bruto o leer sus payouts más adelante.

Lo que queda sin cambios: entrega, biblioteca, mails, IA del buzón, alertas, métricas de Meta (Conversions API: mandar el `Purchase` desde el webhook nuevo con `sendOrderPurchase(orderId)` de `src/lib/meta.ts`), email marketing, MCP.

Esfuerzo: unos 2-3 días, más las pruebas con compras reales de bajo monto.

## Camino B: Whop como pasarela completa (checkout de la app + 1 clic)

Sería reemplazar Stripe detrás de una interfaz `PaymentProvider` (crear el pago, confirmar, cobrar con la tarjeta guardada, reembolsar, webhooks) y escribir la implementación de Whop:

- **Checkout:** el Payment Element pasa a ser los *payment elements* embebidos de Whop. Precio dinámico (principal + bumps elegidos): hay que ver si Whop acepta un monto por pago o si exige un plan por combinación. Si exige plan por combinación, los bumps se vuelven muy incómodos.
- **Upsells de 1 clic:** `payments.create` con `payment_method_id`. Como es asíncrono, `/api/upsell` tiene que esperar el webhook o hacer polling antes de mostrar «listo» y pasar al siguiente nivel. Hoy espera la respuesta síncrona de Stripe.
- **Plata, disputas, reconciliación, catálogo, Apple Pay:** reescribir cada uno o apagarlo para las tiendas de Whop.

Esfuerzo: 2-3 semanas. El riesgo está en la regla de oro de la app («el checkout y el post-pago nunca se caen»): todo el flujo de cobro es nuevo y hay que probarlo de punta a punta.

## Camino mínimo concreto (A, en orden)

1. Migración: tabla `store_whop (store_id, api_key_enc, webhook_secret_enc, company_id)` y columna `funnels.whop_plan_id`.
2. `src/lib/whop.ts`: cliente mínimo (fetch con la API key) + verificación de firma del webhook.
3. Refactor chico: `fulfill()` acepta un pago genérico. El camino de Stripe sigue igual: solo adapta sus argumentos.
4. `/api/whop/webhook/[storeId]`: `payment.succeeded` → orden + entrega + CAPI; reembolso → `applyRefund` genérico.
5. MCP: `connect_whop` (guarda la llave cifrada y crea o anota el webhook) y `whop_plan_id` en `update_checkout`.
6. Probar con una compra real de bajo monto: mail de entrega, biblioteca, aviso push, venta en el panel, reembolso.
