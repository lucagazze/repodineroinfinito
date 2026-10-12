import { Suspense } from "react";
import { db } from "@/lib/db";
import { scopeFor } from "@/lib/admin/offers";
import { FolderOpen } from "lucide-react";
import { Card, CopyButton, EmptyState, PageHead } from "@/components/admin/ui";
import { IFolder } from "@/components/admin/icons";
import { SkCard } from "@/components/admin/Skeleton";

export const dynamic = "force-dynamic";

const FOLDER: Record<string, string> = { brand: "Marca", checkout: "Checkout", products: "Productos", productos: "Productos" };

/** Imágenes subidas de la tienda (logo, tapas, garantía). Versión simple: la rehace la próxima etapa del panel. */
export default async function Archivos({ params }: { params: Promise<{ offer: string }> }) {
  const sc = await scopeFor((await params).offer);
  // El encabezado al instante; el listado (Storage: la carpeta y después cada subcarpeta) llega con su esqueleto.
  return (
    <>
      <PageHead title="Archivos" sub="Las imágenes que subiste para esta tienda: logo, tapas de productos y sellos." icon={<FolderOpen className="h-[18px] w-[18px]" />} color="#f59e0b" />
      <Suspense fallback={<div data-skeleton className="ad-grid"><SkCard rows={4} /><SkCard rows={6} /></div>}>
        <Files slug={sc.store.slug} />
      </Suspense>
    </>
  );
}

async function Files({ slug }: { slug: string }) {
  const bucket = db.storage.from("media");
  const { data: top } = await bucket.list(slug, { limit: 100, sortBy: { column: "name", order: "asc" } });
  // Las carpetas vienen sin id; los archivos sueltos, con id.
  const folders = (top ?? []).filter((f) => !f.id).map((f) => f.name);
  const loose = (top ?? []).filter((f) => f.id);
  const lists = await Promise.all(folders.map(async (f) => {
    const { data } = await bucket.list(`${slug}/${f}`, { limit: 200, sortBy: { column: "created_at", order: "desc" } });
    return { folder: f, files: (data ?? []).filter((x) => x.id && !x.name.endsWith("-email.jpg")) };
  }));
  const groups = [...(loose.length ? [{ folder: "", files: loose }] : []), ...lists].filter((g) => g.files.length);
  const url = (folder: string, name: string) => bucket.getPublicUrl(`${slug}/${folder ? `${folder}/` : ""}${name}`).data.publicUrl;

  return (
    <>
      {groups.length ? (
        <div className="ad-grid">
          {groups.map((g) => (
            <Card key={g.folder || "raiz"} title={FOLDER[g.folder] ?? (g.folder || "Sueltos")} sub={`${g.files.length} archivos`}>
              <div data-pv-blur className="ad-grid g-3" style={{ gap: 12 }}>
                {g.files.map((f) => {
                  const u = url(g.folder, f.name);
                  return (
                    <div key={f.name} className="ad-steprow" style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u} alt="" loading="lazy" style={{ width: 52, height: 52, objectFit: "contain", borderRadius: 8, background: "var(--fill)", flexShrink: 0 }} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <b style={{ display: "block", fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</b>
                        <span className="ad-small ad-muted">{Math.round(Number((f.metadata as { size?: number } | null)?.size ?? 0) / 1024)} KB</span>
                      </div>
                      <CopyButton value={u} label="Link" className="ad-btn sm" />
                    </div>
                  );
                })}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card><EmptyState title="Todavía no subiste archivos" icon={<IFolder />}>Las imágenes que cargues en productos y en Configuración aparecen acá.</EmptyState></Card>
      )}
    </>
  );
}
