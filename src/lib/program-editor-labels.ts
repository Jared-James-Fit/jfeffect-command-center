import { deriveWeeklyPurposeLabelByRowId } from "@/lib/exercise-metadata";

/**
 * A program editor week's purpose labels (Primary, Secondary… for the
 * competition lifts and their variations, else Assistance), one list per day
 * in row order, read across the whole week.
 *
 * The builder's rows carry no `id` (a saved row's is `_dbId`, a new one has
 * none), so each row is keyed by where it sits. Keyed by `id`, every label
 * came back empty and every exercise read "Assistance", Competition Squat
 * included.
 */
export function weekPurposeLabelsByDay(days: any[], exercises: any[]): string[][] {
  const exerciseById = new Map<string, any>((exercises ?? []).map((exercise: any) => [exercise.id, exercise]));
  const keyed = days.map((day: any, di: number) => {
    const scheduled = day?.scheduled_date ? Date.parse(day.scheduled_date) : Number.NaN;
    return {
      order: Number.isFinite(scheduled) ? scheduled : day?.day_index ?? day?.sort_order ?? di,
      rows: ((day?.rows ?? []) as any[]).map((row: any, ri: number) => ({ ...row, id: `${di}:${ri}`, sort_order: ri })),
    };
  });
  const byKey = deriveWeeklyPurposeLabelByRowId(keyed, (row: any) => (row.exercise_id ? exerciseById.get(row.exercise_id) : null));
  return days.map((day: any, di: number) =>
    ((day?.rows ?? []) as any[]).map((_: any, ri: number) => byKey.get(`${di}:${ri}`) ?? "Assistance"),
  );
}
