/**
 * A client's food history across their whole account, read the same way for
 * the coach's Food & diet card and for every nutrition AI path (a new plan,
 * Change something, Change it with AI, the copy prompts).
 *
 * What it keeps, from what's on file only (never guessed):
 * - Allergies / intolerances, diets and health conditions are sticky: said
 *   once on any Nutrition Update, Goals & Setup or the coach's notes, they stay
 *   on file with when they were first and last said, even when a later form
 *   answers "None", until the coach marks one as no longer applying (and a
 *   mention after that brings it back).
 * - Preferences change, so the latest answer wins; earlier ones are kept as
 *   history with their dates.
 * - Every food change asked for (the client's "foods to change" answers, the
 *   coach's Change something / Change it with AI instructions), with its date.
 * - Every plan with how it went: its calories a day across their week, the
 *   bodyweight trend on it (weightTrend, the same reading as the AI), the
 *   weekly check-in's nutrition rating and how often hunger or digestion was
 *   flagged.
 *
 * Pure, so it's tested and both sides agree.
 */
import { answerFor, type QA } from "@/lib/nutrition-ai-prompts";
import { normalizeDayLabel } from "@/lib/client-nutrition-day";
import { safetyNotes, weeklyAverageKcal, weightTrend, type WeighIn } from "@/lib/nutrition-targets/nutrition-intel";
import { dietTags, isNoneAnswer, type FoodGoals } from "@/lib/nutrition-targets/food-notes";
import { structureMealPlanDay } from "@/lib/nutrition-targets/meal-plan-structure";

export type FactKind = "allergy" | "diet" | "health";

/** The coach's read of it (getFoodHistoryFn), shared by the Food & diet card and the plan reviews. */
export const foodHistoryKey = (clientId: string) => ["food-history", clientId] as const;

/** One time something was said: when, and where. */
export type Mention = { at: string; source: string; text: string };

/** An allergy, diet or health condition, with every time it was said. */
export type StickyFact = {
  kind: FactKind;
  /** Stable key (the allergen, the diet, the condition, or the words when nothing names one). */
  key: string;
  label: string;
  first: string;
  last: string;
  mentions: Mention[];
  /** The coach marked it as no longer applying, after its last mention. */
  dismissed: { at: string } | null;
};

export type FoodChange = { at: string; by: "coach" | "client"; text: string };

export type PlanHistoryRow = {
  id: string;
  start: string;
  /** The last day it ran (today for the plan running now). */
  end: string;
  current: boolean;
  phase: string | null;
  /** Calories a day across their week. */
  kcal: number | null;
  /** Bodyweight trend on it, kg a week; null without enough weigh-ins. */
  kgPerWeek: number | null;
  pctPerWeek: number | null;
  trendClear: boolean;
  /** Weekly check-ins on it, their average nutrition rating (1–5), and how many flagged hunger / digestion. */
  checkins: number;
  rating: number | null;
  hunger: number;
  digestion: number;
};

export type FoodHistory = {
  allergies: StickyFact[];
  diets: StickyFact[];
  health: StickyFact[];
  /** Food changes asked for, newest first. */
  changes: FoodChange[];
  /** Every "foods + preferences" answer, newest first (the first is what they say now). */
  preferences: Mention[];
  /** Every plan, newest first. */
  plans: PlanHistoryRow[];
  /** How many Nutrition Updates this reads. */
  updates: number;
};

export type FoodHistoryInput = {
  /** Every sent Nutrition Update, any order. */
  updates: Array<{ at: string; answers: QA[] }>;
  goals?: (FoodGoals & { updated_at?: string | null }) | null;
  /** The coach's nutrition notes. */
  notes?: Array<{ at: string; text: string }>;
  /** The coach's own food changes (Change something, Change it with AI). */
  coachChanges?: Array<{ at: string; text: string }>;
  plans?: Array<{
    id: string;
    start_date: string | null;
    end_date: string | null;
    status?: string | null;
    phase?: string | null;
    days: Array<{ label: string; calories: number | null }>;
  }>;
  /** Weigh-ins, kg. */
  weights?: WeighIn[];
  checkins?: Array<{ submitted_at: string | null; answers: Record<string, unknown> | null }>;
  dismissed?: Array<{ kind: FactKind; key: string; at: string }>;
  trainingDays?: string[];
  highWeekday?: string | null;
  /** YYYY-MM-DD */
  today: string;
};

/** The allergens a text names, as one label each. */
const ALLERGENS: Array<[string, RegExp]> = [
  ["Peanuts", /\bpeanuts?\b/i],
  ["Tree nuts", /\btree ?nuts?\b|\balmonds?\b|\bcashews?\b|\bwalnuts?\b|\bpecans?\b|\bpistachios?\b|\bhazelnuts?\b|\b(?<!pea)nuts?\b/i],
  ["Shellfish", /\bshell ?fish\b|\bshrimps?\b|\bprawns?\b|\bcrabs?\b|\blobsters?\b|\bscallops?\b|\bclams?\b|\bmussels?\b|\boysters?\b/i],
  ["Fish", /(?<!shell ?)\bfish\b|\bsalmon\b|\btuna\b|\bcod\b|\btilapia\b/i],
  ["Eggs", /\beggs?\b/i],
  ["Dairy", /\bdairy\b|\blactose\b|\bmilk\b|\bcasein\b|\bwhey\b|\bcheese\b/i],
  ["Gluten", /\bgluten\b|\bwheat\b|\bceliac\b|\bcoeliac\b/i],
  ["Soy", /\bsoy(a|bean)?s?\b/i],
  ["Sesame", /\bsesame\b/i],
  ["Corn", /\bcorn\b/i],
  ["Nightshades", /\bnightshades?\b/i],
  ["Sulfites", /\bsulph?ites?\b/i],
  ["Mustard", /\bmustard\b/i],
];

export function allergensIn(text: string): string[] {
  return ALLERGENS.filter(([, re]) => re.test(text)).map(([a]) => a);
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\b(allerg(y|ies|ic)( to)?|intoleran(t|ce)( to)?|sensitiv(e|ity)( to)?|i('| a)?m|i have|have an?)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Words that make an "anything I missed" answer about their health. */
const BODY = /\b(condition|disease|disorder|syndrome|arthritis|surgery|injur|medication|meds|diagnos|pain|hormone|blood|pregnan|thyroid|hashimoto|asthma|migraine|anemi|anaemi|reflux|ulcer|gout)\w*/i;

const clean = (v: unknown) => String(v ?? "").replace(/\s+\n/g, "\n").trim();
const day = (iso: string) => String(iso).slice(0, 10);
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Everything on file about a client's food, across their whole account. */
export function buildFoodHistory(input: FoodHistoryInput): FoodHistory {
  const updates = input.updates
    .filter((u) => u.at)
    .slice()
    .sort((a, b) => a.at.localeCompare(b.at));
  const facts = new Map<string, StickyFact>();
  const say = (kind: FactKind, key: string, label: string, m: Mention) => {
    const id = `${kind}:${key}`;
    const f = facts.get(id);
    if (!f) {
      facts.set(id, { kind, key, label, first: m.at, last: m.at, mentions: [m], dismissed: null });
      return;
    }
    if (!f.mentions.some((x) => x.at === m.at && x.source === m.source && x.text === m.text)) f.mentions.push(m);
    if (m.at < f.first) f.first = m.at;
    if (m.at > f.last) f.last = m.at;
  };

  /** An allergy-field text: its allergens, else the diet it names, else the words themselves. */
  const allergyText = (text: string, at: string, source: string) => {
    if (!text || isNoneAnswer(text)) return;
    const m: Mention = { at, source, text };
    const allergens = allergensIn(text);
    const diets = dietTags([text]);
    for (const a of allergens) say("allergy", a.toLowerCase(), a, m);
    for (const d of diets) say("diet", d.toLowerCase(), d, m);
    if (!allergens.length && !diets.length) say("allergy", norm(text) || text.toLowerCase(), cap(text), m);
  };
  const dietText = (text: string, at: string, source: string) => {
    if (!text || isNoneAnswer(text)) return;
    for (const d of dietTags([text])) say("diet", d.toLowerCase(), d, { at, source, text });
  };
  const healthText = (answers: QA[], at: string, source: string, missed: string) => {
    const fromMissed = missed && !isNoneAnswer(missed) ? safetyNotes([{ label: "", value: missed }]) : [];
    // a condition named in "anything I missed" keeps their words (the medication, the detail) as its mention
    for (const h of safetyNotes(answers)) say("health", h.toLowerCase(), cap(h), { at, source, text: fromMissed.includes(h) ? missed : h });
    // otherwise that answer is health only when it says something about the body, not "trains at 6"
    if (missed && !isNoneAnswer(missed) && !fromMissed.length && BODY.test(missed)) {
      say("health", norm(missed) || missed.toLowerCase(), cap(missed), { at, source, text: missed });
    }
  };

  const preferences: Mention[] = [];
  const changes: FoodChange[] = [];
  for (const u of updates) {
    const at = day(u.at);
    const src = "Nutrition Update";
    const allergy = clean(answerFor(u.answers, "allerg"));
    const foods = clean(answerFor(u.answers, "foods", "preferences") || answerFor(u.answers, "foods you"));
    const missed = clean(answerFor(u.answers, "anything", "missed") || answerFor(u.answers, "need to know"));
    const swap = clean(answerFor(u.answers, "foods or meals do you want changed"));
    allergyText(allergy, at, src);
    dietText(foods, at, src);
    dietText(missed, at, src);
    healthText(u.answers, at, src, missed);
    if (foods && !isNoneAnswer(foods)) preferences.push({ at, source: src, text: foods });
    if (swap && !isNoneAnswer(swap)) changes.push({ at, by: "client", text: swap });
  }

  const g = input.goals ?? null;
  if (g) {
    const at = day(g.updated_at ?? input.today);
    if (g.food_restrictions_has) allergyText(clean(g.food_restrictions_details), at, "Goals & Setup");
  }
  for (const n of input.notes ?? []) {
    const at = day(n.at);
    dietText(n.text, at, "Your note");
    // a coach's note names an allergy only when it says it's one
    if (/allerg|intoleran|celiac|coeliac|anaphyla/i.test(n.text)) {
      for (const a of allergensIn(n.text)) say("allergy", a.toLowerCase(), a, { at, source: "Your note", text: n.text });
    }
  }
  for (const c of input.coachChanges ?? []) {
    const t = clean(c.text);
    if (t) changes.push({ at: day(c.at), by: "coach", text: t });
  }

  for (const d of input.dismissed ?? []) {
    const f = facts.get(`${d.kind}:${d.key}`);
    // only a dismissal after the last time it was said holds; saying it again brings it back
    if (f && day(d.at) >= f.last) f.dismissed = { at: day(d.at) };
  }
  for (const f of facts.values()) f.mentions.sort((a, b) => b.at.localeCompare(a.at));
  const byKind = (k: FactKind) =>
    [...facts.values()].filter((f) => f.kind === k).sort((a, b) => b.last.localeCompare(a.last) || a.label.localeCompare(b.label));

  return {
    allergies: byKind("allergy"),
    diets: byKind("diet"),
    health: byKind("health"),
    changes: changes.sort((a, b) => b.at.localeCompare(a.at)),
    preferences: preferences.sort((a, b) => b.at.localeCompare(a.at)),
    plans: planHistory(input),
    updates: updates.length,
  };
}

function planHistory(input: FoodHistoryInput): PlanHistoryRow[] {
  const plans = (input.plans ?? []).filter((p) => p.start_date && p.days.some((d) => Number(d.calories) > 0));
  const weights = input.weights ?? [];
  return plans
    .map((p) => {
      const start = p.start_date!;
      const current = p.status !== "Archived";
      const end = !current && p.end_date ? (p.end_date < input.today ? p.end_date : input.today) : input.today;
      const typed = p.days.filter((d) => normalizeDayLabel(d.label));
      const weekly = typed.length ? weeklyAverageKcal(typed, input.trainingDays ?? [], input.highWeekday ?? null) : null;
      const valued = p.days.map((d) => Number(d.calories)).filter((v) => Number.isFinite(v) && v > 0);
      const kcal = weekly ?? (valued.length ? valued.reduce((a, b) => a + b, 0) / valued.length : null);
      const t = end > start ? weightTrend(weights, start, end) : null;
      const inPlan = (input.checkins ?? []).filter((c) => {
        const d = String(c.submitted_at ?? "").slice(0, 10);
        return d && d >= start && d <= end;
      });
      const ratings = inPlan
        .map((c) => Number.parseFloat(String(c.answers?.nutrition_rating ?? "")))
        .filter((v) => Number.isFinite(v) && v >= 1 && v <= 5);
      const flagged = (re: RegExp) =>
        inPlan.filter((c) => Array.isArray(c.answers?.recovery_flags) && (c.answers!.recovery_flags as unknown[]).some((f) => re.test(String(f)))).length;
      return {
        id: p.id,
        start,
        end,
        current,
        phase: p.phase ?? null,
        kcal: kcal == null ? null : Math.round(kcal / 10) * 10,
        kgPerWeek: t ? t.kgPerWeek : null,
        pctPerWeek: t ? t.pctPerWeek : null,
        trendClear: !!t?.clear,
        checkins: inPlan.length,
        rating: ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null,
        hunger: flagged(/hunger|appetite/i),
        digestion: flagged(/digest|bloat/i),
      };
    })
    .sort((a, b) => b.start.localeCompare(a.start));
}

const shortDate = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const LB = 2.2046226;

/** "Jul 12" or "Jul 12 – Nov 8": when a fact was said. */
export function saidWhen(f: Pick<StickyFact, "first" | "last">): string {
  return f.first === f.last ? shortDate(f.first) : `${shortDate(f.first)} – ${shortDate(f.last)}`;
}

/** How a plan went, in one line: "−0.5 lb a week · ate to plan 3.8/5 · hunger 2 of 6 weeks". */
export function planResultLine(p: PlanHistoryRow, unit: "lb" | "kg"): string {
  const parts: string[] = [];
  if (p.kgPerWeek != null) {
    const v = unit === "lb" ? p.kgPerWeek * LB : p.kgPerWeek;
    const r = Math.round(Math.abs(v) * 10) / 10;
    parts.push(!p.trendClear || r === 0 ? "bodyweight steady" : `${v > 0 ? "+" : "−"}${r} ${unit} a week`);
  }
  if (p.rating != null) parts.push(`nutrition ${p.rating}/5 over ${p.checkins} ${p.checkins === 1 ? "check-in" : "check-ins"}`);
  if (p.hunger) parts.push(`hunger flagged ${p.hunger} of ${p.checkins}`);
  if (p.digestion) parts.push(`digestion flagged ${p.digestion} of ${p.checkins}`);
  return parts.join(" · ") || "Nothing logged on it";
}

/** "Sep 14 – Oct 25" / "Oct 26 – now". */
export function planSpan(p: PlanHistoryRow): string {
  return `${shortDate(p.start)} – ${p.current ? "now" : shortDate(p.end)}`;
}

/** Allergies and medical diets on file, for the meal plan's allergy line and the free meal (null when none). */
export function knownRestrictions(h: FoodHistory): string | null {
  const live = [...h.allergies, ...h.diets].filter((f) => !f.dismissed);
  return live.length ? live.map((f) => f.label).join(", ") : null;
}

/**
 * The history as the nutrition AI reads it. Allergies, diets and health on
 * file are kept to on every plan; earlier preferences lose to the latest
 * answer; past changes and how each plan went inform the next one.
 */
export function foodHistoryForAi(h: FoodHistory, unit: "lb" | "kg" = "kg"): string | null {
  const live = (fs: StickyFact[]) => fs.filter((f) => !f.dismissed);
  const fact = (f: StickyFact) => `${f.label} (said ${saidWhen(f)}${f.mentions[0] && f.mentions[0].text !== f.label ? `: "${f.mentions[0].text.replace(/\s+/g, " ").slice(0, 160)}"` : ""})`;
  const lines: string[] = [];
  if (live(h.allergies).length)
    lines.push(`- Allergies / intolerances on file (keep every plan clear of these, even when the latest form doesn't repeat them): ${live(h.allergies).map(fact).join("; ")}`);
  if (live(h.diets).length) lines.push(`- Diets on file: ${live(h.diets).map(fact).join("; ")}`);
  if (live(h.health).length)
    lines.push(`- Health on file (plan conservatively around these and with their doctor or a registered dietitian): ${live(h.health).map(fact).join("; ")}`);
  const removed = [...h.allergies, ...h.diets, ...h.health].filter((f) => f.dismissed);
  if (removed.length) lines.push(`- No longer applies (the coach checked): ${removed.map((f) => f.label).join(", ")}`);
  const earlier = h.preferences.slice(1, 4);
  if (earlier.length)
    lines.push(`- Earlier food preferences (the latest answers win when they disagree): ${earlier.map((p) => `${shortDate(p.at)} "${p.text.replace(/\s+/g, " ").slice(0, 160)}"`).join("; ")}`);
  if (h.changes.length)
    lines.push(
      `- Food changes asked for before (keep them unless the latest answers say otherwise): ${h.changes
        .slice(0, 8)
        .map((c) => `${shortDate(c.at)} ${c.by === "coach" ? "coach" : "client"}: "${c.text.replace(/\s+/g, " ").slice(0, 160)}"`)
        .join("; ")}`,
    );
  if (h.plans.length)
    lines.push(
      `- Plans so far, newest first: ${h.plans
        .slice(0, 6)
        .map((p) => `${planSpan(p)}${p.phase ? ` ${p.phase}` : ""}${p.kcal ? ` ~${p.kcal.toLocaleString("en-US")} kcal a day` : ""} → ${planResultLine(p, unit)}`)
        .join("; ")}`,
    );
  if (!lines.length) return null;
  return [`FOOD HISTORY (their whole account: ${h.updates} Nutrition ${h.updates === 1 ? "Update" : "Updates"}, Goals & Setup, the coach's notes and past plans):`, ...lines].join("\n");
}

/* ------------------------------------------------------------------------ */
/* A written plan against what's on file                                     */

/** The allergens a plan must never hold for this client: their allergies on file, plus dairy-free / gluten-free diets. */
export function liveAllergens(h: FoodHistory): string[] {
  const named = new Set(ALLERGENS.map(([a]) => a));
  const out = new Set<string>();
  for (const f of h.allergies) if (!f.dismissed && named.has(f.label)) out.add(f.label);
  for (const f of h.diets) {
    if (f.dismissed) continue;
    if (f.label === "Dairy-free") out.add("Dairy");
    if (f.label === "Gluten-free") out.add("Gluten");
  }
  return [...out];
}

/** Foods that carry an allergen without naming it (pasta is gluten, yogurt is dairy), and the versions that don't. */
const FOOD_ALLERGENS: Record<string, { re: RegExp; not?: RegExp }> = {
  Gluten: {
    re: /\b(bread|bagels?|pasta|spaghetti|macaroni|penne|wraps?|tortillas?|cereal|crackers?|muffins?|pancakes?|waffles?|couscous|barley|rye|bulgur|seitan|pretzels?|pitas?|naan|noodles?|english muffins?|cream of wheat)\b/,
    not: /gluten[- ]?free|rice noodles?|corn tortillas?|rice wraps?|rice cakes?|rice crackers?/,
  },
  Dairy: {
    re: /\b(yogh?urt|skyr|cottage cheese|cheese|butter|cream|kefir|ghee)\b/,
    not: /\b(peanut|almond|cashew|nut|seed|sunflower|coconut) butter\b|dairy[- ]?free|coconut (yogh?urt|cream)|non-?dairy|cream of rice/,
  },
};
const PLANT_MILK = /\b(almond|oat|soy|coconut|rice|cashew|pea|hemp|plant)[- ]milk\b/;

/** The allergens a food on a plan carries. */
export function foodAllergens(food: string): string[] {
  const f = food.toLowerCase();
  const out = new Set(allergensIn(f));
  // "almond milk" isn't dairy (it's a tree nut), "dairy-free yogurt" isn't dairy
  if (out.has("Dairy") && (PLANT_MILK.test(f) || /dairy[- ]?free|non-?dairy/.test(f))) out.delete("Dairy");
  if (out.has("Gluten") && /gluten[- ]?free/.test(f)) out.delete("Gluten");
  for (const [allergen, { re, not }] of Object.entries(FOOD_ALLERGENS)) if (re.test(f) && !(not && not.test(f))) out.add(allergen);
  return [...out];
}

export type AllergenHit = { allergen: string; food: string; where: string[] };

/**
 * Foods on a written plan that carry an allergen on file: "shrimp" for a
 * shellfish allergy, "whole wheat pasta" for gluten. The free meal is theirs
 * to pick (its rule already keeps to their diet), so it's never read.
 */
export function allergenConflicts(
  days: Array<{ label?: string | null; notes?: string | null }>,
  allergens: string[],
): AllergenHit[] {
  if (!allergens.length) return [];
  const want = new Set(allergens);
  const found = new Map<string, AllergenHit>();
  for (const d of days) {
    for (const meal of structureMealPlanDay(d.notes).meals) {
      if (/free meal/i.test(meal.title)) continue;
      for (const f of meal.foods) {
        for (const a of foodAllergens(f.name)) {
          if (!want.has(a)) continue;
          const k = `${a}:${f.name.trim().toLowerCase()}`;
          const row = found.get(k) ?? { allergen: a, food: f.name.trim(), where: [] };
          row.where.push([d.label, meal.title.split(" · ")[0]].filter(Boolean).join(" "));
          found.set(k, row);
        }
      }
    }
  }
  return [...found.values()];
}

/** "shrimp (shellfish), whole wheat pasta (gluten)": a coach-facing line. */
export function allergenConflictLine(hits: AllergenHit[]): string {
  return hits.map((h) => `${h.food} (${h.allergen.toLowerCase()})`).join(", ");
}

/**
 * An allergen food an edit brought in: on the new plan, not on the plan it
 * changed, and not a food the coach's words or the client named (the coach's
 * own call wins; the review still flags it).
 */
export function introducedAllergens(
  before: Array<{ label?: string | null; notes?: string | null }>,
  after: Array<{ label?: string | null; notes?: string | null }>,
  allergens: string[],
  said: Array<{ value?: string | null }> = [],
): AllergenHit[] {
  const had = new Set(allergenConflicts(before, allergens).map((h) => h.food.toLowerCase()));
  const words = said.map((x) => String(x.value ?? "").toLowerCase()).join(" \n ");
  return allergenConflicts(after, allergens).filter((h) => {
    const food = h.food.toLowerCase();
    if (had.has(food)) return false;
    // named by the coach or client ("add shrimp"): their call
    const core = food.replace(/\b(cooked|raw|dry|frozen|fresh|grilled|baked|plain|whole|lean)\b/g, " ").replace(/\s+/g, " ").trim();
    return !(core && words.includes(core));
  });
}
