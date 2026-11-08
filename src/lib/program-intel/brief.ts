/**
 * The athlete brief the AI stages read: everything the deterministic stages
 * found, in plain text, with its parts and sizes listed so the coach can see
 * exactly what the model received. The previous program goes in set by set;
 * earlier programs go in set by set too unless that would exceed the input
 * budget, in which case they're summarized per exercise AND the brief, the
 * job's context and the inspector all say so (never silently cut).
 */
import { cardioBriefLines } from "./cardio";
import { fmtLoad, fmtSet } from "./core";
import type { AthleteContext } from "./context";
import { EQUIPMENT_LABEL } from "./equipment";
import { trainingLogMarkdown } from "./export";
import type { GeneratorIntel } from "./intelligence";
import { REVIEW_SECTIONS } from "./review";
import type { Conflict, GenerationSetup, Redistribution, SetupField } from "./recommend";
import { BRAIN_LABEL, LIFTS, type IntelReport } from "./types";

export const BRIEF_VERSION = 2;
/** Characters the strategy stage may send (≈ 4 characters a token). Gemini-class models take far more; this keeps answers focused. */
export const BRIEF_BUDGET_CHARS = 600_000;

export type BriefSection = { key: string; title: string; chars: number; detail: "full" | "summary"; note?: string };
export type Brief = { text: string; sections: BriefSection[]; warnings: string[]; chars: number; estTokens: number };

const kg = (n: number | null | undefined, u: "kg" | "lb") => (n == null ? "—" : fmtLoad(n, u));
const list = (xs: string[], empty = "none on file") => (xs.length ? xs.map((x) => `- ${x}`).join("\n") : `- ${empty}`);

function athleteSection(ctx: AthleteContext): string {
  const u = ctx.unit;
  const p = ctx.profile;
  const e = ctx.equipment;
  const lines: string[] = [];
  lines.push(`Name: ${ctx.name} · today ${ctx.today} · loads in ${u}`);
  lines.push(`Profile: ${[p.age != null ? `${p.age} y` : "age not on file", p.sex ?? "sex not on file", p.heightCm ? `${p.heightCm} cm` : "height not on file", p.bodyweightKg != null ? `bodyweight ${kg(p.bodyweightKg, u)} (${p.bodyweightDate})${p.bodyweightChange4wKg != null ? `, ${p.bodyweightChange4wKg > 0 ? "+" : ""}${u === "lb" ? Math.round(p.bodyweightChange4wKg * 2.2046) : p.bodyweightChange4wKg}${u} over ~4 weeks` : ""}` : "no bodyweight on file", p.weightClass ? `weight class ${p.weightClass}` : null, p.experience ? `experience: ${p.experience}${p.level ? ` (${p.level})` : ""}` : "experience not on file", p.trainingSince ? `training with the coach since ${p.trainingSince}` : null, p.isPowerlifter ? "marked as a powerlifter" : null].filter(Boolean).join(" · ")}`);
  lines.push(`Goals (${ctx.goals.onFile ? `Goals & Setup${ctx.goals.updatedAt ? `, updated ${ctx.goals.updatedAt.slice(0, 10)}` : ""}` : "no Goals & Setup on file"}): ${[ctx.goals.main, ctx.goals.other, ctx.goals.target && `target: ${ctx.goals.target}`, ctx.goals.styles.length && `styles: ${ctx.goals.styles.join(", ")}`, ctx.goals.clientGoals && `client file: ${ctx.goals.clientGoals}`, ctx.goals.bodyweightGoal && `bodyweight goal: ${ctx.goals.bodyweightGoal}`].filter(Boolean).join(" · ") || "none"}`);
  if (ctx.goals.notes) lines.push(`Anything else they told you at setup: "${ctx.goals.notes}"`);
  const m = ctx.competition.next;
  lines.push(`Competition: ${m ? `${m.name} on ${m.date} (${m.weeksOut} weeks out)${m.federation ? `, ${m.federation}` : ""}${m.weightClass ? `, ${m.weightClass} class` : ""}` : "no upcoming meet on file"}${ctx.competition.history.length ? ` · results: ${ctx.competition.history.map((h) => `${h.date ?? "?"} ${h.name ?? ""} ${h.squat ?? "?"}/${h.bench ?? "?"}/${h.deadlift ?? "?"}=${h.total ?? "?"}kg @${h.bodyweight ?? "?"}kg`).join("; ")}` : ""}`);
  lines.push(`Schedule: committed ${ctx.schedule.committedDays.join(", ") || "—"}${ctx.schedule.committedFrequency ? ` (${ctx.schedule.committedFrequency}/week)` : ""}${ctx.schedule.updatedAt ? `, set ${ctx.schedule.updatedAt.slice(0, 10)}` : ""} · Goals & Setup ${ctx.schedule.goalsDaysPerWeek ?? "—"} days/week · available ${ctx.schedule.availableWeekdays.join(", ") || "—"} · actually trained on ${ctx.schedule.observedWeekdays.join(", ") || "—"}${ctx.schedule.preferredTime ? ` · prefers ${ctx.schedule.preferredTime}` : ""}${ctx.schedule.notes ? ` · notes: ${ctx.schedule.notes}` : ""}`);
  lines.push(`Session length: Goals & Setup ${ctx.session.goalsMinutes ?? "—"} min · logged sessions median ${ctx.session.observedMedian ?? "—"} min, 80th percentile ${ctx.session.observedP80 ?? "—"} min (${ctx.session.entries} with a duration)${ctx.session.ptMinutes ? ` · trains in booked ${ctx.session.ptMinutes}-min PT sessions with the coach (${ctx.session.ptBooked} booked 8 weeks back to 4 ahead): the warm-up, the lifting and the cardio after it all fit inside that hour` : ""}`);
  lines.push(`Training environment: ${e.location ?? "not on file"} · equipment (${e.confidence}${e.source === "program" ? ": proven by the exercises trained in the last program" : e.source === "coach" ? ": confirmed by the coach" : e.source === "goals" ? ": from Goals & Setup" : ""}): ${e.items.map((i) => EQUIPMENT_LABEL[i]).join(", ") || "unknown (nothing ruled out)"}`);
  if (e.constraints.length) lines.push(`Equipment rules:\n${list(e.constraints)}`);
  if (e.conflicts.length) lines.push(`Equipment conflicts in the records:\n${list(e.conflicts)}`);
  lines.push(`Injuries / restrictions: ${ctx.injuries.stated.join(" · ") || "none stated"}`);
  if (ctx.injuries.painReports.length) lines.push(`Pain reported after workouts:\n${list(ctx.injuries.painReports.map((x) => `${x.date ?? "?"}: ${x.area ?? "?"} level ${x.level ?? "?"}${x.note ? ` "${x.note}"` : ""}`))}`);
  lines.push(`Recovery (check-outs on ${ctx.recovery.checkouts} trained workouts): session RPE ${ctx.recovery.sessionRpeAvg ?? "—"}, rating ${ctx.recovery.ratingAvg ?? "—"}, fatigue ${JSON.stringify(ctx.recovery.fatigue)}, sleep ${JSON.stringify(ctx.recovery.sleep)}`);
  return lines.join("\n");
}

const FIELD_LABEL: Partial<Record<SetupField, string>> = {
  brain: "Framework",
  mainGoal: "Main goal",
  secondaryGoals: "Secondary goals",
  daysPerWeek: "Days per week",
  trainingDays: "Training days",
  weeks: "Weeks",
  sessionMinutes: "Target session minutes",
  maxSessionMinutes: "Maximum session minutes",
  blocks: "Blocks",
  priorities: "Priorities",
  equipment: "Equipment",
  restrictions: "Restrictions",
  retain: "Exercises to keep",
  replace: "Exercises to reconsider",
  meetDate: "Meet date",
  frequency: "Frequency targets",
  volume: "Weekly volume targets",
  intensity: "Intensity distribution",
  effort: "Effort targets",
  progression: "Progression method",
  specificity: "Competition specificity",
  required: "Required exercises",
  excluded: "Excluded exercises",
  recovery: "Recovery constraints",
  preferences: "Exercise preferences",
  coachNotes: "Coach's notes & ideas for this program",
  newCircumstances: "New circumstances",
};

export function setupText(s: GenerationSetup): string {
  const v = (k: SetupField): string => {
    const x = s[k] as unknown;
    if (k === "brain") return BRAIN_LABEL[s.brain];
    if (k === "blocks") return s.blocks.map((b) => `${b.name} (${b.weeks} wk): ${b.objective}`).join(" | ");
    if (k === "equipment") return `${s.equipment.location ?? "—"}: ${s.equipment.items.map((i) => EQUIPMENT_LABEL[i]).join(", ") || "unknown"}${s.equipment.cableStations ? ` · ${s.equipment.cableStations} cable column(s)` : ""}${s.equipment.notes ? ` · ${s.equipment.notes}` : ""} (${s.equipment.confidence})`;
    if (k === "frequency") return s.frequency.map((f) => `${f.target} ${f.perWeek}×/wk`).join(", ");
    if (k === "volume") return s.volume.map((f) => `${f.target} ${f.setsPerWeek} sets/wk`).join(", ");
    if (Array.isArray(x)) return x.map((y: any) => (typeof y === "string" ? y : y?.name ?? JSON.stringify(y))).join(", ");
    return x == null || x === "" ? "" : String(x);
  };
  return (Object.keys(FIELD_LABEL) as SetupField[]).map((k) => `- ${FIELD_LABEL[k]}: ${v(k) || "—"}`).join("\n");
}

function exerciseTable(r: IntelReport): string {
  const u = r.client.unit;
  return r.exercises
    .map((e) => `- ${e.name}${e.exerciseId ? ` [${e.exerciseId}]` : " (not in library)"}: ${e.exposures} exposures, ${e.workingSetsLogged} working sets, ${e.adherencePct ?? "—"}% of prescribed sets done${e.trend.first != null ? `, e1RM ${kg(e.trend.first, u)} → ${kg(e.trend.last, u)} (${e.trend.changePct ?? "—"}%)` : e.repsTrend ? `, best reps ${e.repsTrend.first} → ${e.repsTrend.last}` : ""}, best ${fmtSet(e.bestSet, u)}${e.avgRpe != null ? `, avg RPE ${e.avgRpe}` : ""}${e.stalled ? ", STALLED" : ""}, last ${e.lastDate ?? "—"}`)
    .join("\n");
}

/** Per exercise over some workouts: exposures, sets done, first → last best e1RM, best set (for summarizing earlier programs). */
export function exerciseSummaryFromDays(days: IntelReport["days"], u: "kg" | "lb"): string {
  const by = new Map<string, { name: string; exposures: number; sets: number; first: number | null; last: number | null; firstDate: string | null; lastDate: string | null; best: string }>();
  for (const d of days) for (const r of d.rows) {
    const done = r.actual.filter((s) => s.done);
    if (!done.length) continue;
    const k = r.exerciseId ?? r.exercise.toLowerCase();
    const cur = by.get(k) ?? { name: r.exercise, exposures: 0, sets: 0, first: null, last: null, firstDate: null, lastDate: null, best: "" };
    cur.exposures++;
    cur.sets += done.length;
    if (r.bestE1rm != null) {
      if (cur.first == null) cur.first = r.bestE1rm;
      cur.last = r.bestE1rm;
    }
    cur.firstDate = cur.firstDate ?? d.date;
    cur.lastDate = d.date ?? cur.lastDate;
    if (r.topSet) cur.best = fmtSet(r.topSet, u);
    by.set(k, cur);
  }
  return [...by.values()].map((x) => `- ${x.name}: ${x.exposures} exposures, ${x.sets} sets, ${x.firstDate ?? "?"} → ${x.lastDate ?? "?"}${x.first != null ? `, e1RM ${kg(x.first, u)} → ${kg(x.last, u)}` : ""}${x.best ? `, last top set ${x.best}` : ""}`).join("\n");
}

/** The latest working sets of each exercise: the load references the construction stage sets targets from. */
export function loadReferences(r: IntelReport | null): string {
  if (!r) return "- no previous program";
  const u = r.client.unit;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const d of [...r.days].reverse()) {
    for (const row of d.rows) {
      const k = row.exerciseId ?? row.exercise.toLowerCase();
      if (seen.has(k)) continue;
      const done = row.actual.filter((s) => s.done);
      if (!done.length) continue;
      seen.add(k);
      out.push(`- ${row.exercise}: last done ${d.date ?? "?"}: ${done.map((s) => fmtSet(s, u)).join(", ")} (prescribed ${row.prescribed.sets ?? "?"}×${row.prescribed.reps ?? "?"}${row.prescribed.rpe ? ` @${row.prescribed.rpe}` : ""})${row.bestE1rm ? ` · e1RM ${kg(row.bestE1rm, u)}` : ""}`);
    }
  }
  for (const L of r.lifts) if (L.maxOnFileKg) out.push(`- ${L.lift} max on file: ${kg(L.maxOnFileKg, u)}`);
  return out.join("\n") || "- nothing logged";
}

/** The previous program's first week as it was written: each day's exercises in order, prescription and coach's note (stations, setup). */
export function programLayout(r: IntelReport | null): string {
  if (!r || !r.weeks.length) return "- no previous program";
  const u = r.client.unit;
  const firstFull = r.weeks.find((w) => w.plannedDays === Math.max(...r.weeks.map((x) => x.plannedDays))) ?? r.weeks[0];
  return r.days
    .filter((d) => d.weekKey === firstFull.key)
    .map((d) => `Day ${d.dayIndex}: ${d.title}\n${d.rows.map((row) => `  - ${row.exercise}${row.role ? ` [${row.role}]` : ""}: ${row.prescribed.sets ?? "?"}×${row.prescribed.reps ?? "?"}${row.prescribed.rpe ? ` @${row.prescribed.rpe}` : ""}${row.prescribed.restSeconds ? `, rest ${row.prescribed.restSeconds}s` : ""}${row.prescribed.loadKg != null ? `, ${kg(row.prescribed.loadKg, u)}` : ""}${row.prescribed.notes ? ` · "${row.prescribed.notes}"` : ""}`).join("\n")}`)
    .join("\n");
}

/** The sections the construction stages skip: the set-by-set logs (the strategy already read them; load references and measured exercises stay). */
export const CONSTRUCT_EXCLUDE = ["log", "earlier"];

/** A first program: what's known from their setup, and what nothing logged yet means. */
export function firstProgramText(intel: GeneratorIntel): string {
  const { ctx } = intel;
  const known = [
    ctx.goals.main ? `goal "${ctx.goals.main}"${ctx.goals.target ? ` (${ctx.goals.target})` : ""}` : null,
    ctx.profile.experience ? `experience "${ctx.profile.experience}"${ctx.profile.level ? ` = ${ctx.profile.level}` : ""}` : null,
    ctx.schedule.committedDays.length ? `training days ${ctx.schedule.committedDays.join(", ")}` : ctx.schedule.goalsDaysPerWeek ? `${ctx.schedule.goalsDaysPerWeek} days a week` : null,
    ctx.session.ptMinutes ? `${ctx.session.ptMinutes}-min PT sessions` : ctx.session.goalsMinutes ? `${ctx.session.goalsMinutes}-min sessions` : null,
    ctx.equipment.items.length ? `equipment (${ctx.equipment.confidence})` : null,
    ctx.injuries.stated.length ? "injuries" : "no injuries stated",
    ctx.goals.notes ? "what else they said at setup" : null,
  ].filter(Boolean) as string[];
  const maxes = intel.history.lifts.filter((l) => l.maxOnFileKg != null).map((l) => `${l.lift} ${fmtLoad(l.maxOnFileKg as number, ctx.unit)}`);
  return [
    "FIRST PROGRAM: no training logged yet, so there's no previous program, no load history and no measured response.",
    `Built from their setup answers: ${known.join(", ") || "nothing (no Goals & Setup on file: defaults)"}${ctx.goals.onFile ? "" : ". No Goals & Setup on file"}.`,
    `Maxes on file: ${maxes.join(", ") || "none (no percentages; never write a starting weight)"}.`,
    "Not known yet: their working weights, how they recover, which exercises suit them, how consistent they'll be. The setup's frequency, weekly sets, rep ranges, effort and progression are evidence-based starting points for their level, fitted to their time; the next program corrects them from what they log.",
  ].join("\n");
}

export function buildBrief(intel: GeneratorIntel, x: { setup: GenerationSetup; edited: SetupField[]; conflicts: Conflict[]; redistribution: Redistribution | null; budgetChars?: number; outcomes?: string[]; exclude?: string[] }): Brief {
  const budget = x.budgetChars ?? BRIEF_BUDGET_CHARS;
  const { ctx, prev, history } = intel;
  const sections: Array<BriefSection & { text: string }> = [];
  const add = (key: string, title: string, text: string, detail: "full" | "summary" = "full", note?: string) => sections.push({ key, title, text, chars: text.length, detail, note });

  add("athlete", "Athlete", athleteSection(ctx));
  const rec = intel.recommendation.setup;
  const editedLines = x.edited.map((k) => `- ${FIELD_LABEL[k] ?? k}: the coach changed it${JSON.stringify(rec[k]) !== JSON.stringify(x.setup[k]) ? ` (recommended: ${String(JSON.stringify(rec[k])).slice(0, 200)})` : ""}`);
  add(
    "setup",
    intel.firstProgram ? "First program setup (approved by the coach)" : "Next program setup (approved by the coach)",
    [setupText(x.setup), editedLines.length ? `\nChanged by the coach (these are requirements; honor them and adapt everything else around them):\n${editedLines.join("\n")}` : "\nThe coach accepted the recommended setup.", x.redistribution ? `\nWorkload redistribution (days changed):\n${list(x.redistribution.lines)}` : ""].join("\n"),
  );
  add("cardio", "Cardio (the client's cardio plan, never workout rows)", cardioBriefLines(x.setup.cardio).join("\n") || "Not set: write no cardio into the workouts.");
  add(
    "requirements",
    "Coach requirements and conflicts",
    [
      `Required exercises: ${x.setup.required.map((r) => r.name).join(", ") || "none"}`,
      `Excluded exercises: ${x.setup.excluded.map((r) => r.name).join(", ") || "none"}`,
      `Restrictions: ${x.setup.restrictions.join(" · ") || "none"}`,
      `Recovery constraints: ${x.setup.recovery || "none"}`,
      `Exercise preferences: ${x.setup.preferences || "none"}`,
      `Coach's notes & ideas for this program (the head coach's direction: follow each one and say how in coach_requirements): ${x.setup.coachNotes || "none"}`,
      `New circumstances not yet in the records: ${x.setup.newCircumstances || "none"}`,
      `Conflicts found before generating:\n${list(x.conflicts.map((c) => `[${c.severity}] ${c.title}. ${c.detail}`), "none")}`,
    ].join("\n"),
  );
  const q = intel.quality;
  add(
    "quality",
    "Data quality and confidence",
    q
      ? [
          `How sets are counted:\n${list(q.definitions.map((d) => `${d.label}: ${d.value}. ${d.definition}`))}`,
          `Coverage:\n${list(q.coverage.map((c) => `${c.label}: ${c.pct != null ? `${c.pct}%` : ""} ${c.detail} [${c.status}]`))}`,
          `Confidence by conclusion:\n${list(q.confidence.map((c) => `${c.topic}: ${c.level.toUpperCase()}. ${c.why}${c.instead ? ` Instead: ${c.instead}` : ""}`))}`,
          `Consistency issues:\n${list(q.issues.map((i) => `[${i.severity}] ${i.title}. ${i.detail}${i.evidence.length ? ` (${i.evidence.slice(0, 4).join("; ")})` : ""}`), "none")}`,
          `Missing:\n${list(q.missing, "nothing major")}`,
        ].join("\n")
      : firstProgramText(intel),
  );
  if (intel.review && ctx.previous) {
    const p = ctx.previous;
    const parts = [`Program: ${p.label} · ${p.start ?? "?"} → ${p.end ?? "?"} · ${p.weeks} weeks · ${p.plannedDaysPerWeek ?? "?"} days/week planned, ${p.trainedDaysPerWeek ?? "?"} trained · ${p.trained}/${p.due} workouts · ${p.setAdherencePct ?? "—"}% of prescribed sets`, `What it was designed to do:\n${list(p.intent, "no stated intent on file")}`];
    for (const [k, title] of REVIEW_SECTIONS) {
      const items = intel.review[k];
      if (!items.length) continue;
      parts.push(`${title}:\n${list(items.map((i) => `[${i.kind.toUpperCase()}] ${i.title}${i.detail ? `. ${i.detail}` : ""}${i.evidence.length ? ` (evidence: ${i.evidence.slice(0, 4).join("; ")})` : ""}`))}`);
    }
    parts.push(`Exercises in the previous program (measured):\n${prev ? exerciseTable(prev) : "—"}`);
    parts.push(`Load references (latest sets of each exercise):\n${loadReferences(prev)}`);
    parts.push(`How it was laid out (its first full week, as written):\n${programLayout(prev)}`);
    if (prev && prev.lifts.some((l) => l.exposures.length)) parts.push(`Main lifts:\n${list(prev.lifts.filter((l) => l.exposures.length).map((l) => `${l.lift}: e1RM ${kg(l.compTrend.first, prev.client.unit)} → ${kg(l.compTrend.last, prev.client.unit)} (${l.compTrend.changePct ?? "—"}%), ${l.frequencyPerWeek ?? "?"}×/wk, ${l.setsPerWeek ?? "?"} sets/wk, avg ${l.avgRelativeIntensityPct ?? "—"}% of best e1RM, RPE vs target ${l.avgRpeDelta ?? "—"}, heavy singles ${l.heavySingles}`))}`);
    add("previous", "The previous program: what it tells us", parts.join("\n"));
  } else add("previous", "The previous program", "No previous program with logged training.");

  add(
    "patterns",
    "Patterns across programs",
    [
      `Programs on file:\n${list(ctx.history.programs.map((p) => `${p.label}: ${p.start ?? "?"} → ${p.end ?? "?"}, ${p.weeks} wk, ${p.plannedDaysPerWeek ?? "?"} days/wk, ${p.sessionAdherencePct ?? "—"}% of workouts, ${p.setAdherencePct ?? "—"}% of sets`))}`,
      `Per block (measured):\n${list(history.blocks.map((b) => `B${b.number} ${b.name} (${b.start ?? "?"} → ${b.end ?? "?"}): ${b.sessionAdherencePct ?? "—"}% sessions, ${b.avgHardSetsPerWeek ?? "—"} hard sets/wk, RPE ${b.avgRpe ?? "—"}; ${LIFTS.filter((l) => b.liftChange[l].changePct != null).map((l) => `${l} ${b.liftChange[l].changePct}%`).join(", ") || "no lift trend"}`))}`,
      `Patterns (established = confirmed by the coach; recurring = 2+ blocks, an association; single = seen once, not a pattern yet):\n${list(intel.patterns.map((pt) => `[${pt.level.toUpperCase()}] ${pt.statement}${pt.caveat ? ` (${pt.caveat})` : ""}${pt.evidence.length ? ` Evidence: ${pt.evidence.slice(0, 5).join("; ")}` : ""}`), "none with enough evidence")}`,
    ].join("\n"),
  );
  add(
    "memory",
    "Athlete memory and earlier decisions",
    [
      `Confirmed by the coach:\n${list(ctx.memory.established.map((m) => `[${m.kind}${m.confidence === "fact" ? ", fact" : ", working belief"}] ${m.statement} (${m.date})`), "nothing confirmed yet")}`,
      `Results of earlier generated programs against their strategy:\n${list(x.outcomes ?? [], "none yet")}`,
    ].join("\n"),
  );
  // Notes and check-ins: everything, newest first, unless it alone would exceed a quarter of the budget.
  const checkins = [...ctx.notes.checkins].reverse();
  const checkinText = checkins.map((c) => `${c.date ?? "?"} ${c.form ?? "Form"}:\n${c.answers.map((a) => `  - ${a.q}: ${a.a}`).join("\n")}`);
  let shown = checkinText;
  let note: string | undefined;
  const cap = Math.floor(budget / 4);
  if (checkinText.join("\n").length > cap) {
    shown = [];
    let n = 0;
    for (const t of checkinText) {
      if (n + t.length > cap) break;
      shown.push(t);
      n += t.length;
    }
    note = `${checkinText.length - shown.length} older check-ins left out (input size); the newest ${shown.length} are included.`;
  }
  add("notes", "Coach notes, athlete notes and check-ins", [`Coach notes:\n${list(ctx.notes.coach)}`, `Athlete's notes in the logger:\n${list(ctx.notes.client)}`, `Check-ins and forms (newest first):\n${shown.join("\n") || "- none"}${note ? `\n- NOTE: ${note}` : ""}`].join("\n"), note ? "summary" : "full", note);
  if (prev) add("log", "Previous program: full log, set by set", trainingLogMarkdown(prev));

  // Earlier programs: set by set if it fits, else per exercise (said so).
  const fixed = sections.reduce((n, s) => n + s.chars, 0);
  const prevIds = new Set(intel.prevRec?.blocks.map((b) => b.id) ?? []);
  const earlierDays = history.days.filter((d) => !prevIds.has(d.weekKey.split(":")[0]));
  if (earlierDays.length) {
    const earlier: IntelReport = { ...history, days: earlierDays, weeks: history.weeks.filter((w) => !prevIds.has(w.blockId)) };
    // (a report whose days are the earlier programs only)
    const full = trainingLogMarkdown(earlier).replace("## Full training log: prescribed vs actual", "## Earlier programs: full log");
    if (fixed + full.length <= budget) add("earlier", "Earlier programs: full log, set by set", full);
    else {
      const sets = earlierDays.reduce((n, d) => n + d.rows.reduce((m, r) => m + r.actual.filter((s) => s.logged).length, 0), 0);
      const msg = `Earlier programs summarized per exercise: their ${sets} logged sets didn't fit the input budget (${Math.round(budget / 1000)}k characters). The previous program is complete set by set.`;
      add("earlier", "Earlier programs: per exercise", `NOTE: ${msg}\n${exerciseSummaryFromDays(earlierDays, history.client.unit)}`, "summary", msg);
    }
  }
  const kept = x.exclude?.length ? sections.filter((s) => !x.exclude!.includes(s.key)) : sections;
  const text = kept.map((s) => `## ${s.title}\n${s.text}`).join("\n\n");
  const warnings = kept.filter((s) => s.note).map((s) => s.note as string);
  if (text.length > budget) warnings.push(`The brief is ${Math.round(text.length / 1000)}k characters, over the ${Math.round(budget / 1000)}k budget, because the previous program alone is that large; nothing from it was cut.`);
  return { text, sections: kept.map(({ text: _t, ...s }) => s), warnings, chars: text.length, estTokens: Math.round(text.length / 4) };
}
