#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Rehace los 4 planes de los OTO de Physics en su empresa nueva de Whop.

No pide nada: usa la llave ya guardada y descifrada en memoria.

POR QUE EXISTE APARTE
  La mudanza guardo bien la conexion pero fallo al crear el producto de Whop
  donde cuelgan los planes (mandaba "name" y Whop espera "title"). Esto retoma
  justo desde ahi, sin volver a pedir la llave -- cada pegada a ciegas es una
  oportunidad de pegar de mas.

  python3 rehacer-planes-physics.py
"""
import json, os, pathlib, subprocess, sys, urllib.error, urllib.request

RAIZ = pathlib.Path(__file__).parent
PHYSICS = "97879900-b4b5-4ae5-880a-32deb872967c"
FINANCE = "3956652d-f154-4c6c-ab58-d122cc31f86c"
BIZ = "biz_5GRmpHl7fEonbj"

E = {}
for _l in (RAIZ / ".env.local").read_text().splitlines():
    if "=" in _l and not _l.startswith("#"):
        _k, _v = _l.split("=", 1)
        if _v.strip(): E[_k] = _v.strip()
H = {"apikey": E["SUPABASE_SERVICE_KEY"], "authorization": f"Bearer {E['SUPABASE_SERVICE_KEY']}",
     "content-type": "application/json"}


def sb(ruta, metodo="GET", cuerpo=None):
    req = urllib.request.Request(f"{E['SUPABASE_URL']}/rest/v1/{ruta}", method=metodo,
                                 headers={**H, "prefer": "return=representation"},
                                 data=json.dumps(cuerpo).encode() if cuerpo is not None else None)
    try:
        return json.load(urllib.request.urlopen(req, timeout=45))
    except urllib.error.HTTPError as e:
        return {"_error": e.code, "_body": e.read().decode()[:200]}


def whop(k, ruta, metodo="GET", cuerpo=None):
    req = urllib.request.Request("https://api.whop.com/api/v1" + ruta, method=metodo,
                                 headers={"authorization": f"Bearer {k}", "content-type": "application/json",
                                          "accept": "application/json"},
                                 data=json.dumps(cuerpo).encode() if cuerpo is not None else None)
    try:
        return json.load(urllib.request.urlopen(req, timeout=60))
    except urllib.error.HTTPError as e:
        return {"_error": e.code, "_body": e.read().decode()[:220]}


def llave(store_id):
    f = sb(f"store_whop?select=api_key_enc&store_id=eq.{store_id}")
    if not f or "_error" in f:
        return None
    js = (r'const {createDecipheriv,createHash}=require("crypto");const [v,iv,tag,body]=process.env.BLOB.split(".");'
          r'const key=createHash("sha256").update(process.env.SECRETS_KEY).digest();'
          r'const d=createDecipheriv("aes-256-gcm",key,Buffer.from(iv,"base64"));d.setAuthTag(Buffer.from(tag,"base64"));'
          r'process.stdout.write(Buffer.concat([d.update(Buffer.from(body,"base64")),d.final()]).toString("utf8"));')
    return subprocess.run(["node", "-e", js], capture_output=True, text=True,
                          env={**os.environ, "SECRETS_KEY": E["SECRETS_KEY"], "BLOB": f[0]["api_key_enc"]}).stdout


def main():
    k = llave(PHYSICS)
    if not k:
        sys.exit("\n  No pude leer la llave de Physics.\n")

    # El producto donde cuelgan los planes: el que ya haya, o uno nuevo.
    r = whop(k, f"/products?account_id={BIZ}&limit=1")
    if "_error" in r:
        sys.exit(f"\n  La llave guardada no sirve ({r['_error']}): {r['_body']}\n")
    hay = r.get("data") or []
    if hay:
        prod = hay[0]["id"]
        print(f"  producto existente: {prod}  «{hay[0].get('title')}»")
    else:
        n = whop(k, "/products", "POST", {"account_id": BIZ, "title": "Physics Study Lab", "visibility": "hidden"})
        if "_error" in n:
            sys.exit(f"\n  No pude crear el producto ({n['_error']}): {n['_body']}\n")
        prod = n["id"]
        print(f"  producto creado: {prod}")

    prods = sb(f"products?select=id,slug,short_name,whop_plan_id,product_prices(currency,amount)"
               f"&store_id=eq.{PHYSICS}&whop_plan_id=not.is.null&order=slug")
    if "_error" in prods:
        sys.exit(f"\n  No pude leer los productos: {prods}\n")

    print(f"\n  {len(prods)} producto(s) con plan de Whop:\n")
    viejos, fallaron = [], []
    for p in prods:
        usd = next((float(x["amount"]) for x in p["product_prices"] if x["currency"] == "USD"), None)
        if usd is None:
            print(f"    {p['slug']}: sin precio en USD, lo salteo."); fallaron.append(p["slug"]); continue
        nuevo = whop(k, "/plans", "POST", {
            "product_id": prod, "plan_type": "one_time", "release_method": "buy_now",
            "currency": "usd", "initial_price": usd, "visibility": "hidden",
            "unlimited_stock": True, "description": p["short_name"],
            "metadata": {"tienda": "physicsstudylab", "producto": p["slug"]},
        })
        if "_error" in nuevo:
            print(f"    {p['slug']:26} NO se pudo crear ({nuevo['_error']} {str(nuevo['_body'])[:80]})")
            fallaron.append(p["slug"]); continue
        viejos.append(p["whop_plan_id"])
        sb(f"products?id=eq.{p['id']}", "PATCH", {"whop_plan_id": nuevo["id"]})
        print(f"    {p['slug']:26} USD {usd:>6}  {p['whop_plan_id']} -> {nuevo['id']}")

    # Archivar los viejos en la cuenta de Finance, para no dejar planes
    # cobrables sueltos apuntando a una tienda que ya no es de esa empresa.
    if viejos:
        kf = llave(FINANCE)
        print()
        for pid in viejos:
            r = whop(kf, f"/plans/{pid}", "PATCH", {"visibility": "archived"})
            print(f"    archivado en la cuenta vieja: {pid}  {'ok' if '_error' not in r else str(r)[:80]}")

    print(f"\n  {len(viejos)} de {len(prods)} planes rehechos." +
          (f"  FALTAN: {', '.join(fallaron)}\n" if fallaron else "\n"))


if __name__ == "__main__":
    main()
