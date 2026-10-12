"""Genera src/lib/guia.ts desde docs/guia.md (la guía de la app: panel /admin/guia y MCP get_guide).
Uso: python scripts/build-guia.py  (después de editar docs/guia.md)."""
import io, json, os, re

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
md = io.open(os.path.join(root, "docs", "guia.md"), encoding="utf-8").read().replace("\r\n", "\n")

sections, group, cur = [], "", None
for line in md.split("\n"):
    if line.startswith("# "):
        group = line[2:].strip()
        continue
    m = re.match(r"^## (.+?) \{#([a-z0-9-]+)\}\s*$", line)
    if m:
        cur = {"id": m.group(2), "group": group, "title": m.group(1).strip(), "body": []}
        sections.append(cur)
        continue
    if line.startswith("## "):
        raise SystemExit(f"Falta {{#id}} en: {line}")
    if cur is not None:
        cur["body"].append(line)
for s in sections:
    s["body"] = "\n".join(s["body"]).strip()
ids = [s["id"] for s in sections]
assert len(ids) == len(set(ids)), "ids repetidos"

out = '''// GENERADO por scripts/build-guia.py desde docs/guia.md — no editar a mano.
/** La guía de la app (centro de información): panel /admin/guia y la herramienta MCP get_guide. */
export type GuideSection = { id: string; group: string; title: string; body: string };

export const GUIDE: GuideSection[] = ''' + json.dumps(sections, ensure_ascii=False, indent=1) + ''';

/** La guía (o una sección) en Markdown, para una IA. */
export function guideMarkdown(id?: string): string | null {
  const list = id ? GUIDE.filter((s) => s.id === id) : GUIDE;
  if (!list.length) return null;
  let group = "";
  return list.map((s) => {
    const head = !id && s.group !== group ? `# ${(group = s.group)}\\n\\n` : "";
    return `${head}## ${s.title}\\n\\n${s.body}`;
  }).join("\\n\\n");
}
'''
io.open(os.path.join(root, "src", "lib", "guia.ts"), "w", encoding="utf-8", newline="\n").write(out)
print(f"ok {len(sections)} secciones")
