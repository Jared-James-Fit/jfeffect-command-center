import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Placeholders in the shape of what's coming, for the loading system's
 * common shapes. Each holds its space from the first frame and fades in only
 * after LOAD_TIMING.showAfterMs (`.jf-load-reveal`), so a fast answer never
 * flashes it. Pages with a shape of their own keep their own skeletons.
 */

function Frame({ className, label, children }: { className?: string; label?: string; children: React.ReactNode }) {
  return (
    <div className={cn("jf-load-reveal", className)} role="status" aria-label={label ?? "Loading"} data-load-state="loading">
      {children}
    </div>
  );
}

/** Rows of a list: a circle or square, a name line and a detail line. */
export function ListSkeleton({
  rows = 4,
  avatar = true,
  className,
  label,
}: {
  rows?: number;
  avatar?: boolean;
  className?: string;
  label?: string;
}) {
  return (
    <Frame className={cn("space-y-3", className)} label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          {avatar && <Skeleton className="h-10 w-10 shrink-0 rounded-full" />}
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3.5" style={{ width: `${60 - ((i * 13) % 25)}%` }} />
            <Skeleton className="h-3 w-[38%]" />
          </div>
        </div>
      ))}
    </Frame>
  );
}

/** A card: a title line and a few lines of body. */
export function CardSkeleton({ lines = 3, className, label }: { lines?: number; className?: string; label?: string }) {
  return (
    <Frame className={cn("space-y-3 rounded-2xl border border-border p-4", className)} label={label}>
      <Skeleton className="h-4 w-36" />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className="h-3" style={{ width: `${92 - i * 14}%` }} />
      ))}
    </Frame>
  );
}

/** A row of number tiles (a dashboard's or the books' figures). */
export function StatTilesSkeleton({ count = 4, className, label }: { count?: number; className?: string; label?: string }) {
  return (
    <Frame className={cn("grid grid-cols-2 gap-3 sm:grid-cols-4", className)} label={label}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="space-y-2 rounded-2xl border border-border p-3">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-6 w-20" />
        </div>
      ))}
    </Frame>
  );
}

/** A table: a header and rows of cells. */
export function TableSkeleton({
  rows = 5,
  cols = 4,
  className,
  label,
}: {
  rows?: number;
  cols?: number;
  className?: string;
  label?: string;
}) {
  return (
    <Frame className={cn("space-y-2", className)} label={label}>
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {Array.from({ length: cols }, (_, c) => (
          <Skeleton key={c} className="h-3 w-2/3" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="grid gap-3 border-t border-border/60 pt-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} className="h-3.5" style={{ width: `${85 - ((r + c) * 11) % 40}%` }} />
          ))}
        </div>
      ))}
    </Frame>
  );
}

/** A chart: its title and a plot area with a few bars. */
export function ChartSkeleton({ height = 180, className, label }: { height?: number; className?: string; label?: string }) {
  return (
    <Frame className={cn("space-y-3", className)} label={label}>
      <Skeleton className="h-4 w-32" />
      <div className="flex items-end gap-2" style={{ height }}>
        {[45, 70, 55, 85, 60, 75, 50, 90].map((h, i) => (
          <Skeleton key={i} className="flex-1 rounded-sm" style={{ height: `${h}%` }} />
        ))}
      </div>
    </Frame>
  );
}

/** A chat thread: bubbles from both sides. */
export function ThreadSkeleton({ className, label }: { className?: string; label?: string }) {
  const bubbles: Array<{ mine: boolean; w: string; h: string }> = [
    { mine: false, w: "62%", h: "h-10" },
    { mine: true, w: "48%", h: "h-8" },
    { mine: false, w: "70%", h: "h-14" },
    { mine: true, w: "40%", h: "h-8" },
    { mine: false, w: "55%", h: "h-10" },
  ];
  return (
    <Frame className={cn("flex flex-col gap-3 px-4 py-4", className)} label={label ?? "Loading messages"}>
      {bubbles.map((b, i) => (
        <Skeleton key={i} className={cn(b.h, "rounded-2xl", b.mine && "self-end")} style={{ width: b.w }} />
      ))}
    </Frame>
  );
}

/** A page's body inside the shell: a header block and a few cards. */
export function PageSkeleton({ className, label }: { className?: string; label?: string }) {
  return (
    <Frame className={cn("space-y-4", className)} label={label}>
      <Skeleton className="h-7 w-40" />
      <Skeleton className="h-36 w-full rounded-2xl" />
      <Skeleton className="h-24 w-full rounded-2xl" />
      <Skeleton className="h-24 w-full rounded-2xl" />
    </Frame>
  );
}
