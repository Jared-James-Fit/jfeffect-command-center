import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, X, ArrowUpDown, SlidersHorizontal, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DirectoryCounts } from "@/lib/clients-directory.functions";
import { serializeFilterKeys, toggleFilterKey, type DirectoryFilterKey } from "@/lib/clients-directory-filters";
import { ClientFilterRail, ActiveFilterSummary } from "./client-filter-rail";
import { ClientFilterSheet } from "./client-filter-sheet";
import type { FilterMatch } from "./clients-status";

export type Lifecycle = "active" | "archived" | "deactivated";
const LIFECYCLES: { v: Lifecycle; label: string }[] = [
  { v: "active", label: "Active" },
  { v: "archived", label: "Archived" },
  { v: "deactivated", label: "Deactivated" },
];

// Sort options intentionally limited to what the directory RPC supports.
// Labels re-worded to match the coach-first workflow, and kept short enough to show in full on a phone.
const SORTS: { v: string; label: string }[] = [
  { v: "name",      label: "Name (A–Z)" },
  { v: "recent",    label: "Recently Added" },
  { v: "activity",  label: "Recently Active" },
  { v: "attention", label: "Needs Attention" },
  { v: "ending",    label: "Program Ending" },
];

type Props = {
  search: string;
  coachingType: string;
  coachId: string | null;
  coaches: { id: string; full_name: string | null }[];
  sort: string;
  isAdmin: boolean;
  /** Compact result count — only rendered when search/filters are active. */
  resultLabel?: string | null;
  /** The "what's missing / needs attention" filters switched on. */
  flags: DirectoryFilterKey[];
  /** Several filters: clients with any of them (default) or all of them. */
  match: FilterMatch;
  lifecycle: Lifecycle;
  counts: DirectoryCounts | undefined;
  /** How many clients the current filters show. */
  total: number;
  loading: boolean;
};

export function ClientToolbar({
  search, coachingType, coachId, coaches, sort, isAdmin, resultLabel, flags, match, lifecycle, counts, total, loading,
}: Props) {
  const navigate = useNavigate({ from: "/admin/clients/" });
  const [local, setLocal] = useState(search);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Debounce search → URL
  useEffect(() => { setLocal(search); }, [search]);
  useEffect(() => {
    if (local === search) return;
    const t = setTimeout(() => {
      navigate({ search: (prev: any) => ({ ...prev, search: local || undefined, page: 1 }), resetScroll: false });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local]);

  const set = (patch: Record<string, any>) =>
    navigate({ search: (prev: any) => ({ ...prev, ...patch, page: 1 }), resetScroll: false });

  // `status` is the older single-filter spelling of the URL; clearing it keeps a bookmarked
  // ?status=… link from reviving a filter the coach just switched off.
  const setFlags = (next: DirectoryFilterKey[]) =>
    set({ flags: serializeFilterKeys(next), status: undefined, ...(next.length < 2 ? { match: undefined } : {}) });
  const toggleFlag = (key: DirectoryFilterKey) => setFlags(toggleFilterKey(flags, key));
  const setMatch = (m: FilterMatch) => set({ match: m === "all" ? "all" : undefined });
  // Another tab (Active / Archived / Deactivated) starts with no filters.
  const setLifecycle = (v: Lifecycle) =>
    navigate({
      search: (prev: any) => ({
        ...prev,
        lifecycle: v === "active" ? undefined : v,
        status: "all",
        flags: undefined,
        match: undefined,
        page: 1,
      }),
      resetScroll: false,
    });

  // The chips have their own Clear in the line under them; this one is for everything else.
  const hasFilters =
    !!search || (coachingType && coachingType !== "all") || !!coachId || sort !== "name";

  const activeCount =
    flags.length + (coachingType && coachingType !== "all" ? 1 : 0) + (coachId ? 1 : 0);

  return (
    <>
    <div className="sticky top-0 z-20 -mx-3 mb-2 border-b border-border/60 bg-background/95 px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/70 sm:mx-0 sm:rounded-lg sm:border">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        {/* Search — pinned first, full-width on mobile */}
        <div className="relative w-full sm:min-w-[14rem] sm:flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={local}
            onChange={(e) => setLocal(e.target.value)}
            placeholder="Search clients…"
            className="h-11 pl-9 pr-9"
            aria-label="Search clients"
          />
          {local && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setLocal("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Compact filter row — one horizontal line, no wrapping unless it must */}
        <div className="flex w-full items-center gap-1.5 overflow-x-auto sm:w-auto sm:gap-2 sm:overflow-visible">
          <Select value={lifecycle} onValueChange={(v) => setLifecycle(v as Lifecycle)}>
            <SelectTrigger
              className={cn("h-11 w-[124px] shrink-0 font-semibold", lifecycle !== "active" && "border-foreground/40")}
              aria-label="Which clients"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LIFECYCLES.map((l) => <SelectItem key={l.v} value={l.v}>{l.label}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={sort} onValueChange={(v) => set({ sort: v })}>
            <SelectTrigger className="h-11 w-[160px] shrink-0 sm:w-[190px]" aria-label="Sort by">
              <ArrowUpDown className="mr-2 hidden h-4 w-4 sm:inline" aria-hidden />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORTS.map((s) => <SelectItem key={s.v} value={s.v}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>

          {/* Phones: just the icon (and its count), so Active, Sort and Filters fit on one line. */}
          <Button
            variant="outline"
            size="sm"
            className={cn("relative h-11 min-w-11 shrink-0 gap-1.5 px-2.5 sm:px-3", activeCount > 0 && "border-foreground/40")}
            aria-label={activeCount > 0 ? `Filters, ${activeCount} on` : "Filters"}
            onClick={() => setSheetOpen(true)}
          >
            <SlidersHorizontal className="h-4 w-4" />
            <span className="hidden sm:inline">Filters</span>
            {activeCount > 0 && (
              <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-foreground px-1 text-[10px] font-bold text-background">
                {activeCount}
              </span>
            )}
          </Button>

          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="h-11 shrink-0 px-2"
              onClick={() =>
                // Back to the default view, but stay on the same tab (Active / Archived / Deactivated).
                navigate({ search: (prev: any) => ({ lifecycle: prev.lifecycle }), resetScroll: false })
              }
            >
              Clear
            </Button>
          )}

          {resultLabel && (
            <div className="ml-auto whitespace-nowrap text-xs text-muted-foreground">{resultLabel}</div>
          )}
        </div>
      </div>
    </div>

    <ClientFilterRail flags={flags} counts={counts} onToggle={toggleFlag} />
    <ActiveFilterSummary
      flags={flags}
      match={match}
      total={total}
      all={counts?.all}
      loading={loading}
      onMatch={setMatch}
      onClear={() => setFlags([])}
      extra={
        // The bulk "remind everyone unsigned" already lives on the Agreements page.
        isAdmin && flags.includes("no_contract") ? (
          <Link
            to="/admin/coaching-agreements"
            className="mt-2.5 inline-flex items-center gap-0.5 text-xs font-medium text-primary hover:underline"
          >
            Remind everyone who hasn't signed, on the Agreements page
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        ) : null
      }
    />
    <ClientFilterSheet
      open={sheetOpen}
      onOpenChange={setSheetOpen}
      flags={flags}
      match={match}
      onMatch={setMatch}
      counts={counts}
      total={total}
      loading={loading}
      coachingType={coachingType}
      coachId={coachId}
      coaches={coaches}
      isAdmin={isAdmin}
      onToggleFlag={toggleFlag}
      onChange={set}
      onClearAll={() => set({ flags: undefined, status: undefined, match: undefined, coachingType: undefined, coachId: undefined })}
    />
    </>
  );
}
