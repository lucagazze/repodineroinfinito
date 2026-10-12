import { Sk } from "@/components/admin/Skeleton";

/** La grilla de anuncios en gris mientras llega (1 columna en el celular). */
export default function Loading() {
  return (
    <div>
      <div className="ad-head"><div className="grid gap-2"><Sk w={160} h={26} /><Sk w={280} h={13} /></div></div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="ad-card overflow-hidden"><div className="sk" style={{ aspectRatio: "9 / 16" }} /><div className="grid gap-2 p-4"><Sk w="70%" h={14} /><Sk w="45%" h={12} /></div></div>
        ))}
      </div>
    </div>
  );
}
