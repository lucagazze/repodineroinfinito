/** Tipos y textos de Preventas que usan el servidor y el navegador (sin base de datos). */

/** «entregado»: listo y avisado a todos (o listo sin nadie esperando): ya no es tarea, se ve aparte. */
export type PresaleState = "sin_ventas" | "a_tiempo" | "vence_pronto" | "atrasado" | "listo_sin_avisar" | "entregado";

/** Un PDF verificado en la carpeta: un PDF de verdad y con peso de libro (no el aviso). */
export type ReadyFile = { id: string; title: string; bytes: number | null };

export type PresaleRow = {
  id: string; slug: string; name: string; image: string | null;
  storeId: string; storeName: string;
  days: number;
  since: string | null; readyAt: string | null;
  deliveryUrl: string | null;
  /** La otra forma de entregar: un archivo propio en Storage, cuando no hay carpeta de Drive. */
  deliveryFile: string | null;
  /** Los productos que son este libro: él, sus variantes y los packs que lo incluyen. */
  productIds: string[];
  /** Pedidos pagados que lo llevan. */
  orders: string[];
  /** De esos, a cuántos todavía no se les avisó que está (solo cuenta una vez listo). */
  pendingNotice: number;
  firstSale: string | null;
  due: string | null;
  hoursLeft: number | null;
  state: PresaleState;
  /** Los PDF que se verificaron al darlo por terminado (nombre, id de Drive y peso). */
  readyFiles: ReadyFile[];
  /** El aviso de preventa que sigue en la carpeta junto al libro terminado: hay que borrarlo antes de avisar. */
  leftoverNotices: { id: string; title: string }[];
  /** Lo prometido: cuántas páginas y el índice planificado (para quien lo escriba). */
  plannedPages: number | null;
  plannedOutline: string | null;
  /** Cuándo se mandó el último aviso «ya está» a los compradores. */
  noticedAt: string | null;
  /** En qué ofertas se vende (y cómo: bump, bonus, OTO), para saber de dónde es cada libro. */
  offers: { name: string; role: string }[];
};

/** «vence en 2 d 5 h», «vence en 3 h», «atrasado 1 d». */
export function dueText(r: Pick<PresaleRow, "hoursLeft" | "state">) {
  if (r.hoursLeft == null) return "sin ventas todavía";
  const h = Math.abs(r.hoursLeft);
  const t = h >= 24 ? `${Math.floor(h / 24)} d${Math.round(h % 24) ? ` ${Math.round(h % 24)} h` : ""}` : `${Math.max(1, Math.round(h))} h`;
  return r.hoursLeft <= 0 ? `atrasado ${t}` : `vence en ${t}`;
}

// --------------------------------------------------- la entrega con archivo propio

/**
 * El piso de peso del archivo propio (products.delivery_file). El de Drive (MIN_BOOK_BYTES, 1 MB)
 * existe para separar el libro del aviso de Word que vive en la MISMA carpeta; con archivo propio
 * no hay nada al lado que confundir, y entregas legitimas pesan mucho menos: la planilla de
 * valuacion son 31 KB y el PDF mas liviano que se entrega hoy, 189 KB. Con el piso de Drive, 19 de
 * los 35 archivos ya entregados quedarian marcados «todavia no». Esto es el piso de «hay un
 * archivo de verdad», no de «es un libro».
 */
export const MIN_FILE_BYTES = 20_000;

/**
 * Con que tiene que empezar el archivo segun su extension. Un .pdf que no empieza con «%PDF-» es
 * una pagina de error, algo a medio subir o un marcador de lugar, no la entrega.
 */
const MAGIC: { ext: RegExp; head: string; what: string }[] = [
  { ext: /\.pdf$/i, head: "%PDF-", what: "un PDF" },
  { ext: /\.(xlsx|docx|pptx|epub|odt|ods|zip)$/i, head: "PK\u0003\u0004", what: "un archivo de Office" },
];

/**
 * ¿El archivo propio es la entrega de verdad? Decision pura, para poder probarla contra los
 * archivos reales: `head` son los primeros bytes leidos como latin1 y `bytes` el tamaño total
 * (null si el servidor no lo dijo, y entonces no se juzga el peso).
 */
export function fileVerdict(name: string, head: string, bytes: number | null): { ok: boolean; why?: string } {
  const title = name.split("/").pop() || name;
  const magic = MAGIC.find((m) => m.ext.test(name));
  if (magic && !head.startsWith(magic.head)) return { ok: false, why: `«${title}» no es ${magic.what} de verdad` };
  if (bytes != null && bytes < MIN_FILE_BYTES) return { ok: false, why: `«${title}» pesa ${Math.round(bytes / 1000)} KB: no parece la entrega` };
  return { ok: true };
}
