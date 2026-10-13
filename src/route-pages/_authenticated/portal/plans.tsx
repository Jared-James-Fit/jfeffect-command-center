import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Sparkles, ArrowRight, Search as SearchIcon, LayoutGrid, List as ListIcon, Dumbbell } from "lucide-react";
import { listMembershipLibrary } from "@/lib/membership-library.functions";
import { getMyStartedPlan } from "@/lib/member-plan-start.functions";
import { getMyGoalsSetupFn } from "@/lib/client-goals/goals.functions";
import { deriveFacets, isFullBodyQuery, FULL_BODY_QUERY_ALIASES } from "@/lib/programs/facets";
import { CATEGORIES, type CategoryId, matchesCategory, groupBySections } from "@/lib/programs/categories";
import { rankRecommendations, isProfileReady } from "@/lib/programs/recommend";
import { ProgramCard } from "@/components/programs/program-card";
import { CategoryRail } from "@/components/programs/category-rail";
import { FiltersSheet, ActiveFilterChips, type FilterState } from "@/components/programs/filters-sheet";
import { ProgramFinder, type FinderItem } from "@/components/programs/program-finder";
import { StartPlanDialog } from "@/components/programs/start-plan-dialog";
import { useServiceTier } from "@/lib/service-tier";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type LibraryPlan = {
  id: string;
  name: string;
  public_title: string | null;
  description: string | null;
  training_style: string | null;
  difficulty: string | null;
  weeks: number | null;
  days_per_week: number | null;
  est_minutes_per_workout: number | null;
  goal: string | null;
  tags?: string[] | null;
  featured?: boolean | null;
  allow_full_program?: boolean | null;
};

const PAGE_SIZE = 24;

/**
 * The Plan Library in the portal: coach-written plans a JF member can start.
 * Starting one copies it into the member's own program (same engine a coach
 * uses), so Workouts, the logger, PRs and history are the same screens
 * coaching clients use.
 */
export function PortalPlanLibrary() {
  const { isCoaching } = useServiceTier();
  if (isCoaching) return <CoachWritesYourProgram />;
  return <Library />;
}

function CoachWritesYourProgram() {
  return (
    <div className="mx-auto w-full max-w-2xl pb-24">
      <PageHeader title="Plan Library" />
      <div className="px-4 py-4 md:px-8">
        <Card className="space-y-3 p-6 text-center">
          <Dumbbell className="mx-auto h-6 w-6 text-primary" />
          <p className="text-sm text-muted-foreground">Your coach writes your program. It's on your Workouts page.</p>
          <Button asChild size="sm">
            <Link to="/portal/workouts">Open Workouts</Link>
          </Button>
        </Card>
      </div>
    </div>
  );
}

function Library() {
  const fetchLibrary = useServerFn(listMembershipLibrary);
  const fetchGoals = useServerFn(getMyGoalsSetupFn);
  const fetchStarted = useServerFn(getMyStartedPlan);

  const [q, setQ] = useState("");
  const [category, setCategory] = useState<CategoryId>("recommended");
  const [filters, setFilters] = useState<FilterState>({});
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [starting, setStarting] = useState<LibraryPlan | null>(null);
  const [view, setView] = useState<"grid" | "finder">("grid");

  const { data, isLoading } = useQuery({
    queryKey: ["portal-plan-library"],
    queryFn: () => fetchLibrary(),
  });
  const { data: goalsRes } = useQuery({
    queryKey: ["m-goals-setup"],
    queryFn: () => fetchGoals(),
  });
  const { data: started } = useQuery({
    queryKey: ["my-started-plan"],
    queryFn: () => fetchStarted(),
  });

  const plans = (data?.plans ?? []) as LibraryPlan[];
  const goals = goalsRes?.goals ?? null;
  const profileReady = isProfileReady(goals);

  const decorated = useMemo(() => plans.map((p) => ({ program: p, facets: deriveFacets(p) })), [plans]);

  const topPicks = useMemo(() => {
    if (!profileReady || !goals) return [];
    return rankRecommendations(decorated, goals, 5, 3);
  }, [decorated, goals, profileReady]);
  const topPickIds = useMemo(() => new Set(topPicks.map((r) => (r.program as LibraryPlan).id)), [topPicks]);

  const effectiveCategory: CategoryId = category === "recommended" && !profileReady ? "all" : category;

  const matched = useMemo(() => {
    const query = q.trim().toLowerCase();
    const fbQuery = isFullBodyQuery(query);
    return decorated.filter(({ program, facets }) => {
      if (!matchesCategory(facets, effectiveCategory)) return false;
      if (query) {
        const hay = [
          program.public_title ?? "",
          program.name ?? "",
          program.description ?? "",
          (program.tags ?? []).join(" "),
          facets.isFullBody ? FULL_BODY_QUERY_ALIASES.join(" ") : "",
        ].join(" ").toLowerCase();
        if (!hay.includes(query) && !(fbQuery && facets.isFullBody)) return false;
      }
      if (filters.level && facets.level !== filters.level) return false;
      if (filters.daysPerWeek && facets.daysPerWeek !== filters.daysPerWeek) return false;
      if (filters.lengthMax && (facets.lengthMin ?? 99) > filters.lengthMax) return false;
      if (filters.location && facets.location !== filters.location) return false;
      if (filters.goal && !facets.goals.includes(filters.goal as any)) return false;
      if (filters.style && facets.style !== filters.style) return false;
      return true;
    });
  }, [decorated, q, filters, effectiveCategory]);

  const counts = useMemo(() => {
    const out: Partial<Record<CategoryId, number>> = {};
    for (const cat of CATEGORIES) {
      if (cat.id === "recommended") { out[cat.id] = topPicks.length; continue; }
      out[cat.id] = decorated.filter(({ facets }) => matchesCategory(facets, cat.id)).length;
    }
    return out;
  }, [decorated, topPicks.length]);

  const sliced = matched.slice(0, visibleCount);
  const grouped = effectiveCategory === "all" ? groupBySections(sliced) : null;

  const card = (p: LibraryPlan, facets: any) => (
    <ProgramCard
      key={p.id}
      id={p.id}
      title={p.public_title || p.name}
      description={p.description}
      facets={facets}
      featured={p.featured ?? undefined}
      reasons={topPickIds.has(p.id) ? topPicks.find((r) => (r.program as LibraryPlan).id === p.id)?.reasons : undefined}
      disabled={p.allow_full_program === false}
      previewTo={{ to: "/portal/plans/$planId", params: { planId: p.id } }}
      onAdd={() => setStarting(p)}
      addLabel="Start plan"
    />
  );

  return (
    <div className="mx-auto w-full max-w-5xl pb-24">
      <PageHeader title="Plan Library" subtitle="Coach-written plans. Pick one and start today." />
      <div className="space-y-5 px-4 py-4 md:px-8 md:py-6">
        {started?.name && (
          <Card className="flex flex-col gap-3 border-primary/30 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wider text-primary">Your plan</div>
              <div className="truncate font-semibold">{started.name}</div>
            </div>
            <Button asChild size="sm" className="shrink-0">
              <Link to="/portal/workouts">Open Workouts <ArrowRight className="ml-1 h-4 w-4" /></Link>
            </Button>
          </Card>
        )}

        <div className="flex w-fit items-center gap-1 rounded-md border border-border bg-muted/30 p-0.5">
          <button
            type="button"
            onClick={() => setView("grid")}
            className={cn("flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors",
              view === "grid" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
          >
            <LayoutGrid className="h-3.5 w-3.5" /> Grid
          </button>
          <button
            type="button"
            onClick={() => setView("finder")}
            className={cn("flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors",
              view === "finder" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
          >
            <ListIcon className="h-3.5 w-3.5" /> Finder
          </button>
        </div>

        {view === "finder" ? (
          <FinderView plans={plans} loading={isLoading} onStart={setStarting} />
        ) : (
          <>
            {effectiveCategory === "recommended" && topPicks.length > 0 && (
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Top Picks for You</h2>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {topPicks.map(({ program, facets }) => card(program as LibraryPlan, facets))}
                </div>
              </section>
            )}

            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:flex sm:flex-wrap">
              <div className="relative min-w-0 sm:max-w-xs">
                <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search plans"
                  value={q}
                  onChange={(e) => { setQ(e.target.value); setVisibleCount(PAGE_SIZE); }}
                  className="pl-8"
                />
              </div>
              <FiltersSheet
                value={filters}
                matchCount={matched.length}
                onChange={(v) => { setFilters(v); setVisibleCount(PAGE_SIZE); }}
              />
            </div>

            <CategoryRail
              value={effectiveCategory}
              counts={counts}
              profileReady={profileReady}
              onChange={(id) => { setCategory(id); setVisibleCount(PAGE_SIZE); }}
            />

            <ActiveFilterChips value={filters} onChange={setFilters} />

            <div className="text-xs text-muted-foreground">
              {isLoading ? "Loading plans…" : `${matched.length} plan${matched.length === 1 ? "" : "s"}`}
            </div>

            {isLoading ? null : matched.length === 0 ? (
              <Card className="space-y-3 p-6 text-center text-sm text-muted-foreground">
                <div>
                  {effectiveCategory === "full_body"
                    ? "No full-body plans match these filters."
                    : "No plans match. Try clearing filters or choosing a different category."}
                </div>
                {(Object.keys(filters).length > 0 || q || effectiveCategory !== "all") && (
                  <Button size="sm" variant="outline" onClick={() => { setFilters({}); setQ(""); setCategory("all"); }}>
                    Clear filters
                  </Button>
                )}
              </Card>
            ) : grouped ? (
              <div className="space-y-6">
                {grouped.map(({ section, items }) => (
                  <GroupedSection
                    key={section.id}
                    label={section.label}
                    items={items}
                    renderCard={({ program, facets }) => card(program as LibraryPlan, facets)}
                  />
                ))}
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {sliced.map(({ program, facets }) => card(program as LibraryPlan, facets))}
              </div>
            )}

            {!grouped && matched.length > visibleCount && (
              <div className="flex justify-center">
                <Button variant="outline" onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}>
                  Load more ({matched.length - visibleCount} remaining)
                </Button>
              </div>
            )}
          </>
        )}

        <StartPlanDialog plan={starting} open={!!starting} onOpenChange={(o) => !o && setStarting(null)} />
      </div>
    </div>
  );
}

function GroupedSection({
  label, items, renderCard,
}: {
  label: string;
  items: Array<{ program: unknown; facets: any }>;
  renderCard: (item: { program: unknown; facets: any }) => React.ReactNode;
}) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? items : items.slice(0, 6);
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{label}</h2>
        {items.length > 6 && (
          <button type="button" onClick={() => setShowAll((s) => !s)} className="text-xs font-medium text-primary hover:underline">
            {showAll ? "Show less" : `View all (${items.length})`}
          </button>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((it, i) => <div key={i}>{renderCard(it)}</div>)}
      </div>
    </section>
  );
}

function FinderView({
  plans, loading, onStart,
}: {
  plans: LibraryPlan[];
  loading: boolean;
  onStart: (p: LibraryPlan) => void;
}) {
  const items: FinderItem[] = useMemo(() => plans.map((p) => ({
    id: p.id,
    title: p.public_title || p.name,
    trainingStyle: p.training_style,
    level: p.difficulty,
    weeks: p.weeks,
    daysPerWeek: p.days_per_week,
    goal: p.goal,
    tags: p.tags ?? null,
    raw: p,
  })), [plans]);
  return (
    <ProgramFinder
      items={items}
      loading={loading}
      loadPayload={async (it) => {
        const { data } = await supabase.from("member_plans").select("published_payload").eq("id", it.id).maybeSingle();
        return (data as any)?.published_payload ?? null;
      }}
      renderActions={(it) => {
        const p = it.raw as LibraryPlan;
        if (p?.allow_full_program === false) return null;
        return <Button size="sm" onClick={() => onStart(p)}>Start plan</Button>;
      }}
    />
  );
}
