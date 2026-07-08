import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Check, RefreshCw, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type AnalyticsBlock,
  blockYear,
  distinctYears,
  matchesQuery,
  parseLocalDate,
  programKeyForBlock,
  statusLabel,
} from "@/lib/analytics/blocks";

export interface BlockPickerSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blocks: AnalyticsBlock[];
  selectedBlockId?: string | null;
  resolvedCurrentBlockId?: string | null;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  onSelect: (block: AnalyticsBlock) => void;
}

type YearKey = number | "older" | "unscheduled" | "all";

const CURRENT_YEAR_WINDOW = 3; // years shown as individual chips before "Older"

function formatDateRange(b: AnalyticsBlock): string {
  const s = parseLocalDate(b.start_date);
  const e = parseLocalDate(b.end_date);
  if (!s && !e) return "Not scheduled";
  if (s && e) {
    const sameYear = s.getFullYear() === e.getFullYear();
    return sameYear
      ? `${format(s, "MMM d")}–${format(e, "MMM d, yyyy")}`
      : `${format(s, "MMM d, yyyy")}–${format(e, "MMM d, yyyy")}`;
  }
  if (s) return `from ${format(s, "MMM d, yyyy")}`;
  return `until ${format(e!, "MMM d, yyyy")}`;
}

function statusToneClass(
  status: ReturnType<typeof statusLabel>,
): string {
  // Text label conveys meaning; colour is redundant support only.
  switch (status) {
    case "Current":
      return "border-primary/50 bg-primary/10 text-primary";
    case "Upcoming":
      return "border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400";
    case "Completed":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
    case "Previous":
      return "border-border bg-muted text-muted-foreground";
    case "Draft":
    case "Unscheduled":
      return "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

function chooseDefaultYear(
  years: number[],
  selectedBlockId: string | null | undefined,
  resolvedCurrentBlockId: string | null | undefined,
  blocks: AnalyticsBlock[],
): YearKey {
  const yearOf = (id: string | null | undefined) => {
    if (!id) return null;
    const b = blocks.find((x) => x.id === id);
    return b ? blockYear(b) : null;
  };
  const y1 = yearOf(selectedBlockId);
  if (y1) return years.includes(y1) ? y1 : "all";
  const y2 = yearOf(resolvedCurrentBlockId);
  if (y2) return years.includes(y2) ? y2 : "all";
  const now = new Date().getFullYear();
  if (years.includes(now)) return now;
  return years.length ? "all" : "all";
}

export function BlockPickerSheet({
  open,
  onOpenChange,
  blocks,
  selectedBlockId,
  resolvedCurrentBlockId,
  isLoading,
  isError,
  onRetry,
  onSelect,
}: BlockPickerSheetProps) {
  const [query, setQuery] = useState("");
  const years = useMemo(() => distinctYears(blocks), [blocks]);
  const hasUnscheduled = useMemo(() => blocks.some((b) => !b.start_date), [blocks]);
  const [year, setYear] = useState<YearKey>(() =>
    chooseDefaultYear(years, selectedBlockId, resolvedCurrentBlockId, blocks),
  );
  // Reopening the picker should return to the selected block's year.
  useEffect(() => {
    if (!open) return;
    setYear(chooseDefaultYear(years, selectedBlockId, resolvedCurrentBlockId, blocks));
    setQuery("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Year chip set: latest N years + "Older" bucket + "Unscheduled / Draft" + "All Years".
  const recentYears = years.slice(0, CURRENT_YEAR_WINDOW);
  const olderYears = years.slice(CURRENT_YEAR_WINDOW);
  const yearChips: { key: YearKey; label: string; count: number }[] = [];
  for (const y of recentYears) {
    yearChips.push({
      key: y,
      label: String(y),
      count: blocks.filter((b) => blockYear(b) === y).length,
    });
  }
  if (olderYears.length > 0) {
    yearChips.push({
      key: "older",
      label: "Older",
      count: blocks.filter((b) => {
        const y = blockYear(b);
        return y != null && olderYears.includes(y);
      }).length,
    });
  }
  if (hasUnscheduled) {
    yearChips.push({
      key: "unscheduled",
      label: "Unscheduled / Draft",
      count: blocks.filter((b) => !b.start_date).length,
    });
  }
  yearChips.push({ key: "all", label: "All Years", count: blocks.length });

  const filtered = useMemo(() => {
    let list = blocks;
    if (year !== "all") {
      list = list.filter((b) => {
        const y = blockYear(b);
        if (year === "unscheduled") return !b.start_date;
        if (year === "older") return y != null && olderYears.includes(y);
        return y === year;
      });
    }
    if (query.trim()) list = list.filter((b) => matchesQuery(b, query));
    return list;
  }, [blocks, year, query, olderYears]);

  // Group by program (pl_preps.title / event_name / "Unassigned Program").
  const groups = useMemo(() => {
    const m = new Map<string, { title: string; items: AnalyticsBlock[] }>();
    for (const b of filtered) {
      const { key, title } = programKeyForBlock(b);
      const bucket = m.get(key) ?? { title, items: [] };
      bucket.items.push(b);
      m.set(key, bucket);
    }
    // Sort blocks within each program per Step 11.
    const today = new Date();
    const todayIso = today.toISOString().slice(0, 10);
    const currentIdCmp = resolvedCurrentBlockId ?? null;
    for (const bucket of m.values()) {
      bucket.items.sort((a, b) => {
        if (currentIdCmp) {
          if (a.id === currentIdCmp) return -1;
          if (b.id === currentIdCmp) return 1;
        }
        const aFuture = !!a.start_date && a.start_date > todayIso;
        const bFuture = !!b.start_date && b.start_date > todayIso;
        const aDated = !!a.start_date;
        const bDated = !!b.start_date;
        if (aDated !== bDated) return aDated ? -1 : 1; // undated last
        if (aFuture !== bFuture) return aFuture ? -1 : 1;
        if (aFuture && bFuture) {
          return (a.start_date ?? "").localeCompare(b.start_date ?? "");
        }
        // both past/current with dates → desc by start_date
        const cmp = (b.start_date ?? "").localeCompare(a.start_date ?? "");
        if (cmp !== 0) return cmp;
        return (b.sort_order ?? 0) - (a.sort_order ?? 0);
      });
    }
    // Program sort: program with the current block first, then most-recent activity.
    return [...m.entries()]
      .sort(([, aB], [, bB]) => {
        const aHasCurrent = currentIdCmp && aB.items.some((x) => x.id === currentIdCmp);
        const bHasCurrent = currentIdCmp && bB.items.some((x) => x.id === currentIdCmp);
        if (aHasCurrent && !bHasCurrent) return -1;
        if (bHasCurrent && !aHasCurrent) return 1;
        const aLatest = aB.items
          .map((x) => x.start_date ?? "")
          .sort()
          .pop() ?? "";
        const bLatest = bB.items
          .map((x) => x.start_date ?? "")
          .sort()
          .pop() ?? "";
        return bLatest.localeCompare(aLatest);
      })
      .map(([, v]) => v);
  }, [filtered, resolvedCurrentBlockId]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full max-w-[520px] flex-col p-0 sm:max-w-[520px]"
      >
        <SheetHeader className="border-b border-border p-4">
          <SheetTitle className="text-base font-black uppercase tracking-wider">
            Browse Training Blocks
          </SheetTitle>
          <div className="relative mt-3">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search programs or blocks"
              className="h-10 pl-7"
              autoFocus
              aria-label="Search programs or blocks"
            />
          </div>
          {/* Year chips */}
          {(yearChips.length > 1 || isLoading) && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {isLoading
                ? Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-11 w-16 rounded-full" />
                  ))
                : yearChips.map((c) => (
                    <button
                      key={String(c.key)}
                      type="button"
                      onClick={() => setYear(c.key)}
                      className={cn(
                        "min-h-11 rounded-full border px-3 text-xs font-bold transition-colors",
                        year === c.key
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-card text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {c.label}
                      <span className="ml-1 text-[10px] opacity-70">{c.count}</span>
                    </button>
                  ))}
            </div>
          )}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-4 pb-24">
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full rounded-lg" />
              ))}
            </div>
          ) : isError ? (
            <div className="mx-auto max-w-sm space-y-4 py-10 text-center">
              <AlertTriangle className="mx-auto h-8 w-8 text-amber-500" />
              <p className="text-sm text-foreground">
                Training blocks could not be loaded.
              </p>
              <Button
                type="button"
                onClick={onRetry}
                size="lg"
                className="w-full gap-2"
              >
                <RefreshCw className="h-4 w-4" /> Try Again
              </Button>
            </div>
          ) : blocks.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No training blocks are available yet.
            </p>
          ) : filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No matching training blocks found.
            </p>
          ) : (
            <div className="space-y-6">
              {groups.map((g) => (
                <section key={g.title}>
                  <h3 className="mb-2 text-[11px] font-black uppercase tracking-widest text-muted-foreground">
                    {g.title}
                  </h3>
                  <ul className="space-y-2">
                    {g.items.map((b) => {
                      const status = statusLabel(b, resolvedCurrentBlockId);
                      const isSelected = b.id === selectedBlockId;
                      const isCurrent = b.id === resolvedCurrentBlockId;
                      return (
                        <li key={b.id}>
                          <button
                            type="button"
                            onClick={() => {
                              onSelect(b);
                              onOpenChange(false);
                            }}
                            className={cn(
                              "flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                              isSelected
                                ? "border-primary bg-primary/5"
                                : "border-border bg-card hover:border-primary/50 hover:bg-primary/5",
                            )}
                          >
                            <div className="mt-0.5 h-5 w-5 shrink-0 rounded-full border flex items-center justify-center">
                              {isSelected && (
                                <Check className="h-3.5 w-3.5 text-primary" aria-hidden />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="truncate text-sm font-bold text-foreground">
                                  {b.name || "Untitled Block"}
                                </span>
                                {isCurrent && (
                                  <Badge className="border-primary/50 bg-primary/10 text-primary">
                                    Current
                                  </Badge>
                                )}
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "border text-[10px] font-semibold",
                                    statusToneClass(status),
                                  )}
                                >
                                  {status}
                                </Badge>
                              </div>
                              <div className="mt-0.5 text-[11px] text-muted-foreground">
                                {formatDateRange(b)}
                                {b.weeks ? ` · ${b.weeks} week${b.weeks === 1 ? "" : "s"}` : ""}
                                {b.training_focus ? ` · ${b.training_focus}` : ""}
                              </div>
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}