import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type PageSwitcherItem<K extends string> = { key: K; label: string; icon: LucideIcon; count?: number };

/**
 * Big segmented tabs pinned under the header while the page scrolls: the
 * Clients · Members · Team switch, and Books · Payments.
 */
export function PageSwitcher<K extends string>({ items, value, onChange, label }: {
  items: PageSwitcherItem<K>[];
  value: K;
  onChange: (k: K) => void;
  label: string;
}) {
  return (
    <div className="sticky top-0 z-30 bg-background/95 px-3 pb-2 pt-2 backdrop-blur supports-[backdrop-filter]:bg-background/85 sm:px-4 md:top-[41px] md:px-6">
      <div
        role="tablist"
        aria-label={label}
        className="grid gap-1 rounded-2xl border border-border bg-card p-1 shadow-sm"
        style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      >
        {items.map(({ key, label: text, icon: Icon, count }) => {
          const active = key === value;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(key)}
              className={cn(
                "flex min-h-[44px] min-w-0 items-center justify-center gap-1.5 rounded-xl px-1.5 text-[13px] font-semibold transition-colors sm:text-sm",
                active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
              )}
            >
              <Icon className={cn("h-4 w-4 shrink-0", items.length > 2 && "hidden sm:block")} />
              <span className="truncate">{text}</span>
              {count != null && (
                <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", active ? "bg-primary-foreground/20" : "bg-muted")}>{count}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
