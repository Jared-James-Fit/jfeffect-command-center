/**
 * Cardio activity/mode presentation layer.
 *
 * The database keeps its historical `cardio_type` strings ("Outdoor Walking",
 * "Incline Treadmill Walk", "Incline Walking", …) so analytics, schedule sync
 * and every existing log stay valid. This module is the ONLY place that turns
 * those strings into the simple client mental model:
 *
 *   Walk · Treadmill      Walk · Outdoor      Bike      Stair Climber …
 *
 * Nothing here writes to the database; it is pure presentation + the canonical
 * storage value to use when a coach picks Activity + Mode.
 */

export type CardioMode = "treadmill" | "outdoor";

export type CardioActivityView = {
  /** Client-facing primary activity, e.g. "Walk" or "Bike". */
  activity: string;
  /** Only present for walking prescriptions. */
  mode: CardioMode | null;
  modeLabel: string | null;
  isWalk: boolean;
  isTreadmill: boolean;
};

export const CARDIO_ACTIVITY_OPTIONS = [
  { label: "Walk", value: "Walk" },
  { label: "Bike", value: "Bike" },
  { label: "Stair Climber", value: "Stairmaster" },
  { label: "Elliptical", value: "Elliptical" },
  { label: "Rowing", value: "Rowing" },
  { label: "Custom", value: "Custom" },
] as const;

export const CARDIO_MODE_OPTIONS = [
  { label: "Treadmill", value: "treadmill" },
  { label: "Outdoor", value: "outdoor" },
] as const;

/** Canonical stored `cardio_type` for a Walk in a given mode (legacy-compatible). */
export const WALK_STORAGE: Record<CardioMode, string> = {
  treadmill: "Incline Treadmill Walk",
  outdoor: "Outdoor Walking",
};

export function isWalkingType(cardioType?: string | null): boolean {
  return /walk/i.test(String(cardioType ?? ""));
}

/**
 * Normalize any stored cardio type (historic or new) into activity + mode.
 * Never mutates or rewrites stored data.
 */
export function resolveCardioActivity(target: {
  cardio_type?: string | null;
  custom_type?: string | null;
  machine_preference?: string | null;
}): CardioActivityView {
  const raw = String(target.cardio_type ?? "").trim();
  const lower = raw.toLowerCase();
  const machine = String(target.machine_preference ?? "").toLowerCase();

  if (isWalkingType(raw)) {
    let mode: CardioMode | null = null;
    if (/treadmill|incline/.test(lower) || /treadmill/.test(machine)) mode = "treadmill";
    else if (/outdoor|outside/.test(lower)) mode = "outdoor";
    return {
      activity: "Walk",
      mode,
      modeLabel: mode === "treadmill" ? "Treadmill" : mode === "outdoor" ? "Outdoor" : null,
      isWalk: true,
      isTreadmill: mode === "treadmill",
    };
  }

  const activity = lower === "custom"
    ? (target.custom_type?.trim() || "Custom")
    : lower === "stairmaster" || lower === "stairs"
      ? "Stair Climber"
      : raw || "Cardio";

  return { activity, mode: null, modeLabel: null, isWalk: false, isTreadmill: false };
}

/** "Walk · Treadmill" / "Bike" — for compact contexts such as logs and analytics rows. */
export function cardioActivityLabel(target: Parameters<typeof resolveCardioActivity>[0]): string {
  const v = resolveCardioActivity(target);
  return v.modeLabel ? `${v.activity} · ${v.modeLabel}` : v.activity;
}

/** Which builder Activity option a stored type maps to. */
export function activityOptionValue(cardioType?: string | null, customType?: string | null): string {
  if (isWalkingType(cardioType)) return "Walk";
  const lower = String(cardioType ?? "").toLowerCase();
  if (lower === "stairs" || lower === "stairmaster") return "Stairmaster";
  const match = CARDIO_ACTIVITY_OPTIONS.find((o) => o.value.toLowerCase() === lower);
  return match ? match.value : (cardioType ? "Custom" : "Walk");
}

export function formatSpeedRange(
  minMph?: number | null,
  maxMph?: number | null,
  unit: "mph" | "kph" = "mph",
): string | null {
  const lo = Number(minMph);
  const hi = Number(maxMph);
  const hasLo = Number.isFinite(lo) && lo > 0;
  const hasHi = Number.isFinite(hi) && hi > 0;
  if (!hasLo && !hasHi) return null;
  const conv = (v: number) => (unit === "kph" ? Math.round(v * 1.60934 * 10) / 10 : v);
  const suffix = unit === "kph" ? "km/h" : "mph";
  if (hasLo && hasHi && lo !== hi) return `${conv(lo)}–${conv(hi)} ${suffix}`;
  return `${conv(hasLo ? lo : hi)} ${suffix}`;
}

/** The one-line "finish when you reach any one" target list. */
export function completionTargetParts(input: {
  duration_minutes?: number | null;
  steps?: number | null;
  calories?: number | null;
  showCalories?: boolean;
}): string[] {
  const parts: string[] = [];
  if (Number(input.duration_minutes) > 0) parts.push(`${Number(input.duration_minutes)} min`);
  if (Number(input.steps) > 0) parts.push(`${Number(input.steps).toLocaleString()} steps`);
  if (input.showCalories !== false && Number(input.calories) > 0) parts.push(`~${Number(input.calories)} kcal`);
  return parts;
}

/** The session's name in plain words: "Treadmill walk", "Outdoor walk", "Bike". */
export function cardioSessionTitle(view: CardioActivityView): string {
  if (view.isWalk) {
    if (view.mode === "treadmill") return "Treadmill walk";
    if (view.mode === "outdoor") return "Outdoor walk";
    return "Walk";
  }
  return view.activity;
}

/**
 * What to do, in one line's parts: the time, the treadmill's incline and speed
 * (mph, then km/h), then the effort and heart-rate zone, each said once (a
 * coach who wrote "Zone 2" in both fields gets one "Zone 2").
 */
export function cardioSpecParts(
  target: {
    duration_minutes?: number | null;
    incline?: number | null;
    speed_min_mph?: number | null;
    speed_max_mph?: number | null;
    intensity?: string | null;
    heart_rate_zone?: string | null;
  },
  view: Pick<CardioActivityView, "isTreadmill">,
): string[] {
  const parts: string[] = [];
  if (Number(target.duration_minutes) > 0) parts.push(`${Number(target.duration_minutes)} min`);
  if (view.isTreadmill && Number(target.incline) > 0) parts.push(`${Number(target.incline)}% incline`);
  const mph = view.isTreadmill ? formatSpeedRange(target.speed_min_mph, target.speed_max_mph) : null;
  if (mph) {
    const kph = formatSpeedRange(target.speed_min_mph, target.speed_max_mph, "kph");
    parts.push(kph ? `${mph} (${kph})` : mph);
  }
  const effort = String(target.intensity ?? "").trim();
  const zone = String(target.heart_rate_zone ?? "").trim();
  const norm = (v: string) => v.toLowerCase().replace(/\s+/g, " ");
  if (effort && zone && (norm(effort).includes(norm(zone)) || norm(zone).includes(norm(effort)))) {
    // "Zone 2" in both fields, or "Zone 2" beside "Zone 2 (easy)": the longer one says both
    parts.push(effort.length >= zone.length ? effort : zone);
  } else {
    if (effort) parts.push(effort);
    if (zone) parts.push(zone);
  }
  return parts;
}
