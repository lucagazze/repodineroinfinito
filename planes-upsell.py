#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Crea en Whop el plan de cada producto del post-pago y lo deja enlazado.

POR QUE HACE FALTA
  El cobro de 1 clic usa la tarjeta que el comprador ya dejo guardada, y
  `payments.create` con tarjeta guardada EXIGE un plan: no acepta un importe
  suelto como el checkout principal. Sin plan, el post-pago no puede cobrar —
  que es exactamente como estaba el 22/10/2026: la cadena activa, las paginas
  escritas, los precios cargados, y cero posibilidad de cobrar.

  El precio sale de `product_prices` (USD), que es lo que muestra la pagina de
  la oferta. Si el plan dijera otra cosa, el comprador veria un numero y se le
  cobraria otro.

  python3 planes-upsell.py            # mira y dice que falta
  python3 planes-upsell.py --crear    # crea lo que falte y lo enlaza
"""
import json, os, pathlib, subprocess, sys, urllib.error, urllib.request

RAIZ = pathlib.Path(__file__).parent
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


def llave():
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


def whop(k, ruta, metodo="GET", cuerpo=None):
    try:
        req = urllib.request.Request(
            API + ruta, method=metodo,
            data=json.dumps(cuerpo).encode() if cuerpo else None,
            headers={"authorization": f"Bearer {k}", "accept": "application/json",
                     "content-type": "application/json"})
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        sys.exit(f"\n  Whop lo rechazo ({e.code}):\n  {e.read().decode()[:400]}\n")


def pasos_del_postpago():
    """Los productos que el post-pago ofrece, en orden, con su precio en USD."""
    pps = supabase("GET", "pp_funnels?select=id,name,active&active=eq.true")
    salida = []
    for f in pps:
        st = supabase("GET", f"pp_steps?select=sort_order,product_id&pp_funnel_id=eq.{f['id']}&order=sort_order")
        for s in st:
            p = supabase("GET", f"products?select=id,slug,short_name,name,whop_plan_id&id=eq.{s['product_id']}")[0]
            pr = supabase("GET", f"product_prices?select=amount,currency&product_id=eq.{p['id']}&currency=eq.USD")
            p["precio"] = float(pr[0]["amount"]) if pr else None
            p["embudo"] = f["name"]
            salida.append(p)
    return salida


def main():
    crear = "--crear" in sys.argv
    k, empresa = llave()
    pasos = pasos_del_postpago()
    if not pasos:
        sys.exit("\n  No hay cadena de post-pago activa.\n")

    # El producto de Whop bajo el que colgar los planes: el mismo del plan
    # principal, para no dispersar el catalogo de la cuenta.
    emb = supabase("GET", "funnels?select=whop_plan_id&slug=eq.kit")[0]
    base = whop(k, f"/plans/{emb['whop_plan_id']}")
    prod_whop = base["product"]["id"]

    print(f"\n  Cuenta {empresa}  ·  producto de Whop {prod_whop}\n")
    faltan = []
    for p in pasos:
        estado = p["whop_plan_id"] or "SIN PLAN"
        print(f"    {p['slug']:28} USD {p['precio'] if p['precio'] is not None else '?':>6}   {estado}")
        if not p["whop_plan_id"]:
            if p["precio"] is None:
                print(f"       !  sin precio en USD: cargalo antes de crear el plan")
            else:
                faltan.append(p)

    if not faltan:
        print("\n  Nada que crear: todos tienen plan.\n"); return
    if not crear:
        print(f"\n  Faltan {len(faltan)}. Para crearlos:  python3 planes-upsell.py --crear\n"); return

    print(f"\n  Voy a crear {len(faltan)} plan(es) de pago unico en USD y enlazarlos.")
    if input("  Escribi SI para seguir: ").strip().upper() != "SI":
        sys.exit("  Cancelado. No se creo nada.")

    for p in faltan:
        nuevo = whop(k, "/plans", "POST", {
            "product_id": prod_whop,
            "plan_type": "one_time",
            "release_method": "buy_now",
            "currency": "usd",
            "initial_price": p["precio"],
            "visibility": "hidden",   # solo se vende desde el post-pago
            "unlimited_stock": True,
            "description": p["short_name"] or p["name"],
            "metadata": {"tienda": "financestudylab", "producto": p["slug"], "kind": "upsell"},
        })
        supabase("PATCH", f"products?id=eq.{p['id']}", {"whop_plan_id": nuevo["id"]})
        # Comprobacion: que la base quedo apuntando y que el plan cobra lo que debe
        ver = supabase("GET", f"products?select=whop_plan_id&id=eq.{p['id']}")[0]
        print(f"    {p['slug']:28} {nuevo['id']}  {nuevo.get('formatted_price')}  "
              f"enlazado={'si' if ver['whop_plan_id'] == nuevo['id'] else 'NO'}")

    print(f"""
  LISTO. Antes de confiar en esto, una compra de prueba de verdad:
    1. Compra el kit con una tarjeta real.
    2. En la pagina del Excel, tocar «Add it to my order».
    3. Revisar que en Ventas el pedido tenga DOS renglones, no dos pedidos.
    4. Que llegue el segundo mail con el Excel.
  El cobro de Whop es asincrono: el renglon aparece cuando llega el webhook,
  unos segundos despues del clic.
""")


if __name__ == "__main__":
    main()
