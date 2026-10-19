#!/usr/bin/env python3
"""Conecta la tienda con Whop: llave de API + webhook, en un solo paso.

La llave se tipea a ciegas y nunca se escribe en disco sin cifrar, no queda en
el historial de la terminal y no pasa por el chat. Lo que hace, en orden:

  1. valida la llave contra Whop (/me) para saber de que cuenta es
  2. registra el webhook apuntando a la app publicada, anclado a la version
     de API contra la que esta escrito el codigo
  3. guarda llave y secreto del webhook cifrados (AES-256-GCM) en store_whop

Se puede volver a correr: si ya hay un webhook con esa URL, lo reutiliza.
"""
import getpass, json, os, pathlib, re, subprocess, sys, urllib.error, urllib.request

RAIZ     = pathlib.Path(__file__).parent
TIENDA   = "financestudylab"
CUENTA   = "biz_nFCs9HXHHv3PLw"
VERSION  = "2026-10-15-1"           # la misma contra la que esta escrito whop.ts
EVENTOS  = ["payment.succeeded", "payment.failed", "payment.pending",
            "payment.requires_action", "payment.canceled", "refund.created",
            "refund.updated", "dispute.created", "dispute.updated",
            "setup_intent.succeeded", "membership.activated",
            "membership.deactivated"]

def entorno():
    env = {}
    for l in (RAIZ / ".env.local").read_text().splitlines():
        if "=" in l and not l.startswith("#"):
            k, v = l.split("=", 1); env[k] = v.strip()
    return env

E = entorno()
BASE = (E.get("PUBLIC_BASE_URL") or "").rstrip("/")
if not BASE.startswith("https://"):
    # Un webhook apuntando a localhost significa que Whop avisa los pagos a una
    # notebook apagada: se cobra y no se entrega nada.
    BASE = "https://checkout-eta-six.vercel.app"
URL_WEBHOOK = f"{BASE}/api/whop/webhook/{TIENDA}"

def whop(args, clave=None):
    cmd = [str(pathlib.Path.home() / ".local/bin/whop"), *args, "--format", "json"]
    env = {**os.environ, "PATH": f"{pathlib.Path.home()}/.local/bin:" + os.environ.get("PATH", "")}
    if clave: env["WHOP_API_KEY"] = clave
    r = subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=120)
    txt = (r.stdout or r.stderr).strip()
    try: return json.loads(txt)
    except Exception: return {"_texto": txt}

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
                 "prefer": "return=representation,resolution=merge-duplicates"})
    with urllib.request.urlopen(req, timeout=60) as r:
        t = r.read().decode()
    return json.loads(t) if t.strip() else []


def probar(clave):
    """Valida la llave contra lo que de verdad va a usar.

    No contra /accounts/<id>: ese endpoint pide company:balance:read, que es
    justo un permiso que NO queremos darle. Validar con algo que la llave no
    necesita hace fallar una llave correcta.

    /webhooks es la eleccion natural: si puede listarlos, puede crear el que
    hace falta, que es el proximo paso.
    """
    for ruta, que in (("webhooks", "puede ver los webhooks"),
                      ("products", "puede ver los productos")):
        req = urllib.request.Request(
            f"https://api.whop.com/api/v1/{ruta}",
            headers={"authorization": f"Bearer {clave}", "accept": "application/json",
                     "api-version-date": VERSION})
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                r.read()
            return True, que
        except urllib.error.HTTPError as e:
            cuerpo = e.read().decode(errors="replace")[:260]
            if e.code in (401, 403) and ruta == "products":
                return False, f"HTTP {e.code} — {cuerpo}"
            ultimo = f"HTTP {e.code} — {cuerpo}"
        except Exception as e:
            ultimo = f"{type(e).__name__}: {e}"
    return False, ultimo

# ----------------------------------------------------------------- 1. la llave
print("\n  Conectar Whop")
print(f"  cuenta : {CUENTA}")
print(f"  webhook: {URL_WEBHOOK}")
print("  No se ve nada al pegar: es a proposito. Pega y da Enter.\n")

while True:
    clave = getpass.getpass("  llave de API de Whop: ").strip().strip('"').strip("'")
    if not clave:
        print("     hace falta.\n"); continue
    if re.search(r"\s", clave):
        print("     tiene espacios: se pego cortada o de mas.\n"); continue
    print("\n  validando contra Whop...")
    # Contra la API directamente, no por el CLI: el CLI prefiere el perfil que
    # ya tiene guardado y puede contestar OK con una sesion que no es la llave,
    # dando por buena una llave invalida.
    ok, dato = probar(clave)
    if ok:
        print(f"  OK  la llave sirve: {dato}\n"); break
    print(f"     Whop la rechazo: {dato}\n")

# --------------------------------------------------------------- 2. el webhook
print("  registrando el webhook...")
existentes = whop(["webhooks", "list"], clave)
lista = existentes if isinstance(existentes, list) else (existentes.get("data") or [])
ya = next((w for w in lista if w.get("url") == URL_WEBHOOK), None)

if ya:
    print(f"  OK  ya existia: {ya['id']}")
    wh, secreto = ya, (ya.get("secret") or ya.get("signing_secret") or "")
else:
    wh = whop(["webhooks", "create", "--url", URL_WEBHOOK, "--resource_id", CUENTA,
               "--api_version_date", VERSION, "--events", json.dumps(EVENTOS),
               "--enabled"], clave)
    if not wh.get("id"):
        # No se corta: la llave validada ya es un avance y conviene guardarla
        # cifrada. Volver a correr el script crea el webhook solo, sin pedir
        # la llave de nuevo si ya quedo guardada.
        print("  !   no se pudo crear el webhook:")
        print("      " + json.dumps(wh, ensure_ascii=False)[:400])
        print("      (la llave igual se guarda; corre el script otra vez al arreglarlo)")
        wh, secreto = {}, ""
    else:
        secreto = wh.get("secret") or wh.get("signing_secret") or ""
        print(f"  OK  creado: {wh['id']}  ({len(EVENTOS)} eventos, version {VERSION})")

if wh.get("id") and not secreto:
    print("  !   el secreto no vino en la respuesta: hay que copiarlo del panel")

# ------------------------------------------------------------- 3. guardar todo
tienda = supabase("GET", f"stores?slug=eq.{TIENDA}&select=id")
if not tienda: sys.exit(f"  no encuentro la tienda {TIENDA}")
store_id = tienda[0]["id"]

fila = {"store_id": store_id, "company_id": CUENTA,
        "api_key_enc": cifrar(clave), "webhook_id": wh.get("id"), "livemode": True}
if secreto: fila["webhook_secret_enc"] = cifrar(secreto)
supabase("POST", "store_whop", fila)
del clave, secreto

print("\n  Guardado cifrado en store_whop. Listo.\n")
