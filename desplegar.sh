#!/bin/bash
# Despliegue a Vercel: enlaza, carga las variables de .env.local, publica.
# Se puede volver a correr: lo que ya existe se actualiza.
set -e
cd "$(dirname "$0")"
V="npx --yes vercel"

who=$($V whoami 2>&1 | tail -1)
case "$who" in
  *"Logged out"*|*Error*) echo "  Primero: npx vercel login"; exit 1 ;;
esac
echo "  sesion: $who"

# 1) enlazar el proyecto
if [ ! -f .vercel/project.json ]; then
  echo
  echo "  --- enlazando el proyecto ---"
  # --yes: sin esto el CLI abre un menu interactivo y el script se queda esperando.
  $V link --yes --project checkout
fi

# 2) primer despliegue, para tener una direccion
echo
echo "  --- publicando ---"
$V --prod --yes 2>&1 | tee /tmp/vercel.log | tail -2
# La direccion NO se lee de la salida del deploy: el primer despliegue falla
# (sin variables) y su URL efimera es la que imprime. La estable es la que
# "project ls" llama "Latest Production URL".
URL=$($V project ls 2>/dev/null | awk '$1=="checkout"{print $2}' | head -1)
if [ -z "$URL" ]; then echo "  no pude leer la direccion:"; tail -20 /tmp/vercel.log; exit 1; fi
echo "  direccion: $URL"

# 3) cargar las variables. SUPABASE_ACCESS_TOKEN queda fuera a proposito:
#    solo lo usa el instalador local y en Vercel no hace falta.
echo
echo "  --- cargando variables de entorno ---"
n=0
while IFS= read -r line; do
  case "$line" in ""|\#*) continue ;; esac
  k="${line%%=*}"; v="${line#*=}"
  [ -z "$v" ] && continue
  # SUPABASE_ACCESS_TOKEN: escribe en la base, solo lo usa el instalador local.
  # VERCEL_*: las escribe el propio CLI al enlazar (VERCEL_TOKEN es la credencial
  # de la cuenta de Vercel). Subirlas al proyecto seria guardar la llave adentro.
  case "$k" in SUPABASE_ACCESS_TOKEN|VERCEL_*) continue ;; esac
  case "$k" in NEXT_PUBLIC_SITE_URL|PUBLIC_BASE_URL) v="$URL" ;; esac
  $V env rm "$k" production --yes >/dev/null 2>&1 || true
  printf '%s' "$v" | $V env add "$k" production >/dev/null 2>&1 && n=$((n+1)) && echo "    $k"
done < .env.local
echo "  $n variables cargadas"

# 4) volver a publicar para que las tome
echo
echo "  --- publicando de nuevo, ya con las variables ---"
$V --prod --yes 2>&1 | tail -3
echo
echo "  LISTO: $URL"
echo "  $URL" > .vercel-url
