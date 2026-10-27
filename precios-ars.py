#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Pone los precios en pesos del embudo español, al MEP del día.

POR QUE HACE FALTA UN SCRIPT Y NO LO HACE LA APP SOLA
  La app convierte monedas sola (lib/fx.ts, proveedor Frankfurter), pero ese
  proveedor trae 29 monedas y **el peso argentino NO esta entre ellas**:
  comprobado el 27/10/2026 contra su API. Asi que para ARS no hay conversion
  automatica posible y los precios van cargados a mano, como un `market`.

  Y cargados a mano quedan congelados. Con la inflacion de aca, en unos meses
  se esta vendiendo mas barato sin haberlo decidido. Esto es para volver a
  correrlo cada tanto en vez de tocar nueve filas una por una.

POR QUE EL MEP Y NO EL OFICIAL
  Bruno cobra pesos en Mercado Pago, y el MEP es la tasa a la que los convierte
  de vuelta a dolares. Con el oficial cobraria lo mismo en pesos y le quedarian
  menos dolares. El precio en USD de cada producto es la referencia; el de ARS
  se deriva.

  python3 precios-ars.py            # dice que haria, sin tocar nada
  python3 precios-ars.py --cargar   # lo carga
"""
import json, pathlib, sys, urllib.error, urllib.request

RAIZ = pathlib.Path(__file__).parent
TIENDA = "financestudylab"
PAISES = ["AR"]

# Los nueve del embudo kit-es. El precio en USD es el que manda y el de ARS se
# deriva: si manana cambia uno en dolares, este script lo arrastra solo.
PRODUCTOS = [
    "siete-letras", "donde-sale-cada-cifra", "cuaderno-del-domingo",
    "la-hoja-de-valuacion", "la-hoja-de-valuacion-lite",
    "leer-y-ciclo", "leer-una-empresa",
    "vision-semanal", "vision-semanal-prueba",
]


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


def sb(metodo, ruta, cuerpo=None):
    req = urllib.request.Request(
        f"{E['SUPABASE_URL']}/rest/v1/{ruta}", method=metodo,
        data=json.dumps(cuerpo).encode() if cuerpo else None,
        headers={**H, "prefer": "return=representation"})
    txt = urllib.request.urlopen(req, timeout=45).read().decode()
    return json.loads(txt) if txt else []


def traer(url):
    """GET con User-Agent propio.

    Sin el, urllib manda «Python-urllib/3.x» y las dos APIs de cotizaciones
    contestan 403. Medido el 27/10/2026: con cabecera, las dos responden.
    """
    req = urllib.request.Request(url, headers={
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) precios-ars",
        "accept": "application/json",
    })
    return json.load(urllib.request.urlopen(req, timeout=15))


def mep():
    """El MEP de hoy, de dos fuentes. Si no coinciden razonablemente, para.

    Un solo proveedor caido o con un numero raro pondria todos los precios mal
    de una, y nadie se entera hasta que alguien compra por monedas.
    """
    valores = []
    try:
        d = traer("https://dolarapi.com/v1/dolares")
        for c in d:
            if c.get("casa") in ("bolsa", "blue"):
                valores.append((c["casa"], float(c["venta"])))
    except Exception as e:
        print(f"  dolarapi no respondio: {e}")
    try:
        d = traer("https://api.bluelytics.com.ar/v2/latest")
        valores.append(("blue (bluelytics)", float(d["blue"]["value_sell"])))
    except Exception as e:
        print(f"  bluelytics no respondio: {e}")

    if len(valores) < 2:
        sys.exit("\n  Hacen falta DOS fuentes para fijar el precio. No se toca nada.\n")
    for n, v in valores:
        print(f"    {n:22} {v:,.0f}".replace(",", "."))
    bolsa = [v for n, v in valores if n == "bolsa"]
    tasa = bolsa[0] if bolsa else max(v for _, v in valores)
    peor, mejor = min(v for _, v in valores), max(v for _, v in valores)
    if mejor / peor > 1.15:
        sys.exit(f"\n  Las fuentes difieren {mejor/peor-1:.0%}. Mirá qué pasa antes de cargar.\n")
    return tasa


def redondear(ars):
    """Al millar mas cercano, terminado en 900: 26.809 -> 26.900, 1.577 -> 1.900.

    Una sola regla para los nueve. La primera version tenia un caso aparte para
    los importes chicos y un parametro para forzar hacia abajo; ninguno de los
    dos cambiaba un solo precio, asi que eran complejidad que podia fallar sin
    que nadie lo notara.
    """
    return max(900, round(ars / 1000) * 1000 - 100)


def main():
    cargar = "--cargar" in sys.argv
    print("\n  Cotizaciones de hoy:")
    tasa = mep()
    print(f"\n  Usando {tasa:,.0f} ARS por dólar (MEP).\n".replace(",", "."))

    tienda = sb("GET", f"stores?select=id,gateway&slug=eq.{TIENDA}")[0]
    sid = tienda["id"]

    # EL MERCADO SOLO SE ENCIENDE SI COBRA MERCADO PAGO.
    #   Los seis pasos del post-pago cobran contra planes de Whop fijados en
    #   DOLARES. Si el mercado ARS estuviera activo con la tienda en Whop, un
    #   argentino veria «ARS 42.900» en la pagina y Whop le cobraria USD 27.
    #   Medido el 27/10/2026: oferta/[step]/page.tsx toma la moneda de
    #   `order.currency`, asi que los precios en pesos SI llegarian a esa
    #   pantalla. Los precios se cargan igual --quedan listos-- pero el pais
    #   no se enchufa hasta que la pasarela sea mercadopago.
    encender = tienda.get("gateway") == "mercadopago"

    # El mercado: sin esto el checkout no sabe que a un argentino hay que
    # cobrarle en pesos, y le seguiria mostrando dolares.
    mk = sb("GET", f"markets?select=id,currency,countries&store_id=eq.{sid}&currency=eq.ARS")
    if not mk:
        print("  Mercado ARS: NO existe, hay que crearlo")
    elif PAISES[0] not in (mk[0].get("countries") or []):
        print(f"  Mercado ARS: existe pero sin {PAISES[0]}")
    else:
        print("  Mercado ARS: ya está")

    filas = []
    for slug in PRODUCTOS:
        p = sb("GET", f"products?select=id,slug&slug=eq.{slug}&store_id=eq.{sid}")
        if not p:
            print(f"    {slug:28} NO EXISTE, se saltea"); continue
        pid = p[0]["id"]
        usd = sb("GET", f"product_prices?select=amount&product_id=eq.{pid}&currency=eq.USD")
        if not usd:
            print(f"    {slug:28} sin precio en USD, se saltea"); continue
        base = float(usd[0]["amount"])
        exacto = base * tasa
        ars = redondear(exacto)
        vuelta = ars / tasa
        filas.append((slug, pid, base, exacto, ars, vuelta))

    print(f"\n  {'producto':28} {'USD':>7} {'exacto':>12} {'a cargar':>12} {'= USD':>8}")
    for slug, _, base, exacto, ars, vuelta in filas:
        print(f"    {slug:26} {base:>7.2f} {exacto:>12,.0f} {ars:>12,.0f} {vuelta:>8.2f}".replace(",", "."))

    if not cargar:
        print("\n  Nada cargado. Agregá --cargar.\n"); return

    paises = PAISES if encender else []
    if not mk:
        sb("POST", "markets", {"store_id": sid, "name": "Argentina",
                               "currency": "ARS", "countries": paises, "is_default": False})
        print(f"\n  Mercado ARS creado{'' if encender else ' SIN países (la tienda todavía cobra con ' + str(tienda.get('gateway')) + ')'}.")
    elif encender and PAISES[0] not in (mk[0].get("countries") or []):
        sb("PATCH", f"markets?id=eq.{mk[0]['id']}",
           {"countries": sorted(set((mk[0].get("countries") or []) + PAISES))})
        print("\n  Mercado ARS: país agregado.")
    elif not encender and (mk[0].get("countries") or []):
        sb("PATCH", f"markets?id=eq.{mk[0]['id']}", {"countries": []})
        print(f"\n  Mercado ARS APAGADO: la tienda cobra con {tienda.get('gateway')}, no con Mercado Pago.")

    for slug, pid, _, _, ars, _ in filas:
        hay = sb("GET", f"product_prices?select=id&product_id=eq.{pid}&currency=eq.ARS")
        if hay:
            sb("PATCH", f"product_prices?id=eq.{hay[0]['id']}", {"amount": ars})
        else:
            sb("POST", "product_prices", {"product_id": pid, "currency": "ARS", "amount": ars})
    print(f"  {len(filas)} precios cargados en ARS.\n")
    if encender:
        print("  Antes de confiar: abrí el checkout con una IP argentina y mirá que\n"
              "  los números sean éstos. El tamaño correcto no dice nada del contenido.\n")
    else:
        print("  Los precios quedan listos pero NO se muestran todavía: el mercado\n"
              "  está sin países a propósito. Volvé a correr esto cuando la tienda\n"
              "  cobre con Mercado Pago y se enciende solo.\n")


if __name__ == "__main__":
    main()
