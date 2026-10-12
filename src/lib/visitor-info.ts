/**
 * Datos de cada visita para site_events (los usa /api/ev): navegador,
 * sistema y equipo leídos del user-agent, ciudad y región de las cabeceras
 * de Vercel, e IP enmascarada. Sin librerías: lo justo para el panel.
 */

export type UaInfo = { browser: string | null; os: string | null; model: string | null };

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const clean = (s: string | undefined) => (s ?? "").replace(/\s+Build\/.*$/i, "").trim().slice(0, 40);

function browserOf(ua: string): string | null {
  if (/bot\b|crawler|spider|HeadlessChrome|facebookexternalhit|Lighthouse|Playwright/i.test(ua)) return "Robot";
  // Navegadores dentro de apps: casi todo el tráfico de anuncios entra por acá.
  if (/FBAN\/Messenger|MessengerForiOS|MessengerLite|FB_IAB\/Orca/i.test(ua)) return "Messenger";
  if (/Instagram/i.test(ua)) return "Instagram";
  if (/FBAN|FBAV|FB_IAB|FBIOS|FB4A/i.test(ua)) return "Facebook";
  if (/musical_ly|BytedanceWebview|TikTok/i.test(ua)) return "TikTok";
  if (/WhatsApp/i.test(ua)) return "WhatsApp";
  if (/Barcelona/i.test(ua)) return "Threads";
  if (/SamsungBrowser/i.test(ua)) return "Samsung Internet";
  if (/Edg(e|A|iOS)?\//.test(ua)) return "Edge";
  if (/OPR\/|Opera|OPiOS/.test(ua)) return "Opera";
  if (/YaBrowser/.test(ua)) return "Yandex";
  if (/CriOS/.test(ua)) return "Chrome";
  if (/FxiOS|Firefox\//.test(ua)) return "Firefox";
  if (/; wv\)/.test(ua)) return "App (Android)";
  if (/Chrome\/|Chromium/.test(ua)) return "Chrome";
  if (/Version\/[\d.]+.*Safari\//.test(ua)) return "Safari";
  if (/iPhone|iPad|iPod/.test(ua)) return "App (iOS)";
  return null;
}

function osOf(ua: string): string | null {
  const ios = ua.match(/(?:iPhone|CPU) OS (\d+)[_.]/);
  if (/iPad/.test(ua)) return ios ? `iPadOS ${ios[1]}` : "iPadOS";
  if (/iPhone|iPod/.test(ua)) return ios ? `iOS ${ios[1]}` : "iOS";
  const and = ua.match(/Android (\d+)/);
  if (and) return `Android ${and[1]}`;
  if (/Android/.test(ua)) return "Android";
  if (/Windows NT/.test(ua)) return "Windows";
  if (/CrOS/.test(ua)) return "ChromeOS";
  if (/Mac OS X|Macintosh/.test(ua)) return "macOS";
  if (/Linux/.test(ua)) return "Linux";
  return null;
}

function modelOf(ua: string): string | null {
  if (/iPad/.test(ua)) return "iPad";
  if (/iPhone|iPod/.test(ua)) return "iPhone";
  if (/Android/.test(ua)) {
    // Instagram: «Android (34/14; 450dpi; 1080x2316; samsung; SM-A546E; …»
    const ig = ua.match(/Instagram [\d.]+ Android \([^;]*;[^;]*;[^;]*;\s*([^;]+);\s*([^;]+);/);
    if (ig) return `${cap(clean(ig[1]))} ${clean(ig[2])}`.trim();
    // Facebook: «FBMF/samsung;…;FBDV/SM-A325M;»
    const fb = ua.match(/FBDV\/([^;\]]+)/);
    if (fb) {
      const mf = ua.match(/FBMF\/([^;\]]+)/);
      return `${mf ? `${cap(clean(mf[1]))} ` : ""}${clean(fb[1])}`;
    }
    // Chrome ya manda «Android 10; K» (modelo oculto); otros todavía lo dicen.
    const m = ua.match(/Android [\d.]+;\s*(?:[a-z]{2}[-_][a-z]{2};\s*)?([^;)]+?)(?:\s+Build\/[^;)]*)?[;)]/i);
    const model = clean(m?.[1]);
    return model && !/^(K|wv|Mobile|Linux|U)$/i.test(model) ? model : "Android";
  }
  if (/Windows NT/.test(ua)) return "PC";
  if (/CrOS/.test(ua)) return "Chromebook";
  if (/Macintosh|Mac OS X/.test(ua)) return "Mac";
  return null;
}

export function parseUA(ua: string): UaInfo {
  if (!ua) return { browser: null, os: null, model: null };
  return { browser: browserOf(ua), os: osOf(ua), model: modelOf(ua) };
}

/** 181.45.x.x · 2800:810:4a1:… (los 3 primeros grupos de IPv6). Nunca la IP completa. */
export function maskIp(raw: string | null | undefined): string | null {
  const ip = (raw ?? "").trim().replace(/%.*$/, "");
  const v4 = ip.match(/^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/i);
  if (v4) return v4[1] === "127" ? null : `${v4[1]}.${v4[2]}.x.x`;
  if (!ip.includes(":")) return null;
  // «::» comprime grupos en cero: se expande para que los 3 primeros sean los de verdad.
  const [head, tail] = ip.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const groups = tail === undefined ? h : [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t];
  const first = groups.slice(0, 3);
  if (first.length < 3 || !first.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return null;
  if (first.every((g) => /^0+$/.test(g))) return null; // ::1 (local)
  return `${first.map((g) => g.toLowerCase().replace(/^0+(?=.)/, "")).join(":")}:…`;
}

/** Ciudad de Vercel: viene codificada («S%C3%A3o%20Paulo»). */
export function cityOf(raw: string | null): string | null {
  if (!raw) return null;
  try { return decodeURIComponent(raw).slice(0, 80) || null; } catch { return raw.slice(0, 80); }
}
