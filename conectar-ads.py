#!/usr/bin/env python3
"""Conecta el token de Meta Ads: el que deja LEER el gasto y CREAR anuncios.

Es otro token distinto al del pixel. El de Events Manager sirve para la API de
Conversiones y nada mas; para que el panel muestre campanias y para que se
puedan crear anuncios hace falta uno de USUARIO DEL SISTEMA con permisos sobre
la cuenta publicitaria.

El token se tipea a ciegas, se valida contra la cuenta de verdad y se guarda
CIFRADO en la base (app_settings -> meta_connection), que es de donde lo lee la
app. No va a una variable de entorno: no hace falta volver a desplegar. Y no
pasa por el chat.

  python3 conectar-ads.py
"""
import getpass, json, os, pathlib, re, subprocess, sys
import urllib.error, urllib.parse, urllib.request

RAIZ  = pathlib.Path(__file__).parent
GRAPH = "v21.0"
CLAVE = "meta_connection"          # la misma que usa src/lib/admin/meta-conn.ts


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
            return False, f"HTTP {e.code} — {err.get('message','')[:220]}"
        except Exception:
            return False, f"HTTP {e.code}"
    except Exception as e:
        return False, f"{type(e).__name__}: {e}"


# --------------------------------------------------------- la cuenta a validar
filas = supabase("GET", "stores?select=slug,meta_ad_account_id&meta_ad_account_id=not.is.null")
if not filas:
    sys.exit("\n  Ninguna tienda tiene cuenta publicitaria cargada. Cargala primero.\n")
ACT = "act_" + re.sub(r"^act_", "", str(filas[0]["meta_ad_account_id"]))

print(f"""
  Conectar Meta Ads
  cuenta a validar: {ACT}   ({filas[0]['slug']})

  DONDE SACAR ESTE TOKEN  (no es el del pixel)
    business.facebook.com  ->  Configuracion del negocio
    ->  Usuarios  ->  Usuarios del sistema  ->  Agregar
    ->  dale un nombre y rol Administrador
    ->  "Agregar activos"  ->  Cuentas publicitarias  ->  elegi la de arriba
        y prendé "Administrar campanias" (control total, no solo ver)
    ->  "Generar nuevo token"  ->  elegi tu app
        ->  marca  ads_management  y  ads_read
        ->  caducidad: Nunca
    Se muestra UNA sola vez.

  No se ve nada al pegar: es a proposito. Pega y da Enter.
""")

token = getpass.getpass("  token de Meta Ads: ").strip().strip('"').strip("'")
if not token:
    sys.exit("\n  No pegaste nada.\n")
if re.search(r"\s", token):
    sys.exit("\n  El token tiene espacios: se pego cortado o de mas. Volve a correr el script.\n")
if not re.fullmatch(r"[A-Za-z0-9_-]{20,600}", token):
    sys.exit("\n  El token tiene caracteres que no van. Copialo de nuevo entero.\n")
print(f"\n  largo: {len(token)} caracteres"
      f"{'' if token.startswith('EAA') else '   (OJO: no empieza con EAA)'}")

# ------------------------------------------------------------ 1. puede LEER
print(f"  1/3  leyendo la cuenta {ACT}...")
ok, dato = graph(ACT, token, "name,currency,timezone_name,account_status")
if not ok:
    sys.exit(f"\n  Meta lo rechazo: {dato}\n"
             "  Lo mas comun: al usuario del sistema no se le asigno ESTA cuenta publicitaria,\n"
             "  o se le asigno solo para ver. Revisa 'Agregar activos'.\n")
print(f"       OK  «{dato.get('name')}»  moneda {dato.get('currency')}  zona {dato.get('timezone_name')}")
if dato.get("account_status") != 1:
    print(f"       !   estado de la cuenta = {dato.get('account_status')} (1 = activa). Revisalo antes de pautar.")

# ----------------------------------------------- 2. puede ver las campanias
print("  2/3  listando campanias...")
ok2, d2 = graph(f"{ACT}/campaigns", token, "id,name,effective_status")
if not ok2:
    sys.exit(f"\n  Puede leer la cuenta pero no sus campanias: {d2}\n  Falta ads_read.\n")
camps = d2.get("data", [])
print(f"       OK  {len(camps)} campanias visibles")

# ------------------------------------------------- 3. tiene permiso de ESCRITURA
# debug_token devuelve los permisos del propio token. Es la unica forma de
# comprobar ads_management sin crear nada: probar escribiendo dejaria basura en
# la cuenta de un cliente, y eso no se hace para validar una llave.
print("  3/3  comprobando permisos de escritura...")
ok3, d3 = graph("debug_token", token)
escritura = None
if ok3:
    scopes = (d3.get("data") or {}).get("scopes") or []
    escritura = "ads_management" in scopes
    print(f"       permisos: {', '.join(scopes) if scopes else '(no los informa)'}")
if escritura is True:
    print("       OK  ads_management presente: se pueden crear anuncios")
elif escritura is False:
    print("       !   NO tiene ads_management: el panel va a mostrar el gasto,")
    print("           pero no se van a poder crear anuncios. Regeneralo marcandolo.")
else:
    print("       ?   Meta no informo los permisos. Se guarda igual; si al crear")
    print("           un anuncio da error de permisos, es esto.")

# ------------------------------------------------------------------ guardar
import datetime
actual = supabase("GET", f"app_settings?key=eq.{CLAVE}&select=value")
valor = (actual[0]["value"] if actual else {}) or {}
valor.update({"token_enc": cifrar(token),
              "label": f"usuario del sistema · {dato.get('name')}",
              "saved_at": datetime.datetime.now(datetime.timezone.utc).isoformat()})
supabase("POST", "app_settings",
         {"key": CLAVE, "value": valor,
          "updated_at": datetime.datetime.now(datetime.timezone.utc).isoformat()},
         prefer="return=representation,resolution=merge-duplicates")
del token

print(f"""
  Guardado cifrado en app_settings -> {CLAVE}.
  La app lo lee de ahi: NO hace falta volver a desplegar.

  Para comprobar que el panel ya ve la cuenta:
    Inicio -> Meta Ads  (o la seccion Ads de la oferta)
""")
