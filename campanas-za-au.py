#!/usr/bin/env python3
"""Sudafrica y Australia -- se crea todo PAUSADO, el interruptor lo da Bruno.

TODO QUEDA PAUSADO. Un anuncio encendido gasta cada minuto. Es la misma regla
de `subir-anuncios.py` y de `campanas-nuevas.py`.

QUE HACE
    1. crea  ZA | CBO | Maths Illustrated | 2026-11   con 3 anuncios
    2. crea  AU | CBO | Physics Study Lab | 2026-11   con 3 anuncios
    3. agrega 1 anuncio al conjunto de la campania de Sudafrica de Fisica que
       YA EXISTE (120248312188460519, con sus 7 anuncios). No se crea una
       segunda: dos campanias al mismo pais con el mismo producto compiten
       entre ellas en la subasta y encarecen las dos.

POR QUE NO HAY UNA CUARTA, QUE SERIA AUSTRALIA CON MATHS. Porque el libro no
entra en ningun examen australiano. Esta auditado contra el syllabus, no
supuesto: `physicstudylab-videos/AUDITORIA-HSC-VCE.md`. En resumen, el HSC
Mathematics Advanced no pide 10 de los 35 conceptos del libro -- porcentaje,
razon, redondeo, poligonos, semejanza, geometria del circulo, volumen, conteo,
punto medio, cuartiles -- y a cambio exige el calculo integral entero, las
variables aleatorias, la distribucion normal, las anualidades y los prestamos,
que el libro no tiene. En Victoria la mitad de geometria y finanzas esta en
General Mathematics y la mitad de funciones y calculo en Mathematical Methods:
son dos materias distintas que un alumno no cursa junto. El NSC y el GCSE
ponen todo eso en un solo examen, y por eso el libro entra ahi y no aca.

EL CIERRE DEL VIDEO ES DISTINTO POR PAIS, y no es un detalle de estilo.
Sudafrica lleva precio porque `product_prices` tiene fila propia en rands
cargada a mano (R299,99) y un numero a mano no se mueve. Australia NO lleva
precio: no hay ninguna fila en AUD, el importe sale de convertir, y el mismo
libro cobro A$25,90 el 24/10 y A$26,90 el 8/11. Un precio impreso en un video
queda viejo en una semana.

LA FORMA DEL CREATIVO SALE DEL ANUNCIO QUE VENDE, NO DE LA IMAGINACION.
Leido `05 Sales-Book` (92 compras, 1.289 USD) el 9/11/2026: lleva `title`,
lleva `message` largo con flechas y hashtags, lleva `link_description`, y su
boton es **SEE_DETAILS**, no SHOP_NOW. Se copia esa forma. Dos cosas de ese
anuncio que NO se copian:
  - dice «Link in bio», que en un anuncio pago con boton promete algo que no
    esta: el clic va a la landing;
  - dice «104 illustrated pages», y el libro principal tiene 95 (contadas
    sobre `Physics-Study-Lab-Main-Book-v3.pdf`). Hay que corregirlo, pero el
    anuncio esta ACTIVO y eso lo decide Bruno.

LA IDENTIDAD DE INSTAGRAM. El script intenta ponerla; si el token la rechaza
-- no tiene `business_management` -- crea el anuncio sin ella y lo avisa. Esos
anuncios salen con la cabecera vacia hasta que se abran en el editor:

  adsmanager.facebook.com/adsmanager/manage/ads/edit/standalone
    ?act=4624146111239384&business_id=415991975921635&selected_ad_ids=ID1,ID2

  -> seccion «Identidad» -> «Perfil de Instagram» -> studylab.ok

NO PONER `standard_enhancements` como paraguas: Meta lo da por obsoleto y
rechaza el creativo entero. Va declarado en OPT_OUT, igual que en los que
estan arriba.

Uso:
    python3 campanas-za-au.py                 # ensayo, no escribe nada
    python3 campanas-za-au.py --listar        # lo que ya hay en la cuenta
    python3 campanas-za-au.py --ver ID        # conjuntos y anuncios de una
    python3 campanas-za-au.py --spec ID       # el creativo entero de un anuncio
    python3 campanas-za-au.py --crear         # crea, todo PAUSADO
"""
import argparse, importlib.util, json, pathlib, sys, time
import urllib.error, urllib.parse, urllib.request

RAIZ, GRAPH = pathlib.Path(__file__).parent, "v21.0"
ACT = "act_4624146111239384"
# EL PIXEL VA POR CAMPANIA, NO UNO PARA TODAS, y esto costo rehacer un
# conjunto. Maths tiene pixel propio desde el 2/11 (`1145294078008097`) y es
# el unico colgado del embudo `maths-illustrated` en la tabla `pixels`. Con el
# pixel de Fisica, el conjunto optimiza OFFSITE_CONVERSIONS esperando compras
# en un pixel al que el checkout de Maths no le manda ninguna: no aprende y
# entrega a ciegas.
#
# Y NO SE PUEDE CORREGIR DESPUES. Un PATCH al `promoted_object` rebota aunque
# el conjunto este PAUSADO y nunca haya entregado: «No es posible editar el
# pixel [...] una vez que se han publicado. [...] crea uno nuevo.» Publicado
# no es entregado: basta con que exista. El pixel se elige UNA vez.
PIXEL_PHYSICS = "4633079520296335"   # Physics, compartido con Finance
PIXEL_MATHS = "1145294078008097"     # Maths Study Lab, embudo maths-illustrated
PAGINA = "1286877647842413"
IG = "17841437509345305"
VIDEOS_DIR = RAIZ.parent / "physicstudylab-videos/out"

# --------------------------------------------------------------------------
# Los cuerpos. Cada afirmacion sale de la pagina 4 del PDF que se entrega o de
# la landing; la tabla completa esta en LANZAMIENTO-ZA-AU.md.
# --------------------------------------------------------------------------

CUERPO_MATHS = """📐 Maths you can actually look at.

Not walls of text and worked examples you cannot follow. The whole NSC syllabus, drawn — concept by concept, Paper 1 and Paper 2.

→ The straight line, the parabola, the hyperbola — one picture each
→ Circle geometry, with the theorem on the diagram
→ The unit circle, and where every identity comes from
→ Differential calculus, from the average gradient to optimisation
→ Counting, probability and the ogive

Page 4 is the syllabus map: which paper each concept answers to, so you can see what you still have not covered.

95 pages. Written for NSC Mathematics, and for GCSE Higher.

#mathsillustrated #nscmaths #grade12 #matric #mathsrevision #studytips #studygram #examseason #gcsemaths #mathshelp"""

CUERPO_FISICA = """🧠 Physics that finally makes sense.

Not "memorise the formula and hope." Actually see what is happening — and every page in this video is a page you get.

→ Newton's laws — what is really going on, not just the rule
→ Why something floats: what it displaces, drawn
→ Heat and thermodynamics, picture by picture
→ Current, voltage, resistance — how they actually connect
→ Why two charges repel, and what a field really is
→ Modern physics, without the spiral

95 illustrated pages, plus the glossary and the revision cards.

#physicsstudylab #physicsrevision #sciencerevision #studytips #revisionnotes #studygram #examseason #physicshelp #studentlife #physicsstudent"""

# Una linea mas para Sudafrica, y no es invento: la landing ya lo dice con
# esas palabras, aunque hoy esta al 85 % de la pagina.
CUERPO_FISICA_ZA = CUERPO_FISICA.replace(
    "95 illustrated pages, plus the glossary and the revision cards.",
    "Physics is the same set of ideas whichever board you sit.\n\n"
    "95 illustrated pages, plus the glossary and the revision cards.")

PLAN = [
    dict(clave="za-maths", nombre="ZA | CBO | Maths Illustrated | 2026-11",
         paises=["ZA"], presupuesto=15, edad=(16, 30), pixel=PIXEL_MATHS,
         video=VIDEOS_DIR / "maths-4-za.mp4",
         destino="https://www.physicsstudylab.com/maths",
         pie="R299.99 · instant PDF · 30-day guarantee",
         cuerpo=CUERPO_MATHS,
         titulares=["Maths Illustrated: the NSC syllabus, drawn 📐",
                    "Paper 1 and Paper 2, in pictures 📐",
                    "95 pages of maths you can look at 📐"]),

    dict(clave="au-fisica", nombre="AU | CBO | Physics Study Lab | 2026-11",
         paises=["AU"], presupuesto=15, edad=(16, 30), pixel=PIXEL_PHYSICS,
         video=VIDEOS_DIR / "physics-kit-ad-au.mp4",
         destino="https://www.physicsstudylab.com/",
         pie="Instant PDF · 2 bonuses · 30-day guarantee",
         cuerpo=CUERPO_FISICA,
         titulares=["Physics Study Lab: the full kit 📘",
                    "Physics, drawn before it is written 📘",
                    "The pages in the video are the pages you get 📘"]),

    # Esta NO crea campania: cuelga del conjunto que ya existe.
    dict(clave="za-fisica", nombre="ZA | CBO | Physics Study Lab | 2026-11",
         conjunto="120248312189540519",
         video=VIDEOS_DIR / "physics-kit-ad-za.mp4",
         destino="https://www.physicsstudylab.com/",
         pie="R299.99 · instant PDF · 30-day guarantee",
         cuerpo=CUERPO_FISICA_ZA,
         titulares=["Physics Study Lab: the full kit 📘"]),
]

# Lo que ya quedo creado en la corrida del 9/11/2026. La campania, el conjunto
# y el video se crearon bien; los creativos se rechazaron por el paraguas
# `standard_enhancements`. Con `--anuncios` se retoma desde aca en vez de
# crear una segunda campania y volver a subir 23 MB de video.
YA = {
    "za-maths":  dict(conjunto="120248376588350519", video_id="1417398977085952"),
    "au-fisica": dict(conjunto="120248376593500519", video_id="1039267279195954"),
    "za-fisica": dict(conjunto="120248312189540519", video_id="1835067287644502"),
}

spec = importlib.util.spec_from_file_location("p", RAIZ / "crear-pixel-107.py")
mod = importlib.util.module_from_spec(spec)
_argv = sys.argv[:]; sys.argv = ["x", "--ver"]
try: spec.loader.exec_module(mod)
except SystemExit: pass
sys.argv = _argv
TOKEN = mod.descifrar(mod.supabase(
    "GET", "app_settings?key=eq.meta_connection&select=value")[0]["value"]["token_enc"])


def meta(metodo, ruta, params=None):
    p = dict(params or {}); p["access_token"] = TOKEN
    url = f"https://graph.facebook.com/{GRAPH}/{ruta}"
    req = (urllib.request.Request(url + "?" + urllib.parse.urlencode(p)) if metodo == "GET"
           else urllib.request.Request(url, data=urllib.parse.urlencode(p).encode(), method="POST"))
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return True, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        crudo = e.read().decode(errors="replace")
        try:
            err = json.loads(crudo).get("error", {})
            return False, f"HTTP {e.code} — {err.get('message','')} {err.get('error_user_msg','')}"[:300]
        except Exception:
            return False, f"HTTP {e.code} — {crudo[:260]}"


def subir_video(ruta: pathlib.Path):
    limite = "----meta" + str(int(time.time() * 1000))
    cuerpo = bytearray()
    for k, v in (("access_token", TOKEN), ("name", ruta.stem)):
        cuerpo += (f'--{limite}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n').encode()
    cuerpo += (f'--{limite}\r\nContent-Disposition: form-data; name="source"; '
               f'filename="{ruta.name}"\r\nContent-Type: video/mp4\r\n\r\n').encode()
    cuerpo += ruta.read_bytes() + f"\r\n--{limite}--\r\n".encode()
    req = urllib.request.Request(
        f"https://graph.facebook.com/{GRAPH}/{ACT}/advideos", data=bytes(cuerpo),
        headers={"Content-Type": f"multipart/form-data; boundary={limite}"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=900) as r:
            return True, json.loads(r.read().decode())["id"]
    except urllib.error.HTTPError as e:
        return False, e.read().decode(errors="replace")[:300]


def miniatura(video_id, intentos=25):
    """Meta tarda en generar las miniaturas; sin una, el creativo se rechaza."""
    for _ in range(intentos):
        ok, d = meta("GET", f"{video_id}/thumbnails", {"fields": "uri,is_preferred"})
        if ok and d.get("data"):
            pref = [t for t in d["data"] if t.get("is_preferred")] or d["data"]
            return pref[0]["uri"]
        time.sleep(6)
    return None


SIN_IDENTIDAD = []     # anuncios que quedaron sin el perfil de Instagram

# El anuncio que vende, del que se copia la declaracion de automatizaciones.
REFERENCIA = "120248312790560519"   # «05 Sales-Book», 92 compras
_DOF = {}


def automatizaciones():
    """Las 59 mejoras creativas, declaradas una por una en OPT_OUT.

    NO SE PUEDEN PEDIR CON EL PARAGUAS `standard_enhancements`: Meta lo da por
    obsoleto y rechaza el creativo entero con «La opcion para incluir el campo
    de mejoras estandar esta obsoleta. Define funciones individuales en su
    lugar». Pasó el 9/11/2026 con los 7 creativos de esta corrida.

    Tampoco se escriben a mano: se leen del anuncio que vende, asi la lista
    sigue siendo la correcta cuando Meta agregue o saque mejoras.
    """
    if not _DOF:
        ok, d = meta("GET", REFERENCIA, {"fields": "creative{degrees_of_freedom_spec}"})
        if ok:
            _DOF.update(d.get("creative", {}).get("degrees_of_freedom_spec") or {})
    return _DOF


def crear_anuncios(plan, adset_id, video_id, thumb):
    dof = automatizaciones()
    if not dof:
        return print("      ERROR: no pude leer las automatizaciones del anuncio de referencia")
    for i, titular in enumerate(plan["titulares"], 1):
        historia = {
            "page_id": PAGINA,
            "video_data": {
                "video_id": video_id, "image_url": thumb,
                "title": titular, "message": plan["cuerpo"],
                "link_description": plan["pie"],
                "call_to_action": {"type": "SEE_DETAILS",
                                   "value": {"link": plan["destino"]}}}}
        campos = {
            "name": f"{plan['clave']} · {i}",
            "degrees_of_freedom_spec": json.dumps(dof)}

        # Primero CON identidad de Instagram. Si el token no alcanza, sin ella.
        con_ig = dict(historia); con_ig["instagram_user_id"] = IG
        ok, cre = meta("POST", f"{ACT}/adcreatives",
                       {**campos, "object_story_spec": json.dumps(con_ig)})
        ident = "studylab.ok"
        if not ok:
            ok, cre = meta("POST", f"{ACT}/adcreatives",
                           {**campos, "object_story_spec": json.dumps(historia)})
            ident = "SIN IDENTIDAD"
        if not ok:
            print(f"      ERROR creativo {i}: {cre}"); continue

        ok, ad = meta("POST", f"{ACT}/ads", {
            "name": f"{i} · {titular}", "adset_id": adset_id,
            "creative": json.dumps({"creative_id": cre["id"]}), "status": "PAUSED"})
        if ok:
            print(f"      anuncio {i}  {ad['id']}  ({ident})")
            if ident == "SIN IDENTIDAD":
                SIN_IDENTIDAD.append(ad["id"])
        else:
            print(f"      ERROR anuncio {i}: {ad}")


def crear(plan, ensayo=True):
    video = plan["video"]
    print(f"\n### {plan['nombre']}")
    if not video.exists():
        return print(f"    FALTA el video {video}")
    if plan.get("conjunto"):
        print(f"    se agrega al conjunto que ya existe: {plan['conjunto']}")
    else:
        print(f"    pais {','.join(plan['paises'])} · {plan['edad'][0]}-{plan['edad'][1]} · "
              f"${plan['presupuesto']}/dia")
    print(f"    video   {video.name} ({video.stat().st_size//1024} KB)")
    print(f"    destino {plan['destino']}")
    print(f"    pie     {plan['pie']}")
    for t in plan["titulares"]:
        print(f"      · {t}")
    if ensayo:
        return print("    [ensayo: no se escribio nada]")

    adset_id = plan.get("conjunto")
    if not adset_id:
        ok, camp = meta("POST", f"{ACT}/campaigns", {
            "name": plan["nombre"], "objective": "OUTCOME_SALES",
            "status": "PAUSED", "special_ad_categories": "[]",
            "buying_type": "AUCTION",
            "daily_budget": plan["presupuesto"] * 100,
            "bid_strategy": "LOWEST_COST_WITHOUT_CAP"})
        if not ok:
            return print(f"    ERROR campania: {camp}")
        print(f"    campania {camp['id']}")
        ok, adset = meta("POST", f"{ACT}/adsets", {
            "name": f"{plan['paises'][0]} | Broad",
            "campaign_id": camp["id"], "status": "PAUSED",
            "billing_event": "IMPRESSIONS",
            "optimization_goal": "OFFSITE_CONVERSIONS",
            "attribution_spec": json.dumps([
                {"event_type": "CLICK_THROUGH", "window_days": 7},
                {"event_type": "VIEW_THROUGH", "window_days": 1}]),
            "promoted_object": json.dumps({
                "pixel_id": plan["pixel"], "custom_event_type": "PURCHASE"}),
            "targeting": json.dumps({
                "geo_locations": {"countries": plan["paises"]},
                "age_min": plan["edad"][0], "age_max": plan["edad"][1],
                "targeting_automation": {"advantage_audience": 0}})})
        if not ok:
            return print(f"    ERROR conjunto: {adset}")
        adset_id = adset["id"]; print(f"    conjunto {adset_id}")

    ok, vid = subir_video(video)
    if not ok:
        return print(f"    ERROR subiendo el video: {vid}")
    print(f"    video    {vid}")
    thumb = miniatura(vid)
    if not thumb:
        return print("    ERROR: Meta no genero miniatura; sin ella el creativo se rechaza")
    crear_anuncios(plan, adset_id, vid, thumb)


def listar():
    ok, d = meta("GET", f"{ACT}/campaigns",
                 {"fields": "id,name,effective_status,daily_budget", "limit": 80})
    if not ok:
        return print(f"  no pude listar: {d}")
    for c in sorted(d["data"], key=lambda x: x["name"]):
        print(f'  {c["effective_status"]:<9} {c["id"]}  '
              f'{int(c.get("daily_budget") or 0)/100:>5.0f}/d  {c["name"]}')


def ver(campania):
    """OJO: si esto no imprime nada, es un error, no una campania vacia.

    La primera version se tragaba el fallo con `d.get("data", []) if ok else []`
    y daba exactamente el mismo silencio para «no hay conjuntos» que para «la
    cuenta esta limitada por rafaga de llamadas» -- que es lo que pasaba
    («User request limit reached», 9/11/2026, por mis propias consultas).
    """
    ok, d = meta("GET", f"{campania}/adsets",
                 {"fields": "id,name,effective_status,targeting,optimization_goal", "limit": 20})
    if not ok:
        return print(f"  ERROR leyendo {campania}: {d}")
    if not d.get("data"):
        return print(f"  {campania}: sin conjuntos")
    for s in d["data"]:
        geo = (s.get("targeting") or {}).get("geo_locations", {}).get("countries")
        print(f'  conjunto {s["id"]}  {s["effective_status"]}  {s["name"]}  {geo}')
        ok2, ads = meta("GET", f'{s["id"]}/ads',
                        {"fields": "id,name,effective_status,"
                                   "creative{instagram_user_id,object_story_spec}", "limit": 40})
        for ad in (ads.get("data", []) if ok2 else []):
            hist = ((ad.get("creative") or {}).get("object_story_spec") or {})
            vd = hist.get("video_data") or hist.get("link_data") or {}
            enlace = (vd.get("call_to_action") or {}).get("value", {}).get("link", "")
            ident = hist.get("instagram_user_id") or (ad.get("creative") or {}).get("instagram_user_id") or "—"
            print(f'      {ad["effective_status"]:<9} {ad["id"]}  ig:{ident}  '
                  f'{ad["name"][:42]:<42} {enlace[:42]}')


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--crear", action="store_true", help="escribe en Meta; sin esto solo muestra")
    ap.add_argument("--listar", action="store_true")
    ap.add_argument("--ver", metavar="CAMPANIA_ID")
    ap.add_argument("--spec", metavar="ANUNCIO_ID")
    ap.add_argument("--anuncios", action="store_true",
                    help="solo los anuncios, sobre lo que ya quedo creado (ver YA)")
    a = ap.parse_args()
    if a.anuncios:
        for p in PLAN:
            y = YA.get(p["clave"])
            if not y:
                continue
            print(f"\n### {p['nombre']}  -> conjunto {y['conjunto']}")
            t = miniatura(y["video_id"])
            if not t:
                print("    ERROR: sin miniatura"); continue
            crear_anuncios(p, y["conjunto"], y["video_id"], t)
        if SIN_IDENTIDAD:
            print("\n  SIN PERFIL DE INSTAGRAM. Abrir el editor con estos ids:")
            print("  https://adsmanager.facebook.com/adsmanager/manage/ads/edit/standalone"
                  "?act=4624146111239384&business_id=415991975921635"
                  f"&selected_ad_ids={','.join(SIN_IDENTIDAD)}")
        print("\n  TODO QUEDA PAUSADO. El interruptor lo da Bruno.\n")
        sys.exit()
    if a.listar:
        listar(); sys.exit()
    if a.ver:
        ver(a.ver); sys.exit()
    if a.spec:
        ok, d = meta("GET", a.spec, {"fields": "name,creative{title,body,object_story_spec}"})
        print(json.dumps(d, indent=2, ensure_ascii=False)[:3000]); sys.exit()
    for p in PLAN:
        crear(p, ensayo=not a.crear)
    if SIN_IDENTIDAD:
        print("\n  ESTOS ANUNCIOS QUEDARON SIN EL PERFIL DE INSTAGRAM. Abrir el editor:")
        print("  adsmanager.facebook.com/adsmanager/manage/ads/edit/standalone"
              f"?act=4624146111239384&business_id=415991975921635"
              f"&selected_ad_ids={','.join(SIN_IDENTIDAD)}")
    print("\n  TODO QUEDA PAUSADO. El interruptor lo da Bruno.\n")
