import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Heart, ChevronDown, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { format } from "date-fns";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { InfoTip } from "@/components/analytics/info-tip";
import {
  summarizeCardio,
  cardioInsight,
  prescribedFor,
  modalitySupportsInclineSpeed,
  type CardioCompletionRow,
  type CardioSession,
  type CardioTargetRow,
} from "@/lib/analytics/cardio-adherence";

type TrendMetric = "minutes" | "adherence" | "effort" | "calories";
const SESSIONS_SHOWN = 8;

interface Props {
  clientId: string;
  rangeStart: Date;
  rangeEnd: Date;
  rangeLabel: string;
}

/**
 * Dedicated CARDIO section of Training Analytics.
 * Canonical sources only: cardio_targets (prescription) +
 * cardio_completions (logged results). Math lives in
 * @/lib/analytics/cardio-adherence so Readiness can't disagree.
 */
export function CardioAnalyticsSection({ clientId, rangeStart, rangeEnd, rangeLabel }: Props) {
  const startStr = format(rangeStart, "yyyy-MM-dd");
  const endStr = format(rangeEnd, "yyyy-MM-dd");
  const [metric, setMetric] = useState<TrendMetric>("minutes");
  const [showWeeks, setShowWeeks] = useState(false);
  const [showSessions, setShowSessions] = useState(false);
  const [allSessions, setAllSessions] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["cardio-analytics", clientId, startStr, endStr],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async () => {
      // Prior window of equal length, for the trend insight only.
      const spanDays = Math.max(
        1,
        Math.round((rangeEnd.getTime() - rangeStart.getTime()) / 86_400_000) + 1,
      );
      const priorStart = new Date(rangeStart.getTime() - spanDays * 86_400_000);
      const priorStartStr = format(priorStart, "yyyy-MM-dd");

      const [completionsRes, targetsRes] = await Promise.all([
        (supabase as any)
          .from("cardio_completions")
          .select(
            "id, cardio_target_id, completed_date, completed, skipped, duration_minutes, cardio_type, incline, avg_speed, distance, distance_unit, calories, avg_heart_rate, rpe, completion_target",
          )
          .eq("client_id", clientId)
          .gte("completed_date", priorStartStr)
          .lte("completed_date", endStr),
        (supabase as any)
          .from("cardio_targets")
          .select(
            "id, cardio_type, custom_type, frequency_per_week, duration_minutes, intensity, heart_rate_zone, start_date, end_date, status, enabled",
          )
          .eq("client_id", clientId),
      ]);

      const allCompletions = (completionsRes.data ?? []) as CardioCompletionRow[];
      const targets = (targetsRes.data ?? []) as CardioTargetRow[];

      const summary = summarizeCardio({
        targets,
        completions: allCompletions,
        start: startStr,
        end: endStr,
      });

      const priorMinutes = allCompletions
        .filter(
          (c) =>
            c.completed_date >= priorStartStr &&
            c.completed_date < startStr &&
            c.completed === true &&
            !c.skipped,
        )
        .reduce((s, c) => s + (Number(c.duration_minutes) || 0), 0);

      const priorPrescribed = prescribedFor(targets, priorStartStr, startStr);

      return { summary, priorMinutes: Math.round(priorMinutes), priorPrescribed };
    },
  });

  const summary = data?.summary;

  const chartData = useMemo(
    () =>
      (summary?.weeks ?? []).map((w) => ({
        label: w.label,
        minutes: w.completedMinutes,
        prescribed: w.prescribedMinutes,
        adherence: w.adherence ?? 0,
        effort: w.avgRpe,
        calories: w.calories ?? 0,
      })),
    [summary],
  );
  // a trend view only when there's something in it
  const metrics = useMemo(() => {
    const list: TrendMetric[] = ["minutes"];
    if (summary?.hasPrescription) list.push("adherence");
    if ((summary?.rpeSessions ?? 0) > 0) list.push("effort");
    if ((summary?.caloriesSessions ?? 0) > 0) list.push("calories");
    return list;
  }, [summary]);
  const shownMetric: TrendMetric = metrics.includes(metric) ? metric : "minutes";

  const insight = summary
    ? cardioInsight(summary, rangeLabel, data?.priorMinutes ?? null)
    : null;

  const header = (
    <div className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:flex sm:flex-wrap sm:justify-between">
      <h2 className="flex min-w-0 items-center gap-2 truncate text-base font-semibold text-foreground">
        <Heart className="h-5 w-5 shrink-0 text-primary" />
        <span className="truncate">Cardio</span>
        <InfoTip label="About cardio analytics" title="Cardio" align="start">
          Prescribed cardio comes from the client's cardio targets (weekly
          frequency × weeks the target is live in this range). Completed comes
          from logged cardio sessions marked complete — skipped sessions never
          count. Adherence = completed ÷ prescribed. This is the same
          calculation Training Readiness uses.
        </InfoTip>
      </h2>
      <span className="shrink-0 text-xs font-semibold text-muted-foreground">{rangeLabel}</span>
    </div>
  );

  if (isLoading || !summary) {
    return (
      <section aria-label="Cardio">
        {header}
        <Card className="border-border/80 bg-card p-4">
          <div className="h-16 animate-pulse rounded-lg bg-muted/40" />
        </Card>
      </section>
    );
  }

  // No prescription AND nothing logged → explicit empty state, never 0%.
  if (!summary.hasPrescription && summary.completedSessions === 0 && summary.skippedSessions === 0) {
    return (
      <section aria-label="Cardio">
        {header}
        <Card className="border-border/80 bg-card p-4">
          <p className="text-sm font-semibold text-muted-foreground">
            No cardio prescribed in this range.
          </p>
        </Card>
      </section>
    );
  }

  return (
    <section aria-label="Cardio" id="cardio" className="scroll-mt-24">
      {header}
      <Card className="border-border/80 bg-card p-4">
        {/* Summary metrics */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Cell label="Prescribed" value={summary.prescribedSessions > 0 ? String(summary.prescribedSessions) : "—"} />
          <Cell label="Completed" value={String(summary.completedSessions)} />
          <Cell
            label="Adherence"
            value={summary.adherence != null ? `${summary.adherence}%` : "—"}
            highlight={summary.adherence != null}
            tip={
              <InfoTip label="About adherence" title="Adherence" align="end">
                Completed prescribed cardio sessions in this range.
              </InfoTip>
            }
          />
          <Cell
            label="Total Minutes"
            value={`${summary.completedMinutes} min`}
            sublabel={
              summary.prescribedMinutes > 0
                ? `of ${summary.prescribedMinutes} min prescribed`
                : undefined
            }
            tip={
              <InfoTip label="About cardio minutes" title="Minutes" align="end">
                Actual cardio minutes completed compared with prescribed minutes.
              </InfoTip>
            }
          />
        </div>

        {/* What each session was like: effort, calories, heart rate (only what was logged) */}
        {(summary.avgRpe != null || summary.totalCalories != null || summary.avgHeartRate != null) && (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4" data-cardio-details>
            {summary.avgRpe != null && (
              <Cell
                label="Avg effort"
                value={`RPE ${summary.avgRpe}`}
                sublabel={`${summary.rpeSessions} of ${summary.completedSessions} session${summary.completedSessions === 1 ? "" : "s"} rated`}
                tip={
                  <InfoTip label="About cardio effort" title="Effort" align="start">
                    How hard the sessions felt (RPE 1–10), as the client logged it. The same cardio at a lower RPE over time usually means fitness is improving.
                  </InfoTip>
                }
              />
            )}
            {summary.totalCalories != null && (
              <Cell
                label="Calories"
                value={`${summary.totalCalories.toLocaleString()} kcal`}
                sublabel={`avg ${summary.avgCalories} per session · ${summary.caloriesSessions} logged`}
                tip={
                  <InfoTip label="About cardio calories" title="Calories" align="end">
                    As logged from the machine or a watch, so read it as a trend rather than an exact number.
                  </InfoTip>
                }
              />
            )}
            {summary.avgHeartRate != null && (
              <Cell label="Avg heart rate" value={`${summary.avgHeartRate} bpm`} />
            )}
          </div>
        )}

        {/* Minutes target comparison */}
        {summary.prescribedMinutes > 0 && (
          <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Minutes vs Target
              </span>
              <span className="text-sm font-bold text-foreground">
                {summary.completedMinutes} / {summary.prescribedMinutes} min
                {summary.minutesAdherence != null && (
                  <span className="ml-2 text-xs font-bold text-muted-foreground">
                    {summary.minutesAdherence}%
                  </span>
                )}
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${Math.min(100, summary.minutesAdherence ?? 0)}%` }}
              />
            </div>
            {summary.avgDuration != null && (
              <div className="mt-2 text-[11px] font-semibold text-muted-foreground">
                Avg session {summary.avgDuration} min
              </div>
            )}
          </div>
        )}

        {summary.skippedSessions > 0 && (
          <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs font-semibold text-amber-700 dark:text-amber-300">
            {summary.skippedSessions} cardio session{summary.skippedSessions === 1 ? "" : "s"} marked as skipped in this range.
          </div>
        )}

        {/* Trend */}
        {chartData.length > 1 && (
          <div className="mt-4">
            <div className="mb-2 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Cardio Trend
              </span>
              <div className="-mx-1 flex gap-1 overflow-x-auto px-1">
                {metrics.map((m) => (
                  <Button
                    key={m}
                    type="button"
                    size="sm"
                    variant={shownMetric === m ? "secondary" : "ghost"}
                    className="h-8 shrink-0 px-2 text-[11px] font-bold"
                    onClick={() => setMetric(m)}
                    data-cardio-metric={m}
                  >
                    {m === "minutes" ? "Minutes" : m === "adherence" ? "Adherence %" : m === "effort" ? "Effort" : "Calories"}
                  </Button>
                ))}
              </div>
            </div>
            <div className="h-44 w-full">
              <ResponsiveContainer width="100%" height="100%">
                {shownMetric === "effort" ? (
                  <LineChart data={chartData} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                    <YAxis domain={[0, 10]} ticks={[0, 2, 4, 6, 8, 10]} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={36} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: any) => [v == null ? "Not rated" : `RPE ${v}`, "Avg effort"]} />
                    <Line type="monotone" dataKey="effort" connectNulls stroke="var(--primary)" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                ) : shownMetric === "calories" ? (
                  <BarChart data={chartData} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={40} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: any) => [`${v} kcal`, "Calories"]} />
                    <Bar dataKey="calories" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                ) : shownMetric === "minutes" ? (
                  <BarChart data={chartData} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={36} />
                    <Tooltip
                      contentStyle={{ fontSize: 12, borderRadius: 8 }}
                      formatter={(v: any, n: any) => [`${v} min`, n === "minutes" ? "Completed" : "Prescribed"]}
                    />
                    <Bar dataKey="minutes" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                ) : (
                  <LineChart data={chartData} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={36} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: any) => [`${v}%`, "Adherence"]} />
                    <Line type="monotone" dataKey="adherence" stroke="var(--primary)" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                )}
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Zone 2 tracker */}
        {summary.zone2 && (
          <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-primary">Zone 2 / LISS</span>
              <InfoTip label="About Zone 2" title="Zone 2 / LISS" align="start">
                Low-intensity aerobic work prescribed as Zone 2/LISS.
              </InfoTip>
            </div>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm font-bold text-foreground">
              <span>
                {summary.zone2.completedSessions} / {summary.zone2.prescribedSessions} sessions
              </span>
              <span>
                {summary.zone2.completedMinutes} / {summary.zone2.prescribedMinutes} min
              </span>
              {summary.zone2.adherence != null && (
                <span className="text-primary">{summary.zone2.adherence}% adherence</span>
              )}
            </div>
          </div>
        )}

        {/* Modality breakdown */}
        {summary.modalities.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Modality
            </div>
            <div className="space-y-2">
              {summary.modalities.map((m) => (
                <div key={m.modality} className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <span className="text-sm font-bold text-foreground">{m.modality}</span>
                    <span className="text-xs font-semibold text-muted-foreground">
                      {m.sessions} session{m.sessions === 1 ? "" : "s"} · {m.minutes} min · {m.pctOfMinutes}%
                    </span>
                  </div>
                  {modalitySupportsInclineSpeed(m.modality) && (m.avgIncline != null || m.avgSpeed != null) && (
                    <div className="mt-1 flex gap-4 text-[11px] font-semibold text-muted-foreground">
                      {m.avgIncline != null && <span>Avg incline {m.avgIncline}</span>}
                      {m.avgSpeed != null && <span>Avg speed {m.avgSpeed} {m.speedUnit}</span>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Zone breakdown */}
        {summary.zones.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Intensity / Zone
            </div>
            <div className="flex flex-wrap gap-2">
              {summary.zones.map((z) => (
                <span
                  key={z.zone}
                  className="rounded-full border border-border bg-muted/40 px-3 py-1 text-xs font-bold text-foreground"
                >
                  {z.label} · {z.minutes} min
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Is the same cardio getting easier? */}
        {summary.effort && (
          <div className="mt-4 flex gap-2 rounded-lg border border-border bg-muted/30 p-3" data-cardio-effort={summary.effort.direction}>
            {summary.effort.direction === "easier" ? (
              <TrendingDown className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            ) : summary.effort.direction === "harder" ? (
              <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            ) : (
              <Minus className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Effort · {summary.effort.modality} · {summary.effort.sessions} rated sessions
              </div>
              <p className="mt-0.5 text-xs font-semibold text-foreground">{summary.effort.text}</p>
            </div>
          </div>
        )}

        {/* Every session, with what was logged */}
        {summary.sessions.length > 0 && (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setShowSessions((v) => !v)}
              aria-expanded={showSessions}
              className="flex min-h-10 w-full items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2 text-left"
              data-cardio-sessions-toggle
            >
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Sessions ({summary.sessions.length})
              </span>
              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${showSessions ? "rotate-180" : ""}`} />
            </button>
            {showSessions && (
              <div className="mt-2 space-y-1" data-cardio-sessions>
                {(allSessions ? summary.sessions : summary.sessions.slice(0, SESSIONS_SHOWN)).map((x, i) => (
                  <SessionRow key={x.id ?? `${x.date}-${i}`} session={x} />
                ))}
                {!allSessions && summary.sessions.length > SESSIONS_SHOWN && (
                  <Button type="button" variant="ghost" className="h-10 w-full text-xs font-semibold" onClick={() => setAllSessions(true)}>
                    Show all {summary.sessions.length}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Weekly adherence */}
        {summary.weeks.length > 0 && (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setShowWeeks((v) => !v)}
              className="flex w-full items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2 text-left"
            >
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Weekly adherence
              </span>
              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${showWeeks ? "rotate-180" : ""}`} />
            </button>
            {showWeeks && (
              <div className="mt-2 space-y-1">
                {summary.weeks.map((w) => (
                  <div
                    key={w.start}
                    className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-lg border border-border/70 px-3 py-2 text-xs"
                  >
                    <span className="font-bold text-foreground">Week {w.index}</span>
                    <span className="font-semibold text-muted-foreground">
                      {w.completedSessions}/{w.prescribedSessions} · {w.completedMinutes}/{w.prescribedMinutes} min
                      {w.adherence != null ? ` · ${w.adherence}%` : " · no cardio prescribed"}
                      {w.avgRpe != null ? ` · RPE ${w.avgRpe}` : ""}
                      {w.calories != null ? ` · ${w.calories} kcal` : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {insight && (
          <p className="mt-4 rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs font-semibold text-muted-foreground">
            {insight}
          </p>
        )}
      </Card>
    </section>
  );
}

/** One session: when, what, and every number that was logged for it. */
function SessionRow({ session: x }: { session: CardioSession }) {
  const facts = [
    x.minutes != null ? `${x.minutes} min` : null,
    x.calories != null ? `${x.calories} kcal` : null,
    x.rpe != null ? `RPE ${x.rpe}` : null,
    x.heartRate != null ? `${x.heartRate} bpm` : null,
    x.incline != null ? `${x.incline}% incline` : null,
    x.speed != null ? `${x.speed} ${x.distanceUnit === "km" || x.distanceUnit === "kilometers" ? "km/h" : "mph"}` : null,
    x.distance != null ? `${x.distance} ${x.distanceUnit ?? ""}`.trim() : null,
  ].filter(Boolean) as string[];
  const date = (() => {
    const [y, m, d] = x.date.split("-").map(Number);
    return format(new Date(y, (m ?? 1) - 1, d ?? 1), "EEE MMM d");
  })();
  return (
    <div className="rounded-lg border border-border/70 px-3 py-2 text-xs" data-cardio-session>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-bold text-foreground">{date}</span>
        <span className="truncate text-[11px] font-semibold text-muted-foreground">
          {x.modality}
          {x.skipped ? " · skipped" : x.fromWorkout ? " · in a workout" : ""}
        </span>
      </div>
      {!x.skipped && (
        <div className="mt-0.5 font-semibold tabular-nums text-muted-foreground">
          {facts.length ? facts.join(" · ") : "Done, nothing else logged"}
        </div>
      )}
    </div>
  );
}

function Cell({
  label,
  value,
  highlight,
  sublabel,
  tip,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  sublabel?: string;
  tip?: React.ReactNode;
}) {
  return (
    <div className={`rounded-lg border p-3 ${highlight ? "border-primary/30 bg-primary/5" : "border-border bg-muted/30"}`}>
      <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        <span className="truncate">{label}</span>
        {tip}
      </div>
      <div className={`mt-1 text-xl font-bold ${highlight ? "text-primary" : "text-foreground"}`}>{value}</div>
      {sublabel && <div className="mt-0.5 text-[10px] text-muted-foreground">{sublabel}</div>}
    </div>
  );
}
