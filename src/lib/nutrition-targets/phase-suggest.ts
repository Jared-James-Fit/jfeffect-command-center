/**
 * Which Phase / Goal a new set of nutrition targets starts on, so the coach
 * doesn't set it by hand: the newest thing that says what this client is
 * working toward. Pure and tested; the targets dialog shows where it came
 * from and the coach can still change it.
 *
 * Order:
 * 1. The phase the coach picked when sending the Nutrition Update.
 * 2. The phase the AI plan was written for (the coach's pick, or the
 *    client's Goal answer read by the AI).
 * 3. The client's Goal answer on their latest Nutrition Update (then their
 *    "explain your goal" answer).
 * 4. Their current targets' phase.
 * 5. The goals on their profile.
 * Targets the coach set after the latest Nutrition Update beat 1–3: that's
 * the newer decision.
 */
import { NUTRITION_PHASES, phaseFromText } from "@/lib/nutrition-cardio";

export type PhaseSource = "request" | "ai" | "form" | "current" | "profile";

export type PhaseSuggestion = { phase: string; source: PhaseSource; detail: string | null };

const KNOWN = new Set<string>(NUTRITION_PHASES.filter((p) => p !== "Custom"));
const known = (p: string | null | undefined): string | null => (p && KNOWN.has(p) ? p : null);

export function suggestTargetsPhase(input: {
  requestPhase?: string | null;
  aiPhase?: string | null;
  goalAnswer?: string | null;
  goalDetail?: string | null;
  submittedAt?: string | null;
  current?: {
    phase?: string | null;
    custom_phase?: string | null;
    created_at?: string | null;
  } | null;
  profileGoals?: string | null;
}): PhaseSuggestion | null {
  const currentPhase = known(input.current?.phase);
  const currentIsNewer =
    !!currentPhase &&
    !!input.current?.created_at &&
    !!input.submittedAt &&
    Date.parse(input.current.created_at) > Date.parse(input.submittedAt);

  const fromRequest = known(input.requestPhase);
  const fromAi = known(input.aiPhase);
  const goal = input.goalAnswer?.trim() || null;
  const fromGoal = phaseFromText(goal) ?? phaseFromText(input.goalDetail);

  if (!currentIsNewer) {
    if (fromRequest) return { phase: fromRequest, source: "request", detail: null };
    if (fromAi) return { phase: fromAi, source: "ai", detail: null };
    if (fromGoal) return { phase: fromGoal, source: "form", detail: goal };
  }
  if (currentPhase) return { phase: currentPhase, source: "current", detail: null };
  const fromProfile = phaseFromText(input.profileGoals);
  if (fromProfile)
    return { phase: fromProfile, source: "profile", detail: input.profileGoals?.trim() || null };
  return null;
}

/** The short line under Phase / Goal saying where it came from. */
export function phaseSourceText(
  s: PhaseSuggestion,
  opts: { name?: string | null; submittedAt?: string | null } = {},
): string {
  const who = opts.name ? `${opts.name}'s` : "their";
  const when = opts.submittedAt
    ? ` (${new Date(opts.submittedAt).toLocaleDateString([], { month: "short", day: "numeric" })})`
    : "";
  switch (s.source) {
    case "request":
      return `The phase you picked when you sent ${who} Nutrition Update`;
    case "ai":
      return `From ${who} Nutrition Update${when}, the phase the AI plan was written for`;
    case "form":
      return `From ${who} Nutrition Update${when}${s.detail ? `: goal "${s.detail}"` : ""}`;
    case "current":
      return `Same as ${who} current targets`;
    case "profile":
      return `From the goals on ${who} profile${s.detail ? `: "${s.detail}"` : ""}`;
  }
}
