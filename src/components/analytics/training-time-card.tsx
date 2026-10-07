/**
 * Training Time — when the athlete trains, how long sessions run, and which
 * time of day they're strongest at. Every session opens to its workout,
 * notes and review, and any session's time can be corrected in two taps.
 */
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { endOfDay } from "date-fns";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle, CheckCircle2, ChevronRight, ExternalLink, FileText,
  Gauge, Lightbulb, Pencil, Star, Sunrise, Timer,
} from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Scatter, ScatterChart,
  Tooltip, XAxis, YAxis, Cell,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { InlineWorkoutPreview } from "@/components/workout/shared/inline-workout-preview";
import { TrainingTimeSheet } from "@/components/workout-day/TrainingTimeSheet";
import { getClientResults } from "@/lib/pl-programs";
import { ANALYTICS_COLORS } from "@/lib/analytics-format";
import { cn } from "@/lib/utils";
import {
  DEFAULT_TRAINING_TZ,
  TRAINING_WINDOWS,
  formatClock,
  formatClockAt,
  formatMinutes,
  resolveTiming,
  strengthIndexBySession,
  summarizeTrainingTime,
  trainingDayMinutes,
  windowForHour,
  zonedParts,
  type Insight,
  type StrengthSet,
  type TrainingSession,
} from "@/lib/analytics/training-time";

type Props = {
  clientId: string;
  rangeStart: Date;
  rangeEnd: Date;
  rangeLabel: string;
  nextMeetDate?: string | null;
  canOpenLog?: boolean;
  header?: ReactNode;
};

type SessionRow = TrainingSession & { completionId: string; scheduledWorkoutId: string | null };

const LOG_PREVIEW = 8;
const DAY_MS = 86_400_000;

export function TrainingTimeCard({ clientId, rangeStart, rangeEnd, rangeLabel, nextMeetDate, canOpenLog = false, header }: Props) {
  const [chart, setChart] = useState<"start" | "length">("start");
  const [showAll, setShowAll] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);

  const { data: timezone = DEFAULT_TRAINING_TZ } = useQuery({
    queryKey: ["client-timezone", clientId],
    enabled: !!clientId,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("clients").select("timezone").eq("id", clientId).maybeSingle();
      return (data?.timezone || "").trim() || DEFAULT_TRAINING_TZ;
    },
  });

  // Shares the dashboard's lifetime results cache, so this is usually free.
  const { data: results = [] } = useQuery({
    queryKey: ["pl-results", clientId, null],
    enabled: !!clientId,
    staleTime: 30_000,
    queryFn: () => getClientResults(clientId, {}),
  });

  // Block end dates are midnight; include that whole last day.
  const startMs = rangeStart.getTime();
  const endMs = endOfDay(rangeEnd).getTime();
  const startIso = new Date(startMs).toISOString();
  const endIso = new Date(endMs).toISOString();
  const { data: raw, isLoading } = useQuery({
    queryKey: ["training-time", clientId, startIso, endIso],
    enabled: !!clientId,
    staleTime: 30_000,
    queryFn: async () => {
      // Pad the window: a confirmed start can sit days before completed_at.
      const { data: comps, error } = await (supabase as any)
        .from("pl_day_completions")
        .select(
          "id, day_id, scheduled_workout_id, started_at, training_started_at, completed_at, actual_duration_min, active_duration_seconds, logged_sets_count, logging_percentage, session_rating, client_notes",
        )
        .eq("client_id", clientId)
        .not("completed_at", "is", null)
        .gte("completed_at", new Date(startMs - 31 * DAY_MS).toISOString())
        .lte("completed_at", new Date(endMs + 2 * DAY_MS).toISOString())
        .order("completed_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      const rows = (comps ?? []) as any[];
      const dayIds = [...new Set(rows.map((r) => r.day_id).filter(Boolean))];
      const ids = rows.map((r) => r.id);
      const [daysRes, fbRes] = await Promise.all([
        dayIds.length ? supabase.from("pl_days").select("id, title").in("id", dayIds) : Promise.resolve({ data: [] as any[] }),
        ids.length
          ? (supabase as any)
              .from("pl_workout_feedback")
              .select("completion_id, overall_rating, session_rpe, strength_feel, fatigue_feel, pain, client_note")
              .in("completion_id", ids)
          : Promise.resolve({ data: [] as any[] }),
      ]);
      return { rows, days: (daysRes.data ?? []) as any[], feedback: (fbRes.data ?? []) as any[] };
    },
  });

  const sessions = useMemo<SessionRow[]>(() => {
    if (!raw) return [];
    const titles = new Map(raw.days.map((d: any) => [d.id, d.title as string | null]));
    const fb = new Map(raw.feedback.map((f: any) => [f.completion_id, f]));

    // Attach each logged set to its workout instance (same day_id, closest
    // in time); sets with no completion still count as recent-best history.
    const byDay = new Map<string, any[]>();
    for (const r of raw.rows) {
      const list = byDay.get(r.day_id) ?? [];
      list.push(r);
      byDay.set(r.day_id, list);
    }
    const strengthSets: StrengthSet[] = [];
    for (const s of results as any[]) {
      if (!s.counts_load || !s.date) continue;
      const at = new Date(s.date).getTime();
      const candidates = s.day_id ? byDay.get(s.day_id) : undefined;
      let sessionKey = `date:${String(s.date).slice(0, 10)}`;
      if (candidates?.length) {
        const nearest = candidates.reduce((a, b) =>
          Math.abs(new Date(a.completed_at).getTime() - at) <= Math.abs(new Date(b.completed_at).getTime() - at) ? a : b,
        );
        if (Math.abs(new Date(nearest.completed_at).getTime() - at) <= 3 * DAY_MS) sessionKey = nearest.id;
      }
      strengthSets.push({
        sessionKey,
        at,
        exerciseKey: s.exercise_id ?? s.exercise_name,
        loadLb: Number(s.load) || 0,
        reps: Number(s.reps) || 0,
        rpe: s.rpe,
        rir: s.rir,
      });
    }
    const strength = strengthIndexBySession(strengthSets);

    const out: SessionRow[] = [];
    for (const r of raw.rows) {
      const timing = resolveTiming({
        startedAt: r.started_at,
        trainingStartedAt: r.training_started_at,
        completedAt: r.completed_at,
        durationMin: r.actual_duration_min,
        loggedSets: r.logged_sets_count,
      });
      if (!timing) continue;
      const t = timing.start.getTime();
      if (t < startMs || t > endMs) continue;
      const p = zonedParts(timing.start, timezone);
      const f: any = fb.get(r.id);
      const dur = timing.durationMin;
      const sets = r.logged_sets_count ?? null;
      out.push({
        id: r.id,
        completionId: r.id,
        scheduledWorkoutId: r.scheduled_workout_id ?? null,
        dayId: r.day_id,
        title: titles.get(r.day_id) ?? null,
        start: timing.start,
        end: dur != null ? new Date(timing.start.getTime() + dur * 60_000) : null,
        durationMin: dur,
        activeMin: r.active_duration_seconds ? Math.round(r.active_duration_seconds / 60) : null,
        source: timing.source,
        startMinutes: trainingDayMinutes(p.hour, p.minute),
        weekday: p.weekday,
        window: windowForHour(p.hour),
        loggedSets: sets,
        loggingPct: r.logging_percentage ?? null,
        setsPerHour: dur != null && dur >= 15 && sets ? Math.round((sets / dur) * 60 * 10) / 10 : null,
        rating: f?.overall_rating ?? r.session_rating ?? null,
        sessionRpe: f?.session_rpe ?? null,
        strengthIndex: strength.get(r.id) ?? null,
        strengthFeel: f?.strength_feel ?? null,
        fatigueFeel: f?.fatigue_feel ?? null,
        pain: !!f?.pain,
        notes: r.client_notes ?? null,
        reviewNote: f?.client_note ?? null,
      });
    }
    return out.sort((a, b) => b.start.getTime() - a.start.getTime());
  }, [raw, results, timezone, startMs, endMs]);

  const summary = useMemo(
    () => summarizeTrainingTime(sessions, { nextMeetDate: nextMeetDate ?? null }),
    [sessions, nextMeetDate],
  );

  const viewerTz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : timezone;
  const openSession = sessions.find((s) => s.id === openId) ?? null;
  const editSession = sessions.find((s) => s.id === editId) ?? null;

  if (isLoading) {
    return (
      <section aria-label="Training Time">
        {header}
        <Card className="p-6 text-sm text-muted-foreground">Loading session times…</Card>
      </section>
    );
  }

  if (sessions.length === 0) {
    return (
      <section aria-label="Training Time">
        {header}
        <Card className="border-dashed border-border/70 bg-card/60 p-6 text-center text-sm text-muted-foreground">
          No finished workouts in {rangeLabel}. Start the workout timer when you train and your session times land here.
        </Card>
      </section>
    );
  }

  const maxWindow = Math.max(1, ...summary.windows.map((w) => w.sessions));
  const visibleLog = showAll ? sessions : sessions.slice(0, LOG_PREVIEW);
  const best = summary.best?.meaningful ? summary.best : null;

  return (
    <section aria-label="Training Time">
      {header}
      <Card className="space-y-5 border-border/80 bg-card p-4">
        {viewerTz !== timezone && (
          <p className="text-[11px] text-muted-foreground">Times shown in the athlete's timezone ({timezone}).</p>
        )}

        {/* KPIs */}
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Kpi
            icon={<Sunrise className="h-4 w-4" />}
            color={ANALYTICS_COLORS.blue}
            label="Typical start"
            value={summary.typicalStartMinutes != null ? formatClock(summary.typicalStartMinutes) : "—"}
            sub={summary.startSpreadMin != null && summary.timed.length >= 3 ? `Half within ±${formatMinutes(Math.max(5, summary.startSpreadMin))}` : "Needs 3+ timed sessions"}
          />
          <Kpi
            icon={<Timer className="h-4 w-4" />}
            color={ANALYTICS_COLORS.purple}
            label="Session length"
            value={formatMinutes(summary.medianDurationMin)}
            sub={
              summary.durationP25 != null && summary.durationP75 != null && summary.timed.length >= 4
                ? `Most ${Math.round(summary.durationP25)}–${Math.round(summary.durationP75)} min`
                : "Median"
            }
          />
          <Kpi
            icon={<Gauge className="h-4 w-4" />}
            color={ANALYTICS_COLORS.amber}
            label="Density"
            value={summary.medianSetsPerHour != null ? `${Math.round(summary.medianSetsPerHour)} sets/hr` : "—"}
            sub="Logged sets per hour"
          />
          <Kpi
            icon={<Star className="h-4 w-4" />}
            color={ANALYTICS_COLORS.green}
            label="Best window"
            value={best ? best.label : summary.best ? "No clear winner" : "—"}
            sub={
              best
                ? best.metric === "strength"
                  ? `+${best.delta.toFixed(1)}% strength vs other times`
                  : `+${best.delta.toFixed(1)}★ vs other times`
                : summary.best
                  ? "Similar at every time"
                  : "Needs 3+ sessions in 2 windows"
            }
          />
        </div>

        {/* Windows */}
        <div>
          <SubHeading>By time of day</SubHeading>
          <ul className="space-y-1.5">
            {summary.windows
              .filter((w) => w.sessions > 0)
              .map((w) => {
                const isBest = best?.key === w.key;
                return (
                  <li
                    key={w.key}
                    className={cn(
                      "rounded-lg border px-3 py-2",
                      isBest ? "border-primary/40 bg-primary/5" : "border-border bg-muted/20",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-[92px] shrink-0">
                        <div className="flex items-center gap-1 text-sm font-black text-foreground">
                          {w.label}
                          {isBest && <span className="rounded bg-primary px-1 text-[9px] font-black uppercase text-primary-foreground">Best</span>}
                        </div>
                        <div className="text-[10px] text-muted-foreground">{w.range}</div>
                      </div>
                      <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${(w.sessions / maxWindow) * 100}%`, background: ANALYTICS_COLORS.blue }}
                        />
                      </div>
                      <div className="w-8 shrink-0 text-right text-sm font-black tabular-nums text-foreground">{w.sessions}</div>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 pl-0 text-[11px] text-muted-foreground sm:pl-[100px]">
                      <span>
                        Strength{" "}
                        <b className="text-foreground">{w.avgStrength != null ? `${w.avgStrength.toFixed(1)}%` : "—"}</b>
                        {w.scoredSessions > 0 && w.scoredSessions < 3 && " (few)"}
                      </span>
                      <span>
                        Rating <b className="text-foreground">{w.avgRating != null ? `${w.avgRating.toFixed(1)}★` : "—"}</b>
                      </span>
                      <span>
                        Length <b className="text-foreground">{formatMinutes(w.medianDurationMin)}</b>
                      </span>
                    </div>
                  </li>
                );
              })}
          </ul>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Strength = top sets' RPE-adjusted e1RM as a % of your best on that lift over the prior 8 weeks. 100% = matched it.
          </p>
        </div>

        {/* Chart */}
        {summary.timed.length >= 2 && (
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <SubHeading className="mb-0">{chart === "start" ? "Start time per session" : "Length per session"}</SubHeading>
              <ToggleGroup
                type="single"
                value={chart}
                onValueChange={(v) => v && setChart(v as "start" | "length")}
                className="rounded-lg border border-border bg-card p-0.5"
              >
                <ToggleGroupItem value="start" className="h-7 px-2.5 text-[11px] font-bold data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                  Start
                </ToggleGroupItem>
                <ToggleGroupItem value="length" className="h-7 px-2.5 text-[11px] font-bold data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                  Length
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
            <SessionChart mode={chart} sessions={summary.timed} timezone={timezone} onOpen={setOpenId} />
          </div>
        )}

        {/* Coach feedback */}
        {summary.insights.length > 0 && (
          <div>
            <SubHeading>Coach notes</SubHeading>
            <ul className="space-y-2">
              {summary.insights.slice(0, 5).map((i) => (
                <InsightRow key={i.id} insight={i} />
              ))}
            </ul>
          </div>
        )}

        {/* Session log */}
        <div>
          <SubHeading>Session log</SubHeading>
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {visibleLog.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(s.id)}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-secondary/60"
                >
                  <div className="w-11 shrink-0 text-center">
                    <div className="text-[10px] font-bold uppercase text-muted-foreground">
                      {s.start.toLocaleDateString("en-US", { weekday: "short", timeZone: timezone })}
                    </div>
                    <div className="text-sm font-black tabular-nums text-foreground">
                      {s.start.toLocaleDateString("en-US", { month: "numeric", day: "numeric", timeZone: timezone })}
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold text-foreground">{s.title || "Workout"}</div>
                    <div className="truncate text-xs text-muted-foreground tabular-nums">
                      {s.source === "suspect"
                        ? `Logged ${formatClockAt(s.start, timezone)} · time not set`
                        : `${formatClockAt(s.start, timezone)} · ${formatMinutes(s.durationMin)}${s.loggedSets ? ` · ${s.loggedSets} sets` : ""}`}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {(s.notes || s.reviewNote) && <FileText className="h-3.5 w-3.5 text-muted-foreground" aria-label="Has notes" />}
                    {s.source === "suspect" ? (
                      <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">Set time</span>
                    ) : s.rating != null ? (
                      <span className="text-xs font-bold tabular-nums text-foreground">{s.rating}★</span>
                    ) : null}
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </button>
              </li>
            ))}
          </ul>
          {sessions.length > LOG_PREVIEW && (
            <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Show less" : `Show all ${sessions.length} sessions`}
            </Button>
          )}
        </div>
      </Card>

      <SessionDetailSheet
        session={openSession}
        clientId={clientId}
        timezone={timezone}
        canOpenLog={canOpenLog}
        onClose={() => setOpenId(null)}
        onEditTime={(id) => {
          // One sheet at a time: stacked modals fight over focus on iOS.
          setOpenId(null);
          setEditId(id);
        }}
      />

      {editSession && (
        <TrainingTimeSheet
          open={!!editSession}
          onOpenChange={(v) => !v && setEditId(null)}
          completionId={editSession.completionId}
          timezone={timezone}
          initialStart={editSession.start}
          initialDurationMin={editSession.durationMin}
          workoutTitle={editSession.title}
        />
      )}
    </section>
  );
}

function SubHeading({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h3 className={cn("mb-2 text-[11px] font-black uppercase tracking-widest text-muted-foreground", className)}>
      {children}
    </h3>
  );
}

function Kpi({ icon, color, label, value, sub }: { icon: ReactNode; color: string; label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3" style={{ borderTop: `3px solid ${color}` }}>
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        <span style={{ color }}>{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 truncate text-lg font-black tracking-tight text-foreground">{value}</div>
      <div className="truncate text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}

function InsightRow({ insight }: { insight: Insight }) {
  const Icon = insight.tone === "good" ? CheckCircle2 : insight.tone === "warn" ? AlertTriangle : Lightbulb;
  return (
    <li className="flex items-start gap-3 rounded-lg border border-border bg-muted/20 p-3">
      <span
        className={cn(
          "mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
          insight.tone === "good" && "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
          insight.tone === "warn" && "bg-amber-500/15 text-amber-700 dark:text-amber-300",
          insight.tone === "info" && "bg-primary/15 text-primary",
        )}
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-bold text-foreground">{insight.title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{insight.body}</p>
      </div>
    </li>
  );
}

function SessionChart({
  mode,
  sessions,
  timezone,
  onOpen,
}: {
  mode: "start" | "length";
  sessions: TrainingSession[];
  timezone: string;
  onOpen: (id: string) => void;
}) {
  const data = [...sessions]
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .map((s) => ({
      id: s.id,
      t: s.start.getTime(),
      startMinutes: s.startMinutes,
      length: s.durationMin ?? 0,
      label: s.start.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: timezone }),
      title: s.title || "Workout",
      session: s,
    }));
  const grid = "color-mix(in oklab, var(--border) 60%, transparent)";
  const axis = "var(--muted-foreground)";
  const tooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    const s: TrainingSession = d.session;
    return (
      <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-xl">
        <div className="font-extrabold text-foreground">{d.title}</div>
        <div className="text-muted-foreground">{d.label}</div>
        <div className="mt-1 tabular-nums">
          {formatClockAt(s.start, timezone)} · {formatMinutes(s.durationMin)}
        </div>
        {s.strengthIndex != null && <div className="tabular-nums">Strength {s.strengthIndex.toFixed(1)}%</div>}
        <div className="mt-1 text-[10px] text-muted-foreground">Tap to open</div>
      </div>
    );
  };
  const minM = Math.min(...data.map((d) => d.startMinutes));
  const maxM = Math.max(...data.map((d) => d.startMinutes));
  const lo = Math.max(4 * 60, Math.floor((minM - 60) / 120) * 120);
  const hi = Math.min(28 * 60, Math.ceil((maxM + 60) / 120) * 120);
  const ticks: number[] = [];
  for (let m = lo; m <= hi; m += 120) ticks.push(m);

  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        {mode === "start" ? (
          <ScatterChart margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={grid} />
            <XAxis
              dataKey="t"
              type="number"
              domain={["dataMin", "dataMax"]}
              scale="time"
              stroke={axis}
              fontSize={11}
              tickFormatter={(t) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: timezone })}
              tickCount={4}
            />
            <YAxis
              dataKey="startMinutes"
              type="number"
              domain={[lo, hi]}
              ticks={ticks}
              reversed
              stroke={axis}
              fontSize={11}
              width={62}
              tickFormatter={(m) => formatClock(m).replace(":00", "")}
            />
            <Tooltip content={tooltip} cursor={{ strokeDasharray: "3 3" }} wrapperStyle={{ outline: "none" }} />
            <Scatter
              data={data}
              fill={ANALYTICS_COLORS.blue}
              shape={(props: any) => (
                <circle cx={props.cx} cy={props.cy} r={6} fill={ANALYTICS_COLORS.blue} stroke="var(--card)" strokeWidth={2} />
              )}
              onClick={(p: any) => p?.payload?.id && onOpen(p.payload.id)}
              className="cursor-pointer"
            />
          </ScatterChart>
        ) : (
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
            <XAxis dataKey="label" stroke={axis} fontSize={11} interval="preserveStartEnd" minTickGap={16} />
            <YAxis stroke={axis} fontSize={11} width={44} tickFormatter={(m) => `${m}m`} allowDecimals={false} />
            <Tooltip content={tooltip} cursor={{ fill: "color-mix(in oklab, var(--foreground) 6%, transparent)" }} wrapperStyle={{ outline: "none" }} />
            <Bar
              dataKey="length"
              radius={[4, 4, 0, 0]}
              maxBarSize={22}
              onClick={(p: any) => p?.payload?.id && onOpen(p.payload.id)}
              className="cursor-pointer"
            >
              {data.map((d) => (
                <Cell key={d.id} fill={ANALYTICS_COLORS.purple} />
              ))}
            </Bar>
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

function SessionDetailSheet({
  session,
  clientId,
  timezone,
  canOpenLog,
  onClose,
  onEditTime,
}: {
  session: SessionRow | null;
  clientId: string;
  timezone: string;
  canOpenLog: boolean;
  onClose: () => void;
  onEditTime: (id: string) => void;
}) {
  if (!session) return null;
  const s = session;
  const dateLabel = s.start.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric", timeZone: timezone });
  const slot = TRAINING_WINDOWS.find((w) => w.key === s.window);
  const suspect = s.source === "suspect";

  return (
    <Sheet open onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto rounded-t-2xl pb-safe">
        <SheetHeader className="border-b border-border pb-3 text-left">
          <SheetTitle className="text-base font-black">{s.title || "Workout"}</SheetTitle>
          <div className="text-xs text-muted-foreground">
            {dateLabel}
            {slot && !suspect ? ` · ${slot.label}` : ""}
            {s.source === "confirmed" ? " · time confirmed" : ""}
          </div>
        </SheetHeader>

        <div className="space-y-4 pt-4">
          {suspect && (
            <button
              type="button"
              onClick={() => onEditTime(s.id)}
              className="flex w-full items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-left"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div className="text-xs text-amber-800 dark:text-amber-200">
                <b>This looks logged after training.</b> Tap to set when it really happened so it counts toward your training-time stats.
              </div>
            </button>
          )}

          <div className="grid grid-cols-3 gap-2">
            <Stat label="Start" value={suspect ? "—" : formatClockAt(s.start, timezone)} />
            <Stat label="Finish" value={!suspect && s.end ? formatClockAt(s.end, timezone) : "—"} />
            <Stat label="Length" value={suspect ? "—" : formatMinutes(s.durationMin)} />
            <Stat
              label="Sets logged"
              value={s.loggedSets != null ? `${s.loggedSets}${s.loggingPct != null ? ` · ${Math.round(s.loggingPct)}%` : ""}` : "—"}
            />
            <Stat label="Density" value={!suspect && s.setsPerHour != null ? `${Math.round(s.setsPerHour)}/hr` : "—"} />
            <Stat label="Strength" value={s.strengthIndex != null ? `${s.strengthIndex.toFixed(1)}%` : "—"} highlight={s.strengthIndex != null && s.strengthIndex >= 100} />
            <Stat label="Rating" value={s.rating != null ? `${s.rating}/5` : "—"} />
            <Stat label="Session RPE" value={s.sessionRpe != null ? String(s.sessionRpe) : "—"} />
            <Stat label="Active time" value={formatMinutes(s.activeMin)} />
          </div>

          {(s.strengthFeel || s.fatigueFeel || s.pain) && (
            <div className="flex flex-wrap gap-1.5 text-xs">
              {s.strengthFeel && <Chip label="Strength" value={s.strengthFeel} />}
              {s.fatigueFeel && <Chip label="Fatigue" value={s.fatigueFeel} />}
              {s.pain && <Chip label="Pain" value="Reported" warn />}
            </div>
          )}

          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <FileText className="h-3 w-3" /> Notes
            </div>
            {s.notes || s.reviewNote ? (
              <div className="space-y-2">
                {s.notes && <p className="whitespace-pre-wrap text-sm text-foreground">{s.notes}</p>}
                {s.reviewNote && s.reviewNote !== s.notes && (
                  <p className="whitespace-pre-wrap text-sm italic text-muted-foreground">Review: "{s.reviewNote}"</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No notes on this workout</p>
            )}
          </div>

          <div>
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">What you did</div>
            <InlineWorkoutPreview dayId={s.dayId} clientId={clientId} />
          </div>

          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <Button variant="outline" size="lg" className="w-full" onClick={() => onEditTime(s.id)}>
              <Pencil className="mr-2 h-4 w-4" /> {suspect ? "Set session time" : "Edit session time"}
            </Button>
            {canOpenLog ? (
              <Button asChild size="lg" className="w-full">
                <Link to="/admin/client-programs/$clientId" params={{ clientId }}>
                  <ExternalLink className="mr-2 h-4 w-4" /> Open in program
                </Link>
              </Button>
            ) : (
              <Button asChild size="lg" className="w-full">
                <Link
                  to="/portal/workouts/$dayId"
                  params={{ dayId: s.dayId }}
                  search={s.scheduledWorkoutId ? { instance: s.scheduledWorkoutId } : {}}
                >
                  <ExternalLink className="mr-2 h-4 w-4" /> Open full workout
                </Link>
              </Button>
            )}
            <Button variant="ghost" size="lg" className="w-full" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Stat({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={cn("rounded-lg border p-2.5", highlight ? "border-primary/30 bg-primary/5" : "border-border bg-muted/30")}>
      <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("mt-0.5 truncate text-sm font-black tabular-nums", highlight ? "text-primary" : "text-foreground")}>{value}</div>
    </div>
  );
}

function Chip({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <span
      className={cn(
        "rounded-md border px-2 py-1",
        warn ? "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200" : "border-border bg-background text-foreground",
      )}
    >
      <span className="text-muted-foreground">{label}: </span>
      <b className="capitalize">{value.replace(/_/g, " ")}</b>
    </span>
  );
}
