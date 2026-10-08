/**
 * The name shown for a program exercise row, everywhere.
 *
 * A linked row always shows the standardized library name. The typed-in
 * `exercise_name_override` is only a fallback for a row that has no library
 * link, so renaming/standardizing an exercise in the library updates every
 * program that uses it.
 */
export function displayExerciseName(
  row: {
    exercises?: { name?: string | null } | null;
    exercise_name_override?: string | null;
  } | null | undefined,
  fallback = "Exercise",
): string {
  const linked = row?.exercises?.name?.trim();
  if (linked) return linked;
  const typed = row?.exercise_name_override?.trim();
  return typed || fallback;
}
