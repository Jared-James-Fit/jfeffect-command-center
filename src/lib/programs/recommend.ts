import type { ProgramFacets, ProgramGoal } from "./facets";
import { goalLabel } from "./facets";

export interface GoalsSetupInput {
  main_goal?: string | null;
  training_days_per_week?: number | null;
  workout_length_minutes?: number | null;
  training_experience?: string | null;
  training_styles?: string[] | null;
  training_location?: string | null;
  equipment?: string[] | null;
  completed_at?: string | null;
}

export interface RecommendationScore {
  score: number;
  reasons: string[];
}

export function isProfileReady(g: GoalsSetupInput | null | undefined): boolean {
  if (!g) return false;
  if (g.completed_at) return true;
  const signal = [
    g.main_goal,
    g.training_days_per_week,
    g.training_experience,
    g.training_location,
  ].filter((v) => v !== null && v !== undefined && v !== "").length;
  return signal >= 3;
}

function normalizeGoal(mainGoal: string | null | undefined): ProgramGoal | null {
  const v = (mainGoal ?? "").toLowerCase();
  if (!v) return null;
  if (v.includes("fat")) return "fat_loss";
  if (v.includes("glute")) return "glutes";
  if (v.includes("muscle") || v.includes("hypertrophy") || v.includes("body")) return "muscle";
  if (v.includes("power") && v.includes("build")) return "powerbuilding";
  if (v.includes("powerlift") || v.includes("meet") || v.includes("competition")) return "powerlifting";
  if (v.includes("strength")) return "strength";
  return "general";
}

function normalizeLevel(exp: string | null | undefined): string | null {
  const v = (exp ?? "").toLowerCase();
  if (!v) return null;
  if (v.includes("beginner") || v.includes("new") || v.includes("<1") || v.includes("less than")) return "beginner";
  if (v.includes("novice") || v.includes("1-2") || v.includes("1 to 2")) return "novice";
  if (v.includes("intermediate") || v.includes("2-4")) return "intermediate";
  if (v.includes("advanced") || v.includes("4-7") || v.includes("5+")) return "advanced";
  if (v.includes("elite") || v.includes("competitive")) return "elite";
  return null;
}

const LEVEL_ORDER: Record<string, number> = {
  beginner: 0, novice: 1, intermediate: 2, advanced: 3, elite: 4,
};

function normalizeLocation(loc: string | null | undefined): "gym" | "home" | null {
  const v = (loc ?? "").toLowerCase();
  if (!v) return null;
  if (v.includes("home") || v.includes("apartment") || v.includes("limited")) return "home";
  return "gym";
}

interface Reason { text: string; weight: number; }

export function scoreProgram(f: ProgramFacets, g: GoalsSetupInput): RecommendationScore {
  const reasons: Reason[] = [];
  let score = 0;

  const wantGoal = normalizeGoal(g.main_goal);
  if (wantGoal && f.goals.includes(wantGoal)) {
    score += 3;
    reasons.push({ text: `Built for your ${goalLabel(wantGoal).toLowerCase()} goal`, weight: 3 });
  }

  if (g.training_days_per_week && f.daysPerWeek) {
    if (f.daysPerWeek === g.training_days_per_week) {
      score += 2;
      reasons.push({ text: `Matches your ${g.training_days_per_week}-day schedule`, weight: 2 });
    } else if (Math.abs(f.daysPerWeek - g.training_days_per_week) === 1) {
      score += 1;
      reasons.push({ text: `Close to your ${g.training_days_per_week}-day schedule`, weight: 1 });
    }
  }

  const wantLevel = normalizeLevel(g.training_experience);
  if (wantLevel && f.level) {
    const diff = Math.abs(LEVEL_ORDER[wantLevel] - LEVEL_ORDER[f.level]);
    if (diff === 0) {
      score += 2;
      reasons.push({ text: `Suitable for your experience level`, weight: 2 });
    } else if (diff === 1) {
      score += 1;
    }
  }

  const wantLoc = normalizeLocation(g.training_location);
  if (wantLoc) {
    if (f.location === wantLoc) {
      score += 2;
      reasons.push({
        text: wantLoc === "home" ? "Works with your home setup" : "Designed for full-gym access",
        weight: 2,
      });
    } else if (wantLoc === "home" && f.location === "gym") {
      score -= 1;
    }
  }

  if (g.workout_length_minutes && f.lengthMin) {
    if (f.lengthMin <= g.workout_length_minutes) {
      score += 1;
      reasons.push({ text: `Fits your ${g.workout_length_minutes}-min sessions`, weight: 1 });
    }
  }

  if (g.training_styles && g.training_styles.length > 0 && f.style) {
    const wants = g.training_styles.map((s) => s.toLowerCase());
    if (wants.some((w) => w.includes(f.style!))) score += 1;
  }

  if ((wantGoal === "powerlifting" || /meet|competition/i.test(g.main_goal ?? ""))
      && /meet|competition|prep/i.test(f.rawTags.join(" "))) {
    score += 1;
    if (!reasons.find((r) => /powerlifting/i.test(r.text))) {
      reasons.push({ text: "Designed for powerlifting preparation", weight: 1 });
    }
  }

  const dedupedReasons = Array.from(new Map(reasons.map((r) => [r.text, r])).values())
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map((r) => r.text);

  return { score, reasons: dedupedReasons };
}

export interface RankedProgram<T> {
  program: T;
  facets: ProgramFacets;
  score: number;
  reasons: string[];
}

export function rankRecommendations<T>(
  items: Array<{ program: T; facets: ProgramFacets }>,
  goals: GoalsSetupInput,
  n = 5,
  minScore = 3,
): RankedProgram<T>[] {
  return items
    .map(({ program, facets }) => {
      const { score, reasons } = scoreProgram(facets, goals);
      return { program, facets, score, reasons };
    })
    .filter((r) => r.score >= minScore && r.reasons.length > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}
