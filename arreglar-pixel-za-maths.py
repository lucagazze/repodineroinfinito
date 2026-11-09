#!/usr/bin/env python3
"""El conjunto de ZA | Maths optimizaba sobre el pixel de Fisica. Se reemplaza.

EL DEFECTO, encontrado el 9/11/2026 antes de prender nada. `campanas-za-au.py`
creo las tres campanias con `PIXEL = 4633079520296335`, el pixel compartido de
Physics y Finance. Pero **Maths tiene pixel propio desde el 2/11**:
`1145294078008097`, y es el unico colgado del embudo `maths-illustrated` en la
tabla `pixels`.

POR QUE IMPORTA Y NO ES COSMETICO. El conjunto optimiza con
`optimization_goal: OFFSITE_CONVERSIONS` sobre `promoted_object.pixel_id`. Con
el pixel equivocado, Meta espera eventos PURCHASE en un pixel al que el
checkout de Maths no le manda ninguno: no aprende, no sale de la fase de
aprendizaje y entrega a ciegas. El test de Sudafrica se habria gastado entero
sin medir nada, y el sintoma habria sido «Sudafrica no funciona», que es la
conclusion equivocada.

POR QUE NO SE EDITA, QUE ES LO QUE APRENDIMOS. Un PATCH al `promoted_object`
rebota aunque el conjunto este PAUSADO y nunca haya entregado:

    «No es posible editar el pixel, el evento de conversion, la conversion
     personalizada ni la opcion de optimizacion de los conjuntos de anuncios
     una vez que se han publicado. Para poner en circulacion un conjunto de
     anuncios con los cambios que deseas, crea uno nuevo.»

«Publicado» no quiere decir «entregado»: basta con que exista. O sea que **el
pixel se elige una sola vez, cuando se crea el conjunto**, y equivocarse
cuesta rehacerlo. Por eso `campanas-za-au.py` ahora elige el pixel por
campania en vez de tener uno solo para las tres.

QUE HACE ESTE SCRIPT
  1. crea un conjunto nuevo en la MISMA campania, con el pixel de Maths;
  2. le cuelga los 3 anuncios, reusando los creativos que ya existen -- son
     los mismos textos y el mismo video, no hay nada que volver a subir;
  3. renombra el conjunto viejo a «ZZ NO USAR ...» y lo deja PAUSADO.

No borra nada. Un conjunto pausado dentro de una campania encendida no gasta,
asi que queda inofensivo; el nombre es para que no se preste a confusion. Si
Bruno prefiere borrarlo, se borra a mano y con su palabra.

Uso:
    python3 arreglar-pixel-za-maths.py            # muestra lo que hay
    python3 arreglar-pixel-za-maths.py --rehacer  # crea el conjunto correcto
"""
import argparse, importlib.util, json, pathlib, sys, time

RAIZ = pathlib.Path(__file__).parent
CAMPANIA = "120248376587830519"        # ZA | CBO | Maths Illustrated | 2026-11
VIEJO = "120248376588350519"           # el conjunto con el pixel equivocado
PIXEL_MATHS = "1145294078008097"       # tabla `pixels`, embudo maths-illustrated
PIXEL_PHYSICS = "4633079520296335"     # el que habia, y que NO corresponde

spec = importlib.util.spec_from_file_location("c", RAIZ / "campanas-za-au.py")
mod = importlib.util.module_from_spec(spec)
_argv = sys.argv[:]; sys.argv = ["x", "--listar"]
try: spec.loader.exec_module(mod)
except SystemExit: pass
sys.argv = _argv
meta = mod.meta


def mirar(conjunto):
    ok, d = meta("GET", conjunto,
                 {"fields": "name,effective_status,optimization_goal,promoted_object"})
    if not ok:
        return print(f"  ERROR: {d}")
    px = (d.get("promoted_object") or {}).get("pixel_id")
    cual = ("Maths ✓" if px == PIXEL_MATHS else
            "Fisica ✗" if px == PIXEL_PHYSICS else "otro")
    print(f'  {conjunto}  {d["effective_status"]:<9} {d["name"][:34]:<34} pixel {px} ({cual})')
    return d


def anuncios(conjunto):
    ok, d = meta("GET", f"{conjunto}/ads",
                 {"fields": "id,name,creative{id}", "limit": 30})
    return d.get("data", []) if ok else []


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--rehacer", action="store_true")
    a = ap.parse_args()

    print("CONJUNTOS DE LA CAMPANIA:")
    ok, d = meta("GET", f"{CAMPANIA}/adsets", {"fields": "id", "limit": 20})
    for s in (d.get("data", []) if ok else []):
        mirar(s["id"]); time.sleep(2)

    if not a.rehacer:
        sys.exit(print(f"\n  [ensayo] con --rehacer crea el conjunto correcto "
                       f"(pixel {PIXEL_MATHS}) y renombra el viejo.\n"))

    viejos = anuncios(VIEJO)
    if not viejos:
        sys.exit("\n  No encontre los anuncios del conjunto viejo. No sigo.\n")
    print(f"\n  reuso {len(viejos)} creativos ya subidos")

    ok, nuevo = meta("POST", f"{mod.ACT}/adsets", {
        "name": "ZA | Broad | pixel Maths",
        "campaign_id": CAMPANIA, "status": "PAUSED",
        "billing_event": "IMPRESSIONS",
        "optimization_goal": "OFFSITE_CONVERSIONS",
        "attribution_spec": json.dumps([
            {"event_type": "CLICK_THROUGH", "window_days": 7},
            {"event_type": "VIEW_THROUGH", "window_days": 1}]),
        "promoted_object": json.dumps(
            {"pixel_id": PIXEL_MATHS, "custom_event_type": "PURCHASE"}),
        "targeting": json.dumps({
            "geo_locations": {"countries": ["ZA"]},
            "age_min": 16, "age_max": 30,
            "targeting_automation": {"advantage_audience": 0}})})
    if not ok:
        sys.exit(f"\n  ERROR creando el conjunto: {nuevo}\n")
    print(f"  conjunto nuevo {nuevo['id']}")

    for ad in viejos:
        time.sleep(2)
        ok, r = meta("POST", f"{mod.ACT}/ads", {
            "name": ad["name"], "adset_id": nuevo["id"],
            "creative": json.dumps({"creative_id": ad["creative"]["id"]}),
            "status": "PAUSED"})
        print(f"    anuncio {r['id'] if ok else r}")

    time.sleep(2)
    ok, _ = meta("POST", VIEJO, {"name": "ZZ NO USAR · pixel equivocado"})
    print(f"  conjunto viejo renombrado: {'ok' if ok else 'no pude'}")

    print("\nCOMO QUEDO:")
    time.sleep(3)
    ok, d = meta("GET", f"{CAMPANIA}/adsets", {"fields": "id", "limit": 20})
    for s in (d.get("data", []) if ok else []):
        mirar(s["id"]); time.sleep(2)
    print()
