#!/usr/bin/env python3
"""Guarda la clave MCP del panel (cp_...) en .mcp-token, fuera de git.

Igual que cargar-llaves.py: el valor va directo al archivo, no pasa por el
historial de la terminal ni por el chat. Se tipea a ciegas; pega y da Enter.
"""
import getpass, pathlib, sys

p = pathlib.Path(".mcp-token")
print("\n  Clave MCP del panel")
print("  Panel > Guia de la app > «Crear link para compartir» (o «Copiar con clave nueva»)")
print("  Si el boton te da un LINK, pega el link entero: saco la clave de adentro.\n")

while True:
    v = getpass.getpass("  clave o link: ").strip().strip('"').strip("'")
    if not v:
        print("     hace falta.\n"); continue
    if "cp_" not in v:
        print("     no encuentro un cp_ ahi dentro. Copia de nuevo.\n"); continue
    # si vino un link, quedarse con el token
    i = v.index("cp_")
    tok = ""
    for c in v[i:]:
        if c.isalnum() or c in "_-":
            tok += c
        else:
            break
    if len(tok) < 12:
        print(f"     la clave quedo muy corta ({len(tok)}). Copia de nuevo.\n"); continue
    p.write_text(tok); p.chmod(0o600)
    print(f"\n  Guardada en .mcp-token ({len(tok)} caracteres)\n")
    break
