# Plan: enrutar por país y sumar Mercado Pago

Escrito el 26/10/2026. Lo que sigue sale de leer el código, no de estimar.

---

## El diagnóstico

La aplicación trata la pasarela como un **binario**, no como una lista. Hay
**15 puntos** donde se decide, y todos tienen la forma `whop ? A : B`:

| archivo | línea | qué decide |
|---|---|---|
| `c/[store]/[funnel]/page.tsx` | 92, 109, 114 | qué motor de pago renderiza el checkout |
| `c/[store]/[funnel]/CheckoutClient.tsx` | 219 | qué componente de pago monta |
| `gracias/page.tsx` | 84 | cómo interpreta un fallo de pago |
| `lib/catalog.ts` | 118 | si la página pública de precios pide datos de Stripe |
| `lib/admin/setup.ts` | 23, 29 | qué datos exige el alta de la tienda |
| `lib/admin/diagnostico.ts` | 62 | qué comprueba el diagnóstico |
| `lib/admin/offer-audit.ts` | 359 | qué webhook audita |
| `lib/admin/catalog-status.ts` | 162 | qué estado muestra el panel |
| `lib/mcp/read-tools.ts` | 388-389 | qué reporta el MCP |

Sumar una tercera pasarela obliga a convertir esos 15 en decisiones de tres
ramas. Varios además codifican reglas de negocio —Stripe exige teléfono,
`setup.ts:23`— que necesitan una respuesta propia para Mercado Pago.

**El trabajo caro no es escribir el módulo de Mercado Pago. Es que la
abstracción de pasarela es binaria y tiene que volverse plural primero.**

---

## El fallo que hay que arreglar antes que nada

`api/upsell/route.ts`, líneas 63-69:

```ts
const whop = await conexionDe(order.store_id);
if (whop) return cobrarConWhop(req, body, order, whop);
const { stripe, livemode } = await stripeForStore(order.store_id);
```

El cobro de un clic del post-pago **no lee `stores.gateway`: lo adivina** a
partir de qué conexión existe en la tienda.

Con dos pasarelas funciona por casualidad. Con tres, una tienda que tenga Whop
y Mercado Pago conectados cobraría **siempre** por Whop, incluso a un comprador
que pagó por Mercado Pago y que no tiene ninguna tarjeta guardada en Whop. Y
fallaría en silencio, que es la peor forma de fallar cuando hay dinero.

**Arreglo:** el pedido tiene que recordar con qué pasarela se cobró
(`orders.gateway`), y el post-pago tiene que leer ese campo. Es un cambio
pequeño, es independiente de Mercado Pago, y conviene hacerlo **ya**, porque
hoy ya es frágil.

---

## Paso 1 · Que el pedido recuerde su pasarela — HECHO el 26/10/2026

**Correccion del plan original.** Este paso decia «hay que crear
`orders.gateway` y rellenarlo». Era falso: **la columna ya existia**. Se llama
`orders.provider`, la escribe `fulfill.ts` desde hace tiempo, es NOT NULL con
defecto `'stripe'`, y esta correctamente poblada — 7 pedidos de Whop y 2 de
Stripe al verificarlo.

El fallo era solo el que se describe arriba: dos sitios que **no la leian**.

**Lo que se cambio:**

| archivo | antes | ahora |
|---|---|---|
| `api/upsell/route.ts` | `conexionDe(store)` y si hay, Whop | `if (order.provider === "whop")` |
| `app/oferta/[step]/page.tsx` | lo mismo, para el `livemode` | idem |
| `lib/order-lookup.ts` | no traia `provider` | lo trae |

Y un caso que antes no existia: un pedido cobrado por Whop cuya tienda ya no
tiene Whop conectado. Antes caia a Stripe —es decir, intentaba cobrarle a otra
tarjeta—; ahora devuelve 503 y deja el pedido en los registros.

**Verificado:** `tsc --noEmit` limpio. Falta la prueba de verdad, que es un
pedido real de cada pasarela recorriendo el post-pago.

## Paso 2 · Elegir la pasarela por país — A MEDIAS el 26/10/2026, a propósito

**Hecho: la regla vive en un solo sitio.** `src/lib/pasarela.ts` con tres
funciones, y la distinción que el fallo del paso 1 demostró que hacía falta:

| función | contesta | se usa para |
|---|---|---|
| `pasarelaDeTienda` | con qué cobra esta tienda | configuración, panel |
| `pasarelaDePedido` | con qué se cobró ESTE pedido | post-pago, renovación, reembolso |
| `pasarelaParaComprador` | con qué va a cobrar este comprador | el checkout, antes de que haya pedido |

El camino del comprador ya no tiene ninguna decisión suelta: el checkout, el
cobro de un clic y la página del post-pago llaman a estas funciones. Las seis
que quedan están en panel, diagnóstico y MCP, y ahí la pregunta **sí** es de la
tienda, así que se quedan.

`pasarelaParaComprador` ya recibe el país. Hoy no lo usa.

**NO hecho, y es deliberado: dónde se guarda la regla de enrutado.**

El plan proponía `funnels.settings.gateways`. Al ir a escribirlo apareció que
`resolveSettings` **solo valida booleanos, números y cadenas**: una lista de
reglas metida ahí se descartaría en silencio, que es exactamente la clase de
fallo que este plan existe para evitar.

Las alternativas son una columna propia o una tabla, y las dos son decisiones
de esquema que conviene tomar con la segunda pasarela delante — sabiendo qué
necesita de verdad — y no antes. Diseñar un esquema para un requisito que no se
puede probar es como se llega a tener dos verdades.

**Lo que esto deja listo:** el día que exista Mercado Pago, enrutar por país es
cambiar `pasarelaParaComprador` y decidir dónde se guarda la regla. No hay que
tocar el checkout ni el post-pago.

**Verificado:** `tsc --noEmit` limpio y `next build` completo. El
comportamiento es idéntico — `pasarelaDeTienda` devuelve literalmente la misma
expresión que estaba repetida antes.

## Paso 3 · Mercado Pago como tercera pasarela

El molde existe y es Whop. Lo que hay que escribir, con su equivalente al lado:

| nuevo | equivale a | líneas del molde |
|---|---|---|
| `lib/mercadopago.ts` | `lib/whop.ts` | 221 |
| `lib/mercadopago-events.ts` | `lib/whop-events.ts` | 335 |
| `lib/mercadopago-connect.ts` | `lib/whop-connect.ts` | 92 |
| `lib/mercadopago-firma.ts` | `lib/whop-firma.ts` | 75 |
| `lib/mercadopago-montos.ts` | `lib/whop-montos.ts` | 46 |
| `motor-mercadopago.tsx` | `motor-whop.tsx` | 270 |
| `api/mercadopago/pay/route.ts` | `api/whop/pay/route.ts` | — |
| `api/mercadopago/webhook/[storeId]` | `api/whop/webhook/[storeId]` | — |
| tabla `store_mercadopago` | `store_whop` | — |

Más el alta en el panel y el cifrado de credenciales, que ya existe y se
reutiliza (`SECRETS_KEY`, AES-256-GCM).

### La pregunta que decidía el paso 3 — CONTESTADA el 26/10/2026

> ¿Mercado Pago permite cobrar con una tarjeta ya guardada, sin que el
> comprador vuelva a intervenir?

**Sí, pero no con el producto que uno supondría, y pide un permiso que hoy no
tenemos.** Hay tres caminos y sólo uno sirve para el post-pago:

| camino | ¿cobra sin el comprador? | permiso | sirve para |
|---|---|---|---|
| Checkout API · tarjetas guardadas | **No** — exige el CVV cada vez | ninguno | un 1-clic con un campo de CVV |
| Suscripciones (`/preapproval`) | **Sí**, en su ciclo | ninguno | los 9/mes |
| **Pagos automáticos** (MIT) | **Sí**, monto y momento libres | **autorización comercial** | el salto de 27 → 29 |

Lo literal de cada uno, de la documentación oficial:

- Tarjetas guardadas: «Para que un cliente efectúe un pago con tarjetas
  guardadas, debes capturar nuevamente el código de seguridad (CVV) de la
  tarjeta, ya que Mercado Pago no almacena este dato por razones de seguridad.»
  No es un detalle de implementación: es el diseño del producto.
- Pagos automáticos: «Realiza pagos recurrentes, pagos únicos sin fricción y
  one-click payments sin solicitar el CVV», con «transacciones procesadas
  automáticamente, sin intervención del cliente». Y el requisito: «Es necesario
  contar con la autorización del equipo Comercial para poder utilizar esta
  solución.»

El cobro suelto se marca en el propio `POST /v1/payments`:

```
point_of_interaction.type     = "CREDENTIAL_ON_FILE"
point_of_interaction.sub_type = "unscheduled"   // "recurring" para suscripción
transaction_initiator         = "merchant"      // MIT, no CIT
```

**Aviso para quien lo implemente:** Mercado Pago tiene dos generaciones de API
conviviendo y los campos **no se llaman igual**. La vieja (`/v1/payments`) usa
`point_of_interaction` y `transaction_initiator`; la nueva, de Orders, usa
`payment_initiator`, `reason` y `first_payment`. Copiar un ejemplo de la
generación equivocada compila y falla en producción. Fijar una generación antes
de escribir nada.

**Qué implica para el paso 3:** se parte en dos trabajos con riesgos distintos.
Los 9/mes se pueden hacer ya, sin pedir permiso a nadie, con `/preapproval` —el
mismo endpoint del sistema de abonos del lavadero—. El salto de 27 → 29 queda
detrás de una autorización comercial que no depende de nosotros y que, si la
niegan, degrada a «1-clic con CVV»: más friccion, pero el embudo no se cae.

Lo que **no** está verificado, porque sólo lo puede contestar Mercado Pago sobre
la cuenta concreta: si le dan esa autorización a un vendedor de infoproductos
sin volumen previo. Es la única fuente que encontré del requisito —su propia
página de Argentina— y no pude corroborarla en otra; tampoco encontré los
criterios que aplican. Eso se pregunta, no se deduce.

---

## Lo que yo haría, en orden

1. **Paso 1 ya.** Es chico, quita un fallo silencioso que ya existe, y no
   depende de ninguna decisión.
2. **Mirar el panel de Whop** antes del paso 2. Whop procesa en muchos países y
   puede tener métodos locales apagados. Diez minutos, y puede ahorrar los
   pasos 2 y 3 enteros.
3. ~~Verificar la tarjeta guardada de Mercado Pago.~~ **Hecho.** Sí se puede,
   con «Pagos automáticos», y pide autorización comercial. Lo siguiente es
   preguntarles si dan esa autorización — es gratis y bloquea medio paso 3.
4. **Medir.** El embudo español todavía no vendió nada. Construir una segunda
   pasarela para un problema cuyo tamaño no se conoce es trabajo que sale caro
   y después no mueve la aguja.

Los pasos 2 y 3 juntos son varios días de trabajo y tocan el cobro, que es la
parte del sistema donde un error cuesta dinero de verdad.

---

## Paso 3a · Los 9/mes — ESCRITO Y VERIFICADO el 26/10/2026, SIN APLICAR

### Lo que se encontro al empezar

La suscripcion no esta acoplada a Whop en el codigo: lo esta en el ESQUEMA.
`subscriptions.whop_membership_id`, `subscription_events.whop_payment_id`.

Eso no es cosmetico. **Lo que impide contar dos veces una renovacion son dos
indices unicos sobre `whop_payment_id`** (migracion 007, escrita despues de
medir 4 pagos y USD 76 donde hubo 3 y USD 57). Un cobro de Mercado Pago no
entra en esa columna, asi que entraria SIN esa proteccion — y Mercado Pago
reintenta los webhooks.

Y hay **cero filas** en `subscriptions`. Nadie se suscribio nunca, por ninguna
pasarela. Es el momento mas barato de la vida del proyecto para renombrar, y esa
ventana se cierra el dia que alguien se suscribe.

### Lo que esta hecho

`supabase/migraciones/009-suscripcion-pasarela.sql`, 376 lineas:

- `provider` en las dos tablas, con check `('whop','stripe','mercadopago')`
- `whop_membership_id` → `external_id`, y las otras tres de `subscriptions`
- `whop_payment_id` → `external_payment_id` en la bitacora
- los dos indices de idempotencia pasan a `(provider, external_payment_id)`
- `sub_cobro` y `sub_fallo` reciben `p_provider`. Se DROPEAN antes de crearse:
  sumar un parametro en Postgres crea una SEGUNDA funcion, y con las dos vivas
  PostgREST falla por ambiguedad
- `sub_vencer` y `sub_baja` se recrean para que sus eventos hereden la pasarela
  de la suscripcion en vez del default `'whop'`
- `sub_cobro` detecta y anota el caso de **cambio de pasarela**: la clave unica
  es (tienda, producto, mail) sin pasarela, asi que alguien suscripto por Whop
  que se suscribe por Mercado Pago actualiza la fila que habia, y si la
  membresia vieja sigue viva lo estan cobrando DOS VECES. No se puede arreglar
  dentro de una transaccion — cancelar es una llamada HTTP — asi que se deja en
  la bitacora y se devuelve `cambio_pasarela: true`

Y en el codigo: `suscripcion.ts`, `api/suscripcion/baja`, `suscripcion/[token]`.
Nuevo `cancelarEnPasarela(provider, ...)`: la baja cancela donde de verdad se
cobra, que lo dice la SUSCRIPCION y no la tienda — el mismo razonamiento de
`pasarelaDePedido` que ya arreglo un fallo en el upsell.

NO se tocaron `products.whop_plan_id`, `funnels.whop_plan_id` ni
`orders.whop_member_id`: son del camino del upsell, los leen ocho scripts, y
Mercado Pago no necesita un id de plan (su suscripcion lleva el monto y la
frecuencia adentro: preapproval sin plan asociado).

Verificado: `tsc --noEmit` limpio y `next build` completo.

### POR QUE NO ESTA APLICADO, Y QUE FALTA

La migracion renombra columnas en la base de produccion y quedo **bloqueada por
permisos**. Hasta que se aplique:

> **NO HACER PUSH DE ESTA RAMA.** El codigo ya lee `external_id` y la base
> todavia tiene `whop_membership_id`. Desplegar primero rompe el panel de
> suscripciones y la ruta de baja.

El orden correcto es: aplicar la migracion, comprobar el esquema, y recien
entonces hacer push. Entre las dos cosas hay una ventana en la que el panel de
suscripciones da error — con cero suscriptores, no afecta a nadie que pague.

### Lo que viene despues, con las formas ya verificadas

| | |
|---|---|
| crear | `POST https://api.mercadopago.com/preapproval` con `reason`, `external_reference`, `payer_email`, `back_url`, `status: "pending"` y `auto_recurring {frequency, frequency_type, transaction_amount, currency_id}`. Devuelve `id` e `init_point`, que es la URL a la que se manda al comprador |
| cancelar | `PUT /preapproval/{id}` con `{"status":"cancelled"}`. Estados: `authorized`, `paused`, `cancelled` |
| webhooks | topics `subscription_preapproval` y `subscription_authorized_payment`. Cuerpo `{type, action, data.id}`; firma HMAC en `x-signature` (`ts=…,v1=…`) mas `x-request-id` |

Lo que todavia NO esta verificado y conviene medir, no suponer: si la
cancelacion de Mercado Pago es inmediata o a fin de periodo. Su documentacion
no lo dice, y de eso depende si alguien que se da de baja conserva el acceso
que ya pago — que es como esta escrito `sub_baja`.
