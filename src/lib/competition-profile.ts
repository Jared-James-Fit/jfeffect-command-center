/**
 * A lifter's competition profile (pure, tested): the weight class they compete
 * in and the age classes they enter, kept on their account
 * (athlete_competition_profiles) so every powerlifting form starts from it and
 * the coach always has it. The athlete changes it in Account → Competition, the
 * coach in Athlete setup, and a form they send writes back what they answered
 * (competition-profile.server.ts). Classes are stored one way ("83", "120+",
 * "open", "master 1") whatever a form's options call them, and read back into
 * any form's own options (form-prefill.ts).
 */
import { eligibleAgeClasses, eligibleOptions } from "@/lib/form-fields";

export type CompetitionProfile = {
  weightClass: string | null;
  ageClasses: string[];
  updatedAt?: string | null;
  source?: "form" | "client" | "coach" | null;
};

/** IPF classes (kg), the lightest of each only for sub-juniors and juniors. */
export const MEN_CLASSES = ["53", "59", "66", "74", "83", "93", "105", "120", "120+"] as const;
export const WOMEN_CLASSES = ["43", "47", "52", "57", "63", "69", "76", "84", "84+"] as const;
export const JUNIOR_ONLY = new Set(["53", "43"]);

export const AGE_CLASS_KEYS = ["sub-junior", "junior", "open", "master 1", "master 2", "master 3", "master 4"] as const;
const AGE_LABEL: Record<string, string> = {
  "sub-junior": "Sub-Junior",
  junior: "Junior",
  open: "Open",
  "master 1": "Master 1",
  "master 2": "Master 2",
  "master 3": "Master 3",
  "master 4": "Master 4",
};
export const ageClassLabelOf = (key: string) => AGE_LABEL[key] ?? key;

/** "Men's 83 kg", "-84kg", "120 kg+", "83" → "83" / "84" / "120+"; null when there's no class in it. */
export function canonicalClass(text: string | null | undefined): string | null {
  const t = String(text ?? "").trim();
  if (!t) return null;
  const m = t.match(/(\d{2,3}(?:\.\d)?)\s*(?:kg)?\s*(\+)?/i);
  if (!m) return null;
  const plus = !!m[2] || /\+\s*$/.test(t) || /^\s*\+/.test(t);
  return `${m[1]}${plus ? "+" : ""}`;
}

/** "83" → "Men's 83 kg", "84+" → "Women's 84 kg+"; a class no list has is "83 kg". */
export function weightClassLabel(cls: string | null | undefined): string | null {
  const c = canonicalClass(cls);
  if (!c) return null;
  const n = c.replace("+", "");
  const plus = c.endsWith("+") ? "+" : "";
  if ((MEN_CLASSES as readonly string[]).includes(c)) return `Men's ${n} kg${plus}`;
  if ((WOMEN_CLASSES as readonly string[]).includes(c)) return `Women's ${n} kg${plus}`;
  return `${n} kg${plus}`;
}

/** "SUB-JUNIOR (14–18)", "Master 2", "open" → the stored key, or null. */
export function ageClassKey(option: string): string | null {
  const n = option.toLowerCase().replace(/\(.*\)/, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  if (/^sub ?junior\b/.test(n)) return "sub-junior";
  if (/^junior\b/.test(n)) return "junior";
  if (/^open\b/.test(n)) return "open";
  const master = n.match(/^master ?([1-4])\b/);
  return master ? `master ${master[1]}` : null;
}

/** Keys in the order the classes run (sub-junior first). */
export function sortAgeKeys(keys: Iterable<string>): string[] {
  const set = new Set(keys);
  return AGE_CLASS_KEYS.filter((k) => set.has(k));
}

/** The age classes a birth year allows that season, as keys. */
export function allowedAgeKeys(birthDate: string | null | undefined, season: number): string[] {
  return sortAgeKeys(eligibleAgeClasses(birthDate, season));
}

/** A form's own options for stored keys ("open" → "OPEN (19–59)"). */
export function ageOptionsFor(options: string[], keys: string[]): string[] {
  return eligibleOptions(options, keys);
}

/** The classes a sex shows: a man's or a woman's, a junior's lightest only while they're one. */
export function weightClassesFor(sex: string | null | undefined, junior: boolean): string[] {
  const s = String(sex ?? "").toLowerCase();
  const list: readonly string[] = s.startsWith("f") || s.startsWith("w") ? WOMEN_CLASSES : MEN_CLASSES;
  return list.filter((c) => junior || !JUNIOR_ONLY.has(c));
}

type Q = { id: string; question_type?: string | null; validation?: Record<string, unknown> | null };
type A = { question_id: string; value_text?: string | null; value_number?: number | null; value_json?: unknown };

/**
 * What a sent form says about their competition profile: the age classes and
 * weight class questions it synced (validation.prefill), as stored keys. Only
 * what the form answered: a field it didn't ask stays as it is.
 */
export function profileFromAnswers(questions: Q[], answers: A[]): { weightClass?: string; ageClasses?: string[] } {
  const out: { weightClass?: string; ageClasses?: string[] } = {};
  const answer = (q: Q) => answers.find((a) => a.question_id === q.id);
  for (const q of questions) {
    const key = q.validation?.prefill;
    if (key === "age_class") {
      const j = answer(q)?.value_json;
      const keys = Array.isArray(j) ? sortAgeKeys(j.map((x) => ageClassKey(String(x))).filter((x): x is string => !!x)) : [];
      if (keys.length) out.ageClasses = keys;
    }
    if (key === "weight_class" || (key === "meet_weight_class" && out.weightClass == null)) {
      const cls = canonicalClass(answer(q)?.value_text);
      if (cls) out.weightClass = cls;
    }
  }
  return out;
}

/** "Men's 83 kg · Open" for a row; null when there's nothing on file. */
export function profileSummary(p: { weightClass?: string | null; ageClasses?: string[] | null } | null | undefined): string | null {
  if (!p) return null;
  const parts = [weightClassLabel(p.weightClass), (p.ageClasses ?? []).map(ageClassLabelOf).join(", ") || null].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}
