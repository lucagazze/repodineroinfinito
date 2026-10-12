"use client";

import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { resolveAlert, isResolved, useAlerts } from "./alerts-store";

/**
 * Una fila de Avisos con su «Resuelto»: al tocarlo se va de la lista de
 * abiertos al instante (la campanita baja a la vez) y queda «Deshacer» 5 s.
 * Con el filtro «Resueltos» o «Todos» la fila queda, marcada como resuelta.
 */
export default function AlertRow({ id, title, resolved, keep, className, children, actions }: {
  id: string; title: string; resolved: boolean; keep: boolean; className: string; children: ReactNode; actions?: ReactNode;
}) {
  useAlerts();
  const done = resolved || isResolved(id);
  if (done && !resolved && !keep) return null;
  return (
    <li className={`${className} ${done ? "opacity-55" : ""}`}>
      {children}
      <div className="flex shrink-0 items-center gap-1.5">
        {actions}
        {done
          ? <span className="ad-badge ok">Resuelto</span>
          : (
            <button type="button" className="ad-btn sm" onClick={() => void resolveAlert(id, title)} title="Marcar como resuelto">
              <Check className="h-3.5 w-3.5" /> Resuelto
            </button>
          )}
      </div>
    </li>
  );
}
