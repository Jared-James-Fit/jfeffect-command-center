// Shared constants + zod schema for the client Goals & Setup section.
import { z } from "zod";

export const MAIN_GOALS = [
  "Lose body fat",
  "Build muscle",
  "Build glutes",
  "Get stronger",
  "Powerlifting",
  "Prepare for a competition",
  "Improve general fitness",
  "Body recomposition",
  "Other",
] as const;

export const TRAINING_DAYS = [2, 3, 4, 5, 6] as const;

export const WEEKDAYS = ["mon","tue","wed","thu","fri","sat","sun"] as const;
export const WEEKDAY_LABELS: Record<typeof WEEKDAYS[number], string> = {
  mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday",
  fri: "Friday", sat: "Saturday", sun: "Sunday",
};

export const WORKOUT_LENGTHS = [30, 45, 60, 75, 90] as const;

export const EXPERIENCE_LEVELS = [
  "Beginner",
  "Less than 1 year",
  "1–3 years",
  "3–5 years",
  "More than 5 years",
] as const;

export const TRAINING_STYLES = [
  "General fitness",
  "Bodybuilding",
  "Powerlifting",
  "Glute-focused",
  "Strength",
  "At-home workouts",
  "Coach can decide",
] as const;

export const TRAINING_LOCATIONS = [
  "Commercial gym",
  "Powerlifting gym",
  "Home gym",
  "At home with limited equipment",
  "Apartment gym",
  "Multiple locations",
] as const;

export const EQUIPMENT_OPTIONS = [
  "All of it",
  "Barbell",
  "Squat rack",
  "Bench",
  "Dumbbells",
  "Adjustable dumbbells",
  "Machines",
  "Cable station",
  "Smith machine",
  "Leg press",
  "Leg extension",
  "Leg curl",
  "Lat pulldown",
  "Seated row",
  "Hip thrust or glute machine",
  "Resistance bands",
  "Pull-up bar",
  "Cardio equipment",
  "Bodyweight only",
  "No equipment",
  "Not sure",
  "Other",
] as const;

export const NUTRITION_GOALS = [
  "Lose body fat",
  "Build muscle",
  "Maintain weight",
  "Improve performance",
  "Improve consistency",
  "Not sure",
] as const;

export const NUTRITION_PREFS = [
  "Calories and macros",
  "Calories only",
  "Protein and portions",
  "Meal structure",
  "Habit-based coaching",
  "Meal plan",
  "Not sure",
] as const;

export const NUTRITION_CHALLENGES = [
  "Hunger",
  "Cravings",
  "Lack of time",
  "Meal preparation",
  "Eating out",
  "Weekends",
  "Skipping meals",
  "Portion sizes",
  "Hitting protein",
  "Tracking consistently",
  "Travel",
  "Shift work",
  "Other",
] as const;

export const NUTRITION_CHALLENGES_MAX = 3;

export const clientGoalsSetupSchema = z.object({
  main_goal: z.string().max(80).nullable().optional(),
  main_goal_other: z.string().trim().max(200).nullable().optional(),
  goal_target: z.string().trim().max(400).nullable().optional(),

  training_days_per_week: z.number().int().min(1).max(7).nullable().optional(),
  available_weekdays: z.array(z.enum(WEEKDAYS)).max(7).nullable().optional(),
  workout_length_minutes: z.number().int().min(5).max(240).nullable().optional(),

  training_experience: z.string().max(80).nullable().optional(),
  training_styles: z.array(z.string().max(80)).max(20).nullable().optional(),

  training_location: z.string().max(80).nullable().optional(),
  equipment: z.array(z.string().max(80)).max(40).nullable().optional(),
  equipment_by_location: z.record(z.string().max(80), z.array(z.string().max(80)).max(40)).nullable().optional(),

  nutrition_goal: z.string().max(80).nullable().optional(),
  nutrition_preference: z.string().max(80).nullable().optional(),
  food_restrictions_has: z.boolean().optional(),
  food_restrictions_details: z.string().trim().max(800).nullable().optional(),
  nutrition_challenges: z.array(z.string().max(80)).max(NUTRITION_CHALLENGES_MAX).nullable().optional(),

  injuries_has: z.boolean().optional(),
  injuries_details: z.string().trim().max(2000).nullable().optional(),

  final_notes: z.string().trim().max(2000).nullable().optional(),

  completed_at: z.string().nullable().optional(),
});

/**
 * Whitelist of client-editable column names for `client_goals_setup`.
 * Everything else (id, client_id, timestamps, review/audit fields) must be
 * stripped before sending to the server so we never accidentally overwrite
 * server-owned data and never trip "unknown column" errors.
 */
export const EDITABLE_GOALS_FIELDS = [
  "main_goal",
  "main_goal_other",
  "goal_target",
  "training_days_per_week",
  "available_weekdays",
  "workout_length_minutes",
  "training_experience",
  "training_styles",
  "training_location",
  "equipment",
  "equipment_by_location",
  "nutrition_goal",
  "nutrition_preference",
  "food_restrictions_has",
  "food_restrictions_details",
  "nutrition_challenges",
  "injuries_has",
  "injuries_details",
  "final_notes",
] as const;

export type ClientGoalsSetupPatch = z.infer<typeof clientGoalsSetupSchema>;

export type ClientGoalsSetupRow = {
  id: string;
  client_id: string;
  main_goal: string | null;
  main_goal_other: string | null;
  goal_target: string | null;
  training_days_per_week: number | null;
  available_weekdays: string[];
  workout_length_minutes: number | null;
  training_experience: string | null;
  training_styles: string[];
  training_location: string | null;
  equipment: string[];
  equipment_by_location: Record<string, string[]>;
  nutrition_goal: string | null;
  nutrition_preference: string | null;
  food_restrictions_has: boolean;
  food_restrictions_details: string | null;
  nutrition_challenges: string[];
  injuries_has: boolean;
  injuries_details: string | null;
  final_notes: string | null;
  completed_at: string | null;
  last_reviewed_at: string | null;
  last_reviewed_by: string | null;
  update_requested_at: string | null;
  update_requested_by: string | null;
  update_request_message: string | null;
  created_at: string;
  updated_at: string;
};

/** Human label for an audit field key. */
export const FIELD_LABELS: Record<string, string> = {
  main_goal: "Main goal",
  main_goal_other: "Main goal (other)",
  goal_target: "Goal / target / deadline",
  training_days_per_week: "Training days per week",
  available_weekdays: "Available weekdays",
  workout_length_minutes: "Workout length",
  training_experience: "Training experience",
  training_styles: "Training styles",
  training_location: "Training location",
  equipment: "Equipment",
  equipment_by_location: "Equipment by location",
  nutrition_goal: "Nutrition goal",
  nutrition_preference: "Nutrition preference",
  food_restrictions_has: "Food allergies / intolerances",
  food_restrictions_details: "Food allergy details",
  nutrition_challenges: "Nutrition challenges",
  injuries_has: "Injuries / limitations",
  injuries_details: "Injury details",
  final_notes: "Final notes",
};

/** Returns whether the row has the minimum required fields filled in. */
export function isGoalsSetupComplete(row: ClientGoalsSetupRow | null | undefined): boolean {
  if (!row) return false;
  return Boolean(
    row.main_goal &&
    row.training_days_per_week &&
    row.workout_length_minutes &&
    row.training_experience &&
    row.training_location &&
    row.nutrition_goal,
  );
}