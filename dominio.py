#!/usr/bin/env python3
"""Activa el dominio propio del checkout, pero SOLO cuando el DNS ya resuelve.

Por que existe: `stores.domain` hace que el middleware redirija /c/... a ese
dominio. Si se carga antes de que el CNAME resuelva y Vercel emita el
certificado, el checkout deja de funcionar para TODOS -- redirige a un sitio
que no existe. Este script comprueba las tres cosas antes de tocar la base.

Uso:  python3 dominio.py            (solo comprueba)
      python3 dominio.py --activar  (comprueba y, si pasa, lo activa)
"""
import json, pathlib, socket, ssl, subprocess, sys, urllib.request

DOMINIO = "pay.financestudylab.com"
TIENDA = "financestudylab"
ESPERADO = "cname.vercel-dns.com"

def cname():
    try:
        r = subprocess.run(["dig", "+short", "CNAME", DOMINIO], capture_output=True, text=True, timeout=20)
        return r.stdout.strip().rstrip(".")
    except Exception as e:
        return f"(error: {e})"

def resuelve():
    try:
        return socket.gethostbyname(DOMINIO)
    except Exception:
        return None

def certificado():
    try:
        ctx = ssl.create_default_context()
        with socket.create_connection((DOMINIO, 443), timeout=15) as s:
            with ctx.wrap_socket(s, server_hostname=DOMINIO) as ss:
                return True, ss.getpeercert().get("notAfter", "?")
    except Exception as e:
        return False, str(e)[:70]

def sirve():
    try:
        req = urllib.request.Request(f"https://{DOMINIO}/c/{TIENDA}/kit",
                                     headers={"user-agent": "dominio.py"})
        with urllib.request.urlopen(req, timeout=25) as r:
            cuerpo = r.read(40000).decode("utf8", "replace")
            return r.status, ("The Leader Screen" in cuerpo)
    except Exception as e:
        return None, str(e)[:70]

c = cname()
ip = resuelve()
cert_ok, cert_info = certificado() if ip else (False, "no resuelve")
http, tiene_producto = sirve() if cert_ok else (None, False)

print(f"  CNAME        {c or '(no hay)'}   {'OK' if ESPERADO in c else 'falta: tiene que ser ' + ESPERADO}")
print(f"  resuelve a   {ip or 'NO RESUELVE'}")
print(f"  certificado  {'OK (' + str(cert_info) + ')' if cert_ok else 'NO — ' + str(cert_info)}")
print(f"  sirve        {('HTTP ' + str(http)) if http else 'no'}   producto visible: {'si' if tiene_producto else 'no'}")

listo = bool(ip) and cert_ok and http == 200 and tiene_producto
print(f"\n  {'LISTO para activar' if listo else 'TODAVIA NO: no activar'}")

if "--activar" in sys.argv:
    if not listo:
        sys.exit("  no se activa: el dominio todavia no sirve el checkout")
    import importlib.util
    spec = importlib.util.spec_from_file_location("mg", pathlib.Path(__file__).parent / "migrar.py")
    mg = importlib.util.module_from_spec(spec); spec.loader.exec_module(mg)
    print(json.dumps(mg.correr(
        f"update stores set domain='{DOMINIO}' where slug='{TIENDA}' returning slug, domain"), indent=2))
