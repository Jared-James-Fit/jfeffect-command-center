/**
 * Shared facet derivation for programs (member_plans + pl_templates).
 *
 * Neither table has explicit columns for experience level, equipment list,
 * training location, or workout-length bucket. This module derives a
 * normalized `ProgramFacets` shape from existing columns plus a tolerant
 * `tags[]` parse so the rest of the UI (categories, filters, recommender)
 * can stay table-agnostic.
 *
 * No DB schema change; phase 6 may add nullable overrides on pl_templates.
 */

export type ProgramGoal =
  | "fat_loss"
  | "muscle"
  | "glutes"
  | "strength"
  | "powerlifting"
  | "powerbuilding"
  | "general";

export type ProgramLevel = "beginner" | "novice" | "intermediate" | "advanced" | "elite";

export type ProgramLocation = "gym" | "home" | "limited" | "mixed";

export type ProgramLengthBucket = "short" | "medium" | "long";

export interface ProgramFacets {
  goals: ProgramGoal[];
  style: string | null;
  level: ProgramLevel | null;
  daysPerWeek: number | null;
  weeks: number | null;
  lengthMin: number | null;
  lengthBucket: ProgramLengthBucket | null;
  location: ProgramLocation | null;
  equipmentNeeded: string[];
  audienceTags: string[];
  rawTags: string[];
}

/** Loose row shape covering the union of fields read from
 * member_plans (Membership Library) and pl_templates (admin/coach builder). */
export interface ProgramRowLike {
  name?: string | null;
  public_title?: string | null;
  description?: string | null;
  training_style?: string | null;
  training_focus?: string | null;
  difficulty?: string | null;
  goal?: string | null;
  weeks?: number | null;
  days_per_week?: number | null;
  est_minutes_per_workout?: number | null;
  est_duration_min?: number | null;
  equipment_needed?: string[] | string | null;
  tags?: string[] | string | null;
}

function toStrArray(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((s) => String(s)).filter(Boolean);
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[")) {
      try {
        const arr = JSON.parse(trimmed);
        if (Array.isArray(arr)) return arr.map((s) => String(s)).filter(Boolean);
      } catch { /* ignore */ }
    }
    return trimmed.split(/[,;]+/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function parseLevel(tags: string[], difficulty?: string | null): ProgramLevel | null {
  const hay = [...tags, difficulty ?? ""].map(norm).join(" ");
  if (/\belite\b/.test(hay)) return "elite";
  if (/\badvanced\b/.test(hay)) return "advanced";
  if (/\bintermediate\b/.test(hay)) return "intermediate";
  if (/\bnovice\b/.test(hay)) return "novice";
  if (/\bbeginner\b/.test(hay) || /\bnew(?:bie)?\b/.test(hay)) return "beginner";
  return null;
}

function parseGoals(row: ProgramRowLike, tags: string[]): ProgramGoal[] {
  const out = new Set<ProgramGoal>();
  const hay = [
    row.goal ?? "",
    row.training_focus ?? "",
    row.training_style ?? "",
    row.name ?? "",
    row.public_title ?? "",
    ...tags,
  ].map(norm).join(" ");

  if (/\bglute(s)?\b/.test(hay) || /\bbooty\b/.test(hay)) out.add("glutes");
  if (/\bfat\s*loss\b/.test(hay) || /\bcut(ting)?\b/.test(hay) || /\bweight\s*loss\b/.test(hay)) out.add("fat_loss");
  if (/\bpowerlift(ing)?\b/.test(hay)) out.add("powerlifting");
  if (/\bpowerbuild(ing)?\b/.test(hay)) out.add("powerbuilding");
  if (/\bstrength\b/.test(hay)) out.add("strength");
  if (/\bhypertrophy\b/.test(hay) || /\bmuscle\b/.test(hay) || /\bbuild\b/.test(hay) || /\bsize\b/.test(hay)) out.add("muscle");
  if (out.size === 0) out.add("general");
  return [...out];
}

function parseLocation(tags: string[], equipment: string[]): ProgramLocation | null {
  const hay = tags.map(norm).join(" ");
  if (/\bhome\b/.test(hay)) return "home";
  if (/\blimited\b/.test(hay) || /\bminimal\b/.test(hay) || /\bbodyweight\b/.test(hay)) return "limited";
  if (/\bgym\b/.test(hay) || /\bcommercial\b/.test(hay) || /\bpowerlifting\b/.test(hay)) return "gym";
  // Equipment-based fallback
  const eqHay = equipment.map(norm).join(" ");
  if (/\brack\b|\bplatform\b|\bcable\b|\bmachine\b/.test(eqHay)) return "gym";
  if (equipment.length > 0 && equipment.length <= 3) return "limited";
  return null;
}

function parseAudience(tags: string[]): string[] {
  const known = ["female", "male", "women", "men", "youth", "senior", "athlete", "pre natal", "post natal"];
  const out: string[] = [];
  for (const t of tags) {
    const n = norm(t);
    if (known.some((k) => n.includes(k))) out.push(t);
  }
  return out;
}

function bucketLength(min: number | null | undefined): ProgramLengthBucket | null {
  if (!min || min <= 0) return null;
  if (min <= 40) return "short";
  if (min <= 70) return "medium";
  return "long";
}

export function deriveFacets(row: ProgramRowLike): ProgramFacets {
  const tags = toStrArray(row.tags);
  const equipment = toStrArray(row.equipment_needed);
  const lengthMin = row.est_minutes_per_workout ?? row.est_duration_min ?? null;
  return {
    goals: parseGoals(row, tags),
    style: row.training_style ?? row.training_focus ?? null,
    level: parseLevel(tags, row.difficulty),
    daysPerWeek: row.days_per_week ?? null,
    weeks: row.weeks ?? null,
    lengthMin,
    lengthBucket: bucketLength(lengthMin),
    location: parseLocation(tags, equipment),
    equipmentNeeded: equipment,
    audienceTags: parseAudience(tags),
    rawTags: tags,
  };
}

/** Alias kept for back-compat with earlier component imports. */
export type FacetSource = ProgramRowLike;

const GOAL_LABELS: Record<ProgramGoal, string> = {
  fat_loss: "Fat Loss",
  muscle: "Muscle",
  glutes: "Glutes",
  strength: "Strength",
  powerlifting: "Powerlifting",
  powerbuilding: "Powerbuilding",
  general: "General",
};

export function goalLabel(g: ProgramGoal): string {
  return GOAL_LABELS[g] ?? "General";
}

const LEVEL_LABELS: Record<ProgramLevel, string> = {
  beginner: "Beginner",
  novice: "Novice",
  intermediate: "Intermediate",
  advanced: "Advanced",
  elite: "Elite",
};

const LOCATION_LABELS: Record<ProgramLocation, string> = {
  gym: "Gym",
  home: "Home",
  limited: "Limited equipment",
  mixed: "Mixed",
};

const LENGTH_LABELS: Record<ProgramLengthBucket, string> = {
  short: "≤40 min",
  medium: "40–70 min",
  long: ">70 min",
};

/**
 * Short, human-readable chips for ProgramCard / picker rows. Order is
 * level → days → location → primary goal → length → style, capped by caller.
 */
export function facetChips(f: ProgramFacets): string[] {
  const out: string[] = [];
  if (f.level) out.push(LEVEL_LABELS[f.level]);
  if (f.daysPerWeek) out.push(`${f.daysPerWeek}d/wk`);
  if (f.location) out.push(LOCATION_LABELS[f.location]);
  const primary = f.goals.find((g) => g !== "general");
  if (primary) out.push(goalLabel(primary));
  if (f.lengthBucket) out.push(LENGTH_LABELS[f.lengthBucket]);
  if (f.style && !out.some((c) => c.toLowerCase() === f.style!.toLowerCase())) out.push(f.style);
  return out;
}

