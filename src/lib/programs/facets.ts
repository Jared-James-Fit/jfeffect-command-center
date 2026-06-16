/**
 * Shared program facet derivation.
 *
 * Phase 1 of the Program Library redesign: we don't add new columns yet.
 * Instead we derive a normalized facet shape from the existing
 * `pl_templates` / `member_plans` rows (mostly via `tags[]` plus the
 * existing structured columns). This is the single source of truth used
 * by category filtering, the filters drawer, and the recommendation
 * engine across member, admin, and coach surfaces.
 */

export type ProgramLevel =
  | "beginner"
  | "novice"
  | "intermediate"
  | "advanced"
  | "elite";

export type ProgramLocation = "gym" | "home" | "either";

export type ProgramGoal =
  | "fat_loss"
  | "muscle"
  | "glutes"
  | "strength"
  | "powerlifting"
  | "powerbuilding"
  | "general";

export type ProgramStyle =
  | "powerlifting"
  | "bodybuilding"
  | "powerbuilding"
  | "hypertrophy"
  | "strength"
  | "fat_loss"
  | "lifestyle"
  | "mobility"
  | "hybrid"
  | "custom";

export interface ProgramFacets {
  goals: ProgramGoal[];
  style: ProgramStyle | null;
  level: ProgramLevel | null;
  daysPerWeek: number | null;
  weeks: number | null;
  lengthMin: number | null;
  location: ProgramLocation;
  equipmentNeeded: string[];
  audienceTags: string[];
  rawTags: string[];
}

export interface FacetSource {
  name?: string | null;
  public_title?: string | null;
  description?: string | null;
  training_style?: string | null;
  training_focus?: string | null;
  difficulty?: string | null;
  goal?: string | null;
  weeks?: number | null;
  days_per_week?: number | null;
  est_duration_min?: number | null;
  est_minutes_per_workout?: number | null;
  tags?: string[] | null;
}

const LEVEL_PATTERNS: Array<[ProgramLevel, RegExp]> = [
  ["elite", /\belite\b/],
  ["advanced", /\badvanced\b/],
  ["intermediate", /\bintermediate\b/],
  ["novice", /\bnovice\b/],
  ["beginner", /\bbeginner\b|\bbeginners?\b|\bfoundation\b/],
];

const STYLE_PATTERNS: Array<[ProgramStyle, RegExp]> = [
  ["powerbuilding", /power[\s-]?build/],
  ["powerlifting", /power[\s-]?lift/],
  ["bodybuilding", /body[\s-]?build|hypertrophy/],
  ["hypertrophy", /hypertrophy/],
  ["strength", /\bstrength\b/],
  ["fat_loss", /fat[\s-]?loss|cut\b|conditioning/],
  ["mobility", /mobility|flexibility/],
  ["lifestyle", /lifestyle|general fitness/],
  ["hybrid", /hybrid/],
];

const EQUIPMENT_KEYWORDS = [
  "barbell",
  "dumbbell",
  "kettlebell",
  "cable",
  "machine",
  "smith",
  "rack",
  "bench",
  "band",
  "pull-up",
  "plates",
  "specialty bar",
];

function lc(value: string | null | undefined): string {
  return (value ?? "").toString().trim().toLowerCase();
}

function uniq<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function detectLevel(haystack: string): ProgramLevel | null {
  for (const [level, re] of LEVEL_PATTERNS) {
    if (re.test(haystack)) return level;
  }
  return null;
}

function detectStyle(haystack: string): ProgramStyle | null {
  for (const [style, re] of STYLE_PATTERNS) {
    if (re.test(haystack)) return style;
  }
  return null;
}

function detectGoals(haystack: string, style: ProgramStyle | null): ProgramGoal[] {
  const goals: ProgramGoal[] = [];
  if (/glute/.test(haystack)) goals.push("glutes");
  if (/fat[\s-]?loss|conditioning|cut\b/.test(haystack)) goals.push("fat_loss");
  if (/hypertrophy|muscle|body[\s-]?build/.test(haystack)) goals.push("muscle");
  if (/power[\s-]?lift|meet prep|competition prep/.test(haystack)) goals.push("powerlifting");
  if (/power[\s-]?build/.test(haystack)) goals.push("powerbuilding");
  if (/\bstrength\b/.test(haystack)) goals.push("strength");
  if (goals.length === 0 && style) {
    if (style === "bodybuilding" || style === "hypertrophy") goals.push("muscle");
    else if (style === "powerlifting") goals.push("powerlifting");
    else if (style === "powerbuilding") goals.push("powerbuilding");
    else if (style === "strength") goals.push("strength");
    else if (style === "fat_loss") goals.push("fat_loss");
  }
  if (goals.length === 0) goals.push("general");
  return uniq(goals);
}

function detectLocation(haystack: string): ProgramLocation {
  if (/\bhome\b|apartment|garage/.test(haystack)) return "home";
  return "gym";
}

function detectEquipment(haystack: string): string[] {
  return EQUIPMENT_KEYWORDS.filter((kw) => haystack.includes(kw));
}

function detectAudience(tags: string[]): string[] {
  return tags.filter((t) =>
    /female|male|66kg|74kg|59kg|93kg|custom program|meet prep|competition/i.test(t),
  );
}

export function deriveFacets(row: FacetSource): ProgramFacets {
  const tags = (row.tags ?? []).map((t) => (t ?? "").toString());
  const rawTags = tags.map(lc);
  const text = [
    row.name,
    row.public_title,
    row.training_style,
    row.training_focus,
    row.goal,
    row.difficulty,
    ...tags,
  ]
    .map(lc)
    .filter(Boolean)
    .join(" | ");

  const level =
    detectLevel(text) ??
    (row.difficulty ? detectLevel(lc(row.difficulty)) : null);

  const style = detectStyle(text) ?? ((lc(row.training_style) || null) as ProgramStyle | null);
  const goals = detectGoals(text, style);
  const location = detectLocation(text);
  const equipmentNeeded = detectEquipment(text);
  const audienceTags = detectAudience(tags);

  const lengthMin = row.est_duration_min ?? row.est_minutes_per_workout ?? null;

  return {
    goals,
    style: style ?? null,
    level,
    daysPerWeek: row.days_per_week ?? null,
    weeks: row.weeks ?? null,
    lengthMin,
    location,
    equipmentNeeded,
    audienceTags,
    rawTags,
  };
}

export function facetChips(f: ProgramFacets): string[] {
  const chips: string[] = [];
  if (f.level) chips.push(capitalize(f.level));
  if (f.daysPerWeek) chips.push(`${f.daysPerWeek} Days`);
  if (f.location === "home") chips.push("Home");
  else if (f.location === "gym") chips.push("Gym");
  if (f.goals[0]) chips.push(goalLabel(f.goals[0]));
  if (f.lengthMin) chips.push(`${f.lengthMin} min`);
  if (f.weeks) chips.push(`${f.weeks} wk`);
  return chips;
}

export function goalLabel(g: ProgramGoal): string {
  switch (g) {
    case "fat_loss": return "Fat Loss";
    case "muscle": return "Muscle Building";
    case "glutes": return "Glute Focus";
    case "strength": return "Strength";
    case "powerlifting": return "Powerlifting";
    case "powerbuilding": return "Powerbuilding";
    default: return "General";
  }
}

export function levelLabel(l: ProgramLevel | null): string {
  return l ? capitalize(l) : "All Levels";
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
