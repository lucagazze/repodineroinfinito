#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Guarda el secreto de firma CORRECTO del webhook de Physics.

POR QUE
  La mudanza a la empresa nueva guardo el secreto de la empresa VIEJA. Con el
  equivocado el pago entra, la firma se rechaza y no se entrega nada: el dinero
  cobrado, el comprador esperando y el panel sin mostrar la venta.

LO QUE REVISA
  Whop muestra el secreto recortado en la lista de webhooks: ws_2f690...3ae557bf.
  Este script comprueba que lo pegado empiece y termine asi ANTES de guardar.
  Es la defensa contra pegar de mas o de menos, que es lo que ya paso dos veces.

  Despues de guardar manda un evento FIRMADO de verdad al webhook en produccion.
  Es un tipo que la app no maneja: contesta "ignorado" y no toca ningun pedido.
  Si la firma no valida, avisa y hay que mirarlo.

  python3 arreglar-secreto-physics.py
"""
import base64, getpass, hashlib, hmac, json, os, pathlib, re, subprocess, sys, time
import urllib.error, urllib.request

RAIZ = pathlib.Path(__file__).parent
PHYSICS = "97879900-b4b5-4ae5-880a-32deb872967c"
WEBHOOK_URL = "https://pay.financestudylab.com/api/whop/webhook/physicsstudylab"
EMPIEZA, TERMINA = "ws_2f690", "3ae557bf"   # lo que Whop muestra en la lista

E = {}
for _l in (RAIZ / ".env.local").read_text().splitlines():
    if "=" in _l and not _l.startswith("#"):
        _k, _v = _l.split("=", 1)
        if _v.strip(): E[_k] = _v.strip()


def main():
    print(f"""
  El secreto del webhook de Physics, tal como lo muestra Whop:

      {EMPIEZA}...{TERMINA}

  Copialo con el boton de copiar de Whop y pegalo aca. Va oculto: no vas a
  ver nada en pantalla, es normal. Si lo pegas mal, este script NO guarda.
""")
    while True:
        bruto = getpass.getpass("  Secreto (ws_...): ")
        v = bruto.strip().strip('"').strip("'").strip()
        if len(v) != len(bruto):
            print(f"    pegaste {len(bruto)} caracteres, quedaron {len(v)} al limpiar")
        if not v:
            print("    vacio, probá de nuevo\n"); continue
        if not re.fullmatch(r"ws_[A-Za-z0-9_-]+", v):
            print(f"    no tiene forma de secreto de Whop ({len(v)} caracteres, "
                  f"empieza con «{v[:3]}»). Tiene que empezar con ws_\n"); continue
        if not v.startswith(EMPIEZA):
            print(f"    NO empieza con «{EMPIEZA}», sino con «{v[:len(EMPIEZA)]}».\n"
                  f"    Ese no es el secreto que Whop muestra para Physics.\n"); continue
        if not v.endswith(TERMINA):
            print(f"    empieza bien pero NO termina en «{TERMINA}», sino en «{v[-len(TERMINA):]}».\n"
                  f"    Se pego cortado o con algo de mas.\n"); continue
        print(f"    coincide con lo que muestra Whop, {len(v)} caracteres")
        break

    print("\n  Guardando...")
    tmp = RAIZ / ".secreto.mts"
    tmp.write_text(f'''
import {{ db }} from "{RAIZ}/src/lib/db.ts";
import {{ encrypt }} from "{RAIZ}/src/lib/secrets.ts";
const {{ error }} = await db.from("store_whop")
  .update({{ webhook_secret_enc: encrypt(process.env.S!) }})
  .eq("store_id", "{PHYSICS}");
if (error) {{ console.error(error.message); process.exit(1); }}
console.log("guardado");
''')
    out = subprocess.run(["npx", "tsx", str(tmp)], capture_output=True, text=True, cwd=RAIZ,
                         env={**os.environ, **E, "S": v})
    tmp.unlink(missing_ok=True)
    if out.returncode:
        sys.exit(f"\n  No se pudo guardar:\n{out.stderr[-500:]}\n")
    print("  guardado.")

    # LA PRUEBA QUE IMPORTA: un evento firmado contra el webhook en produccion.
    print("\n  Probando la firma de punta a punta contra produccion...")
    cuerpo = json.dumps({"action": "ping.secreto", "data": {}}, separators=(",", ":"))
    wid, wts = "msg_prueba_secreto", str(int(time.time()))
    firmado = f"{wid}.{wts}.{cuerpo}".encode()
    firmas = [base64.b64encode(hmac.new(v.encode(), firmado, hashlib.sha256).digest()).decode()]
    try:   # la otra derivacion que acepta la app
        firmas.append(base64.b64encode(
            hmac.new(base64.b64decode(v[3:] + "=="), firmado, hashlib.sha256).digest()).decode())
    except Exception:
        pass
    req = urllib.request.Request(WEBHOOK_URL, method="POST", data=cuerpo.encode(), headers={
        "content-type": "application/json", "webhook-id": wid, "webhook-timestamp": wts,
        "webhook-signature": " ".join(f"v1,{x}" for x in firmas)})
    try:
        r = urllib.request.urlopen(req, timeout=60)
        print(f"  FIRMA OK (HTTP {r.status}). El secreto guardado es el correcto:")
        print("  un pago cobrado ahora SI se entrega.\n")
    except urllib.error.HTTPError as e:
        d = e.read().decode()[:200]
        if e.code == 400:
            sys.exit(f"\n  LA FIRMA SIGUE FALLANDO ({d}).\n"
                     "  Quedo guardado lo que pegaste, pero no valida. Avisale a Claude\n"
                     "  antes de dejar correr ventas.\n")
        print(f"  (HTTP {e.code}: {d} -- no es la firma, pero revisalo)\n")

    print("  Decile a Claude «listo» y hace la comprobacion final.\n")


if __name__ == "__main__":
    main()
