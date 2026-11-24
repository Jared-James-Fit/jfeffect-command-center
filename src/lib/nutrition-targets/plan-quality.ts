/**
 * Nutrition plan quality (Nov 23 2026; reworked Nov 24 2026): how well a
 * client's current plan is designed for them, by category, from the plan's own
 * numbers and meals and what's on file. Deterministic, pure and tested
 * (cardio-insights.test.ts, plan-quality-intel.test.ts); see plan-quality.ts
 * for what the score is and isn't.
 *
 *   Goal alignment          calories against the maintenance their results
 *                           imply; a trend counts only as evidence while it's
 *                           followed (behind while followed well = the targets
 *                           aren't doing the job)
 *   Calorie targets         every day adds up from its macros, above the floor,
 *                           not a steep deficit or surplus, conservative when
 *                           their health calls for it
 *   Protein adequacy        g/kg on an adjusted weight
 *   Macro distribution      fat and carbs
 *   Balance & variety       distinct foods, fruit and vegetables (from the meals)
 *   Meal timing & practicality  meals a day, a meal around training, meals that
 *                           cover the day, prep-friendly, shelf-first
 *   Training & recovery     fuelled training days, the deficit against recovery
 *                           flags and their cardio
 *   Preferences & restrictions  allergies, diets and foods they won't eat
 *   Sustainability          hunger, swings, steepness; adherence corroborates
 *
 * A plan they rate low on their check-ins isn't marked down for it unless the
 * plan itself shows why: that's the difference between a poorly designed plan
 * and a sound one they're struggling to follow (the verdict says which).
 */
import { clampScore, finishQuality, FOLLOW_LOW, recoveryTrend, settlingOf, UNPROVEN_MAX, type CategoryConcern, type QualityCategory, type QualityChange, type QualityConnection, type QualityExecution, type QualityScore } from "@/lib/plan-quality";
import { structureMealPlanDay } from "@/lib/nutrition-targets/meal-plan-structure";
import { dayCoverage } from "@/lib/nutrition-targets/plan-coverage";
import { hardToFindFoods, prepDrift } from "@/lib/nutrition-targets/plan-foods";

export type NutritionDayIn = {
  label: string;
  kcal: number | null;
  protein: number | null;
  carbs: number | null;
  fats: number | null;
  kind: "training" | "rest" | "high" | "other";
};

/** What the plan's written meals show (mealFactsOf), for the meal categories. */
export type NutritionMealFacts = {
  /** Meals written on each day that has meals. */
  mealsPerDay: number[];
  /** Distinct foods across the plan. */
  distinctFoods: number;
  /** Distinct fruit and vegetables. */
  produce: number;
  /** Training days with meals, and how many of them have a meal around training. */
  trainingDaysWithMeals: number;
  trainingDaysWithWorkoutMeal: number;
  /** Days whose meals don't add up to their targets. */
  uncovered: string[];
  /** Weighed foods written at different amounts (harder to meal-prep). */
  prepDrift: number;
  hardToFind: string[];
  /** Foods they told you they won't eat, on the plan. */
  dislikes: string[];
};

export type NutritionScoreContext = {
  direction: "lose" | "gain" | "maintain" | null;
  sex: "M" | "F" | null;
  bodyweightKg: number | null;
  /** The plan's calories a day across their week. */
  weeklyKcal: number | null;
  /** What their results say they maintain on (observedMaintenance), when it can be read. */
  maintenance: number | null;
  trend: { pctPerWeek: number; clear: boolean } | null;
  trendStatus: string | null;
  /** Weekly check-in nutrition rating, 1–5 (last 3). */
  adherence: number | null;
  hungerHigh: boolean;
  recoveryFlags: number;
  trainingDays: number;
  powerlifter: boolean;
  meetWeeksOut: number | null;
  /** Foods on the plan that hit an allergy or diet on file (allergenConflictLine words). */
  conflicts: string[];
  restrictions: number;
  /** Meals written on the plan to check against what's on file. */
  hasMeals: boolean;
  /** Health on file that calls for conservative targets (an eating-disorder history, pregnancy…). */
  safety: string[];
  checkins: number;
  /** The meals' own facts (mealFactsOf); null when the plan has no meals written. */
  meals?: NutritionMealFacts | null;
  /** Cardio minutes a week in force (their cardio plan). */
  cardioMinutes?: number | null;
  /** Lower-body strength lately (comparable sets), when known. */
  lowerPerformance?: "up" | "steady" | "down" | null;
  /** When the plan last changed (its start, or an edit since), and today, for "too new to judge". */
  changedOn?: string | null;
  today?: string | null;
  /** The change log's read (plan-changes.ts changeRead): wins over changedOn when there is one. */
  changeLog?: { changes: QualityChange[]; settling: QualityScore["settling"] } | null;
  /** What their check-ins say gets in the way (barriersFromCheckins). */
  barriers?: string[];
  firstName?: string | null;
};

const kcalOf = (d: NutritionDayIn) => (d.protein != null && d.carbs != null && d.fats != null ? d.protein * 4 + d.carbs * 4 + d.fats * 9 : null);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const r1 = (n: number) => Math.round(n * 10) / 10;

const PRODUCE =
  /\b(broccoli|spinach|salad|lettuce|kale|arugula|peppers?|carrots?|cucumbers?|tomato(?:es)?|zucchini|green beans|asparagus|cauliflower|vegetables?|veggies?|veg|stir[- ]fry mix|berries|berry|blueberries|strawberries|raspberries|bananas?|apples?|oranges?|fruit|mango|pineapple|grapes|kiwi|peas|mushrooms?|onions?|cabbage|brussels sprouts|squash|pumpkin|beets?|celery|avocado|melon|watermelon|pears?|peach(?:es)?|plums?|cherries|dates)\b/i;

/** A food's name as one thing to count ("cooked chicken breast" → "chicken breast"). */
function foodKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(cooked|raw|dry|uncooked|plain|fresh|frozen|lean|boneless|skinless|grilled|baked|weight|weighed)\b/g, " ")
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The plan's meals read for the score (structureMealPlanDay, dayCoverage, prepDrift, hardToFindFoods). Pure. */
export function mealFactsOf(
  days: Array<{ label: string; notes: string | null; kind: NutritionDayIn["kind"]; kcal: number | null; protein: number | null; carbs: number | null; fats: number | null }>,
  o: { dislikes?: string[]; answers?: Array<{ value?: string | null }> } = {},
): NutritionMealFacts | null {
  const mealsPerDay: number[] = [];
  const foods = new Set<string>();
  const produce = new Set<string>();
  let trainingDaysWithMeals = 0;
  let trainingDaysWithWorkoutMeal = 0;
  const uncovered: string[] = [];
  const disliked = new Set<string>();
  const avoid = (o.dislikes ?? []).map((d) => d.toLowerCase().trim()).filter((d) => d.length >= 3);
  for (const d of days) {
    const st = structureMealPlanDay(d.notes);
    if (!st.meals.length) continue;
    mealsPerDay.push(st.meals.length);
    for (const m of st.meals)
      for (const f of m.foods) {
        const k = foodKey(f.name);
        if (!k) continue;
        foods.add(k);
        if (PRODUCE.test(f.name)) produce.add(k);
        for (const a of avoid) if (k.includes(a) || f.name.toLowerCase().includes(a)) disliked.add(a);
      }
    if (d.kind === "training" || d.kind === "high") {
      trainingDaysWithMeals++;
      if (st.meals.some((m) => m.timing != null)) trainingDaysWithWorkoutMeal++;
    }
    const cov = dayCoverage(d.notes, { calories: d.kcal, protein: d.protein, carbs: d.carbs, fats: d.fats });
    if (cov.state === "short" || cov.state === "over") uncovered.push(d.label);
  }
  if (!mealsPerDay.length) return null;
  const withNotes = days.map((d) => ({ label: d.label, notes: d.notes }));
  return {
    mealsPerDay,
    distinctFoods: foods.size,
    produce: produce.size,
    trainingDaysWithMeals,
    trainingDaysWithWorkoutMeal,
    uncovered,
    prepDrift: prepDrift(withNotes).length,
    hardToFind: hardToFindFoods(withNotes, o.answers ?? []).map((h) => h.food),
    dislikes: [...disliked],
  };
}

function executionOf(ctx: NutritionScoreContext): QualityExecution {
  const r = ctx.adherence;
  // "the wrong way" only on a trend that's clear of day-to-day noise (water, salt, food in the gut);
  // a noisy one is read as not moving yet, never as a reason to react
  const t = ctx.trendStatus === "wrong_way" && ctx.trend && !ctx.trend.clear ? "stalled" : ctx.trendStatus;
  const outcome =
    ctx.direction && ctx.direction !== "maintain" && t
      ? t === "on_track" || t === "ahead" || t === "reached"
        ? { status: "on_track" as const, label: "Bodyweight is on track for the goal" }
        : t === "behind" || t === "stalled"
          ? { status: "behind" as const, label: "Bodyweight is behind the goal" }
          : t === "wrong_way"
            ? { status: "off" as const, label: "Bodyweight is moving the wrong way" }
            : null
      : null;
  return {
    adherence: r != null ? { pct: Math.round(Math.max(0, Math.min(5, r)) * 20), label: `Rated their consistency ${r}/5 on recent check-ins` } : null,
    outcome,
    barriers: ctx.barriers ?? [],
  };
}

export function scoreNutritionPlan(days: NutritionDayIn[], ctx: NutritionScoreContext): QualityScore {
  const cats: QualityCategory[] = [];
  const kg = ctx.bodyweightKg && ctx.bodyweightKg > 30 ? ctx.bodyweightKg : null;
  const withKcal = days.filter((d) => (d.kcal ?? 0) > 0);
  const floor = ctx.sex === "F" ? 1200 : 1500;
  const training = days.filter((d) => d.kind === "training" || d.kind === "high");
  const rest = days.filter((d) => d.kind === "rest");
  const weekly = ctx.weeklyKcal ?? avg(withKcal.map((d) => d.kcal as number));
  const deltaPct = ctx.maintenance && weekly ? ((weekly - ctx.maintenance) / ctx.maintenance) * 100 : null;
  const execution = executionOf(ctx);
  const adh = execution.adherence?.pct ?? null;
  const followed = adh != null && adh >= FOLLOW_LOW;
  const behind = execution.outcome != null && execution.outcome.status !== "on_track";
  const onTrack = execution.outcome?.status === "on_track";
  const meals = ctx.meals ?? null;
  // a plan too new for its results: they neither count against it nor flatter it
  const settling = ctx.changeLog ? ctx.changeLog.settling : ctx.today ? settlingOf("nutrition", ctx.changedOn ?? null, ctx.today) : null;
  const evidence = !settling;

  // Goal alignment: calories against what they maintain on; results are evidence only while it's followed
  const goalConcerns: CategoryConcern[] = [];
  {
    const notes: string[] = [];
    let s: number | null = null;
    let capped = false;
    if (ctx.direction && deltaPct != null) {
      s = 100;
      const d = Math.round(deltaPct);
      if (ctx.direction === "lose") {
        if (deltaPct > -5) {
          s = 60;
          notes.push(`About maintenance (${d >= 0 ? "+" : ""}${d}%) for a fat-loss goal`);
        } else if (deltaPct < -30) {
          s = 65;
          notes.push(`${Math.abs(d)}% under maintenance is a steep deficit`);
          goalConcerns.push({ text: `${Math.abs(d)}% under what they maintain on is a steep deficit`, severity: "significant", reason: "safety" });
        } else notes.push(`${Math.abs(d)}% under what they maintain on`);
      } else if (ctx.direction === "gain") {
        if (deltaPct < 3) {
          s = 60;
          notes.push(`No real surplus (${d >= 0 ? "+" : ""}${d}%) for a building goal`);
        } else if (deltaPct > 20) {
          s = 70;
          notes.push(`+${d}% is a big surplus`);
        } else notes.push(`+${d}% over maintenance`);
      } else if (Math.abs(deltaPct) > 8) {
        s = 70;
        notes.push(`${d > 0 ? "+" : ""}${d}% from maintenance on a maintenance goal`);
      } else notes.push("Close to what they maintain on");
    } else if (ctx.direction && ctx.direction !== "maintain" && followed && execution.outcome && evidence) {
      // no maintenance to read against: results while it's followed are the evidence
      s = onTrack ? 90 : 65;
      notes.push(onTrack ? "Followed well and bodyweight is moving the way the goal needs" : `Followed well, but ${execution.outcome.label.toLowerCase()}`);
    }
    if (s != null && behind && followed && deltaPct != null && evidence) {
      s -= 15;
      notes.unshift(`Followed well (${adh}%) while ${execution.outcome!.label.toLowerCase()}: the targets aren't doing the job`);
    }
    if (s != null && settling && !settling.minor) {
      // a plan only reaches top marks here once its own results back it
      capped = s > UNPROVEN_MAX;
      s = Math.min(s, UNPROVEN_MAX);
      if (capped) notes.unshift(`New ${settling.days} days ago: their results will show whether these targets work`);
    }
    if (!notes.length) notes.push(ctx.direction ? "Not enough weigh-ins and check-ins yet to read what they maintain on" : "No goal on file to judge calories against");
    cats.push({ key: "goal", label: "Goal alignment", score: s == null ? null : clampScore(s), weight: 0.16, notes, critical: behind && followed && evidence ? "they follow it and results are behind" : null, concerns: goalConcerns, awaitingResults: capped });
  }

  // Calorie targets
  const calConcerns: CategoryConcern[] = [];
  {
    const notes: string[] = [];
    let s: number | null = withKcal.length ? 100 : null;
    if (s != null) {
      const under = withKcal.filter((d) => (d.kcal as number) < floor);
      if (under.length) {
        s -= 35;
        notes.push(`Under ${floor.toLocaleString("en-US")} kcal on ${under.map((d) => d.label).join(", ")}`);
        calConcerns.push({ text: `Under ${floor.toLocaleString("en-US")} kcal on ${under.map((d) => d.label).join(", ")}`, severity: ctx.safety.length ? "urgent" : "significant", reason: "safety" });
      }
      const off = withKcal.filter((d) => {
        const k = kcalOf(d);
        return k != null && Math.abs(k - (d.kcal as number)) / (d.kcal as number) > 0.05;
      });
      if (off.length) {
        s -= Math.min(30, off.length * 10);
        notes.push(`${off.map((d) => `${d.label}: ${d.kcal} kcal vs ${Math.round(kcalOf(d)!)} from its macros`).join("; ")}`);
      }
      if (deltaPct != null && deltaPct < -25) {
        s -= 15;
        notes.push(`A ${Math.abs(Math.round(deltaPct))}% deficit`);
      }
      if (deltaPct != null && deltaPct > 20) {
        s -= 10;
        notes.push(`A ${Math.round(deltaPct)}% surplus`);
      }
      if (ctx.safety.length && ctx.direction === "lose") {
        s -= 20;
        notes.push(`Health on file (${ctx.safety.join(", ")}) calls for conservative targets`);
        calConcerns.push({ text: `A fat-loss plan with ${ctx.safety.join(", ")} on file: keep the targets conservative and plan it with their doctor or a registered dietitian`, severity: "significant", reason: "safety" });
      }
      if (!notes.length) notes.push("Every day adds up and stays above the floor");
    }
    cats.push({ key: "calories", label: "Calorie targets", score: s == null ? null : clampScore(s), weight: 0.14, notes, critical: ctx.safety.length ? "health on file" : ctx.direction === "lose" ? "a fat-loss goal" : null, concerns: calConcerns });
  }

  const pDays = withKcal.filter((d) => d.protein != null && d.fats != null && d.carbs != null);

  // Protein adequacy (on an adjusted weight past a BMI of 30 is the roadmap's job; here g/kg of bodyweight)
  const proteinConcerns: CategoryConcern[] = [];
  {
    const notes: string[] = [];
    let s: number | null = null;
    if (pDays.length && kg) {
      s = 100;
      const gkg = avg(pDays.map((d) => d.protein as number))! / kg;
      if (gkg < 1.2) {
        s = 55;
        notes.push(`Protein ${r1(gkg)} g/kg is low (1.6–2.2 supports muscle)`);
        if (ctx.direction === "lose" || ctx.direction === "gain") proteinConcerns.push({ text: `Protein ${r1(gkg)} g/kg is low for ${ctx.direction === "lose" ? "a cut (it costs muscle)" : "building muscle"}`, severity: "significant", reason: "results" });
      } else if (gkg < 1.6) {
        s = 78;
        notes.push(`Protein ${r1(gkg)} g/kg (1.6–2.2 supports muscle)`);
      } else if (gkg > 3) {
        s = 88;
        notes.push(`Protein ${r1(gkg)} g/kg is more than needed (it crowds out carbs)`);
      } else notes.push(`Protein ${r1(gkg)} g/kg`);
      if (ctx.direction === "lose" && gkg < 1.8 && gkg >= 1.2) {
        s -= 5;
        notes.push("A cut keeps more muscle nearer 2 g/kg");
      }
    } else if (pDays.length) notes.push("No recent bodyweight to judge grams per kilo");
    cats.push({ key: "protein", label: "Protein adequacy", score: s == null ? null : clampScore(s), weight: 0.12, notes, critical: ctx.direction === "lose" ? "a cut" : ctx.direction === "gain" ? "a building goal" : null, concerns: proteinConcerns });
  }

  // Macro distribution: fat and carbs
  {
    const notes: string[] = [];
    let s: number | null = null;
    if (pDays.length && kg) {
      s = 100;
      const fat = avg(pDays.map((d) => d.fats as number))!;
      const fatPct = avg(pDays.map((d) => ((d.fats as number) * 9) / (d.kcal as number)))!;
      if (fat / kg < 0.6) {
        s -= 20;
        notes.push(`Fat ${r1(fat / kg)} g/kg is under 0.6`);
      } else if (fatPct < 0.2) {
        s -= 10;
        notes.push(`Fat is ${Math.round(fatPct * 100)}% of calories`);
      } else if (fatPct > 0.4) {
        s -= 10;
        notes.push(`Fat is ${Math.round(fatPct * 100)}% of calories, leaving less room for carbs`);
      }
      const tc = training.filter((d) => d.carbs != null);
      if (tc.length && ctx.trainingDays > 0) {
        const c = avg(tc.map((d) => d.carbs as number))! / kg;
        if (c < 2) {
          s -= 15;
          notes.push(`Training-day carbs ${r1(c)} g/kg`);
        }
      }
      if (!notes.length) notes.push("Fat and carbs in range");
    }
    cats.push({ key: "macros", label: "Macro distribution", score: s == null ? null : clampScore(s), weight: 0.1, notes });
  }

  // Balance and variety (only from written meals)
  {
    const notes: string[] = [];
    let s: number | null = null;
    if (meals) {
      s = 100;
      if (meals.produce === 0) {
        s -= 30;
        notes.push("No fruit or vegetables written in any meal");
      } else if (meals.produce < 2) {
        s -= 10;
        notes.push("One fruit or vegetable across the plan");
      }
      if (meals.distinctFoods < 6) {
        s -= 15;
        notes.push(`${meals.distinctFoods} different foods across the plan`);
      }
      if (!notes.length) notes.push(`${meals.distinctFoods} foods, ${meals.produce} of them fruit or vegetables`);
    } else notes.push("No meals written to check");
    cats.push({ key: "balance", label: "Balance and variety", score: s, weight: 0.08, notes });
  }

  // Meal timing and practicality (only from written meals)
  const timingConcerns: CategoryConcern[] = [];
  {
    const notes: string[] = [];
    let s: number | null = null;
    if (meals) {
      s = 100;
      const most = Math.max(...meals.mealsPerDay);
      const least = Math.min(...meals.mealsPerDay);
      if (least < 3) {
        s -= 10;
        notes.push(`${least} meal${least === 1 ? "" : "s"} on a day makes the targets hard to hit`);
      }
      if (most > 6) {
        s -= 10;
        notes.push(`${most} meals on a day is a lot to prepare and eat`);
      }
      if (meals.uncovered.length) {
        s -= Math.min(25, meals.uncovered.length * 12);
        notes.push(`Meals don't add up to the targets on ${meals.uncovered.join(", ")}`);
        timingConcerns.push({ text: `The meals don't add up to the targets on ${meals.uncovered.join(", ")}: what they eat won't match the numbers they see`, severity: "significant", reason: "results" });
      }
      if (ctx.trainingDays > 0 && meals.trainingDaysWithMeals > 0 && meals.trainingDaysWithWorkoutMeal === 0) {
        s -= 10;
        notes.push("No meal around training on training days");
      }
      if (meals.prepDrift >= 3) {
        s -= 10;
        notes.push(`${meals.prepDrift} foods weighed differently meal to meal (harder to prep)`);
      }
      if (meals.hardToFind.length) {
        s -= 10;
        notes.push(`Hard to find in stores: ${meals.hardToFind.slice(0, 3).join(", ")}`);
      }
      if (!notes.length) notes.push(`${least === most ? least : `${least}–${most}`} meals a day, easy to prep`);
    } else notes.push("No meals written to check");
    cats.push({ key: "timing", label: "Meal timing and practicality", score: s, weight: 0.1, notes, concerns: timingConcerns });
  }

  // Training and recovery support
  const perfConcerns: CategoryConcern[] = [];
  {
    const notes: string[] = [];
    let s: number | null = null;
    if (ctx.trainingDays > 0 && withKcal.length) {
      s = 100;
      const tCarb = avg(training.filter((d) => d.carbs != null).map((d) => d.carbs as number));
      const rCarb = avg(rest.filter((d) => d.carbs != null).map((d) => d.carbs as number));
      if (tCarb != null && rCarb != null && tCarb < rCarb) {
        s -= 15;
        notes.push("Fewer carbs on training days than rest days");
      }
      const tK = avg(training.filter((d) => (d.kcal ?? 0) > 0).map((d) => d.kcal as number));
      const rK = avg(rest.filter((d) => (d.kcal ?? 0) > 0).map((d) => d.kcal as number));
      if (tK != null && rK != null && tK < rK) {
        s -= 10;
        notes.push("Fewer calories on training days than rest days");
      }
      if (tCarb != null && kg) {
        const need = ctx.powerlifter && ctx.meetWeeksOut != null && ctx.meetWeeksOut <= 8 ? 3 : 2;
        if (tCarb / kg < need) {
          s -= 15;
          notes.push(`Training-day carbs ${r1(tCarb / kg)} g/kg (about ${need}+ fuels hard sessions)`);
        }
      }
      if (ctx.recoveryFlags >= 2 && deltaPct != null && deltaPct < -10) {
        s -= 15;
        notes.push("A deficit while sleep, energy or recovery are flagged");
        perfConcerns.push({ text: "A deficit while sleep or energy are flagged on recent check-ins", severity: "significant", reason: "recovery" });
      }
      const cardio = ctx.cardioMinutes ?? 0;
      if (cardio >= 150 && deltaPct != null && deltaPct < -20) {
        s -= 10;
        notes.push(`A ${Math.abs(Math.round(deltaPct))}% deficit on top of ${cardio} min of cardio a week`);
      }
      if (!notes.length) notes.push(ctx.recoveryFlags >= 2 ? "Fuels training; recovery is flagged, but the plan isn't the likely reason" : "Training days are fuelled");
    } else if (!ctx.trainingDays) notes.push("Their training days aren't set");
    cats.push({
      key: "performance",
      label: "Training and recovery support",
      score: s == null ? null : clampScore(s),
      weight: 0.12,
      notes,
      critical: ctx.meetWeeksOut != null && ctx.meetWeeksOut <= 8 ? `a meet in ${Math.round(ctx.meetWeeksOut)} weeks` : ctx.recoveryFlags >= 2 ? "sleep or energy flagged" : null,
      concerns: perfConcerns,
    });
  }

  // Preferences and restrictions
  const foodConcerns: CategoryConcern[] = [];
  {
    const notes: string[] = [];
    let s: number | null = null;
    if (ctx.hasMeals) {
      s = 100;
      if (ctx.conflicts.length) {
        s = Math.max(0, 100 - 40 * ctx.conflicts.length);
        notes.push(`Against what's on file: ${ctx.conflicts.slice(0, 3).join(", ")}`);
        foodConcerns.push({ text: `On the plan against an allergy or diet on file: ${ctx.conflicts.slice(0, 3).join(", ")}`, severity: "urgent", reason: "safety" });
      }
      if (meals?.dislikes.length) {
        s = Math.max(0, (s ?? 100) - 15 * meals.dislikes.length);
        notes.push(`Foods they said they won't eat: ${meals.dislikes.slice(0, 3).join(", ")}`);
      }
      if (!notes.length) notes.push(ctx.restrictions ? "Clear of every allergy and diet on file" : "No allergies or diets on file");
    } else notes.push("No meals written to check");
    cats.push({ key: "food", label: "Preferences and restrictions", score: s, weight: 0.08, notes, critical: ctx.restrictions ? "allergies or diets on file" : null, concerns: foodConcerns });
  }

  // Sustainability: the plan's own barriers; low adherence only corroborates them
  {
    const notes: string[] = [];
    let s: number | null = withKcal.length ? 100 : null;
    if (s != null) {
      let barriers = 0;
      if (ctx.hungerHigh) {
        s -= 15;
        barriers++;
        notes.push("Hunger is high");
      }
      const ks = withKcal.map((d) => d.kcal as number);
      if (ks.length >= 2 && Math.max(...ks) - Math.min(...ks) > 900) {
        s -= 10;
        barriers++;
        notes.push(`A ${Math.max(...ks) - Math.min(...ks)} kcal swing between days`);
      }
      if (deltaPct != null && deltaPct < -25) {
        s -= 10;
        barriers++;
        notes.push("A steep deficit is hard to hold for long");
      }
      if (meals && Math.max(...meals.mealsPerDay) > 6) barriers++;
      if (adh != null && adh < FOLLOW_LOW && barriers) {
        s -= 10;
        notes.push(`Consistency ${ctx.adherence}/5 lately, which fits the plan being hard to keep`);
      }
      if (!notes.length) notes.push("Nothing in the plan makes it hard to keep");
    }
    cats.push({ key: "sustain", label: "Sustainability", score: s == null ? null : clampScore(s), weight: 0.1, notes, critical: ctx.hungerHigh ? "hunger is high" : adh != null && adh < FOLLOW_LOW ? "they rate their consistency low" : null });
  }

  // how it sits with their training and cardio
  const connections: QualityConnection[] = [];
  if (ctx.lowerPerformance === "down" && deltaPct != null && deltaPct < -10) connections.push({ domain: "training", text: "Lower-body strength is down during a deficit (a pattern, not a confirmed cause)" });
  if (ctx.powerlifter && ctx.meetWeeksOut != null && ctx.meetWeeksOut <= 8 && deltaPct != null && deltaPct < -5) connections.push({ domain: "training", text: `A deficit ${Math.round(ctx.meetWeeksOut)} weeks from the meet: protect training-day carbs` });
  if ((ctx.cardioMinutes ?? 0) >= 150 && deltaPct != null && deltaPct < -20) connections.push({ domain: "cardio", text: `A steep deficit with ${ctx.cardioMinutes} min of cardio a week` });
  if (ctx.direction === "gain" && (ctx.cardioMinutes ?? 0) >= 120) connections.push({ domain: "cardio", text: `${ctx.cardioMinutes} min of cardio a week adds to what a building goal needs to eat` });

  const points = [ctx.direction != null, kg != null, ctx.maintenance != null || (ctx.trend?.clear ?? false), ctx.adherence != null, ctx.checkins >= 2].filter(Boolean).length;
  const missing: string[] = [];
  if (!ctx.direction) missing.push("A bodyweight goal");
  if (!kg) missing.push("A recent bodyweight");
  if (ctx.maintenance == null) missing.push("Enough weigh-ins and check-ins to read maintenance");
  if (ctx.adherence == null) missing.push("Check-in nutrition ratings");
  if (!ctx.hasMeals) missing.push("Meals written on the plan");
  const recovery = recoveryTrend({ lowerPerformance: ctx.lowerPerformance, recoveryFlags: ctx.recoveryFlags });
  return finishQuality(cats, { what: "nutrition plan", points, missing, execution, connections, recovery, settling, changes: ctx.changeLog?.changes, domain: "nutrition", firstName: ctx.firstName });
}

/** A plan day's kind from its label (Training / Rest / High), for the score. */
export function dayKindOf(label: string, useOn?: string | null): NutritionDayIn["kind"] {
  const u = String(useOn ?? "").toLowerCase();
  if (u === "training") return "training";
  if (u === "rest") return "rest";
  if (u === "high") return "high";
  const l = label.toLowerCase();
  if (/high|refeed/.test(l)) return "high";
  if (/non.?training|rest|off/.test(l)) return "rest";
  if (/training|lift|workout/.test(l)) return "training";
  return "other";
}
