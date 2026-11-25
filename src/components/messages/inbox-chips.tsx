import type { ReactNode } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { PRIMARY_FILTERS, chipCount, type PrimaryFilter } from "@/lib/inbox-filters";
import { UNREAD_DOT } from "@/components/messages/chat-list-row";

/** Instagram's chip: the one you're on is a grey fill, the rest outlined. */
export function chipClass(on: boolean, counted = false) {
  return cn(
    "inline-flex h-8 shrink-0 items-center rounded-full border text-[15px] font-semibold text-foreground transition",
    counted ? "pl-3.5 pr-1.5" : "px-3.5",
    on ? "border-transparent bg-secondary" : "border-border bg-background hover:bg-secondary/60",
  );
}

/** The blue count on Unread: the same number as the Messages tab's badge. */
export function ChipCount({ n, tone = "unread" }: { n: number; tone?: "unread" | "quiet" }) {
  return (
    <span
      data-chip-count
      className={cn(
        "ml-1.5 inline-block h-5 min-w-5 rounded-full px-1.5 text-center text-[12px] font-bold leading-5 tabular-nums",
        tone === "unread" ? cn(UNREAD_DOT, "text-white") : "bg-foreground/10 text-foreground",
      )}
    >
      {chipCount(n)}
    </span>
  );
}

/**
 * The search field every Messages list starts with, then the four filters:
 * All · Unread · Groups · 1:1 Chats (one row, the same for coaches and
 * clients). `actions` sit beside the search (the coach's Filter and ⋯);
 * `leading` is the coach's active filter, a chip that clears it.
 */
export function InboxControls({
  query,
  onQuery,
  placeholder = "Search",
  filter,
  onFilter,
  unread = 0,
  leading,
  trailing,
  actions,
  className,
}: {
  query: string;
  onQuery: (q: string) => void;
  placeholder?: string;
  filter: PrimaryFilter;
  onFilter: (f: PrimaryFilter) => void;
  /** Chats with something new: shown on Unread. */
  unread?: number;
  /** Before the four (the coach's active filter, as a chip that clears it). */
  leading?: ReactNode;
  trailing?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2.5 px-4 pb-2 pt-1", className)} data-inbox-controls>
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={placeholder}
            aria-label="Search chats"
            className="h-10 w-full rounded-full border border-border bg-secondary/40 pl-10 pr-9 text-[16px] outline-none placeholder:text-muted-foreground focus:border-primary/50 focus:bg-background [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              onClick={() => onQuery("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full bg-muted-foreground/30 text-background"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {actions}
      </div>
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Filter chats">
        {leading}
        {PRIMARY_FILTERS.map(({ key, label }) => {
          const n = key === "unread" ? unread : 0;
          const on = filter === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={on}
              data-primary-filter={key}
              aria-label={n ? `${label}, ${n}` : label}
              onClick={() => onFilter(key)}
              className={chipClass(on, n > 0)}
            >
              {label}
              {n > 0 && <ChipCount n={n} />}
            </button>
          );
        })}
        {trailing}
      </div>
    </div>
  );
}
