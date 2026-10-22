#!/usr/bin/env python3
"""Sube los creativos a Meta y deja campania, conjunto y anuncios PAUSADOS.

Por que pausados: un anuncio encendido gasta cada minuto, y las decisiones que
lo encienden -- presupuesto, paises, exclusiones -- cuestan plata antes de que
nadie mire. Es ademas la regla que ya estaba escrita en la guia de la app:
"lo nuevo se crea PAUSADO". El interruptor lo da el duenio.

El token NO se pide ni se escribe: se lee cifrado de app_settings y se descifra
en memoria, igual que hace el servidor. Nunca se imprime.

  python3 subir-anuncios.py --validar   -> no crea NADA; le pide a Meta que
                                           valide la campania y el conjunto
  python3 subir-anuncios.py             -> sube todo, pausado
"""
import argparse, json, os, pathlib, subprocess, sys, time
import urllib.error, urllib.parse, urllib.request

RAIZ  = pathlib.Path(__file__).parent
GRAPH = "v21.0"
TIENDA = "financestudylab"
CHECKOUT = "kit"
PIXEL = "4633079520296335"
DESTINO = "https://financestudylab.com"

# --- lo que decidio el duenio -------------------------------------------------
PRESUPUESTO_DIARIO = 25          # USD
PAISES = ["US"]
EXCLUIR_COMPRADORES = True
EDADES = (21, 65)

# El tercer valor es el SEGUNDO del que se saca la miniatura. Elegidos mirando
# los fotogramas: el que mas dice sin reproducir el video.
VIDEOS = [
    ("metodo",   pathlib.Path.home() / "Documents/physicstudylab-videos/out/stop-reel.mp4",
     "The 7% rule nobody finishes explaining", 16.2),      # 1,4 % vs 4,2 %
    ("producto", pathlib.Path.home() / "Documents/physicstudylab-videos/out/tour-fin.mp4",
     "91 illustrated pages on how a stock is actually selected", 1.2),   # la tapa
    ("dolor",    pathlib.Path.home() / "Documents/physicstudylab-videos/out/gap-reel.mp4",
     "You were taught the wrong subject", 16.6),           # $187 y +29 %
]

CUERPO = (
    "Your stop is at 7%. You did everything right.\n\n"
    "So why does the same 7% stop cost one investor 1.4% of their portfolio and "
    "another 4.2%?\n\n"
    "Because the stop was never the rule that mattered. What matters is what you "
    "apply it to — and almost nobody teaches that part.\n\n"
    "The Leader Screen is 91 illustrated pages on how a stock is actually selected: "
    "seven tests for finding a market leader, and one for knowing when not to buy. "
    "Written for people who were never taught to read a chart.\n\n"
    "Educational material. Not investment advice."
)
DESCRIPCION = "91 illustrated pages · instant download · 30-day guarantee"


def entorno():
    env = {}
    for l in (RAIZ / ".env.local").read_text().splitlines():
        if "=" in l and not l.startswith("#"):
            k, v = l.split("=", 1); env[k] = v.strip()
    return env

E = entorno()


def supabase(metodo, ruta, cuerpo=None, prefer="return=representation"):
    req = urllib.request.Request(
        f"{E['SUPABASE_URL']}/rest/v1/{ruta}", method=metodo,
        data=json.dumps(cuerpo).encode() if cuerpo else None,
        headers={"apikey": E["SUPABASE_SERVICE_KEY"],
                 "authorization": f"Bearer {E['SUPABASE_SERVICE_KEY']}",
                 "content-type": "application/json", "prefer": prefer})
    with urllib.request.urlopen(req, timeout=60) as r:
        t = r.read().decode()
    return json.loads(t) if t.strip() else []


def descifrar(blob):
    """Mismo formato que src/lib/secrets.ts. El valor nunca se imprime."""
    js = r'''
const {createDecipheriv,createHash}=require("crypto");
const [v,iv,tag,body]=process.env.BLOB.split(".");
const key=createHash("sha256").update(process.env.SECRETS_KEY).digest();
const d=createDecipheriv("aes-256-gcm",key,Buffer.from(iv,"base64"));
d.setAuthTag(Buffer.from(tag,"base64"));
process.stdout.write(Buffer.concat([d.update(Buffer.from(body,"base64")),d.final()]).toString("utf8"));
'''
    r = subprocess.run(["node", "-e", js], capture_output=True, text=True,
                       env={**os.environ, "SECRETS_KEY": E["SECRETS_KEY"], "BLOB": blob})
    if r.returncode:
        sys.exit("  no pude descifrar el token de Meta: " + r.stderr[:200])
    return r.stdout


def token_meta():
    fila = supabase("GET", "app_settings?key=eq.meta_connection&select=value")
    enc = (fila[0]["value"] if fila else {}).get("token_enc")
    if not enc:
        sys.exit("\n  No hay token de Meta. Corre conectar-ads.py primero.\n")
    return descifrar(enc)


TOKEN = None       # se cargan en main
ACT_GLOBAL = ""


def meta(metodo, ruta, params=None, archivo=None):
    """Una llamada a la Graph API. Devuelve (ok, dato|mensaje de error completo)."""
    params = dict(params or {})
    params["access_token"] = TOKEN
    url = f"https://graph.facebook.com/{GRAPH}/{ruta}"
    if metodo == "GET":
        req = urllib.request.Request(url + "?" + urllib.parse.urlencode(params))
    elif archivo:
        # multipart a mano: subir un video es el unico caso que lo necesita
        lim = "----meta" + str(int(time.time()))
        cuerpo = bytearray()
        for k, v in params.items():
            cuerpo += (f"--{lim}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n").encode()
        cuerpo += (f"--{lim}\r\nContent-Disposition: form-data; name=\"source\"; "
                   f"filename=\"{archivo.name}\"\r\nContent-Type: video/mp4\r\n\r\n").encode()
        cuerpo += archivo.read_bytes() + b"\r\n"
        cuerpo += f"--{lim}--\r\n".encode()
        req = urllib.request.Request(url, data=bytes(cuerpo), method="POST",
                                     headers={"Content-Type": f"multipart/form-data; boundary={lim}"})
    else:
        req = urllib.request.Request(url, data=urllib.parse.urlencode(params).encode(), method="POST")
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            return True, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        crudo = e.read().decode(errors="replace")
        try:
            err = json.loads(crudo).get("error", {})
            partes = [f"HTTP {e.code}", err.get("message", "")]
            for k in ("error_user_title", "error_user_msg", "error_subcode"):
                if err.get(k): partes.append(f"{k}: {err[k]}")
            if err.get("error_data"): partes.append(f"error_data: {json.dumps(err['error_data'])[:400]}")
            return False, "\n       ".join(str(x) for x in partes if x)
        except Exception:
            return False, f"HTTP {e.code} — {crudo[:600]}"
    except Exception as e:
        return False, f"{type(e).__name__}: {e}"


FFMPEG = (pathlib.Path.home() /
          "Documents/physicstudylab-videos/node_modules/@remotion/compositor-darwin-arm64/ffmpeg")

def miniatura(ACT, ruta, segundo):
    """Un fotograma del propio reel, subido como imagen de anuncio.

    Meta rechaza un creativo de video sin miniatura (error 1443226). Se saca del
    video y no se genera aparte: lo que el espectador ve quieto tiene que ser un
    cuadro real de lo que va a ver en movimiento.
    """
    dst = pathlib.Path("/tmp") / f"mini-{ruta.stem}.jpg"
    subprocess.run([str(FFMPEG), "-y", "-ss", str(segundo), "-i", str(ruta),
                    "-frames:v", "1", "-q:v", "3", str(dst)],
                   capture_output=True,
                   env={**os.environ, "DYLD_LIBRARY_PATH": str(FFMPEG.parent)}, timeout=120)
    if not dst.exists():
        return None
    import base64
    ok, d = meta("POST", f"{ACT}/adimages", {"bytes": base64.b64encode(dst.read_bytes()).decode()})
    if not ok:
        print(f"       miniatura: {d}"); return None
    imgs = d.get("images", {})
    return (list(imgs.values())[0] or {}).get("hash") if imgs else None


def cuenta():
    fila = supabase("GET", f"stores?slug=eq.{TIENDA}&select=meta_ad_account_id")
    act = fila[0]["meta_ad_account_id"]
    return "act_" + str(act).replace("act_", "")


NEGOCIO = "415991975921635"        # el portfolio «Bruno Gazze»

def pagina():
    """La pagina desde la que sale el anuncio. Se descubre, no se escribe a mano.

    /me/accounts NO sirve con un usuario del sistema: las paginas no cuelgan de
    el, cuelgan del negocio. Y esta en particular pertenece a otro portfolio
    (algoritmia_desarrollos) y esta compartida, asi que tampoco aparece en
    owned_pages. Se prueban las cuatro vias, de la mas precisa a la mas amplia,
    y se dice cual contesto.
    """
    vias = [
        (f"{ACT_GLOBAL}/promote_pages", "las que esta cuenta publicitaria puede promocionar"),
        (f"{NEGOCIO}/client_pages",     "paginas compartidas con el negocio"),
        (f"{NEGOCIO}/owned_pages",      "paginas propias del negocio"),
        ("me/accounts",                 "paginas del usuario"),
    ]
    # Si el duenio ya sabe el ID, se usa y no se consulta nada. El ID de una
    # pagina no es un secreto: es publico. Pedirselo sale mas barato que
    # regenerar el token solo para poder listar.
    fijo = os.environ.get("PAGE_ID", "").strip()
    if fijo:
        ok, d = meta("GET", fijo, {"fields": "id,name"})
        if ok and d.get("id"):
            return d["id"], d.get("name", fijo)
        print(f"    (no pude leer la pagina {fijo}: {d})")
        return fijo, fijo        # se usa igual: crear el anuncio es la prueba real

    for ruta, que in vias:
        ok, d = meta("GET", ruta, {"fields": "id,name"})
        paginas = (d or {}).get("data", []) if ok else []
        if paginas:
            print(f"    (encontrada en {que})")
            return paginas[0]["id"], paginas[0]["name"]
    sys.exit("""
  No pude descubrir la pagina sola. Medido, el token no tiene
  `business_management`, que es el permiso para LISTAR las paginas del negocio
  -- y promote_pages y assigned_pages vuelven vacios.

  No hace falta regenerar el token por eso. El ID de una pagina es publico:
  business.facebook.com > Configuracion del negocio > Cuentas > Paginas,
  y debajo del nombre figura el identificador.

  Despues:   PAGE_ID=1234567890 python3 subir-anuncios.py --validar
""")


# ------------------------------------------------------------------ las piezas
def spec_campania():
    return {
        "name": "US | Finance Study Lab | Kit",
        "objective": "OUTCOME_SALES",
        "status": "PAUSED",
        "special_ad_categories": json.dumps([]),
        "buying_type": "AUCTION",
        # Meta lo exige declarado cuando el presupuesto va en el CONJUNTO y no
        # en la campania. En false el presupuesto del conjunto es exactamente el
        # que se puso: con un solo conjunto, compartir no tiene a quien, y un
        # numero que no se mueve es mas facil de leer en un primer test.
        "is_adset_budget_sharing_enabled": "false",
    }


def spec_conjunto(campania_id, excluir=None):
    seg = {
        "geo_locations": {"countries": PAISES},
        "age_min": EDADES[0], "age_max": EDADES[1],
    }
    if excluir:
        seg["excluded_custom_audiences"] = [{"id": excluir}]
    return {
        "name": "US | 21-65 | compras",
        "campaign_id": campania_id,
        "daily_budget": PRESUPUESTO_DIARIO * 100,
        "billing_event": "IMPRESSIONS",
        "optimization_goal": "OFFSITE_CONVERSIONS",
        "bid_strategy": "LOWEST_COST_WITHOUT_CAP",
        "promoted_object": json.dumps({"pixel_id": PIXEL, "custom_event_type": "PURCHASE"}),
        "targeting": json.dumps(seg),
        "status": "PAUSED",
    }


def main():
    global TOKEN
    ap = argparse.ArgumentParser()
    ap.add_argument("--validar", action="store_true",
                    help="no crea nada: le pide a Meta que valide campania y conjunto")
    g = ap.parse_args()

    global ACT_GLOBAL
    TOKEN = token_meta()
    ACT = ACT_GLOBAL = cuenta()
    print(f"\n  cuenta: {ACT}")

    ok, info = meta("GET", ACT, {"fields": "name,currency,account_status"})
    if not ok: sys.exit(f"  no puedo leer la cuenta: {info}")
    print(f"  «{info['name']}»  {info['currency']}  estado {info['account_status']} (1 = activa)")

    pid, pnombre = pagina()
    print(f"  pagina: {pnombre} ({pid})")

    # --------------------------------------------------------------- validacion
    # execution_options=validate_only: Meta revisa la peticion ENTERA y no crea
    # nada. Es la unica forma de comprobar el permiso de escritura sin dejar
    # basura en la cuenta publicitaria de un cliente.
    print("\n  VALIDANDO (Meta revisa y no crea nada)")
    camp = spec_campania()
    camp["execution_options"] = json.dumps(["validate_only"])
    ok, d = meta("POST", f"{ACT}/campaigns", camp)
    print(f"    campania: {'OK' if ok else 'FALLA'}")
    if not ok:
        print(f"       {d}")
        sys.exit("\n  La validacion fallo. No se creo nada.\n")

    if g.validar:
        print("\n  Validacion superada: el token puede escribir en la cuenta.")
        print("  No se creo nada. Corre sin --validar para subir de verdad.\n")
        return

    # ------------------------------------------------------------------ crear
    print("\n  CREANDO (todo pausado)")
    cid = os.environ.get("CAMPAIGN_ID", "").strip()
    if cid:
        print(f"    campania  {cid}  (reusada)")
    else:
        ok, d = meta("POST", f"{ACT}/campaigns", spec_campania())
        if not ok: sys.exit(f"    campania: {d}")
        cid = d["id"]; print(f"    campania  {cid}")

    excluir = None
    if EXCLUIR_COMPRADORES and not os.environ.get("ADSET_ID"):
        ok, d = meta("POST", f"{ACT}/customaudiences", {
            "name": "Finance · ya compraron",
            "subtype": "WEBSITE",
            "retention_days": 180,
            "rule": json.dumps({"inclusions": {"operator": "or", "rules": [{
                "event_sources": [{"id": PIXEL, "type": "pixel"}],
                "retention_seconds": 180 * 86400,
                "filter": {"operator": "and", "filters": [
                    {"field": "event", "operator": "eq", "value": "Purchase"}]},
            }]}}),
        })
        if ok:
            excluir = d["id"]; print(f"    publico a excluir  {excluir}")
        else:
            print(f"    publico a excluir: no se pudo crear, sigo sin exclusion\n       {d}")

    # Validar el conjunto ANTES de subir videos: ahi viven el presupuesto, la
    # segmentacion y el objetivo de conversion. Si algo de eso esta mal, mejor
    # enterarse ahora que despues de subir 10 MB.
    sid = os.environ.get("ADSET_ID", "").strip()
    if sid:
        print(f"    conjunto  {sid}  (reusado)")
    prueba = spec_conjunto(cid, excluir)
    prueba["execution_options"] = json.dumps(["validate_only"])
    ok, d = (True, {}) if sid else meta("POST", f"{ACT}/adsets", prueba)
    if not sid: print(f"    conjunto (validacion): {'OK' if ok else 'FALLA'}")
    if not ok:
        print(f"       {d}")
        sys.exit(f"\n  El conjunto no valida. La campania {cid} quedo creada y PAUSADA.\n")

    if not sid:
        ok, d = meta("POST", f"{ACT}/adsets", spec_conjunto(cid, excluir))
        if not ok: sys.exit(f"    conjunto: {d}")
        sid = d["id"]; print(f"    conjunto  {sid}")

    anuncios = []
    for clave, ruta, titular, seg in VIDEOS:
        if not ruta.exists():
            print(f"    !   falta {ruta}"); continue
        print(f"    subiendo {clave} ({ruta.stat().st_size/1e6:.1f} MB)...")
        ok, d = meta("POST", f"{ACT}/advideos", {"name": f"fsl-{clave}"}, archivo=ruta)
        if not ok: print(f"       {d}"); continue
        vid = d["id"]

        # Meta tarda en procesar el video; el creativo no se puede armar antes.
        for _ in range(40):
            ok2, st = meta("GET", vid, {"fields": "status"})
            if ok2 and (st.get("status", {}).get("video_status") == "ready"): break
            time.sleep(6)

        ih = miniatura(ACT, ruta, seg)
        if not ih:
            print("       sin miniatura, no puedo crear el creativo"); continue

        ok, d = meta("POST", f"{ACT}/adcreatives", {
            "name": f"fsl-{clave}",
            "object_story_spec": json.dumps({
                "page_id": pid,
                **({"instagram_actor_id": os.environ["IG_ID"]} if os.environ.get("IG_ID") else {}),
                "video_data": {
                    "video_id": vid,
                    "image_hash": ih,
                    "title": titular,
                    "message": CUERPO,
                    "link_description": DESCRIPCION,
                    "call_to_action": {"type": "LEARN_MORE",
                                       "value": {"link": DESTINO}},
                },
            }),
            "degrees_of_freedom_spec": json.dumps(
                {"creative_features_spec": {"standard_enhancements": {"enroll_status": "OPT_OUT"}}}),
        })
        if not ok: print(f"       creativo: {d}"); continue
        crid = d["id"]

        ok, d = meta("POST", f"{ACT}/ads", {
            "name": f"US | {clave}",
            "adset_id": sid,
            "creative": json.dumps({"creative_id": crid}),
            "status": "PAUSED",
        })
        if not ok: print(f"       anuncio: {d}"); continue
        anuncios.append((clave, d["id"]))
        print(f"       anuncio {d['id']}")

    # ------------------------------------------------- vincular con el checkout
    fila = supabase("GET", f"funnels?slug=eq.{CHECKOUT}&select=id,meta_campaign_ids")
    if fila:
        ids = list(set((fila[0]["meta_campaign_ids"] or []) + [cid]))
        supabase("PATCH", f"funnels?id=eq.{fila[0]['id']}", {"meta_campaign_ids": ids})
        print(f"\n    campania vinculada al checkout «{CHECKOUT}»")

    print(f"""
  LISTO. Todo PAUSADO.

    campania  {cid}
    conjunto  {sid}   US$ {PRESUPUESTO_DIARIO}/dia, {'/'.join(PAISES)}, {EDADES[0]}-{EDADES[1]}
    anuncios  {len(anuncios)}: {', '.join(c for c, _ in anuncios)}

  Miralos y prendelos vos:
    https://adsmanager.facebook.com/adsmanager/manage/campaigns?act={ACT.replace('act_','')}
""")


if __name__ == "__main__":
    main()
