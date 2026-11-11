#!/usr/bin/env python3
"""Avisa cuando se esta gastando y no entra ni un pedido.

POR QUE EXISTE. El 9/11/2026 a las 20:02 UTC entro el ultimo pedido y el
siguiente no llego en 40 horas, con ~120 dolares de pauta en el medio. Me
entere dos dias tarde, y no porque faltaran datos: el informe automatico de
ese dia miraba CPM y costo por checkout, que son metricas de ENTREGA. Una
campania puede entregar perfecto y no vender nada. Lo unico que no se puede
fingir es un pedido cobrado.

LA REGLA, Y DE DONDE SALE CADA NUMERO. Dispara con las DOS condiciones:

  a) pasaron >= HORAS sin un pedido pagado, y
  b) en esa ventana se gastaron >= DOLARES.

Las dos juntas, porque cada una sola es ruido. Solo horas: de madrugada no
vende nadie y entre el 25/10 y el 1/11 hubo 167 horas sin una venta -- sin
pauta corriendo, o sea que estaba bien. Solo plata: un dia bueno gasta 80
dolares y vende cuatro veces.

    HORAS = 18   Desde el 6/11, con pauta sostenida, el hueco mas largo entre
                 dos pedidos fue de 13,2 h. 18 deja aire arriba del peor caso
                 normal y aun asi habria cazado el episodio del 10/11 a media
                 maniana, no dos dias despues.
    DOLARES = 35 Poco mas de dos CPA de UK Maths (15,75). Con menos que eso
                 gastado, no vender todavia no significa nada.

Lee y avisa. No toca ninguna campania.

Uso:
    python3 sequia-de-ventas.py              # mira ahora
    python3 sequia-de-ventas.py --probar     # lo corre contra el 10/11/2026
"""
import argparse, datetime as dt, importlib.util, pathlib, sys

RAIZ = pathlib.Path(__file__).parent
HORAS, DOLARES = 18, 35.0

spec = importlib.util.spec_from_file_location("c", RAIZ / "campanas-za-au.py")
mod = importlib.util.module_from_spec(spec)
_a = sys.argv[:]; sys.argv = ["x", "--listar"]
try: spec.loader.exec_module(mod)
except SystemExit: pass
sys.argv = _a
meta, ACT, sb = mod.meta, mod.ACT, mod.mod.supabase


def mirar(ahora):
    ped = sb("GET", "orders?select=number,created_at,currency,amount_total"
                    "&status=eq.paid&is_test=eq.false&order=created_at.desc&limit=1")
    if not ped:
        return None, "no hay ningun pedido pagado en la base", 0, 0.0
    ultimo = dt.datetime.fromisoformat(ped[0]["created_at"].replace("Z", "+00:00"))
    horas = (ahora - ultimo).total_seconds() / 3600

    desde = ultimo.date().isoformat()
    ok, d = meta("GET", f"{ACT}/insights",
                 {"fields": "spend", "time_increment": 1,
                  "time_range": f'{{"since":"{desde}","until":"{ahora.date().isoformat()}"}}'})
    if not ok:
        return None, f"no pude leer el gasto: {d}", horas, 0.0
    # El dia del ultimo pedido cuenta a prorrata de las horas posteriores.
    gasto = 0.0
    for f in d.get("data", []):
        g = float(f.get("spend") or 0)
        if f["date_start"] == desde:
            g *= max(0.0, (24 - ultimo.hour - ultimo.minute / 60) / 24)
        gasto += g
    return ped[0], None, horas, gasto


def main(probar):
    ahora = (dt.datetime(2026, 11, 10, probar, 0, tzinfo=dt.timezone.utc) if probar
             else dt.datetime.now(dt.timezone.utc))
    ped, err, horas, gasto = mirar(ahora)
    cabeza = (f"PRUEBA contra el 10/11/2026 {probar:02d}:00 UTC" if probar
              else f"{ahora:%d/%m %H:%M} UTC")
    print(f"\n  {cabeza}")
    if err:
        return print(f"  NO PUDE MIRAR: {err}\n")
    print(f"  ultimo pedido      #{ped['number']}  {ped['created_at'][:16]}  "
          f"{ped['currency']} {ped['amount_total']}")
    print(f"  horas desde ahi    {horas:>7.2f}   (umbral {HORAS})")
    print(f"  gasto en la ventana{gasto:>7.2f}   (umbral {DOLARES})")
    if horas >= HORAS and gasto >= DOLARES:
        print(f"\n  *** SEQUIA: {horas:.0f} h sin vender con {gasto:.0f} USD gastados. ***")
        print("  Mirar, en este orden: que el checkout cobre, que los anuncios")
        print("  entreguen, y si cambio el reparto del presupuesto.\n")
        return 1
    print("\n  Sin alarma.\n")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    # --probar HORA corre la regla contra ese momento del 10/11/2026, el dia
    # del episodio que hizo falta este aviso. 14 queda JUSTO abajo del umbral
    # (17,97 h) y 16 lo pasa: las dos corridas juntas muestran donde esta el
    # corte en vez de esconderlo.
    ap.add_argument("--probar", type=int, default=0, metavar="HORA")
    sys.exit(main(ap.parse_args().probar))
