import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A weight's other unit (dual-weight.ts), beside or under the weight as it was
 * typed: smaller, quieter and in the plain face, so it gives context without
 * competing (the weight in the athlete's own unit stays the hero). Normal case
 * and normal tracking even inside an uppercase display line, so "206.4 kg"
 * never reads "206.4 KG" in a condensed face. Renders nothing without a value.
 */
export function WeightOther({ children, className }: { children: ReactNode; className?: string }) {
  if (children == null || children === "" || children === false) return null;
  return (
    <span data-weight-other className={cn("font-sans font-semibold normal-case tracking-normal tabular-nums text-muted-foreground", className)}>
      {children}
    </span>
  );
}
