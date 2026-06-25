import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Sparkles, ArrowRight, Search as SearchIcon, LayoutGrid, List as ListIcon } from "lucide-react";
import { listMembershipLibrary, enrollLibraryPlan } from "@/lib/membership-library.functions";
import { getMyGoalsSetupFn } from "@/lib/client-goals/goals.functions";
import { deriveFacets, isFullBodyQuery, FULL_BODY_QUERY_ALIASES } from "@/lib/programs/facets";
import {
  CATEGORIES, type CategoryId, matchesCategory, groupBySections,
} from "@/lib/programs/categories";
import { rankRecommendations, isProfileReady } from "@/lib/programs/recommend";
import { ProgramCard } from "@/components/programs/program-card";
import { CategoryRail } from "@/components/programs/category-rail";
import { FiltersSheet, ActiveFilterChips, type FilterState } from "@/components/programs/filters-sheet";
import { ProgramFinder, type FinderItem } from "@/components/programs/program-finder";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/m/plans")({ component: PlanLibrary });

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

function PlanLibrary() {
  const fetchLibrary = useServerFn(listMembershipLibrary);
  const fetchGoals = useServerFn(getMyGoalsSetupFn);
  const enrollFn = useServerFn(enrollLibraryPlan);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [q, setQ] = useState("");
  const [category, setCategory] = useState<CategoryId>("recommended");
  const [filters, setFilters] = useState<FilterState>({});
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [conflictPlan, setConflictPlan] = useState<LibraryPlan | null>(null);
  const [view, setView] = useState<"grid" | "finder">("grid");

  const { data, isLoading } = useQuery({
    queryKey: ["m-membership-library"],
    queryFn: () => fetchLibrary(),
  });
  const { data: goalsRes } = useQuery({
    queryKey: ["m-goals-setup"],
    queryFn: () => fetchGoals(),
  });

  const plans = (data?.plans ?? []) as LibraryPlan[];
  const goals = goalsRes?.goals ?? null;
  const profileReady = isProfileReady(goals);

  // Derive facets once per plans list.
  const decorated = useMemo(
    () => plans.map((p) => ({ program: p, facets: deriveFacets(p) })),
    [plans],
  );

  // Top picks (only when profile is ready).
  const topPicks = useMemo(() => {
    if (!profileReady || !goals) return [];
    return rankRecommendations(decorated, goals, 5, 3);
  }, [decorated, goals, profileReady]);
  const topPickIds = useMemo(() => new Set(topPicks.map((r) => (r.program as LibraryPlan).id)), [topPicks]);

  // If profile isn't ready, default to "all" rather than "recommended".
  const effectiveCategory: CategoryId =
    category === "recommended" && !profileReady ? "all" : category;

  // Search + filter + category pipeline.
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
          // expose structured full-body so any alias (total body, whole body,
          // fullbody, full-body…) surfaces the same programs.
          facets.isFullBody ? FULL_BODY_QUERY_ALIASES.join(" ") : "",
        ].join(" ").toLowerCase();
        const matchesText = hay.includes(query);
        const matchesFullBody = fbQuery && facets.isFullBody;
        if (!matchesText && !matchesFullBody) return false;
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

  // Counts per category for the rail.
  const counts = useMemo(() => {
    const out: Partial<Record<CategoryId, number>> = {};
    for (const cat of CATEGORIES) {
      if (cat.id === "recommended") { out[cat.id] = topPicks.length; continue; }
      out[cat.id] = decorated.filter(({ facets }) => matchesCategory(facets, cat.id)).length;
    }
    return out;
  }, [decorated, topPicks.length]);

  const addToTraining = async (plan: LibraryPlan, confirmReplace = false) => {
    setPendingId(plan.id);
    try {
      const res = await enrollFn({
        data: {
          planId: plan.id,
          startDate: null,
          trainingDays: [],
          importMode: "full",
          confirmReplace,
        },
      });
      if (res.conflict) { setConflictPlan(plan); return; }
      toast.success("Added to your training");
      qc.invalidateQueries({ queryKey: ["m-enrollments"] });
      qc.invalidateQueries({ queryKey: ["m-active"] });
      navigate({ to: "/m/my-plans/$enrollmentId", params: { enrollmentId: res.enrollmentId! } });
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't add this program");
    } finally {
      setPendingId(null);
    }
  };

  const sliced = matched.slice(0, visibleCount);
  const grouped = effectiveCategory === "all" ? groupBySections(sliced) : null;

  return (
    <div className="space-y-5 pb-24">
      <PageHeader title="Program Library" subtitle="Find a program built around your goals." />

      <div className="flex items-center gap-1 rounded-md border border-border bg-muted/30 p-0.5 w-fit">
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
        <MemberFinderView plans={plans} loading={isLoading} pendingId={pendingId} onAdd={addToTraining} />
      ) : (<>

      {/* Top Picks for You */}
      {effectiveCategory === "recommended" && (
        profileReady && topPicks.length > 0 ? (
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Top Picks for You
              </h2>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {topPicks.map(({ program, facets, reasons }) => {
                const p = program as LibraryPlan;
                return (
                  <ProgramCard
                    key={p.id}
                    id={p.id}
                    title={p.public_title || p.name}
                    description={p.description}
                    facets={facets}
                    featured={p.featured ?? undefined}
                    reasons={reasons}
                    pending={pendingId === p.id}
                    disabled={p.allow_full_program === false}
                    previewTo={{ to: "/m/plans/$planId", params: { planId: p.id } }}
                    onAdd={() => addToTraining(p)}
                  />
                );
              })}
            </div>
          </section>
        ) : !profileReady ? (
          <Card className="border-dashed bg-primary/5 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div className="min-w-0">
                  <div className="font-semibold">Get personalized program recommendations</div>
                  <p className="text-sm text-muted-foreground">
                    Complete your Goals &amp; Setup so we can match programs to your goal, schedule, and experience.
                  </p>
                </div>
              </div>
              <Link to="/portal/goals-setup">
                <Button size="sm" className="shrink-0">Complete setup <ArrowRight className="ml-1 h-4 w-4" /></Button>
              </Link>
            </div>
          </Card>
        ) : null
      )}

      {/* Search + Filters */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:flex sm:flex-wrap">
        <div className="relative min-w-0 sm:max-w-xs">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search programs"
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
        {isLoading ? "Loading programs…" : `${matched.length} program${matched.length === 1 ? "" : "s"}`}
      </div>

      {isLoading ? null : matched.length === 0 ? (
        <Card className="space-y-3 p-6 text-center text-sm text-muted-foreground">
          <div>
            {effectiveCategory === "full_body"
              ? "No full-body programs match these filters."
              : "No programs match. Try clearing filters or choosing a different category."}
          </div>
          {(Object.keys(filters).length > 0 || q || effectiveCategory !== "all") && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => { setFilters({}); setQ(""); setCategory("all"); }}
            >
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
              renderCard={({ program, facets }) => {
                const p = program as LibraryPlan;
                const reasons = topPickIds.has(p.id) ? topPicks.find((r) => (r.program as LibraryPlan).id === p.id)?.reasons : undefined;
                return (
                  <ProgramCard
                    key={p.id}
                    id={p.id}
                    title={p.public_title || p.name}
                    description={p.description}
                    facets={facets}
                    featured={p.featured ?? undefined}
                    reasons={reasons}
                    pending={pendingId === p.id}
                    disabled={p.allow_full_program === false}
                    previewTo={{ to: "/m/plans/$planId", params: { planId: p.id } }}
                    onAdd={() => addToTraining(p)}
                  />
                );
              }}
            />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sliced.map(({ program, facets }) => {
            const p = program as LibraryPlan;
            const reasons = topPickIds.has(p.id) ? topPicks.find((r) => (r.program as LibraryPlan).id === p.id)?.reasons : undefined;
            return (
              <ProgramCard
                key={p.id}
                id={p.id}
                title={p.public_title || p.name}
                description={p.description}
                facets={facets}
                featured={p.featured ?? undefined}
                reasons={reasons}
                pending={pendingId === p.id}
                disabled={p.allow_full_program === false}
                previewTo={{ to: "/m/plans/$planId", params: { planId: p.id } }}
                onAdd={() => addToTraining(p)}
              />
            );
          })}
        </div>
      )}

      {!grouped && matched.length > visibleCount && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}>
            Load more ({matched.length - visibleCount} remaining)
          </Button>
        </div>
      )}
      </>)}

      <AlertDialog open={!!conflictPlan} onOpenChange={(o) => !o && setConflictPlan(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>You already have an active plan</AlertDialogTitle>
            <AlertDialogDescription>
              Adding <strong>{conflictPlan?.public_title || conflictPlan?.name}</strong> will end your current
              plan. Past workout logs and completed workouts will be preserved. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep current</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const p = conflictPlan;
                setConflictPlan(null);
                if (p) void addToTraining(p, true);
              }}
            >
              Switch plan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
          <button
            type="button"
            onClick={() => setShowAll((s) => !s)}
            className="text-xs font-medium text-primary hover:underline"
          >
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

function MemberFinderView({
  plans, loading, pendingId, onAdd,
}: {
  plans: LibraryPlan[];
  loading: boolean;
  pendingId: string | null;
  onAdd: (p: LibraryPlan) => void;
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
        const { data } = await supabase
          .from("member_plans")
          .select("published_payload")
          .eq("id", it.id)
          .maybeSingle();
        return (data as any)?.published_payload ?? null;
      }}
      renderActions={(it) => {
        const p = it.raw as LibraryPlan;
        if (p?.allow_full_program === false) return null;
        return (
          <Button size="sm" onClick={() => onAdd(p)} disabled={pendingId === p.id}>
            {pendingId === p.id ? "Adding…" : "Add to my training"}
          </Button>
        );
      }}
    />
  );
}

type FinderItemType = FinderItem;
