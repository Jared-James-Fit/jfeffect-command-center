import type { ProgramDay, ProgramDraft, ProgramExercise } from "@/lib/athlete-programs";

/** The builder's pure helpers (tested). */

/** What the database allows (athlete_program_clean_days). */
export const MAX_DAYS = 7;
export const MAX_EXERCISES = 20;
export const MAX_SETS = 20;
export const MIN_WEEKS = 1;
export const MAX_WEEKS = 16;

export const REST_CHOICES: { label: string; seconds: number | null }[] = [
  { label: "—", seconds: null },
  { label: "0:45", seconds: 45 },
  { label: "1:00", seconds: 60 },
  { label: "1:30", seconds: 90 },
  { label: "2:00", seconds: 120 },
  { label: "3:00", seconds: 180 },
  { label: "4:00", seconds: 240 },
  { label: "5:00", seconds: 300 },
];

/** One-tap answers above the reps and RPE boxes on a phone (the box still takes anything). */
export const REPS_QUICK = ["1", "3", "5", "6-8", "8-10", "10-12", "12-15", "15-20"];
export const RPE_QUICK = ["6", "7", "7-8", "8", "8-9", "9", "10"];

export function newDay(index: number): ProgramDay {
  return { title: `Day ${index + 1}`, focus: null, exercises: [] };
}

/** A library exercise as it lands in a day: 3 × 8-10, 2:00 rest, the person edits from there. */
export function newExercise(ex: {
  id: string;
  name: string;
  muscle_group?: string | null;
  equipment?: string | null;
}): ProgramExercise {
  return {
    exercise_id: ex.id,
    name: ex.name,
    muscle_group: ex.muscle_group ?? null,
    equipment: ex.equipment ?? null,
    sets: 3,
    reps: "8-10",
    rpe: null,
    rest_seconds: 120,
    notes: null,
  };
}

/** The list with item i moved one step (-1 up, 1 down); unchanged at either end. */
export function moveItem<T>(list: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (i < 0 || i >= list.length || j < 0 || j >= list.length) return list;
  const out = list.slice();
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

export function removeAt<T>(list: T[], i: number): T[] {
  if (i < 0 || i >= list.length) return list;
  return list.filter((_, j) => j !== i);
}

/** Puts `item` back at `i` (Undo), clamped to the list as it is now. */
export function insertAt<T>(list: T[], i: number, item: T): T[] {
  const at = Math.max(0, Math.min(i, list.length));
  return [...list.slice(0, at), item, ...list.slice(at)];
}

/** Day i copied right after itself ("Upper (copy)"); unchanged once the week is full. */
export function duplicateDay(days: ProgramDay[], i: number): ProgramDay[] {
  const day = days[i];
  if (!day || days.length >= MAX_DAYS) return days;
  const copy: ProgramDay = {
    ...day,
    title: `${day.title} (copy)`.slice(0, 40),
    exercises: day.exercises.map((e) => ({ ...e })),
  };
  return insertAt(days, i + 1, copy);
}

/** Adds what fits (a day holds at most MAX_EXERCISES); `skipped` is what didn't. */
export function addExercises(
  day: ProgramDay,
  picked: Parameters<typeof newExercise>[0][],
): { day: ProgramDay; added: number; skipped: number } {
  const room = Math.max(0, MAX_EXERCISES - day.exercises.length);
  const fit = picked.slice(0, room);
  return {
    day: { ...day, exercises: [...day.exercises, ...fit.map(newExercise)] },
    added: fit.length,
    skipped: picked.length - fit.length,
  };
}

/** Another library exercise in the same spot, keeping its sets, reps, RPE, rest and note. */
export function swapExercise(
  e: ProgramExercise,
  ex: Parameters<typeof newExercise>[0],
): ProgramExercise {
  return {
    ...e,
    exercise_id: ex.id,
    name: ex.name,
    muscle_group: ex.muscle_group ?? null,
    equipment: ex.equipment ?? null,
  };
}

export const clampSets = (n: number) =>
  Math.max(1, Math.min(MAX_SETS, Math.round(Number.isFinite(n) ? n : 1)));
export const clampWeeks = (n: number) =>
  Math.max(MIN_WEEKS, Math.min(MAX_WEEKS, Math.round(Number.isFinite(n) ? n : MIN_WEEKS)));

/** "3 × 8-10 · RPE 8 · 2:00 rest": the program page and the builder's rows read the same. */
export function prescription(
  e: Pick<ProgramExercise, "sets" | "reps" | "rpe" | "rest_seconds">,
): string {
  const parts = [`${e.sets} × ${e.reps}`];
  if (e.rpe) parts.push(`RPE ${e.rpe}`);
  if (e.rest_seconds) {
    const m = Math.floor(e.rest_seconds / 60);
    const s = e.rest_seconds % 60;
    parts.push(m ? `${m}:${String(s).padStart(2, "0")} rest` : `${s}s rest`);
  }
  return parts.join(" · ");
}

/**
 * The library's most common muscle groups, most exercises first: the picker's
 * browse chips, read from the library itself so they're never a stale list.
 */
export function topMuscleGroups(
  library: readonly { muscle_group: string | null }[],
  n = 10,
): string[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const ex of library) {
    const label = ex.muscle_group?.trim();
    if (!label) continue;
    const key = label.toLowerCase();
    const hit = counts.get(key);
    if (hit) hit.count++;
    else counts.set(key, { label, count: 1 });
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, n)
    .map((x) => x.label);
}

export const sameMuscleGroup = (a: string | null | undefined, b: string) =>
  (a ?? "").trim().toLowerCase() === b.trim().toLowerCase();

/* ------------------------------------------------------------------ */
/*  The draft kept on the phone until it's saved                       */
/* ------------------------------------------------------------------ */

/**
 * A half-built program is kept on the device (per login, per program) so
 * iOS closing the app in the background, a reload or a stray back tap never
 * loses it. `base` is the saved program's updated_at it started from (null
 * for a new one): a copy made from an older version is never offered.
 */
export type DraftBackup = { v: 1; base: string | null; savedAt: number; draft: ProgramDraft };

export const DRAFT_BACKUP_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export const draftBackupKey = (userId: string, programId: string | null | undefined) =>
  `jf.program-draft.v1:${userId}:${programId || "new"}`;

/** The kept draft if it can be picked up again, else null. */
export function usableBackup(raw: unknown, base: string | null, now: number): ProgramDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Partial<DraftBackup>;
  if (b.v !== 1 || (b.base ?? null) !== base) return null;
  if (typeof b.savedAt !== "number" || now - b.savedAt > DRAFT_BACKUP_MAX_AGE_MS) return null;
  const d = b.draft as ProgramDraft | undefined;
  if (!d || typeof d.title !== "string" || !Array.isArray(d.days)) return null;
  if (d.days.length > MAX_DAYS) return null;
  for (const day of d.days) {
    if (!day || typeof day.title !== "string" || !Array.isArray(day.exercises)) return null;
    for (const e of day.exercises) {
      if (!e || typeof e.exercise_id !== "string") return null;
    }
  }
  return {
    id: d.id ?? null,
    title: d.title,
    description: typeof d.description === "string" ? d.description : "",
    goal: d.goal ?? null,
    level: d.level ?? null,
    weeks: clampWeeks(Number(d.weeks)),
    days: d.days,
  };
}

/** Whether two drafts would save the same program (names from the library don't count). */
export function sameDraft(a: ProgramDraft, b: ProgramDraft): boolean {
  const plain = (d: ProgramDraft) =>
    JSON.stringify({
      title: d.title,
      description: d.description,
      goal: d.goal ?? null,
      level: d.level ?? null,
      weeks: d.weeks,
      days: d.days.map((day) => ({
        title: day.title,
        focus: day.focus ?? null,
        exercises: day.exercises.map((e) => [
          e.exercise_id,
          e.sets,
          e.reps,
          e.rpe ?? null,
          e.rest_seconds ?? null,
          e.notes ?? null,
        ]),
      })),
    });
  return plain(a) === plain(b);
}
