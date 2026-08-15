/**
 * Canonical exercise taxonomy shared by every creation/edit surface.
 *
 * These are the exact legacy string values already stored in
 * `public.exercises.category` / `.primary_muscle_group` and consumed by
 * analytics (muscle map, volume, category breakdowns), filtering and
 * Quick Swap. Do NOT rename or re-key them — analytics matches on value.
 */
export const EXERCISE_CATEGORIES = [
  "Squat", "Bench", "Deadlift", "Upper Body", "Lower Body", "Back",
  "Chest", "Shoulders", "Arms", "Glutes", "Core", "Mobility",
  "Warm-Ups", "Powerlifting", "Bodybuilding", "Cardio",
] as const;

export const PRIMARY_MUSCLE_GROUPS = [
  "Chest","Lats","Upper Back","Traps","Front Delts","Side Delts","Rear Delts",
  "Biceps","Triceps","Forearms","Quads","Hamstrings","Glutes","Adductors",
  "Calves","Abs/Core","Lower Back","Other",
] as const;

export const EQUIPMENT_OPTIONS = [
  "Barbell","Dumbbell","Machine","Cable","Smith Machine","Kettlebell",
  "Bodyweight","Bands","Bench","Other",
] as const;

/** Safe default kept for legacy consumers (library grouping / swap card). */
export const DEFAULT_EXERCISE_DIFFICULTY = "Intermediate";
