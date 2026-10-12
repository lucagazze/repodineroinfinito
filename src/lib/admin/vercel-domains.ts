/**
 * Dominios propios en Vercel: agregarlos al proyecto, ver si el DNS ya apunta
 * y pedir la verificación. Sin VERCEL_TOKEN el panel muestra los registros
 * para cargarlos a mano y nada de esto se llama.
 */

const API = "https://api.vercel.com";
const A_IP = "76.76.21.21";
const CNAME = "cname.vercel-dns.com";

type Verification = { type: string; domain: string; value: string; reason?: string };
type VercelDomain = { name: string; apexName?: string; verified?: boolean; verification?: Verification[] };
type VercelConfig = {
  configuredBy?: string | null; misconfigured?: boolean;
  recommendedIPv4?: { rank: number; value: string[] }[]; recommendedCNAME?: { rank: number; value: string }[];
};

export type DnsRecord = { type: "A" | "CNAME" | "TXT"; name: string; value: string };

export type DomainStatus = {
  domain: string;
  /** false = falta VERCEL_TOKEN / VERCEL_PROJECT_ID: solo instrucciones manuales. */
  api: boolean;
  inProject?: boolean;
  /** Vercel confirmó que el dominio es nuestro (a veces pide un TXT). */
  verified?: boolean;
  /** El DNS todavía no apunta a Vercel. */
  misconfigured?: boolean;
  records: DnsRecord[];
  error?: string;
};

export const vercelReady = () => !!(process.env.VERCEL_TOKEN && process.env.VERCEL_PROJECT_ID);

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<{ ok: boolean; status: number; data: T & { error?: { code?: string; message?: string } } }> {
  const team = process.env.VERCEL_TEAM_ID ? `${path.includes("?") ? "&" : "?"}teamId=${encodeURIComponent(process.env.VERCEL_TEAM_ID)}` : "";
  const res = await fetch(`${API}${path}${team}`, {
    method,
    headers: { authorization: `Bearer ${process.env.VERCEL_TOKEN}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: { code?: string; message?: string } };
  return { ok: res.ok, status: res.status, data };
}

const project = () => encodeURIComponent(process.env.VERCEL_PROJECT_ID!);

/** Un dominio raíz (tienda.com) va con registro A; un subdominio (pay.tienda.com), con CNAME. */
function baseRecords(domain: string, apex?: string, cfg?: VercelConfig): DnsRecord[] {
  const root = apex ? domain === apex : domain.split(".").length <= 2;
  const host = root ? "@" : domain.slice(0, domain.length - (apex ?? domain.split(".").slice(-2).join(".")).length - 1);
  if (root) {
    const ip = cfg?.recommendedIPv4?.sort((a, b) => a.rank - b.rank)[0]?.value?.[0] ?? A_IP;
    return [{ type: "A", name: host, value: ip }];
  }
  const cname = cfg?.recommendedCNAME?.sort((a, b) => a.rank - b.rank)[0]?.value?.replace(/\.$/, "") ?? CNAME;
  return [{ type: "CNAME", name: host, value: cname }];
}

export function manualRecords(domain: string): DnsRecord[] {
  return baseRecords(domain);
}

/** Lo agrega al proyecto. Si ya estaba, no es error. */
export async function addDomain(domain: string): Promise<{ ok: boolean; error?: string }> {
  if (!vercelReady()) return { ok: false, error: "Falta VERCEL_TOKEN" };
  try {
    const r = await call<VercelDomain>("POST", `/v10/projects/${project()}/domains`, { name: domain });
    if (r.ok || r.status === 409) return { ok: true };
    return { ok: false, error: r.data.error?.message ?? `Vercel respondió ${r.status}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function domainStatus(domain: string): Promise<DomainStatus> {
  if (!vercelReady()) return { domain, api: false, records: manualRecords(domain) };
  try {
    const [d, c] = await Promise.all([
      call<VercelDomain>("GET", `/v9/projects/${project()}/domains/${encodeURIComponent(domain)}`),
      call<VercelConfig>("GET", `/v6/domains/${encodeURIComponent(domain)}/config`),
    ]);
    if (d.status === 404) return { domain, api: true, inProject: false, records: manualRecords(domain) };
    if (!d.ok) return { domain, api: true, records: manualRecords(domain), error: d.data.error?.message ?? `Vercel respondió ${d.status}` };
    const records = baseRecords(domain, d.data.apexName, c.ok ? c.data : undefined);
    // Si el dominio estuvo en otra cuenta de Vercel, pide un TXT para probar que es nuestro.
    for (const v of d.data.verification ?? []) {
      records.push({ type: v.type.toUpperCase() as DnsRecord["type"], name: v.domain, value: v.value });
    }
    return {
      domain, api: true, inProject: true,
      verified: !!d.data.verified,
      misconfigured: c.ok ? !!c.data.misconfigured : undefined,
      records,
    };
  } catch (e) {
    return { domain, api: true, records: manualRecords(domain), error: (e as Error).message };
  }
}

export async function verifyDomain(domain: string): Promise<{ ok: boolean; error?: string }> {
  if (!vercelReady()) return { ok: false, error: "Falta VERCEL_TOKEN" };
  try {
    const r = await call<VercelDomain>("POST", `/v9/projects/${project()}/domains/${encodeURIComponent(domain)}/verify`);
    if (r.ok && r.data.verified) return { ok: true };
    return { ok: false, error: r.data.error?.message ?? "Todavía no se pudo verificar" };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
