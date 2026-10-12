#!/usr/bin/env bash
# Deploy seguro del checkout (correr desde la carpeta del repo a publicar, p. ej. cp-deploy):
#
#   1. tsc + gate de links públicos (npm run check:links)
#   2. build de PRODUCCIÓN sin publicar (vercel deploy --prod --skip-domain):
#      mismo artefacto y mismas variables que va a usar producción
#   3. smoke contra ese build (su URL *.vercel.app, con el bypass de Vercel)
#   4. solo si pasa: vercel promote → los dominios apuntan al build nuevo
#   5. smoke contra producción (dominios reales); si falla → vercel rollback
#      automático al deploy anterior + smoke de nuevo, e imprime qué falló
#
# Secretos: en el entorno o en ./.env.deploy (no se sube: .env* está en .gitignore):
#   SMOKE_SECRET  HEALTH_SECRET  VERCEL_AUTOMATION_BYPASS_SECRET
#
#   bash scripts/deploy-safe.sh            → deploy completo
#   bash scripts/deploy-safe.sh --check    → 1-3 sin publicar (solo prueba el build)
#   bash scripts/deploy-safe.sh --rollback-test → promueve el deploy ACTUAL de nuevo (no-op)
#                                           y prueba rollback + re-promote
set -uo pipefail
cd "$(dirname "$0")/.."

MODE="${1:-deploy}"
# La dirección *.vercel.app de producción (la de tu proyecto), en el entorno o en .env.deploy.
PROD_ALIAS="${PROD_ALIAS:-}"
VC="npx --yes vercel"
[ -f .env.deploy ] && set -a && . ./.env.deploy && set +a

red() { printf '\033[31m%s\033[0m\n' "$*"; }
grn() { printf '\033[32m%s\033[0m\n' "$*"; }
step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
fail() { red "✗ $*"; exit 1; }

for v in PROD_ALIAS SMOKE_SECRET HEALTH_SECRET VERCEL_AUTOMATION_BYPASS_SECRET; do
  [ -n "${!v:-}" ] || fail "falta $v (en el entorno o en .env.deploy)"
done
export SMOKE_SECRET HEALTH_SECRET VERCEL_AUTOMATION_BYPASS_SECRET

current_prod() { $VC inspect "$PROD_ALIAS" 2>&1 | grep -Eo 'https://[a-z0-9-]+\.vercel\.app' | head -1; }

if [ "$MODE" = "--rollback-test" ]; then
  step "Prueba de rollback (sin cambios de código)"
  PREV=$(current_prod); [ -n "$PREV" ] || fail "no pude leer el deploy de producción actual"
  echo "producción actual: $PREV"
  OLDER=$($VC ls --prod 2>&1 | grep -Eo 'https://[a-z0-9-]+\.vercel\.app' | grep -v "$PREV" | head -1)
  [ -n "$OLDER" ] || fail "no hay un deploy anterior para volver"
  echo "rollback a: $OLDER"
  $VC rollback "$OLDER" --yes || fail "vercel rollback falló"
  sleep 8; NOW=$(current_prod); echo "producción ahora: $NOW"
  [ "$NOW" = "$OLDER" ] || red "! la producción no cambió al anterior ($NOW)"
  SMOKE_NO_BROWSER=1 node scripts/smoke.mjs || red "! smoke con el anterior falló"
  step "Vuelvo al deploy que estaba"
  $VC promote "$PREV" --yes || fail "no pude volver a $PREV — hacelo a mano: vercel promote $PREV"
  sleep 8; NOW=$(current_prod); echo "producción: $NOW"
  [ "$NOW" = "$PREV" ] && grn "✓ rollback y vuelta funcionan" || fail "producción quedó en $NOW (esperaba $PREV)"
  exit 0
fi

step "1/5 tsc"
node node_modules/typescript/bin/tsc --noEmit || fail "tsc con errores: no se publica"
if grep -q '"check:links"' package.json; then
  step "1/5 links públicos (check:links)"
  npm run -s check:links || fail "check:links falló: no se publica"
fi

PREV=$(current_prod)
[ -n "$PREV" ] || fail "no pude leer el deploy de producción actual (vercel inspect $PROD_ALIAS)"
echo "producción actual (para volver si algo falla): $PREV"

step "2/5 build de producción sin publicar"
OUT=$($VC deploy --prod --skip-domain --yes 2>&1) ; RC=$?
echo "$OUT" | tail -5
URL=$(echo "$OUT" | grep -Eo 'https://[a-z0-9-]+\.vercel\.app' | tail -1)
[ $RC -eq 0 ] && [ -n "$URL" ] || fail "el build falló: no se publica"
echo "build: $URL"

step "3/5 smoke contra el build nuevo ($URL)"
node scripts/smoke.mjs "$URL" || fail "el smoke del build nuevo falló: NO se publicó nada (producción sigue en $PREV)"

if [ "$MODE" = "--check" ]; then grn "✓ el build pasa el smoke (--check: no se publica)"; exit 0; fi

step "4/5 publicar (vercel promote)"
$VC promote "$URL" --yes || fail "vercel promote falló (producción sigue en $PREV)"
sleep 10

step "5/5 smoke contra producción"
if node scripts/smoke.mjs; then
  grn "✓ publicado y verificado: $URL"
  exit 0
fi

red "✗ producción falló el smoke con el build nuevo → rollback a $PREV"
$VC rollback "$PREV" --yes || red "! vercel rollback falló: hacelo a mano → vercel rollback $PREV"
sleep 10
node scripts/smoke.mjs && grn "✓ volvió a $PREV y anda" || red "! sigue fallando después del rollback: revisar ya"
exit 1
