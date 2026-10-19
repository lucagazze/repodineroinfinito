#!/usr/bin/env python3
"""Conecta la tienda con tu cuenta de Stripe.

Las dos llaves se tipean a ciegas y van directo a la app, que valida contra
Stripe, crea el webhook sola y las guarda cifradas (AES-256-GCM). No pasan por
el historial de la terminal, no se escriben en ningun archivo, no van al chat.
"""
import getpass, importlib.util, json, os, pathlib, sys

spec = importlib.util.spec_from_file_location("m", pathlib.Path(__file__).parent / "mcp.py")
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

TIENDA = "financestudylab"

# Contra PRODUCCION a proposito: la app registra el webhook de Stripe usando su
# propia direccion publica. Corrido contra localhost, Stripe quedaria avisando
# los pagos a una notebook apagada.
os.environ.setdefault("MCP_BASE", "https://checkout-eta-six.vercel.app/api/mcp")

def pedir(etiqueta, prefijos, ayuda):
    while True:
        v = getpass.getpass(f"  {etiqueta}: ").strip().strip('"').strip("'")
        if not v:
            print("     hace falta.\n"); continue
        if not v.startswith(prefijos):
            print(f"     {ayuda}\n"); continue
        return v

print("\n  Conectar Stripe")
print("  dashboard.stripe.com/apikeys  (modo Live, arriba a la derecha)")
print("  No se ve nada al pegar: es a proposito. Pega y da Enter.\n")

sk = pedir("llave SECRETA (sk_live_... o rk_live_...)",
           ("sk_live_", "rk_live_", "sk_org_live_", "sk_test_", "rk_test_"),
           "tiene que empezar con sk_live_, rk_live_ o sk_org_live_")
pk = pedir("llave PUBLICABLE (pk_live_...)", ("pk_live_", "pk_test_"),
           "tiene que empezar con pk_live_")

if sk.startswith(("sk_test_", "rk_test_")) != pk.startswith("pk_test_"):
    sys.exit("\n  Una es de prueba y la otra en vivo: tienen que ser del mismo modo.\n")

print("\n  conectando...\n")
m.conectar()
r = m.rpc("tools/call", {"name": "connect_stripe",
                         "arguments": {"store": TIENDA, "secret_key": sk, "publishable_key": pk}})
del sk, pk
m.salida(r)
