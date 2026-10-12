/**
 * Cómo se muestra un mail dentro del panel (Mails, Enviados, la conversación).
 *
 * HTML en un iframe con sandbox (sin scripts ni mismo origen) y una CSP que
 * solo deja imágenes https y estilos en línea. Los links abren en otra pestaña.
 * Mirarlo en el panel no cuenta como apertura ni como clic: se saca nuestro
 * píxel (también el que viene citado en la respuesta de un comprador) y los
 * links con seguimiento vuelven a su destino real.
 */

const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src https: data:"><base target="_blank">`;
const BASE_CSS = "body{margin:0;padding:18px 20px;font:14px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#18181b;background:#fff;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}blockquote{margin:8px 0;padding-left:12px;border-left:3px solid #e4e4e7;color:#52525b}";

export const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const unesc = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

/** Sin scripts, sin on…=, sin nuestro píxel y con los links de seguimiento apuntando a su destino. */
export function panelHtml(raw: string) {
  return raw
    // Los scripts no corren igual (sandbox): se sacan para no llenar la consola de bloqueos.
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "").replace(/<script\b[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    // Píxel de apertura (/api/m/o/{id}.gif).
    .replace(/<img\b[^>]*\/api\/m\/o\/[^>]*>/gi, "")
    // Link con seguimiento (/api/m/c/{id}?u=…&s=…) → el destino.
    .replace(/(\bhref\s*=\s*["'])[^"']*\/api\/m\/c\/[0-9a-f-]{36}\?u=([^&"']+)(?:&amp;|&)s=[^"']*(["'])/gi, (all, pre: string, u: string, post: string) => {
      try { return pre + escHtml(decodeURIComponent(unesc(u))) + post; } catch { return all; }
    });
}

/** El documento para el iframe (srcDoc). Los mails nuestros son documentos completos: la CSP va en su <head>. */
export function srcDoc(raw: string) {
  const html = panelHtml(raw);
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1>${CSP}`);
  return `<!doctype html><html><head><meta charset="utf-8">${CSP}<style>${BASE_CSS}</style></head><body>${html}</body></html>`;
}
