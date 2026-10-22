#!/usr/bin/env python3
"""Conecta el pixel de Meta: token de Conversions API, codigo de prueba y
cuenta publicitaria, en un solo paso.

El token se tipea a ciegas y nunca se escribe en disco sin cifrar, no queda en
el historial de la terminal y NO pasa por el chat. Lo que hace, en orden:

  1. valida el token contra el pixel de verdad (Graph API), no contra "algo"
  2. valida la cuenta publicitaria si la das
  3. prueba si ese MISMO token puede leer las campanias (ads_read). Si puede,
     lo guarda tambien como META_ADS_TOKEN y el panel muestra el gasto; si no,
     avisa que para eso hace falta un token de Usuario del sistema
  4. guarda el token cifrado (AES-256-GCM) en pixels.capi_token_enc, el codigo
     de prueba en pixels.test_event_code y la cuenta en stores.meta_ad_account_id

Se puede volver a correr: lo que dejes vacio no se toca.

  python3 conectar-pixel.py
"""
import getpass, json, os, pathlib, re, subprocess, sys, urllib.error, urllib.parse, urllib.request

RAIZ    = pathlib.Path(__file__).parent
TIENDA  = "financestudylab"
PIXEL   = "4633079520296335"
GRAPH   = "v21.0"


def guardar_env(clave, valor):
    """Escribe una variable en .env.local (chmod 600, ignorado por git).

    No va a la base: `META_ADS_TOKEN` lo lee el servidor desde el entorno, y
    desplegar.sh sube .env.local a Vercel. Por eso hay que volver a desplegar
    despues de correr esto.
    """
    p = RAIZ / ".env.local"
    txt = p.read_text()
    linea = f"{clave}={valor}"
    if re.search(rf"(?m)^{clave}=.*$", txt):
        txt = re.sub(rf"(?m)^{clave}=.*$", linea, txt)
    else:
        txt = txt.rstrip("\n") + "\n" + linea + "\n"
    p.write_text(txt)
    p.chmod(0o600)

def entorno():
    env = {}
    for l in (RAIZ / ".env.local").read_text().splitlines():
        if "=" in l and not l.startswith("#"):
            k, v = l.split("=", 1); env[k] = v.strip()
    return env

E = entorno()

def cifrar(plano):
    """Mismo formato que src/lib/secrets.ts: v1.iv.tag.cuerpo, AES-256-GCM."""
    js = r'''
const {createCipheriv,createHash,randomBytes}=require("crypto");
const key=createHash("sha256").update(process.env.SECRETS_KEY).digest();
const iv=randomBytes(12), c=createCipheriv("aes-256-gcm",key,iv);
const b=Buffer.concat([c.update(process.env.PLANO,"utf8"),c.final()]);
process.stdout.write(["v1",iv.toString("base64"),c.getAuthTag().toString("base64"),b.toString("base64")].join("."));
'''
    r = subprocess.run(["node", "-e", js], capture_output=True, text=True,
                       env={**os.environ, "SECRETS_KEY": E["SECRETS_KEY"], "PLANO": plano})
    if r.returncode: sys.exit("  no pude cifrar: " + r.stderr[:200])
    return r.stdout

def supabase(metodo, ruta, cuerpo=None):
    req = urllib.request.Request(
        f"{E['SUPABASE_URL']}/rest/v1/{ruta}", method=metodo,
        data=json.dumps(cuerpo).encode() if cuerpo else None,
        headers={"apikey": E["SUPABASE_SERVICE_KEY"],
                 "authorization": f"Bearer {E['SUPABASE_SERVICE_KEY']}",
                 "content-type": "application/json",
                 "prefer": "return=representation"})
    with urllib.request.urlopen(req, timeout=60) as r:
        t = r.read().decode()
    return json.loads(t) if t.strip() else []

def graph(ruta, token, campos=None):
    q = {"access_token": token}
    if campos: q["fields"] = campos
    url = f"https://graph.facebook.com/{GRAPH}/{ruta}?" + urllib.parse.urlencode(q)
    try:
        with urllib.request.urlopen(url, timeout=45) as r:
            return True, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            err = json.loads(e.read().decode()).get("error", {})
            return False, f"HTTP {e.code} — {err.get('message', '')[:200]}"
        except Exception:
            return False, f"HTTP {e.code}"
    except Exception as e:
        return False, f"{type(e).__name__}: {e}"

def evento_prueba(token, codigo):
    """Manda un PageView de prueba al conjunto. Es la unica validacion honesta
    de un token de Conversions API: prueba ESCRIBIR, que es para lo que sirve.

    user_data NO puede ir casi vacio. La primera version mandaba solo
    client_user_agent y Meta devolvia "Invalid parameter" a secas: un evento de
    sitio web necesita al menos un identificador cruzable. Van un mail de prueba
    hasheado -- el mismo formato que usa la app en produccion-- mas IP y
    user-agent, que es el trio que Meta espera de un servidor.
    """
    import hashlib, time as _t
    mail = hashlib.sha256(b"prueba@financestudylab.com").hexdigest()
    cuerpo = urllib.parse.urlencode({
        "access_token": token,
        "test_event_code": codigo,
        "data": json.dumps([{
            "event_name": "PageView",
            "event_time": int(_t.time()),
            "action_source": "website",
            "event_source_url": "https://pay.financestudylab.com/c/financestudylab/kit",
            "user_data": {
                "em": [mail],
                "client_ip_address": "203.0.113.10",   # TEST-NET-3, no es de nadie
                "client_user_agent": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                                      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"),
            },
        }]),
    }).encode()
    req = urllib.request.Request(
        f"https://graph.facebook.com/{GRAPH}/{PIXEL}/events", data=cuerpo, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            return True, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        # El error COMPLETO: Meta pone el detalle util en error_user_msg o en
        # error_data, y recortarlo a 220 caracteres escondia justo eso.
        crudo = e.read().decode(errors="replace")
        try:
            err = json.loads(crudo).get("error", {})
            partes = [f"HTTP {e.code}", err.get("message", "")]
            for k in ("error_user_title", "error_user_msg", "error_subcode"):
                if err.get(k): partes.append(f"{k}: {err[k]}")
            if err.get("error_data"): partes.append(f"error_data: {json.dumps(err['error_data'])}")
            return False, "\n       ".join(str(x) for x in partes if x)
        except Exception:
            return False, f"HTTP {e.code} — {crudo[:600]}"
    except Exception as e:
        return False, f"{type(e).__name__}: {e}"


# -------------------------------------------------------------------- el token
print(f"""
  Conectar el pixel de Meta
  tienda: {TIENDA}
  pixel : {PIXEL}

  DONDE SACAR EL TOKEN
    business.facebook.com/events_manager
    -> elegi el pixel {PIXEL}
    -> pestania "Configuracion"
    -> abajo, "API de conversiones" > "Generar token de acceso"
    Empieza con EAA y es largo (200+ caracteres).

  No se ve nada al pegar: es a proposito. Pega y da Enter.
  Enter vacio = dejar el que ya hay.
""")

token = getpass.getpass("  token de Conversions API: ").strip().strip('"').strip("'")
guardar_token = None

if token:
    # Bruno pega de mas: medir forma y largo ANTES de preguntarle a Meta, para
    # que un "Meta lo rechazo" no se confunda con un pegado cortado.
    if re.search(r"\s", token):
        sys.exit("\n  El token tiene espacios: se pego cortado o de mas. Volve a correr el script.\n")
    if not re.fullmatch(r"[A-Za-z0-9_-]{20,600}", token):
        sys.exit("\n  El token tiene caracteres que no van. Copialo de nuevo entero.\n")
    print(f"\n  largo: {len(token)} caracteres{'' if token.startswith('EAA') else '  (OJO: no empieza con EAA)'}")

    # CODIGO DE PRUEBA: hace falta ANTES de validar, no despues.
    print("""
  CODIGO DE PRUEBA
    En el mismo conjunto, pestania "Probar eventos": sale algo tipo TEST12345.
    Con el puesto, el evento va SOLO a esa pestania y no cuenta como compra.
    Se usa para validar el token sin ensuciarte los datos.
""")
    codigo = input("  codigo de prueba: ").strip()
    if not re.fullmatch(r"[A-Za-z0-9]{4,40}", codigo or ""):
        sys.exit("\n  Hace falta el codigo para validar sin mandar un evento real.\n")

    # La validacion es MANDAR UN EVENTO, no leer el pixel.
    #
    # La primera version hacia GET /{pixel}?fields=id,name y Meta devolvia
    # "(#100) Missing Permission" con un token perfectamente bueno: un token de
    # Conversions API autoriza a ESCRIBIR eventos en el conjunto, no a LEER sus
    # metadatos. Son permisos distintos y la prueba estaba mirando el que no es.
    #
    # Mandar un TestEvent prueba exactamente la operacion que la app va a hacer
    # en produccion, y con test_event_code no toca los datos reales.
    print("  validando: mandando un evento de prueba al conjunto...")
    ok, dato = evento_prueba(token, codigo)
    if not ok:
        sys.exit(f"\n  Meta lo rechazo: {dato}\n"
                 "  Suele ser que el token se genero para otro conjunto de datos.\n")
    print(f"  OK  Meta recibio {dato.get('events_received', '?')} evento(s) de prueba")
    print(f"      miralo en 'Probar eventos' del conjunto {PIXEL}\n")
    guardar_token = cifrar(token)

    # El panel lee el gasto de las campanias con OTRO permiso (ads_read) y por
    # otra via (META_ADS_TOKEN del entorno, no la base). Si el mismo token lo
    # tiene, se aprovecha: un token en vez de dos.
    cuenta_guardada = supabase("GET", f"stores?slug=eq.{TIENDA}&select=meta_ad_account_id")
    act = (cuenta_guardada[0].get("meta_ad_account_id") if cuenta_guardada else None)
    if act:
        act = "act_" + re.sub(r"^act_", "", str(act))
        print(f"  probando si ademas puede leer la cuenta {act}...")
        ok2, dato2 = graph(f"{act}/campaigns", token, "id")
        if ok2:
            guardar_env("META_ADS_TOKEN", token)
            print("  OK  tambien lee las campanias: guardado como META_ADS_TOKEN en .env.local")
            print("      (hay que volver a desplegar para que el panel lo tome)\n")
        else:
            print(f"  --  no lee las campanias: {dato2}")
            print("      El token de Events Manager sirve solo para el pixel. Para que el panel")
            print("      muestre el gasto hace falta un token de Usuario del sistema con ads_read")
            print("      (business.facebook.com > Configuracion del negocio > Usuarios del sistema).")
            print("      No es urgente: sin el, el panel no muestra campanias pero todo lo demas anda.\n")
    del token


# ----------------------------------------------------- la cuenta publicitaria
print("""
  CUENTA PUBLICITARIA (lo que el panel pide como meta_ad_account_id)
    adsmanager.facebook.com -> arriba a la izquierda, el selector de cuenta.
    Debajo del nombre dice "ID de la cuenta publicitaria: 123456789012345".
    Tambien sale en la barra de direcciones como act=123456789012345.
    Pega solo los numeros, o con el act_ adelante: da igual.
""")
cuenta = input("  cuenta publicitaria (Enter para saltar): ").strip()
if cuenta:
    cuenta = re.sub(r"^act_", "", cuenta.replace(" ", ""))
    if not re.fullmatch(r"\d{6,24}", cuenta):
        sys.exit("\n  Eso no es un ID de cuenta publicitaria: son solo digitos.\n")
    cuenta = f"act_{cuenta}"

# ------------------------------------------------------------- guardar todo
tienda = supabase("GET", f"stores?slug=eq.{TIENDA}&select=id")
if not tienda: sys.exit(f"  no encuentro la tienda {TIENDA}")
store_id = tienda[0]["id"]

fila = {}
if guardar_token: fila["capi_token_enc"] = guardar_token
if codigo:        fila["test_event_code"] = codigo
if fila:
    r = supabase("PATCH", f"pixels?store_id=eq.{store_id}&pixel_id=eq.{PIXEL}", fila)
    if not r: sys.exit(f"\n  no encontre el pixel {PIXEL} en la tienda. Cargalo primero con upsert_pixel.\n")
    print("\n  OK  pixel actualizado: " + ", ".join(
        {"capi_token_enc": "token (cifrado)", "test_event_code": f"codigo de prueba {codigo}"}[k] for k in fila))

if cuenta:
    supabase("PATCH", f"stores?id=eq.{store_id}", {"meta_ad_account_id": cuenta})
    print(f"  OK  cuenta publicitaria: {cuenta}")

if not fila and not cuenta:
    print("\n  No cambiaste nada.\n"); sys.exit(0)

print("""
  Listo. Para comprobar que Meta recibe de verdad:
    MCP_BASE=https://pay.financestudylab.com/api/mcp python3 mcp.py call test_pixel '{"store":"financestudylab","pixel_id":"%s"}'
  Con el codigo de prueba puesto, el evento aparece en "Eventos de prueba".
  Cuando funcione, saca el codigo para que empiecen a contar de verdad:
    ... call upsert_pixel '{"store":"financestudylab","pixel_id":"%s","test_event_code":null}'
""" % (PIXEL, PIXEL))
