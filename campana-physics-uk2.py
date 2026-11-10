#!/usr/bin/env python3
"""UK | Physics | 2026-11 B — la campania que le da presupuesto a lo que vende.

TODO QUEDA PAUSADO. El interruptor lo da Bruno.

POR QUE UNA CAMPANIA APARTE, Y NO UN ANUNCIO MAS EN LA QUE YA CORRE. Avise que
dos campanias al mismo pais con el mismo producto compiten en la subasta, y es
cierto. Pero el historial dice algo que lo supera, y es medido:

    anuncio                 gasto      compras   CPA     costo/checkout
    05 Sales-Book         1.471,94        97    15,17        2,33
    15 - REEL FINAL         134,51        14     9,61        3,84
    09 - THE FINAL BOOK     168,15         5    33,63        4,95
    02 Simplest Way         145,12         5    29,02        2,17
    03 One Page Each         59,29         0      —          2,37
    17 - physics-kit-ad-uk   10,70         0      —           —

El CBO de esa campania aprendio a darle todo a `05 Sales-Book`, y lo hizo bien:
hizo 97 de las 122 compras. Pero el efecto secundario es que **el mejor CPA de
la cuenta nunca pudo probarse**: `15 - REEL FINAL` lleva 9,61 sobre 14 compras
y en toda su vida recibio 134 dolares. El mio recibio 10,70 y ni siquiera
llego a un checkout iniciado.

Un anuncio nuevo adentro de esa campania corre la misma suerte. Una campania
propia es la unica forma de que el presupuesto le llegue.

QUE LLEVA, Y POR QUE CADA UNO:

  1. REEL FINAL        el mejor CPA de la cuenta, muerto de hambre. Se reusa
                       el MISMO video que ya esta subido y aprobado en Meta
                       (2400460824026519), asi que conserva su historial de
                       entrega. Sin re-subir nada.
  2. TWO BOOKS         `out/twobooks-30.mp4`, 29,6 s, nunca se uso en UK. De
                       la familia que vende: MUESTRA EL LIBRO. Separando los
                       43 anuncios por lo que muestran, los que muestran el
                       libro hicieron 243 compras a 14,60 y los que ensenian
                       un concepto 5 a 65,60.
  3. KIT AD            `out/physics-kit-ad-uk.mp4`, el recorrido por paginas.
                       En la campania vieja recibio 10,70 dolares: no fracaso,
                       no se probo. Aca arranca parejo con los otros dos.

LO QUE NO SE COPIA DEL ANUNCIO QUE MAS VENDIO, aunque su copy sea el modelo:
  - dice «Link in bio», y en un anuncio pago con boton eso promete algo que no
    esta: el clic ya lleva a la landing;
  - dice «104 illustrated pages» y el libro principal tiene 95, contadas sobre
    `Physics-Study-Lab-Main-Book-v3.pdf`.

EL PRESUPUESTO. 15 USD/dia. La cuenta pasa de 90 a 105 por dia. Si se quiere
dejar el total donde esta, la palanca es bajar `UK | CBO | Physics Study Lab`
de 35 a 20 -- pero eso es una campania ACTIVA y lo decide Bruno, no este
script.

LA IDENTIDAD DE INSTAGRAM la pone Bruno por interfaz: el token no tiene
`business_management`. El script la intenta y avisa cuales quedaron sin.

Uso:
    python3 campana-physics-uk2.py            # ensayo
    python3 campana-physics-uk2.py --crear    # crea, PAUSADA
"""
import argparse, importlib.util, json, pathlib, sys, time

RAIZ = pathlib.Path(__file__).parent
VIDEOS = RAIZ.parent / "physicstudylab-videos/out"
PIXEL_PHYSICS = "4633079520296335"
DESTINO = "https://www.physicsstudylab.com/"

spec = importlib.util.spec_from_file_location("c", RAIZ / "campanas-za-au.py")
mod = importlib.util.module_from_spec(spec)
_a = sys.argv[:]; sys.argv = ["x", "--listar"]
try: spec.loader.exec_module(mod)
except SystemExit: pass
sys.argv = _a
meta, ACT, PAGINA, IG = mod.meta, mod.ACT, mod.PAGINA, mod.IG

# El cuerpo. Mismo molde que el anuncio que vende -- titulo, cuerpo con
# flechas, `link_description` y boton SEE_DETAILS -- con los dos arreglos.
CUERPO = """🧠 Physics that finally makes sense.

Not "memorise the formula and hope." See what is actually happening, page by page.

→ Newton's laws — what is really going on, not just the rule
→ Why something floats: what it displaces, drawn
→ Heat and thermodynamics, picture by picture
→ Current, voltage, resistance — how they actually connect
→ Fields you can finally picture
→ Relativity and quantum, without the spiral

95 illustrated pages, plus the glossary and the revision cards. GCSE and A-Level.

🔒 30-day no-questions guarantee

#physicsstudylab #gcsephysics #alevelphysics #physicsrevision #sciencerevision #studytips #ukstudents #revisionnotes #studygram #examseason"""

CUERPO_FINAL = """📕 127 pages. 12 parts. Every corner of physics in one book.

A folder of notes, three textbooks and a revision guide — and you still cannot find the one formula you need.

→ Mechanics, electricity, thermodynamics, quantum and relativity
→ Astrophysics, cosmology and the physics behind everyday tech
→ The physicists who built the field, and the books that shaped it
→ A full master reference: every formula, constant, unit and symbol

✅ Instant A4 PDF, read on any device or print it
🔒 30-day no-questions guarantee

#physicsstudylab #gcsephysics #alevelphysics #physicsrevision #sciencerevision #studytips #ukstudents #revisionnotes #studygram #examseason"""

ANUNCIOS = [
    dict(clave="reel-final", titulo="The Final Book of Physics 📕",
         cuerpo=CUERPO_FINAL, pie="Instant A4 PDF · 30-day guarantee",
         video_id="2400460824026519"),          # ya subido y aprobado
    dict(clave="two-books", titulo="Physics Study Lab: the full kit 📘",
         cuerpo=CUERPO, pie="Instant PDF · 2 bonuses · 30-day guarantee",
         archivo=VIDEOS / "twobooks-30.mp4"),
    dict(clave="page-tour", titulo="The pages in the video are the pages you get 📘",
         cuerpo=CUERPO, pie="Instant PDF · 2 bonuses · 30-day guarantee",
         archivo=VIDEOS / "physics-kit-ad-uk.mp4"),
]

SIN_IDENTIDAD = []


def crear(ensayo=True):
    print("\n### UK | Physics | 2026-11 B   ·   GB 16-65   ·   $15/dia")
    for a in ANUNCIOS:
        de = a.get("video_id") or (a["archivo"].name if a["archivo"].exists() else "FALTA")
        print(f"    {a['clave']:<12} {a['titulo'][:46]:<46} {de}")
    if ensayo:
        return print("    [ensayo: no se escribio nada]\n")

    ok, camp = meta("POST", f"{ACT}/campaigns", {
        "name": "UK | Physics | 2026-11 B", "objective": "OUTCOME_SALES",
        "status": "PAUSED", "special_ad_categories": "[]", "buying_type": "AUCTION",
        "daily_budget": 1500, "bid_strategy": "LOWEST_COST_WITHOUT_CAP"})
    if not ok:
        return print(f"    ERROR campania: {camp}")
    print(f"    campania {camp['id']}")

    ok, adset = meta("POST", f"{ACT}/adsets", {
        "name": "GB | Broad", "campaign_id": camp["id"], "status": "PAUSED",
        "billing_event": "IMPRESSIONS", "optimization_goal": "OFFSITE_CONVERSIONS",
        "attribution_spec": json.dumps([
            {"event_type": "CLICK_THROUGH", "window_days": 7},
            {"event_type": "VIEW_THROUGH", "window_days": 1}]),
        "promoted_object": json.dumps({"pixel_id": PIXEL_PHYSICS, "custom_event_type": "PURCHASE"}),
        "targeting": json.dumps({
            "geo_locations": {"countries": ["GB"]}, "age_min": 16, "age_max": 65,
            "targeting_automation": {"advantage_audience": 0}})})
    if not ok:
        return print(f"    ERROR conjunto: {adset}")
    print(f"    conjunto {adset['id']}")

    dof = mod.automatizaciones()
    for i, a in enumerate(ANUNCIOS, 1):
        vid = a.get("video_id")
        if not vid:
            if not a["archivo"].exists():
                print(f"    falta {a['archivo']}"); continue
            ok, vid = mod.subir_video(a["archivo"])
            if not ok:
                print(f"    ERROR subiendo {a['clave']}: {vid}"); continue
        thumb = mod.miniatura(vid)
        if not thumb:
            print(f"    ERROR: sin miniatura para {a['clave']}"); continue

        historia = {"page_id": PAGINA, "video_data": {
            "video_id": vid, "image_url": thumb, "title": a["titulo"],
            "message": a["cuerpo"], "link_description": a["pie"],
            "call_to_action": {"type": "SEE_DETAILS", "value": {"link": DESTINO}}}}
        campos = {"name": f"UK-B · {a['clave']}", "degrees_of_freedom_spec": json.dumps(dof)}

        con_ig = dict(historia); con_ig["instagram_user_id"] = IG
        ok, cre = meta("POST", f"{ACT}/adcreatives", {**campos, "object_story_spec": json.dumps(con_ig)})
        ident = "studylab.ok"
        if not ok:
            ok, cre = meta("POST", f"{ACT}/adcreatives", {**campos, "object_story_spec": json.dumps(historia)})
            ident = "SIN IDENTIDAD"
        if not ok:
            print(f"    ERROR creativo {a['clave']}: {cre}"); continue

        ok, ad = meta("POST", f"{ACT}/ads", {
            "name": f"{i} · {a['clave']}", "adset_id": adset["id"],
            "creative": json.dumps({"creative_id": cre["id"]}), "status": "PAUSED"})
        if ok:
            print(f"      anuncio {i}  {ad['id']}  ({ident})")
            if ident == "SIN IDENTIDAD":
                SIN_IDENTIDAD.append(ad["id"])
        else:
            print(f"      ERROR anuncio {a['clave']}: {ad}")
        time.sleep(1)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--crear", action="store_true")
    crear(ensayo=not ap.parse_args().crear)
    if SIN_IDENTIDAD:
        print("\n  SIN PERFIL DE INSTAGRAM. Abrir el editor con estos ids:")
        print("  https://adsmanager.facebook.com/adsmanager/manage/ads/edit/standalone"
              "?act=4624146111239384&business_id=415991975921635"
              f"&selected_ad_ids={','.join(SIN_IDENTIDAD)}")
    print("\n  TODO QUEDA PAUSADO. El interruptor lo da Bruno.\n")
