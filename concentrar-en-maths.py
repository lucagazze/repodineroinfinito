#!/usr/bin/env python3
"""Concentrar la pauta en lo unico que se paga solo. Lo aprobo Bruno el 11/11/2026.

POR QUE, MEDIDO. Gasto contra ingreso REAL de la base (`net_amount`, o sea
despues de la comision de la pasarela), contando para cada campania solo los
pedidos posteriores a SU primer dia de gasto:

    UK Maths     188,97  ->  335,64   12 ped.  CPA 15,75   1,78x
    UK Fisica    390,00  ->  192,75    8 ped.  CPA 48,75   0,49x
    ZA Maths      22,60  ->       0    0 ped.      —         —
    AU Fisica     23,33  ->       0    0 ped.      —         —

Fisica en el Reino Unido devuelve 49 centavos por dolar. ZA y AU llevan 46
dolares entre las dos sin un pedido.

Y MATHS TIENE DONDE CRECER, que es lo que decide si concentrar sirve: cuando
el gasto subio de 18 a 34, el alcance paso de 539 a 1288 MIENTRAS la frecuencia
bajaba de 1,40 a 1,23 y el CPM de 24,30 a 18,79. No esta agotando su publico.

LO QUE NO ERA. Antes de mover un peso busque una caida: 40 horas sin cobros.
No habia ninguna. El checkout no cambio (CheckoutClient.tsx es del 6/11,
motor-whop.tsx del 8/11), la landing tampoco toca enlaces, el ancla #offerta
existe, el pixel carga y no hay errores de servidor. La «caida» era yo
juntando en una sola base el trafico maduro de UK con dos mercados que nunca
vendieron. Con la base de cada campania, UK Maths tuvo 4 checkouts y 0 ventas:
9 % de probabilidad por azar, mala racha y nada mas.

ZA SIGUE PRENDIDA UN DIA MAS. Es el mismo producto que gana y su CPM es ~7x
mas barato que el britanico. Merece un dia completo antes de juzgarla.

Uso:
    python3 concentrar-en-maths.py            # ensayo: dice que haria
    python3 concentrar-en-maths.py --aplicar  # lo hace
    python3 concentrar-en-maths.py --revertir # vuelve atras
"""
import argparse, importlib.util, json, pathlib, sys, time

RAIZ = pathlib.Path(__file__).parent

spec = importlib.util.spec_from_file_location("c", RAIZ / "campanas-za-au.py")
mod = importlib.util.module_from_spec(spec)
_a = sys.argv[:]; sys.argv = ["x", "--listar"]
try: spec.loader.exec_module(mod)
except SystemExit: pass
sys.argv = _a
meta, ACT = mod.meta, mod.ACT

# nombre -> (presupuesto nuevo en centavos o None, estado nuevo o None)
PLAN = {
    "UK | CBO | Maths Illustrated":            (4500, None),
    "UK | CBO | Physics Study Lab":            (None, "PAUSED"),
    "AU | CBO | Physics Study Lab | 2026-11":  (None, "PAUSED"),
    # ZA no se toca: queda como esta, 15/dia, un dia mas.
}
VUELTA = {
    "UK | CBO | Maths Illustrated":            (2500, None),
    "UK | CBO | Physics Study Lab":            (None, "ACTIVE"),
    "AU | CBO | Physics Study Lab | 2026-11":  (None, "ACTIVE"),
}


def estado():
    ok, d = meta("GET", f"{ACT}/campaigns",
                 {"fields": "id,name,status,effective_status,daily_budget", "limit": 80})
    if not ok:
        sys.exit(f"  no pude leer la cuenta: {d}")
    return {c["name"]: c for c in d["data"]}


def main(plan, aplicar):
    antes = estado()
    print(f"\n{'campania':<44}{'ahora':>14}   ->  {'queda':<14}")
    tocar = []
    for nombre, (pres, est) in plan.items():
        c = antes.get(nombre)
        if not c:
            print(f"  {nombre[:42]:<44}  NO ESTA EN LA CUENTA — se saltea")
            continue
        hoy_p = int(c.get("daily_budget") or 0) / 100
        hoy_e = c["effective_status"]
        nue_p = pres / 100 if pres else hoy_p
        nue_e = est or hoy_e
        print(f"  {nombre[:42]:<44}{hoy_p:>7.0f}/d {hoy_e[:6]:<7} -> {nue_p:>5.0f}/d {nue_e[:6]}")
        if (pres and pres != int(c.get("daily_budget") or 0)) or (est and est != c["status"]):
            tocar.append((c, pres, est))

    total_antes = sum(int(c.get("daily_budget") or 0) for c in antes.values()
                      if c["effective_status"] == "ACTIVE") / 100
    print(f"\n  gasto diario de la cuenta ahora: {total_antes:.0f} USD")

    if not aplicar:
        return print(f"\n  [ensayo] {len(tocar)} campanias cambiarian. Con --aplicar se hace.\n")

    for c, pres, est in tocar:
        campos = {}
        if pres:
            campos["daily_budget"] = pres
        if est:
            campos["status"] = est
        ok, r = meta("POST", c["id"], campos)
        print(f"    {c['name'][:40]:<42} {'OK' if ok else 'ERROR: ' + str(r)}")
        time.sleep(2.2)

    # --- la comprobacion: releer de Meta, no confiar en el 200 ----------
    time.sleep(3)
    despues = estado()
    print(f"\n  COMO QUEDO, releido de Meta:")
    bien = True
    for nombre, (pres, est) in plan.items():
        c = despues.get(nombre)
        if not c:
            continue
        p, e = int(c.get("daily_budget") or 0), c["effective_status"]
        ok_p = (pres is None) or (p == pres)
        ok_e = (est is None) or (e == est) or (est == "PAUSED" and e != "ACTIVE")
        bien &= ok_p and ok_e
        print(f"    {nombre[:42]:<44}{p/100:>5.0f}/d  {e:<10}"
              f"{'' if (ok_p and ok_e) else '   <-- NO QUEDO COMO SE PIDIO'}")
    total = sum(int(c.get("daily_budget") or 0) for c in despues.values()
                if c["effective_status"] == "ACTIVE") / 100
    print(f"\n  gasto diario de la cuenta: {total_antes:.0f} -> {total:.0f} USD")
    print("\n  LISTO.\n" if bien else "\n  REVISAR: algo no quedo como se pidio.\n")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--aplicar", action="store_true")
    ap.add_argument("--revertir", action="store_true")
    a = ap.parse_args()
    main(VUELTA if a.revertir else PLAN, a.aplicar or a.revertir)
