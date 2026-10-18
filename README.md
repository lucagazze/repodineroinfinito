# Checkout propio para productos digitales

Checkout, post-pago y panel propios para vender productos digitales (PDF, cursos, etc.), con varias tiendas en una sola instalación.

- **Checkout con Stripe**: tarjeta, Apple Pay, Google Pay, Link y medios locales (iDEAL, BLIK, Pix…), en el idioma y la moneda del comprador. Hay dos diseños y el estilo se edita desde el panel.
- **Order bumps, bonus y post-pago de 1 clic** (upsells y downsells por niveles, con condiciones) con la tarjeta guardada.
- **Entrega automática por mail** (links de Drive o archivos propios), página de gracias y seguimiento de cada mail: abierto, clic, descarga y rebote.
- **Mi biblioteca**: un portal donde cada comprador entra con su email, sin contraseña, y ve, descarga y compra lo que le falta. También hay un catálogo público.
- **Preventas** (vender antes de tener el archivo y avisar cuando llega), **carritos abandonados** con mail de recuperación y **monitor** de checkouts y landings cada 2 minutos.
- **Panel**: ventas en vivo, plata real (comisiones, reembolsos, neto, gasto en Meta), clientes, métricas por oferta, mapa de visitas, grabaciones, avisos push, buzón de soporte con borradores de IA, email marketing a compradores, catálogos para Stripe, socios con acceso limitado e informe de actividad para disputas.
- **Meta**: píxel + Conversions API por oferta, campañas con interruptores, presupuesto y puja desde el panel, piloto de pujas BID CAP y análisis «Mejoras» con IA.
- **Servidor MCP** (`/api/mcp`) para manejar todo desde Claude: tiendas, productos, checkouts, post-pagos, píxeles, pedidos, reembolsos y buzón. Hay otro MCP limitado para socios (`/api/mcp-socio`).

Stack: Next.js 15 (Vercel) + Supabase (Postgres, Storage, pg_cron, pg_net) + Stripe.
¿Cobrás con Whop? Ver [docs/WHOP.md](docs/WHOP.md).

---

## Instalación en 15 minutos

### 0. Qué hace falta (2 min)
- Node 20 o más nuevo y git.
- Cuentas en [Supabase](https://supabase.com), [Vercel](https://vercel.com) y [Stripe](https://stripe.com).
- Una vía para mandar mails: una casilla SMTP propia (`info@tumarca.com`), o [Postmark](https://postmarkapp.com) o [Brevo](https://brevo.com).

### 1. Proyecto de Supabase (2 min)
1. supabase.com → **New project** (región cerca de tus compradores). Guardá la contraseña de la base.
2. **Project Settings → API**: copiá la *Project URL*, la *service_role / secret key* y la *publishable/anon key*.
3. **Account → Access Tokens**: creá un token (`sbp_...`). Solo lo usa el instalador.

### 2. Código y variables (3 min)
```bash
git clone <este-repo> checkout && cd checkout
npm install
cp .env.local.example .env.local
```
Completá en `.env.local` al menos las marcadas **[OBLIGATORIA]**:

| Variable | Valor |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_PUBLISHABLE_KEY` | del paso 1 |
| `SUPABASE_ACCESS_TOKEN` | el `sbp_...` del paso 1 |
| `NEXT_PUBLIC_SITE_URL`, `PUBLIC_BASE_URL` | `http://localhost:3000` por ahora (después, la dirección de Vercel) |
| `ADMIN_EMAILS`, `ADMIN_PASSWORD` | tu email y una contraseña para el panel |
| `ADMIN_SECRET`, `SECRETS_KEY`, `CRON_SECRET`, `HEALTH_SECRET` | textos al azar (ver abajo) |
| `TEST_EMAIL` | tu email (compras y mails de prueba) |

Textos al azar: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`, uno distinto para cada variable.

### 3. Base de datos (1 min)
```bash
npm run setup -- --no-cron
```
Revisa las variables, crea las 70 tablas, las funciones, los triggers y los índices (`supabase/schema.sql`), y los buckets `media` (público) y `entregas` (privado). Se puede volver a correr sin perder nada.
Si preferís hacerlo a mano: pegá `supabase/schema.sql` en **Supabase → SQL Editor** y ejecutalo.

### 4. Probar en local (1 min)
```bash
npm run dev
```
Abrí http://localhost:3000/admin y entrá con `ADMIN_EMAILS` + `ADMIN_PASSWORD`.

### 5. Publicar en Vercel (4 min)
```bash
npx vercel link            # crear el proyecto
npx vercel --prod          # primer deploy
```
1. En Vercel → **Settings → Environment Variables**, cargá las mismas variables de `.env.local` (todas menos `SUPABASE_ACCESS_TOKEN`). `NEXT_PUBLIC_SITE_URL` y `PUBLIC_BASE_URL` = `https://<tu-proyecto>.vercel.app`.
2. `npx vercel --prod` otra vez, para que tome las variables.
3. En tu `.env.local`, poné la dirección de Vercel en `PUBLIC_BASE_URL` y corré:
   ```bash
   npm run setup
   ```
   Esto agrega las 16 tareas programadas de pg_cron: entregas pendientes, carritos, buzón, Meta, monitor, reconciliación de pagos y email marketing. Todas llaman a `https://<tu-app>/api/cron/*` con `CRON_SECRET`.

`vercel.json` publica en la región `iad1` (Washington DC), que es la más cercana a la base de Supabase de esta instalación (`us-east-2`, Ohio). Si movés la base de región, cambiá esta también: con la app y la base en continentes distintos, cada consulta del checkout cruza el océano dos veces.

### 6. Conectar Claude por MCP (1 min)
Las tiendas, productos y checkouts se crean desde Claude. En el panel: **Guía de la app → «Crear link para compartir»** o **Configuración → Acceso API → crear un token**. Después:
```bash
claude mcp add --transport http --scope user checkout https://<tu-app>.vercel.app/api/mcp --header "Authorization: Bearer cp_..."
```
Primer mensaje: «Leé la guía de la app con get_guide».

### 7. Primera tienda y oferta (pedírselo a Claude, 2 min)
1. `create_store`: nombre, dominio de pagos (`pay.tumarca.com`), moneda e idioma.
2. `connect_stripe`: la llave secreta (o restringida) de Stripe de esa tienda. La app la valida, crea sola el webhook `/api/stripe/webhook/<tienda>` y guarda la llave cifrada. Después, `register_apple_pay_domains`.
3. `set_store_smtp`: la casilla que manda las entregas (host, puerto 465, usuario y contraseña). Si no la cargás, se usa Postmark o Brevo.
4. `upsert_product` (principal, bumps, upsells y bonus, con precio, tapa y link de entrega) → `upsert_offer` → `create_checkout` → `upsert_postpurchase` / `upsert_pp_step` → `upsert_pixel`.
5. Verificar con `get_checkout`, `check_delivery_email` y `simulate_postpurchase`, y hacer una **compra de prueba** desde el panel (oferta → Compra de prueba) antes de mandar tráfico.

Dominio propio: en Vercel → **Domains**, agregá `pay.tumarca.com` (CNAME a `cname.vercel-dns.com`). La app reconoce el dominio de cada tienda sola.

---

## Opcionales

| Qué | Cómo |
|---|---|
| Entrar al panel con Google | Supabase → Authentication → Providers → Google, y `SUPABASE_PUBLISHABLE_KEY`. El email tiene que estar en `ADMIN_EMAILS`. |
| Notificaciones push de ventas | `npx web-push generate-vapid-keys` → `VAPID_*` y `NEXT_PUBLIC_VAPID_PUBLIC_KEY`. Panel → campana. |
| Métricas de Meta y piloto de pujas | `META_TOKEN` (o cargarlo en Configuración → Meta), `META_ADS_TOKEN`, `NEXT_PUBLIC_META_AD_ACCOUNT`, `META_AUTOPILOT_ACCOUNTS`. |
| IA (buzón, Mejoras, email marketing) | `GEMINI_API_KEY` o `ANTHROPIC_API_KEY`. |
| Preventas y PDFs desde Drive | `GOOGLE_SA_JSON`: una cuenta de servicio con permiso de Editor sobre la carpeta de entregas. |
| Email marketing | `BREVO_API_KEY` y un remitente verificado (Panel → Email marketing → Ajustes). |
| Landings servidas por la app | `LANDING_DOMAINS` y `public/lp/<oferta>/<idioma>/index.html` (ver `next.config.ts`). |
| Compras de otra plataforma o de Shopify | `LEGACY_LOOKUP_*` / `SHOPIFY_*` (ver `src/lib/legacy-lookup.ts` y `src/lib/shopify-lookup.ts`). |
| Avisos de caída al celular | En la tabla `app_settings`, clave `uptime`: poné un `ntfy_topic` de [ntfy.sh](https://ntfy.sh). |

Todas las variables, con su explicación, están en [.env.local.example](.env.local.example).

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run setup` / `npm run setup:check` | Instala o actualiza la base / solo revisa las variables. |
| `npm run dev`, `npm run build`, `npm run typecheck` | Lo de siempre. |
| `npm test` | Pruebas sin red: links de mails, reglas del piloto de pujas y del piloto automático. |
| `npm run smoke [-- https://preview.vercel.app]` | Prueba todos los checkouts públicos y el post-pago contra producción o una preview, sin crear nada en Stripe (necesita `SMOKE_APP_BASE`, `SMOKE_SECRET` y `HEALTH_SECRET`). |
| `npm run deploy:safe` | Build de producción sin publicar → smoke → promote → smoke, con rollback automático (necesita `PROD_ALIAS`, `SMOKE_SECRET`, `HEALTH_SECRET` y `VERCEL_AUTOMATION_BYPASS_SECRET`). |
| `python supabase/sql.py -e "select 1"` | SQL contra la base por la Management API (`SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF`). |

## Estructura

- `src/app/c/[store]/[funnel]`: checkout · `src/app/oferta`: post-pago · `src/app/gracias` · `src/app/biblioteca`: portal del comprador · `src/app/catalogo`: catálogo público y políticas.
- `src/app/admin`: panel · `src/app/socio`: panel de socios · `src/app/api`: pagos, webhooks, crons, MCP y seguimiento.
- `src/lib`: lógica (entrega `fulfill.ts`, post-pago `postpurchase*.ts`, Stripe `stripe*.ts`, mails `email.ts`/`inbox.ts`, MCP `mcp/`).
- `supabase/schema.sql`: esquema completo, sin datos · `supabase/cron.sql`: tareas programadas · `docs/guia.md`: la guía que lee la IA (`get_guide`).

## Problemas comunes

- **`next build` en local falla con «Faltan SUPABASE_URL / SUPABASE_SERVICE_KEY»**: el build lee las variables; cargá `.env.local` (en Vercel ya están).

- **`npm run setup` da HTTP 401/403**: el `SUPABASE_ACCESS_TOKEN` no es de la cuenta dueña del proyecto o se cargó mal el ref (`SUPABASE_PROJECT_REF`).
- **El panel dice «Falta SECRETS_KEY» / no guarda la llave de Stripe**: falta `SECRETS_KEY` en Vercel. Si se cambia, hay que volver a correr `connect_stripe` y `set_store_smtp`.
- **No llegan los mails**: Panel → Diagnóstico. Hace falta una casilla SMTP de la tienda, `POSTMARK_TOKEN` o `BREVO_API_KEY`, y el remitente verificado.
- **Las tareas no corren**: en Supabase, `select * from cron.job_run_details order by start_time desc limit 20;`. Revisá que `PUBLIC_BASE_URL` fuera la de Vercel al correr `npm run setup`, y que `CRON_SECRET` sea el mismo en Vercel.
