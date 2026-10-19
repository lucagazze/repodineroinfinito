#!/usr/bin/env python3
"""Cliente MCP minimo por HTTP para operar la app sin registrar el servidor.

  python3 mcp.py tools                      -> lista las herramientas
  python3 mcp.py call <nombre> '<json>'     -> ejecuta una herramienta
"""
import json, sys, urllib.request, pathlib

# Por defecto habla con la app LOCAL. Para operaciones cuyo efecto vive en
# produccion -- connect_stripe registra el webhook usando PUBLIC_BASE_URL del
# servidor que atiende -- hay que apuntar a Vercel:
#   MCP_BASE=https://checkout-eta-six.vercel.app/api/mcp python3 mcp.py ...
import os
BASE = os.environ.get("MCP_BASE", "http://localhost:3100/api/mcp")
TOK = pathlib.Path(".mcp-token").read_text().strip()
_sid = None

def rpc(method, params=None, notify=False):
    global _sid
    body = {"jsonrpc": "2.0", "method": method}
    if params is not None: body["params"] = params
    if not notify: body["id"] = 1
    h = {"Authorization": f"Bearer {TOK}", "content-type": "application/json",
         "accept": "application/json, text/event-stream"}
    if _sid: h["mcp-session-id"] = _sid
    req = urllib.request.Request(BASE, json.dumps(body).encode(), h, method="POST")
    with urllib.request.urlopen(req, timeout=180) as r:
        if r.headers.get("mcp-session-id"): _sid = r.headers["mcp-session-id"]
        raw = r.read().decode()
    if notify: return None
    for line in raw.splitlines():                      # respuesta SSE
        if line.startswith("data:"):
            return json.loads(line[5:].strip())
    return json.loads(raw) if raw.strip() else None

def conectar():
    rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                       "clientInfo": {"name": "claude-code", "version": "1.0"}})
    rpc("notifications/initialized", {}, notify=True)

def salida(r):
    if r is None: return print("(sin respuesta)")
    if "error" in r: return print("ERROR:", json.dumps(r["error"], ensure_ascii=False)[:1200])
    res = r.get("result", {})
    if res.get("structuredContent") is not None:
        return print(json.dumps(res["structuredContent"], ensure_ascii=False, indent=1)[:4000])
    for c in res.get("content", []):
        if c.get("type") == "text": print(c["text"][:4000])

if __name__ == "__main__":
    conectar()
    if sys.argv[1] == "tools":
        r = rpc("tools/list", {})
        ts = r["result"]["tools"]
        print(f"{len(ts)} herramientas:")
        for t in ts: print(" ", t["name"])
    else:
        args = json.loads(sys.argv[3]) if len(sys.argv) > 3 else {}
        salida(rpc("tools/call", {"name": sys.argv[2], "arguments": args}))
