import type { Network } from "@/lib/network";

/** La red social de donde vino (visita o compra), en un chip chico: «IG», «FB», «MSG», «AN». */
const NET: Record<Network, { short: string; cls: string }> = {
  Instagram: { short: "IG", cls: "bg-pink-500/15 text-pink-300 ring-pink-500/25" },
  Facebook: { short: "FB", cls: "bg-blue-500/15 text-blue-300 ring-blue-500/25" },
  Messenger: { short: "MSG", cls: "bg-violet-500/15 text-violet-300 ring-violet-500/25" },
  "Audience Network": { short: "AN", cls: "bg-zinc-500/15 text-zinc-300 ring-zinc-500/25" },
};

export default function NetChip({ n, long }: { n: Network | null | undefined; long?: boolean }) {
  if (!n) return null;
  const x = NET[n];
  return (
    <span title={`Llegó desde ${n}`} className={`inline-flex shrink-0 items-center rounded-md px-1.5 py-[1px] text-[10.5px] font-semibold ring-1 ring-inset ${x.cls}`}>
      {long ? n : x.short}
    </span>
  );
}
