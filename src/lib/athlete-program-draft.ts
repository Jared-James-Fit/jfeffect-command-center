import type { ProgramDraft, ProgramExercise } from "@/lib/athlete-programs";
import { MAX_EXERCISES, normalizePlan, planFromDays, samePlan } from "@/lib/program-plan";

/** The builder's pure helpers that aren't the plan itself (tested). */

export { MAX_EXERCISES };

export const REST_CHOICES: { label: string; seconds: number | null }[] = [
  { label: "—", seconds: null },
  { label: "0:45", seconds: 45 },
  { label: "1:00", seconds: 60 },
  { label: "1:30", seconds: 90 },
  { label: "2:00", seconds: 120 },
  { label: "2:30", seconds: 150 },
  { label: "3:00", seconds: 180 },
  { label: "4:00", seconds: 240 },
  { label: "5:00", seconds: 300 },
];

/** One-tap answers over the keyboard while a cell is being typed in (the cell still takes anything). */
export const SETS_QUICK = ["1", "2", "3", "4", "5", "6"];
export const REPS_QUICK = ["1", "3", "5", "6-8", "8-10", "10-12", "12-15", "15-20"];
export const RPE_QUICK = ["6", "7", "7.5", "8", "8.5", "9", "10"];
export const RIR_QUICK = ["0", "1", "2", "3", "4"];

/** "3 × 8-10 · RPE 8 · 2:00 rest" for a program saved before plans (week 1's days). */
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
 * for a new one): a copy made from an older version is never offered. v2
 * holds the whole plan; a v1 copy (one week of days) is read as that week
 * repeated.
 */
export type DraftBackup = { v: 2; base: string | null; savedAt: number; draft: ProgramDraft };

export const DRAFT_BACKUP_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export const draftBackupKey = (userId: string, programId: string | null | undefined) =>
  `jf.program-draft.v1:${userId}:${programId || "new"}`;

/** The kept draft if it can be picked up again, else null. */
export function usableBackup(raw: unknown, base: string | null, now: number): ProgramDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as { v?: number; base?: string | null; savedAt?: number; draft?: any };
  if ((b.v !== 1 && b.v !== 2) || (b.base ?? null) !== base) return null;
  if (typeof b.savedAt !== "number" || now - b.savedAt > DRAFT_BACKUP_MAX_AGE_MS) return null;
  const d = b.draft;
  if (!d || typeof d.title !== "string") return null;
  let plan = null;
  if (b.v === 2) plan = normalizePlan(d.plan);
  else if (Array.isArray(d.days) && d.days.length <= 7) {
    const ok = d.days.every(
      (day: any) =>
        day && typeof day.title === "string" && Array.isArray(day.exercises) &&
        day.exercises.every((e: any) => e && typeof e.exercise_id === "string"),
    );
    if (ok) plan = planFromDays(d.days, Number(d.weeks) || 1);
  }
  if (!plan) return null;
  return {
    id: d.id ?? null,
    title: d.title,
    description: typeof d.description === "string" ? d.description : "",
    goal: d.goal ?? null,
    level: d.level ?? null,
    plan,
  };
}

/** Whether two drafts would save the same program (keys and names from the library don't count). */
export function sameDraft(a: ProgramDraft, b: ProgramDraft): boolean {
  return (
    a.title === b.title &&
    a.description === b.description &&
    (a.goal ?? null) === (b.goal ?? null) &&
    (a.level ?? null) === (b.level ?? null) &&
    samePlan(a.plan, b.plan)
  );
}
