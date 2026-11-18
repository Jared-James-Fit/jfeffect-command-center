/**
 * The app's meal plan paste format (MEAL_PLAN_PROMPT's output, or a plan pasted
 * from ChatGPT) read into plan days: one day per "… MENU" section, its numbers
 * from the Daily Total (else the meals' macros summed), its text the meals.
 * For an AI plan, plan-coverage's `planDayNumbers` decides the published
 * numbers (the targets unless the meals cover them); a pasted plan's Daily
 * Total is the coach's own.
 * Pure, so the coach's screens and the server read a plan the same way.
 */
import { plainPastedText } from "@/lib/nutrition-targets/plain-paste";
import { DAILY_TOTAL_HEADING, readDailyTotal, type LineMacros } from "@/lib/nutrition-targets/macro-line";
import { structureMealPlanDay } from "@/lib/nutrition-targets/meal-plan-structure";

export type ParsedDay = {
  day_label: string;
  calories?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fats?: number | null;
  fibre?: number | null;
  notes?: string | null;
  sort_order: number;
};

/** A menu's Daily Total, however it's written (macro-line.ts `readDailyTotal`), else null. */
function dailyTotalOf(body: string): LineMacros | null {
  const lines = body.split("\n");
  const at = lines.findIndex((l) => DAILY_TOTAL_HEADING.test(l));
  return at < 0 ? null : readDailyTotal(lines, at).total;
}

function labelFromHeader(header: string): string {
  const h = header.toUpperCase();
  if (h.includes("NON-TRAINING") || h.includes("REST")) return "Non-Training Day";
  if (h.includes("TRAINING")) return "Training Day";
  if (h.includes("HIGH")) return "High Day";
  if (h.includes("LOW")) return "Low Day";
  if (h.includes("REFEED")) return "Refeed Day";
  // Strip the word MENU and titlecase the rest
  return (
    header
      .replace(/MENU/i, "")
      .trim()
      .replace(/\b\w/g, (m) => m.toUpperCase()) || "Day"
  );
}

/** The trailing FOOD-WEIGHING RULES block (heading included), or null. */
export function parseFoodWeighingRules(text: string): string | null {
  const lines = plainPastedText(text).split("\n");
  const start = lines.findIndex((l) => /^FOOD[- ]?WEIGHING\b/i.test(l.trim()));
  if (start < 0) return null;
  const body = lines
    .slice(start + 1)
    .join("\n")
    .trim();
  return body || null;
}

export function parseMealPlan(text: string): ParsedDay[] {
  if (!text.trim()) return [];
  const lines = plainPastedText(text).split("\n");
  // Find menu section indices
  const sections: { header: string; start: number }[] = [];
  lines.forEach((ln, i) => {
    const t = ln.trim();
    if (/MENU\s*$/i.test(t) && t.length < 80 && !/^meal/i.test(t)) {
      sections.push({ header: t, start: i });
    }
  });
  if (!sections.length) return [];
  const days: ParsedDay[] = [];
  sections.forEach((s, idx) => {
    const end = sections[idx + 1]?.start ?? lines.length;
    // Stop at FOOD-WEIGHING RULES or similar trailing rules block
    let stop = end;
    for (let i = s.start + 1; i < end; i++) {
      if (/^(FOOD[- ]?WEIGHING|RULES|NOTES)\b/i.test(lines[i].trim())) {
        stop = i;
        break;
      }
    }
    const body = lines
      .slice(s.start + 1, stop)
      .join("\n")
      .trim();
    // The Daily Total, else every meal's macros summed (the shared readers: every way macros are written)
    let macros: { protein?: number; carbs?: number; fats?: number; fibre?: number } = {};
    const total = dailyTotalOf(body);
    if (total) {
      macros = { protein: total.protein, carbs: total.carbs, fats: total.fat, fibre: total.fibre };
    } else {
      const meals = structureMealPlanDay(body).meals.filter((m) => m.macros);
      if (meals.length) {
        const sum = (k: "protein" | "carbs" | "fat" | "fibre") => meals.reduce((a, m) => a + (m.macros?.[k] ?? 0), 0);
        macros = {
          protein: sum("protein"),
          carbs: sum("carbs"),
          fats: sum("fat"),
          fibre: meals.some((m) => m.macros?.fibre != null) ? sum("fibre") : undefined,
        };
      }
    }
    const calories =
      macros.protein != null && macros.carbs != null && macros.fats != null
        ? Math.round(macros.protein * 4 + macros.carbs * 4 + macros.fats * 9)
        : null;
    days.push({
      day_label: labelFromHeader(s.header),
      protein: macros.protein ?? null,
      carbs: macros.carbs ?? null,
      fats: macros.fats ?? null,
      fibre: macros.fibre ?? null,
      calories,
      notes: body,
      sort_order: idx,
    });
  });
  return days;
}
