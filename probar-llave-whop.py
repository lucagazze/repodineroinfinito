#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Prueba una API key de Whop contra una cuenta. NO guarda nada, nunca.

Sirve para aislar un 401 sin tocar la base: dice si la llave vale, de que
empresa es, y si lo que pegaste tiene pinta de haberse cortado.

  python3 probar-llave-whop.py biz_5GRmpHl7fEonbj
"""
import getpass, json, sys, urllib.error, urllib.request

biz = (sys.argv[1] if len(sys.argv) > 1 else "").strip()
if not biz.startswith("biz_"):
    sys.exit("\n  Uso: python3 probar-llave-whop.py biz_XXXXXXXX\n")

print(f"""
  Pegá la API key de la empresa {biz}.
  Va oculta: no vas a ver nada al pegar, es normal.
  Esto NO guarda nada en ningun lado.
""")
bruto = getpass.getpass("  API key: ")
k = bruto.strip().strip('"').strip("'").strip()

print(f"\n  pegaste {len(bruto)} caracteres; quedaron {len(k)} despues de limpiar")
if len(bruto) != len(k):
    print("    (venia con espacios, comillas o un salto de linea)")
if not k:
    sys.exit("    vacio.\n")
# Sin mostrar la llave: solo las puntas, que alcanzan para ver si se corto.
print(f"    empieza con «{k[:4]}…» y termina en «…{k[-4:]}»")

def g(ruta):
    try:
        r = urllib.request.urlopen(urllib.request.Request(
            "https://api.whop.com/api/v1" + ruta,
            headers={"authorization": f"Bearer {k}", "accept": "application/json"}), timeout=45)
        return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:200]

print("\n  1. ¿Whop reconoce la llave?")
c, d = g(f"/webhooks?account_id={biz}")
if c == 401:
    print("""     NO (401). La llave no es valida. Lo mas probable:
       · se pego incompleta -- fijate arriba cuantos caracteres entraron
       · no es una API key (un id de app o un secreto de webhook no sirven)
       · se borro o se regenero en Whop

     En Whop, dentro de la empresa correcta: Desarrollador -> API keys ->
     crear una nueva, y copiarla entera con el boton de copiar (no a mano).
""")
    sys.exit()
if c == 403 or (c == 400 and "permission" in str(d).lower()) or "scope" in str(d).lower():
    import re as _re
    falta = _re.findall(r"for the ([a-z_:]+) scope", str(d))
    print(f"     La llave es VALIDA pero le FALTA UN PERMISO sobre {biz} ({c}).")
    if falta:
        print(f"\n     >>> EL PERMISO QUE FALTA SE LLAMA:  {falta[0]}")
        print(f"         Buscá «{falta[0].split(':')[0]}» en el buscador de permisos de Whop.\n")
    else:
        print(f"     Whop dijo: {str(d)[:160]}")
    print("""     Casi siempre es eso, no la empresa: la comprobacion de abajo dice
     de cual es. Si la empresa es la correcta, editá la llave en Whop
     (Desarrollador -> API keys) y dale el rol de acceso completo, o al
     menos: Payment, Membership, Member, Plan, Product y leer Webhooks.""")
else:
    n = len(d.get("data", d)) if isinstance(d, (dict, list)) else "?"
    print(f"     SI ({c}). La cuenta tiene {n} webhook(s).")

print("  2. ¿De que empresa es?")
c, d = g(f"/companies/{biz}")
if c == 200 and isinstance(d, dict):
    print(f"     «{d.get('title','?')}»  ·  {d.get('route','')}")
    if "finance" in str(d.get("title", "")).lower():
        print("     OJO: esa es la empresa VIEJA. La llave tiene que ser de Physics.")
else:
    print(f"     no pude leerla ({c})")

print("\n  Nada de esto se guardo.\n")
