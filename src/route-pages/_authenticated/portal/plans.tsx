import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Search as SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { listMembershipLibrary } from "@/lib/membership-library.functions";
import { getMyGoalsSetupFn } from "@/lib/client-goals/goals.functions";
import { deriveFacets, isFullBodyQuery, FULL_BODY_QUERY_ALIASES } from "@/lib/programs/facets";
import { CATEGORIES, type CategoryId, matchesCategory, groupBySections } from "@/lib/programs/categories";
import { rankRecommendations, isProfileReady } from "@/lib/programs/recommend";
import { ProgramCard } from "@/components/programs/program-card";
import { CategoryRail } from "@/components/programs/category-rail";
import { FiltersSheet, ActiveFilterChips, type FilterState } from "@/components/programs/filters-sheet";
import { StartPlanDialog } from "@/components/programs/start-plan-dialog";
import { useSavedPlans } from "@/components/athlete-programs/use-saved-plans";
import { useClientImpersonation } from "@/lib/client-impersonation";

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
 * JF Effect plans: the coach-written library, as the Programs page's JF
 * Effect tab (the old /portal/plans page redirects there). A member saves one
 * to My programs or starts it: starting copies it into their own program (the
 * same engine a coach uses), so Workouts, the logger, PRs and history are the
 * same screens coaching clients use. Every card opens the plan's own page.
 */
export function PlanLibraryBody({
  runningPlanId = null,
  onSaved,
}: {
  /** the plan on their calendar, marked on its card */
  runningPlanId?: string | null;
  /** after a plan is saved (the hub offers a jump to My programs) */
  onSaved?: () => void;
}) {
  const fetchLibrary = useServerFn(listMembershipLibrary);
  const fetchGoals = useServerFn(getMyGoalsSetupFn);
  const { isImpersonating } = useClientImpersonation();
  const saved = useSavedPlans(!isImpersonating);

  const [q, setQ] = useState("");
  const [category, setCategory] = useState<CategoryId>("recommended");
  const [filters, setFilters] = useState<FilterState>({});
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [starting, setStarting] = useState<LibraryPlan | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["portal-plan-library"],
    queryFn: () => fetchLibrary(),
  });
  const { data: goalsRes } = useQuery({
    queryKey: ["m-goals-setup"],
    queryFn: () => fetchGoals(),
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

  const effectiveCategory: CategoryId =
    category === "recommended" && (!profileReady || topPicks.length === 0) ? "all" : category;
  const filtering = !!q.trim() || Object.values(filters).some((v) => v !== undefined && v !== "");
  // Picked for you: only the picks, with one tap to everything (a search or filter searches everything)
  const showingPicks = effectiveCategory === "recommended" && !filtering;

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
  const grouped = effectiveCategory === "all" && !filtering ? groupBySections(sliced) : null;

  const toggleSave = (p: LibraryPlan) => {
    if (isImpersonating) return toast.message("Preview only: this is how it looks to them.");
    const save = !saved.isSaved(p.id);
    saved.toggle.mutate(
      { planId: p.id, save },
      {
        onSuccess: () => {
          if (save) {
            toast.success("Saved to My programs");
            onSaved?.();
          }
        },
        onError: (e: any) => toast.error(e?.message ?? "Couldn't save it. Try again."),
      },
    );
  };

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
      saved={saved.isSaved(p.id)}
      onToggleSave={() => toggleSave(p)}
      running={p.id === runningPlanId}
    />
  );
  const clearAll = () => { setFilters({}); setQ(""); setCategory("all"); };

  // Nothing in the library yet: say so plainly and point at what works now,
  // never a search box, filters and "No plans match" over an empty shelf.
  if (!isLoading && !isError && plans.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card px-6 py-10 text-center" data-plan-library-empty>
        <div className="text-[16px] font-semibold">JF Effect plans are on the way</div>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
          Coach-written plans will show up here. Until then, build your own or start one the crew shared.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button asChild>
            <Link to="/portal/programs/new">Build your own</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link to="/portal/programs" search={{ tab: "crew" } as any}>Crew programs</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-plan-library>
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            placeholder="Search JF Effect plans"
            aria-label="Search JF Effect plans"
            value={q}
            onChange={(e) => { setQ(e.target.value); setVisibleCount(PAGE_SIZE); }}
            className="h-11 pl-9 text-base"
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

      {isLoading ? (
        <div className="space-y-3" aria-hidden>
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[150px] w-full rounded-2xl" />)}
        </div>
      ) : isError ? (
        <div className="rounded-2xl border border-border bg-card px-6 py-10 text-center">
          <div className="text-[16px] font-semibold">Couldn't load the plans</div>
          <p className="mt-1 text-sm text-muted-foreground">Check your connection.</p>
          <Button variant="secondary" className="mt-4" onClick={() => refetch()}>Try again</Button>
        </div>
      ) : matched.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card px-6 py-10 text-center">
          <div className="text-[16px] font-semibold">No plans match</div>
          <p className="mt-1 text-sm text-muted-foreground">
            {effectiveCategory === "full_body" ? "No full-body plans match these filters." : "Try another category or clear the filters."}
          </p>
          {(Object.keys(filters).length > 0 || q || effectiveCategory !== "all") && (
            <Button variant="secondary" className="mt-4" onClick={clearAll}>Clear filters</Button>
          )}
        </div>
      ) : showingPicks ? (
        <section className="space-y-3">
          <h2 className="text-[13px] font-semibold text-muted-foreground">Picked for you from your goals</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {topPicks.map(({ program, facets }) => card(program as LibraryPlan, facets))}
          </div>
          <Button variant="ghost" className="h-11 w-full text-[14px]" onClick={() => setCategory("all")}>
            See all {plans.length} plans
          </Button>
        </section>
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
        <>
          <div className="text-[13px] text-muted-foreground">{matched.length} plan{matched.length === 1 ? "" : "s"}</div>
          <div className="grid gap-3 sm:grid-cols-2">
            {sliced.map(({ program, facets }) => card(program as LibraryPlan, facets))}
          </div>
        </>
      )}

      {!grouped && !showingPicks && matched.length > visibleCount && (
        <Button variant="secondary" className="h-11 w-full" onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}>
          Show more ({matched.length - visibleCount})
        </Button>
      )}

      <StartPlanDialog plan={starting} open={!!starting} onOpenChange={(o) => !o && setStarting(null)} />
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
  const shown = showAll ? items : items.slice(0, 4);
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[13px] font-semibold text-muted-foreground">{label}</h2>
        {items.length > 4 && (
          <button
            type="button"
            onClick={() => setShowAll((s) => !s)}
            className="-my-2 h-10 px-1 text-[13px] font-medium text-foreground"
          >
            {showAll ? "Show less" : `All ${items.length}`}
          </button>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {shown.map((it, i) => <div key={i}>{renderCard(it)}</div>)}
      </div>
    </section>
  );
}
