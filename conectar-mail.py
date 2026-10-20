#!/usr/bin/env python3
"""Conecta la casilla desde la que salen las entregas.

La contrasena se tipea a ciegas y va directo a la app por MCP, que la guarda
cifrada. No queda en el historial de la terminal ni pasa por el chat.

Antes de guardar hace una prueba real: se conecta al servidor SMTP y se
autentica. Una casilla mal cargada no da error al guardarse -- da error el dia
de la primera venta, con el comprador esperando su PDF.
"""
import getpass, importlib.util, json, pathlib, smtplib, ssl, sys

RAIZ = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("m", RAIZ / "mcp.py")
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

TIENDA = "financestudylab"
HOST   = "smtp.hostinger.com"
PUERTO = 465                      # SSL directo; el 587 es STARTTLS

print("\n  Casilla de entrega")
print(f"  tienda: {TIENDA}")
print(f"  {HOST}:{PUERTO}\n")

usuario = input("  usuario (info@financestudylab.com): ").strip() or "info@financestudylab.com"

while True:
    clave = getpass.getpass("  contrasena (no se ve al pegar): ").strip()
    if not clave:
        print("     hace falta.\n"); continue

    print("\n  probando la conexion de verdad...")
    try:
        with smtplib.SMTP_SSL(HOST, PUERTO, context=ssl.create_default_context(), timeout=30) as s:
            s.login(usuario, clave)
        print("  OK  el servidor la acepto\n")
        break
    except smtplib.SMTPAuthenticationError:
        print("     usuario o contrasena incorrectos.\n")
    except Exception as e:
        print(f"     no se pudo conectar: {type(e).__name__}: {e}\n")
        if input("     guardar igual? (s/N): ").strip().lower() == "s":
            break

print("  guardando en la app...")
m.conectar()
# test_to: la app manda un mail de prueba de verdad. Es la unica forma de
# saber que la casilla no solo autentica, sino que ENTREGA: un servidor puede
# aceptar la clave y despues rechazar todo lo que se le mande.
r = m.rpc("tools/call", {"name": "set_store_smtp", "arguments": {
    "store": TIENDA, "host": HOST, "port": PUERTO,
    "username": usuario, "password": clave,
    "test_to": "brunogazze@gmail.com",
}})
del clave
m.salida(r)
