#!/usr/bin/env python3
"""Carga las llaves de Supabase en .env.local.

Se escriben directamente en el archivo: no pasan por el historial de la
terminal ni por el chat. Las secretas se tipean a ciegas (no se ven al pegar,
es normal, pega igual). Se puede correr las veces que haga falta: lo que ya
este cargado se ofrece como valor actual y se conserva con Enter.
"""
import getpass, pathlib, re, sys

CAMPOS = [
    ("SUPABASE_URL", "Project URL", False,
     lambda v: v.startswith("https://") and v.endswith(".supabase.co"),
     "tiene que ser https://algo.supabase.co (sin barra al final)"),
    ("SUPABASE_SERVICE_KEY", "service_role / secret key", True,
     lambda v: len(v) > 30, "es mas larga que eso, revisa que hayas copiado entera"),
    ("SUPABASE_PUBLISHABLE_KEY", "publishable / anon key", True,
     lambda v: len(v) > 30, "es mas larga que eso"),
    ("SUPABASE_ACCESS_TOKEN", "Access Token de tu cuenta", True,
     lambda v: v.startswith("sbp_"), "tiene que empezar con sbp_"),
    ("ADMIN_PASSWORD", "contrasena para TU panel (la inventas vos)", True,
     lambda v: len(v) >= 8, "minimo 8 caracteres"),
]

p = pathlib.Path(".env.local")
if not p.exists():
    sys.exit("No encuentro .env.local")
txt = p.read_text()
actual = {m.group(1): m.group(2).strip()
          for m in re.finditer(r"(?m)^([A-Z_]+)=(.*)$", txt)}

print("\n  Llaves de Supabase -> .env.local")
print("  Project Settings > API para las tres primeras;")
print("  tu avatar > Account > Access Tokens para la cuarta.")
print("  Enter en blanco = dejar lo que ya estaba.\n")

nuevos = {}
for var, etiqueta, secreto, valido, ayuda in CAMPOS:
    tiene = bool(actual.get(var))
    while True:
        pide = f"  {etiqueta}" + (" [ya cargada, Enter para dejarla]" if tiene else "") + ": "
        v = (getpass.getpass(pide) if secreto else input(pide)).strip()
        if not v:
            if tiene:
                break
            print("     hace falta.\n"); continue
        v = v.strip().strip('"').strip("'").rstrip("/")
        if not valido(v):
            print(f"     {ayuda}\n"); continue
        nuevos[var] = v
        break

if nuevos:
    for var, v in nuevos.items():
        txt = re.sub(rf"(?m)^{var}=.*$", lambda m, v=v: f"{var}={v}", txt)
    p.write_text(txt)
    p.chmod(0o600)
print(f"\n  Guardado: {len(nuevos)} valor(es) nuevo(s) en .env.local\n")
