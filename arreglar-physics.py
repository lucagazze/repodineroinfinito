#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Repara la mudanza de Physics a su empresa de Whop. Pide UN solo dato.

QUE PASO
  La mudanza guardo la conexion a biz_5GRmpHl7fEonbj, pero despues la API key
  se borro o se regenero en Whop: hoy devuelve 401. Con la llave muerta el
  checkout no cobra -- el comprador pone la tarjeta y no pasa nada.
  Ademas quedaron sin rehacer los 4 planes de los OTO.

QUE HACE, EN ORDEN
  1. Pide la API key NUEVA (oculta) y la prueba contra la cuenta ANTES de
     guardar. Si no sirve, no escribe nada.
  2. Comprueba que el webhook guardado siga existiendo y apunte a Physics.
  3. Si Whop devuelve el secreto de firma, lo compara con el guardado y dice
     COINCIDE / NO COINCIDE. Nunca lo imprime.
  4. Guarda solo la llave: el secreto y el id de webhook quedan como estan.
  5. Rehace los 4 planes de los OTO en la cuenta nueva.
  6. Archiva los 4 viejos en la cuenta de Finance.

  python3 arreglar-physics.py
"""
import getpass, json, os, pathlib, re, subprocess, sys, urllib.error, urllib.request

RAIZ = pathlib.Path(__file__).parent
PHYSICS = "97879900-b4b5-4ae5-880a-32deb872967c"
FINANCE = "3956652d-f154-4c6c-ab58-d122cc31f86c"
BIZ = "biz_5GRmpHl7fEonbj"

E = {}
for _l in (RAIZ / ".env.local").read_text().splitlines():
    if "=" in _l and not _l.startswith("#"):
        _k, _v = _l.split("=", 1)
        if _v.strip(): E[_k] = _v.strip()
H = {"apikey": E["SUPABASE_SERVICE_KEY"], "authorization": f"Bearer {E['SUPABASE_SERVICE_KEY']}",
     "content-type": "application/json"}


def sb(ruta, metodo="GET", cuerpo=None):
    req = urllib.request.Request(f"{E['SUPABASE_URL']}/rest/v1/{ruta}", method=metodo,
                                 headers={**H, "prefer": "return=representation"},
                                 data=json.dumps(cuerpo).encode() if cuerpo is not None else None)
    try:
        return json.load(urllib.request.urlopen(req, timeout=45))
    except urllib.error.HTTPError as e:
        return {"_error": e.code, "_body": e.read().decode()[:200]}


def whop(k, ruta, metodo="GET", cuerpo=None):
    req = urllib.request.Request("https://api.whop.com/api/v1" + ruta, method=metodo,
                                 headers={"authorization": f"Bearer {k}", "content-type": "application/json",
                                          "accept": "application/json"},
                                 data=json.dumps(cuerpo).encode() if cuerpo is not None else None)
    try:
        r = urllib.request.urlopen(req, timeout=60)
        return json.load(r)
    except urllib.error.HTTPError as e:
        return {"_error": e.code, "_body": e.read().decode()[:220]}


def descifrar(blob):
    js = (r'const {createDecipheriv,createHash}=require("crypto");const [v,iv,tag,body]=process.env.BLOB.split(".");'
          r'const key=createHash("sha256").update(process.env.SECRETS_KEY).digest();'
          r'const d=createDecipheriv("aes-256-gcm",key,Buffer.from(iv,"base64"));d.setAuthTag(Buffer.from(tag,"base64"));'
          r'process.stdout.write(Buffer.concat([d.update(Buffer.from(body,"base64")),d.final()]).toString("utf8"));')
    return subprocess.run(["node", "-e", js], capture_output=True, text=True,
                          env={**os.environ, "SECRETS_KEY": E["SECRETS_KEY"], "BLOB": blob}).stdout


def main():
    fila = sb(f"store_whop?select=company_id,webhook_id,webhook_secret_enc&store_id=eq.{PHYSICS}")
    if not fila or "_error" in fila:
        sys.exit("\n  No pude leer la conexion de Physics.\n")
    f = fila[0]
    print(f"\n  Physics apunta a {f['company_id']}, webhook {f['webhook_id']}.")
    if f["company_id"] != BIZ:
        sys.exit(f"\n  Esperaba {BIZ}. Pará y avisale a Claude.\n")
    if not f.get("webhook_secret_enc"):
        sys.exit("\n  No hay secreto de firma guardado. Hay que rehacer el webhook.\n")
    secreto = descifrar(f["webhook_secret_enc"])

    print("""
  Necesito una API key NUEVA de la empresa Physics, con acceso completo
  (o al menos: Payment, Plan, Product, Member, Membership y leer Webhooks).

  En Whop, con la empresa Physics seleccionada:
    Desarrollador -> API keys -> crear una -> copiarla con el boton de copiar.

  Se pega oculta: no vas a ver nada en pantalla, es normal.
""")
    while True:
        bruto = getpass.getpass("  API key: ")
        k = bruto.strip().strip('"').strip("'").strip()
        if len(k) != len(bruto):
            print(f"    pegaste {len(bruto)}, quedaron {len(k)} despues de limpiar espacios/comillas")
        if not k:
            print("    vacio, probá de nuevo\n"); continue
        if k.startswith("ws_"):
            print("    eso es el SECRETO del webhook, no la API key. No lo uso.\n"); continue
        if k.startswith("biz_"):
            print("    eso es el account id, no la API key.\n"); continue
        if len(k) < 20:
            print(f"    muy corta ({len(k)} caracteres): se pego incompleta.\n"); continue
        print(f"    {len(k)} caracteres")
        break

    # 1. La llave tiene que servir ANTES de tocar nada.
    #    Probar con /webhooks es lo mejor porque de paso deja revisar el
    #    webhook, pero el checkout NO necesita ese permiso: necesita cobrar y
    #    leer planes. Si lo unico que falta es ese, se sigue sin el, avisando.
    print("\n  Probando la llave contra la cuenta...")
    lista, sin_webhooks = [], False
    hooks = whop(k, f"/webhooks?account_id={BIZ}")
    if "_error" not in hooks:
        lista = hooks.get("data", hooks) if isinstance(hooks, dict) else hooks
    elif hooks["_error"] == 403 and "webhook" in str(hooks["_body"]).lower():
        sin_webhooks = True
        # Segunda prueba, con un permiso que el checkout SI usa.
        pl = whop(k, f"/plans?account_id={BIZ}&limit=1")
        if "_error" in pl:
            sys.exit(f"\n  NO sirve (HTTP {pl['_error']}): {pl['_body']}\n"
                     "  A la llave le falta el permiso de Plan, que el post-pago necesita.\n"
                     "  Editala en Whop y dale acceso completo.\n  No guarde nada.\n")
    else:
        c = hooks["_error"]
        pista = ("la llave no es valida: se pego incompleta, o se borro/regenero en Whop"
                 if c == 401 else hooks["_body"])
        sys.exit(f"\n  NO sirve (HTTP {c}): {pista}\n  {hooks['_body']}\n  No guarde nada.\n")
    emp = whop(k, f"/companies/{BIZ}")
    titulo = emp.get("title", "?") if isinstance(emp, dict) and "_error" not in emp else "(no legible)"
    print(f"  Llave OK para {BIZ}. Empresa «{titulo}».")

    # 2. El webhook guardado sigue ahi y es el de Physics.
    if sin_webhooks:
        print(f"  La llave no tiene el permiso developer:manage_webhook, asi que desde aca\n"
              f"  no puedo revisar el webhook {f['webhook_id']}. El checkout no lo necesita;\n"
              f"  la entrega se comprueba igual con una venta de prueba al final.")
    else:
        mio = next((h for h in lista if isinstance(h, dict) and h.get("id") == f["webhook_id"]), None)
        if not mio:
            print("\n  El webhook guardado YA NO EXISTE en esa cuenta. Los que hay:")
            for h in lista: print(f"    - {h.get('id')}  {h.get('url','')}")
            sys.exit("\n  Hay que rehacerlo y volver a conectar con su ws_. No guarde nada.\n")
        if "physicsstudylab" not in (mio.get("url") or ""):
            sys.exit(f"\n  El webhook guardado apunta a {mio.get('url')}, que no es Physics. No guarde nada.\n")
        print(f"  Webhook {mio['id']} OK -> {mio['url']}")

    # 3. Si Whop devuelve el secreto, se compara sin mostrarlo.
    detalle = {} if sin_webhooks else whop(k, f"/webhooks/{f['webhook_id']}")
    campo = next((c for c in ("secret", "signing_secret", "webhook_secret", "signature_secret")
                  if isinstance(detalle, dict) and detalle.get(c)), None)
    if campo:
        igual = str(detalle[campo]).strip() == secreto.strip()
        print(f"  Secreto de firma: {'COINCIDE con el guardado' if igual else 'NO COINCIDE -- hay que rehacer el webhook'}")
        if not igual:
            sys.exit("\n  Pará: el secreto guardado es el equivocado. Cada pago se rechazaria\n"
                     "  en silencio. Borra el webhook en Whop, crealo de nuevo, copiá el ws_\n"
                     "  y avisale a Claude. No guarde nada.\n")
    else:
        print("  Secreto de firma: Whop no lo devuelve por API; se comprueba con un evento real.")

    print(f"""
  Voy a:
    1. guardar la llave nueva (el secreto y el webhook quedan como estan)
    2. rehacer los 4 planes de los OTO en {BIZ}
    3. archivar los 4 viejos en la cuenta de Finance
""")
    if input("  Escribi SI para seguir: ").strip().upper() != "SI":
        sys.exit("  Cancelado. No se cambio nada.\n")

    # 4. Guardar solo la llave, con el mismo codigo que usa la app.
    tmp = RAIZ / ".arreglar.mts"
    tmp.write_text(f'''
import {{ connectWhop }} from "{RAIZ}/src/lib/whop-connect.ts";
console.log(JSON.stringify(await connectWhop("{PHYSICS}", process.env.K!, "{BIZ}", process.env.S!, process.env.Hk!)));
''')
    out = subprocess.run(["npx", "tsx", str(tmp)], capture_output=True, text=True, cwd=RAIZ,
                         env={**os.environ, **E, "K": k, "S": secreto, "Hk": f["webhook_id"]})
    tmp.unlink(missing_ok=True)
    if out.returncode:
        sys.exit(f"\n  No se pudo guardar:\n{out.stderr[-500:]}\n")
    print("\n  llave guardada: el checkout vuelve a cobrar.")

    # 5. Los planes de los OTO.
    prods = sb(f"products?select=id,slug,short_name,whop_plan_id,product_prices(currency,amount)"
               f"&store_id=eq.{PHYSICS}&whop_plan_id=not.is.null")
    pl = whop(k, f"/plans?account_id={BIZ}&limit=1")
    plista = [] if (isinstance(pl, dict) and "_error" in pl) else (
        pl.get("data", pl) if isinstance(pl, dict) else pl)
    if not isinstance(plista, list):
        plista = []
    prod_whop = (plista[0]["product"]["id"] if plista and isinstance(plista[0], dict)
                 and isinstance(plista[0].get("product"), dict) else None)
    if not prod_whop:
        print("  La cuenta no tiene productos todavia. Creo uno para colgar los planes...")
        # El campo es "title". Con "name" Whop contesta 400 "Title can't be blank",
        # y /access_passes no existe en la v1 (404).
        for ruta, cuerpo in (("/products", {"account_id": BIZ, "title": "Physics Study Lab", "visibility": "hidden"}),):
            r = whop(k, ruta, "POST", cuerpo)
            if "_error" not in r and r.get("id"):
                prod_whop = r["id"]; print(f"    producto creado: {prod_whop}"); break
            print(f"    {ruta}: HTTP {r.get('_error')} {str(r.get('_body',''))[:90]}")
    if not prod_whop:
        print("""
  No pude crear el producto por API, asi que los planes quedan sin rehacer.
  El checkout principal SI cobra; lo que no funciona es el post-pago.

  Entra a Whop (empresa Physics) -> Productos -> crea uno cualquiera, y volve
  a correr este script.
""")
        return

    viejos = []
    for p in prods:
        usd = next((float(x["amount"]) for x in p["product_prices"] if x["currency"] == "USD"), None)
        if usd is None:
            print(f"    {p['slug']}: sin precio en USD, lo salteo."); continue
        nuevo = whop(k, "/plans", "POST", {
            "product_id": prod_whop, "plan_type": "one_time", "release_method": "buy_now",
            "currency": "usd", "initial_price": usd, "visibility": "hidden",
            "unlimited_stock": True, "description": p["short_name"],
            "metadata": {"tienda": "physicsstudylab", "producto": p["slug"]},
        })
        if "_error" in nuevo:
            print(f"    {p['slug']}: NO se pudo crear ({nuevo['_error']} {str(nuevo['_body'])[:70]}). Queda el viejo.")
            continue
        viejos.append(p["whop_plan_id"])
        sb(f"products?id=eq.{p['id']}", "PATCH", {"whop_plan_id": nuevo["id"]})
        print(f"    {p['slug']:26} {p['whop_plan_id']} -> {nuevo['id']}")

    # 6. Archivar los viejos en la cuenta de Finance.
    if viejos:
        ff = sb(f"store_whop?select=api_key_enc&store_id=eq.{FINANCE}")
        if ff and "_error" not in ff:
            kf = descifrar(ff[0]["api_key_enc"])
            for pid in viejos:
                r = whop(kf, f"/plans/{pid}", "PATCH", {"visibility": "archived"})
                print(f"    archivado en la cuenta vieja: {pid}  {'ok' if '_error' not in r else r['_error']}")

    print("\n  Listo. Avisale a Claude: queda comprobar la entrega y el panel.\n")


if __name__ == "__main__":
    main()
