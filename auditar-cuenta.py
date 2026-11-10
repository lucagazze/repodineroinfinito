#!/usr/bin/env python3
"""Auditoria de la cuenta publicitaria: que esta prendido y si entrega bien.

Se escribio el 9/11/2026, despues de prender Sudafrica y Australia, para
contestar cinco preguntas sin abrir el Administrador de anuncios:

  1. QUE GASTA. Los tres niveles tienen que estar encendidos para entregar:
     campania, conjunto y anuncio. Una campania ACTIVE con el conjunto pausado
     no gasta, y un conjunto ACTIVE con todos los anuncios pausados tampoco.
     Al reves es peor: un conjunto que no deberia estar prendido SI gasta.

  2. SOBRE QUE PIXEL OPTIMIZA CADA CONJUNTO. Maths tiene pixel propio
     (1145294078008097) y Physics/Finance comparten el otro. Un conjunto que
     optimiza sobre el pixel equivocado no recibe nunca el evento PURCHASE:
     no aprende y entrega a ciegas. Y NO se puede corregir despues -- Meta
     rechaza el PATCH aunque el conjunto este pausado.

  3. SI LOS ANUNCIOS TIENEN IDENTIDAD DE INSTAGRAM. Sin
     `instagram_user_id` el anuncio sale con la cabecera vacia, sin nombre ni
     foto. La API no puede ponerla (al token le falta `business_management`):
     se pone en el editor del Administrador de anuncios.

  4. SI ALGUN ANUNCIO ESTA RECHAZADO. `effective_status` DISAPPROVED o
     WITH_ISSUES significa que el conjunto entrega con menos anuncios de los
     que uno cree, o con ninguno.

  5. CUANTO SE ESTA GASTANDO POR DIA, sumado. El gasto de la cuenta es
     compartido entre los productos, asi que el total importa mas que cada
     campania suelta.

Solo lee. No cambia nada.

Uso:
    python3 auditar-cuenta.py
"""
import importlib.util, pathlib, sys, time

RAIZ = pathlib.Path(__file__).parent
PIXELES = {
    "1145294078008097": "Maths",
    "4633079520296335": "Physics/Finance",
    "2386547428803448": "Drone",
}
# Que pixel le corresponde a cada producto, leido de la tabla `pixels`: es el
# que esta colgado del embudo que cobra.
ESPERADO = {"Maths": "1145294078008097", "Physics": "4633079520296335",
            "Finance": "4633079520296335", "Part 107": "2386547428803448"}

spec = importlib.util.spec_from_file_location("c", RAIZ / "campanas-za-au.py")
mod = importlib.util.module_from_spec(spec)
_a = sys.argv[:]; sys.argv = ["x", "--listar"]
try: spec.loader.exec_module(mod)
except SystemExit: pass
sys.argv = _a
meta = mod.meta


def producto(nombre):
    for k in ESPERADO:
        if k.lower() in nombre.lower():
            return k
    return None


def main():
    ok, d = meta("GET", f"{mod.ACT}/campaigns",
                 {"fields": "id,name,status,effective_status,daily_budget", "limit": 80})
    if not ok:
        return print(f"no pude listar: {d}")

    vivas = [c for c in d["data"] if c["effective_status"] == "ACTIVE"]
    dormidas = [c for c in d["data"] if c["effective_status"] != "ACTIVE"]
    print(f"{len(vivas)} campanias ACTIVE, {len(dormidas)} no.\n")

    total, alertas = 0.0, []
    for c in sorted(vivas, key=lambda x: x["name"]):
        pres = int(c.get("daily_budget") or 0) / 100
        print(f'═══ {c["name"]}   ${pres:.0f}/dia   {c["id"]}')
        prod = producto(c["name"])
        entrega = False
        time.sleep(2)

        ok, cs = meta("GET", f'{c["id"]}/adsets',
                      {"fields": "id,name,status,effective_status,promoted_object,"
                                 "daily_budget,targeting", "limit": 25})
        if not ok:
            print(f"    ERROR leyendo conjuntos: {cs}"); continue

        for s in cs.get("data", []):
            px = (s.get("promoted_object") or {}).get("pixel_id")
            etiq = PIXELES.get(px, px)
            geo = (s.get("targeting") or {}).get("geo_locations", {}).get("countries")
            viva = s["effective_status"] == "ACTIVE"
            print(f'    {"▶" if viva else "·"} {s["effective_status"]:<16} {s["name"][:34]:<34} '
                  f'{geo} pixel {etiq}')
            if viva and prod and px != ESPERADO.get(prod):
                alertas.append(f'{c["name"]} / {s["name"]}: optimiza sobre {etiq}, '
                               f'y a {prod} le toca {PIXELES[ESPERADO[prod]]}')
            time.sleep(2)

            ok, ads = meta("GET", f'{s["id"]}/ads',
                           {"fields": "id,name,status,effective_status,"
                                      "creative{instagram_user_id,object_story_spec}",
                            "limit": 40})
            encendidos = 0
            for ad in (ads.get("data", []) if ok else []):
                est = ad["effective_status"]
                hist = ((ad.get("creative") or {}).get("object_story_spec") or {})
                ig = hist.get("instagram_user_id") or \
                     (ad.get("creative") or {}).get("instagram_user_id")
                if est == "ACTIVE":
                    encendidos += 1
                    if viva:
                        entrega = True
                    if not ig:
                        alertas.append(f'{c["name"]} / «{ad["name"][:34]}»: '
                                       f'ENCENDIDO y SIN perfil de Instagram ({ad["id"]})')
                if est in ("DISAPPROVED", "WITH_ISSUES", "AD_PAUSED_PENDING_REVIEW"):
                    alertas.append(f'{c["name"]} / «{ad["name"][:34]}»: {est}')
                marca = "▶" if est == "ACTIVE" else "·"
                print(f'        {marca} {est:<16} ig:{"si" if ig else "NO"}  {ad["name"][:42]}')
            if viva and not encendidos:
                alertas.append(f'{c["name"]} / {s["name"]}: conjunto ENCENDIDO '
                               f'con CERO anuncios activos — gasta nada o entrega mal')

        if entrega:
            total += pres
        else:
            alertas.append(f'{c["name"]}: campania ACTIVE pero NADA entrega '
                           f'(conjunto o anuncios pausados)')
        print()

    print(f"── GASTO DIARIO DE LO QUE ENTREGA: ${total:.0f}/dia\n")
    if alertas:
        print("── ALERTAS")
        for a in alertas:
            print(f"   ! {a}")
    else:
        print("── sin alertas")
    print()
    print("Campanias no activas:",
          ", ".join(sorted(x["name"] for x in dormidas)) or "ninguna")


if __name__ == "__main__":
    main()
