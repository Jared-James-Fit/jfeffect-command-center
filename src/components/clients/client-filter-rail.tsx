import { Fragment, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DirectoryCounts } from "@/lib/clients-directory.functions";
import type { DirectoryFilterKey } from "@/lib/clients-directory-filters";
import { FILTER_GROUPS, STATUS_META } from "./clients-status";

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

/**
 * One tap to filter, and the counts show at a glance what is missing across every client.
 * Groups: what's missing, what needs attention, account. One scrolling line on a phone; one row
 * per group on a computer. Several selected at once means "clients who match all of these".
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
  return (
    <div
      role="group"
      aria-label="Quick filters"
      data-testid="filter-rail"
      className="-mx-3 overflow-x-auto px-3 pb-1 [scrollbar-width:none] sm:mx-0 sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden"
    >
      <div className="flex w-max items-center gap-1.5 sm:w-auto sm:flex-col sm:items-start sm:gap-2">
        {FILTER_GROUPS.map((group, i) => (
          <Fragment key={group.key}>
            {i > 0 && <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-border sm:hidden" />}
            <div className="flex items-center gap-1.5 sm:flex-wrap">
              <span className="shrink-0 pr-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:w-28">
                {group.label}
              </span>
              {group.keys.map((key) => {
                const meta = STATUS_META[key];
                const Icon = meta.icon;
                const selected = flags.includes(key);
                const count = counts?.[key];
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onToggle(key)}
                    className={cn(
                      "inline-flex h-9 shrink-0 cursor-pointer touch-manipulation items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition",
                      selected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card hover:border-primary/40",
                      !selected && count === 0 && "opacity-60",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden />
                    {meta.label}
                    {count !== undefined && (
                      <span
                        className={cn(
                          "rounded-full px-1.5 text-[10px] font-semibold tabular-nums",
                          selected ? "bg-primary-foreground/20" : countPillClass(meta.tone, count),
                        )}
                      >
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

/**
 * Says what the selected filters mean, in plain words, so nobody has to guess what a chip
 * finds, and that several filters narrow the list. Each one can be removed on its own.
 */
export function ActiveFilterSummary({
  flags,
  total,
  loading,
  onToggle,
  onClear,
  extra,
}: {
  flags: DirectoryFilterKey[];
  total: number;
  loading: boolean;
  onToggle: (key: DirectoryFilterKey) => void;
  onClear: () => void;
  /** One more line under the list, for a next step that suits the current filters. */
  extra?: ReactNode;
}) {
  if (flags.length === 0) return null;
  const heading =
    flags.length === 1 ? "Showing clients who match:" : `Showing clients who match all ${flags.length} of:`;
  return (
    <div data-testid="active-filters" className="rounded-xl border border-border bg-card/60 p-3 text-xs">
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold">
          {heading}{" "}
          <span className="font-normal text-muted-foreground">
            {loading ? "Loading…" : `${total} client${total === 1 ? "" : "s"}`}
          </span>
        </p>
        <button
          type="button"
          onClick={onClear}
          className="-m-1 shrink-0 cursor-pointer rounded p-1 font-medium text-primary hover:underline"
        >
          Clear
        </button>
      </div>
      <ul className="mt-2 space-y-1.5">
        {flags.map((key) => {
          const meta = STATUS_META[key];
          const Icon = meta.icon;
          return (
            <li key={key} className="flex items-start gap-2">
              <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 leading-snug">
                <span className="font-semibold">{meta.label}</span>
                <span className="text-muted-foreground">: {meta.hint}</span>
              </span>
              <button
                type="button"
                aria-label={`Remove ${meta.label} filter`}
                onClick={() => onToggle(key)}
                className="-m-1 shrink-0 cursor-pointer rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
      {extra}
    </div>
  );
}
