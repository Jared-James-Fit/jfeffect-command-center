/**
 * What the previous program tells us, for the coach planning the next one:
 * the biggest improvements, the main weaknesses, the exercises and
 * progressions that worked, workload that looks too much or too little,
 * recovery and consistency concerns, what to keep, what to adjust and what's
 * missing. Every item is a measured FACT (with the records named), a
 * HYPOTHESIS (an interpretation, never a proven response) or MISSING.
 * Deterministic.
 */
import { fmtLoad, fmtSet, mean, round, sum } from "./core";
import type { AthleteContext } from "./context";
import type { DataQuality } from "./quality";
import type { ExerciseReport, IntelReport } from "./types";

export type ReviewItem = { kind: "fact" | "hypothesis" | "missing"; title: string; detail: string; evidence: string[]; subject?: string };
export type ProgramReview = {
  improvements: ReviewItem[];
  weaknesses: ReviewItem[];
  effective: ReviewItem[];
  workload: ReviewItem[];
  recovery: ReviewItem[];
  maintain: ReviewItem[];
  adjust: ReviewItem[];
  missing: ReviewItem[];
};
export const REVIEW_SECTIONS: Array<[keyof ProgramReview, string]> = [
  ["improvements", "Biggest improvements"],
  ["weaknesses", "Main weaknesses"],
  ["effective", "Effective exercises and progressions"],
  ["workload", "Workload: possibly too much or too little"],
  ["recovery", "Recovery and consistency"],
  ["maintain", "Worth keeping"],
  ["adjust", "Worth adjusting"],
  ["missing", "Missing information"],
];

const pct = (n: number) => `${n > 0 ? "+" : ""}${n}%`;

function progressText(e: ExerciseReport, unit: "kg" | "lb"): string | null {
  if (e.trend.first != null && e.trend.last != null && e.trend.changePct != null) return `e1RM ${fmtLoad(e.trend.first, unit)} → ${fmtLoad(e.trend.last, unit)} (${pct(e.trend.changePct)})`;
  if (e.repsTrend?.first != null && e.repsTrend.last != null) return `best reps ${e.repsTrend.first} → ${e.repsTrend.last}`;
  return null;
}

/** Did an exercise progress, stall or go back, from its own exposures. */
export function exerciseResponse(e: ExerciseReport): "progressed" | "stalled" | "regressed" | "unclear" {
  if (e.exposures < 3) return "unclear";
  const c = e.trend.changePct;
  if (c != null) {
    if (c >= 3) return "progressed";
    if (c <= -3) return "regressed";
    return e.stalled || Math.abs(c) < 1.5 ? "stalled" : "unclear";
  }
  if (e.repsTrend?.first != null && e.repsTrend.last != null) return e.repsTrend.last - e.repsTrend.first >= 2 ? "progressed" : e.repsTrend.last <= e.repsTrend.first ? "stalled" : "unclear";
  return "unclear";
}

export function reviewPreviousProgram(prev: IntelReport, ctx: AthleteContext, quality: DataQuality): ProgramReview {
  const u = prev.client.unit;
  const r: ProgramReview = { improvements: [], weaknesses: [], effective: [], workload: [], recovery: [], maintain: [], adjust: [], missing: [] };
  const exs = prev.exercises.filter((e) => e.exposures >= 3);
  const progressed = exs.filter((e) => exerciseResponse(e) === "progressed").sort((a, b) => (b.trend.changePct ?? 0) - (a.trend.changePct ?? 0));
  const stalled = exs.filter((e) => ["stalled", "regressed"].includes(exerciseResponse(e)));

  // Biggest improvements: the main lifts first, then the exercises that moved most.
  for (const L of prev.lifts) {
    const t = L.compTrend;
    if (t.changePct != null && t.changePct >= 2 && L.exposures.filter((x) => x.competition && x.e1rm != null).length >= 3)
      r.improvements.push({ kind: "fact", subject: L.lift, title: `${L.competitionExercise ?? L.lift}: e1RM ${fmtLoad(t.first as number, u)} → ${fmtLoad(t.last as number, u)} (${pct(t.changePct)})`, detail: `${L.exposures.filter((x) => x.competition).length} competition exposures, ${L.frequencyPerWeek ?? "?"}×/week, ${L.setsPerWeek ?? "?"} working sets/week.`, evidence: t.points.slice(-3).map((p) => `${p.date}: e1RM ${fmtLoad(p.value, u)}`) });
  }
  for (const e of progressed.slice(0, 6)) {
    if (r.improvements.some((x) => x.subject === e.lift && e.competition)) continue;
    r.improvements.push({ kind: "fact", subject: e.name, title: `${e.name}: ${progressText(e, u)}`, detail: `${e.exposures} exposures, ${e.adherencePct ?? "?"}% of its prescribed sets done${e.avgRpe != null ? `, avg RPE ${e.avgRpe}` : ""}. Best set ${fmtSet(e.bestSet, u)}.`, evidence: e.trend.points.slice(-3).map((p) => `${p.date}: e1RM ${fmtLoad(p.value, u)}`) });
  }

  // Main weaknesses: lifts / exercises that stalled or went back, exercises that were skipped.
  for (const e of stalled.slice(0, 6))
    r.weaknesses.push({ kind: "fact", subject: e.name, title: `${e.name}: ${exerciseResponse(e) === "regressed" ? "went backwards" : "no clear progress"} (${progressText(e, u) ?? "no load trend"})`, detail: `${e.exposures} exposures${e.stalled ? ", no new best in the last 3" : ""}${e.avgRpe != null ? `, avg RPE ${e.avgRpe}` : ""}.`, evidence: e.trend.points.slice(-4).map((p) => `${p.date}: e1RM ${fmtLoad(p.value, u)}`) });
  const skippedEx = prev.exercises.filter((e) => e.adherencePct != null && e.adherencePct < 75 && e.setsPrescribedDue >= 6);
  for (const e of skippedEx.slice(0, 5))
    r.weaknesses.push({ kind: "fact", subject: e.name, title: `${e.name}: only ${e.adherencePct}% of its prescribed sets done`, detail: `${e.workingSetsLogged} working sets logged of ${e.setsPrescribedDue} due.`, evidence: [] });
  for (const m of prev.muscles.filter((x) => x.target && x.status === "below"))
    r.weaknesses.push({ kind: "fact", subject: m.muscle, title: `${m.muscle}: ${m.avgHardSetsPerWeek} hard sets/week, below its target`, detail: `Target ${m.target?.mev ?? "?"}–${m.target?.mrv ?? "?"}.`, evidence: [] });

  // What worked: exercises that progressed with the sets done, and how they were prescribed.
  const rowsByEx = new Map<string, Array<{ reps: string | null; rpe: string | null; sets: number | null }>>();
  for (const d of prev.days) for (const row of d.rows) {
    const k = row.exerciseId ?? `name:${row.exercise.toLowerCase()}`;
    rowsByEx.set(k, [...(rowsByEx.get(k) ?? []), { reps: row.prescribed.reps, rpe: row.prescribed.rpe, sets: row.prescribed.sets }]);
  }
  for (const e of progressed.filter((x) => (x.adherencePct ?? 0) >= 90).slice(0, 8)) {
    const rx = rowsByEx.get(e.key) ?? [];
    const reps = [...new Set(rx.map((x) => x.reps).filter(Boolean))].join(" / ");
    const rpe = [...new Set(rx.map((x) => x.rpe).filter(Boolean))].join(" / ");
    const sets = round(mean(rx.map((x) => x.sets ?? 0).filter(Boolean)) ?? 0, 1);
    r.effective.push({ kind: "fact", subject: e.name, title: `${e.name} progressed with every prescribed set done`, detail: `Prescribed ${sets} sets × ${reps || "?"}${rpe ? ` @RPE ${rpe}` : ""}; ${progressText(e, u)}.`, evidence: [`${e.exposures} exposures, ${e.adherencePct}% of sets`] });
  }
  if (r.effective.length >= 2)
    r.effective.push({ kind: "hypothesis", title: "The progression model coincided with progress on most exercises", detail: "Rep ranges with an RPE target and load added when the top of the range was reached (as prescribed) went with gains on the exercises above; worth keeping unless a lift stalled under it. An association, not proof.", evidence: [] });

  // Workload: effort against target, volume, session length.
  const deltas = prev.weeks.map((w) => w.avgRpeDelta).filter((n): n is number => n != null);
  const rpeConf = quality.confidence.find((c) => c.topic.startsWith("Effort"));
  if (deltas.length >= 2 && rpeConf && rpeConf.level !== "none" && rpeConf.level !== "low") {
    const late = prev.weeks.slice(-2).map((w) => w.avgRpeDelta).filter((n): n is number => n != null);
    const avg = round(mean(deltas) as number, 2);
    const lateAvg = late.length ? round(mean(late) as number, 2) : null;
    if (avg >= 0.6 || (lateAvg != null && lateAvg >= 0.8))
      r.workload.push({ kind: "hypothesis", title: "Effort ran above target: the dose may have been more than planned", detail: `Logged RPE averaged ${pct(avg)} points vs target${lateAvg != null ? ` (${lateAvg > 0 ? "+" : ""}${lateAvg} in the last two weeks)` : ""}. Heavier loads than intended or accumulating fatigue are both possible.`, evidence: prev.weeks.filter((w) => w.avgRpeDelta != null).slice(-4).map((w) => `${w.label}: RPE ${w.avgRpeDelta! > 0 ? "+" : ""}${w.avgRpeDelta} vs target`) });
    else if (avg <= -0.8)
      r.workload.push({ kind: "hypothesis", title: "Effort ran below target: loads may have been conservative", detail: `Logged RPE averaged ${avg} vs target. Sets stopped further from failure than planned.`, evidence: prev.weeks.filter((w) => w.avgRpeDelta != null).slice(-4).map((w) => `${w.label}: RPE ${w.avgRpeDelta} vs target`) });
    else r.workload.push({ kind: "fact", title: `Effort matched the targets (${avg > 0 ? "+" : ""}${avg} RPE on average)`, detail: "Logged RPE stayed within about half a point of what was prescribed.", evidence: [] });
  } else if (rpeConf && (rpeConf.level === "none" || rpeConf.level === "low")) {
    r.workload.push({ kind: "missing", title: "Effort vs target can't be judged", detail: rpeConf.why, evidence: [] });
  }
  const weeksTrained = prev.weeks.filter((w) => w.completedDays + w.partialDays > 0);
  const hardPerWeek = weeksTrained.length ? round(sum(weeksTrained.map((w) => w.hardSets)) / weeksTrained.length, 1) : null;
  if (hardPerWeek != null) {
    const top = prev.muscles.filter((m) => m.avgHardSetsPerWeek != null).slice(0, 8).map((m) => `${m.muscle} ${m.avgHardSetsPerWeek}`);
    r.workload.push({ kind: "fact", title: `${hardPerWeek} hard sets per week in total`, detail: `By muscle (primary 1.0, secondary 0.5): ${top.join(", ") || "—"}.`, evidence: [] });
    for (const m of prev.muscles.filter((x) => !x.target && x.avgHardSetsPerWeek != null && x.avgHardSetsPerWeek > 22))
      r.workload.push({ kind: "hypothesis", title: `${m.muscle}: ${m.avgHardSetsPerWeek} hard sets/week may be more than needed`, detail: "Above what most lifters need to progress; worth checking how its main exercises responded before keeping it.", evidence: [] });
  }
  if (ctx.session.observedMedian != null && ctx.session.goalsMinutes != null && ctx.session.observedP80 != null && ctx.session.observedP80 > ctx.session.goalsMinutes + 5)
    r.workload.push({ kind: "fact", title: `Sessions often ran past their ${ctx.session.goalsMinutes}-minute limit`, detail: `Median ${ctx.session.observedMedian} min, 1 in 5 over ${ctx.session.observedP80} min.`, evidence: [] });

  // Recovery and consistency.
  const c = prev.coverage;
  if (c.dueDays) {
    const pctTrained = Math.round(((c.completedDays + c.partialDays) / c.dueDays) * 100);
    r.recovery.push({ kind: "fact", title: `Trained ${c.completedDays + c.partialDays} of ${c.dueDays} due workouts (${pctTrained}%) and completed ${c.completedSets} of ${c.prescribedSetsDue} prescribed sets`, detail: `${c.completedDays} finished, ${c.partialDays} logged but not marked finished, ${c.missedDays} missed.`, evidence: prev.weeks.filter((w) => w.missedDays).map((w) => `${w.label}: ${w.missedDays} missed`) });
    if (pctTrained < 80) r.recovery.push({ kind: "hypothesis", title: "Consistency was the main limiter", detail: "With this many missed sessions, the program's design can't be judged fully; fitting the plan to the days they can train may matter more than any variable.", evidence: [] });
  }
  for (const area of ctx.injuries.areas) {
    const n = ctx.injuries.painReports.filter((p) => (p.area ?? "").toLowerCase().trim() === area).length;
    r.recovery.push({ kind: "fact", title: `${n} pain report${n === 1 ? "" : "s"}: ${area}`, detail: "From post-workout check-outs. An interpretation of cause would be a hypothesis, not a diagnosis.", evidence: ctx.injuries.painReports.filter((p) => (p.area ?? "").toLowerCase().trim() === area).slice(0, 4).map((p) => `${p.date ?? "?"}: level ${p.level ?? "?"}${p.note ? ` "${p.note}"` : ""}`) });
  }
  const fatigue = Object.entries(prev.recovery.fatigue);
  if (fatigue.length) r.recovery.push({ kind: "fact", title: `Fatigue in check-outs: ${fatigue.map(([k, v]) => `${k} ×${v}`).join(", ")}`, detail: `Session RPE ${prev.recovery.sessionRpeAvg ?? "—"}.`, evidence: [] });
  const sleep = Object.entries(prev.recovery.sleep);
  if (sleep.length) r.recovery.push({ kind: "fact", title: `Sleep reported: ${sleep.map(([k, v]) => `${k} ×${v}`).join(", ")}`, detail: "", evidence: [] });

  // Keep and adjust.
  const prog = ctx.previous;
  if (prog && prog.sessionAdherencePct != null && prog.sessionAdherencePct >= 85 && prog.plannedDaysPerWeek)
    r.maintain.push({ kind: "fact", title: `${prog.plannedDaysPerWeek} training days a week`, detail: `${prog.sessionAdherencePct}% of due workouts trained at this frequency: no sign the schedule was too much.`, evidence: [] });
  for (const e of progressed.filter((x) => (x.adherencePct ?? 0) >= 85).slice(0, 8)) r.maintain.push({ kind: "fact", subject: e.name, title: e.name, detail: `Progressed: ${progressText(e, u)}.`, evidence: [] });
  if (r.effective.length >= 2) r.maintain.push({ kind: "hypothesis", title: "The progression method", detail: "It coincided with progress on most exercises.", evidence: [] });
  for (const e of stalled.slice(0, 6)) r.adjust.push({ kind: "hypothesis", subject: e.name, title: e.name, detail: `Stalled over ${e.exposures} exposures. Before replacing it, check whether the dose, effort or exercise is the limiter.`, evidence: [] });
  for (const e of skippedEx.slice(0, 4)) r.adjust.push({ kind: "hypothesis", subject: e.name, title: `${e.name} (often not done)`, detail: `${e.adherencePct}% of its sets done: impractical, disliked or too late in the session? Worth asking before keeping it.`, evidence: [] });
  for (const w of r.workload.filter((x) => x.kind === "hypothesis")) r.adjust.push({ ...w });

  for (const m of quality.missing) r.missing.push({ kind: "missing", title: m, detail: "", evidence: [] });
  for (const cr of quality.confidence.filter((x) => x.level === "none" || x.level === "low")) r.missing.push({ kind: "missing", title: `${cr.topic}: ${cr.level === "none" ? "can't be read" : "low confidence"}`, detail: [cr.why, cr.instead].filter(Boolean).join(" "), evidence: [] });
  return r;
}
