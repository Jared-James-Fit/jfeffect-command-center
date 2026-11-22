/**
 * The nutrition plan PDF (Nov 22 2026), drawn with the JF Effect PDF kit
 * (src/lib/pdf). One document wherever it's downloaded: the client's Meal
 * plan, a member's plan, the coach's Clients ⋯ and the plan's ⋯ on the
 * client's Nutrition tab.
 *
 * First: the plan in brief (phase, goal, the period and when it's next
 * reviewed, coach, water), the daily targets with when each day type is used
 * (`planDayRule`: "Training days · Fri"), the coach's notes, supplements, the
 * food-weighing rules and the disclaimer. Then a section per day type: its
 * targets as tiles and each meal as a table (amounts in a column, the meal's
 * macros and calories on its title line, pre / post-workout named), kept whole
 * on a page.
 *
 * Numbers are the plan's as written: the day's targets from its row, a meal's
 * macros from its own line, its calories worked out from them (4 / 4 / 9, only
 * when all three are written). Nothing is averaged across days and no
 * coverage check is printed (that's the coach's screen, never the client's).
 */
import { PdfDoc, PDF_COLOR, type TableSpec } from "@/lib/pdf/kit";
import { pdfDate, pdfFileName, pdfNumber, pdfRange, pdfText } from "@/lib/pdf/text";
import { deliverPdf, loadPdfLogo } from "@/lib/pdf/deliver";
import { NUTRITION_DISCLAIMER, NUTRITION_DISCLAIMER_TITLE } from "@/lib/nutrition-disclaimer";
import { structureMealPlanDay, type PlanMacros, type PlanMeal } from "@/lib/nutrition-targets/meal-plan-structure";
import { MEAL_TIMING_LABEL } from "@/lib/nutrition-targets/meal-timing";
import { planDayRule, PLAN_DAY_USE_LABEL } from "@/lib/client-nutrition-day";
import { readPlanSupplements } from "@/lib/nutrition-targets/supplements";

type Day = {
  id?: string;
  day_label: string;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fats: number | null;
  fibre?: number | null;
  steps?: number | null;
  notes?: string | null;
  use_on?: string | null;
  weekdays?: string[] | null;
};

export type MealPlanPdfData = {
  client_name?: string | null;
  coach_name?: string | null;
  updated_at?: string | null;
  start_date?: string | null;
  /** When it's next reviewed (the plan's end date). */
  end_date?: string | null;
  phase?: string | null;
  goal?: string | null;
  structure?: string | null;
  water?: string | null;
  sleep?: string | null;
  client_notes?: string | null;
  food_weighing_rules?: string | null;
  /** What the coach published (supplements.ts): { items, notes }. */
  supplements?: unknown;
  disclaimer?: string | null;
  days: Day[];
};

const SHORT_DAY: Record<string, string> = { Monday: "Mon", Tuesday: "Tue", Wednesday: "Wed", Thursday: "Thu", Friday: "Fri", Saturday: "Sat", Sunday: "Sun" };

/** "Training days · Fri", "Rest days", "Every day", "Only when picked"; "" when the plan can't say. */
export function planDayWhen(day: Day, planSize: number): string {
  const rule = planDayRule(day, planSize);
  const use = rule.use ? PLAN_DAY_USE_LABEL[rule.use] : "";
  const days = rule.weekdays.map((d) => SHORT_DAY[d] ?? d).join(", ");
  return [use, days].filter(Boolean).join(" · ");
}

/** A meal's calories from its macros (4 / 4 / 9), only when all three are written. */
export function mealCalories(m: PlanMacros | null): number | null {
  if (!m || m.protein == null || m.carbs == null || m.fat == null) return null;
  return Math.round(m.protein * 4 + m.carbs * 4 + m.fat * 9);
}

const g = (v: number | null | undefined) => (v != null ? `${pdfNumber(Number(v), 0)} g` : null);
const kcal = (v: number | null | undefined) => (v != null ? `${pdfNumber(Number(v), 0)} kcal` : null);

function mealTable(meal: PlanMeal): TableSpec {
  const macros = meal.macros;
  const parts = [
    macros?.protein != null ? `P ${pdfNumber(macros.protein, 0)} g` : null,
    macros?.carbs != null ? `C ${pdfNumber(macros.carbs, 0)} g` : null,
    macros?.fat != null ? `F ${pdfNumber(macros.fat, 0)} g` : null,
  ].filter(Boolean);
  const cal = mealCalories(macros);
  const right = [parts.join(" · "), cal != null ? `${cal} kcal` : null].filter(Boolean).join("  ·  ");
  const title = pdfText(meal.title) + (meal.timing ? ` · ${MEAL_TIMING_LABEL[meal.timing]}` : "");
  return {
    columns: [
      { header: "Amount", width: 92, align: "right", bold: true },
      { header: "Food", width: "auto" },
    ],
    rows: meal.foods.map((f) => [pdfText(f.amount), pdfText(f.name.charAt(0).toUpperCase() + f.name.slice(1))]),
    title: { text: title, right: right || null, rightTone: "muted" },
    footnotes: meal.notes,
    hideHeader: true,
    gapAfter: 10,
  };
}

export function buildMealPlanPdf(data: MealPlanPdfData, opts: { logo?: string | null; generatedAt?: Date; compress?: boolean } = {}): PdfDoc {
  const days = data.days ?? [];
  const phase = pdfText(data.phase);
  const goal = pdfText(data.goal);
  const period = data.start_date && data.end_date ? pdfRange(data.start_date, data.end_date) : data.start_date ? `From ${pdfDate(data.start_date)}` : "";
  const pdf = new PdfDoc({
    kind: "Nutrition plan",
    title: phase ? `${phase}${goal && goal !== phase ? ` · ${goal}` : ""}` : "Nutrition plan",
    subtitle: [period, data.updated_at ? `Updated ${pdfDate(data.updated_at)}` : null].filter(Boolean).join(" · ") || null,
    person: data.client_name ?? null,
    logo: opts.logo,
    generatedAt: opts.generatedAt,
    compress: opts.compress,
    facts: [
      ["For", data.client_name ?? null],
      ["Coach", data.coach_name ?? null],
      ["Next update", data.end_date ? pdfDate(data.end_date) : null],
      ["Water", pdfText(data.water) || null],
    ],
  });

  // ── the plan in brief ──
  if (days.length) {
    const hasFibre = days.some((d) => d.fibre != null);
    const hasSteps = days.some((d) => d.steps != null && Number(d.steps) > 0);
    const columns: TableSpec["columns"] = [
      { header: "Day", width: "auto", bold: true },
      { header: "Calories", width: 62, align: "right" },
      { header: "Protein", width: 52, align: "right" },
      { header: "Carbs", width: 52, align: "right" },
      { header: "Fat", width: 46, align: "right" },
    ];
    if (hasFibre) columns.push({ header: "Fibre", width: 46, align: "right" });
    if (hasSteps) columns.push({ header: "Steps", width: 54, align: "right" });
    const sub = new Map<string, string>();
    const rows = days.map((d, i) => {
      const when = planDayWhen(d, days.length);
      if (when && when.toLowerCase() !== pdfText(d.day_label).toLowerCase()) sub.set(`${i}:0`, when);
      const r: Array<string | null> = [pdfText(d.day_label) || `Day ${i + 1}`, kcal(d.calories), g(d.protein), g(d.carbs), g(d.fats)];
      if (hasFibre) r.push(g(d.fibre));
      if (hasSteps) r.push(d.steps != null && Number(d.steps) > 0 ? pdfNumber(Number(d.steps), 0) : null);
      return r;
    });
    pdf.heading("Daily targets", { keepWith: 80 });
    pdf.table({ columns, rows, sub });
  } else {
    pdf.paragraph("No day targets are set on this plan yet.", { color: PDF_COLOR.muted });
  }

  if (pdfText(data.structure) || pdfText(data.sleep)) {
    pdf.details([
      ["Structure", pdfText(data.structure) || null],
      ["Sleep", pdfText(data.sleep) || null],
    ]);
  }

  if (pdfText(data.client_notes)) {
    pdf.heading("From your coach", { level: 2, keepWith: 40 });
    pdf.paragraph(data.client_notes, { size: 9.25 });
  }

  const supps = readPlanSupplements(data.supplements ?? null);
  if (supps.items.length) {
    pdf.heading("Supplements", { level: 2, keepWith: 60 });
    const notes = new Map<number, string>();
    supps.items.forEach((s, i) => {
      const extra = [pdfText(s.why), pdfText(s.note)].filter(Boolean).join(" ");
      if (extra) notes.set(i, extra);
    });
    pdf.table({
      columns: [
        { header: "Supplement", width: "auto", bold: true },
        { header: "Dose", width: "fit", max: 150 },
        { header: "When", width: "fit", max: 170 },
      ],
      rows: supps.items.map((s) => [pdfText(s.name), pdfText(s.dose) || null, pdfText(s.timing) || null]),
      notes,
      footnotes: supps.notes,
    });
  }

  if (pdfText(data.food_weighing_rules)) {
    pdf.heading("Weighing your food", { level: 2, keepWith: 40 });
    pdf.paragraph(data.food_weighing_rules, { size: 9.25 });
  }
  pdf.gap(4);
  pdf.callout(NUTRITION_DISCLAIMER_TITLE, (data.disclaimer && data.disclaimer.trim()) || NUTRITION_DISCLAIMER, { size: 7.75 });

  // ── each day type: a new page unless a good part of this one is still free ──
  days.forEach((d, i) => {
    const when = planDayWhen(d, days.length);
    const label = pdfText(d.day_label) || `Day ${i + 1}`;
    pdf.heading(label, {
      newPage: pdf.bottom - pdf.y < pdf.pageContentHeight * 0.35,
      right: kcal(d.calories),
      rightTone: "neutral",
      sub: when && when.toLowerCase() !== label.toLowerCase() ? when : null,
    });
    pdf.tiles(
      [
        { label: "Calories", value: d.calories != null ? pdfNumber(Number(d.calories), 0) : "" },
        { label: "Protein", value: g(d.protein) ?? "" },
        { label: "Carbs", value: g(d.carbs) ?? "" },
        { label: "Fat", value: g(d.fats) ?? "" },
        { label: "Fibre", value: g(d.fibre) ?? "" },
        { label: "Steps", value: d.steps != null && Number(d.steps) > 0 ? pdfNumber(Number(d.steps), 0) : "" },
      ],
      { columns: 6 },
    );
    const s = structureMealPlanDay(d.notes);
    if (s.meals.length) {
      for (const meal of s.meals) {
        if (!meal.foods.length) {
          pdf.heading(pdfText(meal.title), { level: 3, right: mealCalories(meal.macros) != null ? `${mealCalories(meal.macros)} kcal` : null, keepWith: 24 });
          if (meal.notes.length) pdf.paragraph(meal.notes.join("\n"), { size: 9, color: PDF_COLOR.muted });
          continue;
        }
        pdf.table(mealTable(meal));
      }
      if (s.notes.length) {
        pdf.heading("Notes", { level: 3, keepWith: 30 });
        pdf.paragraph(s.notes.join("\n"), { size: 9 });
      }
    } else if (pdfText(d.notes)) {
      pdf.paragraph(d.notes, { size: 9.5 });
    } else {
      pdf.paragraph("No meals are written for this day yet.", { color: PDF_COLOR.muted });
    }
  });

  return pdf;
}

/** The plan as jsPDF, uncompressed (tests read its text). */
export function generateMealPlanPdf(data: MealPlanPdfData, logoDataUrl?: string | null) {
  return buildMealPlanPdf(data, { logo: logoDataUrl, compress: false }).finish();
}

/** "jared-mcintyre-nutrition-plan-2026-11-22.pdf". */
export function mealPlanFileName(data: MealPlanPdfData, date = new Date()): string {
  return pdfFileName({ person: data.client_name, document: "nutrition plan", date });
}

/** The plan as a File, for the share sheet (Save to Files, Print, Messages) or a download. */
export async function mealPlanPdfFile(data: MealPlanPdfData): Promise<File> {
  return buildMealPlanPdf(data, { logo: await loadPdfLogo() }).toFile(mealPlanFileName(data));
}

/** Makes the plan's PDF and hands it over (the share sheet on a phone, a download on a computer). */
export async function downloadMealPlanPdf(data: MealPlanPdfData) {
  const file = await mealPlanPdfFile(data);
  return deliverPdf(file, "Nutrition plan");
}
