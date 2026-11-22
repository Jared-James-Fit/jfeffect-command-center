/**
 * The roadmap check-in's questions. A self-coached athlete's check-in is a
 * few taps when things are fine (how closely they ate, how they feel, how
 * training went), with the targeted follow-ups only when the engine asked for
 * them (checkins.ts). A coached athlete answers the same follow-ups inside
 * their weekly check-in (checkin-coordination/steps.ts), never a second form.
 * Weigh-ins are never a question: they're read from the log. The keys match
 * the weekly check-in's, so one reader (weight-management readCheckins) reads
 * both. Pure.
 */
import type { CheckinAsk } from "@/lib/nutrition-roadmap/types";

export type RoadmapQuestion = {
  key: string;
  type: "rating" | "single" | "multi" | "text";
  prompt: string;
  helper?: string;
  options?: string[];
  scale?: [string, string, string, string, string];
  exclusive?: string;
  optional?: boolean;
  showWhen?: (answers: Record<string, unknown>) => boolean;
};

export const NONE_GOT_IN_THE_WAY = "Nothing got in the way";
export const NONE_OF_THESE = "None of these";
export const CYCLE_CHANGED = ["Missed or late period", "Irregular periods"];

const flagged = (flag: string) => (a: Record<string, unknown>) => Array.isArray(a.recovery_flags) && (a.recovery_flags as string[]).includes(flag);

/** The targeted follow-ups, one per thing the engine needs told apart. */
export function askQuestion(ask: CheckinAsk, sex: "M" | "F" | null): RoadmapQuestion | null {
  switch (ask) {
    case "tracking":
      return {
        key: "tracking_accuracy",
        type: "single",
        prompt: "How closely did you weigh or log your food?",
        helper: "Honest is better than perfect: it tells the difference between the plan needing a change and the tracking needing one.",
        options: ["Weighed or logged everything", "Mostly weighed or logged", "Eyeballed most meals", "Didn't track"],
      };
    case "barriers":
      return {
        key: "nutrition_barriers",
        type: "multi",
        prompt: "What made the plan hard this week?",
        helper: "Tap everything that applies.",
        options: ["Weekends", "Eating out or social plans", "Hunger", "Busy, no time to prep", "Didn't like the food", "Travel", "Stress", NONE_GOT_IN_THE_WAY],
        exclusive: NONE_GOT_IN_THE_WAY,
        showWhen: (a) => !(typeof a.nutrition_rating === "number" && a.nutrition_rating >= 5),
      };
    case "confounders":
      return {
        key: "scale_confounders",
        type: "multi",
        prompt: "Anything this week that can hold extra water?",
        helper: "These move the scale for a few days without changing body fat.",
        options: ["More salt or eating out", ...(sex === "F" ? ["Period or cycle"] : []), "Travel", "Illness", "Poor sleep", "A very hard training week", "Constipation or bloating", NONE_OF_THESE],
        exclusive: NONE_OF_THESE,
      };
    case "cycle":
      return {
        key: "cycle_changes",
        type: "single",
        prompt: "Any changes to your menstrual cycle lately?",
        helper: "Private to you and your coach. A missed or irregular period while dieting can mean energy is too low, so it changes the plan.",
        options: ["No changes", ...CYCLE_CHANGED, "Not applicable", "Prefer not to say"],
        optional: true,
      };
    case "training":
      return {
        key: "training_note",
        type: "single",
        prompt: "How have your heavy lower-body sessions felt?",
        options: ["Strong", "Normal", "Flat or heavy", "Missed sessions"],
      };
    case "recovery":
    default:
      return null;
  }
}

/** A self-coached athlete's roadmap check-in: short, the follow-ups only where asked. */
export function roadmapCheckinQuestions(asks: CheckinAsk[], sex: "M" | "F" | null): RoadmapQuestion[] {
  const base: RoadmapQuestion[] = [
    {
      key: "nutrition_rating",
      type: "rating",
      prompt: "How closely did you follow your targets?",
      helper: "Since your last check-in. 1 = mostly off · 5 = on target almost every day.",
      scale: ["Off plan", "Some days", "Half", "Most days", "Every day"],
    },
    {
      key: "recovery_flags",
      type: "multi",
      prompt: "Anything off?",
      helper: "Tap everything that applies, or All good.",
      options: ["All good", "Hunger / appetite", "Energy", "Sleep", "Stress", "Digestion / bloating", "Illness"],
      exclusive: "All good",
    },
    {
      key: "hunger_level",
      type: "rating",
      prompt: "How hungry have you been?",
      scale: ["Rarely", "A little", "Manageable", "Often", "Always"],
      showWhen: flagged("Hunger / appetite"),
    },
    {
      key: "training_rating",
      type: "rating",
      prompt: "How has training felt?",
      scale: ["Struggled", "Hard", "Okay", "Good", "Great"],
    },
  ];
  const extra = asks.map((a) => askQuestion(a, sex)).filter((q): q is RoadmapQuestion => !!q);
  return [
    ...base,
    ...extra,
    { key: "life_changes", type: "text", prompt: "Anything changed? Schedule, work, travel, an injury.", optional: true },
  ];
}

/** The answers that matter to the engine, read back. */
export function readRoadmapAnswers(a: Record<string, unknown> | null | undefined): {
  cycleChanged: boolean;
  illness: boolean;
  trackingLoose: boolean;
  confounders: string[];
  barriers: string[];
} {
  const answers = a ?? {};
  const arr = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).map(String) : []);
  const tracking = String(answers.tracking_accuracy ?? "");
  return {
    cycleChanged: CYCLE_CHANGED.includes(String(answers.cycle_changes ?? "")),
    illness: arr(answers.recovery_flags).includes("Illness") || arr(answers.scale_confounders).includes("Illness"),
    trackingLoose: tracking === "Eyeballed most meals" || tracking === "Didn't track",
    confounders: arr(answers.scale_confounders).filter((c) => c !== NONE_OF_THESE),
    barriers: arr(answers.nutrition_barriers).filter((c) => c !== NONE_GOT_IN_THE_WAY),
  };
}

/** Required answers missing (the text one is optional). */
export function missingAnswers(qs: RoadmapQuestion[], answers: Record<string, unknown>): string[] {
  return qs
    .filter((q) => !q.optional && (!q.showWhen || q.showWhen(answers)))
    .filter((q) => {
      const v = answers[q.key];
      return v == null || v === "" || (Array.isArray(v) && v.length === 0);
    })
    .map((q) => q.key);
}
