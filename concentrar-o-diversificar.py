#!/usr/bin/env python3
"""Concentrar todo en Maths, o repartir: la pregunta contestada con numeros.

La pregunta es la correcta y la respuesta NO es una opinion. Un presupuesto se
concentra en el ganador cuando el ganador TIENE DONDE CRECER, y se reparte
cuando no. Hay que medir tres cosas, y ninguna es «cual vende mas»:

  1. MARGEN REAL POR EMBUDO. El CPA solo no dice nada: 15 es excelente a 60 de
     ticket y ruinoso a 13. Se usa `net_amount`, que es lo que queda despues de
     la comision de la pasarela, y los pedidos REALES de la base -- no las
     compras que atribuye Meta, que ya sabemos que sub-atribuye.

  2. LA VENTANA COMPARABLE, Y ES DOBLE. Primero, el checkout propio empezo a
     cobrar el 23/10/2026; antes Physics cobraba por Impultienda y esos
     pedidos NO estan en esta base, asi que comparar el gasto de toda la vida
     de Physics contra los pedidos que si estan lo pinta como un desastre que
     no es. Segundo -- y esto hizo falsos dos de los cuatro resultados de la
     primera corrida -- cada campania solo se queda con los pedidos
     POSTERIORES A SU PRIMER DIA DE GASTO, que se lee de Meta, no se supone.
     Sudafrica y Australia arrancaron el 9/11; con una ventana comun, el
     pedido sudafricano del 8/11 y los tres australianos de octubre les
     quedaban colgados y las dos campanias parecian las mejores de la cuenta
     (2,72x y 7,64x) cuando en realidad no vendieron NADA todavia.
     Esos pedidos llegaron igual, sin campania en su pais: eso prueba otra
     cosa, y es importante, pero no es merito de la pauta.

  3. SI EL GANADOR TIENE TECHO. La pregunta que decide todo. Dia por dia:
     cuando subio el gasto, ¿el CPA se quedo igual o subio? Y la frecuencia,
     que lo dice por otro lado -- si sube, se le esta mostrando el anuncio
     otra vez a la misma gente, y la plata extra compra al mismo comprador
     mas caro. Si la frecuencia BAJA mientras el alcance crece, hay lugar.

`amount_total` y `net_amount` estan en unidades enteras de la moneda, NO en
centavos (un pedido de 16,79 libras se guarda como 16.79). Dividirlos por 100
da tickets de 17 centavos, que fue el primer resultado de este script y era
obviamente falso.

Solo lee. No cambia nada.

Uso:
    python3 concentrar-o-diversificar.py
"""
import collections, importlib.util, pathlib, sys, time

RAIZ = pathlib.Path(__file__).parent
DESDE = "2026-10-23"        # el dia que el checkout propio empezo a cobrar
HASTA = "2026-11-10"

spec = importlib.util.spec_from_file_location("c", RAIZ / "campanas-za-au.py")
mod = importlib.util.module_from_spec(spec)
_a = sys.argv[:]; sys.argv = ["x", "--listar"]
try: spec.loader.exec_module(mod)
except SystemExit: pass
sys.argv = _a
meta, ACT, sb = mod.meta, mod.ACT, mod.mod.supabase

# Solo para poner todo en una misma unidad y poder comparar. No es el que cobra
# la pasarela. Si el veredicto cambiara moviendo esto un 10 %, no serviria.
USD = {"USD": 1.0, "GBP": 1.31, "EUR": 1.16, "ZAR": 0.058, "AUD": 0.65,
       "HKD": 0.1285, "ARS": 0.00069, "CAD": 0.72, "NZD": 0.59, "INR": 0.0119}

# Que campania alimenta a que embudo y moneda. Es el unico puente entre el
# gasto (Meta) y el ingreso (la base), y se hace a mano porque ninguna de las
# dos puntas lo guarda.
PUENTE = {
    "UK | CBO | Maths Illustrated":   ("maths-illustrated", "GBP"),
    "UK | CBO | Physics Study Lab":   ("kit-complete", "GBP"),
    "ZA | CBO | Maths Illustrated | 2026-11": ("maths-illustrated", "ZAR"),
    "AU | CBO | Physics Study Lab | 2026-11": ("kit-complete", "AUD"),
}


def ev(f, clave):
    for a in f.get("actions", []) or []:
        if a["action_type"] == clave:
            return float(a["value"])
    return 0.0


def insights(obj, **extra):
    ok, d = meta("GET", f"{obj}/insights",
                 {"fields": "spend,impressions,reach,frequency,actions,date_start",
                  "limit": 500, **extra})
    if not ok:
        print(f"   ERROR leyendo {obj}: {d}")
        return []
    return d.get("data", [])


def main():
    pedidos = sb("GET", "orders?select=number,funnel_id,country,currency,amount_total,"
                        "net_amount,amount_refunded,created_at"
                        "&status=eq.paid&is_test=eq.false&limit=5000")
    embudo = {f["id"]: f["slug"] for f in sb("GET", "funnels?select=id,slug&limit=200")}

    # ---------- 1. margen real por embudo y moneda -----------------------
    print(f"\n{'='*78}\n1 · LO QUE DE VERDAD ENTRO, por embudo y moneda   "
          f"({len(pedidos)} pedidos pagados)\n{'='*78}")
    por = collections.defaultdict(lambda: [0, 0.0, 0.0])
    for o in pedidos:
        c = USD.get((o.get("currency") or "").upper())
        if c is None:
            print(f"   OJO: pedido {o['number']} en {o['currency']}, sin tipo de cambio. Queda afuera.")
            continue
        k = (embudo.get(o["funnel_id"], "?"), o["currency"])
        por[k][0] += 1
        por[k][1] += (o.get("net_amount") or 0) * c
        por[k][2] += (o.get("amount_refunded") or 0) * c

    print(f"\n  {'embudo':<22}{'mon':<5}{'ped':>4}{'neto USD':>11}{'dev':>7}{'neto/ped':>10}")
    for k in sorted(por, key=lambda x: -por[x][1]):
        n, neto, dev = por[k]
        print(f"  {k[0][:21]:<22}{k[1]:<5}{n:>4}{neto:>11.2f}{dev:>7.2f}{neto/n:>10.2f}")

    # ---------- 2. la ventana comparable ---------------------------------
    ok, camps = meta("GET", f"{ACT}/campaigns",
                     {"fields": "id,name,effective_status,daily_budget", "limit": 80})
    if not ok:
        return print(camps)
    porn = {c["name"]: c for c in camps["data"]}

    print(f"\n{'='*78}\n2 · GASTO CONTRA INGRESO, en la misma ventana (desde {DESDE})\n{'='*78}")
    print(f"\n  {'campania':<34}{'desde':>7}{'gasto':>9}{'neto':>9}{'ped':>5}{'CPA real':>10}{'x':>7}")
    veredicto = {}
    for nombre, (slug, moneda) in PUENTE.items():
        c = porn.get(nombre)
        if not c:
            print(f"  {nombre[:33]:<34}  no esta en la cuenta")
            continue
        dias = insights(c["id"], time_increment=1,
                        time_range=f'{{"since":"{DESDE}","until":"{HASTA}"}}')
        time.sleep(2.2)
        con_gasto = [f for f in dias if float(f.get("spend") or 0) > 0]
        if not con_gasto:
            print(f"  {nombre[:33]:<34}  sin gasto en la ventana")
            continue
        arranque = min(f["date_start"] for f in con_gasto)
        gasto = sum(float(f.get("spend") or 0) for f in con_gasto)
        ped = [o for o in pedidos
               if embudo.get(o["funnel_id"]) == slug
               and (o.get("currency") or "").upper() == moneda
               and o["created_at"][:10] >= arranque]
        neto = sum((o.get("net_amount") or 0) * USD[moneda] for o in ped)
        cpa = gasto / len(ped) if ped else None
        x = neto / gasto if gasto else None
        veredicto[nombre] = (gasto, neto, len(ped), x)
        print(f"  {nombre[:33]:<34}{arranque[5:]:>7}{gasto:>9.2f}{neto:>9.2f}{len(ped):>5}"
              f"{(f'{cpa:.2f}' if cpa else '—'):>10}{(f'{x:.2f}' if x else '—'):>7}")
    print("\n  «desde» es el primer dia que la campania gasto de verdad, y los")
    print("  pedidos se cuentan desde ahi. «x» es cuantos dolares netos deja cada")
    print("  dolar de pauta: abajo de 1,00 pierde plata en el primer pedido.")
    sueltos = [o for o in pedidos
               if (o.get("currency") or "").upper() in ("AUD", "ZAR", "HKD", "USD")
               and o["created_at"][:10] >= DESDE]
    if sueltos:
        print(f"\n  Y {len(sueltos)} pedidos de paises SIN campania propia, por "
              f"{sum((o.get('net_amount') or 0) * USD[o['currency'].upper()] for o in sueltos):.2f} "
              f"USD netos:")
        for o in sorted(sueltos, key=lambda x: x["created_at"]):
            print(f"     #{o['number']:<3} {o['currency']}  {o['created_at'][:10]}  "
                  f"{(o.get('net_amount') or 0) * USD[o['currency'].upper()]:>7.2f} USD netos")

    # ---------- 3. el techo ----------------------------------------------
    print(f"\n{'='*78}\n3 · ¿TIENE TECHO EL GANADOR? dia por dia\n{'='*78}")
    print("\n  Si al subir el gasto el alcance crece y la frecuencia NO sube, hay")
    print("  lugar para mas plata. Si la frecuencia sube, el presupuesto extra le")
    print("  muestra el mismo anuncio a la misma gente y el CPA se va a deteriorar.")
    for nombre in PUENTE:
        c = porn.get(nombre)
        if not c or c["effective_status"] != "ACTIVE":
            continue
        d = insights(c["id"], time_increment=1, date_preset="last_14d")
        time.sleep(2.2)
        if not d:
            continue
        print(f"\n  ── {nombre}   ${int(c.get('daily_budget') or 0)/100:.0f}/dia")
        print(f"     {'dia':<12}{'gasto':>8}{'alcance':>9}{'frec':>7}{'CPM':>7}{'compr':>7}{'chk':>5}")
        for f in d:
            g, imp = float(f.get("spend") or 0), float(f.get("impressions") or 0)
            print(f"     {f['date_start']:<12}{g:>8.2f}{int(float(f.get('reach') or 0)):>9}"
                  f"{float(f.get('frequency') or 0):>7.2f}"
                  f"{(g/imp*1000 if imp else 0):>7.2f}"
                  f"{ev(f,'offsite_conversion.fb_pixel_purchase'):>7.0f}"
                  f"{ev(f,'offsite_conversion.fb_pixel_initiate_checkout'):>5.0f}")


if __name__ == "__main__":
    main()
