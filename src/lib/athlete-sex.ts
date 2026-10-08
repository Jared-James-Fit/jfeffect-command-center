/**
 * Athlete sex — one answer, stored once on clients.sex (synced with the
 * macro calculator's app_members.biological_sex by DB triggers).
 *
 * "unspecified" is "Prefer not to say": a real answer, so the app stops
 * asking. NULL means never asked.
 */

export type AthleteSex = "male" | "female" | "unspecified";

export const SEX_OPTIONS: { value: AthleteSex; label: string }[] = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "unspecified", label: "Prefer not to say" },
];

/** Why we ask, in the athlete's terms. */
export const SEX_REASON = "Helps personalize your plan, analytics and strength standards.";

export function asAthleteSex(v: unknown): AthleteSex | null {
  return v === "male" || v === "female" || v === "unspecified" ? v : null;
}

export function sexLabel(v: unknown): string | null {
  return SEX_OPTIONS.find((o) => o.value === v)?.label ?? null;
}

/** Map a form answer ("Male", "female", "Prefer not to say") back to a value. */
export function sexFromAnswer(answer: unknown): AthleteSex | null {
  const s = String(answer ?? "")
    .trim()
    .toLowerCase();
  if (!s) return null;
  const hit = SEX_OPTIONS.find((o) => o.label.toLowerCase() === s || o.value === s);
  return hit?.value ?? null;
}
