import type { ReactNode } from "react";

/** A Home section's name: small, quiet, the same everywhere. */
export function HomeSectionLabel({ children }: { children: ReactNode }) {
  return <h2 className="flex items-center gap-2 px-1 text-[11px] font-black uppercase tracking-[0.16em] text-muted-foreground">{children}</h2>;
}
