/**
 * La OTO como landing propia: products.postcompra_html.
 *
 * Si un producto tiene HTML, /oferta muestra ESA página (su <style> y su
 * markup, como Post-pago/salida/oto*.html) en lugar del diseño con plantilla
 * (products.postcompra_page). Vacío = la plantilla.
 *
 * CONTRATO DEL HTML
 *  - Documento completo o solo el cuerpo. Del <head> se usan los <style>, los
 *    <link> (fuentes, hojas de estilo) y el <title>; lo demás se ignora.
 *  - Etiquetas que se reemplazan en el servidor, con el valor escapado:
 *      {{price}} {{compare_price}} {{first_name}} {{guarantee_days}}
 *      {{store_name}} {{product_name}} {{order_number}}
 *    También las de la plataforma anterior, para poder subir esas páginas tal cual:
 *      {price} {compare} {first-name} {order-number} {savings} {discount}
 *    Sin nombre, {{first_name}} se va con su coma ("Thank you {{first_name}}, …"
 *    queda "Thank you, …").
 *  - data-oto="accept"  en cualquier elemento → cobro de 1 clic (mismo flujo que
 *    el botón de la plantilla: cargando, aviso si falla, y al siguiente paso).
 *    Mientras tanto el elemento lleva data-oto-state="loading|done|error" para
 *    darle estilo.
 *  - data-oto="decline" → "No, gracias": al siguiente paso o a las descargas.
 *  - data-oto="error"   (opcional) → ahí va el aviso si el cobro falla. Si no
 *    hay ninguno, el aviso se agrega debajo del botón tocado.
 *  - Sin JavaScript: se quitan los <script>, los atributos on…= y los enlaces
 *    javascript:. El pixel de Meta lo pone la app, no la página.
 */

export type OtoHtmlVars = {
  price: string;
  compare: string | null;
  firstName: string | null;
  guaranteeDays: number;
  storeName: string;
  productName: string;
  orderNumber: string;
  savings: string | null;
  discount: string | null;
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Lo único que se limpia: cualquier forma de meter JavaScript. */
export function stripScripts(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<\/?script\b[^>]*>/gi, "")
    .replace(/<[a-z][^>]*>/gi, (tag) =>
      tag
        .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
        .replace(/\b(href|src|action|formaction|xlink:href)\s*=\s*(["']?)\s*javascript:[^"'>]*\2/gi, '$1="#"'));
}

/** Lo que se guarda: el HTML sin scripts y con un tope razonable. */
export function cleanOtoHtml(html: string): string {
  return stripScripts(html).slice(0, 600_000);
}

/** Separa el documento: estilos y fuentes del head + cuerpo. */
function splitDocument(html: string) {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() || null;
  const head = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? "";
  const keep = [
    ...head.matchAll(/<style\b[\s\S]*?<\/style\s*>/gi),
    ...head.matchAll(/<link\b[^>]*>/gi),
  ].map((m) => m[0]);
  const bodyMatch = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
  const body = bodyMatch
    ? bodyMatch[1]
    : html
        .replace(/<!doctype[^>]*>/gi, "")
        .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "")
        .replace(/<\/?html[^>]*>/gi, "")
        .replace(/<\/?body[^>]*>/gi, "");
  return { title, markup: keep.join("\n") + "\n" + body };
}

/** HTML listo para pintar: sin scripts, con las etiquetas reemplazadas. */
export function renderOtoHtml(raw: string, v: OtoHtmlVars): { html: string; title: string | null } {
  const { title, markup } = splitDocument(stripScripts(raw));
  let out = markup;
  if (!v.firstName) {
    // "Thank you {{first_name}}, you're…" → "Thank you, you're…"
    out = out.replace(/[ \t]*,?[ \t]*(\{\{\s*first_name\s*\}\}|\{first-name\})/gi, "");
  }
  const map: Record<string, string> = {
    price: v.price,
    compare_price: v.compare ?? "",
    first_name: v.firstName ?? "",
    guarantee_days: String(v.guaranteeDays),
    store_name: v.storeName,
    product_name: v.productName,
    order_number: v.orderNumber,
  };
  out = out.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, k: string) => (k.toLowerCase() in map ? esc(map[k.toLowerCase()]) : m));
  const legacy: Record<string, string> = {
    price: v.price,
    compare: v.compare ?? "",
    "first-name": v.firstName ?? "",
    "order-number": v.orderNumber,
    savings: v.savings ?? "",
    discount: v.discount ?? "",
  };
  out = out.replace(/\{(price|compare|first-name|order-number|savings|discount)\}/gi, (_, k: string) => esc(legacy[k.toLowerCase()]));
  return { html: out, title: title ? fillTitle(title, map) : null };
}

function fillTitle(t: string, map: Record<string, string>) {
  return t.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, k: string) => map[k.toLowerCase()] ?? m).replace(/&amp;/g, "&").replace(/&mdash;/g, "—");
}

/** Texto de ayuda para el MCP. */
export const POSTCOMPRA_HTML_DOC =
  "The page is a full landing of its own: a complete HTML document (or just the body) with its own <style> and markup. From <head> only <style>, <link> (fonts/stylesheets) and <title> are used. "
  + "Placeholders replaced server-side (HTML-escaped): {{price}}, {{compare_price}}, {{first_name}}, {{guarantee_days}}, {{store_name}}, {{product_name}}, {{order_number}}; Legacy tokens {price} {compare} {first-name} {order-number} {savings} {discount} also work. Without a buyer name, {{first_name}} is removed together with its comma. "
  + "Hooks: any element with data-oto=\"accept\" triggers the one-click charge (it gets data-oto-state=\"loading|done|error\" for styling; on success the buyer goes to the next step); data-oto=\"decline\" goes to the next step or the downloads; optional data-oto=\"error\" is where the failure message is written. "
  + "No JavaScript: <script> tags, on…= attributes and javascript: links are stripped when saving. The Meta pixel is added by the app. Empty html = the product falls back to its template page (postcompra_page).";
