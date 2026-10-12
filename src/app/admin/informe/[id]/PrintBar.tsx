"use client";

/** Barra de arriba del informe (no sale al imprimir): volver y «Guardar PDF». */
export default function PrintBar({ file }: { file: string }) {
  const save = () => {
    // El nombre del PDF sale del título de la página.
    const t = document.title;
    document.title = file;
    window.print();
    setTimeout(() => { document.title = t; }, 1000);
  };
  return (
    <div className="rp-print mx-auto mb-3 flex max-w-[820px] flex-wrap items-center justify-between gap-2">
      <button type="button" onClick={() => history.back()} className="rounded-lg bg-white/80 px-3 py-1.5 text-[12.5px] font-semibold text-zinc-800 shadow-sm hover:bg-white">← Volver al pedido</button>
      <div className="flex items-center gap-2">
        <span className="text-[11.5px] text-zinc-600">En inglés, para adjuntar a la disputa en Stripe.</span>
        <button type="button" onClick={save} className="rounded-lg bg-[#6d35e8] px-3.5 py-1.5 text-[12.5px] font-bold text-white shadow-sm hover:bg-[#5b2bc9]">Guardar PDF</button>
      </div>
    </div>
  );
}
