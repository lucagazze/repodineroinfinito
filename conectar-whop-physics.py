#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Conecta Physics Study Lab a Whop. Las claves se pegan a ciegas, nunca por chat.

LO QUE REVISA ANTES DE GUARDAR
  1. Mide y limpia lo que pegaste. Pegar de mas (una linea extra, un espacio,
     comillas) es el error que ya pasó, y no se nota hasta la primera venta.
  2. Comprueba la forma: biz_... y ws_...
  3. Prueba la llave CONTRA Whop. Una llave invalida guardada se descubre con
     la primera venta, que es el peor momento posible.
  4. Recien entonces guarda, cifrada.

EL SECRETO DEL WEBHOOK
  Whop lo muestra UNA SOLA VEZ, al crear el webhook. Sin el, cada pago cobrado
  se rechaza y no se entrega nada -- y no falla de forma visible: el dinero
  entra, el comprador espera, y el panel no muestra la venta.

  El webhook es POR TIENDA. El de Physics tiene que apuntar a:
    https://pay.financestudylab.com/api/whop/webhook/97879900-b4b5-4ae5-880a-32deb872967c

  python3 conectar-whop-physics.py
"""
import getpass, json, pathlib, re, subprocess, sys, urllib.error, urllib.request

RAIZ = pathlib.Path(__file__).parent
TIENDA = "97879900-b4b5-4ae5-880a-32deb872967c"   # physicsstudylab
WEBHOOK_URL = f"https://pay.financestudylab.com/api/whop/webhook/{TIENDA}"


def limpiar(valor, etiqueta):
    """Saca espacios, saltos y comillas, y dice cuanto quedo."""
    crudo = valor
    v = valor.strip().strip('"').strip("'").strip()
    if "\n" in crudo or "\r" in crudo:
        print(f"    {etiqueta}: tenia saltos de linea, los saque")
    if len(v) != len(crudo):
        print(f"    {etiqueta}: pegaste {len(crudo)} caracteres, quedaron {len(v)} despues de limpiar")
    else:
        print(f"    {etiqueta}: {len(v)} caracteres")
    return v


def pedir(etiqueta, patron=None, ayuda="", oculto=True):
    while True:
        bruto = (getpass.getpass(f"  {etiqueta}: ") if oculto else input(f"  {etiqueta}: "))
        v = limpiar(bruto, etiqueta)
        if not v:
            print("    vacio, probá de nuevo\n"); continue
        if patron and not re.fullmatch(patron, v):
            print(f"    no tiene la forma esperada. {ayuda}\n"); continue
        return v


def main():
    print(f"""
  Conectar Physics Study Lab a Whop.

  Antes de empezar, en Whop tiene que existir un webhook que apunte a:

    {WEBHOOK_URL}

  Si lo creaste recien, tenés el secreto (ws_...) a la vista. Si ya cerraste
  esa pantalla, Whop no lo vuelve a mostrar: hay que borrar el webhook y
  hacerlo de nuevo.
""")
    if input("  ¿El webhook ya existe y tenés el ws_ a mano? (si/no): ").strip().lower() not in ("si", "s", "sí"):
        sys.exit("\n  Creá el webhook primero con esa URL y volvé. No guardo nada a medias.\n")

    print()
    api_key = pedir("API key de la cuenta", r".{20,}", "Tiene que tener al menos 20 caracteres.")
    company = pedir("Account id (biz_...)", r"biz_[A-Za-z0-9]+", "Empieza con biz_", oculto=False)
    secreto = pedir("Secreto del webhook (ws_...)", r"ws_[A-Za-z0-9_-]+", "Empieza con ws_")
    hook_id = pedir("Id del webhook (hook_..., opcional: Enter para saltar)",
                    r"(hook_[A-Za-z0-9]+)?", "Empieza con hook_", oculto=False)

    # Prueba contra Whop antes de tocar la base.
    print("\n  Probando la llave contra Whop...")
    try:
        r = urllib.request.urlopen(urllib.request.Request(
            f"https://api.whop.com/api/v1/webhooks?account_id={company}",
            headers={"authorization": f"Bearer {api_key}", "accept": "application/json"}), timeout=60)
        hooks = json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f"\n  La llave NO sirve para {company}: HTTP {e.code}\n  {e.read().decode()[:200]}\n"
                 "  No guardé nada. Revisá que la llave sea de esa misma cuenta.\n")
    lista = hooks.get("data", hooks) if isinstance(hooks, dict) else hooks
    print(f"  Llave OK. La cuenta {company} tiene {len(lista)} webhook(s).")

    # ¿Alguno apunta a donde tiene que apuntar?
    urls = [h.get("url", "") for h in lista if isinstance(h, dict)]
    if not any(TIENDA in u for u in urls):
        print(f"\n  OJO: ninguno de esos webhooks apunta a la tienda de Physics.")
        for u in urls: print(f"    - {u}")
        print(f"\n  El que hace falta es:\n    {WEBHOOK_URL}\n")
        if input("  ¿Sigo igual? (si/no): ").strip().lower() not in ("si", "s", "sí"):
            sys.exit("  Cancelado. No guardé nada.\n")

    # Guardar usando el mismo código que usa la app (cifra la llave).
    print("\n  Guardando...")
    ts = f'''
import {{ connectWhop }} from "{RAIZ}/src/lib/whop-connect.ts";
const r = await connectWhop("{TIENDA}", process.env.K!, process.env.C!, process.env.S!, process.env.H || null);
console.log(JSON.stringify(r));
'''
    tmp = RAIZ / ".conectar.mts"
    tmp.write_text(ts)
    env = {}
    for l in (RAIZ / ".env.local").read_text().splitlines():
        if "=" in l and not l.startswith("#"):
            k, v = l.split("=", 1)
            if v.strip(): env[k] = v.strip()
    import os
    out = subprocess.run(["npx", "tsx", str(tmp)], capture_output=True, text=True, cwd=RAIZ,
                         env={**os.environ, **env, "K": api_key, "C": company, "S": secreto, "H": hook_id})
    tmp.unlink(missing_ok=True)
    if out.returncode:
        sys.exit(f"\n  No se pudo guardar:\n{out.stderr[-500:]}\n")
    print(f"  {out.stdout.strip()[:200]}")
    print("""
  Listo. Avisale a Claude que ya está y sigue con:
    - checkout_host de los tres embudos
    - compra de prueba de cada uno, en libras
    - recien despues, los botones de la landing
""")


if __name__ == "__main__":
    main()
