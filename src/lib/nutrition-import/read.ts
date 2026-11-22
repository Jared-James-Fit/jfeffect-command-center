/**
 * Reading a meal plan someone brought in: the free path first (the app's own
 * paste-format reader, `parseMealPlan`, no AI and no credits), then, when an
 * AI read it, its answer read back and checked by code. Pure.
 *
 * The free path takes a plan whose days have meals with foods in them: the
 * paste format (days headed "… MENU"), or a plan written as one day of meals
 * ("Meal 1 / 150 g chicken breast…", "Breakfast: …"), which is read as one
 * menu for every day. Anything else (a table of foods, a PDF, photos, a plan
 * that only names its foods in sentences) needs a full read.
 */
import { parseMealPlan, type ParsedDay } from "@/lib/nutrition-targets/meal-plan-parse";
import { MEAL_HEADER, structureMealPlanDay } from "@/lib/nutrition-targets/meal-plan-structure";
import { plainPastedText } from "@/lib/nutrition-targets/plain-paste";

export type PlanRead = {
  /** The plan in the paste format (a one-day plan with its "DAILY MENU" header added). */
  text: string;
  days: ParsedDay[];
  /** It had no day headers and was read as one menu for every day. */
  wrapped: boolean;
};

/** The header a plan with no day headers is read under (one menu, every day). */
export const ONE_DAY_HEADER = "DAILY MENU";

const bare = (l: string) => l.replace(/^[-*•·]\s*/, "").trim();

/** A day counts when at least one of its meals has a food with an amount. */
export function dayHasMeals(notes: string | null | undefined): boolean {
  return structureMealPlanDay(notes).meals.some((m) => m.foods.length > 0);
}

/** Meals with at least one food, on a day. */
export function mealCount(notes: string | null | undefined): number {
  return structureMealPlanDay(notes).meals.filter((m) => m.foods.length > 0 || m.macros).length;
}

/**
 * A day's name as a person writes it: "DAILY" / "EVERY DAY" is "Every day", a
 * name in capitals ("MONDAY", "WEEK 2 TUESDAY") in title case; the reader's
 * own names ("Training Day") as they are.
 */
export function tidyDayLabel(label: string): string {
  const l = label.replace(/_+/g, " ").replace(/\s+/g, " ").trim();
  if (/^(daily|every[- ]?day|all days|each day|any day)$/i.test(l)) return "Every day";
  if (l && l === l.toUpperCase() && /[A-Z]/.test(l)) return l.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
  return l || "Day";
}

/** A plan's days with their names tidied (parseMealPlan's, otherwise as read). */
export function planDays(text: string): ParsedDay[] {
  return parseMealPlan(text).map((d) => ({ ...d, day_label: tidyDayLabel(d.day_label) }));
}

/** The plan as the app reads it, or null when there are no days with meals in it. */
export function readPlanText(input: string): PlanRead | null {
  const text = plainPastedText(String(input ?? "")).replace(/\r\n?/g, "\n").trim();
  if (!text) return null;
  const days = planDays(text);
  if (days.length) return days.every((d) => dayHasMeals(d.notes)) ? { text, days, wrapped: false } : null;

  // no day headers: meals written straight down are one day, every day
  const lines = text.split("\n");
  if (!lines.some((l) => MEAL_HEADER.test(bare(l)))) return null;
  const phaseAt = lines.findIndex((l) => /^\s*(?:phase|goal)\s*[:\-–]/i.test(l));
  const lead = phaseAt === 0 ? `${lines[0].trim()}\n\n` : "";
  const body = phaseAt === 0 ? lines.slice(1).join("\n").trim() : text;
  const wrapped = `${lead}${ONE_DAY_HEADER}\n\n${body}`;
  const one = planDays(wrapped);
  if (one.length === 1 && dayHasMeals(one[0].notes)) return { text: wrapped, days: one, wrapped: true };
  return null;
}

/* ------------------------------------------------------------------ */
/*  An AI read, read back                                              */
/* ------------------------------------------------------------------ */

export class UnreadableAnswer extends Error {}

export type AiPlanAnswer = {
  read: PlanRead;
  /** What the model said it wasn't sure of, one line each. */
  unsure: string[];
  /** A PDF's or photos' text as the model read it (what the plan is checked against). */
  transcript: string | null;
};

/** One of the answer's sections ("<<<PLAN … PLAN>>>"), closed or (cut off) running to the end. */
function section(text: string, name: string): string | null {
  const closed = new RegExp(`<<<${name}[ \\t]*\\n?([\\s\\S]*?)\\n?[ \\t]*${name}>>>`).exec(text);
  if (closed) return closed[1];
  const open = new RegExp(`<<<${name}[ \\t]*\\n?([\\s\\S]*)$`).exec(text);
  if (!open) return null;
  // a section cut off: up to the next section's marker, if one follows
  const rest = open[1];
  const next = rest.search(/<<<[A-Z]+/);
  return next >= 0 ? rest.slice(0, next) : rest;
}

const NONE_LINE = /^(none|nothing|n\/a|-+|no issues?|nothing unclear)\.?$/i;

/** Markdown the model sometimes adds: fences, bold, headings. */
function plainOf(text: string): string {
  return text
    .replace(/```[a-z]*\s*/gi, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^#+\s*/gm, "");
}

/**
 * The model's answer: its plan (must read as days with meals, or the answer is
 * refused), what it wasn't sure of and, for a PDF or photos, its transcript.
 * Nothing in it is trusted until it's checked (ground.ts).
 */
export function readAiAnswer(raw: string): AiPlanAnswer {
  const text = plainOf(String(raw ?? ""));
  let plan = section(text, "PLAN");
  if (plan == null) {
    // no markers: the answer is the plan, up to any other section
    const cut = text.search(/<<<(UNSURE|TRANSCRIPT)/);
    plan = cut >= 0 ? text.slice(0, cut) : text;
  }
  const read = readPlanText(plan);
  if (!read) throw new UnreadableAnswer("No meals were found in it.");
  const unsure = (section(text, "UNSURE") ?? "")
    .split("\n")
    .map((l) => l.replace(/^[-*•·\d.)\s]+/, "").trim())
    .filter((l) => l && !NONE_LINE.test(l))
    .map((l) => l.slice(0, 200))
    .slice(0, 20);
  const transcript = section(text, "TRANSCRIPT")?.trim().slice(0, 60_000) || null;
  return { read, unsure, transcript };
}
