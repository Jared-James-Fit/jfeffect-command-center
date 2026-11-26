/**
 * Performance: only what a game day coach needs about the squat, bench and
 * deadlift. The strength chart is the athlete's own (StrengthTrendChart, the
 * same engine), so both read the same numbers. Every figure says whether it
 * was measured, lifted at a meet, or estimated; a missing one stays missing.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CartesianGrid,
  Line,
  ComposedChart,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CalendarClock } from "lucide-react";
import { QueryState, CardSkeleton } from "@/components/loading";
import { StrengthTrendChart } from "@/components/analytics/strength-trend-chart";
import { LIFT_COLORS } from "@/lib/analytics-format";
import { COMP_LIFTS, type CompLift } from "@/lib/analytics/competition-strength";
import { billingDay } from "@/lib/date-range";
import { cn } from "@/lib/utils";
import { stateWords, type PerformanceView } from "@/lib/team-access/performance";
import { getSpecialistPerformance } from "@/lib/team-access/specialist.functions";
import { inUnit, useSpecialist } from "./specialist-context";
import { NotShared } from "./specialist-shell";
import { UnitSwitch } from "./footage-tab";

const LIFT_WORD: Record<CompLift, string> = {
  squat: "Squat",
  bench: "Bench",
  deadlift: "Deadlift",
};
const DAY = 86_400_000;

export function PerformanceTab() {
  const { athlete } = useSpecialist();
  if (!athlete) return null;
  if (!athlete.performance) return <NotShared what="Performance" />;
  return <PerformanceBody clientId={athlete.clientId} />;
}

function PerformanceBody({ clientId }: { clientId: string }) {
  const load = useServerFn(getSpecialistPerformance);
  const perf = useQuery({
    queryKey: ["specialist-performance", clientId],
    queryFn: () => load({ data: { clientId } }),
    staleTime: 5 * 60_000,
  });
  return (
    <QueryState query={perf} what="the numbers" skeleton={<CardSkeleton lines={6} />}>
      {(p) => <PerformanceView p={p} />}
    </QueryState>
  );
}

function PerformanceView({ p }: { p: PerformanceView }) {
  const { unit } = useSpecialist();
  const today = new Date().toISOString().slice(0, 10);
  const yearAgo = new Date(Date.now() - 365 * DAY).toISOString().slice(0, 10);
  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <UnitSwitch />
      </div>

      {p.upcoming && (
        <div className="flex items-center gap-3 rounded-2xl border border-border p-3">
          <CalendarClock className="h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{p.upcoming.name}</div>
            <div className="truncate text-xs text-muted-foreground">
              {[
                billingDay(p.upcoming.date),
                p.upcoming.federation,
                p.upcoming.weightClass && `${p.upcoming.weightClass} kg class`,
                p.upcoming.location,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-semibold tabular-nums">{p.upcoming.daysOut}</div>
            <div className="text-[11px] text-muted-foreground">
              {p.upcoming.daysOut === 1 ? "day out" : "days out"}
            </div>
          </div>
        </div>
      )}

      <section className="space-y-2">
        <h2 className="text-base font-semibold">Where they are now</h2>
        <div className="grid grid-cols-3 gap-2">
          {COMP_LIFTS.map((l) => {
            const now = p.lifts[l].now;
            return (
              <div key={l} className="rounded-xl border border-border p-2.5">
                <div className="text-xs text-muted-foreground">{LIFT_WORD[l]}</div>
                <div className="text-lg font-semibold tabular-nums">
                  {now ? `${inUnit(now.lb, unit)} ${unit}` : "—"}
                </div>
                <div className="text-[11px] leading-tight text-muted-foreground">
                  {now ? `Estimated max · ${stateWords(now.state)}` : "No recent hard set"}
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-sm">
          {p.estimatedTotal ? (
            <>
              Estimated total{" "}
              <span className="font-semibold tabular-nums">
                {unit === "kg" ? p.estimatedTotal.kg : p.estimatedTotal.lb} {unit}
              </span>
              <span className="text-muted-foreground">
                {" "}
                · an estimate from training, not a meet result
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">
              No estimated total: one of the lifts has no recent hard set.
            </span>
          )}
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">Estimated max over time</h2>
        <StrengthTrendChart strength={p.strength} start={yearAgo} end={today} unit={unit} />
      </section>

      <HeavySingles p={p} />
      <RpeAndSpeed p={p} />
      <Meets p={p} />
    </div>
  );
}

function HeavySingles({ p }: { p: PerformanceView }) {
  const { unit } = useSpecialist();
  const [all, setAll] = useState(false);
  if (!p.heavySingles.length) return null;
  const rows = all ? p.heavySingles : p.heavySingles.slice(0, 8);
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold">Heavy singles</h2>
      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5 text-left font-medium">Day</th>
              <th className="px-3 py-1.5 text-left font-medium">Lift</th>
              <th className="px-3 py-1.5 text-right font-medium">Weight</th>
              <th className="px-3 py-1.5 text-right font-medium">RPE</th>
              <th className="px-3 py-1.5 text-right font-medium">Speed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s, i) => (
              <tr key={`${s.day}-${s.lift}-${i}`} className="border-t border-border">
                <td className="px-3 py-1.5">{billingDay(s.day)}</td>
                <td className="px-3 py-1.5">{LIFT_WORD[s.lift]}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">
                  {inUnit(s.lb, unit)} {unit}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">{s.rpe ?? "—"}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">
                  {s.mps != null ? `${s.mps.toFixed(2)} m/s` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {p.heavySingles.length > 8 && (
        <button
          type="button"
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => setAll((v) => !v)}
        >
          {all ? "Show fewer" : `Show all ${p.heavySingles.length}`}
        </button>
      )}
    </section>
  );
}

function RpeAndSpeed({ p }: { p: PerformanceView }) {
  const { unit } = useSpecialist();
  const trained = COMP_LIFTS.filter((l) => p.rpePoints[l].length || p.velocity[l].length);
  const [lift, setLift] = useState<CompLift | null>(null);
  if (!trained.length) return null;
  const l = lift && trained.includes(lift) ? lift : trained[0];
  const color = LIFT_COLORS[l];
  const rpe = p.rpePoints[l].map((x) => ({
    w: inUnit(x.lb, unit),
    rpe: x.rpe,
    reps: x.reps,
    day: x.day,
  }));
  const vel = p.velocity[l].map((x) => ({
    w: inUnit(x.lb, unit),
    mps: x.mps,
    reps: x.reps,
    day: x.day,
  }));
  const fit = p.loadVelocity[l];
  const fitLine = fit
    ? [fit.fromLb, fit.toLb].map((lb) => ({
        w: inUnit(lb, unit),
        fit: Math.round((fit.intercept + fit.slope * lb) * 100) / 100,
      }))
    : [];
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Weight, effort and bar speed</h2>
        <div
          className="inline-flex rounded-lg border border-border p-0.5 text-xs"
          role="radiogroup"
          aria-label="Lift"
        >
          {trained.map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={l === t}
              onClick={() => setLift(t)}
              className={cn(
                "rounded-md px-2.5 py-1",
                l === t ? "bg-secondary font-semibold" : "text-muted-foreground",
              )}
            >
              {LIFT_WORD[t]}
            </button>
          ))}
        </div>
      </div>
      {rpe.length > 0 ? (
        <div>
          <div className="mb-1 text-xs text-muted-foreground">
            Weight against the RPE they logged (sets of 1 to 5, last 6 months)
          </div>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="color-mix(in oklab, var(--border) 60%, transparent)"
                />
                <XAxis
                  type="number"
                  dataKey="w"
                  domain={["auto", "auto"]}
                  tick={{ fontSize: 10 }}
                  stroke="var(--muted-foreground)"
                  unit={` ${unit}`}
                />
                <YAxis
                  type="number"
                  dataKey="rpe"
                  domain={[5, 10]}
                  ticks={[6, 7, 8, 9, 10]}
                  tick={{ fontSize: 10 }}
                  stroke="var(--muted-foreground)"
                  width={28}
                />
                <Tooltip
                  cursor={{ strokeDasharray: "3 3" }}
                  wrapperStyle={{ outline: "none" }}
                  content={({ payload }) => {
                    const d = payload?.[0]?.payload as (typeof rpe)[number] | undefined;
                    if (!d) return null;
                    return (
                      <div className="rounded-lg border border-border bg-background px-2 py-1 text-xs shadow-sm">
                        {billingDay(d.day)} · {d.w} {unit} × {d.reps} @ RPE {d.rpe}
                      </div>
                    );
                  }}
                />
                <Scatter data={rpe} fill={color} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : null}
      {vel.length > 0 ? (
        <div>
          <div className="mb-1 text-xs text-muted-foreground">
            Measured bar speed against weight
            {fit
              ? ` · the line is fitted from ${fit.n} sets`
              : " · not enough sets to fit a line yet"}
          </div>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="color-mix(in oklab, var(--border) 60%, transparent)"
                />
                <XAxis
                  type="number"
                  dataKey="w"
                  domain={["auto", "auto"]}
                  tick={{ fontSize: 10 }}
                  stroke="var(--muted-foreground)"
                  unit={` ${unit}`}
                />
                <YAxis
                  type="number"
                  domain={[0, "auto"]}
                  tick={{ fontSize: 10 }}
                  stroke="var(--muted-foreground)"
                  width={36}
                />
                <Tooltip
                  cursor={{ strokeDasharray: "3 3" }}
                  wrapperStyle={{ outline: "none" }}
                  content={({ payload }) => {
                    const d = payload?.[0]?.payload as any;
                    if (!d || d.mps == null) return null;
                    return (
                      <div className="rounded-lg border border-border bg-background px-2 py-1 text-xs shadow-sm">
                        {billingDay(d.day)} · {d.w} {unit} × {d.reps} · {d.mps.toFixed(2)} m/s
                      </div>
                    );
                  }}
                />
                <Scatter data={vel} dataKey="mps" fill={color} />
                {fitLine.length === 2 && (
                  <Line
                    data={fitLine}
                    dataKey="fit"
                    stroke="var(--muted-foreground)"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No measured bar speed on the {LIFT_WORD[l].toLowerCase()} yet.
        </p>
      )}
    </section>
  );
}

function Meets({ p }: { p: PerformanceView }) {
  const { unit } = useSpecialist();
  if (!p.meets.length) return null;
  const kg = (v: number | null) =>
    v == null ? "—" : unit === "kg" ? `${v}` : `${Math.round(v * 2.2046226218 * 10) / 10}`;
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold">Meets</h2>
      <div className="space-y-2">
        {p.meets.slice(0, 12).map((m) => (
          <div key={`${m.date}-${m.name}`} className="rounded-xl border border-border p-3 text-sm">
            <div className="flex items-baseline gap-2">
              <span className="truncate font-semibold">{m.name ?? "Meet"}</span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                {billingDay(m.date, { year: "always" })}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              {[
                m.federation,
                m.weightClass && `${m.weightClass} kg`,
                m.place && `Place ${m.place}`,
                m.totalKg != null && `Total ${kg(m.totalKg)} ${unit}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
            {m.attempts && (
              <div className="mt-1.5 grid grid-cols-3 gap-2 text-xs">
                {COMP_LIFTS.map((l) => (
                  <div key={l}>
                    <div className="text-muted-foreground">{LIFT_WORD[l]}</div>
                    <div className="flex flex-wrap gap-1">
                      {m.attempts![l].map((a, i) => (
                        <span
                          key={i}
                          className={cn(
                            "tabular-nums",
                            a.made ? "" : "text-muted-foreground line-through",
                          )}
                          title={a.made ? "Made" : "Missed"}
                        >
                          {kg(a.kg)}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Meet numbers are what was lifted on the platform. Missed attempts are struck through.
      </p>
    </section>
  );
}
