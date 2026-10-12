"use client";

/** Llamadas del panel de email marketing (fetch común a /api/admin/mkt). */
export async function api<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
  const r = await fetch("/api/admin/mkt", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `Error ${r.status}`);
  return j as T;
}

export const nf = (n: number) => n.toLocaleString("es-AR");
export const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)} %` : "—");
