import type { ReactNode } from "react";
import { SectionLabel } from "@/components/ui/section-label";

/** A Home section's name: the app's one section label (SectionLabel), spaced for Home's stack. */
export function HomeSectionLabel({ children }: { children: ReactNode }) {
  return <SectionLabel className="mb-0 px-1 pt-1">{children}</SectionLabel>;
}
