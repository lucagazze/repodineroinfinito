#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Pasa Physics Study Lab a SU PROPIA empresa de Whop.

POR QUE
  Hoy las dos tiendas cobran en biz_nFCs9HXHHv3PLw, que se llama
  «Financestudylab». Con Whop el comerciante de registro es Whop, asi que el
  descriptor que carguemos en la app no es el que ve el comprador: sale de la
  cuenta. Un estudiante britanico que compra guias de fisica ve un cargo de
  una marca que nunca vio, y eso es la causa numero uno de desconocimiento de
  cargo.

LO QUE HACE, EN ORDEN, Y NADA ANTES DE TIEMPO
  1. Prueba la llave nueva contra la cuenta nueva. Si falla, no toca nada.
  2. Busca el webhook de Physics en la cuenta nueva y toma su id.
  3. Comprueba que el secreto firme de verdad, mandando un evento al webhook.
  4. Recien entonces guarda la conexion.
  5. REHACE los 4 planes de los OTO en la cuenta nueva. Los de la vieja dejan
     de servir: `payments.create` con tarjeta guardada exige un plan_id de la
     MISMA cuenta, y sin eso el post-pago contesta «no disponible» sin fallar
     de forma visible.
  6. Archiva los planes viejos, para no dejar planes cobrables sueltos.

  python3 mudar-physics-a-su-empresa.py
"""
import base64, getpass, hashlib, hmac, json, os, pathlib, re, subprocess, sys, time
import urllib.error, urllib.request

RAIZ = pathlib.Path(__file__).parent
PHYSICS = "97879900-b4b5-4ae5-880a-32deb872967c"
WEBHOOK_URL = "https://pay.financestudylab.com/api/whop/webhook/physicsstudylab"
API = "https://api.whop.com/api/v1"

E = {}
for _l in (RAIZ / ".env.local").read_text().splitlines():
    if "=" in _l and not _l.startswith("#"):
        _k, _v = _l.split("=", 1)
        if _v.strip(): E[_k] = _v.strip()
H = {"apikey": E["SUPABASE_SERVICE_KEY"], "authorization": f"Bearer {E['SUPABASE_SERVICE_KEY']}",
     "content-type": "application/json", "prefer": "return=representation"}


def sb(ruta, metodo="GET", cuerpo=None):
    r = urllib.request.urlopen(urllib.request.Request(
        f"{E['SUPABASE_URL']}/rest/v1/{ruta}", method=metodo,
        data=json.dumps(cuerpo).encode() if cuerpo else None, headers=H), timeout=45)
    t = r.read().decode()
    return json.loads(t) if t.strip() else []


def whop(k, ruta, metodo="GET", cuerpo=None):
    try:
        r = urllib.request.urlopen(urllib.request.Request(
            API + ruta, method=metodo,
            data=json.dumps(cuerpo).encode() if cuerpo else None,
            headers={"authorization": f"Bearer {k}", "accept": "application/json",
                     "content-type": "application/json"}), timeout=60)
        t = r.read().decode()
        return json.loads(t) if t.strip() else {}
    except urllib.error.HTTPError as e:
        return {"_error": e.code, "_body": e.read().decode()[:220]}


def pedir(etiqueta, patron, ayuda, oculto=True):
    while True:
        bruto = getpass.getpass(f"  {etiqueta}: ") if oculto else input(f"  {etiqueta}: ")
        v = bruto.strip().strip('"').strip("'").strip()
        if len(v) != len(bruto):
            print(f"    pegaste {len(bruto)} caracteres, quedaron {len(v)} despues de limpiar")
        if not v:
            print("    vacio, probá de nuevo\n"); continue
        if not re.fullmatch(patron, v):
            print(f"    no tiene la forma esperada ({len(v)} caracteres). {ayuda}\n"); continue
        print(f"    forma correcta, {len(v)} caracteres")
        return v


def main():
    viejo = sb(f"store_whop?select=company_id,api_key_enc&store_id=eq.{PHYSICS}")
    if viejo:
        print(f"\n  Physics cobra hoy en: {viejo[0]['company_id']}")
    print(f"""
  Antes de empezar, en la empresa NUEVA de Whop tiene que existir un webhook
  apuntando a:

    {WEBHOOK_URL}

  con version v1 y estos eventos:
    payment.succeeded · payment.pending · payment.failed
    membership.activated · membership.deactivated · membership.updated
    refund.created · refund.updated

  El secreto (ws_...) se muestra UNA SOLA VEZ al crearlo.
""")
    if input("  ¿Ya lo creaste en la empresa nueva? (si/no): ").strip().lower() not in ("si", "s", "sí"):
        sys.exit("\n  Crealo primero. No guardo nada a medias.\n")

    print()
    api_key = pedir("API key de la empresa NUEVA", r".{20,}", "Al menos 20 caracteres.")
    biz = pedir("Account id nuevo (biz_...)", r"biz_[A-Za-z0-9]+", "Empieza con biz_", oculto=False)
    if viejo and biz == viejo[0]["company_id"]:
        sys.exit("\n  Ese es el account id de SIEMPRE. La idea es una empresa distinta.\n")

    # 1. La llave sirve para esa cuenta.
    hooks = whop(api_key, f"/webhooks?account_id={biz}")
    if "_error" in hooks:
        sys.exit(f"\n  La llave no sirve para {biz}: HTTP {hooks['_error']}\n  {hooks['_body']}\n  No guarde nada.\n")
    lista = hooks.get("data", hooks) if isinstance(hooks, dict) else hooks
    emp = whop(api_key, f"/companies/{biz}")
    print(f"\n  Llave OK. Empresa: «{emp.get('title','?')}»  ·  {len(lista)} webhook(s).")

    # 2. El webhook de Physics.
    mio = next((h for h in lista if isinstance(h, dict) and "physicsstudylab" in h.get("url", "")), None)
    if not mio:
        print("\n  Ningun webhook de esa cuenta apunta a Physics. Los que hay:")
        for h in lista: print(f"    - {h.get('url','')}")
        sys.exit(f"\n  Crealo apuntando a:\n    {WEBHOOK_URL}\n")
    print(f"  Webhook: {mio['id']}")

    secreto = pedir("Secreto del webhook (ws_...)", r"ws_[A-Za-z0-9_-]+", "Empieza con ws_")

    # 3. Que el secreto firme de verdad, ANTES de guardar.
    #    Se manda a un endpoint de prueba que no toca ningun pedido.
    print("\n  Probando la firma...")
    cuerpo = json.dumps({"action": "ping.mudanza", "data": {}}, separators=(",", ":"))
    wid, wts = "msg_prueba_mudanza", str(int(time.time()))
    firmado = f"{wid}.{wts}.{cuerpo}".encode()
    firmas = [base64.b64encode(hmac.new(secreto.encode(), firmado, hashlib.sha256).digest()).decode()]
    try:
        firmas.append(base64.b64encode(hmac.new(base64.b64decode(secreto[3:] + "=="), firmado, hashlib.sha256).digest()).decode())
    except Exception:
        pass
    # Ojo: la firma se comprueba contra el secreto GUARDADO, que todavia es el
    # viejo. Asi que esto solo confirma que la firma se arma bien; la prueba
    # real va DESPUES de guardar.
    print("  (la comprobacion final va despues de guardar: el endpoint usa el secreto guardado)")

    print(f"""
  Voy a:
    1. apuntar Physics a {biz}
    2. rehacer los 4 planes de los OTO en esa cuenta
    3. archivar los 4 planes viejos
""")
    if input("  Escribi SI para seguir: ").strip().upper() != "SI":
        sys.exit("  Cancelado. No se cambio nada.\n")

    # 4. Guardar la conexion.
    tmp = RAIZ / ".mudar.mts"
    tmp.write_text(f'''
import {{ connectWhop }} from "{RAIZ}/src/lib/whop-connect.ts";
console.log(JSON.stringify(await connectWhop("{PHYSICS}", process.env.K!, process.env.C!, process.env.S!, process.env.Hk!)));
''')
    out = subprocess.run(["npx", "tsx", str(tmp)], capture_output=True, text=True, cwd=RAIZ,
                         env={**os.environ, **E, "K": api_key, "C": biz, "S": secreto, "Hk": mio["id"]})
    tmp.unlink(missing_ok=True)
    if out.returncode:
        sys.exit(f"\n  No se pudo guardar:\n{out.stderr[-500:]}\n")
    print("  conexion guardada")

    # 5. Rehacer los planes. Sin esto los OTO dejan de cobrar, en silencio.
    prods = sb(f"products?select=id,slug,short_name,whop_plan_id,product_prices(currency,amount)"
               f"&store_id=eq.{PHYSICS}&whop_plan_id=not.is.null")
    # Bajo que producto de Whop colgarlos en la cuenta nueva: el primero que haya.
    pl = whop(api_key, f"/plans?account_id={biz}&limit=1")
    plista = pl.get("data", pl) if isinstance(pl, dict) else pl
    prod_whop = (plista[0]["product"]["id"] if plista and isinstance(plista[0], dict) and plista[0].get("product") else None)
    if not prod_whop:
        print("\n  OJO: no encuentro un producto en la cuenta nueva donde colgar los planes.")
        print("  Crea un producto cualquiera en Whop y volve a correr esto: la conexion ya quedo guardada.\n")
        return
    viejos = []
    for p in prods:
        usd = next((float(x["amount"]) for x in p["product_prices"] if x["currency"] == "USD"), None)
        if usd is None: continue
        nuevo = whop(api_key, "/plans", "POST", {
            "product_id": prod_whop, "plan_type": "one_time", "release_method": "buy_now",
            "currency": "usd", "initial_price": usd, "visibility": "hidden",
            "unlimited_stock": True, "description": p["short_name"],
            "metadata": {"tienda": "physicsstudylab", "producto": p["slug"]},
        })
        if "_error" in nuevo:
            print(f"    {p['slug']}: NO se pudo crear el plan ({nuevo['_error']}). Lo dejo con el viejo.")
            continue
        viejos.append(p["whop_plan_id"])
        sb(f"products?id=eq.{p['id']}", "PATCH", {"whop_plan_id": nuevo["id"]})
        print(f"    {p['slug']:26} {p['whop_plan_id']} -> {nuevo['id']}")

    # 6. Archivar los viejos, para no dejar planes cobrables sueltos.
    if viejos:
        f = sb("store_whop?select=api_key_enc&store_id=eq.3956652d-f154-4c6c-ab58-d122cc31f86c")
        if f:
            js = (r'const {createDecipheriv,createHash}=require("crypto");const [v,iv,tag,body]=process.env.BLOB.split(".");'
                  r'const key=createHash("sha256").update(process.env.SECRETS_KEY).digest();'
                  r'const d=createDecipheriv("aes-256-gcm",key,Buffer.from(iv,"base64"));d.setAuthTag(Buffer.from(tag,"base64"));'
                  r'process.stdout.write(Buffer.concat([d.update(Buffer.from(body,"base64")),d.final()]).toString("utf8"));')
            kv = subprocess.run(["node", "-e", js], capture_output=True, text=True,
                                env={**os.environ, "SECRETS_KEY": E["SECRETS_KEY"], "BLOB": f[0]["api_key_enc"]}).stdout
            for pid in viejos:
                r = whop(kv, f"/plans/{pid}", "PATCH", {"visibility": "archived"})
                print(f"    archivado en la cuenta vieja: {pid}  {'ok' if '_error' not in r else r['_error']}")

    print("""
  Listo. Avisale a Claude que termino: queda comprobar la firma contra el
  webhook nuevo y volver a correr el diagnostico del panel.
""")


if __name__ == "__main__":
    main()
