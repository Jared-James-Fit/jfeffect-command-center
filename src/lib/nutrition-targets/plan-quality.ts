/**
 * Nutrition plan quality (Nov 23 2026): how well a client's current plan suits
 * them, by category (goal, calories, macros, performance, recovery,
 * sustainability, their food), from the plan's own numbers and what's on file:
 * bodyweight and its trend, the maintenance their results imply, check-in
 * adherence and hunger, training days, allergies and diets. Deterministic,
 * pure and tested (nutrition-plan-quality.test.ts); see plan-quality.ts for
 * what the score is and isn't.
 */
import { bandOf, combine, confidenceFrom, optimizeAsk, summaryOf, clampScore, type QualityCategory, type QualityScore } from "@/lib/plan-quality";

export type NutritionDayIn = {
  label: string;
  kcal: number | null;
  protein: number | null;
  carbs: number | null;
  fats: number | null;
  kind: "training" | "rest" | "high" | "other";
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
};

const kcalOf = (d: NutritionDayIn) => (d.protein != null && d.carbs != null && d.fats != null ? d.protein * 4 + d.carbs * 4 + d.fats * 9 : null);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const r1 = (n: number) => Math.round(n * 10) / 10;

export function scoreNutritionPlan(days: NutritionDayIn[], ctx: NutritionScoreContext): QualityScore {
  const cats: QualityCategory[] = [];
  const kg = ctx.bodyweightKg && ctx.bodyweightKg > 30 ? ctx.bodyweightKg : null;
  const withKcal = days.filter((d) => (d.kcal ?? 0) > 0);
  const floor = ctx.sex === "F" ? 1200 : 1500;
  const training = days.filter((d) => d.kind === "training" || d.kind === "high");
  const rest = days.filter((d) => d.kind === "rest");
  const weekly = ctx.weeklyKcal ?? avg(withKcal.map((d) => d.kcal as number));
  const deltaPct = ctx.maintenance && weekly ? ((weekly - ctx.maintenance) / ctx.maintenance) * 100 : null;

  // Goal alignment
  {
    const notes: string[] = [];
    let s: number | null = null;
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
    }
    if (ctx.direction && ctx.trendStatus && ctx.trendStatus !== "not_enough_data" && ctx.trendStatus !== "no_target") {
      const t = ctx.trendStatus;
      const trendScore = t === "on_track" || t === "ahead" || t === "reached" ? 95 : t === "behind" || t === "stalled" ? 70 : t === "wrong_way" ? 55 : null;
      if (trendScore != null) {
        s = s == null ? trendScore : Math.round((s + trendScore) / 2);
        notes.push(t === "on_track" || t === "ahead" || t === "reached" ? "Bodyweight is moving the way the goal needs" : t === "wrong_way" ? "Bodyweight is moving the wrong way" : "Bodyweight is behind the goal");
      }
    }
    cats.push({ key: "goal", label: "Goal alignment", score: s == null ? null : clampScore(s), weight: 0.2, notes });
  }

  // Calorie appropriateness
  {
    const notes: string[] = [];
    let s: number | null = withKcal.length ? 100 : null;
    if (s != null) {
      const under = withKcal.filter((d) => (d.kcal as number) < floor);
      if (under.length) {
        s -= 35;
        notes.push(`${under.map((d) => d.label).join(", ")} under ${floor.toLocaleString("en-US")} kcal`);
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
      }
      if (!notes.length) notes.push("Every day adds up and stays above the floor");
    }
    cats.push({ key: "calories", label: "Calorie appropriateness", score: s == null ? null : clampScore(s), weight: 0.18, notes });
  }

  // Macronutrient distribution
  {
    const notes: string[] = [];
    let s: number | null = null;
    const pDays = withKcal.filter((d) => d.protein != null && d.fats != null && d.carbs != null);
    if (pDays.length && kg) {
      s = 100;
      const protein = avg(pDays.map((d) => d.protein as number))!;
      const gkg = protein / kg;
      if (gkg < 1.2) {
        s -= 30;
        notes.push(`Protein ${r1(gkg)} g/kg is low (1.6–2.2 supports muscle)`);
      } else if (gkg < 1.6) {
        s -= 15;
        notes.push(`Protein ${r1(gkg)} g/kg (1.6–2.2 supports muscle)`);
      } else if (gkg > 3) {
        s -= 10;
        notes.push(`Protein ${r1(gkg)} g/kg is more than needed`);
      }
      const fat = avg(pDays.map((d) => d.fats as number))!;
      const fatPct = avg(pDays.map((d) => ((d.fats as number) * 9) / (d.kcal as number)))!;
      if (fat / kg < 0.6) {
        s -= 15;
        notes.push(`Fat ${r1(fat / kg)} g/kg is under 0.6`);
      } else if (fatPct < 0.2) {
        s -= 10;
        notes.push(`Fat is ${Math.round(fatPct * 100)}% of calories`);
      }
      const tc = training.filter((d) => d.carbs != null);
      if (tc.length && ctx.trainingDays > 0) {
        const c = avg(tc.map((d) => d.carbs as number))! / kg;
        if (c < 2) {
          s -= 10;
          notes.push(`Training-day carbs ${r1(c)} g/kg`);
        }
      }
      if (!notes.length) notes.push(`Protein ${r1(gkg)} g/kg, fat and carbs in range`);
    } else if (pDays.length) {
      notes.push("No recent bodyweight to judge grams per kilo");
    }
    cats.push({ key: "macros", label: "Macronutrient distribution", score: s == null ? null : clampScore(s), weight: 0.16, notes });
  }

  // Performance support
  {
    const notes: string[] = [];
    let s: number | null = null;
    if (ctx.trainingDays > 0 && training.length && kg) {
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
      if (tCarb != null) {
        const need = ctx.powerlifter && ctx.meetWeeksOut != null && ctx.meetWeeksOut <= 8 ? 3 : 2;
        if (tCarb / kg < need) {
          s -= 15;
          notes.push(`Training-day carbs ${r1(tCarb / kg)} g/kg (about ${need}+ fuels hard sessions)`);
        }
      }
      if (!notes.length) notes.push("Training days are fuelled");
    } else if (!ctx.trainingDays) notes.push("Their training days aren't set");
    cats.push({ key: "performance", label: "Performance support", score: s == null ? null : clampScore(s), weight: 0.14, notes });
  }

  // Recovery support
  {
    const notes: string[] = [];
    let s: number | null = withKcal.length ? 100 : null;
    if (s != null) {
      if (ctx.recoveryFlags >= 2 && deltaPct != null && deltaPct < -10) {
        s -= 20;
        notes.push("A deficit while sleep, energy or recovery are flagged");
      }
      const prot = kg ? avg(withKcal.filter((d) => d.protein != null).map((d) => (d.protein as number) / kg)) : null;
      if (prot != null && prot < 1.4) {
        s -= 15;
        notes.push("Protein is too low to support recovery");
      }
      if (!notes.length) notes.push(ctx.recoveryFlags >= 2 ? "Recovery is flagged, but the plan isn't the likely reason" : "Supports recovery");
    }
    cats.push({ key: "recovery", label: "Recovery support", score: s == null ? null : clampScore(s), weight: 0.12, notes });
  }

  // Sustainability
  {
    const notes: string[] = [];
    let s: number | null = withKcal.length ? 100 : null;
    if (s != null) {
      if (ctx.adherence != null) {
        s = ctx.adherence >= 4 ? 100 : ctx.adherence >= 3 ? 80 : 60;
        notes.push(`Check-in consistency ${ctx.adherence}/5`);
      }
      if (ctx.hungerHigh) {
        s -= 15;
        notes.push("Hunger is high");
      }
      const ks = withKcal.map((d) => d.kcal as number);
      if (ks.length >= 2 && Math.max(...ks) - Math.min(...ks) > 900) {
        s -= 10;
        notes.push(`A ${Math.max(...ks) - Math.min(...ks)} kcal swing between days`);
      }
      if (!notes.length) notes.push("Nothing flags it as hard to keep");
    }
    cats.push({ key: "sustain", label: "Sustainability", score: s == null ? null : clampScore(s), weight: 0.12, notes });
  }

  // Dietary preference compatibility
  {
    const notes: string[] = [];
    let s: number | null = null;
    if (ctx.hasMeals) {
      s = 100;
      if (ctx.conflicts.length) {
        s = Math.max(0, 100 - 40 * ctx.conflicts.length);
        notes.push(`Against what's on file: ${ctx.conflicts.slice(0, 3).join(", ")}`);
      } else notes.push(ctx.restrictions ? "Clear of every allergy and diet on file" : "No allergies or diets on file");
    } else notes.push("No meals written to check");
    cats.push({ key: "food", label: "Dietary preference compatibility", score: s, weight: 0.08, notes });
  }

  const score = combine(cats);
  const judged = cats.filter((c) => c.score != null).length;
  const points = [ctx.direction != null, kg != null, ctx.maintenance != null || (ctx.trend?.clear ?? false), ctx.adherence != null, ctx.checkins >= 2].filter(Boolean).length;
  const missing: string[] = [];
  if (!ctx.direction) missing.push("A bodyweight goal");
  if (!kg) missing.push("A recent bodyweight");
  if (ctx.maintenance == null) missing.push("Enough weigh-ins and check-ins to read maintenance");
  if (ctx.adherence == null) missing.push("Check-in nutrition ratings");
  return {
    score: judged ? score : null,
    band: bandOf(judged ? score : null),
    confidence: confidenceFrom(points, judged, cats.length),
    summary: summaryOf(cats, judged ? score : null),
    categories: cats,
    missing,
    optimize: optimizeAsk(cats, "nutrition plan"),
  };
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
