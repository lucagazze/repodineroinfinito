import { lookup } from "dns/promises";
import { isIP } from "net";
import { UserError } from "./util";

/**
 * Descarga un archivo de una URL pública para subirlo al Storage.
 *
 * Solo https, con tope de tamaño leído en streaming (no se confía en
 * Content-Length) y sin direcciones internas: el servidor no puede servir de
 * puente para pedirle algo a la red privada de Vercel o a localhost.
 */

function privateIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") ||
    (v.startsWith("::ffff:") && privateIp(v.slice(7)));
}

async function assertPublicHttps(raw: string) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new UserError(`"${raw}" is not a valid URL.`);
  }
  if (u.protocol !== "https:") throw new UserError("Only https:// URLs can be downloaded.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) throw new UserError("That host is not allowed.");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new UserError(`Cannot resolve host ${host}.`);
  if (addrs.some((a) => privateIp(a.address))) throw new UserError("URLs pointing to private/internal addresses are not allowed.");
  return u;
}

const EXT_TYPES: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", avif: "image/avif",
  svg: "image/svg+xml", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", pdf: "application/pdf",
};

export type Downloaded = { buf: Buffer; contentType: string; filename: string };

export async function downloadPublic(
  url: string,
  opts: { maxBytes: number; accept: (contentType: string) => boolean; what: string }
): Promise<Downloaded> {
  let current = await assertPublicHttps(url);
  let res: Response | null = null;
  // Redirecciones a mano: cada salto se valida igual que la URL original.
  for (let hop = 0; hop < 5; hop++) {
    res = await fetch(current, { redirect: "manual", signal: AbortSignal.timeout(25_000), headers: { "user-agent": "checkout-propio-mcp/1.0" } });
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      current = await assertPublicHttps(new URL(loc, current).toString());
      continue;
    }
    break;
  }
  if (!res) throw new UserError("Download failed.");
  if (res.status >= 300 && res.status < 400) throw new UserError("Too many redirects.");
  if (!res.ok) throw new UserError(`Download failed: HTTP ${res.status} from ${current.host}. Use a direct, public file link.`);

  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > opts.maxBytes) throw new UserError(`File is ${(declared / 1048576).toFixed(1)} MB; the limit is ${opts.maxBytes / 1048576} MB.`);

  const ext = current.pathname.split(".").pop()?.toLowerCase() ?? "";
  let type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!type || type === "application/octet-stream" || type === "binary/octet-stream") type = EXT_TYPES[ext] ?? type;
  if (type === "text/html") {
    throw new UserError("The URL returned a web page, not a file (Google Drive/Dropbox share pages need a direct download link, e.g. https://drive.google.com/uc?export=download&id=FILE_ID).");
  }
  if (!opts.accept(type)) throw new UserError(`Unsupported file type "${type || "unknown"}" for ${opts.what}.`);

  const reader = res.body?.getReader();
  if (!reader) throw new UserError("Empty response body.");
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > opts.maxBytes) {
      await reader.cancel().catch(() => {});
      throw new UserError(`File is larger than ${opts.maxBytes / 1048576} MB.`);
    }
    parts.push(value);
  }
  if (!size) throw new UserError("The downloaded file is empty.");
  const filename = decodeURIComponent(current.pathname.split("/").pop() || "file").slice(0, 120);
  return { buf: Buffer.concat(parts), contentType: type, filename };
}

export const extFor = (type: string) =>
  Object.entries(EXT_TYPES).find(([, t]) => t === type)?.[0] ?? (type.split("/")[1] ?? "bin").replace(/[^a-z0-9]/g, "");
