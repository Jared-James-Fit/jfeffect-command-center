/**
 * Data quality, before anything is programmed from the records: what each
 * count means, how much of each metric was actually logged, where the records
 * disagree with themselves, and how much confidence each kind of conclusion
 * can carry. The generator reads this: a conclusion that rests on missing
 * data is lowered or replaced by one that rests on data that exists.
 */
import { round, toNum } from "./core";
import type { IntelRecords, IntelReport } from "./types";

export type QualityDefinition = { key: string; label: string; value: number; definition: string };
export type CoverageLine = { key: string; label: string; pct: number | null; detail: string; status: "good" | "partial" | "missing" | "n/a" };
export type QualityIssue = { key: string; severity: "info" | "warning"; title: string; detail: string; evidence: string[] };
export type ConfidenceRead = { topic: string; level: "high" | "medium" | "low" | "none"; why: string; instead?: string };
export type DataQuality = {
  definitions: QualityDefinition[];
  coverage: CoverageLine[];
  issues: QualityIssue[];
  confidence: ConfidenceRead[];
  missing: string[];
  tracking: string[];
  summary: string;
};

const pctOf = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : null);
const status = (p: number | null, good = 80, some = 30): CoverageLine["status"] => (p == null ? "n/a" : p >= good ? "good" : p >= some ? "partial" : "missing");

export function dataQuality(report: IntelReport, rec: IntelRecords): DataQuality {
  const c = report.coverage;
  const rows = report.days.flatMap((d) => d.rows.map((r) => ({ d, r })));
  const doneSets = rows.flatMap((x) => x.r.actual.filter((s) => s.done));
  const trainedDays = report.days.filter((d) => d.status === "completed" || d.status === "partial");

  const definitions: QualityDefinition[] = [
    { key: "prescribed", label: "Prescribed sets", value: c.prescribedSetsDue, definition: "Sets the program asked for on workouts that were due (past or done); upcoming workouts aren't counted." },
    { key: "completed", label: "Completed sets", value: c.completedSets, definition: "Sets logged with reps (or a time) and not flagged as a warm-up, counted per exercise up to the number prescribed. Effort doesn't decide it: an RPE 5 set the athlete did is completed." },
    { key: "records", label: "Logged set records", value: c.loggedSets, definition: "Every set record saved in the logger, including warm-ups and records without reps." },
    { key: "skipped", label: "Skipped sets", value: c.skippedSets, definition: "Prescribed sets of exercises with nothing logged on a due workout." },
    { key: "incomplete", label: "Incomplete sets", value: c.incompleteSets, definition: "Prescribed sets missing from exercises that were started but cut short." },
    { key: "extra", label: "Extra sets", value: c.extraSets, definition: "Sets logged beyond what an exercise prescribed (not counted toward completion)." },
    { key: "modified", label: "Modified sets", value: c.modifiedSets, definition: "Completed sets with reps outside the prescribed range (below it, or more than 2 above it)." },
    { key: "not_counted", label: "Records not counted as sets", value: c.nonCountedRecords, definition: "Logged records flagged as warm-ups, or saved without reps or a time." },
    { key: "working", label: "Working sets (volume)", value: c.workingSets, definition: `Completed sets at or above RPE ${rec.settings.workingRpeMin} (or with no effort logged): the sets counted as training volume and used for strength estimates.` },
  ];

  // How much of each metric exists.
  const withLoadNeeded = doneSets.filter((s) => s.loadType === "external");
  const loadPct = pctOf(withLoadNeeded.filter((s) => s.kg != null && s.kg > 0).length, withLoadNeeded.length);
  const rpePct = c.setsWithRpePct;
  const rirOnly = doneSets.filter((s) => s.rir != null && s.rpe != null).length;
  const durations = trainedDays.filter((d) => d.durationMin != null).length;
  const feedback = trainedDays.filter((d) => d.feedback).length;
  const sleep = trainedDays.filter((d) => d.feedback?.sleep_bucket).length;
  const scopeFrom = report.coverage.firstDate;
  const bwInPeriod = rec.bodyweight.filter((b) => !scopeFrom || b.date >= scopeFrom).length;
  const coverage: CoverageLine[] = [
    { key: "rpe", label: "RPE / RIR", pct: rpePct, detail: `${c.setsWithRpe} of ${doneSets.length} completed sets have an RPE or RIR${rirOnly ? "" : ""}`, status: status(rpePct) },
    { key: "load", label: "Loads", pct: loadPct, detail: `${withLoadNeeded.filter((s) => s.kg != null && s.kg > 0).length} of ${withLoadNeeded.length} loaded sets have a weight`, status: status(loadPct, 90, 50) },
    { key: "velocity", label: "Bar velocity", pct: pctOf(c.setsWithVelocity, doneSets.length), detail: c.setsWithVelocity ? `${c.setsWithVelocity} sets with a velocity` : "Not logged", status: c.setsWithVelocity ? status(pctOf(c.setsWithVelocity, doneSets.length)) : "missing" },
    { key: "duration", label: "Session duration", pct: pctOf(durations, trainedDays.length), detail: `${durations} of ${trainedDays.length} trained workouts have a duration`, status: status(pctOf(durations, trainedDays.length), 70, 30) },
    { key: "checkouts", label: "Post-workout check-outs", pct: pctOf(feedback, trainedDays.length), detail: `${feedback} of ${trainedDays.length} trained workouts (fatigue, session RPE, pain)`, status: status(pctOf(feedback, trainedDays.length), 60, 25) },
    { key: "sleep", label: "Sleep", pct: pctOf(sleep, trainedDays.length), detail: sleep ? `${sleep} check-outs report sleep` : "Not reported", status: status(pctOf(sleep, trainedDays.length), 60, 25) },
    { key: "bodyweight", label: "Bodyweight", pct: null, detail: `${bwInPeriod} weigh-ins in this period (${rec.bodyweight.length} in all)`, status: bwInPeriod >= 4 ? "good" : bwInPeriod >= 1 ? "partial" : "missing" },
    { key: "checkins", label: "Check-ins / forms", pct: null, detail: `${(rec.checkins ?? []).length} submitted in and around this period`, status: (rec.checkins ?? []).length ? "good" : "missing" },
    { key: "maxes", label: "Maxes on file", pct: null, detail: `${rec.maxes.length} on file`, status: rec.maxes.length ? "good" : "missing" },
  ];

  // Where the records disagree with themselves.
  const issues: QualityIssue[] = [];
  const finishedEmpty = report.days.filter((d) => d.status === "completed" && !d.rows.some((r) => r.setsDone > 0));
  if (finishedEmpty.length)
    issues.push({ key: "finished-empty", severity: "warning", title: `${finishedEmpty.length} workout${finishedEmpty.length === 1 ? "" : "s"} marked finished with no sets logged`, detail: "Counted as trained for attendance, but nothing about performance can be read from them.", evidence: finishedEmpty.slice(0, 6).map((d) => `${d.title} · ${d.date ?? "no date"}`) });
  const partial = report.days.filter((d) => d.status === "partial");
  if (partial.length)
    issues.push({ key: "not-finished", severity: "info", title: `${partial.length} workout${partial.length === 1 ? "" : "s"} logged but not marked finished`, detail: "Counted as trained (sets were logged); its set count shows whether it was complete.", evidence: partial.slice(0, 6).map((d) => `${d.title} · ${d.date ?? "no date"} · ${d.rows.reduce((n, r) => n + r.setsDone, 0)} sets logged`) });
  const extraRows = rows.filter((x) => x.r.prescribed.sets != null && x.r.setsDone > (x.r.prescribed.sets as number));
  if (extraRows.length)
    issues.push({ key: "extra-sets", severity: "info", title: `${c.extraSets} set${c.extraSets === 1 ? "" : "s"} logged beyond the prescription`, detail: "Not counted toward completion; included in volume.", evidence: extraRows.slice(0, 6).map((x) => `${x.r.exercise} · ${x.d.date ?? "?"}: ${x.r.setsDone} of ${x.r.prescribed.sets}`) });
  const lowEffort = doneSets.filter((s) => s.rpe != null && s.rpe < rec.settings.workingRpeMin);
  if (lowEffort.length)
    issues.push({ key: "low-effort", severity: "info", title: `${lowEffort.length} completed set${lowEffort.length === 1 ? "" : "s"} logged below RPE ${rec.settings.workingRpeMin}`, detail: "They count as completed sets, but not as working volume or for strength estimates.", evidence: rows.flatMap((x) => x.r.actual.filter((s) => s.done && s.rpe != null && s.rpe < rec.settings.workingRpeMin).map((s) => `${x.r.exercise} · ${x.d.date ?? "?"} · set ${s.setIndex} @${s.rpe}`)).slice(0, 6) });
  const dupes: string[] = [];
  for (const { d, r } of rows) {
    const seen = new Set<number>();
    for (const s of r.actual) {
      if (seen.has(s.setIndex)) dupes.push(`${r.exercise} · ${d.date ?? "?"} · set ${s.setIndex}`);
      seen.add(s.setIndex);
    }
  }
  if (dupes.length) issues.push({ key: "duplicate-sets", severity: "warning", title: `${dupes.length} duplicate set number${dupes.length === 1 ? "" : "s"}`, detail: "Two records for the same set of one exercise; both are counted as logged records.", evidence: dupes.slice(0, 6) });
  const noLoad = rows.flatMap((x) => x.r.actual.filter((s) => s.done && s.loadType === "external" && (s.kg == null || s.kg <= 0)).map(() => `${x.r.exercise} · ${x.d.date ?? "?"}`));
  if (noLoad.length) issues.push({ key: "no-load", severity: noLoad.length > doneSets.length * 0.2 ? "warning" : "info", title: `${noLoad.length} loaded set${noLoad.length === 1 ? "" : "s"} without a weight`, detail: "Strength estimates skip them.", evidence: [...new Set(noLoad)].slice(0, 6) });
  const badRpe = rec.results.filter((r) => {
    const raw = toNum(r.actual_rpe_num) ?? toNum(r.actual_rpe);
    return raw != null && (raw < 1 || raw > 10);
  }).length;
  if (badRpe) issues.push({ key: "bad-rpe", severity: "info", title: `${badRpe} RPE value${badRpe === 1 ? "" : "s"} outside 1–10 ignored`, detail: "Probably typed in the wrong box.", evidence: [] });
  const oddDur = trainedDays.filter((d) => d.durationMin != null && (d.durationMin < 10 || d.durationMin > 240));
  if (oddDur.length) issues.push({ key: "odd-duration", severity: "info", title: `${oddDur.length} session duration${oddDur.length === 1 ? "" : "s"} look implausible`, detail: "Left out of session-length estimates (under 10 or over 240 minutes; usually a timer left running).", evidence: oddDur.slice(0, 6).map((d) => `${d.title} · ${d.date ?? "?"}: ${d.durationMin} min`) });
  if (c.unmappedRows) issues.push({ key: "unmapped", severity: "warning", title: `${c.unmappedRows} prescribed exercise${c.unmappedRows === 1 ? "" : "s"} not linked to the exercise library`, detail: "Their muscles and lift aren't known, so they're missing from muscle volume and lift analysis.", evidence: [...new Set(rows.filter((x) => !x.r.exerciseId).map((x) => x.r.exercise))].slice(0, 6) });
  const changes = midBlockChanges(report);
  if (changes.length) issues.push({ key: "mid-block-changes", severity: "info", title: `${changes.length} exercise change${changes.length === 1 ? "" : "s"} during a block`, detail: "The same workout slot held a different exercise than the week before: a swap by the athlete or an edit by the coach.", evidence: changes.slice(0, 8) });

  // How far each kind of conclusion can be trusted.
  const confidence: ConfidenceRead[] = [];
  const rp = rpePct ?? 0;
  confidence.push(
    rp >= 70
      ? { topic: "Effort and proximity to failure", level: "high", why: `RPE or RIR on ${rp}% of completed sets.` }
      : rp >= 30
        ? { topic: "Effort and proximity to failure", level: "medium", why: `RPE or RIR on only ${rp}% of completed sets; effort reads rest on those.`, instead: "Back effort reads with rep performance at a given load and whether reps stayed in the prescribed range." }
        : { topic: "Effort and proximity to failure", level: rp > 0 ? "low" : "none", why: `RPE or RIR on ${rp}% of completed sets: effort can't be measured.`, instead: "Don't infer effort or fatigue from load alone. Use reps achieved at a given load, whether reps stayed in range, and load progression; prescribe with RPE so the next cycle has it." },
  );
  const liftsWithTrend = report.lifts.filter((l) => l.exposures.filter((e) => e.e1rm != null).length >= 3).length;
  const exWithTrend = report.exercises.filter((e) => e.trend.points.length >= 3).length;
  confidence.push(
    exWithTrend >= 3 && (loadPct ?? 0) >= 80
      ? { topic: "Strength and load progression", level: "high", why: `${exWithTrend} exercises have 3+ exposures with load and reps${liftsWithTrend ? ` (${liftsWithTrend} competition-pattern lifts)` : ""}.` }
      : exWithTrend >= 1
        ? { topic: "Strength and load progression", level: "medium", why: `Only ${exWithTrend} exercise${exWithTrend === 1 ? " has" : "s have"} 3+ loaded exposures.` }
        : { topic: "Strength and load progression", level: "low", why: "Too few loaded exposures to read a trend." },
  );
  const dueDated = report.days.filter((d) => d.status !== "unscheduled").length;
  confidence.push(dueDated ? { topic: "Adherence", level: c.unscheduledDays > dueDated * 0.3 ? "medium" : "high", why: `${c.dueDays} workouts due, ${c.completedDays + c.partialDays} trained; ${c.unscheduledDays} undated not counted.` } : { topic: "Adherence", level: "none", why: "No dated workouts." });
  const fbPct = pctOf(feedback, trainedDays.length) ?? 0;
  confidence.push(
    fbPct >= 60
      ? { topic: "Recovery, fatigue and pain", level: "medium", why: `Check-outs on ${fbPct}% of trained workouts (self-reported).` }
      : { topic: "Recovery, fatigue and pain", level: fbPct > 0 ? "low" : "none", why: `Check-outs on ${fbPct}% of trained workouts: no pain report doesn't mean no pain.`, instead: "Read recovery from performance across the week (reps and loads holding up), missed or shortened sessions and any notes; don't assume good recovery." },
  );
  confidence.push(bwInPeriod >= 4 ? { topic: "Bodyweight trend", level: "high", why: `${bwInPeriod} weigh-ins in this period.` } : { topic: "Bodyweight trend", level: bwInPeriod ? "low" : "none", why: `${bwInPeriod} weigh-ins in this period.` });
  confidence.push(c.setsWithVelocity ? { topic: "Bar velocity", level: "medium", why: `${c.setsWithVelocity} sets with velocity.` } : { topic: "Bar velocity", level: "none", why: "No velocity logged: not used." });
  confidence.push(durations >= 4 ? { topic: "Session length", level: "high", why: `${durations} sessions have a duration.` } : { topic: "Session length", level: durations ? "low" : "none", why: `${durations} sessions have a duration: time per session is estimated from the prescription.` });

  const missing: string[] = [];
  for (const line of coverage) if (line.status === "missing") missing.push(`${line.label}: ${line.detail}`);
  if (!rec.goals) missing.push("Goals & Setup not on file (schedule, session length, experience, equipment, injuries)");
  if (rec.unreadable.length) missing.push(`Couldn't read: ${rec.unreadable.join(", ")}`);
  if (c.completedDays + c.partialDays < 3) missing.push(`Only ${c.completedDays + c.partialDays} trained workouts: too little to judge the response; the program will lean on goals and conservative defaults.`);

  const tracking: string[] = [];
  if (rp < 50) tracking.push("Prescribe RPE or RIR on working sets and ask the athlete to log it: it's what lets the next review read effort and fatigue.");
  if (fbPct < 30) tracking.push("Encourage the post-workout check-out (fatigue, sleep, pain): recovery can't be read without it.");
  if (bwInPeriod < 4 && (report.brain === "powerlifting" || report.brain === "bodybuilding" || report.brain === "powerbuilding")) tracking.push("Weigh-ins 3–4× a week would show the bodyweight trend.");
  if (durations < 4) tracking.push("Finishing workouts in the app records session length, used to keep sessions within their time.");

  const warnCount = issues.filter((i) => i.severity === "warning").length;
  const summary = `${c.completedSets} of ${c.prescribedSetsDue} prescribed sets completed${c.prescribedSetsDue ? ` (${round((c.completedSets / c.prescribedSetsDue) * 100, 0)}%)` : ""} · RPE on ${rp}% · ${warnCount} warning${warnCount === 1 ? "" : "s"}, ${issues.length - warnCount} note${issues.length - warnCount === 1 ? "" : "s"}`;
  return { definitions, coverage, issues, confidence, missing, tracking, summary };
}

/** Exercises that changed in a workout from one week to the next inside a block (a swap by the athlete or a coach's edit). */
export function midBlockChanges(report: IntelReport): string[] {
  const out: string[] = [];
  const byBlockDay = new Map<string, typeof report.days>();
  for (const d of report.days) {
    const k = `${d.weekKey.split(":")[0]}|${d.dayIndex}`;
    byBlockDay.set(k, [...(byBlockDay.get(k) ?? []), d]);
  }
  for (const days of byBlockDay.values()) {
    days.sort((a, b) => Number(a.weekKey.split(":")[1]) - Number(b.weekKey.split(":")[1]));
    for (let i = 1; i < days.length; i++) {
      const prev = new Map(days[i - 1].rows.map((r) => [r.exerciseId ?? r.exercise.toLowerCase(), r.exercise]));
      const cur = new Map(days[i].rows.map((r) => [r.exerciseId ?? r.exercise.toLowerCase(), r.exercise]));
      const removed = [...prev.entries()].filter(([k]) => !cur.has(k)).map(([, n]) => n);
      const added = [...cur.entries()].filter(([k]) => !prev.has(k)).map(([, n]) => n);
      if (!removed.length && !added.length) continue;
      const w = report.weeks.find((x) => x.key === days[i].weekKey);
      out.push(`${w?.label ?? days[i].weekKey} ${days[i].title}: ${removed.length ? `${removed.join(", ")} → ` : "added "}${added.join(", ") || "removed"}`);
    }
  }
  return out;
}
