#!/usr/bin/env python3
"""Reemplaza un archivo de entrega en el almacenamiento, con respaldo y prueba.

LO QUE ESTO PISA ES LO QUE RECIBE EL COMPRADOR. `products.delivery_file` apunta
a un objeto del bucket `entregas`, y la pagina de descarga firma una URL contra
ese objeto. Subir encima es irreversible: no hay papelera.

Por eso el orden es respaldo, subida, comprobacion -- y la comprobacion no es
«devolvio 200», es BAJAR EL ARCHIVO DE VUELTA y mirar que adentro este lo que
tiene que estar. Un 200 dice que el servidor acepto bytes, no que el comprador
vaya a abrir el libro correcto.

    python3 subir-entrega.py maths-illustrated <archivo.pdf> --texto "IGCSE"

`--texto` es lo que tiene que aparecer en el PDF nuevo y NO en el viejo: la
prueba de que el archivo cambio de verdad. Sin eso no se sube.
"""
import argparse, hashlib, json, pathlib, sys, urllib.error, urllib.request

RAIZ = pathlib.Path(__file__).parent
BUCKET = "entregas"


def entorno():
    env = {}
    for l in (RAIZ / ".env.local").read_text().splitlines():
        if "=" in l and not l.startswith("#"):
            k, v = l.split("=", 1); env[k] = v.strip()
    return env


E = entorno()
BASE = E["SUPABASE_URL"]
LLAVE = E["SUPABASE_SERVICE_KEY"]


def pedir(metodo, ruta, datos=None, tipo=None):
    req = urllib.request.Request(f"{BASE}{ruta}", method=metodo, data=datos)
    req.add_header("apikey", LLAVE)
    req.add_header("authorization", f"Bearer {LLAVE}")
    if tipo:
        req.add_header("content-type", tipo)
        req.add_header("x-upsert", "true")
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def texto_de(pdf_bytes, pagina=3):
    import fitz
    d = fitz.open(stream=pdf_bytes, filetype="pdf")
    return d.page_count, d[pagina].get_text()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("slug"); ap.add_argument("archivo")
    ap.add_argument("--texto", required=True,
                    help="lo que tiene que aparecer en el PDF nuevo y no en el viejo")
    ap.add_argument("--subir", action="store_true")
    a = ap.parse_args()

    nuevo = pathlib.Path(a.archivo)
    if not nuevo.exists():
        sys.exit(f"  no existe {nuevo}")

    est, cuerpo = pedir("GET", f"/rest/v1/products?slug=eq.{a.slug}&select=slug,name,delivery_file")
    fila = json.loads(cuerpo)[0]
    destino = fila["delivery_file"]
    print(f"  producto  {fila['slug']}  ->  {BUCKET}/{destino}")

    # --- el que esta hoy -------------------------------------------------
    est, viejo = pedir("GET", f"/storage/v1/object/{BUCKET}/{urllib.request.quote(destino)}")
    if est >= 300:
        sys.exit(f"  no pude bajar el actual ({est}): {viejo[:200]}")
    pp_v, t_v = texto_de(viejo)
    print(f"  ACTUAL    {len(viejo)/1e6:.2f} MB · {pp_v} paginas · "
          f"sha {hashlib.sha256(viejo).hexdigest()[:12]} · «{a.texto}»: {a.texto in t_v}")

    bytes_n = nuevo.read_bytes()
    pp_n, t_n = texto_de(bytes_n)
    print(f"  NUEVO     {len(bytes_n)/1e6:.2f} MB · {pp_n} paginas · "
          f"sha {hashlib.sha256(bytes_n).hexdigest()[:12]} · «{a.texto}»: {a.texto in t_n}")

    if a.texto not in t_n:
        sys.exit(f"\n  NO SUBO: «{a.texto}» no esta en el PDF nuevo. No es el archivo que se quiere.")
    if a.texto in t_v:
        print(f"\n  OJO: «{a.texto}» YA esta en el que corre. Puede que ya se haya subido.")
    if pp_n != pp_v:
        print(f"\n  OJO: cambia la cantidad de paginas ({pp_v} -> {pp_n}). La landing publica ese numero.")

    respaldo = RAIZ / f"respaldo-{a.slug}-{hashlib.sha256(viejo).hexdigest()[:8]}.pdf"
    respaldo.write_bytes(viejo)
    print(f"\n  respaldo del actual: {respaldo}")

    if not a.subir:
        sys.exit("\n  [ensayo] con --subir lo reemplaza.\n")

    est, r = pedir("POST", f"/storage/v1/object/{BUCKET}/{urllib.request.quote(destino)}",
                   bytes_n, "application/pdf")
    print(f"  subida -> {est}")
    if est >= 300:
        sys.exit(f"  no se subio: {r[:300]}")

    # --- la comprobacion que importa: bajarlo y mirar adentro ------------
    est, vuelta = pedir("GET", f"/storage/v1/object/{BUCKET}/{urllib.request.quote(destino)}")
    pp_r, t_r = texto_de(vuelta)
    igual = hashlib.sha256(vuelta).hexdigest() == hashlib.sha256(bytes_n).hexdigest()
    print(f"\n  DE VUELTA {len(vuelta)/1e6:.2f} MB · {pp_r} paginas · "
          f"«{a.texto}»: {a.texto in t_r} · byte a byte igual al nuevo: {igual}")
    print("\n  LISTO.\n" if (igual and a.texto in t_r) else
          "\n  NO quedo bien. El respaldo esta al lado de este script.\n")
