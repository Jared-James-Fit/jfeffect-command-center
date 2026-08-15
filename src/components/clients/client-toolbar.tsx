import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, X, ArrowUpDown, SlidersHorizontal } from "lucide-react";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";

const COACHING_TYPES = ["Online Coaching", "In-Person Coaching", "Hybrid Coaching", "Powerlifting", "Bodybuilding", "Fat Loss", "Muscle Gain", "Lifestyle"];
// Sort options intentionally limited to what the directory RPC supports.
// Labels re-worded to match the coach-first workflow.
const SORTS: { v: string; label: string }[] = [
  { v: "name",      label: "First Name (A–Z)" },
  { v: "recent",    label: "Recently Added" },
  { v: "activity",  label: "Recently Active" },
  { v: "attention", label: "Needs Attention" },
  { v: "ending",    label: "Program Ending Soon" },
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
};

export function ClientToolbar({ search, coachingType, coachId, coaches, sort, isAdmin, resultLabel }: Props) {
  const navigate = useNavigate({ from: "/admin/clients/" });
  const [local, setLocal] = useState(search);

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

  const hasFilters =
    !!search || (coachingType && coachingType !== "all") || !!coachId || sort !== "name";

  const activeMore = (coachingType && coachingType !== "all") || !!coachId;

  return (
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
        <div className="flex w-full items-center gap-2 overflow-x-auto sm:w-auto sm:overflow-visible">
          <Select value={sort} onValueChange={(v) => set({ sort: v })}>
            <SelectTrigger className="h-11 w-[190px] shrink-0" aria-label="Sort by">
              <ArrowUpDown className="mr-2 h-4 w-4" aria-hidden />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORTS.map((s) => <SelectItem key={s.v} value={s.v}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>

          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={
                  "relative h-11 shrink-0" + (activeMore ? " border-primary/50 text-primary" : "")
                }
                aria-label="More filters"
              >
                <SlidersHorizontal className="mr-2 h-4 w-4" />
                More Filters
                {activeMore && (
                  <span className="ml-2 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                    {(coachingType && coachingType !== "all" ? 1 : 0) + (coachId ? 1 : 0)}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Client Type</label>
                <Select value={coachingType || "all"} onValueChange={(v) => set({ coachingType: v === "all" ? undefined : v })}>
                  <SelectTrigger className="h-10" aria-label="Client type">
                    <SelectValue placeholder="All types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All types</SelectItem>
                    {COACHING_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {isAdmin && (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground">Coach</label>
                  <Select value={coachId ?? "all"} onValueChange={(v) => set({ coachId: v === "all" ? undefined : v })}>
                    <SelectTrigger className="h-10" aria-label="Assigned coach">
                      <SelectValue placeholder="All coaches" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All coaches</SelectItem>
                      {coaches.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.full_name ?? "(unnamed)"}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {activeMore && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  onClick={() => set({ coachingType: undefined, coachId: undefined })}
                >
                  Reset filters
                </Button>
              )}
            </PopoverContent>
          </Popover>

          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="h-11 shrink-0"
              onClick={() => navigate({ search: () => ({}), resetScroll: false })}
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
  );
}