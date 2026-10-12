"use client";

import { useEffect } from "react";
import { track } from "@/lib/track-client";

/** Registra cada clic en «Descargar» (site_events), sin frenar la descarga. */
export function DownloadTracker({ order }: { order: string }) {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest<HTMLAnchorElement>("a[data-dl]");
      if (a) track("gracias", "download", { product: a.dataset.dl, order });
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [order]);
  return null;
}
