import { cn } from "@/lib/utils";
import { compareBars, type CrewCompare } from "@/lib/community";

/** Two bars, habit vs everyone else, with how many people each side is. */
export function CompareBars({ compare, className }: { compare: CrewCompare; className?: string }) {
  return (
    <div className={cn("space-y-2.5", className)}>
      {compareBars(compare).map((r) => (
        <div key={r.label}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 truncate text-[12px] font-bold">
              {r.label}
              <span className="font-semibold text-muted-foreground"> · {r.count}</span>
            </span>
            <span className="shrink-0 text-[12px] font-black">{r.value}</span>
          </div>
          <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-muted">
            <div className={cn("h-full rounded-full", r.lead ? "bg-primary" : "bg-foreground/25")} style={{ width: `${Math.max(4, Math.round(r.share * 100))}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
