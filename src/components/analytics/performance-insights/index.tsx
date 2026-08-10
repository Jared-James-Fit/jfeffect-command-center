import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronDown, Sparkles } from "lucide-react";
import {
  detectFocus,
  generateInsights,
  muscleGroupStats,
  powerliftingStats,
  resolveWindow,
  topMuscleGroups,
  coachExtras,
  type CompLiftStat,
  type InsightSet,
  type PerformanceInsight,
  type TimeWindow,
} from "@/lib/analytics/performance-insights";
import { PerformanceTimeFilter } from "./time-filter";
import { MuscleGroupGrid } from "./muscle-group-grid";
import { TopMuscleGroupsCard } from "./top-muscle-groups";
import { PowerliftingPanel } from "./powerlifting-panel";
import { SmartInsights } from "./smart-insights";
import { CoachExtrasCard } from "./coach-extras";
import { ShareSheet } from "./share-sheet";
import type { ShareCardData } from "./share-card";
import { MUSCLE_EMOJI } from "@/lib/analytics/muscle-map";
import { convFromLb, type DisplayUnit } from "@/lib/workout-units";
import { InfoTip } from "@/components/analytics/info-tip";

const LB_PER_KG = 2.2046226;

export function PerformanceInsights({
  clientId,
  clientName,
  clientFocus,
  variant = "client",
  displayUnit = "lb",
}: {
  clientId: string;
  clientName?: string | null;
  clientFocus?: string | null;
  variant?: "client" | "coach";
  displayUnit?: DisplayUnit;
}) {
  const [expanded, setExpanded] = useState(false);
  const [window, setWindow] = useState<TimeWindow>("month");
  const [shareOpen, setShareOpen] = useState(false);
  const [shareData, setShareData] = useState<ShareCardData | null>(null);

  const { data: sets = [], isLoading } = useQuery({
    queryKey: ["performance-insights-sets", clientId],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async (): Promise<InsightSet[]> => {
      const { data } = await supabase
        .from("pl_row_results")
        .select(
          "actual_load, actual_load_unit, entered_value, entered_unit, normalized_lb, normalized_kg, actual_reps, actual_rpe, completed_at, pl_exercise_rows(exercises(name, primary_muscle_group, muscle_group, muscle_groups, is_competition_lift, competition_lift_type, lift_family, variation_type, counts_toward_volume, volume_multiplier))",
        )
        .eq("client_id", clientId)
        .not("actual_reps", "is", null)
        .order("completed_at", { ascending: false })
        .limit(5000);
      return (data ?? []).map((r: any) => {
        let load_lb = 0;
        if (r.normalized_lb != null) load_lb = Number(r.normalized_lb) || 0;
        else if (r.normalized_kg != null) load_lb = (Number(r.normalized_kg) || 0) * LB_PER_KG;
        else {
          const raw = Number(r.entered_value ?? r.actual_load) || 0;
          const unit = (r.entered_unit ?? r.actual_load_unit ?? "lb") as string;
          load_lb = unit === "kg" ? raw * LB_PER_KG : raw;
        }
        const ex = r.pl_exercise_rows?.exercises ?? {};
        return {
          date: r.completed_at,
          load_lb,
          reps: Number(r.actual_reps) || 0,
          rpe: r.actual_rpe ?? null,
          exercise_name: ex.name ?? "Unknown",
          primary_muscle: ex.primary_muscle_group ?? ex.muscle_group ?? null,
          secondary_muscles: Array.isArray(ex.muscle_groups) ? ex.muscle_groups : null,
          is_competition_lift: !!ex.is_competition_lift,
          competition_lift_type: ex.competition_lift_type ?? null,
          lift_family: ex.lift_family ?? null,
          variation_type: ex.variation_type ?? null,
          counts_toward_volume: ex.counts_toward_volume !== false,
          volume_multiplier: Number(ex.volume_multiplier ?? 1) || 1,
        } as InsightSet;
      });
    },
  });

  const range = useMemo(() => resolveWindow(window), [window]);
  const conv = (lb: number) => Math.round(convFromLb(lb, displayUnit));
  const fmtTon = (lb: number) => `${conv(lb).toLocaleString()} ${displayUnit}`;
  // Sets inside the selected window — teaser + insights are window-scoped.
  const windowSets = useMemo(() => {
    if (!range) return sets;
    return sets.filter((s) => {
      const t = new Date(s.date).getTime();
      return !Number.isNaN(t) && t >= range.start && t <= range.end;
    });
  }, [sets, range]);
  const stats = useMemo(() => muscleGroupStats(sets, range), [sets, range]);
  const top = useMemo(() => topMuscleGroups(stats, sets, range), [stats, sets, range]);
  const pl = useMemo(() => powerliftingStats(sets, range), [sets, range]);
  const insights = useMemo(
    // eslint-disable-next-line react-hooks/exhaustive-deps
    () => generateInsights(stats, top, pl, windowSets, range, fmtTon),
    [stats, top, pl, windowSets, range, displayUnit],
  );
  const focus = useMemo(
    () => detectFocus(sets, { client_focus: clientFocus }),
    [sets, clientFocus],
  );

  // Coach extras (adherence, missed volume). Only compute when expanded coach view.
  const { data: prescribed } = useQuery({
    queryKey: ["performance-insights-prescribed", clientId, range.start, range.end],
    enabled: variant === "coach" && expanded,
    staleTime: 60_000,
    queryFn: async () => {
      // Sum of pl_exercise_rows.sets for days whose date falls in the window
      // is expensive to compute exactly without day dates; approximate via
      // total scheduled sets on this client's programs. Best-effort only.
      const { data } = await supabase
        .from("pl_exercise_rows")
        .select("sets, pl_days!inner(pl_weeks!inner(pl_blocks!inner(client_id)))")
        .eq("pl_days.pl_weeks.pl_blocks.client_id", clientId);
      return (data ?? []).reduce((s: number, r: any) => s + (Number(r.sets) || 0), 0);
    },
  });

  const teaser = useMemo(() => {
    const totalTonnage = windowSets.reduce((s, r) => s + r.load_lb * r.reps, 0);
    const topMuscle = top.most_trained?.group;
    const trend = top.biggest_growth?.trend_pct;
    return {
      tonnage: conv(totalTonnage),
      topMuscle: topMuscle ?? "—",
      trend: trend != null ? `${trend > 0 ? "+" : ""}${trend}%` : "—",
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowSets, top, displayUnit]);

  function openShareForInsight(i: PerformanceInsight) {
    setShareData({
      eyebrow: "Performance insight",
      headline: i.headline,
      subline: i.subline,
      stats: i.metric ? [{ emoji: i.emoji, label: i.metric.label, value: i.metric.value }] : undefined,
      athleteName: clientName ?? undefined,
    });
    setShareOpen(true);
  }

  function openShareForMuscle(group: string, s: (typeof stats)[number]) {
    setShareData({
      eyebrow: `${group} training summary`,
      headline: `${Math.round(s.monthly_sets)} sets`,
      subline: `${fmtTon(s.monthly_tonnage)} moved over the last 30 days.`,
      stats: [
        { emoji: MUSCLE_EMOJI[group as keyof typeof MUSCLE_EMOJI] ?? "💪", label: "Weekly", value: String(s.weekly_sets) },
        { emoji: "📅", label: "Monthly", value: String(s.monthly_sets) },
        { emoji: "📈", label: "Trend", value: s.trend_pct != null ? `${s.trend_pct > 0 ? "+" : ""}${s.trend_pct}%` : "—" },
      ],
      athleteName: clientName ?? undefined,
    });
    setShareOpen(true);
  }

  function openShareForLift(l: CompLiftStat) {
    setShareData({
      eyebrow: `${l.lift.toUpperCase()} SUMMARY`,
      headline: l.top_set ? `${conv(l.top_set.load)} ${displayUnit} × ${l.top_set.reps}` : fmtTon(l.block_tonnage),
      subline: l.avg_intensity_pct != null ? `Averaging ${l.avg_intensity_pct}% of e1RM at RPE ${l.avg_rpe ?? "—"}.` : "Competition lift summary.",
      stats: [
        { emoji: "🔥", label: "Weekly vol", value: `${conv(l.weekly_volume).toLocaleString()}` },
        { emoji: "💪", label: "Block ton", value: `${conv(l.block_tonnage).toLocaleString()}` },
        { emoji: "📊", label: "Sets/wk", value: String(l.weekly_sets) },
      ],
      athleteName: clientName ?? undefined,
    });
    setShareOpen(true);
  }

  function openTotalShare() {
    setShareData({
      eyebrow: "Training summary",
      headline: `${teaser.tonnage.toLocaleString()} ${displayUnit}`,
      subline: `Total volume moved. Top muscle: ${teaser.topMuscle}.`,
      stats: [
        { emoji: "🏋️", label: "Tonnage", value: `${teaser.tonnage.toLocaleString()}` },
        { emoji: "🏆", label: "Top", value: teaser.topMuscle },
        { emoji: "📈", label: "Trend", value: teaser.trend },
      ],
      athleteName: clientName ?? undefined,
    });
    setShareOpen(true);
  }

  return (
    <div className="space-y-3">
      <Card className="overflow-hidden rounded-3xl border-border/70 bg-gradient-to-br from-primary/10 via-transparent to-transparent">
        <div className="flex items-center gap-2 p-4">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex min-w-0 flex-1 items-center gap-3 text-left"
            aria-expanded={expanded}
          >
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-primary/15 text-primary">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-black">Performance Insights</div>
              <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                <span>{teaser.tonnage.toLocaleString()} {displayUnit} moved</span>
                <span>Top: {teaser.topMuscle}</span>
                <span>Trend: {teaser.trend}</span>
              </div>
            </div>
            <ChevronDown className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
          </button>
          <InfoTip label="About Performance Insights" title="Performance Insights" align="end">
            What it means: your logged sets analysed per muscle group —
            weekly/monthly sets, tonnage, trends, and competition-lift
            summaries for the selected time window.
            How to use it: pick a window, scan the smart insights, and tap
            share on any card to send a summary.
            Watch out: exercises without a muscle group tag are skipped, and
            insights based on fewer than ~20 sets are a first snapshot, not a
            stable pattern.
          </InfoTip>
        </div>
      </Card>

      {expanded && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <PerformanceTimeFilter value={window} onChange={setWindow} />
            <Button size="sm" variant="outline" onClick={openTotalShare}>Share summary</Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Based on {windowSets.length} logged {windowSets.length === 1 ? "set" : "sets"} in this window
            {windowSets.length > 0 && windowSets.length < 20
              ? " — a small sample, insights may shift with more data"
              : ""}.
          </p>

          {isLoading ? (
            <Card className="p-6 text-sm text-muted-foreground">Loading…</Card>
          ) : sets.length === 0 ? (
            <Card className="p-6 text-sm text-muted-foreground">
              No logged sets yet. Insights will appear once workouts are completed.
            </Card>
          ) : (
            <>
              {(focus === "powerlifting" || focus === "hybrid") && pl.length > 0 && (
                <section className="space-y-2">
                  <SectionHeader label="Powerlifting" />
                  <PowerliftingPanel lifts={pl} onShare={openShareForLift} fmtTon={fmtTon} conv={conv} displayUnit={displayUnit} />
                </section>
              )}

              <section className="space-y-2">
                <SectionHeader label="Top muscle groups" />
                <TopMuscleGroupsCard top={top} fmtTon={fmtTon} />
              </section>

              <section className="space-y-2">
                <SectionHeader label="Muscle group volume" />
                <MuscleGroupGrid stats={stats} onShare={openShareForMuscle} fmtTon={fmtTon} />
              </section>

              {insights.length > 0 && (
                <section className="space-y-2">
                  <SectionHeader label="Smart insights" />
                  <SmartInsights insights={insights} onShare={openShareForInsight} />
                </section>
              )}

              {variant === "coach" && (
                <section className="space-y-2">
                  <SectionHeader label="Coach view" />
                  <CoachExtrasCard
                    extras={coachExtras(stats, sets.length, prescribed ?? 0)}
                  />
                </section>
              )}
            </>
          )}
        </div>
      )}

      <ShareSheet open={shareOpen} onOpenChange={setShareOpen} data={shareData} />
    </div>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
  );
}