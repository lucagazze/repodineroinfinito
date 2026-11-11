#!/usr/bin/env python3
"""¿El hero nuevo de la landing de física hace que toquen el botón?

EL CAMBIO. El 11/11/2026 a las ~14:30 UTC salieron de www.physicsstudylab.com
la barra «Launch offer · Valid until today <fecha>» y las estrellas con
«2.400+ students». Juntas median 162 px y empujaban el boton del hero fuera de
la pantalla: terminaba en 856 px sobre un telefono de 812, y dentro del
navegador de Instagram —que come ~100 px de alto util— quedaba ~156 px afuera.
Ahora termina en 672.

QUE SE MIDE, Y POR QUE ASI. No «visitas» ni «clics»: PERSONAS. Un mismo
visitante genera varias cargas, y contar eventos inflaba este embudo al 14,9 %
cuando por persona era 3,9 %. Se cuenta cuantas personas distintas vieron la
landing y cuantas de ESAS llegaron al checkout.

Y SOLO EL TRAFICO DE META, porque es el unico comparable: el organico y el
link de la bio entran muchas veces directo al checkout sin pasar por la
landing, y esa puerta no la toca este cambio.

LA REFERENCIA ES LA LANDING DE MATHS, no un numero de manual. Misma semana,
mismo origen, mismo checkout: 10,2 % de las personas de Meta tocaron el boton
y llegaron. Fisica venia en 2,5 % de toque y 0,8 % de llegada. Esa brecha es
lo que el cambio tiene que cerrar.

OJO CON EL 11/11: la pagina cambio a mitad del dia, asi que ese dia no cuenta
para ningun lado. El primer dia limpio es el 12.

Solo lee. No toca nada.

    python3 hero-fisica.py
"""
import importlib.util, pathlib, sys, urllib.parse

RAIZ = pathlib.Path(__file__).parent
CAMBIO = "2026-11-11"      # dia partido: no entra en ninguna de las dos ventanas

spec = importlib.util.spec_from_file_location("p", RAIZ / "crear-pixel-107.py")
mod = importlib.util.module_from_spec(spec)
_a = sys.argv[:]; sys.argv = ["x", "--ver"]
try: spec.loader.exec_module(mod)
except SystemExit: pass
sys.argv = _a

SQL = """
with v as (
  select e.visitor_id, f.slug embudo,
    case when e.at::date < date '{c}' then 'antes'
         when e.at::date > date '{c}' then 'despues' end tramo,
    bool_or(e.page='landing' and e.event='view') land,
    bool_or(e.page='landing' and e.event='cta_click') cta,
    bool_or(e.page='checkout' and e.event='view') chk,
    bool_or(e.event='paid') pago
  from site_events e join funnels f on f.id=e.funnel_id
  where e.at >= date '{c}' - interval '7 days'
    and coalesce(e.is_bot,false)=false and e.visitor_id is not null
    and e.utm_source in ('meta','fb','ig')
  group by 1,2,3)
select embudo, tramo,
  count(*) filter (where land) personas,
  count(*) filter (where land and cta) tocaron,
  count(*) filter (where land and chk) llegaron,
  count(*) filter (where land and pago) compraron
from v where tramo is not null and land
group by 1,2 order by 1, 2 desc;
"""


def main():
    ruta = "rpc/sql" if False else None   # PostgREST no corre SQL suelto
    # Se consulta la vista cruda y se agrupa aca, que es lo que si permite la API.
    ev = mod.supabase("GET",
        "site_events?select=visitor_id,at,page,event,funnel_id,utm_source,is_bot"
        f"&at=gte.2026-11-04&utm_source=in.(meta,fb,ig)&limit=20000")
    emb = {f["id"]: f["slug"] for f in mod.supabase("GET", "funnels?select=id,slug&limit=200")}

    import collections
    per = collections.defaultdict(lambda: dict(land=False, cta=False, chk=False, pago=False))
    for e in ev:
        if e.get("is_bot") or not e.get("visitor_id"):
            continue
        dia = e["at"][:10]
        tramo = "antes" if dia < CAMBIO else ("despues" if dia > CAMBIO else None)
        if tramo is None:
            continue
        k = (emb.get(e["funnel_id"]), tramo, e["visitor_id"])
        if e["page"] == "landing" and e["event"] == "view":   per[k]["land"] = True
        if e["page"] == "landing" and e["event"] == "cta_click": per[k]["cta"] = True
        if e["page"] == "checkout" and e["event"] == "view":  per[k]["chk"] = True
        if e["event"] == "paid":                               per[k]["pago"] = True

    agg = collections.defaultdict(lambda: [0, 0, 0, 0])
    for (slug, tramo, _), d in per.items():
        if not d["land"] or slug not in ("kit-complete", "maths-illustrated"):
            continue
        a = agg[(slug, tramo)]
        a[0] += 1; a[1] += d["cta"]; a[2] += d["chk"]; a[3] += d["pago"]

    print(f"\n  Solo trafico de Meta, y solo PERSONAS que vieron la landing.")
    print(f"  El {CAMBIO} queda afuera: la pagina cambio a mitad del dia.\n")
    print(f"  {'landing':<20}{'tramo':<9}{'personas':>9}{'tocaron':>9}{'%':>7}{'llegaron':>10}{'%':>7}{'compraron':>11}")
    for slug in ("kit-complete", "maths-illustrated"):
        for tramo in ("antes", "despues"):
            a = agg.get((slug, tramo))
            if not a:
                print(f"  {slug[:19]:<20}{tramo:<9}      sin datos todavia")
                continue
            n, c, l, p = a
            print(f"  {slug[:19]:<20}{tramo:<9}{n:>9}{c:>9}{100*c/n:>6.1f}%{l:>10}{100*l/n:>6.1f}%{p:>11}")

    a = agg.get(("kit-complete", "despues"))
    base = agg.get(("kit-complete", "antes"))
    ref = agg.get(("maths-illustrated", "despues")) or agg.get(("maths-illustrated", "antes"))
    print()
    if not a or a[0] < 40:
        print(f"  Todavia no alcanza para concluir: {(a or [0])[0]} personas de Meta en la"
              f" landing de fisica desde el cambio. Hacen falta ~40 para que un"
              f" 4 % y un 10 % se distingan.\n")
        return
    toque = 100 * a[1] / a[0]
    # La base sale de la MISMA consulta, no de un numero escrito a mano: con
    # una cifra fija de otra ventana el informe se contradice con su propia
    # tabla de arriba.
    antes = 100 * base[1] / base[0] if base and base[0] else None
    print(f"  Fisica tocaba el boton en {antes:.1f} % y ahora en {toque:.1f} %."
          if antes is not None else f"  Fisica toca el boton en {toque:.1f} %.")
    if ref and ref[0]:
        print(f"  La referencia de maths en la misma ventana: {100*ref[1]/ref[0]:.1f} %.")
    umbral = (antes if antes is not None else 4.3)
    if toque >= umbral * 2.5:
        print("  FUNCIONO. El boton a la vista es la diferencia; mirar si conviene")
        print("  hacer lo mismo en las otras landings.\n")
    elif toque >= umbral * 1.4:
        print("  MEJORO pero no llega a maths. El boton ya no es el cuello: el")
        print("  siguiente sospechoso es el titular, no el alto del hero.\n")
    else:
        print("  NO CAMBIO. El alto del hero no era la causa; hay que volver a mirar,")
        print("  y el primer lugar es a donde apunta el anuncio, no la pagina.\n")


if __name__ == "__main__":
    main()
