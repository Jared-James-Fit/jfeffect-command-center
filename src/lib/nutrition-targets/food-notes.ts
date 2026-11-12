/**
 * What a coach has to keep in mind before touching a client's nutrition,
 * read the same way for the coach's Nutrition tab (the Food & diet card) and
 * for the nutrition AI: allergies, the diet they follow, what they eat and
 * won't, health things, how they eat day to day, and the coach's own
 * nutrition notes. Read from what's on file only (their latest Nutrition
 * Update, Goals & Setup, the coach's notes), never guessed. Pure, so it's
 * tested and both sides agree.
 */
import { answerFor, type QA } from "@/lib/nutrition-ai-prompts";
import { safetyNotes } from "@/lib/nutrition-targets/nutrition-intel";

/** The Goals & Setup answers this reads (client_goals_setup). */
export type FoodGoals = {
  nutrition_goal?: string | null;
  nutrition_preference?: string | null;
  food_restrictions_has?: boolean | null;
  food_restrictions_details?: string | null;
  food_dislikes?: string[] | null;
  nutrition_challenges?: string[] | null;
  cooking_skill?: string | null;
};

export type FoodNotesInput = {
  /** The latest Nutrition Update they sent (its answers), or none. */
  answers?: QA[] | null;
  /** When they sent it. */
  answersAt?: string | null;
  goals?: FoodGoals | null;
  /** The coach's nutrition notes (client_file_notes, topic 'nutrition'), newest first. */
  coachNotes?: string[] | null;
};

export type FoodNotes = {
  /** 'none' only when they said so; 'unknown' when nothing on file asks. */
  allergyState: "some" | "none" | "unknown";
  /** Each allergy / intolerance / medical-diet answer as they wrote it, deduped. */
  allergies: string[];
  /** Diets named anywhere on file: "AIP", "Gluten-free", "No pork"… */
  diet: string[];
  /** The foods they eat or like, as written ("Eats anything" when that's the answer). */
  eats: string | null;
  /** Foods they don't eat (Goals & Setup). */
  avoids: string[];
  /** Health things a coach shouldn't plan around alone (safetyNotes), plus "anything I missed" when it says something. */
  health: string[];
  /** How they eat day to day: meals a day, when they train, eating before it, steps, activity. */
  routine: Array<{ label: string; value: string }>;
  /** Their goal in their words. */
  goal: string | null;
  /** How they like to follow a plan, cooking skill, what they find hard. */
  style: Array<{ label: string; value: string }>;
  coachNotes: string[];
  /** Anything on file at all. */
  empty: boolean;
};

/** "None", "no", "That's everything", "N/A": an answer that says there's nothing. */
export function isNoneAnswer(v: string | null | undefined): boolean {
  const s = String(v ?? "")
    .trim()
    .replace(/[.!]+$/, "")
    .trim();
  if (!s) return true;
  return /^(none|no|nope|nah|n\/?a|na|nothing|nil|-+|no allergies|none that i know of|not that i know of|no known allergies|nothing else|that'?s (it|all|everything)( for now)?|all good|no thanks?)$/i.test(
    s,
  );
}

const ANYTHING = /^(i (will )?eat |i'?m good with )?(anything|everything|all foods?)( and everything)?$/i;

/** The diets a text names, in a fixed order (allergies are their own list). */
const DIETS: Array<[string, RegExp]> = [
  ["AIP", /\bAIP\b|auto-?immune protocol/i],
  ["Vegan", /\bvegan\b/i],
  ["Vegetarian", /(?<!non[- ])\bvegetarian\b/i],
  ["Pescatarian", /\bpesc[ae]tarian\b/i],
  ["Keto", /\bketo(genic)?\b/i],
  ["Paleo", /\bpaleo\b/i],
  ["Whole30", /\bwhole ?30\b/i],
  ["Carnivore", /\bcarnivore\b/i],
  ["Low FODMAP", /\bfodmap\b/i],
  ["Gluten-free", /gluten[- ]?free|\bceliac|\bcoeliac|\bno gluten|gluten (allergy|intoleran|sensitiv)/i],
  ["Dairy-free", /dairy[- ]?free|\bno dairy|lactose|dairy (allergy|intoleran|sensitiv)/i],
  ["Halal", /\bhalal\b/i],
  ["Kosher", /\bkosher\b/i],
  ["No pork", /\bno pork\b|\bdon'?t eat pork|\bpork[- ]free|\bnot? (eat(ing)? )?pork\b/i],
  ["No red meat", /\bno red meat\b|\bdon'?t eat red meat/i],
];

export function dietTags(texts: Array<string | null | undefined>): string[] {
  const all = texts.filter(Boolean).join("\n");
  const tags = DIETS.filter(([, re]) => re.test(all)).map(([t]) => t);
  // vegan already says vegetarian
  return tags.includes("Vegan") ? tags.filter((t) => t !== "Vegetarian") : tags;
}

const clean = (v: string | null | undefined) => String(v ?? "").replace(/\s+\n/g, "\n").trim();

function uniq(xs: string[]): string[] {
  const seen = new Set<string>();
  return xs.filter((x) => {
    const k = x.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** The client's food details, organised. */
export function foodNotes(input: FoodNotesInput): FoodNotes {
  const qas = input.answers ?? [];
  const g = input.goals ?? null;
  const allergyAnswer = clean(answerFor(qas, "allerg"));
  const foodsAnswer = clean(answerFor(qas, "foods", "preferences") || answerFor(qas, "foods you"));
  const missed = clean(answerFor(qas, "anything", "missed") || answerFor(qas, "need to know"));
  const goalsRestrictions = g?.food_restrictions_has ? clean(g.food_restrictions_details) : "";

  const allergies = uniq([allergyAnswer, goalsRestrictions].filter((v) => v && !isNoneAnswer(v)));
  const askedAllergies = qas.some((q) => /allerg/i.test(q.label)) || g?.food_restrictions_has != null;
  const allergyState: FoodNotes["allergyState"] = allergies.length ? "some" : askedAllergies ? "none" : "unknown";

  const coachNotes = (input.coachNotes ?? []).map(clean).filter(Boolean);
  const diet = dietTags([allergyAnswer, foodsAnswer, goalsRestrictions, missed, ...coachNotes]);

  const eats = !foodsAnswer || isNoneAnswer(foodsAnswer) ? null : ANYTHING.test(foodsAnswer.replace(/[.!]+$/, "")) ? "Eats anything" : foodsAnswer;
  const avoids = uniq((g?.food_dislikes ?? []).map(clean).filter((v) => v && !isNoneAnswer(v)));

  const health = uniq([
    ...safetyNotes(qas).map((h) => h.charAt(0).toUpperCase() + h.slice(1)),
    ...(missed && !isNoneAnswer(missed) ? [missed] : []),
  ]);

  const meals = clean(answerFor(qas, "how many meals") || answerFor(qas, "meals per day"));
  const trainAt = clean(answerFor(qas, "time", "train"));
  const preEat = clean(answerFor(qas, "eat before training"));
  const steps = clean(answerFor(qas, "daily steps"));
  const activity = clean(answerFor(qas, "outside of the gym") || answerFor(qas, "physical activities"));
  const routine = [
    meals ? { label: "Meals a day", value: meals } : null,
    trainAt ? { label: "Trains", value: trainAt } : null,
    preEat ? { label: "Before training", value: preEat } : null,
    steps ? { label: "Daily steps", value: /^\d+$/.test(steps) ? Number(steps).toLocaleString("en-US") : steps } : null,
    activity && !isNoneAnswer(activity) ? { label: "Other activity", value: activity } : null,
  ].filter(Boolean) as FoodNotes["routine"];

  const goalAnswer = clean(qas.find((q) => /^goal$/i.test(q.label.trim()))?.value);
  const goalDetail = clean(answerFor(qas, "explain your goal") || answerFor(qas, "goal with more details"));
  const goal = [goalAnswer || clean(g?.nutrition_goal), goalDetail && !isNoneAnswer(goalDetail) ? goalDetail : ""]
    .filter(Boolean)
    .join(" · ") || null;

  const style = [
    g?.nutrition_preference && !/^not sure$/i.test(g.nutrition_preference) ? { label: "Likes to follow", value: g.nutrition_preference } : null,
    g?.cooking_skill ? { label: "Cooking", value: g.cooking_skill.charAt(0).toUpperCase() + g.cooking_skill.slice(1) } : null,
    g?.nutrition_challenges?.length ? { label: "Finds hard", value: g.nutrition_challenges.join(", ") } : null,
  ].filter(Boolean) as FoodNotes["style"];

  const empty = !qas.length && !g && !coachNotes.length;
  return { allergyState, allergies, diet, eats, avoids, health, routine, goal, style, coachNotes, empty };
}

/**
 * What the nutrition AI reads on top of the Nutrition Update itself: Goals &
 * Setup's food restrictions and dislikes (the form doesn't ask for those) and
 * the coach's nutrition notes, which it follows unless one would break an
 * allergy or a medical need. Null when there's nothing to add.
 */
export function foodNotesForAi(goals: FoodGoals | null | undefined, coachNotes: string[] | null | undefined): string | null {
  const g = goals ?? null;
  const lines: string[] = [];
  const restrictions = g?.food_restrictions_has ? clean(g.food_restrictions_details) : "";
  if (restrictions && !isNoneAnswer(restrictions)) lines.push(`- Goals & Setup, allergies / intolerances: ${restrictions}`);
  const dislikes = (g?.food_dislikes ?? []).map(clean).filter((v) => v && !isNoneAnswer(v));
  if (dislikes.length) lines.push(`- Goals & Setup, won't eat: ${dislikes.join(", ")}`);
  const notes = (coachNotes ?? []).map(clean).filter(Boolean);
  for (const n of notes) lines.push(`- Coach's note: ${n.replace(/\n+/g, " / ")}`);
  if (!lines.length) return null;
  return [
    "COACH'S FOOD NOTES (follow these unless one would break an allergy or a medical need; a food named here may be used):",
    ...lines,
  ].join("\n");
}
