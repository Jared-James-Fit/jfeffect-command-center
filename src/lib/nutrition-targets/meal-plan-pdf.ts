/**
 * Branded JF Effect meal plan PDF (A4).
 *
 * Page 1: client overview, daily targets table, food-weighing rules and
 * coach notes. Then one page per day type: macro tiles and each meal as a
 * card (foods with amounts in a column, per-meal macros in the header).
 * Disclaimer always prints at the end. Cards never split awkwardly: a card
 * that doesn't fit moves to the next page; a card taller than a page flows.
 */
import { jsPDF } from "jspdf";
import { NUTRITION_DISCLAIMER, NUTRITION_DISCLAIMER_TITLE } from "@/lib/nutrition-disclaimer";
import { macroSummary, structureMealPlanDay, type PlanMeal } from "@/lib/nutrition-targets/meal-plan-structure";
import { MEAL_TIMING_LABEL } from "@/lib/nutrition-targets/meal-timing";

type Day = {
  id?: string;
  day_label: string;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fats: number | null;
  fibre?: number | null;
  notes?: string | null;
};

export type MealPlanPdfData = {
  client_name?: string | null;
  coach_name?: string | null;
  updated_at?: string | null;
  start_date?: string | null;
  phase?: string | null;
  goal?: string | null;
  structure?: string | null;
  water?: string | null;
  sleep?: string | null;
  client_notes?: string | null;
  food_weighing_rules?: string | null;
  disclaimer?: string | null;
  days: Day[];
};

type RGB = [number, number, number];
const INK: RGB = [17, 17, 20];
const RED: RGB = [239, 51, 64];
const MUTED: RGB = [110, 114, 124];
const LINE: RGB = [228, 230, 235];
const SOFT: RGB = [246, 246, 248];
const RED_SOFT: RGB = [253, 236, 238];

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString("en-CA", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

/** jsPDF's Helvetica is Latin-1 only. */
const clean = (s: string) =>
  String(s ?? "")
    .replace(/≈/g, "~")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x00-\xFF—–·×…]/g, "")
    .trim();

export function generateMealPlanPdf(data: MealPlanPdfData, logoDataUrl?: string | null): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const mx = 40;
  const cw = W - mx * 2;
  const bottom = H - 56;
  let y = 0;

  const color = (c: RGB, kind: "text" | "fill" | "draw" = "text") => {
    if (kind === "text") doc.setTextColor(c[0], c[1], c[2]);
    else if (kind === "fill") doc.setFillColor(c[0], c[1], c[2]);
    else doc.setDrawColor(c[0], c[1], c[2]);
  };
  const font = (style: "normal" | "bold" | "italic", size: number, c: RGB = INK) => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    color(c);
  };

  const header = () => {
    color(INK, "fill");
    doc.rect(0, 0, W, 64, "F");
    color(RED, "fill");
    doc.rect(0, 64, W, 3, "F");
    let x = mx;
    if (logoDataUrl) {
      try {
        doc.addImage(logoDataUrl, "PNG", mx, 14, 36, 36);
        x = mx + 46;
      } catch { /* logo is optional */ }
    }
    font("bold", 17, [255, 255, 255]);
    doc.text("JF EFFECT", x, 32);
    font("normal", 8, [170, 170, 178]);
    doc.text("N U T R I T I O N   P L A N", x, 46);
    if (data.client_name) {
      font("bold", 11, [255, 255, 255]);
      doc.text(clean(data.client_name), W - mx, 32, { align: "right" });
    }
    font("normal", 8, [170, 170, 178]);
    doc.text(`Updated ${fmtDate(data.updated_at)}`, W - mx, 46, { align: "right" });
  };
  const newPage = () => {
    doc.addPage();
    header();
    y = 92;
  };
  const ensure = (need: number) => {
    if (y + need > bottom) newPage();
  };
  const sectionTitle = (t: string) => {
    ensure(30);
    color(RED, "fill");
    doc.rect(mx, y - 9, 3, 12, "F");
    font("bold", 10, INK);
    doc.text(t.toUpperCase(), mx + 10, y);
    y += 14;
  };
  const textBlock = (text: string, size = 9.5, c: RGB = [55, 58, 66], style: "normal" | "italic" = "normal") => {
    font(style, size, c);
    const lh = size * 1.35;
    for (const line of doc.splitTextToSize(clean(text), cw) as string[]) {
      ensure(lh);
      doc.text(line, mx, y);
      y += lh;
    }
  };

  // ── Page 1: overview ────────────────────────────────────────────────
  header();
  y = 104;
  font("bold", 22, INK);
  doc.text(clean(data.client_name || "Your Nutrition Plan"), mx, y);
  y += 20;

  const phase = [data.phase, data.goal && data.goal !== data.phase ? data.goal : null].filter(Boolean).join(" · ");
  const chips = [
    phase ? `Phase: ${phase}` : null,
    data.structure ? `Structure: ${data.structure}` : null,
    `Start: ${fmtDate(data.start_date)}`,
    data.coach_name ? `Coach: ${data.coach_name}` : null,
    data.water ? `Water: ${data.water}` : null,
    data.sleep ? `Sleep: ${data.sleep}` : null,
  ].filter(Boolean) as string[];
  font("bold", 8.5, [70, 72, 80]);
  let cx = mx;
  for (const chip of chips) {
    const t = clean(chip);
    const w = doc.getTextWidth(t) + 16;
    if (cx + w > W - mx) { cx = mx; y += 22; }
    color(SOFT, "fill");
    color(LINE, "draw");
    doc.roundedRect(cx, y - 11, w, 17, 8.5, 8.5, "FD");
    doc.text(t, cx + 8, y);
    cx += w + 6;
  }
  y += 30;

  // Daily targets table
  sectionTitle("Daily targets");
  const cols = [
    { label: "Day", w: 0.32, align: "left" as const },
    { label: "Calories", w: 0.16 },
    { label: "Protein", w: 0.13 },
    { label: "Carbs", w: 0.13 },
    { label: "Fat", w: 0.13 },
    { label: "Fibre", w: 0.13 },
  ];
  const rowH = 24;
  color(INK, "fill");
  doc.roundedRect(mx, y, cw, rowH, 5, 5, "F");
  doc.rect(mx, y + rowH - 6, cw, 6, "F");
  font("bold", 8, [255, 255, 255]);
  let tx = mx;
  for (const c of cols) {
    const colW = c.w * cw;
    if (c.align === "left") doc.text(c.label.toUpperCase(), tx + 10, y + 15.5);
    else doc.text(c.label.toUpperCase(), tx + colW / 2, y + 15.5, { align: "center" });
    tx += colW;
  }
  y += rowH;
  data.days.forEach((d, i) => {
    color(i % 2 ? [255, 255, 255] : SOFT, "fill");
    doc.rect(mx, y, cw, rowH, "F");
    const vals = [
      d.day_label || "Day",
      d.calories != null ? `${d.calories}` : "—",
      d.protein != null ? `${d.protein} g` : "—",
      d.carbs != null ? `${d.carbs} g` : "—",
      d.fats != null ? `${d.fats} g` : "—",
      d.fibre != null ? `${d.fibre} g` : "—",
    ];
    let x = mx;
    cols.forEach((c, ci) => {
      const colW = c.w * cw;
      if (ci === 0) {
        font("bold", 9.5, INK);
        doc.text(clean(vals[ci]), x + 10, y + 15.5);
      } else {
        font(ci === 1 ? "bold" : "normal", 9.5, ci === 1 ? RED : INK);
        doc.text(vals[ci], x + colW / 2, y + 15.5, { align: "center" });
      }
      x += colW;
    });
    y += rowH;
  });
  color(LINE, "draw");
  doc.roundedRect(mx, y - rowH * (data.days.length + 1), cw, rowH * (data.days.length + 1), 5, 5, "S");
  y += 26;

  if (data.food_weighing_rules?.trim()) {
    sectionTitle("Food-weighing rules");
    textBlock(data.food_weighing_rules);
    y += 14;
  }
  if (data.client_notes?.trim()) {
    sectionTitle("Coach notes");
    textBlock(data.client_notes);
    y += 14;
  }

  // ── One page per day ────────────────────────────────────────────────
  const mealCard = (meal: PlanMeal) => {
    const foodH = 16;
    const noteLines = meal.notes.flatMap((n) => doc.splitTextToSize(clean(n), cw - 36) as string[]);
    const h = 30 + meal.foods.length * foodH + noteLines.length * 12 + 2;
    if (h < bottom - 92) ensure(h + 10);
    const top = y;
    // header strip
    color(SOFT, "fill");
    color(LINE, "draw");
    doc.roundedRect(mx, top, cw, h, 7, 7, "FD");
    color(RED_SOFT, "fill");
    doc.roundedRect(mx, top, cw, 24, 7, 7, "F");
    doc.rect(mx, top + 14, cw, 10, "F");
    font("bold", 9.5, RED);
    const titleText = clean(meal.title).toUpperCase();
    doc.text(titleText, mx + 12, top + 16);
    if (meal.timing) {
      // Pre / Post-Workout pill next to the meal title.
      const label = MEAL_TIMING_LABEL[meal.timing].toUpperCase();
      const px = mx + 12 + doc.getTextWidth(titleText) + 8;
      font("bold", 7, [255, 255, 255]);
      const pw = doc.getTextWidth(label) + 12;
      color(meal.timing === "post" ? [16, 140, 96] : [214, 120, 18], "fill");
      doc.roundedRect(px, top + 7, pw, 13, 6.5, 6.5, "F");
      doc.text(label, px + 6, top + 16);
    }
    const ms = macroSummary(meal.macros);
    if (ms) {
      font("bold", 8.5, [90, 50, 55]);
      doc.text(ms, W - mx - 12, top + 16, { align: "right" });
    }
    y = top + 24 + 15;
    meal.foods.forEach((f, i) => {
      if (i > 0) {
        color(LINE, "draw");
        doc.line(mx + 12, y - 11, W - mx - 12, y - 11);
      }
      font("bold", 9.5, INK);
      doc.text(clean(f.amount), mx + 74, y, { align: "right" });
      font("normal", 9.5, [40, 42, 48]);
      doc.text(clean(f.name.charAt(0).toUpperCase() + f.name.slice(1)), mx + 86, y);
      y += foodH;
    });
    for (const n of noteLines) {
      font("italic", 8.5, MUTED);
      doc.text(n, mx + 12, y);
      y += 12;
    }
    y = top + h + 10;
  };

  for (const day of data.days) {
    newPage();
    // Day title + macro tiles
    color(RED, "fill");
    doc.rect(mx, y - 14, 4, 20, "F");
    font("bold", 18, INK);
    doc.text(clean(day.day_label || "Day").toUpperCase(), mx + 12, y + 2);
    y += 18;
    const tiles: [string, string][] = [
      ["Calories", day.calories != null ? `${day.calories}` : "—"],
      ["Protein", day.protein != null ? `${day.protein} g` : "—"],
      ["Carbs", day.carbs != null ? `${day.carbs} g` : "—"],
      ["Fat", day.fats != null ? `${day.fats} g` : "—"],
      ["Fibre", day.fibre != null ? `${day.fibre} g` : "—"],
    ];
    const gap = 8;
    const tw = (cw - gap * (tiles.length - 1)) / tiles.length;
    tiles.forEach(([label, val], i) => {
      const x = mx + i * (tw + gap);
      color(i === 0 ? INK : SOFT, "fill");
      color(i === 0 ? INK : LINE, "draw");
      doc.roundedRect(x, y, tw, 46, 7, 7, "FD");
      font("bold", 15, i === 0 ? [255, 255, 255] : INK);
      doc.text(val, x + tw / 2, y + 22, { align: "center" });
      font("bold", 7, i === 0 ? [190, 190, 198] : MUTED);
      doc.text(label.toUpperCase(), x + tw / 2, y + 36, { align: "center" });
    });
    y += 64;

    const s = structureMealPlanDay(day.notes);
    if (s.meals.length) {
      s.meals.forEach(mealCard);
      if (s.notes.length) {
        sectionTitle("Notes");
        textBlock(s.notes.join("\n"));
      }
    } else if (day.notes?.trim()) {
      textBlock(day.notes);
    }
  }

  // ── Disclaimer ──────────────────────────────────────────────────────
  {
    const text = (data.disclaimer && data.disclaimer.trim()) || NUTRITION_DISCLAIMER;
    const lines = doc.splitTextToSize(clean(text), cw - 24) as string[];
    const h = 34 + lines.length * 9.6;
    y += 6;
    ensure(h);
    color([250, 250, 251], "fill");
    color(LINE, "draw");
    doc.roundedRect(mx, y, cw, h, 7, 7, "FD");
    font("bold", 8.5, [60, 62, 70]);
    doc.text(NUTRITION_DISCLAIMER_TITLE.toUpperCase(), mx + 12, y + 17);
    font("italic", 8, MUTED);
    doc.setLineHeightFactor(1.2);
    doc.text(lines, mx + 12, y + 30);
    doc.setLineHeightFactor(1.15);
    y += h;
  }

  // Footer on every page
  const pages = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    color(LINE, "draw");
    doc.line(mx, H - 38, W - mx, H - 38);
    font("normal", 7.5, [150, 152, 160]);
    doc.text(`JF Effect · Nutrition plan${data.client_name ? ` for ${clean(data.client_name)}` : ""}`, mx, H - 24);
    doc.text(`${i} / ${pages}`, W - mx, H - 24, { align: "right" });
  }
  return doc;
}

async function loadLogo(): Promise<string | null> {
  try {
    const res = await fetch("/logo.png");
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(typeof r.result === "string" ? r.result : null);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function downloadMealPlanPdf(data: MealPlanPdfData) {
  const doc = generateMealPlanPdf(data, await loadLogo());
  const safeName = (data.client_name || "meal-plan")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  doc.save(`${safeName || "meal-plan"}-jf-effect-nutrition-plan.pdf`);
}
