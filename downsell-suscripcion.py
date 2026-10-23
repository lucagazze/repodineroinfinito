#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Crea el downsell de la suscripcion: primer periodo barato, despues el precio normal.

POR QUE NO ES UN PRECIO MAS BAJO
  La suscripcion es el ultimo paso del post-pago. Bajarle el precio mensual
  deja dos precios vivos del mismo producto para siempre, y cuando el precio de
  lista suba, los del downsell se quedan abajo indefinidamente. Lo que se baja
  es la BARRERA DE ENTRADA: Whop permite initial_price != renewal_price, asi que
  el primer periodo sale menos y despues entra al precio normal. El precio de
  lista no se toca.

  Ojo con esto: en el plan PRINCIPAL un primer periodo mas barato infla las
  altas y despues se cae todo junto. Como downsell es distinto -- el que llega
  ahi ya rechazo el precio normal, asi que lo que entre es incremental. Lo que
  hay que mirar es la SEGUNDA renovacion, no la primera: ahi se ve si el que
  entro por un dolar se queda.

  python3 downsell-suscripcion.py                                  # mira y dice que falta
  python3 downsell-suscripcion.py --primero 1 --despues 9 --crear   # crea y enlaza
"""
import argparse, json, os, pathlib, subprocess, sys, urllib.error, urllib.request

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
            t = r.read().decode()
            return json.loads(t) if t.strip() else {}
    except urllib.error.HTTPError as e:
        sys.exit(f"\n  Whop lo rechazo ({e.code}):\n  {e.read().decode()[:500]}\n")


def main():
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("--primero", type=float, help="USD del primer periodo")
    ap.add_argument("--despues", type=float, help="USD de cada periodo siguiente")
    ap.add_argument("--crear", action="store_true")
    ap.add_argument("--si", action="store_true")
    a = ap.parse_args()

    base = supabase("GET", "products?select=*&subscription=is.true&order=created_at.asc")
    if not base:
        sys.exit("\n  Ningun producto esta marcado como suscripcion.\n")
    base = base[0]
    dias = base.get("billing_period_days") or 30
    slug = base["slug"] + "-trial"

    # El paso del post-pago al que este downsell responde.
    pasos = supabase("GET", f"pp_steps?select=id,level,sort_order,kind,downsell_of&product_id=eq.{base['id']}")
    oto = next((p for p in pasos if p["kind"] == "oto"), None)
    if not oto:
        sys.exit("\n  La suscripcion no esta como OTO en ninguna cadena: no hay a que colgarle un downsell.\n")
    ya = supabase("GET", f"pp_steps?select=id,product_id&downsell_of=eq.{oto['id']}")
    existe = supabase("GET", f"products?select=*&slug=eq.{slug}")

    print(f"\n  Suscripcion: {base['short_name']}  ({base['slug']})  cada {dias} dias")
    print(f"  Plan normal: {base.get('whop_plan_id') or 'SIN PLAN'}")
    print(f"  Paso OTO:    {oto['id']}  (orden {oto['sort_order']})")
    print(f"  Downsell:    {'ya tiene -> ' + ya[0]['id'] if ya else 'NO TIENE'}")
    print(f"  Producto:    {'ya existe -> ' + existe[0]['id'] if existe else 'hay que crearlo'}  ({slug})\n")

    if ya:
        print("  Ya hay un downsell colgado de ese OTO. No toco nada.\n")
        return
    if not a.crear:
        print("""  Para crearlo hace falta decir los dos numeros:

    python3 downsell-suscripcion.py --primero 1 --despues 9 --crear

  --despues tiene que ser el precio de lista. No invento numeros.
""")
        return

    if a.primero is None or a.despues is None:
        sys.exit("\n  Faltan --primero y --despues.\n")
    if a.primero <= 0 or a.despues <= 0:
        sys.exit("\n  Los dos tienen que ser mayores que cero.\n")
    if a.primero > a.despues:
        sys.exit(f"\n  El primer periodo ({a.primero}) sale MAS que los siguientes ({a.despues}).\n"
                 "  Eso no es un downsell. Si es a proposito, invertilos.\n")

    k, empresa = llave()
    # Bajo el mismo producto de Whop que el plan normal, para no dispersar la cuenta.
    prod_whop = whop(k, f"/plans/{base['whop_plan_id']}")["product"]["id"]

    print(f"""  Cuenta {empresa}, producto de Whop {prod_whop}

  Voy a crear:
    1. un plan oculto en Whop: US$ {a.primero:g} el primer periodo, US$ {a.despues:g} cada {dias} dias despues
    2. el producto «{slug}», variante de la suscripcion
    3. su precio: {a.primero:g} con {a.despues:g} tachado
    4. el paso de downsell colgado del OTO {oto['id']}

  El precio de lista de la suscripcion (US$ {a.despues:g}) no se toca.
""")
    if not a.si:
        if input("  Escribi SI para seguir: ").strip().upper() != "SI":
            sys.exit("  Cancelado. No se creo nada.")
    else:
        print("  (confirmado con --si)")

    nombre = base["short_name"] or base["name"]

    # Cada paso se saltea si ya esta hecho. El primer intento fallo DESPUES de
    # crear el plan y el producto, y el reintento creo un plan nuevo: quedo uno
    # huerfano cobrable en la cuenta de Whop. No vuelve a pasar.
    if existe and existe[0].get("whop_plan_id"):
        plan_id = existe[0]["whop_plan_id"]
        print(f"    plan: {plan_id} (ya lo tenia, no creo otro)")
    else:
        plan_id = whop(k, "/plans", "POST", {
            "product_id": prod_whop,
            "plan_type": "renewal",
            "release_method": "buy_now",
            "currency": "usd",
            # Aca SI son distintos, y es el punto: el primer periodo es la
            # barrera baja, el resto es el precio de lista.
            "initial_price": a.primero,
            "renewal_price": a.despues,
            "billing_period": dias,
            "visibility": "hidden",
            "unlimited_stock": True,
            "description": f"{nombre} — first period ${a.primero:g}",
            "metadata": {"tienda": "financestudylab", "producto": slug, "rol": "downsell"},
        })["id"]
        print(f"    plan creado: {plan_id}")

    if existe:
        prod = existe[0]
        if prod.get("whop_plan_id") != plan_id:
            supabase("PATCH", f"products?id=eq.{prod['id']}", {"whop_plan_id": plan_id})
        print(f"    producto: {prod['id']} (ya existia)")
    else:
        prod = supabase("POST", "products", [{
            "store_id": base["store_id"],
            "slug": slug,
            "name": base["name"],
            "short_name": nombre,
            "description": base["description"],
            "kind": "postcompra",
            "active": True,
            "subscription": True,
            "billing_period_days": dias,
            "variant_of": base["id"],
            "image_url": base.get("image_url"),
            "email_image_url": base.get("email_image_url"),
            "sort_order": (base.get("sort_order") or 50) + 1,
            "whop_plan_id": plan_id,
        }])[0]
        print(f"    producto creado: {prod['id']}")

    # display_value es numerico (un valor declarado para el panel), no una
    # etiqueta: el «primer mes mas barato» se cuenta en la pagina del OTO.
    if not supabase("GET", f"product_prices?select=id&product_id=eq.{prod['id']}&currency=eq.USD"):
        supabase("POST", "product_prices", [{
            "product_id": prod["id"], "currency": "USD",
            "amount": a.primero, "compare_at": a.despues,
        }])
        print(f"    precio: {a.primero:g} (antes {a.despues:g})")
    else:
        print("    precio: ya estaba")

    paso = supabase("POST", "pp_steps", [{
        "pp_funnel_id": supabase("GET", f"pp_steps?select=pp_funnel_id&id=eq.{oto['id']}")[0]["pp_funnel_id"],
        "product_id": prod["id"],
        "kind": "downsell",
        "downsell_of": oto["id"],
        "sort_order": oto["sort_order"] + 1,
    }])[0]
    print(f"    paso de downsell: {paso['id']}  (orden {paso['sort_order']})\n")
    print("  Listo. Falta la pagina del downsell y revisar que el texto diga lo que se cobra.\n")


if __name__ == "__main__":
    main()
