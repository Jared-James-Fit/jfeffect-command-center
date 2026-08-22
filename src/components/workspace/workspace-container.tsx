import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Canonical client-workspace layout primitives.
 *
 * ROOT CAUSE of the "pages shift and overflow" bug: every tab invented its
 * own width. The shell had padding but no max-width/centering, and each
 * TabsContent used `grid md:grid-cols-3` whose implicit `minmax(auto, 1fr)`
 * tracks grow to their widest child (tables, nowrap rows, min-w-max strips).
 * A single wide card therefore stretched the whole grid past 100vw, which
 * produced page-level horizontal scroll and a different container width on
 * every tab.
 *
 * Fix: one container (centered, max-width, safe-area padding, no overflow-x)
 * plus grid tracks pinned to `minmax(0,1fr)` so children can shrink/truncate.
 */

export const WORKSPACE_CONTAINER_CLASS =
  "mx-auto w-full min-w-0 max-w-7xl overflow-x-clip px-4 py-4 md:px-8 md:py-6 " +
  "[padding-left:max(1rem,env(safe-area-inset-left))] [padding-right:max(1rem,env(safe-area-inset-right))] md:[padding-left:2rem] md:[padding-right:2rem]";

/** Grid used by every tab panel. Tracks can shrink → no page overflow. */
export const WORKSPACE_GRID_CLASS =
  "grid w-full min-w-0 grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-[repeat(3,minmax(0,1fr))]";

/** A card that spans the full workspace grid width on every breakpoint. */
export const WORKSPACE_FULL_SPAN_CLASS = "min-w-0 md:col-span-3";

export function ClientWorkspaceContainer({
  children,
  className,
  compact,
}: {
  children: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn(WORKSPACE_CONTAINER_CLASS, compact && "px-3 py-3 md:px-6 md:py-4", className)}>
      {children}
    </div>
  );
}
