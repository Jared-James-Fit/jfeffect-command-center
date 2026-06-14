// Helpers for client Basic Information: age, height conversions, completion.

export type HeightUnit = "imperial" | "metric";

export function calcAge(dob: string | null | undefined, ref: Date = new Date()): number | null {
  if (!dob) return null;
  const d = new Date(dob + "T00:00:00");
  if (isNaN(d.getTime())) return null;
  let age = ref.getFullYear() - d.getFullYear();
  const m = ref.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && ref.getDate() < d.getDate())) age--;
  return age;
}

export function cmToFtIn(cm: number | null | undefined): { ft: number; inch: number } | null {
  if (cm == null || isNaN(Number(cm))) return null;
  const totalIn = Number(cm) / 2.54;
  const ft = Math.floor(totalIn / 12);
  const inch = Math.round(totalIn - ft * 12);
  if (inch === 12) return { ft: ft + 1, inch: 0 };
  return { ft, inch };
}

export function ftInToCm(ft: number, inch: number): number {
  return Math.round(((ft * 12 + inch) * 2.54) * 10) / 10;
}

export function formatHeight(cm: number | null | undefined, unit: HeightUnit = "imperial"): string {
  if (cm == null) return "—";
  if (unit === "metric") return `${Math.round(Number(cm))} cm`;
  const v = cmToFtIn(cm);
  if (!v) return "—";
  return `${v.ft} ft ${v.inch} in`;
}

// Required fields for "Basic Info complete".
export const REQUIRED_BASIC_INFO_FIELDS = [
  "first_name",
  "last_name",
  "phone",
  "date_of_birth",
  "height_cm",
  "address",
  "city",
  "country",
  "timezone",
  "emergency_contact_name",
  "emergency_contact_phone",
] as const;

export function isBasicInfoComplete(c: Record<string, any> | null | undefined): boolean {
  if (!c) return false;
  const baseOk = REQUIRED_BASIC_INFO_FIELDS.every((f) => {
    const v = c[f];
    return v !== null && v !== undefined && String(v).trim() !== "";
  });
  if (!baseOk) return false;
  // Intake SBD: either "I don't know" (false) or all three values + unit.
  return isIntakeLiftsComplete(c);
}

export function isIntakeLiftsComplete(c: Record<string, any> | null | undefined): boolean {
  if (!c) return false;
  if (c.intake_lifts_known === false) return true;
  const unit = c.intake_lift_unit;
  return (
    (unit === "kg" || unit === "lb") &&
    Number(c.intake_squat_1rm) > 0 &&
    Number(c.intake_bench_1rm) > 0 &&
    Number(c.intake_deadlift_1rm) > 0
  );
}

// Strength standards (approximate male intermediate, kg) used as quick guidance
// in the intake form. Conversions to lb happen at render time.
export const SBD_GUIDANCE_KG = {
  squat: { beginner: 60, intermediate: 100, advanced: 140, elite: 180 },
  bench: { beginner: 40, intermediate: 75, advanced: 110, elite: 140 },
  deadlift: { beginner: 80, intermediate: 120, advanced: 170, elite: 220 },
} as const;

// Days until next birthday (0 = today). Returns null if no DOB.
export function daysUntilBirthday(dob: string | null | undefined, ref: Date = new Date()): number | null {
  if (!dob) return null;
  const d = new Date(dob + "T00:00:00");
  if (isNaN(d.getTime())) return null;
  const today = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  let next = new Date(today.getFullYear(), d.getMonth(), d.getDate());
  if (next < today) next = new Date(today.getFullYear() + 1, d.getMonth(), d.getDate());
  return Math.round((next.getTime() - today.getTime()) / 86_400_000);
}

export function formatBirthdayShort(dob: string): string {
  const d = new Date(dob + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "long", day: "numeric" });
}