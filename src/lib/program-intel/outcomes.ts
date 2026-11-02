/**
 * Learning from results: once a program Generate Next Program wrote has been
 * trained, what happened is compared with the strategy it was built from:
 * did the prioritized lifts / muscles improve, was the volume tolerated, did
 * adherence change, were sessions practical, did the chosen exercises
 * progress, and what each decision's monitor showed. Measured results are
 * facts; whether a decision caused them is a hypothesis the coach confirms
 * or dismisses (stored as 'outcome' observations). Nothing here retrains a
 * model: the athlete's record simply grows. Deterministic.
 */
import { fmtLoad, mean, round } from "./core";
import { sliceRecords } from "./load";
import { buildIntelReport } from "./report";
import { exerciseResponse } from "./review";
import type { Strategy } from "./generator-schemas";
import { LIFTS, type Brain, type IntelRecords, type Lift } from "./types";

export type OutcomeItem = { key: string; kind: "fact" | "hypothesis"; title: string; detail: string; evidence: string[]; verdict: "supported" | "contradicted" | "unclear" | null };
export type ProgramOutcome = { jobId: string; label: string; blockIds: string[]; finished: boolean; trainedShare: number; items: OutcomeItem[] };
export type GeneratedJob = { id: string; created_at: string; result: any; brain: Brain };

const LIFT_NAME: Record<Lift, string> = { squat: "Squat", bench: "Bench", deadlift: "Deadlift" };
const pct = (n: number) => `${n > 0 ? "+" : ""}${n}%`;

export function generatedProgramOutcomes(rec: IntelRecords, jobs: GeneratedJob[]): ProgramOutcome[] {
  const out: ProgramOutcome[] = [];
  for (const job of jobs) {
    const ids: string[] = (job.result?.blockIds ?? []).filter((id: string) => rec.blocks.some((b) => b.id === id));
    const strategy: Strategy | null = job.result?.strategy ?? null;
    if (!ids.length || !strategy) continue;
    const r = sliceRecords(rec, ids, "Generated program");
    const rep = buildIntelReport(r, { brainOverride: job.brain });
    const c = rep.coverage;
    const planned = c.plannedDays || 1;
    const trainedShare = Math.round(((c.completedDays + c.partialDays) / planned) * 100);
    const ended = r.blocks.every((b) => b.end_date && b.end_date < rec.today);
    const finished = ended || c.dueDays / planned >= 0.75;
    if (!c.completedDays && !c.partialDays) continue;
    const u = rep.client.unit;
    const items: OutcomeItem[] = [];

    // Prioritized lifts and muscles.
    const prios = [...(job.result?.setup?.priorities ?? []), ...strategy.prioritize.map((p) => p.item)].map((s: string) => s.toLowerCase());
    for (const l of LIFTS) {
      if (!prios.some((p) => p.includes(l))) continue;
      const L = rep.lifts.find((x) => x.lift === l);
      const t = L?.compTrend;
      if (!t || t.changePct == null) {
        items.push({ key: `prio:${l}`, kind: "fact", title: `${LIFT_NAME[l]} (prioritized): not enough exposures to read a trend`, detail: "", evidence: [], verdict: "unclear" });
        continue;
      }
      items.push({ key: `prio:${l}`, kind: "fact", title: `${LIFT_NAME[l]} (prioritized): e1RM ${fmtLoad(t.first as number, u)} → ${fmtLoad(t.last as number, u)} (${pct(t.changePct)})`, detail: `${L!.frequencyPerWeek ?? "?"}×/week, ${L!.setsPerWeek ?? "?"} sets/week.`, evidence: t.points.slice(-3).map((p) => `${p.date}: ${fmtLoad(p.value, u)}`), verdict: t.changePct >= 2 ? "supported" : t.changePct <= 0 ? "contradicted" : "unclear" });
    }
    for (const m of rep.muscles) {
      if (!prios.some((p) => p === m.muscle.toLowerCase())) continue;
      const exs = rep.exercises.filter((e) => e.muscles.includes(m.muscle));
      const up = exs.filter((e) => exerciseResponse(e) === "progressed").length;
      items.push({ key: `prio:${m.muscle}`, kind: "fact", title: `${m.muscle} (prioritized): ${m.avgHardSetsPerWeek ?? "?"} hard sets/week; ${up} of ${exs.length} of its exercises progressed`, detail: "", evidence: exs.slice(0, 4).map((e) => `${e.name}: ${e.trend.changePct != null ? pct(e.trend.changePct) : "no trend"}`), verdict: exs.length ? (up / exs.length >= 0.5 ? "supported" : up === 0 ? "contradicted" : "unclear") : "unclear" });
    }

    // Volume tolerance.
    const setPct = c.prescribedSetsDue ? Math.round((c.completedSets / c.prescribedSetsDue) * 100) : null;
    const deltas = rep.weeks.map((w) => w.avgRpeDelta).filter((n): n is number => n != null);
    const rpeDelta = deltas.length ? round(mean(deltas) as number, 2) : null;
    const pain = rep.recovery.painReports.length;
    items.push({ key: "volume", kind: "fact", title: `Volume: ${setPct ?? "—"}% of prescribed sets done${rpeDelta != null ? `, effort ${rpeDelta > 0 ? "+" : ""}${rpeDelta} RPE vs target` : ""}, ${pain} pain report${pain === 1 ? "" : "s"}`, detail: "", evidence: [], verdict: null });
    const tolerated = (setPct ?? 0) >= 85 && (rpeDelta == null || rpeDelta <= 0.75) && pain <= 1;
    items.push({ key: "volume:read", kind: "hypothesis", title: tolerated ? "The weekly volume looks tolerated" : "The weekly volume may have been too much (or impractical)", detail: tolerated ? "Sets were done at about the planned effort without repeated pain reports." : "Sets were cut short, effort ran over target, or pain was reported more than once.", evidence: [], verdict: tolerated ? "supported" : "contradicted" });

    // Adherence against the program before it.
    const before = job.result?.previousAdherencePct ?? null;
    const now = c.dueDays ? Math.round(((c.completedDays + c.partialDays) / c.dueDays) * 100) : null;
    if (now != null) items.push({ key: "adherence", kind: "fact", title: `Adherence: ${now}% of due workouts${before != null ? ` (previous program ${before}%)` : ""}`, detail: "", evidence: [], verdict: before != null ? (now >= before ? "supported" : now < before - 10 ? "contradicted" : "unclear") : null });

    // Practicality: real session length against the plan's estimate; exercises left undone.
    const est = job.result?.audit?.sessions?.length ? round(mean(job.result.audit.sessions.filter((s: any) => s.week === 1).map((s: any) => s.minutes)) as number, 0) : null;
    const durations = rep.days.map((d) => d.durationMin).filter((n): n is number => n != null && n >= 10 && n <= 240);
    const actual = durations.length ? round(mean(durations) as number, 0) : null;
    const skippedRows = rep.days.filter((d) => d.status === "completed" || d.status === "partial").flatMap((d) => d.rows.filter((r) => r.status === "skipped").map((r) => r.exercise));
    if (actual != null || skippedRows.length)
      items.push({ key: "practical", kind: "fact", title: `Sessions took ${actual ?? "—"} min on average${est != null ? ` (planned about ${est})` : ""}; ${skippedRows.length} exercise${skippedRows.length === 1 ? "" : "s"} left undone on trained days`, detail: skippedRows.length ? `Most often: ${[...new Set(skippedRows)].slice(0, 4).join(", ")}.` : "", evidence: [], verdict: actual != null && est != null ? (actual <= est + 10 && skippedRows.length <= 3 ? "supported" : "contradicted") : null });

    // The exercises the strategy kept or added.
    const chosen = [...strategy.exercise_plan.retain.map((x) => x.name), ...strategy.exercise_plan.add.map((x) => x.name)].map((n) => n.toLowerCase());
    for (const e of rep.exercises.filter((x) => chosen.includes(x.name.toLowerCase()) && x.exposures >= 3).slice(0, 10)) {
      const resp = exerciseResponse(e);
      items.push({ key: `ex:${e.key}`, kind: "fact", title: `${e.name}: ${resp === "progressed" ? "progressed" : resp === "unclear" ? "no clear trend" : resp === "regressed" ? "went backwards" : "stalled"}${e.trend.changePct != null ? ` (${pct(e.trend.changePct)} e1RM)` : ""}`, detail: `${e.exposures} exposures.`, evidence: [], verdict: resp === "progressed" ? "supported" : resp === "unclear" ? "unclear" : "contradicted" });
    }

    // Each decision, beside what was measured on its subject.
    strategy.decisions.forEach((d, i) => {
      const text = `${d.area} ${d.change} ${d.observation}`.toLowerCase();
      const lift = LIFTS.find((l) => text.includes(l));
      const L = lift ? rep.lifts.find((x) => x.lift === lift) : null;
      const measured = L?.compTrend.changePct != null ? `${LIFT_NAME[lift as Lift]} ${pct(L.compTrend.changePct)} e1RM during the program` : `${setPct ?? "—"}% of sets done, ${now ?? "—"}% of workouts`;
      items.push({ key: `decision:${i}`, kind: "hypothesis", title: `Decision: ${d.change}`, detail: `Monitor: ${d.monitor || "—"}. Measured: ${measured}. Whether the decision caused this is for you to judge.`, evidence: d.evidence.slice(0, 3), verdict: L?.compTrend.changePct != null ? (L.compTrend.changePct >= 2 ? "supported" : L.compTrend.changePct <= 0 ? "contradicted" : "unclear") : "unclear" });
    });
    out.push({ jobId: job.id, label: job.result?.program?.program_name ?? "Generated program", blockIds: ids, finished, trainedShare, items });
  }
  return out;
}

/** Lines for the next brief: finished generated programs and what came of them. */
export function outcomeLines(outcomes: ProgramOutcome[]): string[] {
  return outcomes.filter((o) => o.finished).flatMap((o) => [`${o.label} (${o.trainedShare}% of its workouts trained):`, ...o.items.filter((i) => i.kind === "fact").map((i) => `  ${i.title}${i.verdict ? ` [${i.verdict}]` : ""}`)]);
}

