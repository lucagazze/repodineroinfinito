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

## Paso 2 · Elegir la pasarela por país

Hoy `stores.gateway` es una por tienda. Para que un argentino vea Mercado Pago
y un español vea tarjeta, la elección tiene que depender del comprador.

1. Decidir dónde vive la regla. Lo más simple que funciona:
   `funnels.settings.gateways` con una lista de `{paises: [...], gateway: "..."}`
   y un `gateway` por defecto. Queda junto al resto de la configuración del
   embudo y no toca el esquema.
2. Una función `pasarelaPara(funnel, pais)` que devuelva la pasarela. **Un solo
   sitio que decide**, y los 15 puntos de arriba pasan a llamarla.
3. Convertir esos 15 puntos de binario a plural.
4. El país del comprador ya se detecta para la moneda: se reutiliza.

**El riesgo real:** el país se conoce *antes* de pagar sólo por geolocalización,
que falla. Hay que decidir qué pasa si el comprador elige otro país en el
formulario de facturación después de que el checkout ya montó un motor.
Recomendación: **ofrecer las dos y que elija**, en vez de adivinar y bloquear.

**Qué desbloquea:** poder tener dos pasarelas vivas a la vez. Sin esto, sumar
Mercado Pago significa apagar Whop.

---

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

**La pregunta que decide si el paso 3 vale la pena**, y hay que contestarla
ANTES de escribir una línea:

> ¿Mercado Pago permite cobrar con una tarjeta ya guardada, sin que el
> comprador vuelva a intervenir?

Toda la cadena de post-pago —27 → 29 → 9/mes— depende de eso. Si no lo permite
con la misma facilidad que Whop, **los pagos que entren por Mercado Pago pierden
el post-pago entero**, y eso cambia por completo la cuenta de si conviene.

Mercado Pago sí tiene suscripciones (preapproval) —se usó en el sistema de
abonos del lavadero— pero un cobro suelto sobre tarjeta guardada es otra cosa y
hay que verificarlo en su documentación antes de comprometerse.

---

## Lo que yo haría, en orden

1. **Paso 1 ya.** Es chico, quita un fallo silencioso que ya existe, y no
   depende de ninguna decisión.
2. **Mirar el panel de Whop** antes del paso 2. Whop procesa en muchos países y
   puede tener métodos locales apagados. Diez minutos, y puede ahorrar los
   pasos 2 y 3 enteros.
3. **Verificar la tarjeta guardada de Mercado Pago.** Una tarde de leer su
   documentación. Si la respuesta es no, el paso 3 cambia de forma.
4. **Medir.** El embudo español todavía no vendió nada. Construir una segunda
   pasarela para un problema cuyo tamaño no se conoce es trabajo que sale caro
   y después no mueve la aguja.

Los pasos 2 y 3 juntos son varios días de trabajo y tocan el cobro, que es la
parte del sistema donde un error cuesta dinero de verdad.
