# -*- coding: utf-8 -*-
"""Corre SQL contra la base del checkout por la Management API de Supabase.
Uso: python supabase/sql.py archivo.sql   |   python supabase/sql.py -e "select 1"
Lee el token de SUPABASE_ACCESS_TOKEN (token personal de supabase.com) y el proyecto de SUPABASE_PROJECT_REF."""
import json
import os
import sys
import urllib.request

REF = os.environ.get("SUPABASE_PROJECT_REF", "")
TOKEN = os.environ.get("SUPABASE_ACCESS_TOKEN", "")


def run(q: str):
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{REF}/database/query",
        data=json.dumps({"query": q}).encode(),
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json", "User-Agent": "curl/8.7.1"},
    )
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        sys.exit(f"HTTP {e.code}: {e.read().decode()[:2000]}")


if __name__ == "__main__":
    q = sys.argv[2] if sys.argv[1] == "-e" else open(sys.argv[1], encoding="utf-8").read()
    print(json.dumps(run(q), ensure_ascii=False, indent=1, default=str))
