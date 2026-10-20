#!/usr/bin/env python3
"""Aplica un .sql de supabase/migraciones/ contra la base, por la API de gestion.

Hacia falta: el MCP de la app expone herramientas de negocio, no SQL, y psql no
esta instalado. Uso:  python3 migrar.py supabase/migraciones/002-pasarela.sql
"""
import json, os, pathlib, sys, urllib.request, urllib.error

def env(nombre):
    for linea in pathlib.Path(".env.local").read_text().splitlines():
        if linea.startswith(nombre + "="):
            return linea.split("=", 1)[1].strip().strip('"').strip("'")
    return os.environ.get(nombre)

def correr(sql):
    ref, tok = env("SUPABASE_PROJECT_REF"), env("SUPABASE_ACCESS_TOKEN")
    # El ref vive dentro de SUPABASE_URL: si falta la variable, se deduce en vez
    # de fallar. Una migracion no se cae por un dato que ya esta a la vista.
    if not ref:
        url = env("SUPABASE_URL") or ""
        ref = url.replace("https://", "").replace("http://", "").split(".")[0] or None
    if not ref or not tok:
        sys.exit("falta SUPABASE_PROJECT_REF o SUPABASE_ACCESS_TOKEN en .env.local")
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{ref}/database/query",
        data=json.dumps({"query": sql}).encode(),
        headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"},
        method="POST")
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        sys.exit(f"HTTP {e.code}: {e.read().decode()[:600]}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("uso: migrar.py <archivo.sql> | --sql \"SELECT ...\"")
    sql = sys.argv[2] if sys.argv[1] == "--sql" else pathlib.Path(sys.argv[1]).read_text()
    print(json.dumps(correr(sql), indent=2, ensure_ascii=False)[:2000])
