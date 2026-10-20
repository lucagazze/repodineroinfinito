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

## Cobro: el link hospedado de Whop

    https://whop.com/checkout/ch_Xx8d6OM8hySpKcF/   (ch_Xx8d6OM8hySpKcF)

Guardado en `funnels.checkout_host` + `checkout_path` del embudo `kit`, con la
metadata tienda/embudo/producto adentro, que es lo que permite al webhook saber
que entregar.

**Por que el link y no el formulario embebido.** Whop tiene elementos
embebibles (`@whop/elements`, con createConfirmationToken, igual que Stripe
Elements), asi que la reescritura es posible. Pero son 961 lineas de checkout
-- formulario, Apple Pay, pago diferido, recalculo con bumps -- mas un endpoint
nuevo de tokens, tocando el unico circuito que no se puede caer. Reescribirlo
para ganar conversion en un producto que todavia no vendio una unidad es
optimizar antes de medir. El link cobra hoy; el formulario se hace cuando haya
numeros que digan cuanto vale cada punto.

Lo que el link NO cuesta: el control de la tarjeta. `member_id` y
`payment_method_id` llegan igual en payment.succeeded, asi que el upsell de 1
clic queda disponible sin cambiar nada.

Los bonos NO necesitan variante en Whop: son gratis y `fulfill` los entrega
desde el embudo, no desde el pago. Solo harian falta si se vendieran sueltos.

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

## Trampa al verificar el build

`npm run build` falla con `TypeError: Cannot read properties of null (reading '1')`
si el dev server esta corriendo: los dos escriben en `.next` y se pisan. No es un
error del codigo. Antes de creerle a un build fallido:

```
kill $(lsof -ti:3100); rm -rf .next; npm run build
```

Verificado el 2026-10-20: con el dev server, 1 de 2 builds falla; sin el, 2 de 2 pasan.

---

## 20/10/2026 — un solo formulario, dos pasarelas

### Como quedo armado

El checkout tiene **un** formulario y dos MOTORES de cobro intercambiables:

| archivo | que hace |
|---|---|
| `motores.ts` | el contrato entre el formulario y la pasarela |
| `motor-stripe.tsx` | Stripe — el codigo que ya cobraba, movido tal cual |
| `motor-whop.tsx` | Whop — token, cobro en el servidor, 3D Secure |
| `whop-acento.ts` | traduce el color de marca (hex) al acento de Whop (nombre) |

El JSX del checkout no sabe cual esta montada: pide `motor.elemento`,
`motor.listo` y `motor.pagar`. Se hizo asi y no con dos formularios porque dos
copias del mismo checkout se separan en el primer cambio de precio o de texto
legal, y la que se queda atras es la que esta cobrando.

Quien cobra lo dice `stores.gateway` (migracion 002), **no** se deduce de que
conexion existe: durante una migracion las dos conviven.

### Trampas que costaron tiempo (no repetirlas)

1. **`onReady` del PaymentElement no se dispara.** Medido: el elemento se
   dibuja, el handle existe, y el evento nunca llega. La senal correcta es
   `onLoadingChange` de `<Payments>`. Atar el boton de pagar al evento
   equivocado deja el checkout muerto sin un solo error en pantalla.
2. **`returnUrl` tiene que ser ABSOLUTA** ("https-only, http for localhost").
3. **Importar `@stripe/stripe-js` BAJA js.stripe.com**, aunque nunca se llame a
   `loadStripe`. Se usa `@stripe/stripe-js/pure`.
4. **`STORE_COLS` es una lista explicita de columnas.** Una columna nueva que no
   se agregue ahi se lee como `undefined` sin ningun error.
5. **El dev server rompe `npm run build`** (ver mas arriba).

### Pendiente de verificar

El formulario de Whop **no termina de cargar en `http://localhost` dentro del
navegador embebido**: los iframes de `cdn.whop.com` navegan bien, la API
responde con la cuenta correcta y los tres medios de pago habilitados, pero
`onLoadingChange(false)` no llega nunca y el elemento se queda en su esqueleto.

Pasa igual en `/whop-prueba` (banco de pruebas minimo, 404 en produccion), asi
que **no es el checkout**: es el entorno o el propio SDK. Falta probarlo sobre
HTTPS real. Hasta entonces el boton de pagar queda apagado a proposito.

---

## 20/10/2026 (tarde) — en produccion

`https://checkout-eta-six.vercel.app/c/financestudylab/kit`

Dos cosas que bloqueaban y ya estan arregladas:

1. **El embudo redirigia al checkout alojado de Whop.** `funnels.checkout_host`
   / `checkout_path` apuntaban a `whop.com/checkout/ch_...` -- resto de la etapa
   anterior. En produccion el middleware lo respetaba, asi que `/c/.../kit`
   nunca llegaba a mostrar el checkout propio (ni los bonos). Campos vaciados.
2. **`desplegar.sh` no leia la direccion** y se cortaba antes de cargar las
   variables: el CLI de Vercel imprime la tabla por **stderr** y el script
   descartaba stderr. Corregido, con un respaldo que la saca del log del deploy.

### El formulario de Whop sigue sin cargar — y NO es http

Probado sobre HTTPS real, mismo resultado que en localhost:

- los 5 iframes de `cdn.whop.com` navegan bien
- Apple Pay y Google Pay funcionan (Whop crea la sesion de Google Pay, HTTP 201)
- la cuenta puede cobrar: `POST /payments` con la llave contesta
  "member_id is required unless confirmation_token is provided", o sea que
  acepta la cuenta y el plan en linea
- pero `onLoadingChange(false)` no llega nunca y la lista de tarjetas tampoco
- la consola repite: `postMessage ... target origin ('https://cdn.whop.com')
  does not match the recipient window's origin`

Pasa igual en el banco minimo `/whop-prueba`, asi que **no es el checkout**.
Queda: el navegador embebido, o un error del propio SDK (`cdn.whop.com/elements/
amber/`, canal que Whop reconstruye cada pocos minutos).

Mientras tanto el comprador **no** se queda mirando un recuadro gris: a los 12 s
aparece un aviso con un boton de reintentar que vuelve a montar el elemento.

---

## 20/10/2026 — auditoria completa

### Verificado contra lo real, no contra la base

| Que | Como se comprobo | Resultado |
|---|---|---|
| Webhook de Whop | consulta a la API de Whop | apunta a produccion, activo, 12 eventos |
| Seguridad del webhook | POST sin firma y con firma falsa a produccion | 400 las dos veces; tienda inexistente 404 |
| Entrega | listado del bucket `entregas` | los 3 PDF existen (1.31, 0.66, 0.58 MB) |
| Correo | `store_mail` + registro de fallos | casilla propia en Hostinger, 0 fallos en 7 dias |
| Cobro | `POST /payments` con la llave | la cuenta acepta cobrar |

### El diagnostico mentia en tres puntos

`diagnose_store` daba **2 errores que no existian** y ocultaba los avisos reales.
Un chequeo que grita en falso es peor que ninguno: entierra lo que si importa.

1. **`stripe_account`** — revisaba Stripe en una tienda que cobra con Whop.
   Ahora mira `stores.gateway` y, con Whop, verifica cuenta, secreto del webhook
   y ultimo evento.
2. **`mail_provider`** — solo miraba el proveedor de plataforma. Una tienda que
   manda por su PROPIA casilla (`store_mail`) salia como "los mails de entrega
   fallan" mandandolos perfectamente.
3. **`delivery_links`** — ignoraba `delivery_file`. Un PDF en el bucket privado
   es la forma MAS segura de entregar y se leia como "sin entrega".

La causa de (1) fue la misma de siempre: **`STORE_FULL_COLS` es una lista
explicita** y la columna nueva llegaba como `undefined` sin un solo error. Es la
segunda vez que pasa (la primera fue `STORE_COLS` en `db.ts`). Las dos listas
llevan ahora un comentario que lo advierte.

Despues de las correcciones: **0 errores**, 5 avisos, todos reales.

### Lo que falta, y de quien depende

| Pendiente | De quien |
|---|---|
| El formulario de Whop no termina de cargar (ver arriba) | probar en otro navegador |
| La landing todavia apunta a `#offerta`, no al checkout | **se cambia recien cuando el formulario este confirmado**: mandar visitantes a un checkout muerto es peor que no mandarlos |
| Dominio propio del checkout (DNS) | Bruno |
| Token de Conversions API del pixel | Bruno |
| `business.phone` vacio | Bruno |
| Post-pago | diferido: necesita un segundo libro |
