import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { format } from "date-fns";
import { Target, AlertTriangle } from "lucide-react";
import {
  buildExposures, exposureStats, exposureTimeline,
  type LiftFamily, type Role, ROLES, FAMILIES,
} from "@/lib/analytics/powerlifting-exposure";
import { fmtNum } from "@/lib/analytics-format";
import type { AnalyticsFilter } from "./analytics-filter-bar";

interface Props {
  clientId: string;
  filter: AnalyticsFilter;
  results: any[];
  admin?: boolean;
  displayUnit?: "lb" | "kg";
  navigateToBuilderHref?: string;
  /** When set (block-based presets), restrict data to a single block. */
  blockId?: string | null;
}

const FAMILY_LABEL: Record<LiftFamily, string> = {
  squat: "Squat",
  bench: "Bench",
  deadlift: "Deadlift",
};

const FAMILY_COLOR: Record<LiftFamily, string> = {
  squat: "var(--chart-1)",
  bench: "var(--chart-4)",
  deadlift: "var(--chart-5)",
};

export function PowerliftingExposureSection({
  clientId,
  filter,
  results,
  admin = false,
  displayUnit = "lb",
  navigateToBuilderHref,
  blockId = null,
}: Props) {
  const navigate = useNavigate();

  // Fetch pl_exercise_rows with role fields + days + completions for the client, filtered by date range.
  const { data: exposureData } = useQuery({
    queryKey: [
      "pl-exposure",
      clientId,
      filter.start.toISOString(),
      filter.end.toISOString(),
      blockId ?? null,
    ],
    enabled: !!clientId,
    staleTime: 30_000,
    queryFn: async () => {
      let blockIds: string[];
      if (blockId) {
        blockIds = [blockId];
      } else {
        const { data: blocks } = await supabase
          .from("pl_blocks")
          .select("id")
          .eq("client_id", clientId);
        blockIds = (blocks ?? []).map((b) => b.id);
      }
      if (blockIds.length === 0) return { rows: [], days: [], completions: [], hasSbdRows: false };

      const { data: weeks } = await supabase
        .from("pl_weeks")
        .select("id, block_id, week_index")
        .in("block_id", blockIds);
      const weekIds = (weeks ?? []).map((w) => w.id);
      if (weekIds.length === 0) return { rows: [], days: [], completions: [], hasSbdRows: false };

      const { data: days } = await supabase
        .from("pl_days")
        .select("id, week_id, day_index, scheduled_date")
        .in("week_id", weekIds);
      const dayIds = (days ?? []).map((d) => d.id);
      if (dayIds.length === 0) return { rows: [], days: [], completions: [], hasSbdRows: false };

      const weekIndexById = new Map((weeks ?? []).map((w) => [w.id, w.week_index]));
      const daysNormalized = (days ?? []).map((d) => ({
        id: d.id,
        day_index: d.day_index,
        week_index: weekIndexById.get(d.week_id) ?? 0,
        scheduled_date: d.scheduled_date,
      }));

      const [{ data: rows }, { data: completions }] = await Promise.all([
        supabase
          .from("pl_exercise_rows")
          .select("id, day_id, purpose_label, movement_family, sort_order")
          .in("day_id", dayIds),
        supabase
          .from("pl_day_completions")
          .select("day_id, completed_at")
          .in("day_id", dayIds),
      ]);

      const allRows = rows ?? [];
      const hasSbdRows = allRows.some((r) =>
        r.movement_family && ["squat", "bench", "deadlift"].includes(r.movement_family.toLowerCase()),
      );

      return {
        rows: allRows,
        days: daysNormalized,
        completions: completions ?? [],
        hasSbdRows,
      };
    },
  });

  const exposures = useMemo(() => {
    if (!exposureData) return [];
    return buildExposures(exposureData.rows, exposureData.days, exposureData.completions, {
      start: filter.start,
      end: filter.end,
    });
  }, [exposureData, filter.start, filter.end]);

  const stats = useMemo(() => exposureStats(exposures), [exposures]);
  const timeline = useMemo(() => exposureTimeline(exposures), [exposures]);

  // Coach alerts (admin)
  const alerts = useMemo(() => {
    const list: { kind: "missed-primary" | "no-roles"; message: string }[] = [];
    if (admin) {
      if (exposureData?.hasSbdRows && exposures.length === 0) {
        list.push({ kind: "no-roles", message: "Role data missing from this block" });
      }
      const missedByWeek = new Map<string, number>();
      for (const e of exposures) {
        if (e.role === "Primary" && !e.completed) {
          const key = `${FAMILY_LABEL[e.family]}|${e.weekIndex}`;
          missedByWeek.set(key, (missedByWeek.get(key) ?? 0) + 1);
        }
      }
      for (const [key] of missedByWeek) {
        const [fam, wk] = key.split("|");
        list.push({ kind: "missed-primary", message: `Missed Primary ${fam} exposure in Week ${wk}` });
      }
    }
    return list;
  }, [admin, exposureData, exposures]);

  // Performance trend controls
  const [trendFamily, setTrendFamily] = useState<LiftFamily>("squat");
  const [trendRole, setTrendRole] = useState<"all" | Role>("all");

  const trendPoints = useMemo(() => {
    if (!results || results.length === 0) return [];
    return results
      .filter((r: any) => {
        const mf = (r.movement_family ?? "").toLowerCase();
        if (mf !== trendFamily) return false;
        if (trendRole !== "all" && r.purpose_label !== trendRole) return false;
        if (!r.date) return false;
        const t = new Date(r.date).getTime();
        return t >= filter.start.getTime() && t <= filter.end.getTime();
      })
      .map((r: any) => ({
        date: format(new Date(r.date), "MMM d"),
        est: Number((r.est_1rm ?? 0).toFixed(1)),
      }));
  }, [results, trendFamily, trendRole, filter.start, filter.end]);

  const hasRoleData = exposures.length > 0;
  const hasCompletedSbdRow = (results ?? []).some((r: any) => {
    const mf = (r.movement_family ?? "").toLowerCase();
    return mf === "squat" || mf === "bench" || mf === "deadlift";
  });

  // Empty state for client-facing view
  if (!hasRoleData && !admin) {
    if (!exposureData?.hasSbdRows) return null;
    return (
      <section aria-label="Powerlifting Exposure">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="flex items-center gap-2 text-base font-black uppercase tracking-wider text-foreground">
            <Target className="h-5 w-5 shrink-0 text-primary" />
            Powerlifting Exposure
          </h2>
        </div>
        <Card className="p-6 text-sm text-muted-foreground">
          This block does not have powerlifting priority roles assigned yet.
        </Card>
      </section>
    );
  }

  if (!hasRoleData && admin && alerts.length === 0) {
    return null;
  }

  const primaryTone = (pct: number) =>
    pct === 100 ? "text-emerald-500" : pct >= 67 ? "text-amber-500" : "text-amber-500";

  return (
    <section aria-label="Powerlifting Exposure" className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="flex items-center gap-2 text-base font-black uppercase tracking-wider text-foreground">
          <Target className="h-5 w-5 shrink-0 text-primary" />
          Powerlifting Exposure Analytics
        </h2>
      </div>

      {/* Coach alerts */}
      {admin && alerts.length > 0 && (
        <Card className="border-amber-500/40 bg-amber-500/10 p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <div className="flex-1 space-y-1 text-sm">
              {alerts.map((a, i) => (
                <div key={i} className="text-amber-800 dark:text-amber-300">
                  {a.message}
                </div>
              ))}
              {navigateToBuilderHref && (
                <a
                  href={navigateToBuilderHref}
                  className="mt-1 inline-block text-xs font-semibold underline text-amber-700 dark:text-amber-200"
                >
                  Review Program Roles →
                </a>
              )}
            </div>
          </div>
        </Card>
      )}

      {hasRoleData && (
        <>
          {/* A. Exposure Summary */}
          <Card className="p-4">
            <div className="mb-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Exposure Summary
            </div>
            <div className="space-y-3">
              {FAMILIES.map((fam) => {
                const s = stats[fam];
                if (s.planned === 0) return null;
                const pct = Math.round((s.completed / s.planned) * 100);
                return (
                  <div key={fam} className="flex flex-col gap-1 border-b border-border/60 pb-2 last:border-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ background: FAMILY_COLOR[fam] }}
                      />
                      <span className="font-bold text-foreground">{FAMILY_LABEL[fam]}</span>
                      <span className="text-sm text-muted-foreground">
                        {s.completed} / {s.planned} exposures · {pct}%
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs">
                      {ROLES.map((role) => {
                        const r = s.byRole[role];
                        if (r.planned === 0) return null;
                        return (
                          <span key={role} className="text-muted-foreground">
                            <span className="font-semibold text-foreground">{role.slice(0, 1)}</span>{" "}
                            {r.completed}/{r.planned}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* B. Completion by Priority */}
          <Card className="p-4">
            <div className="mb-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Completion by Priority
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {ROLES.map((role) => {
                let planned = 0;
                let completed = 0;
                for (const fam of FAMILIES) {
                  planned += stats[fam].byRole[role].planned;
                  completed += stats[fam].byRole[role].completed;
                }
                if (planned === 0) return null;
                const pct = Math.round((completed / planned) * 100);
                const isPrimary = role === "Primary";
                return (
                  <div key={role} className="rounded-md border border-border bg-card/60 p-3">
                    <div className="text-xs font-semibold uppercase text-muted-foreground">
                      {role}
                    </div>
                    <div className={`mt-1 text-2xl font-black ${isPrimary && pct < 100 ? primaryTone(pct) : "text-foreground"}`}>
                      {pct}%
                    </div>
                    <div className="text-xs text-muted-foreground">{completed}/{planned}</div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* C. Weekly Exposure Timeline */}
          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Weekly Exposure Timeline
              </div>
              <div className="text-[10px] font-semibold uppercase text-muted-foreground">
                P=Primary · S=Secondary · T=Tertiary · Q=Quaternary
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold uppercase text-muted-foreground">
                    <th className="pb-2 pr-4">Week</th>
                    <th className="pb-2 pr-4">Squat</th>
                    <th className="pb-2 pr-4">Bench</th>
                    <th className="pb-2 pr-4">Deadlift</th>
                  </tr>
                </thead>
                <tbody>
                  {timeline.map((w) => (
                    <tr key={w.weekIndex} className="border-t border-border/60">
                      <td className="py-2 pr-4 font-bold text-foreground">W{w.weekIndex}</td>
                      {(["squat", "bench", "deadlift"] as LiftFamily[]).map((fam) => {
                        const letters = w[fam];
                        return (
                          <td key={fam} className="py-2 pr-4">
                            <div className="flex flex-wrap gap-1">
                              {letters.map((letter) => {
                                const dayId = w.dayIdByCell[`${fam}:${letter}`];
                                return (
                                  <button
                                    key={letter}
                                    type="button"
                                    onClick={() => {
                                      if (!dayId) return;
                                      if (admin) return; // admin: no navigation (no target route)
                                      navigate({
                                        to: "/portal/workouts/$dayId",
                                        params: { dayId },
                                      });
                                    }}
                                    className="inline-flex h-6 min-w-6 items-center justify-center rounded-full border border-border bg-card px-2 text-[11px] font-bold hover:border-primary/60 hover:text-primary"
                                    style={{ borderColor: `color-mix(in oklab, ${FAMILY_COLOR[fam]} 40%, var(--border))` }}
                                  >
                                    {letter}
                                  </button>
                                );
                              })}
                              {letters.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* D. Performance Trend */}
          <Card className="p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Performance Trend {displayUnit && `(${displayUnit})`}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <ToggleGroup
                  type="single"
                  value={trendFamily}
                  onValueChange={(v) => v && setTrendFamily(v as LiftFamily)}
                  className="rounded-md border border-border bg-card p-0.5"
                >
                  {FAMILIES.map((f) => (
                    <ToggleGroupItem key={f} value={f} className="h-7 px-2 text-xs font-bold capitalize data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                      {FAMILY_LABEL[f]}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <ToggleGroup
                  type="single"
                  value={trendRole}
                  onValueChange={(v) => v && setTrendRole(v as any)}
                  className="rounded-md border border-border bg-card p-0.5"
                >
                  <ToggleGroupItem value="all" className="h-7 px-2 text-xs font-bold data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                    All
                  </ToggleGroupItem>
                  {ROLES.map((r) => (
                    <ToggleGroupItem key={r} value={r} className="h-7 px-2 text-xs font-bold data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                      {r.slice(0, 1)}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
            </div>
            {trendPoints.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                {hasCompletedSbdRow
                  ? "No matching logged sets in this range."
                  : "No logged sets for this lift yet."}
              </div>
            ) : (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendPoints} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="color-mix(in oklab, var(--border) 60%, transparent)" />
                    <XAxis dataKey="date" stroke="var(--muted-foreground)" fontSize={11} minTickGap={20} />
                    <YAxis stroke="var(--muted-foreground)" fontSize={11} tickFormatter={(v) => fmtNum(v)} width={40} />
                    <Tooltip
                      wrapperStyle={{ outline: "none" }}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const d: any = payload[0].payload;
                        return (
                          <div className="rounded-lg border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-xl">
                            <div className="text-xs font-bold uppercase text-muted-foreground">{d.date}</div>
                            <div className="mt-1 font-extrabold text-foreground">{fmtNum(d.est)} est 1RM</div>
                          </div>
                        );
                      }}
                    />
                    <Line type="monotone" dataKey="est" stroke={FAMILY_COLOR[trendFamily]} strokeWidth={2.5} dot={{ r: 3, fill: FAMILY_COLOR[trendFamily], strokeWidth: 0 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          {/* F. Admin-only: Planned vs Completed Sets by Role */}
          {admin && (
            <Card className="p-4">
              <div className="mb-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Planned vs Completed Sets by Role
              </div>
              <PlannedVsCompletedTable clientId={clientId} filter={filter} />
            </Card>
          )}
        </>
      )}
    </section>
  );
}

/** Planned-vs-Completed sets by lift family + role — admin only. */
function PlannedVsCompletedTable({
  clientId,
  filter,
}: {
  clientId: string;
  filter: AnalyticsFilter;
}) {
  const { data } = useQuery({
    queryKey: ["pl-role-set-counts", clientId, filter.start.toISOString(), filter.end.toISOString()],
    enabled: !!clientId,
    staleTime: 30_000,
    queryFn: async () => {
      const { data: blocks } = await supabase.from("pl_blocks").select("id").eq("client_id", clientId);
      const blockIds = (blocks ?? []).map((b) => b.id);
      if (blockIds.length === 0) return { planned: {}, completed: {} } as any;
      const { data: weeks } = await supabase.from("pl_weeks").select("id").in("block_id", blockIds);
      const weekIds = (weeks ?? []).map((w) => w.id);
      const { data: days } = await supabase
        .from("pl_days")
        .select("id, scheduled_date")
        .in("week_id", weekIds);
      const startMs = filter.start.getTime();
      const endMs = filter.end.getTime();
      const inRangeDayIds = (days ?? [])
        .filter((d) => {
          if (!d.scheduled_date) return true;
          const t = new Date(d.scheduled_date).getTime();
          return t >= startMs && t <= endMs;
        })
        .map((d) => d.id);
      if (inRangeDayIds.length === 0) return { planned: {}, completed: {} } as any;

      const { data: rows } = await supabase
        .from("pl_exercise_rows")
        .select("id, purpose_label, movement_family, day_id, sets")
        .in("day_id", inRangeDayIds);
      const relevantRows = (rows ?? []).filter(
        (r) =>
          r.purpose_label &&
          ["Primary", "Secondary", "Tertiary", "Quaternary"].includes(r.purpose_label) &&
          r.movement_family &&
          ["squat", "bench", "deadlift"].includes(r.movement_family.toLowerCase()),
      );
      const relevantRowIds = relevantRows.map((r) => r.id);

      // Planned: sum row.sets per (family, role). Canonical workout renderer
      // treats `sets = null` as 0 (see estimateRowSeconds in pl-programs.ts),
      // so we DO NOT fabricate one set. Rows missing a set count are excluded
      // from the numeric total and surfaced via `missingSetsRows` warning.
      // Completed: unique (row_id, set_index) with actual_reps IS NOT NULL —
      // never counts duplicate or updated result rows twice.
      const planned: Record<string, Record<string, number>> = {};
      const completed: Record<string, Record<string, number>> = {};
      const bucket = (obj: any, fam: string, role: string) => {
        obj[fam] = obj[fam] ?? {};
        obj[fam][role] = obj[fam][role] ?? 0;
      };
      let missingSetsRows = 0;
      for (const r of relevantRows) {
        const fam = r.movement_family!.toLowerCase();
        const role = r.purpose_label!;
        bucket(planned, fam, role);
        const setCount = r.sets == null ? null : Number(r.sets);
        if (setCount == null || !Number.isFinite(setCount) || setCount <= 0) {
          missingSetsRows += 1;
          continue;
        }
        planned[fam][role] += setCount;
      }
      const rowMeta = new Map(relevantRows.map((r) => [r.id, r]));
      if (relevantRowIds.length) {
        const { data: resultRows } = await supabase
          .from("pl_row_results")
          .select("row_id, set_index, actual_reps")
          .in("row_id", relevantRowIds)
          .not("actual_reps", "is", null);
        // Deduplicate by (row_id, set_index) — a set that was re-saved or
        // corrected still counts as one completed set.
        const seen = new Set<string>();
        for (const rr of resultRows ?? []) {
          const key = `${rr.row_id}|${rr.set_index}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const meta = rowMeta.get(rr.row_id);
          if (!meta) continue;
          const fam = meta.movement_family!.toLowerCase();
          const role = meta.purpose_label!;
          bucket(completed, fam, role);
          completed[fam][role] += 1;
        }
      }
      return { planned, completed, missingSetsRows };
    },
  });

  if (!data) return <div className="text-sm text-muted-foreground">Loading…</div>;
  const { planned, completed, missingSetsRows } = data as {
    planned: Record<string, Record<string, number>>;
    completed: Record<string, Record<string, number>>;
    missingSetsRows: number;
  };
  const families: LiftFamily[] = ["squat", "bench", "deadlift"];
  const roles: Role[] = ["Primary", "Secondary", "Tertiary", "Quaternary"];
  const anyData = families.some((f) => planned[f] && Object.keys(planned[f]).length > 0);
  if (!anyData) return <div className="text-sm text-muted-foreground">No workouts were scheduled in this period.</div>;

  return (
    <div className="space-y-4">
      {missingSetsRows > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          Data quality: {missingSetsRows} SBD row{missingSetsRows === 1 ? "" : "s"} in this range have no prescribed set count and were excluded from the planned total.
        </div>
      )}
      {families.map((fam) => {
        const p = planned[fam];
        if (!p || Object.keys(p).length === 0) return null;
        return (
          <div key={fam}>
            <div className="mb-1 flex items-center gap-2">
              <span
                aria-hidden
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: FAMILY_COLOR[fam] }}
              />
              <span className="text-sm font-bold text-foreground">{FAMILY_LABEL[fam]}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold uppercase text-muted-foreground">
                    <th className="pb-1 pr-4">Role</th>
                    <th className="pb-1 pr-4">Planned sets</th>
                    <th className="pb-1">Completed sets</th>
                  </tr>
                </thead>
                <tbody>
                  {roles.map((role) => {
                    const pl = planned[fam]?.[role] ?? 0;
                    const co = completed[fam]?.[role] ?? 0;
                    if (pl === 0) return null;
                    const isShort = role === "Primary" && co < pl;
                    return (
                      <tr key={role} className="border-t border-border/60">
                        <td className="py-1 pr-4">{role}</td>
                        <td className="py-1 pr-4">{pl}</td>
                        <td className={`py-1 ${isShort ? "text-amber-500" : "text-foreground"}`}>
                          <span className="font-bold">{co}</span>
                          <span className="text-muted-foreground"> / {pl}</span>
                          {isShort && (
                            <Badge variant="outline" className="ml-2 border-amber-500/40 text-amber-500">
                              short
                            </Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}