import { todayLocalISO } from "@/lib/today";
export const NUTRITION_PHASES = [
  "Fat Loss",
  "Muscle Gain",
  "Maintenance",
  "Performance",
  "Lifestyle Reset",
  "Reverse Diet",
  "Recomp",
  "Custom",
] as const;

export const NUTRITION_GOALS = [
  "Lose body fat",
  "Build muscle",
  "Maintain bodyweight",
  "Improve performance",
  "Improve consistency",
  "Improve health habits",
  "Custom",
] as const;

export const NUTRITION_STRUCTURES = [
  "Same Every Day",
  "Training / Rest",
  "High / Low",
  "Training / Rest / High",
  "Custom",
] as const;

export function dayLabelsForStructure(s: string): string[] {
  switch (s) {
    case "Same Every Day":
      return ["Daily"];
    case "Training / Rest":
      return ["Training Day", "Rest Day"];
    case "High / Low":
      return ["High Day", "Low Day"];
    case "Training / Rest / High":
      return ["Training Day", "Rest Day", "High Day"];
    default:
      return ["Day 1"];
  }
}

export const CARDIO_TYPES = [
  "Treadmill",
  "Incline Walking",
  "Bike",
  "Stairmaster",
  "Elliptical",
  "Outdoor Walking",
  "Running",
  "Rowing",
  "Sled",
  "Custom",
] as const;

export const CARDIO_INTENSITIES = [
  "Zone 2",
  "Low Intensity",
  "Moderate Intensity",
  "High Intensity",
  "Steps Only",
  "Custom",
] as const;

// Calories-per-minute ranges by intensity (coaching-friendly estimates)
const INTENSITY_CPM: Record<string, [number, number]> = {
  "Low Intensity": [4, 6],
  "Easy": [4, 6],
  "Zone 2": [6, 8],
  "Moderate Intensity": [6, 8],
  "High Intensity": [8, 10],
  "Hard": [8, 10],
  "HIIT": [10, 12],
  "Very Hard": [10, 12],
  "Steps Only": [3, 5],
};

export function estimateCalorieRange(
  durationMinutes: number | null | undefined,
  intensity: string | null | undefined,
): { min: number; max: number } | null {
  if (!durationMinutes || durationMinutes <= 0) return null;
  const cpm = INTENSITY_CPM[intensity ?? ""] ?? [5, 7];
  return { min: Math.round(durationMinutes * cpm[0]), max: Math.round(durationMinutes * cpm[1]) };
}

export function formatCalorieTarget(min?: number | null, max?: number | null): string | null {
  if (min == null && max == null) return null;
  if (min != null && max != null && min !== max) return `~${min}–${max} cal`;
  return `~${min ?? max} cal`;
}

export const TARGET_STATUSES = [
  "Active",
  "Ending Soon",
  "Due Today",
  "Past Due",
  "Archived",
] as const;

export type TargetRow = {
  id: string;
  client_id: string;
  start_date: string;
  end_date: string | null;
  status: string;
  ending_soon_days: number;
};

export type DerivedTargetState = {
  state: "active" | "ending-soon" | "due-today" | "past-due" | "archived" | "upcoming";
  label: string;
  tone: string;
  daysRemaining: number;
};

function daysBetween(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

export function deriveTarget(t: TargetRow): DerivedTargetState {
  if (t.status === "Archived") {
    return { state: "archived", label: "Archived", tone: "border-border bg-secondary/40 text-muted-foreground", daysRemaining: 0 };
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (t.end_date) {
    const end = new Date(t.end_date + "T00:00:00");
    const days = daysBetween(today, end);
    if (days < 0) return { state: "past-due", label: "Past Due", tone: "border-destructive/40 bg-destructive/10 text-destructive", daysRemaining: days };
    if (days === 0) return { state: "due-today", label: "Due Today", tone: "border-destructive/40 bg-destructive/10 text-destructive", daysRemaining: 0 };
    if (days <= (t.ending_soon_days ?? 7)) return { state: "ending-soon", label: "Ending Soon", tone: "border-warning/40 bg-warning/10 text-warning", daysRemaining: days };
  }
  const start = new Date(t.start_date + "T00:00:00");
  if (start.getTime() > today.getTime()) {
    return { state: "upcoming", label: "Upcoming", tone: "border-primary/40 bg-primary/10 text-primary", daysRemaining: daysBetween(today, start) };
  }
  return { state: "active", label: "Active", tone: "border-success/40 bg-success/10 text-success", daysRemaining: t.end_date ? daysBetween(today, new Date(t.end_date + "T00:00:00")) : 0 };
}

// ============================================================
// Default cardio presets + nutrition day-type sync helpers
// ============================================================

export type CardioPreset = {
  day_type: "Training Day" | "Rest Day" | "High Day";
  /** Friendly label shown in the defaults UI only — storage uses `day_type`. */
  display_label: string;
  cardio_type: string;
  duration_minutes: number;
  intensity: string;
  frequency_per_week: number;
  calorie_target_min: number | null;
  calorie_target_max: number | null;
  client_notes: string;
};

export const DEFAULT_CARDIO_PRESETS: CardioPreset[] = [
  {
    day_type: "Training Day",
    display_label: "Training Day",
    cardio_type: "Incline Walking",
    duration_minutes: 25,
    intensity: "Zone 2",
    frequency_per_week: 4,
    calorie_target_min: 150,
    calorie_target_max: 200,
    client_notes: "Steady incline walk after lifting. Keep heart rate in Zone 2.",
  },
  {
    day_type: "Rest Day",
    display_label: "Non-Training Day",
    cardio_type: "Outdoor Walking",
    duration_minutes: 25,
    intensity: "Low Intensity",
    frequency_per_week: 3,
    calorie_target_min: null,
    calorie_target_max: null,
    client_notes: "Easy outdoor walk. Aim for daily steps, low fatigue.",
  },
  {
    day_type: "High Day",
    display_label: "High Day",
    cardio_type: "Outdoor Walking",
    duration_minutes: 20,
    intensity: "Low Intensity",
    frequency_per_week: 2,
    calorie_target_min: null,
    calorie_target_max: null,
    client_notes: "Optional light walk. Keep fatigue low.",
  },
];

export function presetToRow(preset: CardioPreset, clientId: string): Record<string, any> {
  const today = todayLocalISO();
  return {
    client_id: clientId,
    day_type: preset.day_type,
    custom_day_type: null,
    cardio_type: preset.cardio_type,
    custom_type: null,
    intensity: preset.intensity,
    frequency_per_week: preset.frequency_per_week,
    duration_minutes: preset.duration_minutes,
    calorie_target_min: preset.calorie_target_min,
    calorie_target_max: preset.calorie_target_max,
    show_calories_to_client: preset.calorie_target_min != null,
    client_notes: preset.client_notes,
    start_date: today,
    status: "Active",
    enabled: true,
    visible_to_client: true,
    program_name: null,
    last_updated_at: new Date().toISOString(),
  };
}

/** A cardio row is the "default" for its day type when it has no program_name. */
export function findDefaultFor(rows: any[], dayType: string): any | undefined {
  return rows.find((r) => r.day_type === dayType && !r.program_name);
}

/** Returns the set of distinct day labels from a client's most recent active nutrition target. */
export function nutritionLabelsFromTargets(targets: any[]): string[] {
  const active = (targets ?? []).find((t) => t.status !== "Archived") ?? targets?.[0];
  if (!active) return [];
  const labels = (active.nutrition_target_days ?? []).map((d: any) => d.day_label).filter(Boolean);
  return Array.from(new Set<string>(labels));
}

/** Cardio targets whose day_type doesn't appear in the current nutrition labels. */
export function findOrphanedCardio(rows: any[], nutritionLabels: string[]): any[] {
  if (!nutritionLabels.length) return [];
  const allowed = new Set<string>([...nutritionLabels, "General", "Custom"]);
  return rows.filter((r) => r.enabled !== false && !allowed.has(r.day_type));
}