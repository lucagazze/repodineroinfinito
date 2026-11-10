#!/usr/bin/env python3
"""Revisa TODAS las escaleras post-compra y avisa de lo que no puede cobrar.

POR QUE EXISTE. El 9/11/2026 se descubrio que el post-pago no habia cobrado
NUNCA: `PRODUCT_COLS` no pedia `whop_plan_id`, asi que /api/upsell contestaba
«not_available» antes de intentar el cobro. Se arreglo la consulta, pero el
defecto tiene un hermano que la consulta no cubre: **un producto que de verdad
no tiene plan**. Si se arma un escalon nuevo y se olvida el plan, el comprador
que diga que si se va sin pagar, y no salta ningun error -- salta un 409 que
el panel no mira.

Esto lo mira. Solo lee.

LO QUE REVISA, por escalera:
  1. Cada OTO y cada downsell ACTIVO tiene `whop_plan_id`. Sin el, no cobra.
  2. Cada paso tiene precio en TODAS las monedas que el checkout puede servir
     (GBP, USD y ZAR hoy). Un escalon sin precio en rands se saltea en
     silencio para un comprador de Sudafrica: la escalera se le acorta.
  3. Ningun downsell cuelga de un paso que no es un OTO o que esta inactivo.
     `chainFor` descarta ese downsell SIN avisar (`if (parent === undefined)
     return`), asi que el peldanio desaparece y nadie se entera.
  4. Los niveles son 1..3 y sin repetidos. `nextLevel` saltea todo lo que
     tenga nivel <= al actual, asi que dos pasos en el mismo nivel significan
     que el segundo no se ofrece nunca.

Uso:
    python3 auditar-escaleras.py
"""
import importlib.util, pathlib, sys

RAIZ = pathlib.Path(__file__).parent
MONEDAS = ("GBP", "USD", "ZAR")

spec = importlib.util.spec_from_file_location("p", RAIZ / "crear-pixel-107.py")
mod = importlib.util.module_from_spec(spec)
_a = sys.argv[:]; sys.argv = ["x", "--ver"]
try: spec.loader.exec_module(mod)
except SystemExit: pass
sys.argv = _a
sb = mod.supabase


def main():
    funnels = sb("GET", "pp_funnels?select=id,name,active&order=name")
    alertas = []
    for f in funnels:
        pasos = sb("GET", f"pp_steps?pp_funnel_id=eq.{f['id']}"
                          "&select=id,sort_order,kind,level,product_id,downsell_of&order=sort_order")
        if not pasos:
            continue
        ids = ",".join(p["product_id"] for p in pasos)
        prods = {p["id"]: p for p in sb(
            "GET", f"products?id=in.({ids})&select=id,slug,active,whop_plan_id")}
        precios = {}
        for r in sb("GET", f"product_prices?product_id=in.({ids})&select=product_id,currency,amount"):
            precios.setdefault(r["product_id"], set()).add(r["currency"])

        estado = "ACTIVA " if f["active"] else "pausada"
        print(f"\n═══ [{estado}] {f['name']}")
        por_id = {p["id"]: p for p in pasos}
        niveles = {}
        for p in pasos:
            pr = prods.get(p["product_id"], {})
            slug = pr.get("slug", "?")
            viva = f["active"] and pr.get("active")
            marca = "  " if p["kind"] == "oto" else "   \\_"
            notas = []

            if not pr.get("active"):
                notas.append("producto desactivado")
            if viva and not pr.get("whop_plan_id"):
                notas.append("SIN PLAN DE WHOP")
                alertas.append(f"{f['name']} · {slug}: activo y sin plan de Whop — no puede cobrar")
            faltan = [m for m in MONEDAS if m not in precios.get(p["product_id"], set())]
            if viva and faltan:
                notas.append("sin " + "/".join(faltan))
                alertas.append(f"{f['name']} · {slug}: sin precio en {', '.join(faltan)} — "
                               f"ese escalon se saltea para esos compradores")

            if p["kind"] == "downsell":
                padre = por_id.get(p["downsell_of"]) if p["downsell_of"] else None
                if not padre:
                    notas.append("COLGADO: su OTO no existe")
                    alertas.append(f"{f['name']} · {slug}: downsell sin OTO — se descarta en silencio")
                elif padre["kind"] != "oto":
                    notas.append("COLGADO de un downsell")
                    alertas.append(f"{f['name']} · {slug}: cuelga de un downsell — se descarta en silencio")
                elif f["active"] and not prods.get(padre["product_id"], {}).get("active"):
                    notas.append("su OTO esta desactivado")
                    alertas.append(f"{f['name']} · {slug}: su OTO esta desactivado, "
                                   f"asi que este downsell tampoco se muestra")
            else:
                lv = p["level"]
                if lv is None:
                    notas.append("sin nivel")
                elif not 1 <= lv <= 3:
                    notas.append(f"nivel {lv} fuera de 1..3")
                    alertas.append(f"{f['name']} · {slug}: nivel {lv}")
                elif lv in niveles:
                    notas.append(f"nivel {lv} REPETIDO")
                    alertas.append(f"{f['name']} · {slug}: comparte el nivel {lv} con "
                                   f"{niveles[lv]} — el segundo no se ofrece nunca")
                else:
                    niveles[lv] = slug

            nivel = f"nivel {p['level']}" if p["level"] else "       "
            cola = ("   ← " + " · ".join(notas)) if notas else ""
            print(f"  {nivel} {marca} {slug:<28}{cola}")

    print("\n" + "─" * 60)
    if alertas:
        print(f"{len(alertas)} ALERTAS\n")
        for a in alertas:
            print(f"  ! {a}")
    else:
        print("sin alertas: todo escalon activo puede cobrar y tiene precio en las tres monedas")
    print()


if __name__ == "__main__":
    main()
