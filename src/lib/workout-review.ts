/**
 * Quick post-workout review — the signals that actually predict recovery,
 * in as few taps as possible:
 *   • Effort  — session RPE (Foster sRPE), the one required tap
 *   • Pain    — no/yes; yes asks where + how bad
 *   • Sleep   — hours the night before: <5h / 5–6h / 6–7h / 7–8h / 8h+
 *   • Energy  — how recovered they felt going in (recovery_today, 1–5)
 *
 * Nothing is pre-selected. Effort used to be pre-filled from logged set RPEs,
 * but recovery-score trusts a v2 session RPE *over* the set average because
 * it is the athlete's own read of the whole session; a pre-fill they just
 * accept is the set average wearing that label. Skipped sleep/energy stay
 * null (neutral in readiness); skipped pain is stored as false ("none
 * reported") because pl_workout_feedback.pain is NOT NULL.
 *
 * v1 asked "Feeling Good / Minor Issue / Need Attention" and wrote fake session
 * RPEs (5/7/8) from that choice; 75% of ratings were 5/5, so it carried almost
 * no signal. v2 rows are marked review_version = 2 so analytics only trust
 * their session_rpe.
 */

import type { SleepBucket } from "@/lib/analytics/recovery-score";

export const REVIEW_VERSION = 2;

/**
 * Session effort, shown as words: "6 7 8 9 10" read to clients like a 1–10
 * scale with half of it missing. `v` is the session_rpe stored, picked so each
 * word lands in the matching recovery-score bucket (easy <6, moderate 6–7,
 * hard 8, very hard 9+).
 */
export const EFFORT_OPTIONS: { v: number; label: string }[] = [
  { v: 5, label: "Easy" },
  { v: 7, label: "Moderate" },
  { v: 8, label: "Hard" },
  { v: 9, label: "Very hard" },
  { v: 10, label: "Max" },
];

/** The chip a stored session RPE lights up (earlier reviews stored "Easy" as 6). */
export function effortChip(v: number | null | undefined): number | null {
  if (v == null) return null;
  return v <= 6 ? 5 : v;
}

/**
 * Where it hurts, head to toe, three across in the review. Neck, Upper back,
 * Chest, Hamstring and Calf / ankle came from what "Other" was used for (Nov
 * 2026: 5 of the last 11 "Other" reports were the neck, then mid back, chest,
 * adductor, calf); the note covers anything else.
 */
export const PAIN_AREAS = [
  "Neck", "Shoulder", "Upper back",
  "Chest", "Elbow", "Wrist",
  "Low back", "Hip / groin", "Hamstring",
  "Knee", "Calf / ankle", "Other",
] as const;

/** Areas that come in pairs; these get an optional Left / Right / Both pick. */
export const SIDED_PAIN_AREAS: readonly string[] = [
  "Shoulder", "Chest", "Elbow", "Wrist", "Hip / groin", "Hamstring", "Knee", "Calf / ankle",
];
export type PainSide = "L" | "R" | "both";
export const PAIN_SIDES: { v: PainSide; label: string }[] = [
  { v: "L", label: "Left" },
  { v: "R", label: "Right" },
  { v: "both", label: "Both" },
];

/** One place that hurts, as picked in the review. */
export type PainPick = { area: string; side: PainSide | null };

/**
 * pain_area is free text shown to the coach as-is, so the side is written into
 * it in the format the earlier review sheet used: "Shoulder (R)", and both
 * sides as "Shoulder (L), Shoulder (R)". No side → just "Shoulder".
 */
export function composePainArea(area: string, side: PainSide | null): string {
  if (!side || !SIDED_PAIN_AREAS.includes(area)) return area;
  return side === "both" ? `${area} (L), ${area} (R)` : `${area} (${side})`;
}

const AREA_ORDER = new Map<string, number>(PAIN_AREAS.map((a, i) => [a, i]));

/**
 * Several places are one ", " list (the earlier sheet stored them the same
 * way): head to toe, then anything written that isn't a chip, as written.
 * Nothing picked → null.
 */
export function composePainAreas(picks: PainPick[], other: string[] = []): string | null {
  const seen = new Set<string>();
  const parts = [...picks]
    .filter((p) => !seen.has(p.area) && seen.add(p.area))
    .sort((a, b) => (AREA_ORDER.get(a.area) ?? 99) - (AREA_ORDER.get(b.area) ?? 99))
    .map((p) => composePainArea(p.area, p.side));
  for (const o of other) if (o.trim() && !parts.includes(o.trim())) parts.push(o.trim());
  return parts.length ? parts.join(", ") : null;
}

/** Earlier names for a chip: the old sheet's "Lower back", "Ankle/foot", "Hip". */
const AREA_ALIASES: Record<string, string> = {
  ...Object.fromEntries(PAIN_AREAS.map((a) => [a.toLowerCase(), a])),
  "lower back": "Low back",
  "mid back": "Upper back",
  hip: "Hip / groin",
  groin: "Hip / groin",
  "ankle/foot": "Calf / ankle",
  ankle: "Calf / ankle",
  calf: "Calf / ankle",
};

/** A stored pain_area split into its places, each with its side ("Knee (L), Knee (R)" = both knees). */
function painPlaces(stored: string | null | undefined): { name: string; side: PainSide | null; raw: string[] }[] {
  const out = new Map<string, { name: string; l: boolean; r: boolean; plain: boolean; raw: string[] }>();
  for (const token of (stored ?? "").split(",")) {
    const t = token.trim();
    if (!t) continue;
    const m = /^(.+?)\s*\((L|R)\)$/.exec(t);
    const name = (m ? m[1] : t).trim();
    const key = name.toLowerCase();
    const cur = out.get(key) ?? { name, l: false, r: false, plain: false, raw: [] };
    if (m?.[2] === "L") cur.l = true;
    else if (m?.[2] === "R") cur.r = true;
    else cur.plain = true;
    cur.raw.push(t);
    out.set(key, cur);
  }
  return [...out.values()].map((p) => ({
    name: p.name,
    side: p.l && p.r ? "both" : p.l ? "L" : p.r ? "R" : null,
    raw: p.raw,
  }));
}

/**
 * Read a stored pain_area back into the review's chips + sides. Anything that
 * isn't a chip ("General" from the first review) stays as written in `other`.
 */
export function parsePainAreas(stored: string | null | undefined): { picks: PainPick[]; other: string[] } {
  const picks: PainPick[] = [];
  const other: string[] = [];
  for (const p of painPlaces(stored)) {
    const area = AREA_ALIASES[p.name.toLowerCase()];
    // a side written on a place that has none ("Low back (R)") stays as written
    if (!area || (p.side && !SIDED_PAIN_AREAS.includes(area))) other.push(...p.raw);
    else if (!picks.some((x) => x.area === area)) picks.push({ area, side: p.side });
  }
  return { picks, other };
}

/** "Both knees", "Chest (both sides)": a plural only where it reads as one. */
function bothSides(name: string): string {
  const a = name.toLowerCase();
  if (/^[a-z]+$/.test(a) && a !== "chest") return `Both ${a.endsWith("s") ? a : `${a}s`}`;
  return `${name} (both sides)`;
}

/** Each place in words: ["Neck", "Right shoulder", "Both knees"]; anything else as written. */
export function painAreaParts(stored: string | null | undefined): string[] {
  return painPlaces(stored).map((p) =>
    p.side === "L" ? `Left ${p.name.toLowerCase()}`
    : p.side === "R" ? `Right ${p.name.toLowerCase()}`
    : p.side === "both" ? bothSides(p.name)
    : p.name,
  );
}

/** The places without their sides, by chip where there is one ("low back", "shoulder"), for counting. */
export function painAreaNames(stored: string | null | undefined): string[] {
  const names = painPlaces(stored).map((p) => (AREA_ALIASES[p.name.toLowerCase()] ?? p.name).toLowerCase());
  return [...new Set(names)];
}

export const PAIN_SEVERITY: { v: number; label: string }[] = [
  { v: 3, label: "Mild" },
  { v: 5, label: "Moderate" },
  { v: 8, label: "Sharp" },
];

/**
 * overall_rating is NOT NULL in the schema and still shown to coaches, so v2
 * derives it from the real answers instead of asking another question.
 */
export function deriveOverallRating(input: {
  pain: boolean;
  sessionRpe: number;
  recoveryToday: number | null;
}): number {
  if (input.pain) return 2;
  if (input.sessionRpe >= 10 || (input.recoveryToday != null && input.recoveryToday <= 2)) return 3;
  if (input.recoveryToday === 5 && input.sessionRpe <= 8) return 5;
  return 4;
}

/** Sleep choices, anchored on 8h. Above 8 the old 8–9 / 9+ split never changed a decision. */
export const SLEEP_OPTIONS: { v: SleepBucket; label: string }[] = [
  { v: "lt5", label: "<5h" },
  { v: "5_6", label: "5–6h" },
  { v: "6_7", label: "6–7h" },
  { v: "7_8", label: "7–8h" },
  { v: "gte8", label: "8h+" },
];

/**
 * The chip a stored bucket lights up: older 8–9 / 9h+ answers show as "8h+".
 * A "7h+" (gte7) answer spans two chips, so it lights neither.
 */
export function sleepChip(b: SleepBucket | null | undefined): SleepBucket | null {
  if (!b || b === "gte7") return null;
  return b === "8_9" || b === "gte9" ? "gte8" : b;
}

/** Session RPE to show when reopening a saved review. Never pre-filled. */
export function initialEffort(
  initial:
    | { sessionRpe?: number | null; reviewVersion?: number | null; submittedAt?: string | null }
    | null
    | undefined,
): number | null {
  // Only a v2 review stored a real session RPE; legacy values were derived.
  if (
    initial?.submittedAt &&
    (initial.reviewVersion ?? 0) >= REVIEW_VERSION &&
    initial.sessionRpe != null
  ) {
    return Math.min(10, Math.max(1, initial.sessionRpe));
  }
  return null;
}

/** Primary button label: says what's missing, and how many optional answers a quick finish skips. */
export function checkoutCta(input: {
  isEdit: boolean;
  effort: number | null;
  pain: boolean | null;
  painArea: string | null;
  sleepBucket: string | null;
  recoveryToday: number | null;
}): { label: string; enabled: boolean } {
  if (input.effort == null) return { label: "Pick how hard it was", enabled: false };
  if (input.pain === true && !input.painArea)
    return { label: "Pick where it hurts", enabled: false };
  if (input.isEdit) return { label: "Save changes", enabled: true };
  const skipped = [input.sleepBucket, input.recoveryToday, input.pain].filter(
    (v) => v == null,
  ).length;
  return { label: skipped ? `Skip ${skipped} & finish` : "Done", enabled: true };
}

/** Whether the stored session_rpe is a real self-report (v2) or a legacy mapping. */
export function trustedSessionRpe(row: { session_rpe?: number | null; review_version?: number | null }): number | null {
  return (row.review_version ?? 0) >= REVIEW_VERSION && row.session_rpe != null ? Number(row.session_rpe) : null;
}
