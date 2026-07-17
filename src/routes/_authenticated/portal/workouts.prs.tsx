import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePortalUserId } from "@/lib/client-impersonation";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Trophy, Search } from "lucide-react";
import { getClientResults, recentPRs } from "@/lib/pl-programs";
import {
  SearchableSelect,
  type SearchableOption,
} from "@/components/analytics/searchable-select";
import { PRCard } from "@/components/analytics/pr-card";
import { exerciseColor, exerciseGroup } from "@/lib/analytics-format";

type Unit = "lb" | "kg";
const LB_PER_KG = 2.2046226;
function convertWeight(value: number, from: Unit, to: Unit) {
  if (!value || from === to) return value;
  return to === "lb" ? value * LB_PER_KG : value / LB_PER_KG;
}

export const Route = createFileRoute("/_authenticated/portal/workouts/prs")({
  component: AllPRsPage,
});

const PAGE_SIZE = 24;

function AllPRsPage() {
  const portalUserId = usePortalUserId();
  const { data: client } = useQuery({
    queryKey: ["my-client-prs", portalUserId],
    enabled: !!portalUserId,
    staleTime: 60_000,
    queryFn: async () =>
      (
        await supabase
          .from("clients")
          .select("id, full_name, preferred_weight_unit")
          .eq("user_id", portalUserId!)
          .maybeSingle()
      ).data,
  });

  const sourceUnit: Unit = "lb";
  const preferredUnit: Unit = client?.preferred_weight_unit === "kg" ? "kg" : "lb";
  const [displayUnit, setDisplayUnit] = useState<Unit>(preferredUnit);
  const [unitSynced, setUnitSynced] = useState(false);
  useEffect(() => {
    if (client && !unitSynced) {
      setDisplayUnit(preferredUnit);
      setUnitSynced(true);
    }
  }, [client, preferredUnit, unitSynced]);
  const conv = (v: number) => convertWeight(Number(v) || 0, sourceUnit, displayUnit);

  const { data: results = [], isLoading } = useQuery({
    queryKey: ["pl-results-all", client?.id],
    enabled: !!client?.id,
    staleTime: 30_000,
    queryFn: () => getClientResults(client!.id),
  });

  const prs = useMemo(
    () => recentPRs(results as any[], 365000),
    [results],
  );

  const [exFilter, setExFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [visible, setVisible] = useState(PAGE_SIZE);
  useEffect(() => setVisible(PAGE_SIZE), [exFilter, search]);

  const exOptions: SearchableOption[] = useMemo(() => {
    const names = Array.from(new Set(prs.map((p: any) => p.exercise_name)));
    return [
      { value: "all", label: "All exercises" },
      ...names.map((n) => ({
        value: n,
        label: n,
        color: exerciseColor(n),
        group: exerciseGroup(n),
      })),
    ];
  }, [prs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return prs.filter((p: any) => {
      if (exFilter !== "all" && p.exercise_name !== exFilter) return false;
      if (q && !String(p.exercise_name).toLowerCase().includes(q)) return false;
      return true;
    });
  }, [prs, exFilter, search]);

  const shown = filtered.slice(0, visible);

  return (
    <div className="mx-auto max-w-6xl space-y-4 pb-24">
      <PageHeader
        title={
          <div className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-primary" />
            <span>All PRs</span>
          </div>
        }
        description={client?.full_name ?? undefined}
        actions={
          <Link
            to="/portal/workouts/analytics"
            className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Analytics
          </Link>
        }
      />

      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_240px]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search exercise…"
            className="pl-9"
            aria-label="Search PR exercise"
          />
        </div>
        <SearchableSelect
          options={exOptions}
          value={exFilter}
          onChange={setExFilter}
          placeholder="Filter exercise"
          searchPlaceholder="Search PR exercise…"
          emptyText="No exercises match your search."
          triggerClassName="h-10"
          ariaLabel="Filter PRs by exercise"
        />
      </div>

      <div className="text-xs font-semibold text-muted-foreground">
        {isLoading ? "Loading…" : `${filtered.length} PR${filtered.length === 1 ? "" : "s"}`}
      </div>

      {filtered.length === 0 ? (
        <Card className="p-6 text-base text-muted-foreground">
          {prs.length === 0 ? "No PRs yet — keep training!" : "No PRs match your filters."}
        </Card>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {shown.map((p: any) => (
              <PRCard key={p.id} pr={p} displayUnit={displayUnit} conv={conv} dense />
            ))}
          </div>
          {visible < filtered.length && (
            <div className="flex justify-center pt-4">
              <Button variant="outline" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
                Load more ({filtered.length - visible} remaining)
              </Button>
            </div>
          )}
        </>
      )}

      {/* Unit toggle kept minimal; page inherits preferred unit. */}
      <div className="pt-2 text-center text-[11px] text-muted-foreground">
        Displayed in {displayUnit.toUpperCase()} ·{" "}
        <button
          type="button"
          onClick={() => setDisplayUnit((u) => (u === "lb" ? "kg" : "lb"))}
          className="font-semibold text-primary hover:underline"
        >
          switch to {displayUnit === "lb" ? "KG" : "LB"}
        </button>
      </div>
    </div>
  );
}