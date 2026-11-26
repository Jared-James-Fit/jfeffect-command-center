/**
 * Program completeness and Cleo's Program Check (pure, tested).
 *
 * Two different questions, kept apart on purpose:
 *
 * - Completeness (0–100%): is everything an athlete needs to follow the
 *   program filled in and readable? Sets, reps or a time, an intensity the
 *   app can turn into a weight, dates for a live program, progression on the
 *   main lifts, a block type... What's required follows the program's type:
 *   a bodybuilding program is never asked for competition lifts or maxes. A
 *   100% program isn't a good program; it's a complete one.
 *
 * - Program Check: is it good programming? Findings in three groups:
 *   `safe` (labels, accessory order by station, note clean-up, day names:
 *   applied only when the coach ticks them, each with its exact before → after),
 *   `decision` (anything that changes a load, volume, an exercise or the
 *   schedule: never changed here, the coach decides or asks Cleo to propose it
 *   through Adjust program, where every change is previewed and undoable) and
 *   `warning` (pain on a loaded area, missing equipment, a % with no max,
 *   sessions well over their limit).
 *
 * Every finding points at the workouts it's about (`at`), so a tap opens
 * the day. Workouts already trained or started are never changed (`locked`).
 */
import { estimateDayMinutes, rowsWithNames } from "@/lib/pl-programs";
import { rowProblems, ROW_LABEL } from "@/lib/pl-template-validation";
import { weekPurposeLabelsByDay } from "@/lib/program-editor-labels";
import { classifyExercise, type MovementPattern } from "@/lib/exercise-classifier";
import { orderAccessories } from "@/lib/program-intel/accessory-flow";
import { missingEquipment } from "@/lib/program-intel/equipment";
import { lowValueReason } from "@/lib/program-intel/exercise-standard";
import { withoutFixedLoads } from "@/lib/program-intel/loading";
import { painNeedsLook, painPlaceName, type PainPlace } from "@/lib/program-intel/pain-read";
import { overLimit, type SessionLimit } from "@/lib/program-intel/session-limit";
import type { EquipmentItem } from "@/lib/program-intel/types";
import { cleanGeneratedNote, isGeneratedNote } from "@/lib/workouts/coach-notes";
import { blockTypeFamily, resolveBlockType, type BlockMeta, type BlockTypeDef } from "@/lib/block-types";

export type Loc = { block: number; week: number; day: number; row?: number };

export type CheckDay = { day_index?: number | null; title?: string | null; subtitle?: string | null; scheduled_date?: string | null; rows?: any[]; _dbId?: string | null };
export type CheckWeek = { week_index?: number | null; phase?: string | null; notes?: string | null; days?: CheckDay[] };
export type CheckBlock = {
  id: string;
  name: string;
  weeks: CheckWeek[];
  blockType?: string | null;
  blockMeta?: BlockMeta | null;
  phase?: string | null;
  trainingFocus?: string | null;
  startDate?: string | null;
};
export type CheckExercise = {
  id: string;
  name: string;
  equipment?: string | null;
  competition_lift_type?: string | null;
  is_competition_lift?: boolean | null;
  exercise_category?: string | null;
  movement_family?: string | null;
  video_url?: string | null;
  vimeo_embed_url?: string | null;
  youtube_url?: string | null;
};
export type CheckAthlete = {
  sessionLimit?: SessionLimit | null;
  equipment?: { items: EquipmentItem[]; confidence: "confirmed" | "inferred" | "stated" | "unknown" } | null;
  pain?: PainPlace[];
  /** A % of a max shows a weight only when that max is on file. */
  hasMax?: (exerciseName: string, family: string | null, basis: string) => boolean;
  /** A live client program: its workouts need dates. */
  needsDates?: boolean;
};
/** What the program is for: drives which requirements apply. */
export type ProgramStyle = "powerlifting" | "powerbuilding" | "bodybuilding" | "strength" | "general" | "running" | "rehab" | null;

export type CheckInput = {
  kind: "client" | "template";
  style?: ProgramStyle;
  blocks: CheckBlock[];
  exercises: Map<string, CheckExercise>;
  athlete?: CheckAthlete | null;
  blockTypes?: BlockTypeDef[];
  /** A workout already trained or started: read, never changed. */
  locked?: (at: Loc) => boolean;
};

// ─── helpers ────────────────────────────────────────────────────────────────

const days = (w: CheckWeek) => w.days ?? [];
const rows = (d: CheckDay) => (d.rows ?? []) as any[];
const exName = (r: any, ex: Map<string, CheckExercise>) => (r?.exercise_id ? ex.get(r.exercise_id)?.name : null) ?? (r?.exercise_name_override as string | null) ?? "Exercise";
const isTimed = (r: any) => r?.measurement_type === "time";
const carriesOn = (r: any) => r?.percentage_basis === "top_set" || r?.percentage_basis === "prev_set";
const weekNo = (w: CheckWeek, i: number) => Number(w.week_index ?? i + 1);
const dayName = (d: CheckDay, i: number) => (d.subtitle?.trim() || d.title?.trim() || `Day ${d.day_index ?? i + 1}`);

/** "Week 2 · Day 1 Lower A" (with the block when there's more than one). */
export function locLabel(input: Pick<CheckInput, "blocks">, at: Loc): string {
  const b = input.blocks[at.block];
  const w = b?.weeks[at.week];
  const d = w ? days(w)[at.day] : undefined;
  const parts = [input.blocks.length > 1 && b ? b.name : null, w ? `Week ${weekNo(w, at.week)}` : null, d ? `Day ${d.day_index ?? at.day + 1}${d.subtitle?.trim() || d.title?.trim() ? ` ${dayName(d, at.day)}` : ""}` : null];
  return parts.filter(Boolean).join(" · ");
}

function competitionFamily(r: any, ex: Map<string, CheckExercise>): "squat" | "bench" | "deadlift" | null {
  const m = r?.exercise_id ? ex.get(r.exercise_id) : undefined;
  const t = String(m?.competition_lift_type ?? "").toLowerCase();
  if (m?.is_competition_lift && (t === "squat" || t === "bench" || t === "deadlift")) return t;
  const n = exName(r, ex);
  const hit = /\bcompetition (squat|bench|deadlift)\b/i.exec(n);
  return hit ? (hit[1].toLowerCase() as any) : null;
}

const MAX_BASES = new Set(["training_max", "1rm"]);

/** Live weeks: those with at least one workout not already trained. */
function eachDay(input: CheckInput, fn: (d: CheckDay, at: Loc, w: CheckWeek, b: CheckBlock) => void) {
  input.blocks.forEach((b, bi) => b.weeks.forEach((w, wi) => days(w).forEach((d, di) => fn(d, { block: bi, week: wi, day: di }, w, b))));
}

// ─── Completeness ───────────────────────────────────────────────────────────

export type CompletenessGap = { text: string; at?: Loc; fix?: "goals" | "maxes" | "schedule" | "block_type" | "athlete_setup" };
export type CompletenessItem = { key: string; label: string; weight: number; score: number; status: "ok" | "partial" | "missing"; detail: string; gaps: CompletenessGap[] };
export type Completeness = { score: number; items: CompletenessItem[] };

const item = (key: string, label: string, weight: number, score: number, detail: string, gaps: CompletenessGap[] = []): CompletenessItem => ({
  key,
  label,
  weight,
  score: Math.max(0, Math.min(1, score)),
  status: score >= 0.999 ? "ok" : score > 0 ? "partial" : "missing",
  detail,
  gaps,
});

export function programCompleteness(input: CheckInput): Completeness {
  const ex = input.exercises;
  const items: CompletenessItem[] = [];
  const style = input.style ?? null;
  const strength = style === "powerlifting" || style === "powerbuilding";

  // 1. Structure: blocks with weeks with workouts with exercises.
  let dayCount = 0;
  const emptyDays: CompletenessGap[] = [];
  eachDay(input, (d, at) => {
    dayCount++;
    if (!rows(d).length) emptyDays.push({ text: `${locLabel(input, at)} has no exercises`, at });
  });
  items.push(item("structure", "Workouts written", 15, dayCount ? (dayCount - emptyDays.length) / dayCount : 0, dayCount ? `${dayCount - emptyDays.length} of ${dayCount} workouts have exercises` : "No workouts yet", dayCount ? emptyDays : [{ text: "Add a week and its first workout" }]));

  // 2. Prescriptions: sets, reps or a time, an intensity the app can read.
  let rowCount = 0;
  const incomplete: CompletenessGap[] = [];
  eachDay(input, (d, at) =>
    rows(d).forEach((r, ri) => {
      rowCount++;
      const p = rowProblems(r);
      if (p.length) incomplete.push({ text: `${exName(r, ex)} (${locLabel(input, at)}): needs ${p.map((x) => ROW_LABEL[x]).join(", ")}`, at: { ...at, row: ri } });
    }),
  );
  items.push(item("prescriptions", "Sets, reps and intensity", 35, rowCount ? (rowCount - incomplete.length) / rowCount : 0, rowCount ? `${rowCount - incomplete.length} of ${rowCount} exercises fully prescribed` : "No exercises yet", incomplete));

  // 3. Exercises from the library (a custom name has no demo and no muscles for the volume read).
  const custom: CompletenessGap[] = [];
  eachDay(input, (d, at) => rows(d).forEach((r, ri) => { if (!r?.exercise_id && (r?.exercise_name_override ?? "").trim()) custom.push({ text: `${r.exercise_name_override} isn't linked to the exercise library`, at: { ...at, row: ri } }); }));
  if (rowCount) items.push(item("library", "Exercises from the library", 5, (rowCount - custom.length) / rowCount, custom.length ? `${custom.length} custom name${custom.length === 1 ? "" : "s"} (no demo, no muscle data)` : "Every exercise is in the library", dedupeGaps(custom)));

  // 4. Block types (what each block is for).
  const types = input.blocks.map((b) => resolveBlockType({ block_type: b.blockType, block_meta: b.blockMeta, phase: b.phase, training_focus: b.trainingFocus, name: b.name }, input.blockTypes));
  const typeScore = types.length ? types.reduce((n, t) => n + (t.type ? (t.inferred ? 0.5 : 1) : 0), 0) / types.length : 0;
  items.push(item("block_type", "Block type and purpose", 5, typeScore, types.every((t) => t.type && !t.inferred) ? "Every block has a type" : `${types.filter((t) => !t.type || t.inferred).length} block${types.filter((t) => !t.type || t.inferred).length === 1 ? "" : "s"} without a confirmed type`, input.blocks.flatMap((b, i) => (!types[i].type || types[i].inferred ? [{ text: `${b.name}: ${types[i].type ? `confirm "${types[i].type!.name}"` : "pick a block type"}`, fix: "block_type" as const, at: { block: i, week: 0, day: 0 } }] : []))));

  // 5. Progression on the main lifts in multi-week blocks.
  const prog = mainLiftProgression(input);
  if (prog.total) items.push(item("progression", "Progression on the main lifts", 10, (prog.total - prog.missing.length) / prog.total, prog.missing.length ? `${prog.missing.length} of ${prog.total} main lifts stay the same every week with no progression note` : "Every main lift changes week to week or says how to progress", prog.missing.map((m) => ({ text: `${m.name} (${m.block}): same every week`, at: m.at }))));

  // 6. Loads a % can be worked out from (a client's maxes).
  if (input.kind === "client" && input.athlete?.hasMax) {
    const pct: CompletenessGap[] = [];
    let pctRows = 0;
    eachDay(input, (d, at) => rows(d).forEach((r, ri) => {
      if (!MAX_BASES.has(String(r?.percentage_basis ?? "")) || r?.percentage == null || r.percentage === "") return;
      pctRows++;
      const name = exName(r, ex);
      if (!input.athlete!.hasMax!(name, competitionFamily(r, ex), String(r.percentage_basis))) pct.push({ text: `${name}: no ${r.percentage_basis === "1rm" ? "1RM" : "training max"} on file, so the athlete sees no weight`, at: { ...at, row: ri }, fix: "maxes" });
    }));
    if (pctRows) items.push(item("maxes", "Maxes for % prescriptions", 5, (pctRows - pct.length) / pctRows, pct.length ? `${dedupeGaps(pct).length} lift${dedupeGaps(pct).length === 1 ? "" : "s"} prescribed by % with no max on file` : "Every % has a max to read", dedupeGaps(pct)));
  }

  // 7. Dates (a live client program).
  if (input.kind === "client" && input.athlete?.needsDates) {
    let live = 0;
    const undated: CompletenessGap[] = [];
    eachDay(input, (d, at) => {
      if (input.locked?.(at)) return;
      live++;
      if (!d.scheduled_date) undated.push({ text: `${locLabel(input, at)} has no date`, at, fix: "schedule" });
    });
    if (live) items.push(item("schedule", "Workouts on the calendar", 10, (live - undated.length) / live, undated.length ? `${undated.length} of ${live} upcoming workouts have no date` : "Every upcoming workout has a date", undated.slice(0, 12)));
  }

  // 8. Competition lifts in a competition program.
  if (strength) {
    const seen = new Set<string>();
    eachDay(input, (d) => rows(d).forEach((r) => { const f = competitionFamily(r, ex); if (f) seen.add(f); }));
    const missing = (["squat", "bench", "deadlift"] as const).filter((l) => !seen.has(l));
    items.push(item("competition", "Competition lifts", 5, (3 - missing.length) / 3, missing.length ? `No competition ${missing.join(", ")} in the program` : "Squat, bench and deadlift are all trained", missing.map((l) => ({ text: `Add the competition ${l} (a ${style} program)` }))));
  }

  // 9. Constraints that are known: the session limit and equipment.
  if (input.kind === "client") {
    const limit = input.athlete?.sessionLimit ?? null;
    const gaps: CompletenessGap[] = [];
    let scoreParts = 0;
    let parts = 0;
    parts++;
    if (limit?.minutes != null) scoreParts++;
    else gaps.push({ text: "No session length on file (Goals & Setup)", fix: "goals" });
    parts++;
    if (input.athlete?.equipment && input.athlete.equipment.confidence !== "unknown") scoreParts++;
    else gaps.push({ text: "Their equipment isn't on file, so nothing can be checked against it", fix: "athlete_setup" });
    if (limit?.minutes != null) {
      const over = sessionsOverLimit(input, limit.minutes);
      parts++;
      if (!over.length) scoreParts++;
      else for (const o of over.slice(0, 6)) gaps.push({ text: `${o.label} runs about ${o.minutes} min, over ${limit.short}`, at: o.at });
    }
    items.push(item("constraints", "Fits their time and equipment", 10, scoreParts / parts, gaps.length ? `${gaps.length} to check` : `Within ${limit?.short ?? "their limit"}; equipment on file`, gaps));
  }

  const total = items.reduce((n, i) => n + i.weight, 0);
  const got = items.reduce((n, i) => n + i.weight * i.score, 0);
  return { score: total ? Math.round((got / total) * 100) : 0, items };
}

function dedupeGaps(gs: CompletenessGap[]): CompletenessGap[] {
  const seen = new Set<string>();
  return gs.filter((g) => (seen.has(g.text) ? false : (seen.add(g.text), true)));
}

/** Main lifts (labelled Primary / Secondary / top set, or a competition lift, or a day's first exercise) that never change across a block's weeks. */
export function mainLiftProgression(input: CheckInput): { total: number; missing: Array<{ name: string; block: string; at: Loc }> } {
  const ex = input.exercises;
  let total = 0;
  const missing: Array<{ name: string; block: string; at: Loc }> = [];
  input.blocks.forEach((b, bi) => {
    if (b.weeks.length < 2) return;
    const fam = blockTypeFamily(resolveBlockType({ block_type: b.blockType, phase: b.phase, training_focus: b.trainingFocus, name: b.name }, input.blockTypes).type);
    // a deload or taper block holds by design
    if (fam === "deload" || fam === "taper") return;
    const byKey = new Map<string, { name: string; rx: string[]; noted: boolean; at: Loc }>();
    b.weeks.forEach((w, wi) => days(w).forEach((d, di) => rows(d).forEach((r, ri) => {
      const isMain = ri === 0 || /\b(primary|secondary|top ?set|competition)\b/i.test(String(r?.purpose_label ?? "")) || !!competitionFamily(r, ex);
      if (!isMain || carriesOn(r) || isTimed(r)) return;
      const key = `${d.day_index ?? di}|${r?.exercise_id ?? exName(r, ex)}`;
      const rx = [r?.sets, r?.reps_text, r?.rpe, r?.rir, r?.percentage, r?.load_kg, r?.load_lb].map((v) => String(v ?? "")).join("/");
      const cur = byKey.get(key) ?? { name: exName(r, ex), rx: [], noted: false, at: { block: bi, week: wi, day: di, row: ri } };
      cur.rx.push(rx);
      if (/progress|increase|add |\+|double progression|each week|week to week|build/i.test(`${r?.notes ?? ""} ${r?.progression_method ?? ""}`)) cur.noted = true;
      byKey.set(key, cur);
    })));
    const blockSaysHow = !!b.blockMeta?.progression?.trim();
    for (const v of byKey.values()) {
      if (v.rx.length < 2) continue;
      total++;
      if (new Set(v.rx).size === 1 && !v.noted && !blockSaysHow) missing.push({ name: v.name, block: b.name, at: v.at });
    }
  });
  return { total, missing };
}

function sessionsOverLimit(input: CheckInput, limit: number): Array<{ label: string; minutes: number; at: Loc; weeks: number[] }> {
  const out = new Map<string, { label: string; minutes: number; at: Loc; weeks: number[] }>();
  eachDay(input, (d, at, w, b) => {
    if (input.locked?.(at) || !rows(d).length) return;
    const m = estimateDayMinutes(rowsWithNames(rows(d), (id) => input.exercises.get(id)?.name) as any);
    if (!overLimit(m, limit)) return;
    // one line per workout slot (its day in the block), whichever weeks run over
    const key = `${b.id}|${d.day_index ?? at.day}`;
    const cur = out.get(key);
    const wk = weekNo(w, at.week);
    if (cur) {
      cur.weeks.push(wk);
      cur.minutes = Math.max(cur.minutes, m);
      return;
    }
    out.set(key, { label: `${input.blocks.length > 1 ? `${b.name} · ` : ""}Day ${d.day_index ?? at.day + 1}${d.subtitle?.trim() || d.title?.trim() ? ` ${dayName(d, at.day)}` : ""}`, minutes: m, at, weeks: [wk] });
  });
  return [...out.values()].map((o) => ({ ...o, label: `${o.label} (${weeksWords(o.weeks)})` }));
}

/** "week 3", "weeks 1–4", "weeks 1, 3, 5". */
export function weeksWords(ws: number[]): string {
  const u = [...new Set(ws)].sort((a, b) => a - b);
  if (u.length === 1) return `week ${u[0]}`;
  const run = u.every((n, i) => i === 0 || n === u[i - 1] + 1);
  return run ? `weeks ${u[0]}–${u[u.length - 1]}` : `weeks ${u.join(", ")}`;
}

// ─── Program Check ──────────────────────────────────────────────────────────

export type CheckLevel = "safe" | "decision" | "warning";
export type Patch =
  | { kind: "row"; at: Required<Loc>; field: "purpose_label" | "notes"; value: string | null }
  | { kind: "day"; at: Loc; field: "subtitle"; value: string }
  | { kind: "order"; at: Loc; order: number[] };
export type CheckChange = { at: Loc; where: string; before: string; after: string };
export type CheckFinding = {
  id: string;
  level: CheckLevel;
  area: "labels" | "order" | "notes" | "names" | "intensity" | "progression" | "duration" | "volume" | "selection" | "equipment" | "pain" | "maxes" | "cues" | "block_type" | "duplicates";
  title: string;
  detail: string;
  at: Loc[];
  /** A safe finding's exact changes (what Apply does). */
  changes?: CheckChange[];
  patches?: Patch[];
  /** A decision Cleo can propose (Adjust program), never applied here. */
  ask?: string;
};

export const LEVEL_TITLE: Record<CheckLevel, string> = { safe: "Safe improvements", decision: "Your call", warning: "Important" };

const PAIN_LOADS: Record<string, MovementPattern[]> = {
  shoulder: ["horizontal_press", "incline_press", "vertical_press", "dip", "lateral_raise", "front_raise", "chest_fly", "pullover"],
  chest: ["horizontal_press", "incline_press", "dip", "chest_fly"],
  elbow: ["horizontal_press", "incline_press", "vertical_press", "dip", "elbow_flexion", "elbow_extension", "vertical_pull"],
  wrist_hand: ["horizontal_press", "incline_press", "vertical_press", "wrist"],
  upper_arm: ["elbow_flexion", "elbow_extension", "dip"],
  low_back: ["squat", "hinge", "back_extension"],
  mid_back: ["hinge", "horizontal_pull"],
  hip_groin: ["squat", "lunge", "hinge", "hip_adduction", "hip_flexion"],
  glute: ["hip_thrust", "hinge", "lunge"],
  knee: ["squat", "lunge", "knee_extension"],
  hamstring: ["hinge", "knee_flexion"],
  quad: ["squat", "lunge", "knee_extension"],
  calf: ["calf_raise"],
  ankle_foot: ["calf_raise", "lunge"],
  neck: ["shrug", "vertical_press"],
  upper_back: ["shrug", "horizontal_pull"],
  shoulder_blade: ["horizontal_pull", "vertical_pull", "horizontal_press"],
  ribs: ["horizontal_press", "hinge", "squat", "horizontal_pull"],
};

export function programCheck(input: CheckInput, depth: "quick" | "deep"): CheckFinding[] {
  const ex = input.exercises;
  const out: CheckFinding[] = [];
  const locked = (at: Loc) => !!input.locked?.(at);

  // ── safe: back-off rows labelled as back-offs ──
  {
    const patches: Patch[] = [];
    const changes: CheckChange[] = [];
    eachDay(input, (d, at) => {
      if (locked(at)) return;
      rows(d).forEach((r, ri) => {
        if (!carriesOn(r) || String(r?.purpose_label ?? "").trim()) return;
        const a = { ...at, row: ri };
        patches.push({ kind: "row", at: a, field: "purpose_label", value: "Back-off" });
        changes.push({ at: a, where: `${exName(r, ex)} · ${locLabel(input, at)}`, before: "No label", after: "Back-off" });
      });
    });
    if (patches.length) out.push({ id: "safe:backoff-labels", level: "safe", area: "labels", title: `Label ${patches.length} back-off set${patches.length === 1 ? "" : "s"}`, detail: "Rows worked out from the top set above them, labelled so the athlete and the logger read them as back-offs.", at: patches.map((p) => p.at as Loc), changes, patches });
  }

  // ── safe: a day with exercises and no name ──
  {
    const patches: Patch[] = [];
    const changes: CheckChange[] = [];
    eachDay(input, (d, at) => {
      if (locked(at) || (d.subtitle ?? "").trim() || (d.title ?? "").trim() || !rows(d).length) return;
      const name = suggestDayName(rows(d), ex);
      if (!name) return;
      patches.push({ kind: "day", at, field: "subtitle", value: name });
      changes.push({ at, where: locLabel(input, at), before: `Day ${d.day_index ?? at.day + 1}`, after: name });
    });
    if (patches.length) out.push({ id: "safe:day-names", level: "safe", area: "names", title: `Name ${patches.length} workout${patches.length === 1 ? "" : "s"}`, detail: "Workouts with no name get one from their main lifts, so the athlete knows what the day is.", at: patches.map((p) => p.at), changes, patches });
  }

  // ── safe: notes the generator left boilerplate or a frozen weight in ──
  {
    const patches: Patch[] = [];
    const changes: CheckChange[] = [];
    eachDay(input, (d, at, w) => {
      if (locked(at)) return;
      rows(d).forEach((r, ri) => {
        const note = (r?.notes ?? "").trim();
        if (!note) return;
        let next: string | null = note;
        if (isGeneratedNote(next)) next = cleanGeneratedNote(next, weekNo(w, at.week));
        next = withoutFixedLoads(next);
        const after = (next ?? "").trim();
        if (after === note) return;
        const a = { ...at, row: ri };
        patches.push({ kind: "row", at: a, field: "notes", value: after || null });
        changes.push({ at: a, where: `${exName(r, ex)} · ${locLabel(input, at)}`, before: note, after: after || "(no note)" });
      });
    });
    if (patches.length) out.push({ id: "safe:notes", level: "safe", area: "notes", title: `Tidy ${patches.length} note${patches.length === 1 ? "" : "s"}`, detail: "Generic progression lines, last week's instructions and fixed weights come out (the logger shows the live weight). Nothing the coach wrote by hand is reworded.", at: patches.map((p) => p.at as Loc), changes, patches });
  }

  // ── safe: accessories grouped by station (main lifts never move) ──
  {
    const patches: Patch[] = [];
    const changes: CheckChange[] = [];
    input.blocks.forEach((b, bi) => b.weeks.forEach((w, wi) => {
      const labels = weekPurposeLabelsByDay(days(w), [...ex.values()]);
      days(w).forEach((d, di) => {
        const at = { block: bi, week: wi, day: di };
        if (locked(at) || rows(d).length < 3) return;
        const list = rows(d).map((r, ri) => ({ exercise_name: exName(r, ex), role: (r?.purpose_label as string | null) || (carriesOn(r) ? "Back-off" : labels[di]?.[ri]), superset: (r?.superset_group ?? r?.superset ?? null) as string | null, idx: ri, equipment: r?.exercise_id ? ex.get(r.exercise_id)?.equipment ?? null : null }));
        const res = orderAccessories(list, (e) => e.equipment, { items: input.athlete?.equipment?.items, home: false });
        if (res.exercises === list || res.after >= res.before) return;
        patches.push({ kind: "order", at, order: res.exercises.map((e) => e.idx) });
        changes.push({ at, where: locLabel(input, at), before: `${res.before} station change${res.before === 1 ? "" : "s"}`, after: `${res.after} (${res.moved.map((m) => m.name).join(", ")} moved)` });
      });
    }));
    if (patches.length) out.push({ id: "safe:accessory-flow", level: "safe", area: "order", title: `Group accessories by station in ${patches.length} workout${patches.length === 1 ? "" : "s"}`, detail: "Fewer trips between machines. Main lifts keep their order, and nothing moves ahead of a compound that trains the same muscle.", at: patches.map((p) => p.at), changes, patches });
  }

  if (depth === "quick") return out;

  // ── decisions and warnings (deep review) ──
  const incomplete: Array<{ name: string; at: Loc }> = [];
  eachDay(input, (d, at) => rows(d).forEach((r, ri) => { if (!locked(at) && rowProblems(r).some((p) => p === "intensity" || p === "percent")) incomplete.push({ name: exName(r, ex), at: { ...at, row: ri } }); }));
  if (incomplete.length)
    out.push({ id: "decision:intensity", level: "decision", area: "intensity", title: `${incomplete.length} exercise${incomplete.length === 1 ? " has" : "s have"} no RPE, RIR or weight`, detail: `The athlete has nothing to pick a weight by: ${[...new Set(incomplete.map((i) => i.name))].slice(0, 5).join(", ")}${incomplete.length > 5 ? "…" : ""}.`, at: incomplete.map((i) => i.at), ask: `Fill in an effort target (RPE or RIR) on every exercise that has none (${[...new Set(incomplete.map((i) => i.name))].slice(0, 12).join(", ")}), matching each block's purpose and the athlete's recent RPE. Don't change anything else.` });

  const prog = mainLiftProgression(input);
  if (prog.missing.length)
    out.push({ id: "decision:progression", level: "decision", area: "progression", title: `${prog.missing.length} main lift${prog.missing.length === 1 ? " stays" : "s stay"} the same every week`, detail: `${prog.missing.slice(0, 4).map((m) => `${m.name} (${m.block})`).join(", ")}: no change week to week and no note saying how to progress.`, at: prog.missing.map((m) => m.at), ask: `Add week-to-week progression to the main lifts that stay identical every week (${prog.missing.slice(0, 8).map((m) => m.name).join(", ")}), following each block's type and progression approach. Keep sets and exercises as they are unless progression needs it.` });

  const limit = input.athlete?.sessionLimit ?? null;
  if (limit?.minutes != null) {
    const over = sessionsOverLimit(input, limit.minutes);
    const far = over.filter((o) => o.minutes > limit.minutes! + 15);
    if (far.length) out.push({ id: "warning:duration", level: "warning", area: "duration", title: `${far.length} workout${far.length === 1 ? " runs" : "s run"} well past ${limit.short}`, detail: far.slice(0, 4).map((o) => `${o.label}: about ${o.minutes} min`).join(" · "), at: far.map((o) => o.at), ask: `Bring every workout within ${limit.minutes} minutes (${limit.source === "pt" ? "their booked PT session" : "their stated limit"}): trim accessory sets or exercises first, keep the main lifts' work. Workouts over: ${far.map((o) => `${o.label} ~${o.minutes} min`).join("; ")}.` });
    const near = over.filter((o) => o.minutes <= limit.minutes! + 15);
    if (near.length) out.push({ id: "decision:duration", level: "decision", area: "duration", title: `${near.length} workout${near.length === 1 ? " is" : "s are"} a little over ${limit.short}`, detail: near.slice(0, 4).map((o) => `${o.label}: about ${o.minutes} min`).join(" · "), at: near.map((o) => o.at), ask: `Trim these workouts to about ${limit.minutes} minutes without touching the main lifts: ${near.map((o) => o.label).join("; ")}.` });
  }

  // volume per muscle in each block's first live week
  input.blocks.forEach((b, bi) => {
    const wi = b.weeks.findIndex((w, i) => days(w).some((_, di) => !locked({ block: bi, week: i, day: di })));
    if (wi < 0) return;
    const per = new Map<string, number>();
    const perSession: Array<{ muscle: string; sets: number; at: Loc }> = [];
    days(b.weeks[wi]).forEach((d, di) => {
      const dayPer = new Map<string, number>();
      for (const r of rows(d)) {
        if (isTimed(r)) continue;
        const sets = Number(r?.sets) || 0;
        const c = classifyExercise(exName(r, ex), r?.exercise_id ? ex.get(r.exercise_id)?.exercise_category : null);
        for (const m of c.primary) {
          if (m === ("other" as any)) continue;
          per.set(m, (per.get(m) ?? 0) + sets);
          dayPer.set(m, (dayPer.get(m) ?? 0) + sets);
        }
      }
      for (const [m, s] of dayPer) if (s > 12) perSession.push({ muscle: m, sets: s, at: { block: bi, week: wi, day: di } });
    });
    const high = [...per.entries()].filter(([, s]) => s > 24);
    if (high.length) out.push({ id: `decision:volume:${b.id}`, level: "decision", area: "volume", title: `${b.name}: ${high.map(([m, s]) => `${muscleWord(m)} ${s} sets`).join(", ")} a week`, detail: "Direct sets above about 24 a week are more than most lifters recover from. Keep it only if it's a deliberate priority.", at: [{ block: bi, week: wi, day: 0 }], ask: `In ${b.name}, weekly direct sets for ${high.map(([m]) => muscleWord(m)).join(", ")} are above 24. Bring them to a recoverable 12–20 unless that muscle is the block's priority; take sets from the least specific exercises first.` });
    if (perSession.length) out.push({ id: `decision:session-volume:${b.id}`, level: "decision", area: "volume", title: `${perSession.length} workout${perSession.length === 1 ? " puts" : "s put"} 13+ sets on one muscle`, detail: perSession.slice(0, 3).map((p) => `${locLabel(input, p.at)}: ${muscleWord(p.muscle)} ${p.sets} sets`).join(" · ") + ". Past about 10–12 hard sets in a session, more sets add fatigue faster than growth.", at: perSession.map((p) => p.at) });

    // what the block type says it's for, against what's written
    const t = resolveBlockType({ block_type: b.blockType, block_meta: b.blockMeta, phase: b.phase, training_focus: b.trainingFocus, name: b.name }, input.blockTypes);
    const fam = blockTypeFamily(t.type);
    if (t.type && !t.inferred) {
      const repsOf = (r: any) => { const m = /(\d+)/.exec(String(r?.reps_text ?? "")); return m ? Number(m[1]) : null; };
      const working = days(b.weeks[wi]).flatMap((d) => rows(d)).filter((r) => !isTimed(r));
      const reps = working.map(repsOf).filter((n): n is number => n != null);
      const low = reps.filter((n) => n <= 3).length / Math.max(1, reps.length);
      const highReps = reps.filter((n) => n >= 6).length / Math.max(1, reps.length);
      if ((fam === "hypertrophy" || fam === "accumulation") && reps.length >= 6 && low > 0.4)
        out.push({ id: `decision:type-fit:${b.id}`, level: "decision", area: "block_type", title: `${b.name} is a ${t.type.name} block, but ${Math.round(low * 100)}% of its sets are 1–3 reps`, detail: `${t.type.name}'s purpose: ${t.purpose ?? ""} Check the rep ranges match what this block is for.`, at: [{ block: bi, week: wi, day: 0 }] });
      if ((fam === "peaking" || fam === "intensification") && reps.length >= 6 && highReps > 0.7)
        out.push({ id: `decision:type-fit:${b.id}`, level: "decision", area: "block_type", title: `${b.name} is a ${t.type.name} block, but most of its sets are 6+ reps`, detail: `${t.type.name} usually means heavier, lower-rep work on the main lifts. Check it's what you intended.`, at: [{ block: bi, week: wi, day: 0 }] });
      const prev = bi > 0 ? input.blocks[bi - 1] : null;
      if (prev && (fam === "deload" || fam === "taper")) {
        const setsOf = (bb: CheckBlock) => { const w0 = bb.weeks[0]; return w0 ? days(w0).flatMap((d) => rows(d)).reduce((n, r) => n + (Number(r?.sets) || 0), 0) : 0; };
        const before = setsOf(prev);
        const now = setsOf(b);
        if (before > 0 && now > before * (fam === "deload" ? 0.7 : 0.8))
          out.push({ id: `decision:type-volume:${b.id}`, level: "decision", area: "block_type", title: `${b.name} (${t.type.name}) has ${now} sets a week against ${before} in ${prev.name}`, detail: `A ${t.type.name.toLowerCase()} usually cuts volume ${fam === "deload" ? "about half" : "40–60%"}. ${t.progression ?? ""}`, at: [{ block: bi, week: 0, day: 0 }], ask: `${b.name} is a ${t.type.name}: reduce its weekly sets to about ${Math.round(before * (fam === "deload" ? 0.5 : 0.55))} (from ${now}), keeping the main lifts and their intensity.` });
      }
    }
  });

  // exercises below the exercise standard
  const weak = new Map<string, { reason: string; at: Loc[] }>();
  eachDay(input, (d, at) => rows(d).forEach((r, ri) => {
    if (locked(at)) return;
    const n = exName(r, ex);
    const why = lowValueReason(n);
    if (!why) return;
    const cur = weak.get(n) ?? { reason: why, at: [] };
    cur.at.push({ ...at, row: ri });
    weak.set(n, cur);
  }));
  if (weak.size) out.push({ id: "decision:selection", level: "decision", area: "selection", title: `${weak.size} exercise${weak.size === 1 ? "" : "s"} below the exercise standard`, detail: [...weak.entries()].slice(0, 4).map(([n, w]) => `${n}: ${w.reason}`).join(" · "), at: [...weak.values()].flatMap((w) => w.at), ask: `Swap these for library exercises that train the same thing better (stable, loadable, progress in small steps): ${[...weak.keys()].join(", ")}.` });

  // the same exercise twice in a workout, not as a top set and its back-offs (once per workout slot)
  const dup = new Map<string, { name: string; at: Loc[]; weeks: number[]; label: string }>();
  eachDay(input, (d, at, w, b) => {
    const seen = new Set<string>();
    rows(d).forEach((r, ri) => {
      const k = r?.exercise_id ?? exName(r, ex).toLowerCase();
      if (seen.has(k) && !carriesOn(r) && !/back-?off|top ?set/i.test(String(r?.purpose_label ?? ""))) {
        const key = `${b.id}|${d.day_index ?? at.day}|${k}`;
        const cur = dup.get(key) ?? { name: exName(r, ex), at: [], weeks: [], label: `Day ${d.day_index ?? at.day + 1}` };
        cur.at.push({ ...at, row: ri });
        cur.weeks.push(weekNo(w, at.week));
        dup.set(key, cur);
      }
      seen.add(k);
    });
  });
  if (dup.size) out.push({ id: "decision:duplicates", level: "decision", area: "duplicates", title: `${dup.size} exercise${dup.size === 1 ? " appears" : "s appear"} twice in one workout`, detail: `${[...dup.values()].slice(0, 3).map((x) => `${x.name} on ${x.label} (${weeksWords(x.weeks)})`).join(" · ")}. Fine as a top set and back-offs or a deliberate second slot; otherwise it's usually a copy that should be one row.`, at: [...dup.values()].flatMap((x) => x.at) });

  // custom exercises with no demo and no note: the athlete has nothing to go on
  const bare = new Map<string, Loc[]>();
  eachDay(input, (d, at) => rows(d).forEach((r, ri) => {
    const meta = r?.exercise_id ? ex.get(r.exercise_id) : null;
    const hasDemo = !!(meta?.video_url || meta?.vimeo_embed_url || meta?.youtube_url);
    if (hasDemo || (r?.notes ?? "").trim() || isTimed(r)) return;
    if (meta && meta.exercise_category === "compound" && competitionFamily(r, ex)) return;
    const n = exName(r, ex);
    bare.set(n, [...(bare.get(n) ?? []), { ...at, row: ri }]);
  }));
  if (bare.size) out.push({ id: "decision:cues", level: "decision", area: "cues", title: `${bare.size} exercise${bare.size === 1 ? " has" : "s have"} no demo video and no cue`, detail: `${[...bare.keys()].slice(0, 5).join(", ")}${bare.size > 5 ? "…" : ""}. One short cue tells the athlete how to do it.`, at: [...bare.values()].flat(), ask: `Write one short coaching cue (a sentence, in my voice) in the notes of each exercise that has no demo video and no note: ${[...bare.keys()].slice(0, 12).join(", ")}. Change nothing else.` });

  // warnings: equipment, pain, maxes
  const equip = input.athlete?.equipment;
  if (equip && equip.confidence !== "unknown") {
    const miss = new Map<string, { need: string; at: Loc[] }>();
    eachDay(input, (d, at) => rows(d).forEach((r, ri) => {
      if (locked(at)) return;
      const meta = r?.exercise_id ? ex.get(r.exercise_id) : null;
      const n = exName(r, ex);
      const m = missingEquipment({ name: n, equipment: meta?.equipment ?? null }, equip);
      if (!m.length) return;
      const cur = miss.get(n) ?? { need: m.map((g) => g.join(" or ").replace(/_/g, " ")).join(" and "), at: [] };
      cur.at.push({ ...at, row: ri });
      miss.set(n, cur);
    }));
    if (miss.size) out.push({ id: "warning:equipment", level: equip.confidence === "stated" ? "decision" : "warning", area: "equipment", title: `${miss.size} exercise${miss.size === 1 ? " needs" : "s need"} equipment they don't have`, detail: [...miss.entries()].slice(0, 4).map(([n, m]) => `${n} needs ${m.need}`).join(" · "), at: [...miss.values()].flatMap((m) => m.at), ask: `Swap exercises their equipment doesn't allow for the closest library exercise it does: ${[...miss.keys()].join(", ")}.` });
  }

  for (const p of (input.athlete?.pain ?? []).filter(painNeedsLook)) {
    const pats = PAIN_LOADS[p.key];
    if (!pats) continue;
    const hits = new Map<string, Loc[]>();
    eachDay(input, (d, at) => rows(d).forEach((r, ri) => {
      if (locked(at)) return;
      const n = exName(r, ex);
      if (!pats.includes(classifyExercise(n).pattern)) return;
      hits.set(n, [...(hits.get(n) ?? []), { ...at, row: ri }]);
    }));
    if (!hits.size) continue;
    const place = painPlaceName(p);
    out.push({ id: `warning:pain:${p.key}`, level: "warning", area: "pain", title: `${place}: ${p.reports} report${p.reports === 1 ? "" : "s"}${p.trend === "worse" ? ", getting worse" : ""}${p.worst != null ? `, worst ${p.worst}/10` : ""}`, detail: `These load it: ${[...hits.keys()].slice(0, 5).join(", ")}. Worth a look before they train it (not a diagnosis).`, at: [...hits.values()].flat(), ask: `${place} pain has been reported ${p.reports} times${p.trend === "worse" ? " and is getting worse" : ""}. Review ${[...hits.keys()].slice(0, 6).join(", ")}: propose pain-free alternatives or adjustments (range, grip, load) only where it helps, and say what you'd keep. Not a diagnosis.` });
  }

  if (input.kind === "client" && input.athlete?.hasMax) {
    const noMax = new Map<string, Loc[]>();
    eachDay(input, (d, at) => rows(d).forEach((r, ri) => {
      if (locked(at) || !MAX_BASES.has(String(r?.percentage_basis ?? "")) || r?.percentage == null || r.percentage === "") return;
      const n = exName(r, ex);
      if (input.athlete!.hasMax!(n, competitionFamily(r, ex), String(r.percentage_basis))) return;
      noMax.set(n, [...(noMax.get(n) ?? []), { ...at, row: ri }]);
    }));
    if (noMax.size) out.push({ id: "warning:maxes", level: "warning", area: "maxes", title: `${noMax.size} lift${noMax.size === 1 ? " is" : "s are"} prescribed by % with no max on file`, detail: `${[...noMax.keys()].join(", ")}: the athlete sees no weight until a max is added.`, at: [...noMax.values()].flat() });
  }

  return out;
}

function muscleWord(m: string): string {
  return m.replace(/_/g, " ").replace(/\bdelts\b/, "delts");
}

/** "Squat + Bench", "Deadlift", "Push", from the day's first main exercises. */
export function suggestDayName(list: any[], ex: Map<string, CheckExercise>): string | null {
  const names: string[] = [];
  for (const r of list.slice(0, 4)) {
    const fam = competitionFamily(r, ex);
    if (fam) {
      const w = fam[0].toUpperCase() + fam.slice(1);
      if (!names.includes(w)) names.push(w);
    }
  }
  if (names.length) return names.slice(0, 2).join(" + ");
  const pats = list.slice(0, 3).map((r) => classifyExercise(exName(r, ex)).pattern);
  const lower = pats.filter((p) => ["squat", "hinge", "lunge", "hip_thrust", "knee_extension", "knee_flexion"].includes(p)).length;
  const push = pats.filter((p) => ["horizontal_press", "incline_press", "vertical_press", "dip"].includes(p)).length;
  const pull = pats.filter((p) => ["horizontal_pull", "vertical_pull"].includes(p)).length;
  if (lower >= 2) return "Lower";
  if (push >= 2 && pull === 0) return "Push";
  if (pull >= 2 && push === 0) return "Pull";
  if (push && pull) return "Upper";
  const first = list[0];
  return first ? exName(first, ex) : null;
}

/**
 * The picked safe findings applied to each block's weeks: field changes
 * first, then reorders (indices refer to the rows as they were). Returns new
 * arrays for what changed and the same ones for what didn't.
 */
export function applyPatches(blocksWeeks: any[][], patches: Patch[]): any[][] {
  const out = blocksWeeks.map((weeks) => weeks);
  const touchDay = (at: Loc) => {
    const weeks = (out[at.block] = out[at.block] === blocksWeeks[at.block] ? [...blocksWeeks[at.block]] : out[at.block]);
    const w = (weeks[at.week] = { ...weeks[at.week], days: [...(weeks[at.week]?.days ?? [])] });
    const d = (w.days[at.day] = { ...w.days[at.day], rows: [...(w.days[at.day]?.rows ?? [])] });
    return d;
  };
  for (const p of patches.filter((x) => x.kind !== "order")) {
    if (!blocksWeeks[p.at.block]?.[p.at.week]?.days?.[p.at.day]) continue;
    const d = touchDay(p.at);
    if (p.kind === "day") d[p.field] = p.value;
    else if (p.kind === "row" && d.rows[p.at.row]) d.rows[p.at.row] = { ...d.rows[p.at.row], [p.field]: p.value };
  }
  for (const p of patches.filter((x): x is Extract<Patch, { kind: "order" }> => x.kind === "order")) {
    if (!blocksWeeks[p.at.block]?.[p.at.week]?.days?.[p.at.day]) continue;
    const d = touchDay(p.at);
    if (p.order.length !== d.rows.length || new Set(p.order).size !== p.order.length) continue;
    d.rows = p.order.map((i) => d.rows[i]);
  }
  return out;
}

/** Score words: what 0–100 means here (never a quality grade). */
export function completenessWord(score: number): string {
  return score >= 100 ? "Complete" : score >= 85 ? "Nearly complete" : score >= 60 ? "Partly filled in" : "Needs filling in";
}
