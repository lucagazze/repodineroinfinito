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

### ~~El formulario de Whop sigue sin cargar~~ — RESUELTO, ver abajo

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
**La causa real estaba en otro lado: faltaba `<BrandingElement />`. Ver abajo.**

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

---

## 20/10/2026 — RESUELTO: faltaba `<BrandingElement />`

El formulario de tarjeta se quedaba en su esqueleto gris para siempre. La causa
no era el navegador, ni `http`, ni la cuenta, ni la integracion.

**Lo dicen los propios tipos del SDK**, en `@whop/elements-react/payments.d.ts`:

> *"Whop's merchant-of-record notice... **Required — the payment, card and card
> fields elements stay in their loading state until it is mounted.**"*

Sin `<BrandingElement />` dentro de `<Payments>`, el marco `payment` NUNCA manda
su `ready`. Y no falla con un error: queda vivo, emitiendo eventos, mostrando su
propio cargador encima de un formulario que ya existe.

### Como se encontro (sirve para la proxima)

Lo que destrabo el diagnostico fue **registrar el dialogo entre ventanas desde
ANTES de `loadWhop()`** — un listener puesto despues no ve el saludo, que ocurre
en los primeros 300 ms. Esta en `src/app/whop-prueba/page.tsx` (404 en produccion).

Con eso a la vista, la asimetria salto sola:

```
_toaster                      boot -> ready -> resize -> loading
billing-address-suggestions   boot -> resize -> ready -> resize -> loading
payment                       boot -> resize -> loading -> (eventos) ... SIN ready
```

Y el marco payment ya estaba funcionando: mandaba `selectionChanged type:card`,
`addressChange country:AR` y `charge {configured:true, amount:3700}`.

### Lo que se descarto por el camino, con prueba

| Hipotesis | Como se descarto |
|---|---|
| Es `http://localhost` | pasa igual sobre HTTPS en produccion |
| Es el navegador embebido | Bruno lo vio igual en su Chrome |
| La cuenta no puede cobrar | `POST /payments` responde pidiendo el token, no rechazando |
| Es la integracion del checkout | el banco minimo fallaba identico |
| Version del SDK atrasada | 1.9.0 instalada = 1.9.0 publicada |
| Una CSP bloquea los marcos | la app no manda ninguna CSP |

### La leccion

**Leer los tipos del paquete antes de buscar la causa afuera.** La respuesta
estaba en un comentario del `.d.ts` instalado, no en la red. Se perdieron varias
vueltas probando entornos cuando `grep -n "Required" node_modules/@whop/...`
lo resolvia.

---

## 20/10/2026 — la primera venta real se cobro y NO se entrego

Un pago de 1 USD entro bien en Whop y el comprador no recibio nada: vio
"no encontramos tu pedido" (en italiano) y el panel marcaba 0 ventas.

**Cuatro errores encadenados, todos mios, todos por suponer la forma de los
datos en vez de medirla.**

### 1. El importe no es un numero

`settlement_amount`, `total` y `subtotal` son OBJETOS de dinero:

```json
{"currency":"usd","amount":"1.00","decimals":2,"display_decimals":2}
```

con el importe en CADENA y en unidades mayores. Y en un cobro con token
`settlement_amount` **ni siquiera viene**. Se intentaba guardar el objeto entero
en una columna numerica:

```
invalid input syntax for type numeric: "{"currency":"usd","amount":"1.00",...}"
```

El webhook devolvia 500 con el dinero ya cobrado. Y como la pagina de gracias
rescata por el MISMO camino, tampoco podia salvarlo.

Arreglado en `src/lib/whop-montos.ts`, sin dependencias, con 11 casos de prueba.
El primero es el cuerpo EXACTO del pago que se perdio.

### 2. El pago no trae el correo del comprador

Whop da `user: {id, username, name}` y nada mas. `fulfill` tira error sin correo,
asi que la entrega habria fallado igual con el importe arreglado. Ahora se
resuelve desde la fila del checkout por `metadata.checkout`.

### 3. El checkout quedaba `open` despues de pagar

`fulfill` lo enlaza por `stripe_payment_intent`, y `/api/whop/pay` nunca escribia
el id del pago en esa fila (con Stripe lo hace `/api/pi`). Un checkout `open`
cuenta como carrito abandonado: **le hubiera salido el mail de recuperacion a
alguien que ya habia comprado**. Ahora se escribe al cobrar Y `fulfill` enlaza
tambien por `metadata.checkout`.

### 4. La pagina de gracias hablaba en italiano

`DEFAULT_LOCALE` es `it` (la app nacio para una tienda italiana). Sin pedido
caia ahi en vez de al idioma de la tienda. Ahora usa `stores.default_locale`.

### Lo que SI funcionaba

La verificacion de firma del webhook, que era mi principal sospechoso, estaba
perfecta. Se perdio tiempo mirando ahi.

### La leccion

**Medir la forma de la respuesta antes de escribir el codigo que la consume.**
Un `console.log` del primer pago real hubiera ahorrado los cuatro. El tipo
`PagoWhop` estaba escrito desde la documentacion, no desde un cuerpo real.

---

## Trampa del dominio propio (20/10/2026)

Apenas se asigna un dominio propio al proyecto, **Vercel lo reporta como
"Latest Production URL" aunque su DNS no resuelva**. `desplegar.sh` lo leia de
ahi y lo cargaba como `PUBLIC_BASE_URL`: los mails de entrega habrian salido con
enlaces muertos y los 16 crons apuntando a la nada.

Ahora el script **comprueba que la direccion responda** antes de escribirla, cae
a la de `vercel.app` si la propia todavia no resuelve, y si ninguna responde se
niega a tocar las variables.

Para activar el dominio: `python3 dominio.py` comprueba CNAME, resolucion,
certificado y que SIRVA el producto; `--activar` solo lo carga en
`stores.domain` si las cuatro pasan. Cargarlo antes hace que el middleware
redirija a un sitio que no existe y el checkout muere para todos.
