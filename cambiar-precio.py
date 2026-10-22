#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Cambia el precio de un embudo creando un plan nuevo en Whop.

POR QUE UN PLAN NUEVO Y NO EDITAR EL QUE COBRA
  El plan que esta cobrando no se toca. Se crea uno al lado con el precio
  nuevo y se apunta el embudo ahi. Si algo sale mal, volver es apuntar el
  campo al plan viejo -- un segundo, sin tocar Whop.

LO QUE NO HACE, A PROPOSITO
  No toca la landing. El precio vive en dos lugares que tienen que decir lo
  mismo: el plan de Whop (lo que se cobra) y el HTML de la landing (lo que se
  promete). Este script mueve el primero y te AVISA del segundo. Que esten
  desacoplados el 22/10/2026 dejo la pagina prometiendo 27 mientras la tarjeta
  cobraba 37, con la campania gastando.

  python3 cambiar-precio.py 27
  python3 cambiar-precio.py --ver          # solo mira, no cambia nada
  python3 cambiar-precio.py --volver plan_5WHxVDM1memJE
"""
import json, os, pathlib, subprocess, sys, urllib.error, urllib.request

RAIZ = pathlib.Path(__file__).parent
EMBUDO = "kit"
API = "https://api.whop.com/api/v1"


def entorno():
    env = {}
    for l in (RAIZ / ".env.local").read_text().splitlines():
        if "=" in l and not l.startswith("#"):
            k, v = l.split("=", 1); env[k] = v.strip()
    return env

E = entorno()
H = {"apikey": E["SUPABASE_SERVICE_KEY"],
     "authorization": f"Bearer {E['SUPABASE_SERVICE_KEY']}",
     "content-type": "application/json"}


def supabase(metodo, ruta, cuerpo=None):
    req = urllib.request.Request(
        f"{E['SUPABASE_URL']}/rest/v1/{ruta}", method=metodo,
        data=json.dumps(cuerpo).encode() if cuerpo else None,
        headers={**H, "prefer": "return=representation"})
    with urllib.request.urlopen(req, timeout=45) as r:
        t = r.read().decode()
    return json.loads(t) if t.strip() else []


def llave_whop():
    """La llave de la tienda, descifrada en memoria. Nunca se imprime."""
    fila = supabase("GET", "store_whop?select=api_key_enc,company_id")
    if not fila:
        sys.exit("\n  Esta tienda no tiene Whop conectado.\n")
    js = r'''
const {createDecipheriv,createHash}=require("crypto");
const [v,iv,tag,body]=process.env.BLOB.split(".");
const key=createHash("sha256").update(process.env.SECRETS_KEY).digest();
const d=createDecipheriv("aes-256-gcm",key,Buffer.from(iv,"base64"));
d.setAuthTag(Buffer.from(tag,"base64"));
process.stdout.write(Buffer.concat([d.update(Buffer.from(body,"base64")),d.final()]).toString("utf8"));
'''
    r = subprocess.run(["node", "-e", js], capture_output=True, text=True,
                       env={**os.environ, "SECRETS_KEY": E["SECRETS_KEY"],
                            "BLOB": fila[0]["api_key_enc"]})
    if r.returncode or not r.stdout:
        sys.exit("  no pude descifrar la llave de Whop: " + r.stderr[:200])
    return r.stdout, fila[0]["company_id"]


def whop(llave, ruta, metodo="GET", cuerpo=None):
    try:
        req = urllib.request.Request(
            API + ruta, method=metodo,
            data=json.dumps(cuerpo).encode() if cuerpo else None,
            headers={"authorization": f"Bearer {llave}", "accept": "application/json",
                     "content-type": "application/json"})
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        sys.exit(f"\n  Whop lo rechazo ({e.code}):\n  {e.read().decode()[:400]}\n")


def landing_dice():
    """Lo que la pagina promete AHORA. Para no dejarla contradiciendo al cobro."""
    try:
        import re, collections
        req = urllib.request.Request("https://financestudylab.com",
                                     headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=30) as r:
            t = r.read().decode("utf-8", "ignore")
        c = collections.Counter(re.findall(r"\$(\d{2,4})", t))
        # el precio es el numero que mas se repite entre los chicos
        for n, _ in c.most_common():
            if int(n) < 100:
                return int(n)
    except Exception:
        pass
    return None


def main():
    args = sys.argv[1:]
    llave, empresa = llave_whop()
    emb = supabase("GET", f"funnels?select=id,slug,whop_plan_id&slug=eq.{EMBUDO}")[0]
    actual = whop(llave, f"/plans/{emb['whop_plan_id']}")
    web = landing_dice()

    print(f"""
  AHORA
    embudo          {emb['slug']}
    plan            {emb['whop_plan_id']}
    cobra           {actual.get('formatted_price')}
    producto        {actual['product']['id']}  «{actual['product']['title']}»
    la landing dice {'$' + str(web) if web else '(no pude leerla)'}
""")
    if web and web != int(float(actual["initial_price"])):
        print(f"  !  DESAJUSTE YA: la pagina promete ${web} y la tarjeta cobra "
              f"${int(float(actual['initial_price']))}.\n")

    if not args or args[0] in ("--ver", "-v"):
        return

    if args[0] == "--volver":
        if len(args) < 2 or not args[1].startswith("plan_"):
            sys.exit("  Uso: python3 cambiar-precio.py --volver plan_XXXX")
        supabase("PATCH", f"funnels?id=eq.{emb['id']}", {"whop_plan_id": args[1]})
        p = whop(llave, f"/plans/{args[1]}")
        print(f"  El embudo vuelve a {args[1]} ({p.get('formatted_price')}).")
        print(f"  Ahora la landing tiene que decir {p.get('formatted_price')}.\n")
        return

    try:
        nuevo = int(args[0])
    except ValueError:
        sys.exit("  Uso: python3 cambiar-precio.py 27")
    if not 1 <= nuevo <= 2000:
        sys.exit("  Precio fuera de rango.")

    viejo = emb["whop_plan_id"]
    print(f"  Voy a crear un plan de pago unico en USD {nuevo} y apuntar el embudo ahi.")
    print(f"  El plan actual ({viejo}) NO se toca: para volver, --volver {viejo}")
    if input("\n  Escribi SI para seguir: ").strip().upper() != "SI":
        sys.exit("  Cancelado. No se cambio nada.")

    p = whop(llave, "/plans", "POST", {
        "product_id": actual["product"]["id"],
        "plan_type": "one_time",
        "release_method": "buy_now",
        "currency": actual.get("currency", "usd"),
        "initial_price": nuevo,
        "visibility": "visible",
        "unlimited_stock": True,
        "description": actual.get("description") or "",
        "metadata": {**(actual.get("metadata") or {}), "precio_anterior": str(viejo)},
    })
    print(f"\n  plan nuevo: {p['id']}   {p.get('formatted_price')}")
    supabase("PATCH", f"funnels?id=eq.{emb['id']}", {"whop_plan_id": p["id"]})

    # comprobacion de verdad: lo que ve un comprador, no lo que dice la base
    comp = whop(llave, f"/plans/{p['id']}")
    ver = supabase("GET", f"funnels?select=whop_plan_id&id=eq.{emb['id']}")[0]
    print(f"  embudo apuntando a {ver['whop_plan_id']}  ·  cobra {comp.get('formatted_price')}")
    print(f"""
  FALTA LA LANDING
    Sigue prometiendo {'$' + str(web) if web else 'el precio viejo'}. Hasta que diga
    ${nuevo}, el comprador ve un precio y paga otro. Decile a Claude:

        «pone la landing en {nuevo}»

    y revisa el checkout en vivo antes de dar por cerrado el cambio:
        https://pay.financestudylab.com/c/financestudylab/kit
""")


if __name__ == "__main__":
    main()
