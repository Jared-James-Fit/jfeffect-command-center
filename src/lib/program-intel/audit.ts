/**
 * Stage 6, the program quality audit (deterministic): every generated draft
 * is checked before the coach sees it, and the results are a scorecard of
 * plain statuses (Passed / Needs review / Failed validation / Not checked)
 * with the reason for each, never a made-up score. A check that couldn't run
 * says so, and a draft with one isn't called fully validated. Failures the
 * model can fix are listed per block for a targeted repair.
 */
import { repRange, rpeRange, sum } from "./core";
import { missingEquipment, stationOf, type EquipmentResolution } from "./equipment";
import { lowValueReason } from "./exercise-standard";
import type { BuiltBlock, BuiltExercise, BuiltProgram, Strategy } from "./generator-schemas";
import { rxForWeek } from "./program-view";
import type { Baseline, GenerationSetup } from "./recommend";
import { estimateDay, type TimedExercise } from "./session-time";
import { musclesOf } from "./core";
import type { AthleteContext } from "./context";
import type { DataQuality } from "./quality";
import { LIFTS, STRENGTH_BRAINS, HYPERTROPHY_BRAINS, type Lift, type RawExercise } from "./types";

export type CheckStatus = "passed" | "review" | "failed" | "skipped";
export type Criterion =
  | "completeness"
  | "goal"
  | "individualization"
  | "evidence"
  | "frequency"
  | "volume"
  | "fatigue"
  | "specificity"
  | "selection"
  | "progression"
  | "practicality"
  | "equipment"
  | "adherence"
  | "data"
  | "instructions";
export const CRITERIA: Array<[Criterion, string]> = [
  ["completeness", "Program completeness"],
  ["goal", "Goal alignment"],
  ["individualization", "Individualization"],
  ["evidence", "Historical evidence usage"],
  ["frequency", "Training frequency"],
  ["volume", "Volume and intensity coherence"],
  ["fatigue", "Fatigue management"],
  ["specificity", "Exercise specificity"],
  ["selection", "Exercise selection"],
  ["progression", "Progression structure"],
  ["practicality", "Session practicality"],
  ["equipment", "Equipment compatibility"],
  ["adherence", "Adherence feasibility"],
  ["data", "Data completeness"],
  ["instructions", "Coach instruction compliance"],
];

export type AuditFinding = { criterion: Criterion; status: Exclude<CheckStatus, "passed">; text: string; block?: number; repairable?: boolean };
export type ScoreRow = { criterion: Criterion; label: string; status: CheckStatus; reasons: string[] };
export type AuditResult = {
  scorecard: ScoreRow[];
  overall: "passed" | "review" | "failed";
  findings: AuditFinding[];
  repairs: Record<number, string[]>;
  sessions: Array<{ block: number; week: number; day: number; title: string; minutes: number; stationChanges: number }>;
  weekly: Array<{ block: number; week: number; sets: number; lifts: Record<Lift, { sets: number; days: number }>; muscles: Record<string, { sets: number; days: number }> }>;
};

export type AuditInput = {
  program: BuiltProgram;
  setup: GenerationSetup;
  strategy: Strategy;
  baseline: Baseline;
  equipment: Pick<EquipmentResolution, "items" | "confidence" | "home" | "cableStations">;
  ctx: Pick<AthleteContext, "schedule" | "session" | "previous" | "today">;
  quality: Pick<DataQuality, "confidence"> | null;
  meta: Map<string, RawExercise>;
  unmatched: string[];
  /** the athlete's own exercise ids (from their history) */
  athleteExerciseIds: Set<string>;
  brief: string;
};

const LIFT_RE: Record<Lift, RegExp> = { squat: /squat/i, bench: /bench/i, deadlift: /deadlift/i };
const WEEKDAY = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function liftOfBuilt(e: BuiltExercise, m: RawExercise | undefined): Lift | null {
  const role = String(e.role ?? "");
  if (/\bgpp\b|accessory/i.test(role)) return null;
  for (const l of LIFTS) if (LIFT_RE[l].test(role)) return l;
  for (const v of [m?.competition_lift_type, m?.movement_family]) {
    const s = String(v ?? "").toLowerCase();
    if ((LIFTS as string[]).includes(s)) return s as Lift;
  }
  return null;
}
const isPrimary = (e: BuiltExercise, i: number) => i === 0 || /primary/i.test(e.role ?? "");
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Numbers and week labels an evidence line cites that the brief doesn't contain (an invented claim). */
export function unsupportedTokens(text: string, brief: string): string[] {
  const out: string[] = [];
  for (const m of text.match(/B\d+·W\d+/g) ?? []) if (!brief.includes(m)) out.push(m);
  const nums = brief.match(/\d+(?:\.\d+)?/g) ?? [];
  const known = new Set(nums);
  for (const m of text.match(/\d+(?:\.\d+)?/g) ?? []) {
    if (m.length < 2 && !m.includes(".")) continue; // single digits (sets, weeks) are too generic to check
    const alt = m.includes(".") ? String(Number(m)) : m;
    if (!known.has(m) && !known.has(alt)) out.push(m);
  }
  return [...new Set(out)];
}

/** Most reps possible at a % of 1RM (Epley inverted). */
export function maxRepsAt(pct: number): number {
  return pct >= 100 ? 1 : 30 * (100 / pct - 1);
}

export function auditProgram(x: AuditInput): AuditResult {
  const f: AuditFinding[] = [];
  const add = (criterion: Criterion, status: AuditFinding["status"], text: string, block?: number, repairable = false) => f.push({ criterion, status, text, block, repairable });
  const { program, setup, strategy, baseline, meta } = x;
  const brain = setup.brain;
  const allEx = program.blocks.flatMap((b, bi) => b.days.flatMap((d, di) => d.exercises.map((e, ei) => ({ b, bi, d, di, e, ei }))));
  const calibration = baseline.calibration ?? 1;

  // 1. Completeness: every week, every day, every prescription.
  const totalWeeks = sum(program.blocks.map((b) => b.weeks));
  if (totalWeeks !== setup.weeks) add("completeness", "failed", `The program has ${totalWeeks} weeks; the setup asks for ${setup.weeks}.`, undefined, false);
  program.blocks.forEach((b, bi) => {
    const sb = strategy.structure.blocks[bi];
    if (sb && sb.weeks !== b.weeks) add("completeness", "failed", `Block ${bi + 1} has ${b.weeks} weeks; the strategy gives it ${sb.weeks}.`, bi, true);
    if (b.days.length !== setup.daysPerWeek) add("completeness", "failed", `Block ${bi + 1} has ${b.days.length} training days a week; the setup asks for ${setup.daysPerWeek}.`, bi, true);
    for (const w of b.week_phases ?? []) if (w.week > b.weeks) add("completeness", "review", `Block ${bi + 1} names a phase for week ${w.week}, past its ${b.weeks} weeks.`, bi);
    b.days.forEach((d, di) => {
      for (const e of d.exercises) for (const w of e.weeks ?? []) if (w.week > b.weeks) add("completeness", "review", `${e.exercise_name} (block ${bi + 1}, ${d.title}) has a change for week ${w.week}, past the block's ${b.weeks} weeks.`, bi);
      if (!d.exercises.length) add("completeness", "failed", `Block ${bi + 1} day ${di + 1} has no exercises.`, bi, true);
    });
  });
  if (strategy.structure.blocks.length !== program.blocks.length) add("completeness", "failed", `The strategy has ${strategy.structure.blocks.length} blocks; ${program.blocks.length} were built.`);
  for (const { e, bi, d } of allEx) {
    const noIntensity = !e.rpe && !e.rir && e.percentage == null && !/amrap|max/i.test(e.reps) && !(e.weeks ?? []).some((w) => w.rpe || w.rir || w.percentage != null);
    if (noIntensity) add("completeness", "review", `${e.exercise_name} (block ${bi + 1}, ${d.title}) has no effort target (RPE, RIR or %).`, bi, true);
  }

  // Per-week measures.
  const weekly: AuditResult["weekly"] = [];
  const sessions: AuditResult["sessions"] = [];
  const adjustable = x.equipment.items.includes("adjustable_dumbbells");
  program.blocks.forEach((b, bi) => {
    for (let w = 1; w <= b.weeks; w++) {
      const lifts = Object.fromEntries(LIFTS.map((l) => [l, { sets: 0, days: 0 }])) as Record<Lift, { sets: number; days: number }>;
      const muscles: Record<string, { sets: number; days: number }> = {};
      let total = 0;
      b.days.forEach((d, di) => {
        const dayLift = new Set<Lift>();
        const dayMuscle = new Map<string, number>();
        const timed: TimedExercise[] = [];
        for (const e of d.exercises) {
          const rx = rxForWeek(e, w);
          const m = e.exercise_id ? meta.get(e.exercise_id) : undefined;
          total += rx.sets;
          const l = liftOfBuilt(e, m);
          if (l) {
            lifts[l].sets += rx.sets;
            dayLift.add(l);
          }
          const hard = !rx.rpe || (rpeRange(rx.rpe)?.[1] ?? 10) >= 6;
          if (hard) for (const mu of musclesOf(m)) dayMuscle.set(mu.group, (dayMuscle.get(mu.group) ?? 0) + mu.weight * rx.sets);
          timed.push({ name: e.exercise_name, equipment: m?.equipment ?? null, sets: rx.sets, reps: rx.reps, restSeconds: e.rest_seconds ?? null });
        }
        for (const l of dayLift) lifts[l].days++;
        for (const [mu, n] of dayMuscle) {
          muscles[mu] = muscles[mu] ?? { sets: 0, days: 0 };
          muscles[mu].sets = Math.round((muscles[mu].sets + n) * 10) / 10;
          if (n >= 2) muscles[mu].days++;
        }
        const est = estimateDay(timed, { adjustableDumbbells: adjustable, calibration });
        sessions.push({ block: bi, week: w, day: di, title: d.title, minutes: est.minutes, stationChanges: est.stationChanges });
      });
      weekly.push({ block: bi, week: w, sets: total, lifts, muscles });
    }
  });
  const w1 = weekly[0];
  const targetIn = (wk: AuditResult["weekly"][number] | undefined, target: string): { sets: number; days: number } | null => {
    const t = norm(target);
    for (const l of LIFTS) if (t.includes(l)) return wk ? wk.lifts[l] : null;
    if (!wk) return null;
    const key = Object.keys(wk.muscles).find((m) => norm(m) === t || norm(m).includes(t) || t.includes(norm(m)));
    return key ? wk.muscles[key] : { sets: 0, days: 0 };
  };
  const findTarget = (target: string) => targetIn(w1, target);

  // 2. Goal alignment: priorities get at least the dose they had (or the strategy's target).
  const prios = [...new Set([...setup.priorities, ...strategy.prioritize.map((p) => p.item)])].slice(0, 8);
  for (const p of setup.priorities) {
    const got = findTarget(p);
    if (!got) continue;
    const vt = strategy.volume_targets.find((v) => norm(v.target) === norm(p));
    const base = LIFTS.find((l) => norm(p).includes(l)) ? baseline.liftSets[LIFTS.find((l) => norm(p).includes(l)) as Lift] : baseline.muscleSets.find((m) => norm(m.muscle) === norm(p))?.sets ?? null;
    const want = vt?.sets_per_week ?? base;
    if (want != null && got.sets + 0.5 < want * 0.9) add("goal", "review", `Priority ${p}: ${got.sets} sets in week 1, below ${vt ? "the strategy's target" : "the last program's"} ${want}.`);
  }
  if (!prios.length) add("goal", "review", "No priorities set or found: goal alignment is checked only against the structure.");
  if (STRENGTH_BRAINS.includes(brain) && w1) for (const l of LIFTS) if (!w1.lifts[l].sets && brain === "powerlifting") add("goal", "failed", `No ${l} in week 1 of a powerlifting program.`, 0, true);

  // 3. Individualization: what it kept from this athlete's own history.
  const programIds = new Set(allEx.map((a) => a.e.exercise_id).filter(Boolean) as string[]);
  if (x.athleteExerciseIds.size) {
    const own = [...programIds].filter((id) => x.athleteExerciseIds.has(id)).length;
    const keep = strategy.exercise_plan.retain.filter((r) => r.exercise_id || r.name);
    const kept = keep.filter((r) => allEx.some((a) => (r.exercise_id && a.e.exercise_id === r.exercise_id) || norm(a.e.exercise_name) === norm(r.name))).length;
    if (keep.length && kept < keep.length) add("individualization", "review", `${keep.length - kept} exercise${keep.length - kept === 1 ? "" : "s"} the strategy said to keep ${keep.length - kept === 1 ? "isn't" : "aren't"} in the program: ${keep.filter((r) => !allEx.some((a) => (r.exercise_id && a.e.exercise_id === r.exercise_id) || norm(a.e.exercise_name) === norm(r.name))).map((r) => r.name).join(", ")}.`);
    if (programIds.size && own / programIds.size < 0.3 && strategy.exercise_plan.replace.length < 3) add("individualization", "review", `Only ${own} of ${programIds.size} exercises come from the athlete's own history, with no strategy reason to change that many.`);
  } else add("individualization", "skipped", "No previous training to individualize from: built from goals, schedule and equipment.");
  if (strategy.decisions.filter((d) => d.evidence.length).length < 2 && x.athleteExerciseIds.size) add("individualization", "review", "Fewer than two decisions cite the athlete's records.");

  // 4. Evidence: every number a decision or change cites must be in the brief.
  const claims = [...strategy.decisions.flatMap((d) => d.evidence), ...strategy.keep.flatMap((k) => k.evidence), ...strategy.change.flatMap((k) => k.evidence), ...strategy.prioritize.flatMap((k) => k.evidence)];
  const bad = claims.map((c) => ({ c, t: unsupportedTokens(c, x.brief) })).filter((y) => y.t.length);
  if (bad.length) add("evidence", "review", `${bad.length} cited evidence line${bad.length === 1 ? "" : "s"} contain numbers or weeks not in the records: ${bad.slice(0, 4).map((y) => `"${y.c.slice(0, 80)}" (${y.t.join(", ")})`).join("; ")}. Treat ${bad.length === 1 ? "it" : "them"} as unverified.`);
  if (!claims.length && x.athleteExerciseIds.size) add("evidence", "review", "The strategy cites no evidence from the records.");
  const factsWithoutEvidence = strategy.decisions.filter((d) => d.basis === "fact" && !d.evidence.length);
  if (factsWithoutEvidence.length) add("evidence", "review", `${factsWithoutEvidence.length} decision${factsWithoutEvidence.length === 1 ? " is" : "s are"} marked as fact without evidence; read ${factsWithoutEvidence.length === 1 ? "it" : "them"} as hypotheses.`);

  // 5. Frequency against the strategy (its own commitment): a target is a minimum. A block that trains
  // something a whole session less often goes back for repair; more often is only worth a look when
  // it's two or more sessions over (fatigue is checked on its own below).
  program.blocks.forEach((b, bi) => {
    const wk = weekly.find((w) => w.block === bi && w.week === 1);
    for (const t of strategy.frequency_targets) {
      const got = targetIn(wk, t.target);
      if (!got || t.per_week > setup.daysPerWeek) continue;
      if (t.per_week - got.days >= 1) add("frequency", "failed", `${t.target}: ${got.days}×/week in block ${bi + 1}; the strategy targets ${t.per_week}×.`, bi, true);
      else if (got.days - t.per_week >= 2) add("frequency", "review", `${t.target}: ${got.days}×/week in block ${bi + 1}, well over the strategy's ${t.per_week}×.`, bi);
    }
  });
  for (const t of setup.frequency.filter((q) => q.perWeek > setup.daysPerWeek)) add("frequency", "review", `${t.target} target ${t.perWeek}× is more than the ${setup.daysPerWeek} training days.`);

  // 6. Volume and intensity: targets, jumps, and % vs reps.
  for (const t of strategy.volume_targets) {
    const got = findTarget(t.target);
    if (!got || !t.sets_per_week) continue;
    if (Math.abs(got.sets - t.sets_per_week) / t.sets_per_week > 0.25 && Math.abs(got.sets - t.sets_per_week) >= 3) add("volume", "review", `${t.target}: ${got.sets} sets in week 1 vs the strategy's ${t.sets_per_week}.`);
  }
  for (let i = 1; i < weekly.length; i++) {
    const a = weekly[i - 1];
    const b = weekly[i];
    const phase = program.blocks[b.block].week_phases?.find((p) => p.week === b.week)?.phase ?? "";
    if (a.sets && b.sets > a.sets * 1.3 && !/deload|taper|test/i.test(program.blocks[a.block].week_phases?.find((p) => p.week === a.week)?.phase ?? "") && !/accum|volume|overreach/i.test(phase))
      add("volume", "review", `Weekly sets jump ${a.sets} → ${b.sets} (block ${b.block + 1} week ${b.week}) without a phase that explains it.`, b.block);
  }
  if (baseline.weeklySets && w1 && w1.sets > baseline.weeklySets * 1.35 && !strategy.change.some((c) => /volume|sets/i.test(c.item)))
    add("volume", "review", `Week 1 has ${w1.sets} sets vs ${baseline.weeklySets} a week in the last program (+${Math.round((w1.sets / baseline.weeklySets - 1) * 100)}%) and the strategy doesn't call for more volume.`);
  for (const { e, bi, d } of allEx) {
    for (const w of Array.from({ length: program.blocks[bi].weeks }, (_, i) => i + 1)) {
      const rx = rxForWeek(e, w);
      if (rx.percentage == null) continue;
      const rr = repRange(rx.reps);
      if (!rr) continue;
      const cap = maxRepsAt(rx.percentage);
      const rir = rx.rpe ? 10 - (rpeRange(rx.rpe)?.[1] ?? 10) : rx.rir ? Number(rx.rir) || 0 : 0;
      if (rr[0] > cap + 0.5) { add("volume", "failed", `${e.exercise_name} (block ${bi + 1}, ${d.title}, week ${w}): ${rx.reps} reps at ${rx.percentage}% isn't possible (about ${Math.floor(cap)} reps max).`, bi, true); break; }
      if (rr[0] + rir > cap + 1.5) { add("volume", "review", `${e.exercise_name} (block ${bi + 1}, week ${w}): ${rx.reps} reps at ${rx.percentage}%${rx.rpe ? ` @RPE ${rx.rpe}` : ""} is very hard to hit (about ${Math.floor(cap)} reps max at that load).`, bi); break; }
    }
  }

  // 7. Fatigue management.
  const programWeeks = weekly.length;
  if (programWeeks >= 5) {
    const maxSets = Math.max(...weekly.map((w) => w.sets));
    const lighter = weekly.some((w, i) => i > 0 && (w.sets <= maxSets * 0.8 || /deload|taper|light|reset/i.test(program.blocks[w.block].week_phases?.find((p) => p.week === w.week)?.phase ?? "")));
    if (!lighter && !program.blocks.some((b) => b.deload_rule)) add("fatigue", "review", `${programWeeks} weeks with no lighter week or deload rule.`);
  }
  if (brain === "powerlifting" || brain === "powerbuilding") {
    const order = setup.trainingDays.map((d) => WEEKDAY.indexOf(d.toLowerCase())).filter((n) => n >= 0);
    if (order.length === setup.daysPerWeek) {
      const b0 = program.blocks[0];
      b0?.days.forEach((d, di) => {
        const next = b0.days[di + 1];
        if (!next) return;
        const heavy = (day: typeof d, l: Lift) => day.exercises.some((e, i) => isPrimary(e, i) && liftOfBuilt(e, e.exercise_id ? meta.get(e.exercise_id) : undefined) === l);
        const gap = (order[di + 1] - order[di] + 7) % 7;
        if (gap === 1 && ((heavy(d, "squat") && heavy(next, "deadlift")) || (heavy(d, "deadlift") && heavy(next, "squat"))))
          add("fatigue", "review", `Heavy squat and heavy deadlift on back-to-back days (${setup.trainingDays[di]} / ${setup.trainingDays[di + 1]}).`, 0);
      });
    } else add("fatigue", "skipped", "Training weekdays aren't set, so back-to-back heavy days can't be checked.");
  }
  const allSets = allEx.flatMap(({ e, b }) => Array.from({ length: b.weeks }, (_, i) => rxForWeek(e, i + 1)));
  const veryHard = allSets.filter((r) => (rpeRange(r.rpe)?.[1] ?? 0) >= 9.5).length;
  if (allSets.length && veryHard / allSets.length > 0.3) add("fatigue", "review", `${Math.round((veryHard / allSets.length) * 100)}% of exercises are prescribed at RPE 9.5+.`);
  for (const w of weekly) for (const [m, v] of Object.entries(w.muscles)) if (v.sets > 25) { add("fatigue", "review", `${m}: ${v.sets} hard sets in block ${w.block + 1} week ${w.week}.`, w.block); break; }

  // 8. Specificity.
  if (brain === "powerlifting") {
    for (const l of LIFTS) {
      const missing = weekly.filter((w, i) => !w.lifts[l].sets && i < weekly.length - 1);
      if (missing.length >= 2) add("specificity", "failed", `${l} is missing in ${missing.length} weeks of a powerlifting program.`, missing[0].block, true);
    }
    if (setup.meetDate) {
      const last = weekly.slice(-3);
      const singles = program.blocks.flatMap((b, bi) => b.days.flatMap((d) => d.exercises.filter((e) => liftOfBuilt(e, e.exercise_id ? meta.get(e.exercise_id) : undefined)).flatMap((e) => Array.from({ length: b.weeks }, (_, i) => ({ bi, w: i + 1, rx: rxForWeek(e, i + 1) })))));
      const hasSingles = singles.some((s) => last.some((l) => l.block === s.bi && l.week === s.w) && (repRange(s.rx.reps)?.[0] ?? 9) <= 2);
      if (!hasSingles) add("specificity", "review", "A meet is on the calendar but the last 3 weeks have no singles or doubles on the competition lifts.");
    }
  }
  if (HYPERTROPHY_BRAINS.includes(brain)) for (const p of setup.priorities) {
    const got = findTarget(p);
    if (got && !LIFTS.some((l) => norm(p).includes(l)) && got.days < 2) add("specificity", "review", `Priority ${p} is trained ${got.days}×/week; twice a week is usually the minimum for a priority muscle.`);
  }

  // 9. Exercise selection.
  if (x.unmatched.length) {
    const byBlock = unmatchedByBlock(program.blocks, x.unmatched);
    const entries = Object.entries(byBlock);
    if (entries.length) for (const [bi, names] of entries) add("selection", "failed", `Not found in the library (block ${Number(bi) + 1}): ${names.join(", ")}.`, Number(bi), true);
    else add("selection", "failed", `${x.unmatched.length} exercise${x.unmatched.length === 1 ? "" : "s"} not found in the library: ${x.unmatched.join(", ")}.`, undefined, true);
  }
  for (const r of setup.excluded) {
    const hit = allEx.find((a) => (r.id && a.e.exercise_id === r.id) || norm(a.e.exercise_name) === norm(r.name));
    if (hit) add("selection", "failed", `Excluded exercise ${r.name} is in block ${hit.bi + 1} (${hit.d.title}).`, hit.bi, true);
  }
  for (const r of setup.required) if (!allEx.some((a) => (r.id && a.e.exercise_id === r.id) || norm(a.e.exercise_name) === norm(r.name))) add("selection", "failed", `Required exercise ${r.name} isn't in the program.`, 0, true);
  // the exercise standard: nothing too heavy to start, too coarse to progress, or a gimmick (a coach's required pick stays)
  const isRequired = (e: BuiltExercise) => setup.required.some((r) => (r.id && e.exercise_id === r.id) || norm(e.exercise_name) === norm(r.name));
  for (const { e, bi, d } of allEx) {
    const why = isRequired(e) ? null : lowValueReason(e.exercise_name);
    if (why) add("selection", "failed", `${e.exercise_name} (block ${bi + 1}, ${d.title}) is below the exercise standard: ${why}.`, bi, true);
  }
  for (const { d, bi } of allEx.filter((a) => a.ei === 0)) {
    const seen = new Set<string>();
    for (const e of d.exercises) {
      const k = `${e.exercise_id ?? norm(e.exercise_name)}|${norm(e.role ?? "")}`;
      if (seen.has(k)) add("selection", "review", `${e.exercise_name} appears twice with the same role on ${d.title} (block ${bi + 1}).`, bi);
      seen.add(k);
    }
  }
  for (const r of strategy.exercise_plan.replace) {
    // the replacement the strategy named is not a leftover (a model sometimes puts the new exercise's id on the old one)
    const isReplacement = (name: string) => !!r.with && norm(name) === norm(r.with);
    const hit = allEx.find((a) => !isReplacement(a.e.exercise_name) && ((r.exercise_id && a.e.exercise_id === r.exercise_id) || norm(a.e.exercise_name) === norm(r.name)));
    // the strategy's own decision, so it goes back for repair like a missed target
    if (hit) add("selection", "failed", `The strategy says to replace ${r.name}${r.with ? ` with ${r.with}` : ""}, but it's still in block ${hit.bi + 1} (${hit.d.title}).`, hit.bi, true);
  }
  if (setup.restrictions.length) add("selection", "skipped", `Restrictions can't be checked automatically against exercise choice: check ${setup.restrictions.slice(0, 3).join("; ")}.`);

  // 10. Progression structure.
  program.blocks.forEach((b, bi) => {
    if (b.weeks < 2) return;
    b.days.forEach((d) => d.exercises.forEach((e, ei) => {
      if (!isPrimary(e, ei)) return;
      const changes = (e.weeks ?? []).length;
      if (!e.progression && !changes && !(b.progression_rules ?? []).length) add("progression", "review", `${e.exercise_name} (block ${bi + 1}, ${d.title}) has no progression rule or weekly change.`, bi, true);
      const pcts = Array.from({ length: b.weeks }, (_, i) => rxForWeek(e, i + 1).percentage);
      if (b.weeks >= 4 && pcts.every((p) => p != null)) {
        const diffs = pcts.slice(1).map((p, i) => Math.round(((p as number) - (pcts[i] as number)) * 10) / 10);
        if (diffs.every((dd) => dd > 0 && dd === diffs[0])) add("progression", "review", `${e.exercise_name} (block ${bi + 1}): +${diffs[0]}% every week for ${b.weeks} weeks with no deload, a linear add that may not fit the model.`, bi);
      }
    }));
  });

  // 11. Session practicality.
  const max = setup.maxSessionMinutes ?? null;
  const target = setup.sessionMinutes ?? null;
  // the cardio plan's training-day session follows every workout, so it counts toward the maximum
  const cardioAfter = setup.cardio?.trainingDay?.minutes ?? 0;
  const long = sessions.filter((s) => max != null && s.minutes + cardioAfter > max + 5);
  const firstWeeks = sessions.filter((s) => s.week === 1);
  for (const s of long.filter((q, i, arr) => arr.findIndex((y) => y.block === q.block && y.day === q.day) === i).slice(0, 6)) add("practicality", "failed", `${s.title} (block ${s.block + 1}) runs about ${s.minutes} min${cardioAfter ? ` + ${cardioAfter} min cardio` : ""}, over the ${max}-min maximum.`, s.block, true);
  if (!long.length && target != null) for (const s of firstWeeks.filter((q) => q.minutes > target + 10)) add("practicality", "review", `${s.title} (block ${s.block + 1}) runs about ${s.minutes} min vs the ${target}-min target.`, s.block);
  for (const { b, bi } of program.blocks.map((b, bi) => ({ b, bi }))) for (const d of b.days) if (d.exercises.length > 10) add("practicality", "review", `${d.title} (block ${bi + 1}) has ${d.exercises.length} exercises.`, bi);
  if (x.equipment.home) for (const s of firstWeeks.filter((q) => q.stationChanges > 4)) add("practicality", "review", `${s.title} (block ${s.block + 1}) moves between stations ${s.stationChanges} times.`, s.block, true);
  if (x.equipment.cableStations === 1) for (const { b, bi } of program.blocks.map((b, bi) => ({ b, bi }))) for (const d of b.days) {
    const groups = new Map<string, BuiltExercise[]>();
    for (const e of d.exercises) if (e.superset) { const k = e.superset.replace(/\d+$/, ""); groups.set(k, [...(groups.get(k) ?? []), e]); }
    for (const g of groups.values()) if (g.filter((e) => stationOf({ name: e.exercise_name, equipment: e.exercise_id ? meta.get(e.exercise_id)?.equipment : null }) === "cable").length >= 2) add("practicality", "failed", `${d.title} (block ${bi + 1}) supersets two cable exercises on one cable column: ${g.map((e) => e.exercise_name).join(" + ")}.`, bi, true);
  }

  // 12. Equipment.
  if (x.equipment.confidence === "unknown") add("equipment", "skipped", "No equipment on file: nothing could be ruled out. Confirm their equipment.");
  else {
    const seen = new Set<string>();
    for (const { e, bi } of allEx) {
      const k = e.exercise_id ?? norm(e.exercise_name);
      if (seen.has(k)) continue;
      seen.add(k);
      const miss = missingEquipment({ name: e.exercise_name, equipment: e.exercise_id ? meta.get(e.exercise_id)?.equipment : null }, x.equipment);
      if (miss.length) add("equipment", x.equipment.confidence === "stated" ? "review" : "failed", `${e.exercise_name} needs ${miss.map((g) => g.join(" or ").replace(/_/g, " ")).join(" and ")}, not in their equipment.`, bi, x.equipment.confidence !== "stated");
    }
  }

  // 13. Adherence feasibility.
  const sch = x.ctx.schedule;
  if (sch.availableWeekdays.length && setup.daysPerWeek > sch.availableWeekdays.length) add("adherence", "review", `${setup.daysPerWeek} days a week vs ${sch.availableWeekdays.length} available days in Goals & Setup (${sch.availableWeekdays.join(", ")}); update their availability if it's out of date.`);
  const p80 = x.ctx.session.observedP80;
  const avgMin = firstWeeks.length ? Math.round(sum(firstWeeks.map((s) => s.minutes)) / firstWeeks.length) : null;
  if (p80 != null && avgMin != null && avgMin > p80 + 15) add("adherence", "review", `Sessions average about ${avgMin} min; their sessions have usually taken up to ${p80} min.`);
  const prevProg = x.ctx.previous;
  if (prevProg && (prevProg.sessionAdherencePct ?? 100) < 75 && setup.daysPerWeek >= (prevProg.plannedDaysPerWeek ?? 0)) add("adherence", "review", `They trained ${prevProg.sessionAdherencePct}% of workouts at ${prevProg.plannedDaysPerWeek} days; this asks for ${setup.daysPerWeek}.`);

  // 14. Data completeness (what the program was built on).
  for (const c of x.quality?.confidence ?? []) if (c.level === "none" || c.level === "low") if (["Effort and proximity to failure", "Strength and load progression", "Recovery, fatigue and pain"].includes(c.topic)) add("data", "review", `${c.topic}: ${c.level === "none" ? "no data" : "low confidence"}. ${c.why}`);
  if (!x.quality) add("data", "review", "No training logged: the program rests on goals and defaults.");

  // 15. Coach instructions.
  for (const r of strategy.coach_requirements.filter((c) => c.status === "conflict")) add("instructions", "review", `Requirement in conflict: ${r.requirement}. ${r.how}`);
  const free = [setup.coachNotes && "coach notes", setup.preferences && "exercise preferences", setup.newCircumstances && "new circumstances", setup.recovery && "recovery constraints"].filter(Boolean);
  if (free.length) add("instructions", "skipped", `Your ${free.join(", ")} can't be verified automatically: check the draft against them.`);
  for (const c of strategy.conflicts) add("instructions", "review", `Conflict the strategy raised: ${c.description}${c.resolution ? ` (${c.resolution})` : ""}`);

  // The scorecard.
  const order: Record<CheckStatus, number> = { passed: 0, skipped: 1, review: 2, failed: 3 };
  const scorecard: ScoreRow[] = CRITERIA.map(([criterion, label]) => {
    const mine = f.filter((y) => y.criterion === criterion);
    const status = mine.reduce<CheckStatus>((s, y) => (order[y.status] > order[s] ? y.status : s), "passed");
    return { criterion, label, status, reasons: mine.map((y) => y.text) };
  });
  const overall = scorecard.some((r) => r.status === "failed") ? "failed" : scorecard.some((r) => r.status === "review" || r.status === "skipped") ? "review" : "passed";
  const repairs: Record<number, string[]> = {};
  for (const y of f.filter((q) => q.status === "failed" && q.repairable)) {
    const bis = y.block != null ? [y.block] : program.blocks.map((_, i) => i);
    for (const bi of bis) repairs[bi] = [...(repairs[bi] ?? []), y.text];
  }
  return { scorecard, overall, findings: f, repairs, sessions, weekly };
}

/** Which unmatched names live in a block (to point a repair at it). */
export function unmatchedByBlock(blocks: BuiltBlock[], unmatched: string[]): Record<number, string[]> {
  const out: Record<number, string[]> = {};
  const set = new Set(unmatched.map((u) => u.toLowerCase()));
  blocks.forEach((b, bi) => {
    const names = b.days.flatMap((d) => d.exercises.filter((e) => !e.exercise_id && set.has(e.exercise_name.trim().toLowerCase())).map((e) => e.exercise_name));
    if (names.length) out[bi] = [...new Set(names)];
  });
  return out;
}
