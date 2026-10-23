#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Conecta Physics Study Lab a Whop. Pide UN solo dato: el secreto del webhook.

POR QUE NO PIDE LA API KEY
  Physics esta bajo la MISMA cuenta de Whop que Finance (biz_nFCs9HXHHv3PLw),
  y la llave de esa cuenta ya esta guardada y cifrada, y ya se probo contra
  Whop. Volver a pedirla solo agrega el riesgo de pegarla mal -- que es
  exactamente lo que fallo el intento anterior. La llave se lee de la base, se
  descifra en memoria y nunca se muestra.

  Si algun dia Physics pasa a otra cuenta de Whop, hay que volver a pedirla.

LO QUE REVISA ANTES DE GUARDAR
  1. Que la llave guardada siga sirviendo contra Whop.
  2. Que exista un webhook apuntando a la tienda de Physics, y toma su id.
  3. La forma del secreto (ws_...), y mide lo pegado por si vino de mas.
  4. Recien entonces guarda. Antes no escribe nada.

EL SECRETO
  Whop lo muestra UNA SOLA VEZ. Sin el, cada pago cobrado se rechaza y no se
  entrega nada -- y no falla de forma visible: el dinero entra, el comprador
  espera, y el panel no muestra la venta.

  python3 conectar-whop-physics.py
"""
import getpass, json, os, pathlib, re, subprocess, sys, urllib.error, urllib.request

RAIZ = pathlib.Path(__file__).parent
PHYSICS = "97879900-b4b5-4ae5-880a-32deb872967c"
FINANCE = "3956652d-f154-4c6c-ab58-d122cc31f86c"
WEBHOOK_URL = "https://pay.financestudylab.com/api/whop/webhook/physicsstudylab"

E = {}
for _l in (RAIZ / ".env.local").read_text().splitlines():
    if "=" in _l and not _l.startswith("#"):
        _k, _v = _l.split("=", 1)
        if _v.strip(): E[_k] = _v.strip()
H = {"apikey": E["SUPABASE_SERVICE_KEY"], "authorization": f"Bearer {E['SUPABASE_SERVICE_KEY']}",
     "content-type": "application/json"}


def supabase(ruta):
    return json.load(urllib.request.urlopen(urllib.request.Request(
        f"{E['SUPABASE_URL']}/rest/v1/{ruta}", headers=H), timeout=45))


def llave_de_finance():
    """La llave ya guardada, descifrada en memoria. Nunca se imprime."""
    fila = supabase(f"store_whop?select=api_key_enc,company_id&store_id=eq.{FINANCE}")
    if not fila:
        sys.exit("\n  Finance no tiene Whop conectado: no hay llave que reusar.\n")
    js = (r'const {createDecipheriv,createHash}=require("crypto");'
          r'const [v,iv,tag,body]=process.env.BLOB.split(".");'
          r'const key=createHash("sha256").update(process.env.SECRETS_KEY).digest();'
          r'const d=createDecipheriv("aes-256-gcm",key,Buffer.from(iv,"base64"));'
          r'd.setAuthTag(Buffer.from(tag,"base64"));'
          r'process.stdout.write(Buffer.concat([d.update(Buffer.from(body,"base64")),d.final()]).toString("utf8"));')
    r = subprocess.run(["node", "-e", js], capture_output=True, text=True,
                       env={**os.environ, "SECRETS_KEY": E["SECRETS_KEY"], "BLOB": fila[0]["api_key_enc"]})
    if r.returncode or not r.stdout:
        sys.exit("\n  No pude descifrar la llave guardada.\n")
    return r.stdout, fila[0]["company_id"]


def main():
    ya = supabase(f"store_whop?select=webhook_secret_enc&store_id=eq.{PHYSICS}")
    if ya and ya[0].get("webhook_secret_enc"):
        print("\n  Physics YA esta conectado con su secreto. No toco nada.\n")
        return

    print("\n  Conectar Physics Study Lab a Whop.\n")
    api_key, biz = llave_de_finance()
    print(f"  Uso la llave ya guardada de la cuenta {biz} (no hace falta pegarla).")

    # 1. ¿La llave sigue sirviendo?
    try:
        r = urllib.request.urlopen(urllib.request.Request(
            f"https://api.whop.com/api/v1/webhooks?account_id={biz}",
            headers={"authorization": f"Bearer {api_key}", "accept": "application/json"}), timeout=60)
        datos = json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f"\n  La llave guardada ya no sirve (HTTP {e.code}). Hay que reconectar Finance primero.\n")
    hooks = datos.get("data", datos) if isinstance(datos, dict) else datos
    print(f"  Llave OK. La cuenta tiene {len(hooks)} webhook(s).")

    # 2. ¿Cual es el de Physics?
    mio = next((h for h in hooks if isinstance(h, dict)
                and ("physicsstudylab" in h.get("url", "") or PHYSICS in h.get("url", ""))), None)
    if not mio:
        print("\n  No encuentro ningun webhook que apunte a Physics. Los que hay:")
        for h in hooks: print(f"    - {h.get('url','')}")
        sys.exit(f"\n  Crealo en Whop apuntando a:\n    {WEBHOOK_URL}\n  y volve a correr esto.\n")
    print(f"  Webhook de Physics encontrado: {mio.get('id')}")
    print(f"    {mio.get('url')}")

    # 3. El unico dato que falta.
    print("""
  Falta el secreto de firma de ESE webhook (ws_...).
  Se escribe oculto: no se ve nada al pegarlo, es normal.
""")
    while True:
        bruto = getpass.getpass("  Secreto (ws_...): ")
        v = bruto.strip().strip('"').strip("'").strip()
        if len(v) != len(bruto):
            print(f"    pegaste {len(bruto)} caracteres, quedaron {len(v)} despues de limpiar")
        if not v:
            print("    vacio, probá de nuevo\n"); continue
        if not re.fullmatch(r"ws_[A-Za-z0-9_-]+", v):
            print(f"    no tiene la forma de un secreto de Whop ({len(v)} caracteres, empieza con "
                  f"«{v[:3]}»). Tiene que empezar con ws_\n"); continue
        print(f"    forma correcta, {len(v)} caracteres")
        break

    # 4. Guardar, con el mismo codigo que usa la app.
    print("\n  Guardando...")
    tmp = RAIZ / ".conectar.mts"
    tmp.write_text(f'''
import {{ connectWhop }} from "{RAIZ}/src/lib/whop-connect.ts";
const r = await connectWhop("{PHYSICS}", process.env.K!, process.env.C!, process.env.S!, process.env.Hk!);
console.log(JSON.stringify(r));
''')
    out = subprocess.run(["npx", "tsx", str(tmp)], capture_output=True, text=True, cwd=RAIZ,
                         env={**os.environ, **E, "K": api_key, "C": biz, "S": v, "Hk": mio.get("id") or ""})
    tmp.unlink(missing_ok=True)
    if out.returncode:
        sys.exit(f"\n  No se pudo guardar:\n{out.stderr[-600:]}\n")
    print(f"  {out.stdout.strip()[:200]}")

    # 5. LA PRUEBA QUE IMPORTA.
    #    connectWhop valida la LLAVE, no el secreto: un ws_ mal pegado se
    #    guardaria igual y recien fallaria con la primera venta, en silencio
    #    -- el dinero entra, el comprador espera, el panel no muestra nada.
    #    Asi que se manda un evento firmado de verdad al webhook. Es un tipo
    #    que la app no maneja: contesta «ignorado» y no toca ningun pedido.
    print("\n  Probando la firma de punta a punta...")
    import hashlib, hmac, time, base64
    cuerpo = json.dumps({"action": "ping.conexion", "data": {}}, separators=(",", ":"))
    wid, wts = "msg_prueba_conexion", str(int(time.time()))
    firmado = f"{wid}.{wts}.{cuerpo}".encode()
    firmas = [base64.b64encode(hmac.new(v.encode(), firmado, hashlib.sha256).digest()).decode()]
    try:  # la otra derivacion que acepta la app
        firmas.append(base64.b64encode(hmac.new(base64.b64decode(v[3:] + "=="), firmado, hashlib.sha256).digest()).decode())
    except Exception:
        pass
    req = urllib.request.Request(WEBHOOK_URL, method="POST", data=cuerpo.encode(), headers={
        "content-type": "application/json", "webhook-id": wid, "webhook-timestamp": wts,
        "webhook-signature": " ".join(f"v1,{f}" for f in firmas)})
    try:
        resp = urllib.request.urlopen(req, timeout=60)
        print(f"  FIRMA OK: el webhook acepto el evento (HTTP {resp.status}). El secreto es el correcto.\n")
    except urllib.error.HTTPError as e:
        cuerpo_err = e.read().decode()[:160]
        if e.code == 400:
            sys.exit(f"\n  EL SECRETO NO SIRVE: el webhook rechazo la firma ({cuerpo_err}).\n"
                     "  Quedo guardado pero NO funcionaria: cada pago se rechazaria en silencio.\n"
                     "  Borra el webhook en Whop, crealo de nuevo y volve a correr esto.\n")
        print(f"  (respondio HTTP {e.code}: {cuerpo_err} — no es la firma, pero revisalo)\n")

    print("  Listo. Decile a Claude «ya esta» y sigue con los checkout_host y las pruebas.\n")


if __name__ == "__main__":
    main()
