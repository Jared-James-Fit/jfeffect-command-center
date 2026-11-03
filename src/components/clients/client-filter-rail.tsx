import { Fragment, type ReactNode } from "react";
import { Check, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DirectoryCounts } from "@/lib/clients-directory.functions";
import type { DirectoryFilterKey } from "@/lib/clients-directory-filters";
import { MATCH_HINT, STATUS_META, quickFilterKeys, type FilterMatch } from "./clients-status";

/** A little number that says how many clients each filter would show. Quiet when it's zero. */
export function countPillClass(tone: (typeof STATUS_META)[DirectoryFilterKey]["tone"], count: number | undefined) {
  if (!count) return "bg-muted text-muted-foreground";
  switch (tone) {
    case "danger":
      return "bg-destructive/15 text-destructive";
    case "warn":
      return "bg-amber-500/15 text-amber-500";
    case "info":
      return "bg-blue-500/15 text-blue-400";
    case "ok":
      return "bg-emerald-500/15 text-emerald-500";
    default:
      return "bg-muted text-muted-foreground";
  }
}

const DOT: Record<(typeof STATUS_META)[DirectoryFilterKey]["tone"], string> = {
  danger: "bg-destructive",
  warn: "bg-amber-500",
  info: "bg-blue-400",
  ok: "bg-emerald-500",
  neutral: "bg-muted-foreground",
};

/**
 * One tap to filter: only the filters with someone in them (plus any picked), most urgent first,
 * each with how many clients it finds. One scrolling line on a phone, wrapping on a computer.
 * Empty filters wait in the Filters sheet. Several picked: Any or All, in the summary under it.
 */
export function ClientFilterRail({
  flags,
  counts,
  onToggle,
}: {
  flags: DirectoryFilterKey[];
  counts: DirectoryCounts | undefined;
  onToggle: (key: DirectoryFilterKey) => void;
}) {
  if (!counts) {
    return (
      <div aria-hidden className="flex h-9 gap-1.5 overflow-hidden" data-testid="filter-rail-loading">
        {[112, 136, 96, 120].map((w) => (
          <span key={w} className="h-9 shrink-0 animate-pulse rounded-full bg-muted" style={{ width: w }} />
        ))}
      </div>
    );
  }
  const groups = quickFilterKeys(counts, flags);
  if (!groups.length) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="filter-rail-clear">
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" aria-hidden />
        Nothing needs your attention right now.
      </p>
    );
  }
  return (
    <div
      role="group"
      aria-label="Quick filters"
      data-testid="filter-rail"
      className="-mx-3 overflow-x-auto px-3 [scrollbar-width:none] sm:mx-0 sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden"
    >
      <div className="flex w-max items-center gap-1.5 sm:w-auto sm:flex-wrap">
        {groups.map((group, i) => (
          <Fragment key={group.key}>
            {i > 0 && <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-border" />}
            {group.keys.map((key) => {
              const meta = STATUS_META[key];
              const selected = flags.includes(key);
              const count = counts[key] ?? 0;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={selected}
                  title={meta.hint}
                  onClick={() => onToggle(key)}
                  className={cn(
                    "inline-flex h-9 shrink-0 cursor-pointer touch-manipulation items-center gap-2 rounded-full border px-3 text-[13px] font-medium transition-colors",
                    // Picked reads in neutral, like every in-page toggle; red is for the screen's one action.
                    selected
                      ? "border-foreground/40 bg-secondary text-foreground"
                      : "border-border bg-card hover:border-foreground/25 hover:bg-accent/40",
                  )}
                >
                  {selected ? (
                    <Check className="h-3.5 w-3.5" aria-hidden />
                  ) : (
                    <span aria-hidden className={cn("h-2 w-2 rounded-full", DOT[meta.tone])} />
                  )}
                  {meta.label}
                  <span className="tabular-nums text-muted-foreground">
                    {count}
                  </span>
                </button>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

/** Any (at least one of the picked filters) or All (every one). */
export function MatchToggle({ value, onChange, className }: { value: FilterMatch; onChange: (m: FilterMatch) => void; className?: string }) {
  return (
    <div role="radiogroup" aria-label="Match" className={cn("inline-flex items-center gap-1.5", className)}>
      <span className="text-muted-foreground">Match</span>
      <span className="inline-flex rounded-full border border-border bg-muted/40 p-0.5">
        {(["any", "all"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={value === m}
            title={MATCH_HINT[m]}
            onClick={() => onChange(m)}
            className={cn(
              "h-7 cursor-pointer rounded-full px-3 text-xs font-semibold capitalize transition-colors",
              value === m ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {m}
          </button>
        ))}
      </span>
    </div>
  );
}

/**
 * One line under the chips while any are picked: how many clients show, Any / All when there's
 * more than one, what a single filter finds, and Clear.
 */
export function ActiveFilterSummary({
  flags,
  match,
  total,
  all,
  loading,
  onMatch,
  onClear,
  extra,
}: {
  flags: DirectoryFilterKey[];
  match: FilterMatch;
  total: number;
  /** Everyone in the list before these filters. */
  all: number | undefined;
  loading: boolean;
  onMatch: (m: FilterMatch) => void;
  onClear: () => void;
  /** One more line under it, for a next step that suits the current filters. */
  extra?: ReactNode;
}) {
  if (flags.length === 0) return null;
  return (
    <div data-testid="active-filters" className="space-y-1.5 text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="font-semibold tabular-nums">
          {loading ? "Loading…" : `${total}${all != null ? ` of ${all}` : ""} client${(all ?? total) === 1 ? "" : "s"}`}
        </span>
        {flags.length > 1 ? (
          <MatchToggle value={match} onChange={onMatch} />
        ) : (
          <span className="min-w-0 flex-1 truncate text-muted-foreground">{STATUS_META[flags[0]!].hint}</span>
        )}
        <button
          type="button"
          onClick={onClear}
          className="-m-1 ml-auto shrink-0 cursor-pointer rounded p-1 font-semibold text-primary hover:underline"
        >
          Clear
        </button>
      </div>
      {extra}
    </div>
  );
}
