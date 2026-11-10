#!/usr/bin/env python3
"""«The Whole Library» a 59,99: el escalon caro del post-pago de Maths.

QUE SE QUIERE. Subir el ticket promedio. Hoy la escalera de Maths topa en
27,99 (The Final Book) y el techo del pedido es 71,96. Con este escalon el
techo pasa a 103,96 y el nivel 2 pide 59,99 en vez de 27,99.

EL PRODUCTO YA ESTA CREADO Y DESACTIVADO:

    the-whole-library   16235918-8f1f-400b-8d4a-bc456dae278f   active = FALSE
    GBP   59,99   (suelto: 152,89)
    USD   77,00   (suelto: 196,90)
    ZAR 1299,99   (suelto: 3319,89)      -> 61 % en las tres monedas

Los 13 libros que trae salen de `includes`, y los 13 tienen precio en las tres
monedas: un comprador de Sudafrica ve el pack completo, no uno a medias. Las
tres sumas de arriba estan CALCULADAS sobre el catalogo, no estimadas; la
primera vez las puse de memoria y dos de las tres estaban mal (196,00 contra
196,90 y 3299,99 contra 3319,89).

POR QUE ESTO ES UN SCRIPT Y NO SE HIZO DE UNA. Porque recablear la escalera
ANTES de activar el producto la rompe en silencio, y conviene entender por que:

  - El esquema topa en TRES niveles (`pp_steps_level_check` rechaza el 4), asi
    que el escalon nuevo no se agrega: REEMPLAZA al nivel 2.
  - The Final Book pasa de OTO a downsell del nuevo.
  - Pero `chainFor` solo registra en `indexOfRow` los pasos que NO son
    downsell, y un downsell cuyo OTO no quedo en la cadena se descarta
    (`if (parent === undefined) return`).
  - Con el producto todavia inactivo, el OTO nuevo no entra en la cadena...
    y entonces The Final Book, que ahora cuelga de el, TAMPOCO. El nivel 2
    desaparece del post-pago y nadie se entera.

Por eso el cambio tiene que ser atomico con la activacion. Eso hace `--activar`.

LO QUE SE PIERDE, Y HAY QUE DECIRLO. The Final Book Lite (13,99) hoy es el
downsell de The Final Book. Un downsell no puede tener downsell, asi que al
bajar The Final Book a downsell, el Lite se cae de la escalera. El cambio no
es gratis: se cambia un peldanio de 27,99 con red de 13,99 por uno de 59,99
con red de 27,99. Mas arriba en los dos, pero un peldanio menos.

    ANTES                             DESPUES
    1  maths-solved      19,99        1  maths-solved         19,99
       \\_ Solved 25      11,99           \\_ Solved 25         11,99
    2  The Final Book    27,99        2  THE WHOLE LIBRARY    59,99
       \\_ Final Lite     13,99           \\_ The Final Book    27,99
    3  Physics cross      9,99        3  Physics cross         9,99
    techo              71,96          techo               103,96

LA PUERTA QUE NO SE PUEDE SALTEAR. Sin `whop_plan_id` el producto NO cobra:
/api/upsell contesta «not_available» antes de intentarlo. Es el defecto que
tuvo la tienda entera desde el 23/10 hasta el 9/11. Este script se NIEGA a
activar sin plan, justamente para no repetirlo.

Uso:
    python3 escalon-premium.py              # estado, no toca nada
    python3 escalon-premium.py --activar    # hace el cambio entero
    python3 escalon-premium.py --revertir   # deja la escalera como estaba
"""
import argparse, importlib.util, json, pathlib, sys

RAIZ = pathlib.Path(__file__).parent
LIB = "16235918-8f1f-400b-8d4a-bc456dae278f"          # the-whole-library
ESCALERA = "e30022e7-9432-4980-b772-620e00211f7c"     # Maths -> The Final Book -> Physics
FINAL_BOOK = "f5a754b1-0678-4bf2-8482-ec375645a998"   # the-final-book-oto
FINAL_LITE = "b710ae82-e22f-4a1b-826d-f1f9099aa5ad"   # the-final-book-lite

spec = importlib.util.spec_from_file_location("p", RAIZ / "crear-pixel-107.py")
mod = importlib.util.module_from_spec(spec)
_a = sys.argv[:]; sys.argv = ["x", "--ver"]
try: spec.loader.exec_module(mod)
except SystemExit: pass
sys.argv = _a
sb = mod.supabase


def escalera():
    pasos = sb("GET", f"pp_steps?pp_funnel_id=eq.{ESCALERA}"
                      "&select=id,sort_order,kind,level,product_id,downsell_of&order=sort_order")
    ids = ",".join(p["product_id"] for p in pasos)
    prods = {p["id"]: p for p in sb("GET", f"products?id=in.({ids})&select=id,slug,active,whop_plan_id")}
    precios = {}
    for r in sb("GET", f"product_prices?product_id=in.({ids})&currency=eq.GBP&select=product_id,amount"):
        precios[r["product_id"]] = r["amount"]
    return pasos, prods, precios


def mostrar():
    pasos, prods, precios = escalera()
    print("\n  ESCALERA DE MATHS, como esta ahora:\n")
    techo = 13.99   # el principal del checkout
    for p in pasos:
        pr = prods.get(p["product_id"], {})
        precio = float(precios.get(p["product_id"], 0) or 0)
        marca = "  " if p["kind"] == "oto" else "   \\_"
        estado = "" if pr.get("active") else "   [DESACTIVADO]"
        plan = "" if pr.get("whop_plan_id") else "   [SIN PLAN DE WHOP: no cobra]"
        nivel = f"nivel {p['level']}" if p["level"] else "       "
        print(f"  {nivel} {marca} {pr.get('slug','?'):<24} GBP {precio:>6.2f}{estado}{plan}")
        if p["kind"] == "oto":
            techo += precio
    print(f"\n  techo del pedido: GBP {techo:.2f}\n")

    lib = sb("GET", f"products?id=eq.{LIB}&select=slug,active,whop_plan_id")[0]
    pr = sb("GET", f"product_prices?product_id=eq.{LIB}&select=currency,amount,compare_at&order=currency")
    print("  EL ESCALON NUEVO:")
    print(f"    {lib['slug']}   active={lib['active']}")
    for r in pr:
        d = round((1 - float(r["amount"]) / float(r["compare_at"])) * 100)
        print(f"      {r['currency']} {float(r['amount']):>8.2f}   suelto {float(r['compare_at']):>8.2f}   -{d}%")
    print(f"    plan de Whop: {lib['whop_plan_id'] or 'FALTA — sin esto no cobra'}")
    return lib


def crear_plan():
    """El plan de Whop del escalon nuevo. En LIBRAS, y la razon no es menor.

    LA API SI CREA PLANES: `planes-upsell.py` lo viene haciendo desde el
    22/10/2026 y los 8 escalones que hay salieron de ahi. Este reusa el mismo
    cuerpo, con UN cambio.

    EL CAMBIO: `planes-upsell.py` tiene `"currency": "usd"` escrito fijo, de
    cuando USD era la unica moneda del catalogo. Hoy hay tres, y el cobro con
    tarjeta guardada NO lleva importe: `cobrarGuardada` manda solo `plan_id`,
    asi que **manda la moneda del plan, no la de la pagina**. Medido el
    10/11/2026 sobre `plan_tuQMB1m1sQs8Z` (maths-solved): el plan dice USD
    25,99 y la pagina de la oferta le muestra GBP 19,99 a un britanico y
    ZAR 439,99 a un sudafricano, porque usa `priceFor(product, order.currency)`.

    POR QUE LIBRAS PARA ESTE. Entre equivocarse para arriba y para abajo, se
    elige para abajo: nadie puede pagar MAS de lo que vio.
        plan en GBP 59,99  -> al britanico se le cobra exactamente lo que vio;
                              al sudafricano, menos que los R 1.299,99 que vio.
        plan en USD 77,00  -> al sudafricano se le cobraria mas que lo que vio.
    Perder unos pesos es un problema nuestro; cobrar de mas es del comprador.

    LO QUE ESTO NO ARREGLA, y hay que decirlo: los 8 escalones que ya existen
    siguen en USD. El arreglo de fondo es un plan por moneda y que la ruta
    elija por `order.currency`; eso toca el camino de cobro en vivo y lo
    decide Bruno.
    """
    p = sb("GET", f"products?id=eq.{LIB}&select=slug,name,short_name,whop_plan_id")[0]
    if p["whop_plan_id"]:
        sys.exit(f"  ya tiene plan: {p['whop_plan_id']}")
    precio = float(sb("GET", f"product_prices?product_id=eq.{LIB}"
                             "&currency=eq.GBP&select=amount")[0]["amount"])

    tienda = sb("GET", "stores?slug=eq.physicsstudylab&select=id")[0]["id"]
    conn = sb("GET", f"store_whop?store_id=eq.{tienda}&select=api_key_enc")[0]
    llave = mod.descifrar(conn["api_key_enc"])

    # El producto de Whop bajo el que cuelgan todos nuestros planes: se lee de
    # un plan que ya cobra, en vez de escribirlo fijo.
    modelo = sb("GET", "products?whop_plan_id=not.is.null&select=whop_plan_id"
                       f"&store_id=eq.{tienda}&limit=1")[0]["whop_plan_id"]
    est, d = whop(llave, "GET", f"/plans/{modelo}")
    if est >= 300:
        sys.exit(f"  no pude leer el plan modelo {modelo}: {d}")
    prod_whop = d["product"]["id"]
    print(f"  producto de Whop: {prod_whop} ({d['product'].get('title')})")
    print(f"  creando plan one_time · GBP {precio:.2f} · oculto")

    est, nuevo = whop(llave, "POST", "/plans", {
        "product_id": prod_whop,
        "plan_type": "one_time",
        "release_method": "buy_now",
        "currency": "gbp",
        "initial_price": precio,
        "visibility": "hidden",          # solo se vende desde el post-pago
        "unlimited_stock": True,
        "description": p["short_name"] or p["name"],
        "metadata": {"tienda": "physicsstudylab", "producto": p["slug"], "kind": "upsell"},
    })
    if est >= 300:
        sys.exit(f"  Whop contesto {est}: {json.dumps(nuevo, ensure_ascii=False)[:500]}\n"
                 "  No se toco la base.")
    sb("PATCH", f"products?id=eq.{LIB}", {"whop_plan_id": nuevo["id"]})
    # Comprobacion: que la base apunta y que el plan cobra lo que debe.
    est2, leido = whop(llave, "GET", f"/plans/{nuevo['id']}")
    guardado = sb("GET", f"products?id=eq.{LIB}&select=whop_plan_id")[0]["whop_plan_id"]
    print(f"\n  plan      {nuevo['id']}")
    print(f"  cobra     {leido.get('formatted_price')}  ({leido.get('currency')})")
    print(f"  enlazado  {'si' if guardado == nuevo['id'] else 'NO'}")
    print("\n  EL PRODUCTO SIGUE DESACTIVADO. Para prenderlo:")
    print("      python3 escalon-premium.py --activar\n")


def whop(llave, metodo, ruta, cuerpo=None):
    import urllib.error, urllib.request
    req = urllib.request.Request(
        "https://api.whop.com/api/v1" + ruta, method=metodo,
        data=json.dumps(cuerpo).encode() if cuerpo is not None else None,
        headers={"authorization": f"Bearer {llave}", "content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read().decode() or "null")
    except urllib.error.HTTPError as e:
        texto = e.read().decode(errors="replace")
        try: return e.code, json.loads(texto)
        except Exception: return e.code, texto[:500]


def activar():
    lib = sb("GET", f"products?id=eq.{LIB}&select=slug,active,whop_plan_id")[0]
    if not lib["whop_plan_id"]:
        sys.exit("""
  NO ACTIVO: «the-whole-library» no tiene plan de Whop.

  Sin el, /api/upsell contesta «not_available» ANTES de intentar el cobro y el
  comprador que diga que si se va sin pagar. Es exactamente lo que le paso a la
  tienda entera entre el 23/10 y el 9/11.

  Para destrabarlo: crear en Whop una variante de pago unico por GBP 59,99 y
  guardar su id en `products.whop_plan_id` del producto the-whole-library.
""")
    # 1. el producto entra en juego
    sb("PATCH", f"products?id=eq.{LIB}", {"active": True})
    # 2. el escalon nuevo toma el nivel 2
    pasos = sb("GET", f"pp_steps?pp_funnel_id=eq.{ESCALERA}&select=id,product_id,kind")
    fb = next(p for p in pasos if p["product_id"] == FINAL_BOOK)
    ya = next((p for p in pasos if p["product_id"] == LIB), None)
    if ya:
        nuevo_id = ya["id"]
        sb("PATCH", f"pp_steps?id=eq.{nuevo_id}", {"sort_order": 99, "kind": "oto", "level": 2, "downsell_of": None})
    else:
        nuevo_id = sb("POST", "pp_steps", {
            "pp_funnel_id": ESCALERA, "product_id": LIB,
            "sort_order": 99, "kind": "oto", "level": 2})[0]["id"]
    # 3. The Final Book baja a ser su downsell
    sb("PATCH", f"pp_steps?id=eq.{fb['id']}", {"kind": "downsell", "level": None, "downsell_of": nuevo_id})
    # 4. The Final Book Lite sale: un downsell no puede tener downsell, y
    #    dejarlo colgado lo descartaria en silencio.
    lite = next((p for p in pasos if p["product_id"] == FINAL_LITE), None)
    if lite:
        sb("DELETE", f"pp_steps?id=eq.{lite['id']}")
    print("\n  LISTO. Asi quedo:")
    mostrar()


def revertir():
    pasos = sb("GET", f"pp_steps?pp_funnel_id=eq.{ESCALERA}&select=id,product_id")
    fb = next(p for p in pasos if p["product_id"] == FINAL_BOOK)
    nuevo = next((p for p in pasos if p["product_id"] == LIB), None)
    sb("PATCH", f"pp_steps?id=eq.{fb['id']}", {"kind": "oto", "level": 2, "downsell_of": None})
    if not any(p["product_id"] == FINAL_LITE for p in pasos):
        sb("POST", "pp_steps", {"pp_funnel_id": ESCALERA, "product_id": FINAL_LITE,
                                "sort_order": 101, "kind": "downsell", "downsell_of": fb["id"]})
    if nuevo:
        sb("DELETE", f"pp_steps?id=eq.{nuevo['id']}")
    sb("PATCH", f"products?id=eq.{LIB}", {"active": False})
    print("\n  Revertido. Asi quedo:")
    mostrar()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--crear-plan", action="store_true",
                    help="crea en Whop el plan del escalon (en libras)")
    ap.add_argument("--activar", action="store_true")
    ap.add_argument("--revertir", action="store_true")
    a = ap.parse_args()
    if getattr(a, "crear_plan"): crear_plan()
    elif a.activar: activar()
    elif a.revertir: revertir()
    else:
        mostrar()
        print("\n  [nada cambiado]  --activar lo prende,  --revertir lo deshace\n")
