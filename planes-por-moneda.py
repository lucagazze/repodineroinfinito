#!/usr/bin/env python3
"""Un plan de Whop por moneda, para que se cobre lo que se muestra.

EL DEFECTO, medido el 10/11/2026. El cobro post-compra con tarjeta guardada
NO lleva importe: `cobrarGuardada` manda solo `plan_id`, asi que **manda la
moneda del plan**. Y todos los planes se crearon en USD, porque
`planes-upsell.py` tiene `"currency": "usd"` escrito fijo de cuando USD era la
unica moneda del catalogo. La pagina de la oferta, en cambio, usa
`priceFor(product, order.currency)`.

    plan_tuQMB1m1sQs8Z  maths-solved   el plan dice   USD  25,99
    la pagina, a un britanico,         le muestra     GBP  19,99
    la pagina, a un sudafricano,       le muestra     ZAR 439,99

Se muestra en una moneda y se cobra en otra. Es la misma familia que el IVA
oculto de libras: el numero de la pantalla no es el de la tarjeta. Para un
britanico la diferencia es el recargo por compra en moneda extranjera que
cobra casi toda tarjeta del Reino Unido; para Sudafrica, que acaba de abrir,
se suma que la conversion se mueve sola.

QUE HACE. Por cada producto de una cadena post-compra activa, crea en Whop el
plan que falte en cada moneda que el producto tiene cargada, y los guarda en
`products.whop_plan_ids` ({"GBP": "plan_...", "ZAR": "plan_..."}).
`whop_plan_id` no se toca: sigue siendo el de siempre y el que se usa si la
moneda del pedido no tiene plan propio.

NO CAMBIA NADA POR SI SOLO. Los planes nuevos quedan creados y guardados, pero
hasta que /api/upsell elija por `order.currency` se sigue cobrando el de
siempre. Crear planes ocultos de mas no cobra nada ni le aparece a nadie.

    python3 planes-por-moneda.py           # dice que falta, no escribe
    python3 planes-por-moneda.py --crear   # los crea
"""
import argparse, importlib.util, json, pathlib, sys, time
import urllib.error, urllib.request

RAIZ = pathlib.Path(__file__).parent
API = "https://api.whop.com/api/v1"
TIENDA_SLUG = "physicsstudylab"
# Las monedas que el checkout sirve hoy. Una moneda que el producto no tiene
# cargada se saltea: no se inventa un precio.
MONEDAS = ("GBP", "USD", "ZAR")

spec = importlib.util.spec_from_file_location("p", RAIZ / "crear-pixel-107.py")
mod = importlib.util.module_from_spec(spec)
_a = sys.argv[:]; sys.argv = ["x", "--ver"]
try: spec.loader.exec_module(mod)
except SystemExit: pass
sys.argv = _a
sb = mod.supabase

TIENDA = sb("GET", f"stores?slug=eq.{TIENDA_SLUG}&select=id")[0]["id"]
LLAVE = mod.descifrar(sb("GET", f"store_whop?store_id=eq.{TIENDA}&select=api_key_enc")[0]["api_key_enc"])


def whop(metodo, ruta, cuerpo=None):
    req = urllib.request.Request(
        API + ruta, method=metodo,
        data=json.dumps(cuerpo).encode() if cuerpo is not None else None,
        headers={"authorization": f"Bearer {LLAVE}", "content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read().decode() or "null")
    except urllib.error.HTTPError as e:
        t = e.read().decode(errors="replace")
        try: return e.code, json.loads(t)
        except Exception: return e.code, t[:400]


def productos():
    """Los productos de toda cadena post-compra ACTIVA de esta tienda."""
    funnels = sb("GET", f"pp_funnels?store_id=eq.{TIENDA}&active=is.true&select=id")
    ids = set()
    for f in funnels:
        for s in sb("GET", f"pp_steps?pp_funnel_id=eq.{f['id']}&select=product_id"):
            ids.add(s["product_id"])
    if not ids:
        return []
    lista = ",".join(ids)
    prods = sb("GET", f"products?id=in.({lista})"
                      "&select=id,slug,name,short_name,active,whop_plan_id,whop_plan_ids")
    precios = {}
    for r in sb("GET", f"product_prices?product_id=in.({lista})&select=product_id,currency,amount"):
        precios.setdefault(r["product_id"], {})[r["currency"]] = float(r["amount"])
    for p in prods:
        p["precios"] = precios.get(p["id"], {})
    return sorted(prods, key=lambda p: p["slug"])


def producto_de_whop():
    """El producto de Whop bajo el que cuelgan nuestros planes. Se LEE."""
    modelo = sb("GET", f"products?store_id=eq.{TIENDA}&whop_plan_id=not.is.null"
                       "&select=whop_plan_id&limit=1")[0]["whop_plan_id"]
    est, d = whop("GET", f"/plans/{modelo}")
    if est >= 300:
        sys.exit(f"  no pude leer el plan modelo: {d}")
    return d["product"]["id"]


def adoptar_existentes():
    """El plan que ya existe se ADOPTA, no se duplica.

    Cada producto tiene su `whop_plan_id` de siempre, creado en una moneda
    concreta. Crear otro plan en esa misma moneda seria tener dos cobrando lo
    mismo y no saber cual mira cada cosa. Asi que primero se lee de Whop en
    que moneda esta y, si coincide con el precio de la base, se anota en
    `whop_plan_ids` bajo esa moneda.
    """
    adoptados = 0
    for p in productos():
        plan = p.get("whop_plan_id")
        ya = p.get("whop_plan_ids") or {}
        if not plan or any(v == plan for v in ya.values()):
            continue
        est, d = whop("GET", f"/plans/{plan}")
        if est >= 300:
            print(f"  ! {p['slug']}: no pude leer {plan} ({est})"); continue
        m = (d.get("currency") or "").upper()
        precio = float(d.get("initial_price") or 0)
        esperado = p["precios"].get(m)
        if esperado is None or abs(precio - esperado) > 0.005:
            print(f"  ! {p['slug']}: el plan {plan} cobra {m} {precio:.2f} y la base "
                  f"dice {esperado}. NO lo adopto.")
            continue
        ya[m] = plan
        sb("PATCH", f"products?id=eq.{p['id']}", {"whop_plan_ids": ya})
        print(f"  adoptado  {p['slug']:<28} {m}  {plan}")
        adoptados += 1
        time.sleep(0.2)
    if adoptados:
        print(f"\n  {adoptados} planes que ya existian quedaron anotados por su moneda.\n")


def main(crear):
    prod_whop = producto_de_whop() if crear else None
    if crear:
        adoptar_existentes()
    faltan = []
    print(f"\n  {'producto':<28} {'moneda':<7} {'precio':>10}   plan")
    print("  " + "─" * 68)
    for p in productos():
        ya = p.get("whop_plan_ids") or {}
        for m in MONEDAS:
            if m not in p["precios"]:
                continue
            tiene = ya.get(m)
            marca = tiene or ("— falta" if p["active"] else "— (producto apagado)")
            print(f"  {p['slug']:<28} {m:<7} {p['precios'][m]:>10.2f}   {marca}")
            if not tiene and p["active"]:
                faltan.append((p, m))
    print()
    if not faltan:
        return print("  Nada que crear: cada producto activo tiene plan en cada moneda.\n")
    print(f"  FALTAN {len(faltan)} planes.")
    if not crear:
        return print("  [ensayo] con --crear se crean.\n")

    for p, m in faltan:
        est, nuevo = whop("POST", "/plans", {
            "product_id": prod_whop,
            "plan_type": "one_time",
            "release_method": "buy_now",
            "currency": m.lower(),
            "initial_price": p["precios"][m],
            "visibility": "hidden",        # solo se vende desde el post-pago
            "unlimited_stock": True,
            "description": f"{p['short_name'] or p['name']} ({m})",
            "metadata": {"tienda": TIENDA_SLUG, "producto": p["slug"],
                         "kind": "upsell", "moneda": m},
        })
        if est >= 300:
            print(f"  ERROR {p['slug']} {m}: {est} {json.dumps(nuevo, ensure_ascii=False)[:200]}")
            continue
        # Se relee la fila antes de escribir: dos monedas del mismo producto se
        # crean una tras otra y un dict viejo pisaria la anterior.
        actual = sb("GET", f"products?id=eq.{p['id']}&select=whop_plan_ids")[0]["whop_plan_ids"] or {}
        actual[m] = nuevo["id"]
        sb("PATCH", f"products?id=eq.{p['id']}", {"whop_plan_ids": actual})
        print(f"  {p['slug']:<28} {m:<7} {nuevo['id']}  {nuevo.get('formatted_price')}")
        time.sleep(0.4)

    print("\n  COMPROBACION: cada plan guardado, leido de Whop\n")
    malos = 0
    for p in productos():
        for m, plan in (p.get("whop_plan_ids") or {}).items():
            est, d = whop("GET", f"/plans/{plan}")
            ok = (est < 300 and (d.get("currency") or "").upper() == m
                  and abs(float(d.get("initial_price") or 0) - p["precios"].get(m, -1)) < 0.005)
            if not ok:
                malos += 1
            print(f"  {'ok ' if ok else 'MAL'} {p['slug']:<28} {m}  {d.get('formatted_price')}")
            time.sleep(0.2)
    print(f"\n  {'todos coinciden con el precio de la base' if not malos else str(malos) + ' NO coinciden'}")
    print("  Esto todavia NO cambia lo que se cobra: falta que /api/upsell "
          "elija por order.currency.\n")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--crear", action="store_true")
    main(ap.parse_args().crear)
