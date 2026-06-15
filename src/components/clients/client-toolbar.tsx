import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, X, ArrowUpDown } from "lucide-react";

const COACHING_TYPES = ["Online Coaching", "In-Person Coaching", "Hybrid Coaching", "Powerlifting", "Bodybuilding", "Fat Loss", "Muscle Gain", "Lifestyle"];
const SORTS: { v: string; label: string }[] = [
  { v: "attention", label: "Needs attention first" },
  { v: "recent",    label: "Recently added" },
  { v: "name",      label: "Name A–Z" },
  { v: "ending",    label: "Program ending soonest" },
  { v: "activity",  label: "Last activity" },
];

type Props = {
  search: string;
  coachingType: string;
  coachId: string | null;
  coaches: { id: string; full_name: string | null }[];
  sort: string;
  isAdmin: boolean;
  totalLabel: string;
};

export function ClientToolbar({ search, coachingType, coachId, coaches, sort, isAdmin, totalLabel }: Props) {
  const navigate = useNavigate({ from: "/admin/clients" });
  const [local, setLocal] = useState(search);

  // Debounce search → URL
  useEffect(() => { setLocal(search); }, [search]);
  useEffect(() => {
    if (local === search) return;
    const t = setTimeout(() => {
      navigate({ search: (prev: any) => ({ ...prev, search: local || undefined, page: 1 }) });
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local]);

  const set = (patch: Record<string, any>) =>
    navigate({ search: (prev: any) => ({ ...prev, ...patch, page: 1 }) });

  const hasFilters =
    !!search || (coachingType && coachingType !== "all") || !!coachId || sort !== "attention";

  return (
    <div className="sticky top-0 z-20 -mx-3 mb-3 border-b border-border/60 bg-background/95 px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/70 sm:mx-0 sm:rounded-lg sm:border">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[14rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={local}
            onChange={(e) => setLocal(e.target.value)}
            placeholder="Search name, email, or phone…"
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

        <Select value={coachingType || "all"} onValueChange={(v) => set({ coachingType: v === "all" ? undefined : v })}>
          <SelectTrigger className="h-11 w-[160px]" aria-label="Coaching type">
            <SelectValue placeholder="Coaching type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {COACHING_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>

        {isAdmin && (
          <Select value={coachId ?? "all"} onValueChange={(v) => set({ coachId: v === "all" ? undefined : v })}>
            <SelectTrigger className="h-11 w-[160px]" aria-label="Assigned coach">
              <SelectValue placeholder="Coach" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All coaches</SelectItem>
              {coaches.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.full_name ?? "(unnamed)"}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Select value={sort} onValueChange={(v) => set({ sort: v })}>
          <SelectTrigger className="h-11 w-[200px]" aria-label="Sort">
            <ArrowUpDown className="mr-2 h-4 w-4" aria-hidden />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORTS.map((s) => <SelectItem key={s.v} value={s.v}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>

        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="h-11"
            onClick={() => navigate({ search: () => ({}) })}
          >
            Clear filters
          </Button>
        )}

        <div className="ml-auto whitespace-nowrap text-xs text-muted-foreground">{totalLabel}</div>
      </div>
    </div>
  );
}