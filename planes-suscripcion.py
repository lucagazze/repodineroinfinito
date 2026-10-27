#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Crea en Whop el plan RECURRENTE de un producto de suscripcion y lo enlaza.

POR QUE HACE FALTA UN SCRIPT APARTE
  planes-upsell.py crea planes `one_time`: cobran una vez y se terminan. Una
  suscripcion necesita `plan_type: renewal` con `billing_period`, que es otro
  objeto en Whop. Sin el, el post-pago no puede cobrar el primer mes ni los
  siguientes, y la promesa de la landing queda sin producto detras.

  El 26/10/2026 la landing espanola prometia «El Filtro Semanal, US$9 al mes,
  se ofrece una sola vez despues del pago» y no existia: la unica cadena de
  post-pago de la tienda estaba limitada al checkout en ingles.

EL MOLDE SALE DEL PLAN QUE YA COBRA
  No se inventan los parametros: se leen del plan de la suscripcion inglesa
  (`the-weekly-screen`) y se copian. Si Whop cambia algo, el plan nuevo sale
  igual que el que ya funciona, no igual a lo que decia la documentacion.

  python3 planes-suscripcion.py --tienda financestudylab --producto el-filtro-semanal
  python3 planes-suscripcion.py --tienda financestudylab --producto el-filtro-semanal --molde the-weekly-screen --crear
"""
import json, os, pathlib, subprocess, sys, urllib.error, urllib.request

RAIZ = pathlib.Path(__file__).parent
API = "https://api.whop.com/api/v1"


def entorno():
    e = {}
    for l in (RAIZ / ".env.local").read_text().splitlines():
        if "=" in l and not l.startswith("#"):
            k, v = l.split("=", 1); e[k] = v.strip()
    return e

E = entorno()
H = {"apikey": E["SUPABASE_SERVICE_KEY"],
     "authorization": f"Bearer {E['SUPABASE_SERVICE_KEY']}",
     "content-type": "application/json"}


def supabase(metodo, ruta, cuerpo=None):
    req = urllib.request.Request(
        f"{E['SUPABASE_URL']}/rest/v1/{ruta}", method=metodo,
        data=json.dumps(cuerpo).encode() if cuerpo else None,
        headers={**H, "prefer": "return=representation"})
    t = urllib.request.urlopen(req, timeout=45).read().decode()
    return json.loads(t) if t.strip() else []


def arg(nombre, obligatorio=True, por_defecto=None):
    if nombre not in sys.argv:
        if obligatorio:
            sys.exit(f"\n  Falta {nombre}. Ver la cabecera del script.\n")
        return por_defecto
    return sys.argv[sys.argv.index(nombre) + 1]


def llave(store_id):
    fila = supabase("GET", f"store_whop?select=api_key_enc&store_id=eq.{store_id}")
    if not fila:
        sys.exit("\n  Esta tienda no tiene Whop conectado.\n")
    js = ('const {createDecipheriv,createHash}=require("crypto");'
          'const [v,iv,tag,body]=process.env.BLOB.split(".");'
          'const key=createHash("sha256").update(process.env.SECRETS_KEY).digest();'
          'const d=createDecipheriv("aes-256-gcm",key,Buffer.from(iv,"base64"));'
          'd.setAuthTag(Buffer.from(tag,"base64"));'
          'process.stdout.write(Buffer.concat([d.update(Buffer.from(body,"base64")),'
          'd.final()]).toString("utf8"));')
    r = subprocess.run(["node", "-e", js], capture_output=True, text=True,
                       env={**os.environ, "SECRETS_KEY": E["SECRETS_KEY"],
                            "BLOB": fila[0]["api_key_enc"]})
    if r.returncode or not r.stdout:
        sys.exit("  no pude descifrar la llave de Whop: " + r.stderr[:200])
    return r.stdout


def whop(k, ruta, metodo="GET", cuerpo=None):
    try:
        req = urllib.request.Request(
            API + ruta, method=metodo,
            data=json.dumps(cuerpo).encode() if cuerpo else None,
            headers={"authorization": f"Bearer {k}", "accept": "application/json",
                     "content-type": "application/json"})
        return json.loads(urllib.request.urlopen(req, timeout=60).read())
    except urllib.error.HTTPError as e:
        sys.exit(f"\n  Whop lo rechazo ({e.code}):\n  {e.read().decode()[:400]}\n")


def main():
    slug_tienda, slug_prod = arg("--tienda"), arg("--producto")
    slug_molde = arg("--molde", obligatorio=False, por_defecto="the-weekly-screen")
    crear = "--crear" in sys.argv

    tienda = supabase("GET", f"stores?select=id,slug&slug=eq.{slug_tienda}")
    if not tienda:
        sys.exit(f"\n  No existe la tienda «{slug_tienda}».\n")
    sid = tienda[0]["id"]

    def producto(s):
        f = supabase("GET", "products?select=id,slug,short_name,subscription,"
                            f"billing_period_days,whop_plan_id&store_id=eq.{sid}&slug=eq.{s}")
        if not f:
            sys.exit(f"\n  No existe el producto «{s}» en {slug_tienda}.\n")
        return f[0]

    p, molde = producto(slug_prod), producto(slug_molde)
    if not p["subscription"]:
        sys.exit(f"\n  «{slug_prod}» no esta marcado como suscripcion. Ponle\n"
                 "  subscription=true y billing_period_days antes de crear el plan.\n")
    if not molde["whop_plan_id"]:
        sys.exit(f"\n  El molde «{slug_molde}» no tiene plan: no hay de donde copiar.\n")

    precio = supabase("GET", f"product_prices?select=amount&product_id=eq.{p['id']}&currency=eq.USD")
    if not precio:
        sys.exit("\n  El producto no tiene precio en USD.\n")
    importe = float(precio[0]["amount"])

    # PRECIO DE RENOVACION, APARTE DEL PRIMERO.
    #   Hasta el 26/10/2026 este script ponia initial_price = renewal_price, o
    #   sea el mismo importe para siempre. Para una suscripcion normal esta
    #   bien; para una PRUEBA no: «el primer mes a 1 dolar» con los dos precios
    #   iguales cobra 1 dolar para siempre y destruye el precio de 9.
    #   El molde ingles (the-weekly-screen-trial) es 1,0 / 9,0 justamente por
    #   eso. Sin --renovacion el comportamiento es el de antes.
    renovacion = importe
    if "--renovacion" in sys.argv:
        renovacion = float(sys.argv[sys.argv.index("--renovacion") + 1])

    k = llave(sid)
    m = whop(k, f"/plans/{molde['whop_plan_id']}")
    prod_whop = m["product"]["id"]

    print(f"\n  Molde  {slug_molde}  ->  {m['id']}")
    print(f"    plan_type {m['plan_type']} · billing_period {m['billing_period']} dias"
          f" · {m['initial_price']} / {m['renewal_price']} · producto {prod_whop}")
    print(f"\n  Nuevo  {slug_prod}  ->  USD {importe} el primer periodo"
          + (f", despues USD {renovacion}" if renovacion != importe else "")
          + f", cada {p['billing_period_days']} dias")
    if renovacion != importe:
        print(f"    (initial_price {importe} / renewal_price {renovacion})")
    if p["whop_plan_id"]:
        print(f"    ya tiene plan: {p['whop_plan_id']}. Nada que hacer.\n"); return
    if not crear:
        print("\n  Para crearlo, agrega --crear\n"); return
    # Mismo control que planes-upsell.py: la confirmacion real es el permiso
    # explicito, no una pregunta que un asistente puede responder solo.
    if "--si" not in sys.argv:
        if input("  Escribi SI para crear el plan: ").strip().upper() != "SI":
            sys.exit("  Cancelado. No se creo nada.")

    nuevo = whop(k, "/plans", "POST", {
        "product_id": prod_whop,
        "plan_type": "renewal",
        "release_method": m.get("release_method", "buy_now"),
        "currency": "usd",
        "billing_period": p["billing_period_days"],
        "initial_price": importe,
        "renewal_price": renovacion,
        "visibility": "hidden",          # solo se vende desde el post-pago
        "unlimited_stock": True,
        "description": p["short_name"],
        "metadata": {"tienda": slug_tienda, "producto": slug_prod, "kind": "subscription"},
    })
    supabase("PATCH", f"products?id=eq.{p['id']}", {"whop_plan_id": nuevo["id"]})
    ver = supabase("GET", f"products?select=whop_plan_id&id=eq.{p['id']}")[0]
    print(f"\n    creado {nuevo['id']}  {nuevo.get('formatted_price')}  "
          f"enlazado={'si' if ver['whop_plan_id'] == nuevo['id'] else 'NO'}")
    print("""
  LISTO. Antes de confiar: una compra de prueba real.
    1. Comprar el kit con una tarjeta real.
    2. En la pagina del post-pago, aceptar la suscripcion.
    3. Ver que en Ventas aparezca el cobro del primer periodo.
    4. Cancelar desde el enlace del pie y ver que el acceso se corte al vencer.
""")


if __name__ == "__main__":
    main()
