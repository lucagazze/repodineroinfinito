#!/usr/bin/env python3
"""¿UK Maths a 45/dia vende mas que a 25? La pregunta, contestada con pedidos.

EL CAMBIO: el 11/11/2026 a las 12:40 UTC el presupuesto de
«UK | CBO | Maths Illustrated» paso de 25 a 45 USD/dia. Antes corria a 25
desde el 4/11.

QUE SE MIDE, Y POR QUE NO ES «VENDIO MAS». Con mas presupuesto casi siempre
se vende mas; eso no decide nada. Lo que decide es si el dinero EXTRA compra
pedidos a un costo que todavia deja margen. Asi que:

  - los pedidos salen de la BASE, no de Meta. Meta sub-atribuye: el 7/11 veia
    4 compras donde habia 7. Un CPA calculado sobre lo que ve Meta esta
    inflado y hace apagar campanias que ganan plata.
  - el CPA se compara contra el NETO POR PEDIDO, no contra el ticket. El neto
    de UK Maths es 27,97 USD (despues de la comision de la pasarela). Ese es
    el punto de equilibrio exacto: un CPA arriba de eso pierde en el primer
    pedido.
  - se miran alcance, frecuencia y CPM. Si la frecuencia SUBE, los 20 dolares
    extra le estan mostrando el mismo anuncio a la misma gente, y el CPA se
    va a deteriorar aunque hoy todavia no se note.

LA REGLA DE CORTE, ESCRITA ANTES DE VER EL DATO. Si se decide despues, uno
racionaliza el numero que salio:

    CPA <= 20      los 20 extra funcionan. Dejar, o probar subir mas.
    CPA 20 a 28    margen fino pero positivo. Dejar en 45 y volver a mirar.
    CPA > 28       el dinero extra compra perdidas. Volver a 25-30.

CUIDADO CON EL DIA PARTIDO: el 11/11 corrio a 25 hasta las 12:40 y a 45
despues, asi que NO cuenta para ninguno de los dos lados. Se muestra aparte.

Solo lee. No toca ninguna campania.

Uso:
    python3 maths-a-45.py
"""
import collections, datetime as dt, importlib.util, pathlib, sys

RAIZ = pathlib.Path(__file__).parent
CAMPANIA = "UK | CBO | Maths Illustrated"
CAMBIO = "2026-11-11"          # dia partido: 25 hasta 12:40 UTC, 45 despues
NETO_POR_PEDIDO = 27.97        # USD, medido sobre los 12 pedidos britanicos
GBP = 1.31

spec = importlib.util.spec_from_file_location("c", RAIZ / "campanas-za-au.py")
mod = importlib.util.module_from_spec(spec)
_a = sys.argv[:]; sys.argv = ["x", "--listar"]
try: spec.loader.exec_module(mod)
except SystemExit: pass
sys.argv = _a
meta, ACT, sb = mod.meta, mod.ACT, mod.mod.supabase


def main():
    ok, d = meta("GET", f"{ACT}/campaigns", {"fields": "id,name,daily_budget", "limit": 80})
    if not ok:
        return print(f"  no pude leer la cuenta: {d}")
    c = next((x for x in d["data"] if x["name"] == CAMPANIA), None)
    if not c:
        return print(f"  no encontre «{CAMPANIA}» en la cuenta")

    hoy = dt.datetime.now(dt.timezone.utc).date().isoformat()
    ok, ins = meta("GET", f"{c['id']}/insights",
                   {"fields": "spend,reach,frequency,impressions,actions",
                    "time_increment": 1,
                    "time_range": f'{{"since":"2026-11-04","until":"{hoy}"}}'})
    if not ok:
        return print(f"  no pude leer la campania: {ins}")

    # Pedidos REALES del embudo britanico de Maths, por dia.
    ped = sb("GET", "orders?select=created_at,currency,net_amount,funnel_id"
                    "&status=eq.paid&is_test=eq.false&created_at=gte.2026-11-04&limit=2000")
    emb = {f["id"]: f["slug"] for f in sb("GET", "funnels?select=id,slug&limit=200")}
    por_dia = collections.defaultdict(lambda: [0, 0.0])
    for o in ped:
        if emb.get(o["funnel_id"]) != "maths-illustrated":
            continue
        if (o.get("currency") or "").upper() != "GBP":
            continue
        k = o["created_at"][:10]
        por_dia[k][0] += 1
        por_dia[k][1] += (o.get("net_amount") or 0) * GBP

    print(f"\n  {CAMPANIA}   ·   hoy {int(c.get('daily_budget') or 0)/100:.0f} USD/dia\n")
    print(f"  {'dia':<12}{'pres':>5}{'gasto':>8}{'alcance':>9}{'frec':>6}{'CPM':>7}"
          f"{'ped':>5}{'neto':>8}{'CPA':>8}")
    tramos = collections.defaultdict(lambda: [0.0, 0, 0.0])
    for f in ins.get("data", []):
        dia = f["date_start"]
        g, imp = float(f.get("spend") or 0), float(f.get("impressions") or 0)
        n, neto = por_dia.get(dia, [0, 0.0])
        if dia < CAMBIO:
            tramo, pres = "25", 25
        elif dia == CAMBIO:
            tramo, pres = "partido", 0
        else:
            tramo, pres = "45", 45
        if tramo != "partido" and dia != hoy:
            t = tramos[tramo]; t[0] += g; t[1] += n; t[2] += neto
        marca = "  <- dia partido" if tramo == "partido" else ("  <- hoy, incompleto" if dia == hoy else "")
        print(f"  {dia:<12}{(pres or '—'):>5}{g:>8.2f}{int(float(f.get('reach') or 0)):>9}"
              f"{float(f.get('frequency') or 0):>6.2f}{(g/imp*1000 if imp else 0):>7.2f}"
              f"{n:>5}{neto:>8.2f}{(f'{g/n:.2f}' if n else '—'):>8}{marca}")

    print(f"\n  {'tramo':<12}{'dias':>5}{'gasto':>9}{'ped':>5}{'neto':>9}{'CPA':>8}{'x':>7}")
    for t in ("25", "45"):
        g, n, neto = tramos[t]
        if g == 0:
            print(f"  {t + ' USD/dia':<12}{'—':>5}  sin dias completos todavia")
            continue
        print(f"  {t + ' USD/dia':<12}{'':>5}{g:>9.2f}{n:>5}{neto:>9.2f}"
              f"{(f'{g/n:.2f}' if n else '—'):>8}{(f'{neto/g:.2f}' if g else '—'):>7}")

    g45, n45, _ = tramos["45"]
    print(f"\n  equilibrio: CPA de {NETO_POR_PEDIDO:.2f} USD (el neto por pedido).")
    if not g45 or not n45:
        return print("  Sin dias completos a 45 todavia: NO se puede concluir nada.\n")
    cpa = g45 / n45
    if cpa <= 20:
        v = "FUNCIONA. Los 20 extra compran pedidos baratos. Dejar, o probar subir."
    elif cpa <= 28:
        v = "MARGEN FINO pero positivo. Dejar en 45 y volver a mirar."
    else:
        v = "NO FUNCIONA: el dinero extra compra perdidas. Volver a 25-30."
    print(f"  CPA a 45: {cpa:.2f}  ->  {v}\n")


if __name__ == "__main__":
    main()
