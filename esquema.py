#!/usr/bin/env python3
import json, sys, importlib.util, pathlib
spec = importlib.util.spec_from_file_location("m", pathlib.Path("mcp.py"))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
m.conectar()
ts = m.rpc("tools/list", {})["result"]["tools"]
for n in sys.argv[1:]:
    t = next((x for x in ts if x["name"] == n), None)
    if not t: print(f"-- {n}: no existe"); continue
    s = t.get("inputSchema", {})
    req = set(s.get("required", []))
    print(f"== {n} ==")
    print("  ", (t.get("description") or "")[:230].replace("\n"," "))
    for k, v in (s.get("properties") or {}).items():
        tipo = v.get("type") or ("enum" if v.get("enum") else "?")
        d = (v.get("description") or "")[:72].replace("\n", " ")
        print(f"   {'*' if k in req else ' '} {k:26} {str(tipo):8} {d}")
    print()
