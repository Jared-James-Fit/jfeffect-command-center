/**
 * The edit engine: applies the model's operations to a copy of the program,
 * checks every value, and says exactly what each change does (workout by
 * workout, exercise by exercise, before and after). The same code turns the
 * changes the coach keeps into the plan the database applies in one
 * transaction (program_ai_apply), or into a template's new payload. Pure:
 * no database, no model.
 *
 * Rules it enforces (a change that breaks one can't be applied):
 *   - refs must exist; exercises must be in the library (a catalog code or a
 *     library name the server already resolved); nothing new is invented;
 *   - a workout that was trained, started or is in the past stays as it is
 *     (left out of the change, said so; a change with nothing left fails);
 *   - cardio rows belong to the cardio plan, never the editor;
 *   - values are real prescriptions (sets 1–20, RPE 1–10, RIR 0–10,
 *     % 30–110, loads under the app's caps, tempo as digits) and one effort
 *     target per exercise (RPE or RIR), one load (fixed or %).
 * And it warns (still applicable): an exercise twice in a workout, a
 * workout left empty, a session over the athlete's limit, an exercise below
 * the exercise standard, a % on a lift with no max on file, two changes on
 * the same exercise.
 */
import { estimateDay, type TimedExercise } from "@/lib/program-intel/session-time";
import type { EditChange, EditOp, RxPatch } from "./ops";
import { WEEKDAYS } from "./ops";
import type { BlockSnap, CatalogExercise, DayDiff, DaySnap, Issue, ProgramSnapshot, ResolvedChange, RowLine, RowSnap, WeekSnap } from "./types";

export type EngineCtx = {
  /** Catalog by code ("X12"). */
  catalog: Map<string, CatalogExercise>;
  /** Catalog by exercise id (every exercise in the program is in it). */
  byId: Map<string, CatalogExercise>;
  /** Library names the server resolved for this reply (lowercased name → exercise). */
  names?: Map<string, CatalogExercise>;
  /** What the athlete's records say about each exercise (Program Intelligence's progress / hold / back off), by exercise id. */
  signals?: Map<string, { decision: "progress" | "maintain" | "regress" | "not_enough_data"; why: string }>;
};

export const LOAD_CAP = { kg: 450, lb: 1000 } as const;

// ---------------------------------------------------------------------------
// Reading values

/** "8", "7.5", "7-8" → the numbers, or null if it isn't one. */
export function effortValues(v: string): number[] | null {
  const m = /^(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+(?:\.\d+)?))?$/.exec(v.trim());
  if (!m) return null;
  return [Number(m[1]), ...(m[2] ? [Number(m[2])] : [])];
}

const TEMPO = /^([0-9xX]{3,4}|\d(?:-\d|-[xX]){2,3})$/;

function clock(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** How a prescription reads: "4 × 5 @RPE 8 · 80% 1RM · rest 3:00". */
export function rxLine(r: Pick<RowSnap, "sets" | "reps" | "rpe" | "rir" | "percentage" | "percentageBasis" | "loadKg" | "loadLb" | "loadUnit" | "restSeconds" | "restOverride" | "tempo" | "notes" | "measurementType" | "durationSeconds">): string {
  const parts: string[] = [];
  const timed = r.measurementType === "duration" || r.measurementType === "time";
  const head = timed && r.durationSeconds ? `${r.sets ?? 1} × ${clock(r.durationSeconds)}` : r.sets && r.reps ? `${r.sets} × ${r.reps}` : r.sets ? `${r.sets} sets` : r.reps ? `${r.reps} reps` : "";
  const effort = r.rpe ? `@RPE ${r.rpe}` : r.rir ? `@${r.rir} RIR` : "";
  const first = [head, effort].filter(Boolean).join(" ");
  if (first) parts.push(first);
  const unit = r.loadUnit ?? (r.loadKg != null && r.loadLb == null ? "kg" : "lb");
  const fixed = unit === "kg" ? r.loadKg : r.loadLb;
  if (fixed != null) parts.push(`${fixed} ${unit}`);
  else if (r.percentage != null) parts.push(`${r.percentage}% ${r.percentageBasis === "training_max" ? "TM" : r.percentageBasis === "est_1rm" ? "e1RM" : "1RM"}`);
  const rest = r.restOverride ?? r.restSeconds;
  if (rest != null) parts.push(`rest ${clock(rest)}`);
  if (r.tempo) parts.push(`tempo ${r.tempo}`);
  let s = parts.join(" · ") || "no prescription";
  if (r.notes) s += ` · "${r.notes.length > 90 ? `${r.notes.slice(0, 88)}…` : r.notes}"`;
  return s;
}

export function rowLine(r: RowSnap): string {
  return `${r.name} · ${rxLine(r)}`;
}

export function dayName(d: Pick<DaySnap, "title" | "subtitle" | "dayIndex">): string {
  return d.title?.trim() || d.subtitle?.trim() || `Day ${d.dayIndex}`;
}

function shortDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-CA", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
}

const DAY_NAME: Record<string, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
/** "mon,wed,fri" → "Mon, Wed, Fri" */
export function dayNames(days: readonly string[] | null | undefined): string {
  return (days ?? []).map((d) => DAY_NAME[d] ?? d).join(", ");
}

export function lockReason(lock: DaySnap["lock"]): string {
  return lock === "trained" ? "already trained" : lock === "started" ? "already started" : lock === "past" ? "in the past" : "";
}

// ---------------------------------------------------------------------------
// A working copy

type Loc = { row: RowSnap; day: DaySnap; week: WeekSnap; block: BlockSnap };
type DayLoc = { day: DaySnap; week: WeekSnap; block: BlockSnap };

export type Work = {
  blocks: BlockSnap[];
  /** ref → original record id (refs only ever name the program as read). */
  refs: Map<string, { kind: "row" | "day" | "week"; id: string }>;
  schedule: { trainingDays: string[] | null; redate: boolean } | null;
  newId: () => string;
};

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

export function refIndex(snap: ProgramSnapshot): Work["refs"] {
  const refs: Work["refs"] = new Map();
  for (const b of snap.blocks)
    for (const w of b.weeks) {
      refs.set(w.ref, { kind: "week", id: w.id });
      for (const d of w.days) {
        refs.set(d.ref, { kind: "day", id: d.id });
        for (const r of d.rows) refs.set(r.ref, { kind: "row", id: r.id });
      }
    }
  return refs;
}

let seq = 0;
function defaultNewId(): string {
  const c = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID();
  seq += 1;
  return `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
}

export function workFrom(snap: ProgramSnapshot, refs = refIndex(snap), newId: () => string = defaultNewId): Work {
  return { blocks: clone(snap.blocks), refs, schedule: null, newId };
}

function findRow(work: Work, id: string): Loc | null {
  for (const block of work.blocks)
    for (const week of block.weeks)
      for (const day of week.days) {
        const row = day.rows.find((r) => r.id === id);
        if (row) return { row, day, week, block };
      }
  return null;
}

function findDay(work: Work, id: string): DayLoc | null {
  for (const block of work.blocks)
    for (const week of block.weeks) {
      const day = week.days.find((d) => d.id === id);
      if (day) return { day, week, block };
    }
  return null;
}

function findWeek(work: Work, id: string): { week: WeekSnap; block: BlockSnap } | null {
  for (const block of work.blocks) {
    const week = block.weeks.find((w) => w.id === id);
    if (week) return { week, block };
  }
  return null;
}

function renumber(day: DaySnap) {
  day.rows.forEach((r, i) => (r.sortOrder = i));
}

// ---------------------------------------------------------------------------
// Exercises

export function resolveExercise(ref: string, ctx: EngineCtx): CatalogExercise | null {
  const s = ref.trim();
  if (/^X\d+$/i.test(s)) return ctx.catalog.get(s.toUpperCase()) ?? null;
  const key = normName(s);
  return ctx.names?.get(key) ?? [...ctx.catalog.values()].find((e) => normName(e.name) === key) ?? null;
}

export function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Exercise names (not catalog codes) a reply uses: the server looks these up in the library. */
export function exerciseNamesIn(changes: EditChange[]): string[] {
  const out = new Set<string>();
  const add = (s: string) => {
    if (!/^X\d+$/i.test(s.trim())) out.add(s.trim());
  };
  for (const c of changes)
    for (const op of c.ops) {
      if (op.op === "swap" || op.op === "add") add(op.exercise);
      if (op.op === "add_day") op.exercises.forEach((e) => add(e.exercise));
    }
  return [...out];
}

// ---------------------------------------------------------------------------
// Prescriptions

function applyRx(row: RowSnap, p: RxPatch | undefined, unit: "kg" | "lb", issues: Issue[], where: string) {
  if (!p) return;
  for (const c of p.clear ?? []) {
    if (c === "rpe") row.rpe = null;
    if (c === "rir") row.rir = null;
    if (c === "percentage") {
      row.percentage = null;
      row.percentageBasis = null;
    }
    if (c === "load") {
      row.loadKg = null;
      row.loadLb = null;
    }
    if (c === "tempo") row.tempo = null;
    if (c === "notes") row.notes = null;
    if (c === "rest") {
      row.restOverride = null;
      row.restSeconds = null;
    }
  }
  if (p.sets !== undefined) row.sets = p.sets;
  if (p.reps !== undefined) row.reps = p.reps;
  if (p.rpe !== undefined && p.rir !== undefined) issues.push({ level: "error", text: `${where}: give RPE or RIR, not both.` });
  if (p.rpe !== undefined) {
    const v = effortValues(p.rpe);
    if (!v || v.some((x) => x < 1 || x > 10)) issues.push({ level: "error", text: `${where}: RPE "${p.rpe}" isn't a valid RPE (1–10).` });
    row.rpe = p.rpe;
    row.rir = null;
  }
  if (p.rir !== undefined) {
    const v = effortValues(p.rir);
    if (!v || v.some((x) => x < 0 || x > 10)) issues.push({ level: "error", text: `${where}: RIR "${p.rir}" isn't a valid RIR (0–10).` });
    row.rir = p.rir;
    if (p.rpe === undefined) row.rpe = null;
  }
  if (p.percentage !== undefined && p.load !== undefined) issues.push({ level: "error", text: `${where}: give a % or a fixed load, not both.` });
  if (p.percentage !== undefined) {
    if (p.percentage < 30 || p.percentage > 110) issues.push({ level: "error", text: `${where}: ${p.percentage}% is outside 30–110%.` });
    row.percentage = p.percentage;
    row.percentageBasis = p.percentage_of ?? (row.percentageBasis && row.percentageBasis !== "manual" ? row.percentageBasis : "1rm");
    row.loadKg = null;
    row.loadLb = null;
    row.manualOverride = false;
  } else if (p.percentage_of !== undefined && row.percentage != null) {
    row.percentageBasis = p.percentage_of;
  }
  if (p.load !== undefined) {
    const u = p.load_unit ?? (row.loadUnit === "kg" || row.loadUnit === "lb" ? row.loadUnit : unit);
    if (p.load > LOAD_CAP[u]) issues.push({ level: "error", text: `${where}: ${p.load} ${u} is over the app's ${LOAD_CAP[u]} ${u} limit.` });
    row.loadUnit = u;
    row.loadKg = u === "kg" ? p.load : null;
    row.loadLb = u === "lb" ? p.load : null;
    row.percentage = null;
    row.percentageBasis = "manual";
  }
  if (p.rest_seconds !== undefined) {
    if (p.rest_seconds > 900) issues.push({ level: "error", text: `${where}: rest ${clock(p.rest_seconds)} is longer than 15 minutes.` });
    row.restSeconds = p.rest_seconds;
    row.restOverride = p.rest_seconds;
  }
  if (p.tempo !== undefined) {
    if (p.tempo && !TEMPO.test(p.tempo)) issues.push({ level: "error", text: `${where}: tempo "${p.tempo}" should be digits like 3-1-1-0 or 31X1.` });
    row.tempo = p.tempo || null;
  }
  if (p.notes !== undefined) row.notes = p.notes || null;
}

function newRow(work: Work, day: DaySnap, ex: CatalogExercise, unit: "kg" | "lb", p: RxPatch | undefined, issues: Issue[], where: string): RowSnap {
  const row: RowSnap = {
    id: work.newId(),
    ref: "",
    dayId: day.id,
    sortOrder: day.rows.length,
    exerciseId: ex.id,
    name: ex.name,
    nameOverride: null,
    sets: null,
    reps: null,
    rpe: null,
    rir: null,
    percentage: null,
    percentageBasis: null,
    loadKg: null,
    loadLb: null,
    loadUnit: null,
    manualOverride: false,
    restSeconds: ex.defaultRest,
    restOverride: null,
    tempo: null,
    notes: null,
    timeProfile: ex.timeProfile,
    purposeLabel: null,
    measurementType: "reps",
    trackingType: "reps_weight",
    durationSeconds: null,
    cardio: false,
    updatedAt: null,
  };
  applyRx(row, p, unit, issues, where);
  if (!row.sets) issues.push({ level: "error", text: `${where}: a new exercise needs its sets.` });
  if (!row.reps) issues.push({ level: "error", text: `${where}: a new exercise needs its reps.` });
  return row;
}

// ---------------------------------------------------------------------------
// One operation

type OpOut = { issues: Issue[]; skipped: Map<string, string>; touchedRows: Set<string> };

function label(loc: { day: DaySnap; week: WeekSnap }, row?: RowSnap): string {
  return `Week ${loc.week.weekIndex} ${dayName(loc.day)}${row ? ` · ${row.name}` : ""}`;
}

export function applyOp(work: Work, op: EditOp, ctx: EngineCtx, snap: ProgramSnapshot, out: OpOut) {
  const err = (text: string) => out.issues.push({ level: "error", text });
  const rowsOf = (list: string[]) => {
    const found: Loc[] = [];
    for (const ref of list) {
      const hit = work.refs.get(ref);
      if (!hit || hit.kind !== "row") {
        err(`${ref} isn't an exercise in this program.`);
        continue;
      }
      const loc = findRow(work, hit.id);
      if (!loc) {
        err(`${ref} was already removed by this change.`);
        continue;
      }
      if (loc.day.lock) {
        out.skipped.set(loc.day.id, `${label(loc)} is ${lockReason(loc.day.lock)}`);
        continue;
      }
      if (loc.row.cardio) {
        err(`${ref} (${loc.row.name}) comes from their cardio plan: change the cardio plan instead.`);
        continue;
      }
      found.push(loc);
    }
    return found;
  };
  const daysOf = (list: string[]) => {
    const found: DayLoc[] = [];
    for (const ref of list) {
      const hit = work.refs.get(ref);
      if (!hit || hit.kind !== "day") {
        err(`${ref} isn't a workout in this program.`);
        continue;
      }
      const loc = findDay(work, hit.id);
      if (!loc) {
        err(`${ref} was already removed by this change.`);
        continue;
      }
      if (loc.day.lock) {
        out.skipped.set(loc.day.id, `${label(loc)} is ${lockReason(loc.day.lock)}`);
        continue;
      }
      found.push(loc);
    }
    return found;
  };
  const exercise = (ref: string): CatalogExercise | null => {
    const ex = resolveExercise(ref, ctx);
    if (!ex) err(`"${ref}" isn't in the exercise library. Pick one from the catalog.`);
    return ex;
  };

  switch (op.op) {
    case "update": {
      for (const loc of rowsOf(op.rows)) {
        applyRx(loc.row, op.set, snap.unit, out.issues, label(loc, loc.row));
        out.touchedRows.add(loc.row.id);
      }
      return;
    }
    case "swap": {
      const ex = exercise(op.exercise);
      if (!ex) return;
      for (const loc of rowsOf(op.rows)) {
        if (loc.row.exerciseId === ex.id && !op.set) continue;
        // Another class of exercise doesn't inherit the old one's rest (a lat pulldown never keeps a
        // deadlift's 4:00); another movement doesn't inherit its label or cue ("SECONDARY DEADLIFT…").
        // Like for like (belt squat → hack squat) keeps the coach's rest: it may be a superset's.
        const was = loc.row.exerciseId ? ctx.byId.get(loc.row.exerciseId) : null;
        const otherClass = loc.row.timeProfile !== ex.timeProfile;
        const otherMovement = otherClass || (!!was?.family && !!ex.family && was.family !== ex.family);
        loc.row.exerciseId = ex.id;
        loc.row.name = ex.name;
        loc.row.nameOverride = null;
        loc.row.timeProfile = ex.timeProfile;
        if (otherClass) {
          loc.row.restSeconds = ex.defaultRest;
          loc.row.restOverride = null;
        }
        if (otherMovement) {
          loc.row.purposeLabel = null;
          loc.row.notes = null;
        }
        applyRx(loc.row, op.set, snap.unit, out.issues, label(loc, loc.row));
        out.touchedRows.add(loc.row.id);
      }
      return;
    }
    case "add": {
      const ex = exercise(op.exercise);
      if (!ex) return;
      for (const loc of daysOf(op.days)) {
        const row = newRow(work, loc.day, ex, snap.unit, op.set, out.issues, label(loc, { name: ex.name } as RowSnap));
        const pos = Math.min(Math.max((op.position ?? loc.day.rows.length + 1) - 1, 0), loc.day.rows.length);
        loc.day.rows.splice(pos, 0, row);
        renumber(loc.day);
        out.touchedRows.add(row.id);
      }
      return;
    }
    case "remove": {
      for (const loc of rowsOf(op.rows)) {
        loc.day.rows = loc.day.rows.filter((r) => r.id !== loc.row.id);
        renumber(loc.day);
        out.touchedRows.add(loc.row.id);
      }
      return;
    }
    case "move": {
      for (const loc of rowsOf(op.rows)) {
        const rest = loc.day.rows.filter((r) => r.id !== loc.row.id);
        const pos = Math.min(Math.max(op.position - 1, 0), rest.length);
        rest.splice(pos, 0, loc.row);
        loc.day.rows = rest;
        renumber(loc.day);
        out.touchedRows.add(loc.row.id);
      }
      return;
    }
    case "rename_day": {
      if (op.name === undefined && op.focus === undefined) return err("rename_day needs a name or a focus.");
      for (const loc of daysOf(op.days)) {
        if (op.name !== undefined) {
          if (loc.day.title || !loc.day.subtitle) loc.day.title = op.name;
          else loc.day.subtitle = op.name;
        }
        if (op.focus !== undefined) loc.day.focus = op.focus || null;
      }
      return;
    }
    case "add_day": {
      const exs = op.exercises.map((e) => ({ ex: exercise(e.exercise), set: e.set }));
      if (exs.some((e) => !e.ex)) return;
      for (const ref of op.weeks) {
        const hit = work.refs.get(ref);
        const loc = hit?.kind === "week" ? findWeek(work, hit.id) : null;
        if (!loc) {
          err(`${ref} isn't a week in this program.`);
          continue;
        }
        const open = loc.week.days.filter((d) => !d.lock);
        if (loc.week.days.length && !open.length) {
          out.skipped.set(`week:${loc.week.id}`, `Week ${loc.week.weekIndex} is already done`);
          continue;
        }
        const day: DaySnap = {
          id: work.newId(),
          ref: "",
          weekId: loc.week.id,
          dayIndex: Math.max(0, ...loc.week.days.map((d) => d.dayIndex)) + 1,
          title: op.name,
          subtitle: null,
          focus: op.focus ?? null,
          date: null,
          lock: null,
          isCustom: false,
          updatedAt: null,
          rows: [],
        };
        for (const e of exs) day.rows.push(newRow(work, day, e.ex!, snap.unit, e.set, out.issues, `Week ${loc.week.weekIndex} ${op.name} · ${e.ex!.name}`));
        renumber(day);
        loc.week.days.push(day);
      }
      return;
    }
    case "remove_day": {
      for (const loc of daysOf(op.days)) {
        loc.week.days = loc.week.days.filter((d) => d.id !== loc.day.id);
        // keep "Day N" labels in order when nothing after it was trained
        const later = loc.week.days.filter((d) => d.dayIndex > loc.day.dayIndex);
        if (later.every((d) => !d.lock)) for (const d of later) d.dayIndex -= 1;
      }
      return;
    }
    case "schedule": {
      if (snap.kind !== "client") return err("Training days belong to a client, not a template.");
      const days = op.training_days ? WEEKDAYS.filter((d) => op.training_days!.includes(d)) : null;
      // the days they already train on aren't a change (only re-dating is)
      const same = !!days && days.join() === WEEKDAYS.filter((d) => snap.trainingDays.includes(d)).join();
      work.schedule = { trainingDays: same ? null : days, redate: op.redate };
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// What changed

function rowKey(r: RowSnap): string {
  return JSON.stringify([r.exerciseId, r.name, r.sets, r.reps, r.rpe, r.rir, r.percentage, r.percentageBasis, r.loadKg, r.loadLb, r.loadUnit, r.restSeconds, r.restOverride, r.tempo, r.notes, r.timeProfile, r.measurementType, r.durationSeconds]);
}

export function dayMinutes(day: DaySnap, ctx: EngineCtx): number | null {
  if (!day.rows.length) return 0;
  const xs: TimedExercise[] = day.rows.map((r) => ({
    name: r.name,
    equipment: (r.exerciseId && ctx.byId.get(r.exerciseId)?.equipment) || null,
    sets: r.sets ?? 1,
    reps: r.measurementType === "duration" && r.durationSeconds ? null : r.reps,
    restSeconds: r.restOverride ?? r.restSeconds,
  }));
  try {
    const est = estimateDay(xs).minutes;
    // timed rows (a walk): their time, not reps
    const timed = day.rows.reduce((n, r) => n + (r.measurementType === "duration" && r.durationSeconds ? (r.durationSeconds * (r.sets ?? 1)) / 60 : 0), 0);
    return Math.round(est + timed);
  } catch {
    return null;
  }
}

function dayLabel(snap: ProgramSnapshot, block: BlockSnap, week: WeekSnap, day: DaySnap): string {
  const multi = snap.blocks.length > 1;
  return `${multi ? `${block.name} · ` : ""}Week ${week.weekIndex} · ${dayName(day)}${day.date ? ` · ${shortDate(day.date)}` : ""}`;
}

/** Workout by workout: what's different between the program as read and `work`. */
export function diffDays(snap: ProgramSnapshot, work: Work, ctx: EngineCtx): DayDiff[] {
  const out: DayDiff[] = [];
  for (const block of snap.blocks)
    for (const week of block.weeks) {
      const wb = work.blocks.find((b) => b.id === block.id);
      const ww = wb?.weeks.find((w) => w.id === week.id);
      for (const day of week.days) {
        const now = ww?.days.find((d) => d.id === day.id);
        if (!now) {
          out.push({ ref: day.ref, label: dayLabel(snap, block, week, day), kind: "removed", minutesBefore: dayMinutes(day, ctx), minutesAfter: null, rows: day.rows.map((r) => ({ kind: "removed", before: rowLine(r), after: null })) });
          continue;
        }
        const rows: RowLine[] = [];
        const before = new Map(day.rows.map((r) => [r.id, r]));
        const after = new Map(now.rows.map((r) => [r.id, r]));
        const keptOrderBefore = day.rows.filter((r) => after.has(r.id)).map((r) => r.id);
        const keptOrderAfter = now.rows.filter((r) => before.has(r.id)).map((r) => r.id);
        for (const r of day.rows) if (!after.has(r.id)) rows.push({ kind: "removed", before: rowLine(r), after: null });
        for (const r of now.rows) {
          const was = before.get(r.id);
          if (!was) rows.push({ kind: "added", before: null, after: rowLine(r) });
          else if (rowKey(was) !== rowKey(r)) rows.push({ kind: was.exerciseId !== r.exerciseId ? "swapped" : "changed", before: rowLine(was), after: rowLine(r) });
          else if (keptOrderBefore.indexOf(r.id) !== keptOrderAfter.indexOf(r.id)) rows.push({ kind: "moved", before: `${was.sortOrder + 1}. ${was.name}`, after: `${r.sortOrder + 1}. ${r.name}` });
        }
        const renamed = dayName(day) !== dayName(now) || (day.focus ?? "") !== (now.focus ?? "") ? { before: [dayName(day), day.focus].filter(Boolean).join(" · "), after: [dayName(now), now.focus].filter(Boolean).join(" · ") } : null;
        if (rows.length || renamed) out.push({ ref: day.ref, label: dayLabel(snap, block, week, day), kind: "changed", minutesBefore: dayMinutes(day, ctx), minutesAfter: dayMinutes(now, ctx), rows, renamed });
      }
      for (const d of ww?.days ?? []) {
        if (week.days.some((x) => x.id === d.id)) continue;
        out.push({ ref: "", label: dayLabel(snap, block, week, d), kind: "added", minutesBefore: null, minutesAfter: dayMinutes(d, ctx), rows: d.rows.map((r) => ({ kind: "added", before: null, after: rowLine(r) })) });
      }
    }
  return out;
}

// ---------------------------------------------------------------------------
// Checking a change

const COMP_FAMILY: Record<string, string> = { squat: "squat", bench: "bench", deadlift: "deadlift", hinge: "deadlift" };

function changeChecks(snap: ProgramSnapshot, work: Work, ctx: EngineCtx, diffs: DayDiff[], issues: Issue[]) {
  const affected = new Set(diffs.map((d) => d.label));
  const before = new Map(snap.blocks.flatMap((b) => b.weeks).flatMap((w) => w.days).map((d) => [d.id, d]));
  const count = (rows: RowSnap[]) => {
    const m = new Map<string, number>();
    for (const r of rows) if (r.exerciseId) m.set(r.exerciseId, (m.get(r.exerciseId) ?? 0) + 1);
    return m;
  };
  for (const block of work.blocks)
    for (const week of block.weeks)
      for (const day of week.days) {
        const lbl = dayLabel(snap, block, week, day);
        if (!affected.has(lbl)) continue;
        // only a duplicate this change makes (a top set + back-offs already there is the coach's)
        const had = count(before.get(day.id)?.rows ?? []);
        for (const [id, n] of count(day.rows)) if (n > 1 && n > (had.get(id) ?? 0)) issues.push({ level: "warning", text: `${lbl}: ${ctx.byId.get(id)?.name ?? "an exercise"} would be in it ${n} times (fine for a top set and back-offs).` });
        if (!day.rows.length) issues.push({ level: "warning", text: `${lbl} would have no exercises: remove the workout instead.` });
      }
  const max = snap.maxSessionMinutes ?? null;
  if (max) {
    const over = diffs.filter((d) => d.minutesAfter != null && d.minutesAfter > max && (d.minutesBefore == null || d.minutesAfter > d.minutesBefore));
    if (over.length) issues.push({ level: "warning", text: `${over.length} workout${over.length === 1 ? "" : "s"} would run about ${Math.max(...over.map((d) => d.minutesAfter ?? 0))} min, over their ${max}-min limit.` });
  }
  // exercises below the standard, and % with no max
  const original = new Map(snap.blocks.flatMap((x) => x.weeks).flatMap((x) => x.days).flatMap((x) => x.rows).map((r) => [r.id, r]));
  const added = new Set<string>();
  const noMax = new Set<string>();
  for (const b of work.blocks)
    for (const w of b.weeks)
      for (const d of w.days)
        for (const r of d.rows) {
          const orig = original.get(r.id);
          if (r.exerciseId && (!orig || orig.exerciseId !== r.exerciseId)) added.add(r.exerciseId);
          if (r.percentage != null && (!orig || orig.percentage == null) && snap.maxLifts) {
            const fam = r.exerciseId ? ctx.byId.get(r.exerciseId)?.family?.toLowerCase() ?? "" : "";
            const lift = COMP_FAMILY[fam] ?? (/squat/i.test(r.name) ? "squat" : /bench/i.test(r.name) ? "bench" : /deadlift/i.test(r.name) ? "deadlift" : null);
            if ((!lift || !snap.maxLifts.includes(lift)) && !noMax.has(r.name)) {
              noMax.add(r.name);
              issues.push({ level: "warning", text: `${r.name}: a % needs a max to turn into a load, and none is on file for it.` });
            }
          }
        }
  for (const id of added) {
    const ex = ctx.byId.get(id);
    if (ex?.standard) issues.push({ level: "warning", text: `${ex.name} is below the exercise standard: ${ex.standard}.` });
  }
  // asking more of an exercise the athlete's records say to back off
  if (ctx.signals?.size) {
    const flagged = new Set<string>();
    for (const b of work.blocks)
      for (const w of b.weeks)
        for (const d of w.days)
          for (const r of d.rows) {
            const o = original.get(r.id);
            if (!o || !r.exerciseId || o.exerciseId !== r.exerciseId || flagged.has(r.exerciseId)) continue;
            const sig = ctx.signals.get(r.exerciseId);
            if (sig?.decision !== "regress" || !asksMore(o, r)) continue;
            flagged.add(r.exerciseId);
            issues.push({ level: "warning", text: `${r.name}: their records say back off (${sig.why}), and this asks for more.` });
          }
  }
}

const top = (v: string | null) => {
  const n = v ? effortValues(v) : null;
  return n ? Math.max(...n) : null;
};
const low = (v: string | null) => {
  const n = v ? effortValues(v) : null;
  return n ? Math.min(...n) : null;
};

/** More sets, more load, a higher %, a harder RPE or fewer reps in reserve than before. */
export function asksMore(before: RowSnap, after: RowSnap): boolean {
  if ((after.sets ?? 0) > (before.sets ?? 0)) return true;
  const load = (r: RowSnap) => (r.loadKg != null ? r.loadKg : r.loadLb != null ? r.loadLb / 2.2046226218 : null);
  const lb = load(before);
  const la = load(after);
  if (lb != null && la != null && la > lb) return true;
  if (before.percentage != null && after.percentage != null && after.percentage > before.percentage) return true;
  const rb = top(before.rpe);
  const ra = top(after.rpe);
  if (rb != null && ra != null && ra > rb) return true;
  const ib = low(before.rir);
  const ia = low(after.rir);
  return ib != null && ia != null && ia < ib;
}

function weeksOf(diffs: DayDiff[]): string[] {
  const out: string[] = [];
  for (const d of diffs) {
    const m = /Week (\d+)/.exec(d.label);
    const w = m ? `Week ${m[1]}` : null;
    if (w && !out.includes(w)) out.push(w);
  }
  return out;
}

/** Each change on its own against the program as read: what it does, what's wrong with it. */
export function resolveChanges(snap: ProgramSnapshot, changes: EditChange[], ctx: EngineCtx): ResolvedChange[] {
  const refs = refIndex(snap);
  const touchedBy = new Map<string, string>();
  return changes.map((c) => {
    const work = workFrom(snap, refs);
    const out: OpOut = { issues: [], skipped: new Map(), touchedRows: new Set() };
    for (const op of c.ops) applyOp(work, op, ctx, snap, out);
    const days = diffDays(snap, work, ctx);
    const issues = [...out.issues];
    if (out.skipped.size) {
      const list = [...out.skipped.values()];
      issues.push({ level: "warning", text: `Left as it is: ${list.slice(0, 4).join("; ")}${list.length > 4 ? ` and ${list.length - 4} more` : ""}.` });
    }
    changeChecks(snap, work, ctx, days, issues);
    for (const id of out.touchedRows) {
      const other = touchedBy.get(id);
      if (other && other !== c.id) {
        issues.push({ level: "warning", text: `Change ${other} changes some of the same exercises; applying both keeps this one's values.` });
        break;
      }
    }
    for (const id of out.touchedRows) if (!touchedBy.has(id)) touchedBy.set(id, c.id);
    const schedule = work.schedule ? { before: snap.trainingDays, after: work.schedule.trainingDays, redate: work.schedule.redate } : null;
    if (schedule?.after && schedule.after.length) {
      const perWeek = Math.max(0, ...work.blocks.flatMap((b) => b.weeks.filter((w) => w.days.some((d) => !d.lock)).map((w) => w.days.filter((d) => !d.lock).length)));
      if (perWeek > schedule.after.length) issues.push({ level: "warning", text: `Some weeks still have ${perWeek} workouts for ${schedule.after.length} training days: the extra ones won't get a date.` });
    }
    const hasErrors = issues.some((i) => i.level === "error");
    if (!days.length && !schedule && !hasErrors) issues.push({ level: "error", text: out.skipped.size ? "Nothing left to change: every workout in it is already trained, started or in the past." : "This change doesn't change anything." });
    const ok = !issues.some((i) => i.level === "error");
    return {
      id: c.id,
      title: c.title,
      why: c.why,
      basis: c.basis,
      evidence: c.evidence,
      ops: c.ops,
      issues,
      days,
      schedule,
      ok,
      touched: { workouts: days.length, exercises: days.reduce((n, d) => n + d.rows.length, 0), weeks: weeksOf(days) },
    };
  });
}

// ---------------------------------------------------------------------------
// The plan the database applies

const ROW_COLUMNS: Array<[keyof RowSnap, string]> = [
  ["exerciseId", "exercise_id"],
  ["nameOverride", "exercise_name_override"],
  ["sets", "sets"],
  ["reps", "reps_text"],
  ["rpe", "rpe"],
  ["rir", "rir"],
  ["percentage", "percentage"],
  ["percentageBasis", "percentage_basis"],
  ["loadKg", "load_kg"],
  ["loadLb", "load_lb"],
  ["loadUnit", "load_unit"],
  ["manualOverride", "manual_override"],
  ["restSeconds", "rest_seconds"],
  ["restOverride", "rest_seconds_override"],
  ["tempo", "tempo"],
  ["notes", "notes"],
  ["sortOrder", "sort_order"],
  ["timeProfile", "time_profile"],
  ["purposeLabel", "purpose_label"],
  ["measurementType", "measurement_type"],
  ["trackingType", "tracking_type"],
  ["durationSeconds", "duration_seconds"],
];

export type ApplyPlan = {
  row_updates: Array<{ id: string; patch: Record<string, unknown> }>;
  row_inserts: Array<Record<string, unknown>>;
  row_deletes: Array<{ id: string }>;
  day_updates: Array<{ id: string; patch: Record<string, unknown> }>;
  day_inserts: Array<{ id: string; week_id: string; day_index: number; title: string | null; subtitle: string | null; focus: string | null }>;
  day_deletes: Array<{ id: string }>;
  day_bases: Array<{ id: string; day: string | null; rows: number; rows_max: string | null }>;
  summary: string;
};

export type BuiltPlan = { plan: ApplyPlan; schedule: Work["schedule"]; issues: Issue[]; work: Work; empty: boolean };

/** The changes the coach kept, one after another on one copy, as the records to write. */
export function buildPlan(snap: ProgramSnapshot, changes: EditChange[], ctx: EngineCtx, newId?: () => string): BuiltPlan {
  const work = workFrom(snap, refIndex(snap), newId);
  const out: OpOut = { issues: [], skipped: new Map(), touchedRows: new Set() };
  for (const c of changes) for (const op of c.ops) applyOp(work, op, ctx, snap, out);
  const plan: ApplyPlan = { row_updates: [], row_inserts: [], row_deletes: [], day_updates: [], day_inserts: [], day_deletes: [], day_bases: [], summary: changes.map((c) => c.title).join("; ").slice(0, 1900) };
  const touched = new Set<string>();
  for (const block of snap.blocks)
    for (const week of block.weeks) {
      const ww = work.blocks.find((b) => b.id === block.id)?.weeks.find((w) => w.id === week.id);
      for (const day of week.days) {
        const now = ww?.days.find((d) => d.id === day.id);
        if (!now) {
          plan.day_deletes.push({ id: day.id });
          touched.add(day.id);
          continue;
        }
        const dp: Record<string, unknown> = {};
        if ((day.title ?? null) !== (now.title ?? null)) dp.title = now.title;
        if ((day.subtitle ?? null) !== (now.subtitle ?? null)) dp.subtitle = now.subtitle;
        if ((day.focus ?? null) !== (now.focus ?? null)) dp.focus = now.focus;
        if (day.dayIndex !== now.dayIndex) dp.day_index = now.dayIndex;
        if (Object.keys(dp).length) {
          plan.day_updates.push({ id: day.id, patch: dp });
          touched.add(day.id);
        }
        const after = new Map(now.rows.map((r) => [r.id, r]));
        for (const r of day.rows) {
          const n = after.get(r.id);
          if (!n) {
            plan.row_deletes.push({ id: r.id });
            touched.add(day.id);
            continue;
          }
          const patch: Record<string, unknown> = {};
          for (const [k, col] of ROW_COLUMNS) if ((r[k] ?? null) !== (n[k] ?? null)) patch[col] = n[k] ?? null;
          if (Object.keys(patch).length) {
            plan.row_updates.push({ id: r.id, patch });
            touched.add(day.id);
          }
        }
        const had = new Set(day.rows.map((r) => r.id));
        for (const r of now.rows)
          if (!had.has(r.id)) {
            plan.row_inserts.push(insertRow(r, day.id));
            touched.add(day.id);
          }
      }
      for (const d of ww?.days ?? []) {
        if (week.days.some((x) => x.id === d.id)) continue;
        plan.day_inserts.push({ id: d.id, week_id: week.id, day_index: d.dayIndex, title: d.title, subtitle: d.subtitle, focus: d.focus });
        for (const r of d.rows) plan.row_inserts.push(insertRow(r, d.id));
      }
    }
  for (const block of snap.blocks)
    for (const week of block.weeks)
      for (const day of week.days) {
        if (!touched.has(day.id)) continue;
        const max = day.rows.reduce<string | null>((m, r) => (r.updatedAt && (!m || Date.parse(r.updatedAt) > Date.parse(m)) ? r.updatedAt : m), null);
        plan.day_bases.push({ id: day.id, day: day.updatedAt, rows: day.rows.length, rows_max: max });
      }
  const issues = [...out.issues];
  if (out.skipped.size) issues.push({ level: "warning", text: `Left as it is: ${[...out.skipped.values()].slice(0, 4).join("; ")}.` });
  const empty = !plan.row_updates.length && !plan.row_inserts.length && !plan.row_deletes.length && !plan.day_updates.length && !plan.day_inserts.length && !plan.day_deletes.length;
  return { plan, schedule: work.schedule, issues, work, empty };
}

function insertRow(r: RowSnap, dayId: string): Record<string, unknown> {
  const o: Record<string, unknown> = { id: r.id, day_id: dayId };
  for (const [k, col] of ROW_COLUMNS) {
    const v = r[k];
    if (v !== null && v !== undefined) o[col] = v;
  }
  return o;
}

// ---------------------------------------------------------------------------
// Templates: the new payload

const TEMPLATE_ROW_KEYS: Array<[keyof RowSnap, string]> = ROW_COLUMNS.filter(([k]) => k !== "sortOrder");

/**
 * The template's v2 payload with `work` written into it: blocks and weeks kept
 * (with everything the editor stores on them), workouts and exercises rebuilt
 * from the edited copy, untouched fields carried through.
 */
export function templatePayloadFrom(v2: { blocks: any[]; [k: string]: any }, snap: ProgramSnapshot, work: Work): { payload: any; meta: { weeks?: number; days_per_week?: number } } {
  const payload = clone(v2);
  for (const sb of work.blocks) {
    const tb = payload.blocks.find((b: any) => b.id === sb.id);
    if (!tb) continue;
    tb.weeks = sb.weeks.map((w) => {
      const raw = clone((w.raw ?? {}) as any);
      raw.days = w.days.map((d) => {
        const rd: any = clone((d.raw ?? {}) as any);
        rd.day_index = d.dayIndex;
        if (d.title !== null || "title" in rd) rd.title = d.title ?? "";
        if (d.subtitle !== null || "subtitle" in rd) rd.subtitle = d.subtitle ?? "";
        if (d.focus !== null || "focus" in rd) rd.focus = d.focus;
        rd.rows = d.rows.map((r, i) => {
          const rr: any = clone((r.raw ?? {}) as any);
          for (const [k, col] of TEMPLATE_ROW_KEYS) {
            const v = k === "nameOverride" ? r.nameOverride ?? r.name : r[k];
            if (v !== null && v !== undefined) rr[col] = v;
            else if (col in rr) rr[col] = null;
          }
          rr.sort_order = i + 1;
          return rr;
        });
        return rd;
      });
      return raw;
    });
  }
  const meta: { weeks?: number; days_per_week?: number } = {};
  const active = payload.blocks.filter((b: any) => !b.archived && !b.deleted_at);
  const weeks = active.reduce((n: number, b: any) => n + (b.weeks?.length ?? 0), 0);
  const perWeek = Math.max(0, ...active.flatMap((b: any) => (b.weeks ?? []).map((w: any) => w.days?.length ?? 0)));
  const beforeWeeks = snap.blocks.reduce((n, b) => n + b.weeks.length, 0);
  const beforePer = Math.max(0, ...snap.blocks.flatMap((b) => b.weeks.map((w) => w.days.length)));
  if (weeks && weeks !== beforeWeeks) meta.weeks = weeks;
  if (perWeek && perWeek !== beforePer) meta.days_per_week = perWeek;
  return { payload, meta };
}
