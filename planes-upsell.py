#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Crea en Whop el plan de cada producto del post-pago y lo deja enlazado.

POR QUE HACE FALTA
  El cobro de 1 clic usa la tarjeta que el comprador ya dejo guardada, y
  `payments.create` con tarjeta guardada EXIGE un plan: no acepta un importe
  suelto como el checkout principal. Sin plan, el post-pago no puede cobrar —
  que es exactamente como estaba el 22/10/2026: la cadena activa, las paginas
  escritas, los precios cargados, y cero posibilidad de cobrar.

  El precio sale de `product_prices` (USD), que es lo que muestra la pagina de
  la oferta. Si el plan dijera otra cosa, el comprador veria un numero y se le
  cobraria otro.

  python3 planes-upsell.py --tienda financestudylab           # mira y dice que falta
  python3 planes-upsell.py --tienda financestudylab --crear   # crea lo que falte

LA TIENDA ES OBLIGATORIA, Y NO ES BUROCRACIA
  Hasta el 25/10/2026 este script no filtraba por tienda en NINGUNA de sus
  cuatro consultas, con dos tiendas vivas en la misma base:
    · `store_whop` devuelve 2 filas y tomaba la primera sin ordenar, asi que
      no era determinista de que empresa salia la llave de Whop;
    · `pp_funnels` activos son 4 (1 de Finance, 3 de Physics): recorria las
      cadenas de las dos;
    · `funnels?slug=eq.kit` andaba de casualidad, porque hoy solo una tienda
      tiene un embudo con ese slug;
    · la metadata del plan decia "financestudylab" escrito a mano.
  Juntas podian crear planes de productos de Physics bajo la empresa de
  Finance y escribir ese plan_id en Physics. Un plan de otra empresa no cobra
  con la tarjeta guardada: el post-pago falla en silencio.
"""
import json, os, pathlib, subprocess, sys, urllib.error, urllib.request

RAIZ = pathlib.Path(__file__).parent
API = "https://api.whop.com/api/v1"


def entorno():
    env = {}
    for l in (RAIZ / ".env.local").read_text().splitlines():
        if "=" in l and not l.startswith("#"):
            k, v = l.split("=", 1); env[k] = v.strip()
    return env

E = entorno()
H = {"apikey": E["SUPABASE_SERVICE_KEY"],
     "authorization": f"Bearer {E['SUPABASE_SERVICE_KEY']}",
     "content-type": "application/json"}


def supabase(metodo, ruta, cuerpo=None):
    req = urllib.request.Request(
        f"{E['SUPABASE_URL']}/rest/v1/{ruta}", method=metodo,
        data=json.dumps(cuerpo).encode() if cuerpo else None,
        headers={**H, "prefer": "return=representation"})
    with urllib.request.urlopen(req, timeout=45) as r:
        t = r.read().decode()
    return json.loads(t) if t.strip() else []


def tienda_pedida():
    """El slug que vino por --tienda, resuelto a su id. Sin esto no se corre."""
    if "--tienda" not in sys.argv:
        sys.exit("\n  Falta --tienda <slug>. Hay mas de una tienda en esta base y\n"
                 "  sin el slug no se sabe de cual son los planes.\n"
                 "  Ej: python3 planes-upsell.py --tienda financestudylab\n")
    slug = sys.argv[sys.argv.index("--tienda") + 1]
    fila = supabase("GET", f"stores?select=id,slug&slug=eq.{slug}")
    if not fila:
        hay = ", ".join(s["slug"] for s in supabase("GET", "stores?select=slug"))
        sys.exit(f"\n  No existe la tienda «{slug}». Hay: {hay}\n")
    return fila[0]["id"], fila[0]["slug"]


def llave(store_id):
    fila = supabase("GET", f"store_whop?select=api_key_enc,company_id&store_id=eq.{store_id}")
    if not fila:
        sys.exit("\n  Esta tienda no tiene Whop conectado.\n")
    js = r'''
const {createDecipheriv,createHash}=require("crypto");
const [v,iv,tag,body]=process.env.BLOB.split(".");
const key=createHash("sha256").update(process.env.SECRETS_KEY).digest();
const d=createDecipheriv("aes-256-gcm",key,Buffer.from(iv,"base64"));
d.setAuthTag(Buffer.from(tag,"base64"));
process.stdout.write(Buffer.concat([d.update(Buffer.from(body,"base64")),d.final()]).toString("utf8"));
'''
    r = subprocess.run(["node", "-e", js], capture_output=True, text=True,
                       env={**os.environ, "SECRETS_KEY": E["SECRETS_KEY"],
                            "BLOB": fila[0]["api_key_enc"]})
    if r.returncode or not r.stdout:
        sys.exit("  no pude descifrar la llave de Whop: " + r.stderr[:200])
    return r.stdout, fila[0]["company_id"]


def whop(k, ruta, metodo="GET", cuerpo=None):
    try:
        req = urllib.request.Request(
            API + ruta, method=metodo,
            data=json.dumps(cuerpo).encode() if cuerpo else None,
            headers={"authorization": f"Bearer {k}", "accept": "application/json",
                     "content-type": "application/json"})
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        sys.exit(f"\n  Whop lo rechazo ({e.code}):\n  {e.read().decode()[:400]}\n")


def pasos_del_postpago(store_id):
    """Los productos que el post-pago de ESTA tienda ofrece, en orden, con su precio."""
    pps = supabase("GET", f"pp_funnels?select=id,name,active&active=eq.true&store_id=eq.{store_id}")
    salida = []
    for f in pps:
        st = supabase("GET", f"pp_steps?select=sort_order,product_id&pp_funnel_id=eq.{f['id']}&order=sort_order")
        for s in st:
            p = supabase("GET", f"products?select=id,slug,short_name,name,whop_plan_id,subscription&id=eq.{s['product_id']}")[0]
            # LAS SUSCRIPCIONES NO PASAN POR AQUI.
            #   Este script crea planes `one_time`, y no filtraba por
            #   `subscription`. El 26/10/2026 estuvo a punto de crear uno para
            #   «vision-semanal-prueba»: habria cobrado 1 dolar UNA VEZ y no
            #   habria renovado nunca -- una suscripcion que no suscribe, y
            #   nadie se entera hasta que falta el segundo mes.
            #   Las recurrentes las crea planes-suscripcion.py.
            if p.get("subscription"):
                continue
            pr = supabase("GET", f"product_prices?select=amount,currency&product_id=eq.{p['id']}&currency=eq.USD")
            p["precio"] = float(pr[0]["amount"]) if pr else None
            p["embudo"] = f["name"]
            salida.append(p)
    return salida


def main():
    crear = "--crear" in sys.argv
    store_id, slug = tienda_pedida()
    k, empresa = llave(store_id)
    pasos = pasos_del_postpago(store_id)
    if not pasos:
        sys.exit("\n  No hay cadena de post-pago activa.\n")

    # El producto de Whop bajo el que colgar los planes.
    #
    #   PRIMERO el del plan principal, para no dispersar el catalogo de la
    #   cuenta. PERO ese camino depende de que algun embudo tenga
    #   `whop_plan_id`, y medido el 29/10/2026 los TRES embudos de Physics lo
    #   tienen en NULL: el script salia por `sys.exit` sin crear un solo plan.
    #   El comprador habria aceptado un OTO y no se le habria cobrado.
    #
    #   Asi que si no hay embudo con plan, se le pregunta a Whop por el
    #   producto de la cuenta, que es lo que hace rehacer-planes-physics.py y
    #   lo que de verdad hace falta: el plan cuelga de un producto, no de otro
    #   plan.
    emb_filas = supabase("GET", f"funnels?select=slug,whop_plan_id&store_id=eq.{store_id}&whop_plan_id=not.is.null&order=slug")
    if emb_filas:
        emb = emb_filas[0]
        base = whop(k, f"/plans/{emb['whop_plan_id']}")
        if "_error" in base:
            sys.exit(f"\n  No pude leer el plan {emb['whop_plan_id']}: {base.get('_body')}\n")
        prod_whop = base["product"]["id"]
        de_donde = f"embudo «{emb['slug']}»"
    else:
        r = whop(k, f"/products?account_id={empresa}&limit=1")
        if "_error" in r:
            sys.exit(f"\n  La llave de {slug} no sirve ({r['_error']}): {r.get('_body')}\n")
        hay = r.get("data") or []
        if not hay:
            sys.exit(f"\n  La empresa {empresa} no tiene ningun producto de Whop donde colgar los planes.\n"
                     f"  Crealo una vez (visibility hidden) y volve a correr esto.\n")
        prod_whop = hay[0]["id"]
        de_donde = f"producto de la cuenta «{hay[0].get('title')}»"

    print(f"\n  Tienda {slug}  ·  empresa {empresa}  ·  {de_donde}"
          f"  ·  producto de Whop {prod_whop}\n")
    faltan = []
    for p in pasos:
        estado = p["whop_plan_id"] or "SIN PLAN"
        print(f"    {p['slug']:28} USD {p['precio'] if p['precio'] is not None else '?':>6}   {estado}")
        if not p["whop_plan_id"]:
            if p["precio"] is None:
                print(f"       !  sin precio en USD: cargalo antes de crear el plan")
            else:
                faltan.append(p)

    if not faltan:
        print("\n  Nada que crear: todos tienen plan.\n"); return
    if not crear:
        print(f"\n  Faltan {len(faltan)}. Para crearlos:  python3 planes-upsell.py --tienda {slug} --crear\n"); return

    print(f"\n  Voy a crear {len(faltan)} plan(es) de pago unico en USD y enlazarlos.")
    # --si: confirmacion no interactiva, para que lo pueda correr un asistente.
    # No es un atajo para saltarse el control: el control pasa a ser el permiso
    # explicito de .claude/settings.local.json, que el dueno escribe una vez y
    # puede sacar cuando quiera. Sin esa regla, el comando ni siquiera arranca.
    if "--si" not in sys.argv:
        if input("  Escribi SI para seguir: ").strip().upper() != "SI":
            sys.exit("  Cancelado. No se creo nada.")
    else:
        print("  (confirmado con --si)")

    for p in faltan:
        nuevo = whop(k, "/plans", "POST", {
            "product_id": prod_whop,
            "plan_type": "one_time",
            "release_method": "buy_now",
            "currency": "usd",
            "initial_price": p["precio"],
            "visibility": "hidden",   # solo se vende desde el post-pago
            "unlimited_stock": True,
            "description": p["short_name"] or p["name"],
            "metadata": {"tienda": slug, "producto": p["slug"], "kind": "upsell"},
        })
        supabase("PATCH", f"products?id=eq.{p['id']}", {"whop_plan_id": nuevo["id"]})
        # Comprobacion: que la base quedo apuntando y que el plan cobra lo que debe
        ver = supabase("GET", f"products?select=whop_plan_id&id=eq.{p['id']}")[0]
        print(f"    {p['slug']:28} {nuevo['id']}  {nuevo.get('formatted_price')}  "
              f"enlazado={'si' if ver['whop_plan_id'] == nuevo['id'] else 'NO'}")

    print(f"""
  LISTO. Antes de confiar en esto, una compra de prueba de verdad:
    1. Compra el kit con una tarjeta real.
    2. En la pagina del Excel, tocar «Add it to my order».
    3. Revisar que en Ventas el pedido tenga DOS renglones, no dos pedidos.
    4. Que llegue el segundo mail con el Excel.
  El cobro de Whop es asincrono: el renglon aparece cuando llega el webhook,
  unos segundos despues del clic.
""")


if __name__ == "__main__":
    main()
