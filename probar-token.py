#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Mira un token de Meta y dice que puede hacer. NO GUARDA NADA.

POR QUE EXISTE APARTE DE conectar-ads.py
  conectar-ads.py valida y GUARDA: reemplaza el token con el que hoy funcionan
  el panel y las 13 tareas programadas. Y valida ads_management, pero NO
  business_management -- que es justo el permiso por el que uno cambiaria de
  token. O sea que se puede cambiar un token que anda por otro que anda menos,
  y enterarse despues.

  Esto prueba primero. Pega el token, te dice que permisos trae y a que llega,
  y se olvida: no escribe en la base ni en ningun archivo.

  python3 probar-token.py
"""
import getpass, json, os, pathlib, re, subprocess, sys
import urllib.error, urllib.parse, urllib.request

RAIZ = pathlib.Path(__file__).parent
GRAPH = "v21.0"

E = {}
for l in (RAIZ / ".env.local").read_text().splitlines():
    if "=" in l and not l.startswith("#"):
        k, v = l.split("=", 1); E[k] = v.strip()


def graph(ruta, token, campos=None, extra=None):
    q = {"access_token": token}
    if campos: q["fields"] = campos
    if extra: q.update(extra)
    try:
        with urllib.request.urlopen(f"https://graph.facebook.com/{GRAPH}/{ruta}?" + urllib.parse.urlencode(q), timeout=45) as r:
            return True, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try: return False, json.loads(e.read().decode()).get("error", {}).get("message", "")[:150]
        except Exception: return False, f"HTTP {e.code}"
    except Exception as ex:
        return False, f"{type(ex).__name__}: {ex}"


def guardado():
    """El token que esta puesto hoy, para comparar. Se descifra en memoria y no se imprime."""
    import urllib.request as u
    rq = u.Request(f"{E['SUPABASE_URL']}/rest/v1/app_settings?key=eq.meta_connection&select=value",
                   headers={"apikey": E["SUPABASE_SERVICE_KEY"], "authorization": f"Bearer {E['SUPABASE_SERVICE_KEY']}"})
    with u.urlopen(rq, timeout=40) as r:
        filas = json.loads(r.read().decode())
    if not filas: return None
    js = r'''
const {createDecipheriv,createHash}=require("crypto");
const [v,iv,tag,body]=process.env.BLOB.split(".");
const key=createHash("sha256").update(process.env.SECRETS_KEY).digest();
const d=createDecipheriv("aes-256-gcm",key,Buffer.from(iv,"base64"));
d.setAuthTag(Buffer.from(tag,"base64"));
process.stdout.write(Buffer.concat([d.update(Buffer.from(body,"base64")),d.final()]).toString("utf8"));
'''
    r2 = subprocess.run(["node", "-e", js], capture_output=True, text=True,
                        env={**os.environ, "SECRETS_KEY": E["SECRETS_KEY"],
                             "BLOB": filas[0]["value"]["token_enc"]})
    return r2.stdout or None


def radiografia(token, etiqueta):
    print(f"\n  ── {etiqueta}")
    # debug_token necesita input_token Y access_token: con uno solo falla y
    # parece que el token no tuviera permisos.
    ok, d = graph("debug_token", token, extra={"input_token": token})
    scopes = []
    if ok:
        dd = d.get("data") or {}
        scopes = sorted(dd.get("scopes") or [])
        exp = dd.get("expires_at")
        print(f"     app         {dd.get('application','?')}")
        print(f"     tipo        {dd.get('type','?')}")
        print(f"     caduca      {'NUNCA' if not exp else exp}")
        print(f"     permisos    {', '.join(scopes) or '(no informa)'}")
    else:
        print(f"     no pude leer sus permisos: {d}")

    # HASTA DONDE LLEGA. Un token de usuario del sistema no esta acotado a una
    # cuenta: alcanza TODO lo que se le asigno a ese usuario. Si el token toca
    # dos negocios, una filtracion toca los dos. Conviene verlo antes de
    # guardarlo, no despues.
    print("\n     hasta donde llega:")
    ok, yo = graph("me", token, "id,name")
    if ok: print(f"       usuario     {yo.get('name','?')}  ({yo.get('id','?')})")
    for ruta, campos, et in (("me/businesses", "id,name", "negocios"),
                             ("me/adaccounts", "id,name,account_status", "cuentas publicitarias")):
        okx, dx = graph(ruta, token, campos)
        if not okx:
            print(f"       {et:<11} no pude leerlas: {dx}")
            continue
        filas = dx.get("data", [])
        print(f"       {et:<11} {len(filas)}")
        for x in filas[:12]:
            marca = "  <- la de Physics/Finance" if x.get("id", "").endswith("4624146111239384") else ""
            print(f"                     {x.get('name','?')[:44]}  {x.get('id','')}{marca}")
        if len(filas) > 12: print(f"                     … y {len(filas)-12} mas")

    ACT = "act_4624146111239384"
    pruebas = [
        ("leer la cuenta publicitaria", lambda: graph(ACT, token, "name,currency,account_status")),
        ("leer campanas",               lambda: graph(f"{ACT}/campaigns", token, "id,name")),
        ("leer el pixel",               lambda: graph(f"{ACT}/adspixels", token, "id,name")),
        ("ver publicos",                lambda: graph(f"{ACT}/customaudiences", token, "id,name")),
        ("leer el negocio (paso 4)",    lambda: graph(ACT, token, "business")),
    ]
    print()
    biz = None
    for et, f in pruebas:
        ok2, d2 = f()
        print(f"     {'OK  ' if ok2 else 'NO  '} {et:<30} {'' if ok2 else d2}")
        if et.startswith("leer el negocio") and ok2:
            biz = (d2.get("business") or {}).get("id")
    if biz:
        for et, ruta, campos in (("leer la pagina (paso 3)", f"{biz}/owned_pages", "id,name"),
                                 ("leer el Instagram (paso 2)", f"{biz}/instagram_accounts", "id,username")):
            ok3, d3 = graph(ruta, token, campos)
            n = len(d3.get("data", [])) if ok3 else 0
            print(f"     {'OK  ' if ok3 and n else 'NO  '} {et:<30} {(str(n)+' encontrada(s)') if ok3 else d3}")
    else:
        print(f"     --   la pagina y el Instagram no se pueden comprobar sin business_management")
    return set(scopes)


print("""
  Probar un token de Meta  ·  NO guarda nada

  Se tipea a ciegas: pega y da Enter. Para salir, Enter vacio.
""")
tok = getpass.getpass("  token a probar: ").strip().strip('"').strip("'")
if not tok:
    sys.exit("\n  No pegaste nada. No se toco nada.\n")
if re.search(r"\s", tok):
    sys.exit("\n  Tiene espacios: se pego cortado o de mas. Corre el script de nuevo.\n")
if not re.fullmatch(r"[A-Za-z0-9_-]{20,600}", tok):
    sys.exit("\n  Tiene caracteres que no van. Copialo entero de nuevo.\n")
print(f"  largo: {len(tok)} caracteres{'' if tok.startswith('EAA') else '   (OJO: no empieza con EAA)'}")

nuevos = radiografia(tok, "EL TOKEN QUE PEGASTE")
viejo = guardado()
actuales = radiografia(viejo, "EL QUE ESTA PUESTO HOY") if viejo else set()

print("\n  ── VEREDICTO")
if not viejo:
    print("     No hay token guardado: cargalo con  python3 conectar-ads.py")
else:
    pierde = actuales - nuevos
    gana = nuevos - actuales
    if gana: print(f"     GANA:   {', '.join(sorted(gana))}")
    if pierde: print(f"     PIERDE: {', '.join(sorted(pierde))}")
    if not gana and not pierde: print("     Trae exactamente los mismos permisos: cambiarlo no suma nada.")
    if "business_management" in gana and not pierde:
        print("\n     Conviene cambiarlo:  python3 conectar-ads.py")
    elif pierde:
        print("\n     NO lo cargues: perderias permisos que hoy funcionan.")
    else:
        print("\n     Cambiarlo no resuelve el paso 4. Hace falta un token nuevo con business_management.")
print()
