# Empezar

## Qué es esta app y cómo leer esta guía {#empezar}
Esta app es una plataforma de checkout propia para vender productos digitales (por ejemplo, libros en PDF): checkout con Stripe **o Whop** (cada tienda elige), post-pago de 1 clic, entrega por mail, panel con ventas y métricas, y un piloto de pujas para Meta Ads.

Esta guía es el centro de información: qué es cada sección, cómo se carga cada cosa y qué reglas de seguridad sigue la app. Sirve igual para una persona que para una IA.

- **Si eres una IA conectada por MCP:** lee esta guía entera con `get_guide` antes de cargar nada. Para una parte sola: `get_guide` con `section` (por ejemplo `oferta-nueva`, `post-pago`, `drive`).
- **Si eres una persona:** en el panel, el botón **?** de la barra de arriba abre la parte de la guía de la página donde estás.
- Si algo de la guía no coincide con lo que ves en la app, manda la app; avisa al responsable para corregir la guía.

### Al empezar cada sesión: revisar lo pendiente
1. `catalog_status` (con `refresh: true` si tiene más de una hora): catálogos y cuentas de la pasarela (Stripe o Whop). Trae `fix_prompt` con qué hacer en cada caso. Lo que se cambia en el panel de Stripe (descripción, sitio web, soporte, descriptor) lo hace a mano el dueño de la cuenta: se le entrega la lista con el texto exacto.
2. `list_alerts`: avisos abiertos (entregas, rebotes, contenido pendiente, post-pagos vacíos).
3. Contenido pendiente: los productos vendidos en preventa que todavía hay que terminar.
En el Inicio, la tarjeta **«Para hacer»** junta todo eso con su número.

### Reglas básicas
1. **Nunca inventar** precios, links, nombres de productos, testimonios ni contenido. Si falta un dato, se pregunta.
2. **El checkout y el post-pago nunca se caen.** Antes de mandar tráfico se verifica todo (ver «Verificar antes de mandar tráfico»).
3. **Nada que vea un comprador sin verificarlo**: abrir cada link del mail de entrega y simular el post-pago con y sin bumps.
4. **No tocar anuncios activos ni mandar mails a compradores reales** sin que el responsable lo pida para ese caso.

## Conectar otra computadora u otra IA {#conectar}
**Lo más rápido:** en el panel, «Guía de la app» → **«Crear link para compartir»**. Genera una clave nueva y un link; pega ese link en el chat de la IA y que lo abra: ahí está el prompt con el código de conexión y esta guía. O «Copiar con clave nueva» y pegar el texto directo. La clave da acceso total a la app: compártela solo con chats y computadoras de confianza. Se revoca desde la tabla de claves y el link deja de funcionar.

A mano:
1. Instalar un cliente compatible con MCP (por ejemplo Claude Code).
2. Crear una **clave de MCP propia** para esa computadora en la tabla de claves (se puede revocar sola, sin afectar a las demás) y conectar:
   `claude mcp add --transport http --scope user checkout https://<tu-dominio-de-la-app>/api/mcp --header "Authorization: Bearer <clave>"`
3. Probar: «lista las tiendas». Si responde con tus tiendas, funciona.
4. Primer mensaje a la IA: «Lee la guía de la app con get_guide y después…».
5. **Drive** (si se van a subir archivos): compartir como **Editor** la carpeta raíz de los productos con la cuenta de Google de quien sube (ver «Drive»).
6. **Landings** (solo si se van a tocar): acceso al repositorio del sitio y al proyecto de hosting.

La clave es privada: nunca se publica, ni en un repositorio ni en un chat compartido.

## Cómo funciona la app por dentro {#mecanismo}
El recorrido de una venta, de punta a punta:
1. **Anuncio → landing** (en el sitio de la marca, por ejemplo `www.tumarca.com`). La landing tiene el píxel de la oferta y sus botones van al checkout.
2. **Checkout**: vive en la app pero puede verse en el dominio de la marca (un rewrite del sitio manda, por ejemplo, `/es/mi-oferta/pago` a la app). Muestra el producto, los bonus, los order bumps y la garantía; cobra con la cuenta de Stripe de esa tienda (tarjeta, Apple Pay, Google Pay, Klarna según la moneda). Guarda IP, dispositivo y UTM de cada comprador.
3. **Pago aprobado** → la app crea el pedido (#número), manda el **mail de entrega** con el link de cada producto (y registra aperturas y clics), envía la compra al píxel por la API de Conversiones y manda la notificación push «Venta».
4. **Post-pago**: justo después de pagar, la página de oferta única (OTO) ofrece el nivel 1; un clic cobra la misma tarjeta sin volver a cargarla. Si la rechaza, se ofrece el downsell; después los niveles siguientes. Cada OTO aceptado manda su mail de entrega y su push.
5. **Gracias** → fin. Si alguien deja el checkout con el mail cargado, pasada la espera configurada (1 hora por defecto) le llega el **mail de carrito**, con el descuento que tenga configurado.
6. **Tareas automáticas**: cada pocos minutos, el repaso de avisos (entregas, rebotes, webhooks, post-pagos vacíos, contenido pendiente); cada 15 min se traen los datos de Meta (gasto y compras por campaña) y de Stripe (lo cobrado y las comisiones reales); el piloto ajusta pujas de las campañas con límite de puja.
7. **Panel**: todo lo anterior se ve en Inicio, Ventas, Clientes, Carritos, Métricas, Avisos, Contenido pendiente y Piloto.

Lo que más rompe una venta: un link de entrega sin compartir públicamente, un archivo incompleto, dos píxeles en la misma página, un post-pago sin nada para quien ya se llevó todos los bumps y un checkout cambiado sin probar. Por eso se verifica antes de mandar tráfico.

# Conceptos

## Tiendas, ofertas, mercados y productos {#conceptos}
**Tienda** = una marca, con su propia **pasarela de cobro** (Stripe o Whop), dominio y remitente de mails. Se identifica por `slug` (por ejemplo `mitienda`). Conviene tener además una tienda de pruebas con Stripe en modo test.

**Oferta** = la unidad de negocio, por ejemplo «Mi Oferta España»: un producto principal + bonus gratis + order bumps + post-pago por niveles + landing + píxel + campañas. Las ofertas del mismo tema en varios países comparten **categoría**: así se agrupan en el selector del panel.

**Mercado** = un checkout de la oferta para un país o moneda (`market_label`: «España», «EE. UU.», «Reino Unido»…). Una oferta puede tener varios.

**Producto** = un archivo (o pack) con su `kind`:
- `main`: el principal que vende la landing.
- `bonus`: regalo, precio 0, con `display_value` = el valor que muestra la landing.
- `upsell`: order bump (se marca en el checkout).
- `postcompra`: OTO, se ofrece después de pagar con 1 clic.
Un pack lleva `includes` con los slugs que trae. Si dos productos son el MISMO archivo, el segundo lleva `variant_of` = el primero (así nunca se le vende a alguien lo que ya tiene).

**Precios**: cada producto tiene `prices` por moneda. La app cobra en la moneda del comprador, convertida desde los precios cargados cuando ese mercado no tiene precio propio. Todo monto en la app va en unidades MAYORES (19.90 = 19,90 €, nunca céntimos).

## Con qué cobra cada tienda {#pasarela}

La app cobra con **Stripe** o con **Whop**, y lo decide cada tienda en
`stores.gateway`. **No se adivina por qué conexión existe**: durante una
migración las dos conviven, y adivinar haría cobrar con la que se conectó
último. El checkout monta una sola.

| | Stripe | Whop |
|---|---|---|
| Quién vende ante el banco | tu tienda | **Whop** (comerciante de registro) |
| Razón social y descriptor | los tuyos | los de Whop |
| Catálogo para revisión | lo revisa Stripe | lo revisa Whop sobre su cuenta |
| Conectar | `connect_stripe` | `connect_whop` |

**Lo único que no se puede perder con Whop:** el secreto de firma del webhook
(`ws_...`). Whop lo muestra **una sola vez**, al crear el webhook. Sin él, cada
pago cobrado se rechaza y **no se entrega nada** — y no falla de forma visible:
el dinero entra, el comprador espera, y el panel no muestra la venta. Si se
perdió, se rehace el webhook en Whop y se vuelve a conectar pegando el nuevo.

`diagnose_store` y `catalog_status` revisan la pasarela que la tienda usa de
verdad, así que en una tienda de Whop no piden nada de Stripe.

## Píxeles de Meta {#pixeles}
**Un píxel por oferta (o por tema)** ayuda a que Meta aprenda de ese público y no se mezcle la atribución. **Un solo píxel por landing y por checkout**: dos píxeles en la misma página inflan las compras.

Cómo se agrega uno: se crea en el Administrador de eventos de Meta → `upsert_pixel` con su `capi_token` (token con permiso sobre ese píxel) → `test_pixel` hasta que Meta lo reciba → se asocia al checkout (`pixel_ids`) y se pone en la landing.

La lista siempre al día sale de `list_pixels`.

# Cargar una oferta

## Drive: dónde va cada archivo {#drive}
La entrega se hace con links a carpetas de Google Drive. Una estructura recomendada, una carpeta por oferta:

- `<Oferta>/Productos/<Nombre del producto>/<archivo>.pdf` → **una carpeta por producto** (principal, cada bonus, cada bump, cada OTO).
- `<Oferta>/Ads/` → los anuncios de esa oferta (videos e imágenes).
- `<Oferta>/Portadas/` → tapas y mockups (opcional).

Reglas:
1. Cada carpeta de entrega se comparte **«cualquier persona con el enlace puede ver»**. El link de esa CARPETA es el `delivery_url` del producto.
2. La carpeta de anuncios también se comparte con el enlace; si no, la vista previa del panel no reproduce.
3. Tapas e imágenes reales del producto, en el idioma de la oferta. Para la web, formato WebP.
4. Mismo archivo en dos productos → el segundo lleva `variant_of` = el primero.
5. Para subir archivos grandes: Google Drive para escritorio o una herramienta como `rclone` autorizada con la cuenta que tiene permiso de Editor. Una cuenta de servicio sin espacio propio no sirve para subir.

### Cada archivo se sube completo
Todo archivo que va a una carpeta de entrega tiene que estar terminado, tal como lo recibe el comprador: portada en la primera página, índice, todas las páginas, idioma correcto y nombre de archivo = nombre del producto. Después de subirlo, abre el link como lo abriría el comprador (sin sesión) y confirma que el archivo está y abre. Un archivo incompleto es el reclamo más común y termina en reembolsos y contracargos.

## Cómo se hacen los libros (rápido, bien y barato) {#hacer-libros}
La app no fabrica el contenido: recibe archivos terminados. Cómo se produce cada libro o archivo depende de cada negocio. Lo único que la app necesita es que el archivo final esté completo (ver «Cada archivo se sube completo» en «Drive») y en su carpeta de entrega antes de mandar tráfico, o que el producto esté marcado como preventa (ver «Contenido pendiente»).

## Subir una oferta nueva, paso a paso {#oferta-nueva}
### 1. Material
Subir a Drive (ver «Drive») el archivo de cada producto, en su carpeta, compartida con el enlace. Tener la tapa real de cada uno.

### 2. Productos (`upsert_product`)
- Uno por archivo, todo en el idioma de la oferta: `name`, `short_name`, `description`.
- `prices` por moneda (EUR / USD / GBP según mercado).
- **Los precios tienen que coincidir en todos lados**: landing (precio, precio tachado, «ahorras X», valor de los bonus), checkout, página del OTO y mails. Si cambias un precio en la app, cámbialo también en la landing, y al revés. Un precio distinto entre landing y checkout es motivo clásico de reclamos y contracargos.
- `delivery_url` = la carpeta de Drive. `image` = la tapa real (súbela con `upload_media`).
- **Precio tachado del principal** (`compare_at`) = el total que declara la landing − la suma de los `display_value` de los bonus (así el «ahorras X» del checkout coincide con la landing). Revisa la normativa de cada país: en algunos (por ejemplo Alemania) el precio tachado tiene restricciones.
- Producto que todavía no existe: ver «Contenido pendiente».

### 3. Checkout (`create_checkout`, después `update_checkout`)
- Para ir rápido, copia estilo y ajustes de un checkout del mismo idioma (`get_checkout` de ese checkout).
- Ajustes recomendados: `locale` fijo del idioma · de 1 a 3 order bumps · garantía clara · recuperación de carrito configurada (`recovery.discountPercent`). Revisa la normativa local: en algunos países la recuperación por mail o los descuentos tienen restricciones.
- Un bump nunca es un producto que la oferta ya regala como bonus.
- Bumps **nunca pre-marcados** (`bumps.preselect` false: en la UE no está permitido).
- `pixel_ids` = el píxel de la oferta.
- `upsert_offer` para crear la oferta con su categoría y `market_label`, así aparece en el panel.

### 4. Post-pago
Ver «Post-pago: cómo se arma». Siempre simulado antes de publicar.

### 5. Landing y dirección pública
Ver «Landings». Solo después de verificar todo se cambia el botón de la landing.

### 6. Anuncios
Ver «Anuncios». Al lanzar campañas, vincúlalas al checkout (`update_checkout` → `meta_campaign_ids_add`) para que su gasto cuente en el panel.

## Post-pago: cómo se arma {#post-pago}
Herramientas: `upsert_postpurchase`, `upsert_pp_step`, `simulate_postpurchase`.

1. **Niveles**: el post-pago es una cadena de OTO (nivel 1, 2, 3…). Cada nivel puede tener **un downsell**: normalmente el mismo producto a menor precio, cargado como producto aparte con `variant_of` = el OTO y el mismo `delivery_url`.
2. **Varía los niveles**: forma (un pack, un producto suelto), precio y diseño de página. Un pack lleva `includes` y el motor saltea los niveles de abajo a quien ya lo compró.
3. **El nivel 1 puede cambiar según lo que se llevó en el checkout** (alternativas con `show_if` `checkout_none` / `checkout_any`).
4. **Al menos un nivel tiene que ser algo que ningún bump dé**: si no, quien compra todos los bumps no ve nada.
5. Nunca ofrecer algo que ya tiene: el motor lo saltea solo si `includes` y `variant_of` están bien cargados.
6. Precios en escalera de mayor a menor y packs más baratos que la suma de los sueltos.
7. **Verificar siempre con `simulate_postpurchase`**: sin bumps, con 1 bump y con TODOS los bumps. `checks` vacío y la cantidad de niveles esperada para quien rechaza todo.
8. **Portadas por separado**: un OTO que es un pack muestra **cada producto en su propia tarjeta** (tapa, nombre y descripción), armado solo desde `includes`. Por eso cada producto incluido necesita su `image_url` y una `description` corta. Si el producto tiene páginas de muestra (`postcompra_page.gallery.images`), su tarjeta trae «Ver N páginas» con vista previa a pantalla completa.
9. La página de cada OTO sale de los datos del producto (`postcompra_page`, con los tokens `{price}`, `{compare}`, `{product}`, `{first-name}`, `{order-number}`; `**negrita**` funciona en pitch, intro y bullets) o es una página HTML propia (`set_postcompra_html`).

## Contenido pendiente (libros que todavía no existen) {#contenido-pendiente}
La app permite **vender un producto en preventa**, antes de que el archivo esté terminado, y avisar a los compradores cuando llega.

1. Crear el producto con nombre, descripción, precio y portada, en el idioma de la oferta.
2. Su carpeta de Drive (la del `delivery_url`, compartida con el enlace) lleva solo un **documento de texto** (Word o Google Docs, **no PDF**) que explica cuándo llega el contenido, en el idioma del comprador. Nombre sugerido: «LÉEME - próximamente» / «READ ME - coming soon».
   - **Por qué no PDF:** la app revisa las carpetas y marca el producto «listo» en cuanto aparece un PDF. Ignora los PDF que se llaman como un aviso, pero con un documento de texto no hay confusión posible.
   - **Plazo relativo, nunca fecha fija**: «llega en N días desde tu compra». Una fecha exacta se vence para quien compra después.
3. En la app: `upsert_product` con `presale: true` y `presale_days: N` en el producto y en su variante (downsell). Conviene cargar el plan: `presale_pages` (cuántas páginas tendrá) y `presale_outline` (el índice). El comprador ve el plazo en el OTO, el bump y el mail.
4. En el panel aparece en **Contenido pendiente** con el vencimiento (primera compra + N días) y avisos 24 h antes y al atrasarse.
5. Cuando se sube el archivo final a ESA MISMA carpeta, la app lo detecta sola (revisa cada 15 min, o con «Revisar carpetas ahora»). Solo lo da por hecho si es un PDF real y de tamaño razonable (1 MB o más); un aviso o una hoja suelta no cuentan. El panel muestra el nombre y el peso del PDF encontrado.
6. Ahí, **«Avisar a N»** reenvía la entrega a quienes lo compraron antes de que estuviera listo (quien compra después ya recibe la carpeta con el archivo). El documento de aviso se mueve solo a una carpeta de avisos resueltos si se llama como un aviso; si tiene otro nombre queda marcado en rojo y no se puede avisar hasta quitarlo.

## Landings y dirección pública {#landings}
Las landings viven en el sitio de cada marca. Un esquema de rutas típico: `/<idioma>/<oferta>` para la landing y `/<idioma>/<oferta>/pago` (o `/checkout`) para el checkout.

Orden para conectar (así nunca queda nada caído):
1. En el sitio, el rewrite al checkout, por ejemplo en `vercel.json`: `{"source": "/es/mi-oferta/pago", "destination": "https://<tu-dominio-de-la-app>/es/mi-oferta/pago"}`.
2. Botones de la landing (los `data-checkout`) → la URL pública del checkout.
3. Publicar el sitio y comprobar que el despliegue tiene el cambio.
4. Después: `update_checkout` con `public_url`, `landing_url` y `meta_campaign_ids_add`.
5. Probar en vivo: la landing manda al checkout y el checkout responde 200 con el producto correcto.

Antes de desplegar un sitio: `git pull` y `git status`. Si hay cambios que no son tuyos, no despliegues sin preguntar.

Textos legales: describe la garantía con sus condiciones reales. Checkout y landing siempre en el idioma del comprador, imágenes incluidas.

## Anuncios: los 3 por oferta {#anuncios}
Cada oferta tiene una sección **Ads** en el panel para guardar sus creativos y ver cómo rinden. Una práctica útil es probar varios formatos por oferta (por ejemplo tres ángulos distintos) y comparar.

**Dónde se alojan:**
1. Subir los videos o imágenes a la carpeta de anuncios de la oferta en Drive, compartida con el enlace.
2. `set_offer_ads_folder` con esa carpeta (es el botón «Abrir carpeta de Drive» de la sección Ads).
3. `upsert_ad_creative` por cada creativo: `kind` (video / imagen), `angle` (el ángulo o formato), `status` borrador / activo / pausado, y `meta_ad_ids` con los ids de los anuncios de Meta para que la tarjeta muestre gasto y ROAS.

**En Meta:**
- Excluir a quien ya compró (público personalizado de compradores) suele ayudar a que la pauta busque clientes nuevos.
- Nunca prender, pausar ni editar algo activo sin que el responsable lo pida. Lo nuevo se crea PAUSADO.
- Al lanzar, vincular la campaña a su checkout (`update_checkout` → `meta_campaign_ids_add`). Una campaña sin vincular aparece como «sin oferta vinculada» y su gasto no cuenta en la oferta.
- Las campañas con límite de puja (BID CAP) las puede manejar el piloto (ver «Piloto Meta Ads»).

## Verificar antes de mandar tráfico {#verificar}
- `get_checkout`: sin warnings.
- `check_delivery_email`: todos los links del mail de entrega abren.
- `simulate_postpurchase` en 3 casos (sin bumps, 1 bump, todos): `checks` vacío.
- Abrir el checkout en el navegador: idioma, precio, bumps, bonus y píxel correctos. `/c/<tienda>/<checkout>` es la dirección interna que siempre funciona para probar.
- En el panel, **Compra de prueba** de la oferta recorre el checkout y el post-pago real sin cobrar.
- Solo entonces se cambia el botón de la landing.

# Panel: qué es cada sección

## Barra de arriba y selector {#panel-barra}
- **Actualizar** (flechas): vuelve a pedir la página y trae lo nuevo de Stripe (lo facturado) y de Meta (el gasto) sin esperar al repaso de cada 15 min. Al abrir el panel lo hace solo.
- **Notificaciones**: activa las notificaciones push de ventas y avisos en ese dispositivo. Con el panel abierto, cada venta y cada OTO suenan («Probar el sonido de venta»). Con el teléfono bloqueado suena el tono de notificaciones del sistema.
- **Captura**: oculta nombres de ofertas, campañas y compradores para sacar capturas (se ven como «Oferta 3», «Categoría 2»).
- **Filtro de fechas**: queda fijo arriba; todas las cifras de la página respetan ese rango.
- **Selector de oferta** (menú izquierdo): «Todas las ofertas» o una sola, ordenadas por **A-Z** o **Recientes**. Las ofertas de varios países se agrupan por categoría.

## Inicio {#panel-inicio}
- **Objetivo del mes**: la barra de facturación neta del mes (cobrado en la pasarela − comisiones − reembolsos) hacia la meta configurada, con la proyección a fin de mes y cuánto falta por día.
- **Fila de dinero**: Facturado = lo cobrado en la pasarela (con bumps y OTO), con «N compras · ticket medio» (compras agrupadas por comprador en 1 hora); Gasto = lo que informa Meta; y lo que queda.
- **Ofertas en Meta + anotador**: una fila por oferta con campañas, ordenada por ROAS de 7 días (toca un título para ordenar por otra columna), con beneficio. Al abrirla: sus campañas, **sugerencias** sacadas de los números (pierde dinero, viene cayendo, creativos cansados, escalar, no gasta hoy) con «+ anotar», y las tareas de esa oferta.
- **Diagnóstico de ofertas**: qué le falta a cada oferta con campañas activas.
- **Tabla de campañas**: interruptor, y **Presupuesto** (diario) y **Puja** editables: se toca el número, se escribe el nuevo y se confirma; va a Meta al instante y queda en el historial del piloto.

## En vivo y mapa {#panel-en-vivo}
Quién está ahora en las landings, checkouts y post-pagos, y el recorrido de cada visita. El mapa se puede acercar (+ / −, doble clic, arrastrar) para ver desde dónde se conecta cada uno.

## Métricas {#panel-metricas}
El resultado real: cobrado en la pasarela − comisiones reales − reembolsos − gasto en Meta, por día y con el historial completo. Abajo, lo que informa Meta de toda la cuenta.

## Ventas realizadas y Clientes {#panel-ventas}
Todas las ventas y todos los clientes de todas las tiendas: se ordenan por cualquier columna, se filtran y se exportan a CSV o Excel (una fila por cobro de la pasarele: el del checkout con principal + bumps, y cada OTO aparte; total, moneda, medio de pago, UTM y productos). Ciudad y provincia salen del cobro en Stripe: si el comprador no las cargó, quedan vacías. Dentro de una oferta, «Pedidos» y «Clientes» muestran solo los de esa oferta. Cada pedido abre su detalle (productos, OTO, mails, entrega).

**Informe de actividad (para disputas / contracargos):** en cada pedido, botón «Informe de actividad (PDF)». Reúne en inglés todo lo registrado de esa compra: IP y dispositivo del pago, ubicación, cada cobro de Stripe (tarjeta, CVC, dirección, 3D Secure, riesgo, disputa), los mails con cada apertura y clic, descargas, las páginas vistas en las 72 h previas, los OTO mostrados/aceptados/rechazados, otras compras de la misma persona (mismo mail o misma IP), coincidencias y conclusión. Se adjunta en la disputa de Stripe. Por MCP: `order_activity_report`.

## Biblioteca de clientes {#panel-biblioteca}
El portal de cada comprador: en un subdominio propio de la tienda si está configurado (`stores.library_domain`, por ejemplo `biblioteca.tumarca.com`) o en `/biblioteca` del dominio de pago. El comprador pone su mail y recibe un link para entrar sin contraseña (vale 48 h; la sesión dura 90 días). El idioma es el que elige, o el de su navegador, o el de su compra. Pestañas:
- **Mis productos:** todo lo que compró en esa tienda (principal, bumps, OTO, regalos) con portada, descripción, descarga directa desde la app y vista de páginas de muestra. Los de preventa muestran el plazo en vez de la descarga.
- **Mis pedidos:** cada compra con número, fecha, importe, estado y qué incluía.
- **Tienda:** productos que le faltan de sus ofertas y principales de otras ofertas en su idioma. «Pagar» cobra con el medio de su última compra (con 3DS si el banco lo pide) y se suma como OTO a su último pedido. El precio lo pone siempre el servidor.
- **Archivos:** cada archivo de Drive se copia una vez a un bucket privado de Supabase (tabla `delivery_mirror`) la primera vez que alguien lo descarga; un archivo nuevo en la carpeta se copia de nuevo, así la copia nunca queda vieja.
- **Portadas:** un producto sin imagen usa la primera página de su PDF.
- En el panel: menú **«Biblioteca de clientes»** (link de cada tienda + «Ver su biblioteca» de cualquier comprador, en modo lectura) y el botón «Ver su biblioteca» en cada pedido.

## Top Ads {#panel-top-ads}
Menú **«Top Ads»**: los creativos de cada producto agrupados por ángulo (el `angle` de cada creativo en Ads), con lo que rindió cada uno en el período según Meta: qué formato rinde más sumando todos los productos, el ranking de los mejores anuncios por ROAS (con un gasto mínimo) y, producto por producto, sus creativos lado a lado con el ganador marcado. Para que un creativo aparezca: cargarlo en el «Ads» de su oferta con su ángulo.

## Catálogos (lo que revisa Stripe) {#panel-catalogos}
Cada tienda puede tener un sitio de catálogo (por ejemplo `catalogo.tumarca.com`) servido por la app. Se arma solo desde la base: productos activos con su precio y su checkout real, datos legales de quien opera la marca, contacto, y términos, privacidad, reembolsos y contacto en cada idioma. El texto del negocio admite marcas que se completan en vivo: `{languages}` `{topics}` `{audiences}` `{countries}` `{price_range}`.
- Menú **«Catálogos»**: por tienda, quién sirve el dominio, lo que muestra, **cada link de compra probado** (tiene que dar 200), datos legales, políticas publicadas y el texto del negocio. «Actualizar ahora» vacía la caché (si no, se actualiza cada 5 min).
- **Al crear una oferta nueva**: ponerle **categoría** (`upsert_offer`). Si la categoría es nueva, «Catálogos» la marca en rojo hasta que se cargue su tema y su público **en inglés** con `set_catalog_topic`.
- Cuando hay algo pendiente, la tarjeta trae **«Copiar prompt para arreglarlo»** para pegarlo en cualquier IA conectada a la app.
- Lo que se llama «PRUEBA…» o «test» nunca aparece en el catálogo ni en la biblioteca.
- **Todo lo que se vende aparece**: principal, bonus, bumps y OTO de cada checkout y post-pago activo, aunque el producto tenga `show_in_catalog` en false. Solo quedan fuera los downsells y lo de prueba.
- Sigue la lista de requisitos de sitio web de Stripe: razón social, descripción y precio de cada producto con la moneda, contacto, reembolso / entrega / cancelación, privacidad, restricciones, condiciones de las promociones y pago seguro.
- **«Catálogos y Stripe» en el Inicio**: se revisa al entrar (si pasaron 10 min) y cada hora. Compara el catálogo publicado con la cuenta de Stripe de cada tienda. Lo que hay que cambiar a mano en el panel de Stripe sale como tarea con el texto exacto y «Copiar»; el aviso se cierra solo cuando se arregla.

## Carritos {#panel-carritos}
Recuperación de carritos abandonados de todas las tiendas: cuántos mails se mandaron, cuántos volvieron a comprar con el link, cuántos compraron después por su cuenta, y el monto **Recuperado**. El descuento del mail se configura en cada checkout (`recovery`).

## Contenido pendiente {#panel-contenido-pendiente}
Los productos vendidos en preventa (ver «Contenido pendiente» en Cargar una oferta). Estados: **pendiente** (vendido, falta el archivo) → **«Listo · falta avisar»** (el PDF verificado ya está en la carpeta) → tras «Avisar a N» pasa a **«Listos y avisados»**. En cada uno: de qué oferta es (y si va como bump, bonus u OTO), cuántos compradores esperan y el vencimiento. Botones: «Revisar carpetas ahora», «Ya está el contenido» y «Avisar a N» (manda la entrega real: solo cuando el archivo está bien subido).

## Mejoras {#panel-mejoras}
Recomendaciones rápidas por oferta: qué post-pago tiene baja conversión y qué mejorar primero.

## Piloto Meta Ads {#panel-piloto}
Una fila por campaña: interruptor para prender o apagar, pujas, tope, y agrupado **Hoy** (gasto, compras, ROAS) y **Últimos 3 días** (gasto, compras, CPA, ticket, ROAS), estado y **Próximo movimiento**. Se ordena por cualquier columna y se filtra Activas / Pausadas / Todas. El piloto ajusta pujas BID CAP dentro de un tope y **nunca apaga nada solo**: lo que haría falta apagar llega como aviso.

## Mails, Email marketing y Avisos {#panel-mails}
- **Mails**: la casilla de soporte. Los pendientes de responder, por persona. La IA puede redactar la respuesta en el idioma del comprador (buscando su compra por mail, número de pedido o nombre) con los links de lo que compró, pero **se envía solo con aprobación humana**. Las respuestas con coincidencia dudosa vienen marcadas para revisar. Los reembolsos los decide siempre una persona: si el comprador insiste, el mail queda abierto marcado como pedido de reembolso.
- **Email marketing**: campañas a compradores por idioma, ofreciendo lo que todavía no tienen. Desde MCP solo se crean borradores; el envío se hace desde el panel tras confirmar la cantidad exacta.
- **Avisos**: arriba, **¿le llegó el contenido a todos?** (pedidos de los últimos 7 días: enviados, abiertos, accedidos, y los que tienen un problema con «Reenviar»). Debajo, lo que necesita atención (rebotes, entregas fallidas, links rotos, disputas, post-pago vacío para quien lleva todos los bumps, contenido por vencer).

## Dentro de una oferta {#panel-oferta}
- **Checkouts**: un checkout por mercado; estilo, bumps, garantía, recuperación, dirección pública.
- **Productos**: principal, bonus, bumps y OTO, con precios por moneda, tapa y carpeta de entrega.
- **Post-pago**: la cadena de niveles con sus downsells y condiciones.
- **Métricas**: ventas, conversión del checkout y de cada OTO.
- **Ads**: los creativos de la oferta (con vista previa) y su carpeta. Si la tarjeta tiene ids de anuncios de Meta, muestra gasto y ROAS.
- **Configuración**: General (datos de la tienda y mails), Pagos (Stripe o Whop) y Dominios.
- **Markets**: qué países pagan precio propio y cuáles con conversión.
- **Archivos**: las imágenes subidas (logo, tapas, sellos).
- **Compra de prueba**: recorre checkout + post-pago + mail de entrega sin cobrar.

# Herramientas y límites

## Herramientas MCP {#mcp}
Montos siempre en unidades MAYORES.
- **Leer**: `get_guide` (esta guía), `catalog_status`, `order_activity_report`, `list_stores`, `list_offers`, `offer_summary`, `list_products`, `get_product`, `list_checkouts`, `get_checkout`, `list_postpurchase`, `simulate_postpurchase`, `list_pixels`, `diagnose_store`, `sales_summary`, `list_orders`, `list_alerts`, `list_ad_creatives`.
- **Cargar**: `set_catalog_topic`, `upsert_product`, `upload_media`, `create_checkout`, `update_checkout`, `update_checkout_style`, `upsert_offer`, `upsert_postpurchase`, `upsert_pp_step`, `activate_products`, `set_postcompra_html`, `check_delivery_email`, `set_offer_ads_folder`, `upsert_ad_creative`.
- **Sensibles, solo con aprobación explícita para ese caso**: `refund_order`, `delete_*`, `disconnect_stripe` y `disconnect_whop` (piden `confirm=true`), `connect_stripe` / `connect_whop` (cambian el webhook de la cuenta de Stripe), `resend_delivery` y `send_recovery` (mandan mails reales), `send_reply`.
Todo lo que se escribe queda registrado (`get_mcp_audit_log`).

## Lo que nunca se hace {#nunca}
- Inventar datos, precios, links, testimonios o contenido.
- Mandar mails a compradores reales, reembolsar o crear pedidos pagos de prueba sin aprobación.
- Bumps pre-marcados o descuentos automáticos no configurados en el checkout.
- Tapas o imágenes que no correspondan al producto o al idioma de la oferta.
- Prender, apagar o editar campañas y anuncios activos sin preguntar.
- Dejar una oferta a medias con tráfico: primero se verifica todo, después se cambia el botón de la landing.

Al terminar algo: resumir en pocas líneas qué quedó, qué se verificó y qué falta decidir.
