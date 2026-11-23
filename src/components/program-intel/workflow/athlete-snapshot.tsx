/**
 * The athlete at a glance: a few numbers, the last 12 weeks of workouts as a
 * heatmap, each main lift's trend against itself, and where the weekly hard
 * sets go. Every picture is from their records (no AI), with its numbers in
 * words beside it (never colour alone).
 */
import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { fmtLoad } from "@/lib/program-intel/core";
import { adherenceGrid, overviewSparks, sparkPath, type HeatCell } from "@/lib/program-intel/insights";
import type { GeneratorIntel } from "@/lib/program-intel/intelligence";
import { overLimit, sessionLimit } from "@/lib/program-intel/session-limit";
import { BRAIN_LABEL, STRENGTH_BRAINS } from "@/lib/program-intel/types";

const CELL: Record<HeatCell["status"], string> = {
  done: "bg-success",
  partial: "bg-success/45",
  missed: "bg-destructive/70",
  planned: "border border-foreground/30 bg-transparent",
  rest: "bg-muted",
  future: "bg-transparent",
};
const CELL_WORD: Record<HeatCell["status"], string> = { done: "done", partial: "logged, not finished", missed: "missed", planned: "planned", rest: "nothing planned", future: "" };
const DOW = ["M", "T", "W", "T", "F", "S", "S"];

function Stat({ label, value, sub, warn }: { label: string; value: string; sub?: string | null; warn?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[11px] text-muted-foreground">{label}</div>
      <div className={cn("truncate text-lg font-semibold tabular-nums leading-tight", warn && "text-warning")}>{value}</div>
      {sub ? <div className="truncate text-[11px] text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

export function AthleteSnapshot({ intel }: { intel: GeneratorIntel }) {
  const report = intel.prev ?? intel.history;
  const { ctx } = intel;
  const today = ctx.today;
  const grid = useMemo(() => adherenceGrid(intel.history.days, today, 12), [intel.history.days, today]);
  const strength = STRENGTH_BRAINS.includes(intel.brain);
  // trends over the program they just did (each exercise against itself), else their whole history
  const sparks = useMemo(() => overviewSparks(intel.prev ?? intel.history, strength, 4), [intel.prev, intel.history, strength]);
  const muscles = useMemo(() => [...report.muscles].filter((m) => m.avgHardSetsPerWeek != null).sort((a, b) => (b.avgHardSetsPerWeek ?? 0) - (a.avgHardSetsPerWeek ?? 0)).slice(0, 8), [report.muscles]);
  const maxSets = Math.max(10, ...muscles.map((m) => Math.max(m.avgHardSetsPerWeek ?? 0, m.target?.mrv ?? 0)));
  const c = report.coverage;
  const trained = c.completedDays + c.partialDays;
  const adherence = c.dueDays ? Math.round((trained / c.dueDays) * 100) : null;
  const setsPct = c.prescribedSetsDue ? Math.round((Math.min(c.completedSets, c.prescribedSetsDue) / c.prescribedSetsDue) * 100) : null;
  const lim = sessionLimit(ctx.session);
  const sessionOver = overLimit(ctx.session.observedMedian, lim.minutes);
  const u = ctx.unit;
  const done = grid.flatMap((w) => w.cells).filter((x) => x.status === "done" || x.status === "partial").length;
  const missed = grid.flatMap((w) => w.cells).filter((x) => x.status === "missed").length;

  if (intel.firstProgram)
    return (
      <Card className="space-y-2 p-4" data-workflow-section="overview" data-testid="gen-athlete-overview">
        <h2 className="text-base font-semibold">Athlete overview</h2>
        <p className="text-[13px] text-muted-foreground">Starting from their setup: nothing logged yet. The next program is built from what they log.</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Program type" value={BRAIN_LABEL[intel.brain]} sub={intel.brainSource === "auto" ? "from their goal" : "set by you"} />
          <Stat label="Experience" value={ctx.profile.experience ?? "Not on file"} warn={!ctx.profile.experience} />
          <Stat label="Training days" value={ctx.schedule.committedFrequency ? `${ctx.schedule.committedFrequency} a week` : ctx.schedule.goalsDaysPerWeek ? `${ctx.schedule.goalsDaysPerWeek} a week` : "Not on file"} />
          <Stat label="Session limit" value={lim.minutes ? `${lim.minutes} min` : "Not on file"} sub={lim.source === "pt" ? "PT session" : lim.source ? "Goals & Setup" : null} />
        </div>
      </Card>
    );

  return (
    <Card className="space-y-4 p-4" data-workflow-section="overview" data-testid="gen-athlete-overview">
      <div>
        <h2 className="text-base font-semibold">Athlete overview</h2>
        <p className="truncate text-xs text-muted-foreground">{BRAIN_LABEL[intel.brain]} · {intel.prev ? `last program: ${intel.prevLabel}` : "full history"}</p>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <Stat label="Workouts trained" value={adherence != null ? `${adherence}%` : "—"} sub={c.dueDays ? `${trained} of ${c.dueDays}` : null} warn={adherence != null && adherence < 80} />
        <Stat label="Sets done" value={setsPct != null ? `${setsPct}%` : "—"} sub={c.prescribedSetsDue ? `${c.completedSets} of ${c.prescribedSetsDue}` : null} />
        <Stat label="Session length" value={ctx.session.observedMedian != null ? `${ctx.session.observedMedian} min` : "—"} sub={lim.minutes ? `limit ${lim.short}` : "no limit on file"} warn={sessionOver} />
        <Stat
          label="Bodyweight"
          value={ctx.profile.bodyweightKg != null ? fmtLoad(ctx.profile.bodyweightKg, u) : "—"}
          sub={ctx.profile.bodyweightChange4wKg != null ? `${ctx.profile.bodyweightChange4wKg > 0 ? "+" : ""}${u === "lb" ? Math.round(ctx.profile.bodyweightChange4wKg * 2.2046) : ctx.profile.bodyweightChange4wKg}${u} in 4 weeks` : ctx.profile.bodyweightDate ?? "not logged"}
        />
      </div>

      {/* the last 12 weeks, a column a week */}
      <div className="space-y-1.5" data-adherence-heatmap>
        <div className="flex items-baseline justify-between text-xs">
          <span className="font-medium">Last 12 weeks</span>
          <span className="text-muted-foreground">{done} trained · {missed} missed</span>
        </div>
        <div className="flex gap-1">
          <div className="grid grid-rows-7 gap-1 pr-0.5 text-[9px] leading-none text-muted-foreground">
            {DOW.map((d, i) => <span key={i} className="flex h-3 items-center">{d}</span>)}
          </div>
          <div className="grid flex-1 grid-flow-col grid-rows-7 gap-1" style={{ gridTemplateColumns: `repeat(${grid.length}, minmax(0, 1fr))` }}>
            {grid.flatMap((w) =>
              w.cells.map((cell) => (
                <span key={cell.date} className={cn("h-3 min-w-0 rounded-[3px]", CELL[cell.status])} title={cell.status === "future" ? cell.date : `${cell.date}: ${CELL_WORD[cell.status]}`} />
              )),
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
          {(["done", "partial", "missed", "planned"] as const).map((s) => (
            <span key={s} className="inline-flex items-center gap-1"><span className={cn("h-2.5 w-2.5 rounded-[3px]", CELL[s])} /> {CELL_WORD[s]}</span>
          ))}
        </div>
      </div>

      {sparks.length > 0 && (
        <div className="space-y-1.5" data-overview-sparks>
          <div className="text-xs font-medium">Strength trends <span className="font-normal text-muted-foreground">· estimated max, each exercise against itself{intel.prev ? ", last program" : ""}</span></div>
          <div className="grid gap-2 sm:grid-cols-2">
            {sparks.map((s) => {
              const path = sparkPath(s.values, 96, 28);
              const up = (s.changePct ?? 0) >= 2;
              const down = (s.changePct ?? 0) <= -2;
              return (
                <div key={s.key} className="flex items-center gap-3 rounded-xl bg-muted/40 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">{s.label}</div>
                    <div className="text-xs tabular-nums text-muted-foreground">
                      {s.first} → {s.last} {s.unit}{" "}
                      {s.changePct != null && <span className={cn("font-semibold", up ? "text-success" : down ? "text-destructive" : "")}>{s.changePct > 0 ? "+" : ""}{s.changePct}%</span>}
                    </div>
                  </div>
                  {path && (
                    <svg width={96} height={28} viewBox="0 0 96 28" aria-hidden className="shrink-0">
                      <path d={path} fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={up ? "stroke-success" : down ? "stroke-destructive" : "stroke-foreground/60"} />
                    </svg>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {muscles.length > 0 && (
        <div className="space-y-1.5" data-overview-volume>
          <div className="text-xs font-medium">Weekly hard sets by muscle <span className="font-normal text-muted-foreground">· primary 1, secondary ½</span></div>
          <div className="space-y-1">
            {muscles.map((m) => {
              const v = m.avgHardSetsPerWeek ?? 0;
              const off = m.target && m.status !== "within";
              return (
                <div key={m.muscle} className="grid grid-cols-[88px_1fr_40px] items-center gap-2 text-xs">
                  <span className="truncate capitalize text-muted-foreground">{m.muscle}</span>
                  <span className="relative h-2.5 rounded-full bg-muted">
                    {m.target?.mev != null && m.target?.mrv != null && (
                      <span className="absolute inset-y-0 rounded-full bg-foreground/10" style={{ left: `${(m.target.mev / maxSets) * 100}%`, width: `${((m.target.mrv - m.target.mev) / maxSets) * 100}%` }} title={`Target ${m.target.mev}–${m.target.mrv}`} />
                    )}
                    <span className={cn("absolute inset-y-0 left-0 rounded-full", off ? "bg-warning" : "bg-foreground/70")} style={{ width: `${Math.min(100, (v / maxSets) * 100)}%` }} />
                  </span>
                  <span className={cn("text-right tabular-nums", off && "text-warning")}>{v}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}
