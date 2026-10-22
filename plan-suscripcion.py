#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Crea en Whop los planes RECURRENTES de la suscripcion y los deja enlazados.

POR QUE HACEN FALTA DOS PLANES
  Whop fija el precio en el momento en que alguien se suscribe, y no hay
  «descuento de por vida»: la unica forma de prometerle a un fundador que su
  precio no se mueve es ponerlo en OTRO plan, con su propio precio. Por eso
  esto crea dos -- el normal y el de fundador -- y guarda los dos en el
  producto. Quien entra, entra por el que le corresponde segun la fecha de su
  primera compra.

LA FECHA DE CORTE
  Fundador = compro el libro ANTES de que abriera el nivel pago. La fecha se
  fija en el momento de crear los planes, no antes: poner una fecha futura
  convertiria en fundador a quien compre despues de abrir, que es justo lo
  contrario de lo que la palabra promete.

  python3 plan-suscripcion.py                                   # mira y dice que falta
  python3 plan-suscripcion.py --precio 19 --fundador 9 --crear   # crea y enlaza
  python3 plan-suscripcion.py --producto the-leader-list ...     # si hubiera mas de una
"""
import argparse, json, os, pathlib, subprocess, sys, urllib.error, urllib.request
from datetime import datetime, timezone

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
        sys.exit(f"\n  Whop lo rechazo ({e.code}):\n  {e.read().decode()[:400]}\n")


def el_producto(slug=None):
    """El producto marcado como suscripcion. Con --producto, ese y no otro."""
    if slug:
        f = supabase("GET", f"products?select=*&slug=eq.{slug}")
        if not f:
            sys.exit(f"\n  No existe el producto «{slug}».\n")
        return f[0]
    f = supabase("GET", "products?select=*&subscription=is.true&order=created_at.asc")
    if not f:
        sys.exit("""
  Ningun producto esta marcado como suscripcion.

  Primero hay que decidir DOS cosas que no puedo decidir yo: como se llama y
  cuanto sale. Despues se marca el producto:

    python3 migrar.py --sql "update products set subscription = true,
      billing_period_days = 30 where slug = 'EL-SLUG'"

  Si el producto todavia no existe, se crea desde el panel (Catalogos) como
  cualquier otro: necesita nombre, tapa y texto de entrega.
""")
    return f[0]


def main():
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("--producto", help="slug, si hubiera mas de una suscripcion")
    ap.add_argument("--precio", type=float, help="USD por periodo, precio normal")
    ap.add_argument("--fundador", type=float, help="USD por periodo para los fundadores")
    ap.add_argument("--dias", type=int, default=None, help="largo del periodo (por defecto, el del producto o 30)")
    ap.add_argument("--crear", action="store_true")
    ap.add_argument("--si", action="store_true", help="confirmacion no interactiva")
    a = ap.parse_args()

    k, empresa = llave()
    p = el_producto(a.producto)
    dias = a.dias or p.get("billing_period_days") or 30

    print(f"\n  Cuenta {empresa}")
    print(f"  Producto: {p['short_name'] or p['name']}  ({p['slug']})")
    print(f"  Periodo:  cada {dias} dias\n")
    print(f"    plan normal    {p.get('whop_plan_id') or 'SIN PLAN'}")
    print(f"    plan fundador  {p.get('whop_founder_plan_id') or 'SIN PLAN'}")
    print(f"    corte fundador {p.get('founder_cutoff') or 'sin fijar (no hay fundadores)'}")

    if not a.crear:
        print("""
  Para crearlos hace falta decir los dos precios:

    python3 plan-suscripcion.py --precio 19 --fundador 9 --crear

  No invento numeros. El precio es la decision mas dificil de una suscripcion y
  no se puede cambiar despues para quien ya entro.
""")
        return

    if a.precio is None:
        sys.exit("\n  Falta --precio. Sin precio no se crea nada.\n")
    if a.fundador is None:
        sys.exit("\n  Falta --fundador. Si no quieres precio de fundador, pone el mismo que --precio.\n")
    if a.precio <= 0 or a.fundador <= 0:
        sys.exit("\n  Los precios tienen que ser mayores que cero.\n")
    if a.fundador > a.precio:
        sys.exit(f"\n  El precio de fundador ({a.fundador}) es MAYOR que el normal ({a.precio}).\n"
                 "  Si es a proposito, invertilos; si no, es un error de tipeo.\n")

    # El producto de Whop bajo el que cuelgan los planes: el mismo del kit, para
    # no dispersar el catalogo de la cuenta.
    emb = supabase("GET", "funnels?select=whop_plan_id&slug=eq.kit")
    if not emb or not emb[0]["whop_plan_id"]:
        sys.exit("\n  No encuentro el plan del kit para saber bajo que producto de Whop colgar estos.\n")
    prod_whop = whop(k, f"/plans/{emb[0]['whop_plan_id']}")["product"]["id"]

    corte = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    print(f"""
  Voy a crear DOS planes recurrentes en USD, ocultos (solo se venden desde
  donde los pongamos), bajo el producto de Whop {prod_whop}:

    normal     US$ {a.precio:g} cada {dias} dias
    fundador   US$ {a.fundador:g} cada {dias} dias

  Y la fecha de corte de fundador queda en AHORA: {corte}
  Quien compro el libro antes de este instante entra al precio de fundador.
  Quien compre despues, al normal. Esto no se puede deshacer para quien ya
  se haya suscrito.
""")
    if not a.si:
        if input("  Escribi SI para seguir: ").strip().upper() != "SI":
            sys.exit("  Cancelado. No se creo nada.")
    else:
        print("  (confirmado con --si)")

    nombre = p["short_name"] or p["name"]
    hechos = {}
    for clave, precio, etiqueta in (("whop_plan_id", a.precio, "normal"),
                                    ("whop_founder_plan_id", a.fundador, "fundador")):
        if p.get(clave):
            print(f"    {etiqueta:<9} ya tenia plan: {p[clave]} (no lo toco)")
            continue
        nuevo = whop(k, "/plans", "POST", {
            "product_id": prod_whop,
            "plan_type": "renewal",
            "release_method": "buy_now",
            "currency": "usd",
            # initial_price = lo que paga la primera vez; renewal_price = cada
            # periodo. Iguales a proposito: un primer mes mas barato que el
            # siguiente infla las altas y despues se cae todo junto.
            "initial_price": precio,
            "renewal_price": precio,
            "billing_period": dias,
            "visibility": "hidden",
            "unlimited_stock": True,
            "description": f"{nombre}" + ("" if etiqueta == "normal" else " — founder rate"),
            "metadata": {"tienda": "financestudylab", "producto": p["slug"],
                         "kind": "subscription", "tarifa": etiqueta},
        })
        hechos[clave] = nuevo["id"]
        print(f"    {etiqueta:<9} {nuevo['id']}  {nuevo.get('formatted_price')}")

    cambios = {**hechos, "billing_period_days": dias, "subscription": True}
    if not p.get("founder_cutoff"):
        cambios["founder_cutoff"] = corte
    supabase("PATCH", f"products?id=eq.{p['id']}", cambios)

    ver = supabase("GET", f"products?select=whop_plan_id,whop_founder_plan_id,founder_cutoff,billing_period_days,subscription&id=eq.{p['id']}")[0]
    print("\n  En la base quedo:")
    for c, v in ver.items():
        print(f"    {c:<22} {v}")

    print("""
  LISTO. Lo que falta antes de confiar en esto:
    1. Una suscripcion de prueba con tarjeta real: que llegue el mail de
       bienvenida y que aparezca en el panel, en Suscripciones.
    2. Abrir el link de baja de ese mail y cancelar: que deje de cobrar en Whop
       y que el panel lo muestre como dado de baja con acceso hasta fin de mes.
  La renovacion no se puede probar hoy: recien se puede ver dentro de un mes.
  Lo que SI esta probado es que un cobro repetido no cuenta dos veces.
""")


if __name__ == "__main__":
    main()
