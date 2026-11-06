/**
 * The guided challenge builder's rules: the four steps, "how does someone win"
 * as plain choices, what each step still needs, and the change set an autosave
 * sends (only what changed, cleaned, never an invalid value).
 */
import {
  DEFAULT_ACKNOWLEDGMENTS,
  slugify,
  unitsFor,
  type ChallengePreset,
  type CollectLevel,
  type Direction,
  type Measure,
  type Tiebreak,
  type Unit,
} from "@/lib/challenges/model";

export type ChallengeRow = {
  id: string;
  slug: string;
  title: string;
  tagline: string | null;
  description: string | null;
  status: string;
  activity: string;
  exercise_id: string | null;
  measure: Measure;
  direction: Direction;
  unit: Unit;
  aggregate: "best" | "sum";
  attempts_allowed: number;
  relative_to_bodyweight: boolean;
  load_label: string | null;
  objective: string | null;
  tiebreak: Tiebreak;
  starts_at: string | null;
  ends_at: string | null;
  timezone: string;
  venue_name: string | null;
  city: string | null;
  address: string | null;
  max_participants: number | null;
  min_age: number;
  eligibility: string | null;
  rules: string[];
  safety: string | null;
  warmup: string | null;
  prize_summary: string | null;
  entry_fee_label: string | null;
  self_registration: boolean;
  registration_opens_at: string | null;
  registration_closes_at: string | null;
  collect: { phone?: CollectLevel; instagram?: CollectLevel };
  acknowledgments: string[];
  cover_path: string | null;
  is_template: boolean;
  is_test: boolean;
  announcement: string | null;
  announcement_at: string | null;
  results_final_at: string | null;
};

/** What a new challenge is called until someone names it (shown as an empty box). */
export const UNTITLED = "Untitled challenge";
export const isUntitled = (title: string) => title.trim() === UNTITLED;

export const WIZARD_STEPS = [
  { n: 1, key: "basics", title: "Basics" },
  { n: 2, key: "scoring", title: "Scoring" },
  { n: 3, key: "registration", title: "Registration & prizes" },
  { n: 4, key: "review", title: "Review & publish" },
] as const;
export type WizardStep = 1 | 2 | 3 | 4;

/* ------------------------------------------------------------------ */
/*  How someone wins                                                    */
/* ------------------------------------------------------------------ */

export type ScoringChoice = {
  key: string;
  label: string;
  hint: string;
  measure: Measure;
  direction: Direction;
  unit: Unit;
};

export const SCORING_CHOICES: ScoringChoice[] = [
  {
    key: "most_reps",
    label: "Most reps wins",
    hint: "At a set weight or bodyweight",
    measure: "reps",
    direction: "higher",
    unit: "reps",
  },
  {
    key: "heaviest",
    label: "Heaviest lift wins",
    hint: "Best judged lift counts",
    measure: "weight",
    direction: "higher",
    unit: "lb",
  },
  {
    key: "fastest",
    label: "Fastest time wins",
    hint: "Sprints, rows, carries for time",
    measure: "time",
    direction: "lower",
    unit: "s",
  },
  {
    key: "longest_time",
    label: "Longest time wins",
    hint: "Holds and hangs",
    measure: "time",
    direction: "higher",
    unit: "s",
  },
  {
    key: "farthest",
    label: "Farthest distance wins",
    hint: "Carries, sleds, throws",
    measure: "distance",
    direction: "higher",
    unit: "m",
  },
  {
    key: "most_points",
    label: "Most points wins",
    hint: "Scored events",
    measure: "points",
    direction: "higher",
    unit: "pts",
  },
];

export function scoringChoiceOf(r: Pick<ChallengeRow, "measure" | "direction">): string | null {
  const hit = SCORING_CHOICES.find((s) => s.measure === r.measure && s.direction === r.direction);
  if (hit) return hit.key;
  // "least reps" / "lightest" aren't offered; show them as advanced
  return null;
}

/** Switching how someone wins keeps a compatible unit and drops what no longer applies. */
export function applyScoringChoice(
  r: Pick<ChallengeRow, "unit" | "relative_to_bodyweight" | "load_label">,
  key: string,
): Pick<ChallengeRow, "measure" | "direction" | "unit" | "relative_to_bodyweight" | "load_label"> {
  const s = SCORING_CHOICES.find((x) => x.key === key) ?? SCORING_CHOICES[0]!;
  return {
    measure: s.measure,
    direction: s.direction,
    unit: unitsFor(s.measure).includes(r.unit) ? r.unit : s.unit,
    relative_to_bodyweight: s.measure === "weight" ? r.relative_to_bodyweight : false,
    load_label: s.measure === "reps" ? r.load_label : null,
  };
}

/* ------------------------------------------------------------------ */
/*  What's missing                                                      */
/* ------------------------------------------------------------------ */

export type Missing = { step: WizardStep; field: string; text: string };

export function missingItems(
  r: Pick<ChallengeRow, "title" | "starts_at" | "venue_name" | "rules" | "activity">,
): Missing[] {
  const out: Missing[] = [];
  if (isUntitled(r.title) || r.title.trim().length < 3)
    out.push({ step: 1, field: "title", text: "A name" });
  if (r.activity.trim().length < 2) out.push({ step: 1, field: "activity", text: "The activity" });
  if (!r.starts_at) out.push({ step: 1, field: "starts_at", text: "A date and start time" });
  if (!r.venue_name?.trim()) out.push({ step: 1, field: "venue_name", text: "A venue" });
  if (!r.rules.some((x) => x.trim())) out.push({ step: 2, field: "rules", text: "The rules" });
  return out;
}

export function stepDone(r: Parameters<typeof missingItems>[0], step: WizardStep): boolean {
  return !missingItems(r).some((m) => m.step === step);
}

/* ------------------------------------------------------------------ */
/*  Autosave                                                            */
/* ------------------------------------------------------------------ */

/** Columns the builder writes. */
export const SAVED_FIELDS = [
  "slug",
  "title",
  "tagline",
  "description",
  "activity",
  "exercise_id",
  "measure",
  "direction",
  "unit",
  "aggregate",
  "attempts_allowed",
  "relative_to_bodyweight",
  "load_label",
  "objective",
  "tiebreak",
  "starts_at",
  "ends_at",
  "timezone",
  "venue_name",
  "city",
  "address",
  "max_participants",
  "min_age",
  "eligibility",
  "rules",
  "safety",
  "warmup",
  "prize_summary",
  "entry_fee_label",
  "self_registration",
  "registration_opens_at",
  "registration_closes_at",
  "collect",
  "acknowledgments",
  "cover_path",
] as const satisfies readonly (keyof ChallengeRow)[];

export type SavedField = (typeof SAVED_FIELDS)[number];
export const SCORING_FIELDS: SavedField[] = [
  "measure",
  "direction",
  "unit",
  "aggregate",
  "attempts_allowed",
  "relative_to_bodyweight",
  "tiebreak",
];

const TIME_FIELDS = new Set<SavedField>([
  "starts_at",
  "ends_at",
  "registration_opens_at",
  "registration_closes_at",
]);
const NULLABLE_TEXT = new Set<SavedField>([
  "tagline",
  "description",
  "load_label",
  "objective",
  "venue_name",
  "city",
  "address",
  "eligibility",
  "safety",
  "warmup",
  "prize_summary",
  "entry_fee_label",
]);

/** A value as it would be stored (trimmed, empty → null, lists without blank lines). */
export function normalized(f: SavedField, v: unknown): unknown {
  if (NULLABLE_TEXT.has(f)) {
    const t = typeof v === "string" ? v.trim() : "";
    return t ? t : null;
  }
  if (f === "title" || f === "activity") return typeof v === "string" ? v.trim() : v;
  if (f === "rules" || f === "acknowledgments")
    return ((v as string[] | null) ?? []).map((x) => x.trim()).filter(Boolean);
  if (TIME_FIELDS.has(f)) return v ? new Date(v as string).toISOString() : null;
  return v ?? null;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Why a value can't be saved yet (it stays on screen; the rest still saves). */
export function fieldErrors(r: ChallengeRow): Partial<Record<SavedField, string>> {
  const e: Partial<Record<SavedField, string>> = {};
  const title = r.title.trim();
  if (!isUntitled(title) && title.length < 3) e.title = "At least 3 characters.";
  if (title.length > 90) e.title = "90 characters at most.";
  if (r.activity.trim().length < 2) e.activity = "Name the activity.";
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(r.slug) || r.slug.length < 3 || r.slug.length > 60)
    e.slug = "Lowercase letters, numbers and single dashes only.";
  if (r.starts_at && r.ends_at && new Date(r.ends_at) <= new Date(r.starts_at))
    e.ends_at = "The end has to be after the start.";
  if (
    r.registration_opens_at &&
    r.registration_closes_at &&
    new Date(r.registration_closes_at) <= new Date(r.registration_opens_at)
  )
    e.registration_closes_at = "Registration has to close after it opens.";
  if (r.max_participants != null && (!Number.isInteger(r.max_participants) || r.max_participants < 1))
    e.max_participants = "A whole number, 1 or more.";
  if (!Number.isInteger(r.min_age) || r.min_age < 0 || r.min_age > 99) e.min_age = "0 to 99.";
  if (r.attempts_allowed < 1 || r.attempts_allowed > 10) e.attempts_allowed = "1 to 10.";
  if (r.relative_to_bodyweight && r.measure !== "weight")
    e.relative_to_bodyweight = "Bodyweight scoring only works for weight.";
  return e;
}

/**
 * What an autosave sends: every field that differs from what's saved, as it
 * would be stored, minus anything that can't be saved yet. A field that
 * isn't allowed to change (the link once published, scoring once scores are
 * in) is left out too.
 */
export function buildPatch(
  saved: ChallengeRow,
  current: ChallengeRow,
  opts: { slugLocked?: boolean; scoringLocked?: boolean } = {},
): { patch: Partial<Record<SavedField, unknown>>; errors: Partial<Record<SavedField, string>> } {
  const errors = fieldErrors(current);
  const patch: Partial<Record<SavedField, unknown>> = {};
  for (const f of SAVED_FIELDS) {
    if (errors[f]) continue;
    if (f === "slug" && opts.slugLocked) continue;
    if (opts.scoringLocked && SCORING_FIELDS.includes(f)) continue;
    // an untitled challenge keeps its placeholder until it's named
    if (f === "title" && (isUntitled(current.title) || !current.title.trim())) continue;
    const next = normalized(f, current[f]);
    if (!same(next, normalized(f, saved[f]))) patch[f] = next;
  }
  // the two halves of a pair only go together when both are valid
  if (errors.ends_at) delete patch.starts_at;
  if (errors.registration_closes_at) delete patch.registration_opens_at;
  return { patch, errors };
}

/** While a draft's link hasn't been set by hand, it follows the name. */
export function followSlug(prevTitle: string, prevSlug: string, nextTitle: string): string {
  const following =
    prevSlug.startsWith("untitled-") || prevSlug === slugify(prevTitle) || !prevSlug;
  if (!following) return prevSlug;
  const s = slugify(nextTitle);
  return s.length >= 3 ? s : prevSlug;
}

/** The link wanted ("winnipeg-225") is taken → "winnipeg-225-2", then -3…; past that a random tail. */
export function nextSlug(wanted: string, attempt: number): string {
  const base = wanted.slice(0, 54).replace(/-+$/, "");
  if (attempt < 5) return `${base}-${attempt + 2}`;
  return `${base}-${Math.random().toString(36).slice(2, 6)}`;
}

/** A brand-new draft from a "kind of challenge" (named later, in step 1). */
export function draftFromPreset(p: ChallengePreset): Record<string, unknown> {
  return {
    slug: `untitled-${Math.random().toString(36).slice(2, 8)}`,
    title: UNTITLED,
    activity: p.activity,
    measure: p.measure,
    direction: p.direction,
    unit: p.unit,
    aggregate: p.aggregate,
    attempts_allowed: p.attempts_allowed,
    relative_to_bodyweight: p.relative,
    load_label: p.load_label,
    objective: p.objective,
    tiebreak: p.tiebreak,
    rules: p.rules,
    timezone: "America/Winnipeg",
    city: "Winnipeg, Manitoba",
    entry_fee_label: "Free",
    min_age: 18,
    self_registration: true,
    acknowledgments: DEFAULT_ACKNOWLEDGMENTS,
  };
}
