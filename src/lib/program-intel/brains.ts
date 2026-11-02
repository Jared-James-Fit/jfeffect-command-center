/**
 * The two coaching brains (and their combinations), as deterministic rules
 * over the measured report. Each finding says whether it is a FACT (measured
 * straight from the records, with the records named as evidence), a
 * HYPOTHESIS (a coaching interpretation of those facts, never a proven
 * response) or MISSING (what the records can't tell us).
 */
import { fmtLoad, fmtSet, mean, round, sum } from "./core";
import {
  HYPERTROPHY_BRAINS,
  LIFTS,
  STRENGTH_BRAINS,
  type BlockReport,
  type Brain,
  type Coverage,
  type ExerciseReport,
  type Finding,
  type IntelRecords,
  type Lift,
  type LiftReport,
  type MuscleReport,
  type Unit,
  type WeekMetrics,
} from "./types";

export type BrainInput = {
  rec: IntelRecords;
  unit: Unit;
  weeks: WeekMetrics[];
  lifts: LiftReport[];
  muscles: MuscleReport[];
  exercises: ExerciseReport[];
  blocks: BlockReport[];
  coverage: Coverage;
  recovery: { sessionRpeAvg: number | null; painReports: Array<{ date: string | null; area: string | null; level: number | null; note: string | null }> };
  bodyweight: { first: number | null; last: number | null; changeKg: number | null; entries: number };
};

const LIFT_NAME: Record<Lift, string> = { squat: "Squat", bench: "Bench", deadlift: "Deadlift" };
/** The change between two shown weights, from the same rounding as the weights themselves. */
function bwChange(firstKg: number, lastKg: number, unit: Unit): string {
  const conv = (kg: number) => (unit === "lb" ? Math.round(kg * 2.2046226218) : Math.round(kg * 2) / 2);
  const d = round(conv(lastKg) - conv(firstKg), 1);
  return `${d > 0 ? "+" : ""}${d}${unit}`;
}
const pctTxt = (n: number) => `${n > 0 ? "+" : ""}${n}%`;

function f(x: Omit<Finding, "evidence"> & { evidence?: string[] }): Finding {
  return { ...x, evidence: x.evidence ?? [] };
}

/** Adherence, effort accuracy, recovery and data gaps: read the same way by every brain. */
export function commonFindings(b: BrainInput): Finding[] {
  const out: Finding[] = [];
  const { coverage: c, weeks, unit } = b;
  const due = c.dueDays;
  const trained = c.completedDays + c.partialDays;
  if (due > 0) {
    const pct = Math.round((trained / due) * 100);
    const setsPct = c.prescribedSetsDue ? Math.round((Math.min(c.completedSets, c.prescribedSetsDue) / c.prescribedSetsDue) * 100) : null;
    const missedWeeks = weeks.filter((w) => w.missedDays > 0).map((w) => `${w.label}: ${w.missedDays} missed`);
    out.push(
      f({
        id: "adherence:overall",
        area: pct >= 85 ? "improved" : pct < 75 ? "change" : "next",
        kind: "fact",
        subject: "adherence",
        title: `Trained ${trained} of ${due} due workouts (${pct}%)${setsPct != null ? `, ${c.completedSets} of ${c.prescribedSetsDue} prescribed sets done (${setsPct}%)` : ""}`,
        detail: `${c.completedDays} finished, ${c.partialDays} partly logged, ${c.missedDays} missed. ${c.upcomingDays} still upcoming are not counted.`,
        evidence: missedWeeks.slice(0, 8),
      }),
    );
    const planned = mean(weeks.filter((w) => w.plannedDays > 0).map((w) => w.plannedDays));
    const want = b.rec.goals?.training_days_per_week;
    if (pct < 80 && want && planned && planned > want + 0.4) {
      out.push(
        f({
          id: "adherence:days-vs-goal",
          area: "change",
          kind: "hypothesis",
          subject: "adherence",
          title: `Programmed ${round(planned, 1)} days/week against their stated ${want} (Goals & Setup)`,
          detail: "Missed sessions may come from the schedule asking for more days than they said they can train. Matching the plan to their days could raise adherence.",
          evidence: [`Goals & Setup: ${want} days/week`, `Programmed: ${round(planned, 1)} days/week on average`],
        }),
      );
    }
  }
  const deltas = weeks.map((w) => w.avgRpeDelta).filter((n): n is number => n != null);
  const avgDelta = deltas.length ? round(mean(deltas) as number, 2) : null;
  if (avgDelta != null && Math.abs(avgDelta) >= 0.75) {
    const worst = [...weeks].filter((w) => w.avgRpeDelta != null).sort((a, z) => Math.abs(z.avgRpeDelta as number) - Math.abs(a.avgRpeDelta as number)).slice(0, 4);
    out.push(
      f({
        id: "effort:rpe-vs-target",
        area: "change",
        kind: "fact",
        subject: "effort",
        title: `Sets were logged ${avgDelta > 0 ? "harder" : "easier"} than prescribed: ${avgDelta > 0 ? "+" : ""}${avgDelta} RPE on average`,
        detail: "Measured on every exercise that had a target RPE and a logged RPE.",
        evidence: worst.map((w) => `${w.label}: ${(w.avgRpeDelta as number) > 0 ? "+" : ""}${w.avgRpeDelta} RPE vs target`),
      }),
      f({
        id: "effort:rpe-vs-target:why",
        area: "next",
        kind: "hypothesis",
        subject: "effort",
        title: avgDelta > 0 ? "Loads may be set too heavy for the target RPE, or fatigue is building" : "Loads may be set too light for the target RPE (or RPE is under-reported)",
        detail: avgDelta > 0 ? "Consider starting the next cycle's loads a little lower or adding a lighter week; check whether the gap grows late in each block." : "Consider nudging loads up, or coaching RPE calibration with video or rep speed.",
      }),
    );
  }
  const pain = b.recovery.painReports;
  if (pain.length) {
    const byArea = new Map<string, number>();
    for (const p of pain) byArea.set((p.area || "unspecified").toLowerCase(), (byArea.get((p.area || "unspecified").toLowerCase()) ?? 0) + 1);
    for (const [area, n] of byArea) {
      out.push(
        f({
          id: `recovery:pain:${area}`,
          area: n >= 2 ? "change" : "next",
          kind: "fact",
          subject: "recovery",
          title: `${n} pain report${n === 1 ? "" : "s"} (${area}) in post-workout check-outs`,
          detail: n >= 2 ? "Repeated reports in one area: worth reviewing the exercises and loads that load it before the next cycle (an interpretation, not a diagnosis)." : "One report: keep an eye on it.",
          evidence: pain.filter((p) => (p.area || "unspecified").toLowerCase() === area).map((p) => `${p.date ?? "?"}: level ${p.level ?? "?"}${p.note ? ` · "${p.note}"` : ""}`),
        }),
      );
    }
  }
  if (b.bodyweight.entries >= 2 && b.bodyweight.changeKg != null) {
    out.push(
      f({
        id: "bodyweight:change",
        area: "next",
        kind: "fact",
        subject: "bodyweight",
        title: `Bodyweight ${fmtLoad(b.bodyweight.first as number, unit)} → ${fmtLoad(b.bodyweight.last as number, unit)} (${bwChange(b.bodyweight.first as number, b.bodyweight.last as number, unit)})`,
        detail: `${b.bodyweight.entries} weigh-ins in this period.`,
      }),
    );
  }
  // What the records can't tell us.
  if (c.setsWithoutRpePct != null && c.setsWithoutRpePct >= 30)
    out.push(f({ id: "missing:rpe", area: "missing", kind: "missing", subject: "data", title: `${c.setsWithoutRpePct}% of done sets have no RPE or RIR logged`, detail: "Effort, proximity to failure and RPE accuracy are read only from the sets that have one; e1RM for those sets uses reps alone." }));
  if (!c.feedbackEntries) out.push(f({ id: "missing:feedback", area: "missing", kind: "missing", subject: "data", title: "No post-workout check-outs in this period", detail: "Session RPE, fatigue, sleep and pain can't be read." }));
  if (!b.rec.goals) out.push(f({ id: "missing:goals", area: "missing", kind: "missing", subject: "data", title: "No Goals & Setup on file", detail: "Training days, session length, experience, equipment and injuries are unknown to this report." }));
  if (c.unmappedRows) out.push(f({ id: "missing:unmapped", area: "missing", kind: "missing", subject: "data", title: `${c.unmappedRows} prescribed exercise${c.unmappedRows === 1 ? "" : "s"} not linked to the exercise library`, detail: "Their muscle groups and lift family are unknown, so they don't count toward muscle volume or lift analysis." }));
  if (!c.bodyweightEntries) out.push(f({ id: "missing:bodyweight", area: "missing", kind: "missing", subject: "data", title: "No bodyweight entries", detail: "Relative strength, weight class and physique change can't be read." }));
  if (c.unscheduledDays) out.push(f({ id: "missing:undated", area: "missing", kind: "missing", subject: "data", title: `${c.unscheduledDays} workout${c.unscheduledDays === 1 ? "" : "s"} with no date and no logs`, detail: "Counted as neither due nor missed." }));
  for (const u of c.unreadable) out.push(f({ id: `missing:unreadable:${u}`, area: "missing", kind: "missing", subject: "data", title: `Couldn't read: ${u}`, detail: "Left out of this report." }));
  if (c.completedDays + c.partialDays < 3) out.push(f({ id: "missing:few-sessions", area: "missing", kind: "missing", subject: "data", title: `Only ${c.completedDays + c.partialDays} trained workout${c.completedDays + c.partialDays === 1 ? "" : "s"} in this period`, detail: "Too little to judge progress; widen the period for more evidence." }));
  return out;
}

function liftSetsPerWeekIn(weeks: WeekMetrics[], blockId: string, lift: Lift): number | null {
  const ws = weeks.filter((w) => w.blockId === blockId && w.completedDays + w.partialDays > 0);
  return ws.length ? round(sum(ws.map((w) => w.lifts[lift].sets)) / ws.length, 1) : null;
}
function liftFreqIn(weeks: WeekMetrics[], blockId: string, lift: Lift): number | null {
  const ws = weeks.filter((w) => w.blockId === blockId && w.completedDays + w.partialDays > 0);
  return ws.length ? round(sum(ws.map((w) => w.lifts[lift].sessions)) / ws.length, 1) : null;
}

export function powerliftingFindings(b: BrainInput): Finding[] {
  const out: Finding[] = [];
  const { unit } = b;
  const kg = (n: number | null) => (n == null ? "?" : fmtLoad(n, unit));
  for (const L of b.lifts) {
    const name = L.competitionExercise ?? `Competition ${LIFT_NAME[L.lift]}`;
    const comp = L.exposures.filter((e) => e.competition && e.e1rm != null);
    if (comp.length < 2) {
      out.push(f({ id: `pl:${L.lift}:few`, area: "missing", kind: "missing", subject: L.lift, title: `${comp.length} logged ${name.toLowerCase()} exposure${comp.length === 1 ? "" : "s"} with a load and reps`, detail: "Not enough to read a trend for this lift." }));
    } else {
      const t = L.compTrend;
      const ev = [comp[0], comp[comp.length - 1]].map((e) => `${e.exercise} · ${e.date ?? "?"} · top ${fmtSet(e.topSet, unit)} → e1RM ${kg(e.e1rm)}`);
      if (t.changePct != null && t.changePct >= 2) {
        out.push(f({ id: `pl:${L.lift}:improved`, area: "improved", kind: "fact", subject: L.lift, title: `${name} e1RM ${kg(t.first)} → ${kg(t.last)} (${pctTxt(t.changePct)})`, detail: `${comp.length} exposures${t.slopePerWeek != null ? `, trend ${t.slopePerWeek > 0 ? "+" : ""}${unit === "lb" ? round(t.slopePerWeek * 2.2046, 1) + "lb" : t.slopePerWeek + "kg"}/week` : ""}. Peak ${kg(t.peak)}.`, evidence: ev }));
      } else if (t.changePct != null && t.changePct <= -2.5) {
        out.push(f({ id: `pl:${L.lift}:regressed`, area: "stalled", kind: "fact", subject: L.lift, title: `${name} e1RM fell ${kg(t.first)} → ${kg(t.last)} (${pctTxt(t.changePct)})`, detail: `${comp.length} exposures.`, evidence: ev }));
      } else if (L.stalled || (t.changePct != null && Math.abs(t.changePct) < 2)) {
        out.push(f({ id: `pl:${L.lift}:stalled`, area: "stalled", kind: "fact", subject: L.lift, title: `${name} e1RM flat: ${kg(t.first)} → ${kg(t.last)} (${pctTxt(t.changePct ?? 0)})`, detail: L.stalled ? "No new best in the last 3 exposures." : `${comp.length} exposures without a clear change.`, evidence: ev }));
      }
      const flat = out.some((x) => x.id === `pl:${L.lift}:stalled` || x.id === `pl:${L.lift}:regressed`);
      if (flat) {
        const why: string[] = [];
        if (L.frequencyPerWeek != null && L.frequencyPerWeek < 1.5) why.push(`trained ${L.frequencyPerWeek}×/week (more frequent practice may help)`);
        if (L.setsPerWeek != null && L.setsPerWeek < 6) why.push(`${L.setsPerWeek} working sets/week (low volume for most intermediate lifters)`);
        if (L.avgRpeDelta != null && L.avgRpeDelta >= 0.75) why.push(`sets ran +${L.avgRpeDelta} RPE over target (accumulated fatigue?)`);
        const hardShare = L.rpeBuckets.hard / Math.max(1, L.rpeBuckets.easy + L.rpeBuckets.moderate + L.rpeBuckets.hard);
        if (hardShare >= 0.4) why.push(`${Math.round(hardShare * 100)}% of its working sets at RPE 9+ (little room to recover between exposures)`);
        if (L.avgRelativeIntensityPct != null && L.avgRelativeIntensityPct < 70) why.push(`average load ${L.avgRelativeIntensityPct}% of best e1RM (intensity may be too low to express strength)`);
        if (why.length)
          out.push(f({ id: `pl:${L.lift}:stalled:why`, area: "next", kind: "hypothesis", subject: L.lift, title: `Possible reasons ${LIFT_NAME[L.lift].toLowerCase()} stalled`, detail: why.join("; ") + ". These are interpretations to test, not proven causes.", evidence: [`Frequency ${L.frequencyPerWeek ?? "?"}×/wk`, `Sets ${L.setsPerWeek ?? "?"}/wk`, `RPE vs target ${L.avgRpeDelta ?? "n/a"}`] }));
      }
    }
    if (L.backoffCompletionPct != null && L.backoffCompletionPct < 80)
      out.push(f({ id: `pl:${L.lift}:backoffs`, area: "change", kind: "fact", subject: L.lift, title: `${LIFT_NAME[L.lift]} back-off sets: ${L.backoffCompletionPct}% of prescribed sets done`, detail: "Back-off volume was often cut short." }));
    for (const v of L.variations.filter((x) => x.exposures >= 3 && x.compChangeDuringPct != null).slice(0, 3)) {
      out.push(f({ id: `pl:${L.lift}:variation:${v.exerciseId ?? v.exercise}`, area: "next", kind: "hypothesis", subject: L.lift, title: `While ${v.exercise} was programmed (${v.weeks.join(", ")}), competition ${LIFT_NAME[L.lift].toLowerCase()} e1RM changed ${pctTxt(v.compChangeDuringPct as number)}`, detail: `${v.exercise} itself: ${v.trend.first != null ? `${kg(v.trend.first)} → ${kg(v.trend.last)} e1RM` : "no e1RM"} over ${v.exposures} exposures. An association over the same weeks, not proof that it transferred.`, evidence: v.trend.points.slice(-3).map((p) => `${v.exercise} ${p.date}: e1RM ${kg(p.value)}`) }));
    }
  }
  // Which block each lift responded to best (facts side by side, then a hypothesis).
  for (const lift of LIFTS) {
    const withChange = b.blocks.filter((bl) => bl.liftChange[lift].changePct != null);
    if (withChange.length < 2) continue;
    const best = [...withChange].sort((a, z) => (z.liftChange[lift].changePct as number) - (a.liftChange[lift].changePct as number))[0];
    const worst = [...withChange].sort((a, z) => (a.liftChange[lift].changePct as number) - (z.liftChange[lift].changePct as number))[0];
    if (best.blockId === worst.blockId) continue;
    const line = (bl: BlockReport) => `B${bl.number} "${bl.name}": ${pctTxt(bl.liftChange[lift].changePct as number)} e1RM, ${liftSetsPerWeekIn(b.weeks, bl.blockId, lift) ?? "?"} sets/wk, ${liftFreqIn(b.weeks, bl.blockId, lift) ?? "?"}×/wk, avg RPE ${bl.avgRpe ?? "?"}`;
    out.push(f({ id: `pl:${lift}:block-response`, area: "next", kind: "fact", subject: lift, title: `${LIFT_NAME[lift]} moved most in Block ${best.number} and least in Block ${worst.number}`, detail: "Measured within each block from its first to its last competition exposures.", evidence: [line(best), line(worst)] }));
    const bs = liftSetsPerWeekIn(b.weeks, best.blockId, lift);
    const ws = liftSetsPerWeekIn(b.weeks, worst.blockId, lift);
    const bf = liftFreqIn(b.weeks, best.blockId, lift);
    const wf = liftFreqIn(b.weeks, worst.blockId, lift);
    const diffs: string[] = [];
    if (bs != null && ws != null && Math.abs(bs - ws) >= 2) diffs.push(`${bs > ws ? "more" : "fewer"} weekly sets (${bs} vs ${ws})`);
    if (bf != null && wf != null && Math.abs(bf - wf) >= 0.5) diffs.push(`${bf > wf ? "higher" : "lower"} frequency (${bf} vs ${wf}×/wk)`);
    if (diffs.length)
      out.push(f({ id: `pl:${lift}:block-response:why`, area: "next", kind: "hypothesis", subject: lift, title: `${LIFT_NAME[lift]} may respond to ${diffs.join(" and ")}`, detail: "Two blocks differ in many ways (phase, fatigue, life); treat this as a lead to test in the next cycle." }));
  }
  // Peaking: a meet ahead.
  const meet = b.rec.preps.filter((p) => p.event_date && p.event_date >= b.rec.today).sort((a, z) => String(a.event_date).localeCompare(String(z.event_date)))[0];
  if (meet?.event_date) {
    const weeksOut = Math.round((Date.parse(meet.event_date) - Date.parse(b.rec.today)) / (7 * 86_400_000));
    out.push(f({ id: "pl:meet", area: "next", kind: "fact", subject: "peaking", title: `Meet in ${weeksOut} week${weeksOut === 1 ? "" : "s"}: ${meet.event_name ?? meet.title ?? "meet"} (${meet.event_date})`, detail: [meet.federation, meet.weight_class ? `${meet.weight_class} class` : null].filter(Boolean).join(" · ") || "From the meet prep on file." }));
    const singles = sum(b.lifts.map((l) => l.heavySingles));
    if (weeksOut <= 12 && singles === 0)
      out.push(f({ id: "pl:meet:singles", area: "next", kind: "hypothesis", subject: "peaking", title: "No heavy singles (≥85% of best e1RM) logged on the competition lifts", detail: "With a meet this close, single practice and attempt rehearsal are usually part of the peak." }));
  }
  // Current estimated strength, for programming the next cycle.
  const lines = b.lifts.filter((l) => l.compTrend.last != null).map((l) => `${LIFT_NAME[l.lift]}: e1RM ${kg(l.compTrend.last)} (peak ${kg(l.compTrend.peak)})${l.maxOnFileKg ? ` · max on file ${kg(l.maxOnFileKg)}` : ""}${l.bestMeetKg ? ` · best meet ${kg(l.bestMeetKg)}` : ""}`);
  if (lines.length) out.push(f({ id: "pl:current-strength", area: "next", kind: "fact", subject: "strength", title: "Estimated strength at the end of this period", detail: "Latest competition-lift e1RM (best of the last two exposures), from logged load × reps @ RPE.", evidence: lines }));
  return out;
}

export function bodybuildingFindings(b: BrainInput): Finding[] {
  const out: Finding[] = [];
  const { unit } = b;
  const kg = (n: number | null) => (n == null ? "?" : fmtLoad(n, unit));
  const trainedWeeks = b.weeks.filter((w) => w.completedDays + w.partialDays > 0).length;
  for (const m of b.muscles) {
    if (m.avgHardSetsPerWeek == null || trainedWeeks < 2) continue;
    const ev = [`${m.muscle}: ${m.avgHardSetsPerWeek} hard sets/week over ${trainedWeeks} trained weeks`, ...(m.frequencyPerWeek != null ? [`hit ${m.frequencyPerWeek}×/week (2+ hard sets)`] : []), `exercises: ${m.exercises.slice(0, 5).join(", ") || "—"}`];
    if (m.target && m.status !== "within") {
      out.push(f({ id: `bb:${m.muscle}:target`, area: "change", kind: "fact", subject: m.muscle, title: `${m.muscle} ${m.status === "below" ? "below" : "above"} its target: ${m.avgHardSetsPerWeek} sets/week (target ${m.target.mev ?? "?"}–${m.target.mrv ?? "?"})`, detail: "Against the volume targets set in this client's analytics settings.", evidence: ev }));
    } else if (!m.target && m.avgHardSetsPerWeek < 6) {
      out.push(f({ id: `bb:${m.muscle}:low`, area: "next", kind: "fact", subject: m.muscle, title: `${m.muscle}: ${m.avgHardSetsPerWeek} hard sets/week`, detail: "Low weekly volume for this muscle.", evidence: ev }));
      out.push(f({ id: `bb:${m.muscle}:low:why`, area: "next", kind: "hypothesis", subject: m.muscle, title: `${m.muscle} may need more direct work if it's a priority`, detail: "Many lifters grow best around 10–20 hard sets per muscle per week; below ~6 is usually maintenance. Raise it only if it matters for their goals." }));
    } else if (!m.target && m.avgHardSetsPerWeek > 22) {
      out.push(f({ id: `bb:${m.muscle}:high`, area: "next", kind: "hypothesis", subject: m.muscle, title: `${m.muscle}: ${m.avgHardSetsPerWeek} hard sets/week may exceed what they recover from`, detail: "Watch performance on its main exercises and soreness; trim if they stall.", evidence: ev }));
    }
    if (m.firstHalfAvg != null && m.secondHalfAvg != null && m.firstHalfAvg > 0 && Math.abs(m.secondHalfAvg - m.firstHalfAvg) / m.firstHalfAvg >= 0.3 && Math.abs(m.secondHalfAvg - m.firstHalfAvg) >= 2)
      out.push(f({ id: `bb:${m.muscle}:trend`, area: "next", kind: "fact", subject: m.muscle, title: `${m.muscle} volume ${m.secondHalfAvg > m.firstHalfAvg ? "rose" : "fell"}: ${m.firstHalfAvg} → ${m.secondHalfAvg} hard sets/week (first vs second half)`, detail: "Hard sets counted primary 1.0, secondary 0.5." }));
  }
  for (const e of b.exercises.filter((x) => x.exposures >= 3).slice(0, 25)) {
    const t = e.trend;
    if (t.changePct != null && t.changePct >= 5) {
      out.push(f({ id: `bb:ex:${e.key}:improved`, area: "improved", kind: "fact", subject: e.name, title: `${e.name}: e1RM ${kg(t.first)} → ${kg(t.last)} (${pctTxt(t.changePct)})`, detail: `${e.exposures} exposures; best set ${fmtSet(e.bestSet, unit)}.`, evidence: t.points.slice(-3).map((p) => `${p.date}: e1RM ${kg(p.value)}`) }));
    } else if (e.stalled) {
      out.push(f({ id: `bb:ex:${e.key}:stalled`, area: "stalled", kind: "fact", subject: e.name, title: `${e.name}: no new best in the last 3 exposures (best e1RM ${kg(t.peak)})`, detail: `${e.exposures} exposures, avg RPE ${e.avgRpe ?? "not logged"}.`, evidence: t.points.slice(-4).map((p) => `${p.date}: e1RM ${kg(p.value)}`) }));
      out.push(f({ id: `bb:ex:${e.key}:stalled:why`, area: "next", kind: "hypothesis", subject: e.name, title: `${e.name} may need a new stimulus`, detail: e.avgRpe != null && e.avgRpe < 7.5 ? "Sets averaged under RPE 7.5: taking them closer to failure may restart progress." : "Rotating to a similar variation or a different rep range for a block may restart progress." }));
    } else if (e.repsTrend && e.repsTrend.last != null && e.repsTrend.first != null && e.repsTrend.last - e.repsTrend.first >= 2) {
      out.push(f({ id: `bb:ex:${e.key}:reps`, area: "improved", kind: "fact", subject: e.name, title: `${e.name}: best reps ${e.repsTrend.first} → ${e.repsTrend.last}`, detail: `${e.exposures} exposures (no external load).` }));
    }
  }
  // Proximity to failure.
  const working = b.weeks.reduce((n, w) => n + w.workingSetsLogged, 0);
  const rpes = b.weeks.map((w) => w.avgRpe).filter((n): n is number => n != null);
  const avgRpe = rpes.length ? round(mean(rpes) as number, 1) : null;
  if (avgRpe != null && working >= 20) {
    if (avgRpe < 7)
      out.push(f({ id: "bb:proximity", area: "change", kind: "fact", subject: "effort", title: `Working sets averaged RPE ${avgRpe}`, detail: "Most sets stopped 3+ reps short of failure.", evidence: b.weeks.filter((w) => w.avgRpe != null).slice(-4).map((w) => `${w.label}: avg RPE ${w.avgRpe}`) }),
        f({ id: "bb:proximity:why", area: "next", kind: "hypothesis", subject: "effort", title: "Taking hypertrophy work closer to failure (RPE 8–9) may drive more growth", detail: "Especially on isolation and machine exercises where it is safe." }));
    else out.push(f({ id: "bb:proximity:ok", area: "next", kind: "fact", subject: "effort", title: `Working sets averaged RPE ${avgRpe}`, detail: "Close enough to failure for hypertrophy on average." }));
  }
  const goal = [b.rec.goals?.main_goal, b.rec.goals?.goal_target].filter(Boolean).join(" · ");
  if (goal) out.push(f({ id: "bb:goal", area: "next", kind: "fact", subject: "goals", title: `Stated goal: ${goal}`, detail: "From Goals & Setup: physique priorities should steer where volume goes." }));
  out.push(f({ id: "missing:physique", area: "missing", kind: "missing", subject: "data", title: "No physique measurements or progress photos analyzed", detail: "Muscle growth is read from training performance only." }));
  return out;
}

export function generalFindings(b: BrainInput): Finding[] {
  const out: Finding[] = [];
  const trainedWeeks = b.weeks.filter((w) => w.completedDays + w.partialDays > 0);
  if (trainedWeeks.length) {
    const perWeek = round(sum(trainedWeeks.map((w) => w.completedDays + w.partialDays)) / trainedWeeks.length, 1);
    out.push(f({ id: "gf:frequency", area: "next", kind: "fact", subject: "consistency", title: `${perWeek} workouts per trained week on average`, detail: `Across ${trainedWeeks.length} weeks with training.` }));
  }
  const group = (names: string[]) => sum(b.muscles.filter((m) => names.includes(m.muscle)).map((m) => m.avgHardSetsPerWeek ?? 0));
  const push = group(["Chest", "Shoulders", "Triceps"]);
  const pull = group(["Back", "Lats", "Biceps"]);
  if (push > 0 && pull > 0) {
    const ratio = round(push / pull, 2);
    if (ratio > 1.5 || ratio < 0.67)
      out.push(f({ id: "gf:push-pull", area: "next", kind: "fact", subject: "balance", title: `Push vs pull volume ${ratio}:1 (${round(push, 1)} vs ${round(pull, 1)} hard sets/week)`, detail: "Chest, shoulders, triceps against back, lats, biceps." }),
        f({ id: "gf:push-pull:why", area: "next", kind: "hypothesis", subject: "balance", title: `More ${ratio > 1 ? "pulling" : "pushing"} may balance the program`, detail: "A large imbalance is often worth evening out for shoulder health and posture." }));
  }
  for (const e of b.exercises.filter((x) => x.exposures >= 3).slice(0, 12)) {
    if (e.trend.changePct != null && e.trend.changePct >= 5)
      out.push(f({ id: `gf:ex:${e.key}:improved`, area: "improved", kind: "fact", subject: e.name, title: `${e.name} improved ${pctTxt(e.trend.changePct)} (e1RM)`, detail: `${e.exposures} exposures.` }));
    else if (e.stalled) out.push(f({ id: `gf:ex:${e.key}:stalled`, area: "stalled", kind: "fact", subject: e.name, title: `${e.name}: no new best in the last 3 exposures`, detail: `${e.exposures} exposures.` }));
  }
  return out;
}

/** Earlier programming decisions the coach approved, and what happened in the block that carried them out. */
export function decisionOutcomes(b: BrainInput): Finding[] {
  const out: Finding[] = [];
  const decisions = b.rec.observations.filter((o) => o.kind === "decision" && (o.status === "approved" || o.status === "corrected") && o.block_id);
  for (const d of decisions) {
    const bl = b.blocks.find((x) => x.blockId === d.block_id);
    if (!bl) continue;
    const lifts = LIFTS.filter((l) => bl.liftChange[l].changePct != null).map((l) => `${LIFT_NAME[l]} ${pctTxt(bl.liftChange[l].changePct as number)}`);
    out.push(f({ id: `decision:${d.id}`, area: "next", kind: "fact", subject: "previous decision", title: `Earlier decision: "${d.corrected_statement ?? d.statement}" → Block ${bl.number}`, detail: `In that block: adherence ${bl.sessionAdherencePct ?? "?"}% of sessions, ${bl.avgHardSetsPerWeek ?? "?"} hard sets/week, avg RPE ${bl.avgRpe ?? "?"}${lifts.length ? `; ${lifts.join(", ")} e1RM` : ""}. Whether the decision caused these results is a hypothesis.`, evidence: [`Decision recorded ${d.created_at.slice(0, 10)}`] }));
  }
  return out;
}

export function brainFindings(brain: Brain, b: BrainInput): Finding[] {
  const parts: Finding[][] = [commonFindings(b)];
  if (STRENGTH_BRAINS.includes(brain)) parts.push(powerliftingFindings(b).filter((x) => brain === "powerlifting" || brain === "powerbuilding" || !x.id.startsWith("pl:meet")));
  if (HYPERTROPHY_BRAINS.includes(brain)) parts.push(bodybuildingFindings(b));
  if (brain === "general_strength") parts.push(generalFindings(b).filter((x) => !x.id.startsWith("gf:ex:")));
  if (brain === "general_fitness" || brain === "hybrid" || brain === "other") parts.push(generalFindings(b), bodybuildingFindings(b).filter((x) => x.area !== "missing" && !x.id.startsWith("bb:goal")));
  parts.push(decisionOutcomes(b));
  const seen = new Set<string>();
  return parts.flat().filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
}

export { BRAIN_SUMMARY } from "./methods";
