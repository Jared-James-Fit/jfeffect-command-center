/**
 * The app's meal plan paste format (MEAL_PLAN_PROMPT's output, or a plan pasted
 * from ChatGPT) read into plan days: one day per "… MENU" section, its numbers
 * from the Daily Total (else the meals' macros summed), its text the meals.
 * Pure, so the coach's screens and the server read a plan the same way.
 */
import { plainPastedText } from "@/lib/nutrition-targets/plain-paste";

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

function parseMacroLine(line: string): {
  protein?: number;
  carbs?: number;
  fats?: number;
  fibre?: number;
} {
  const out: any = {};
  const p = line.match(/(\d+(?:\.\d+)?)\s*g?\s*protein/i);
  const c = line.match(/(\d+(?:\.\d+)?)\s*g?\s*(?:carb|carbohydrate)/i);
  const f = line.match(/(\d+(?:\.\d+)?)\s*g?\s*fat/i);
  const fb = line.match(/(\d+(?:\.\d+)?)\s*g?\s*fibre|fiber/i);
  if (p) out.protein = Number(p[1]);
  if (c) out.carbs = Number(c[1]);
  if (f) out.fats = Number(f[1]);
  if (fb) out.fibre = Number(fb[1]);
  return out;
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
    // Find Daily Total macros
    const totalMatch = body.match(
      /Daily\s+Total[\s\S]*?(Approximately[^\n]+|\d[^\n]*protein[^\n]+)/i,
    );
    let macros: any = {};
    if (totalMatch) {
      macros = parseMacroLine(totalMatch[1]);
    } else {
      // Sum each "Approximate macros" block
      const matches = [...body.matchAll(/Approximate macros?:?\s*\n([\s\S]*?)(?=\n\s*\n|$)/gi)];
      let p = 0,
        c = 0,
        f = 0,
        fb = 0,
        any = false;
      for (const m of matches) {
        const got = parseMacroLine(m[1].replace(/\n/g, " "));
        if (got.protein) {
          p += got.protein;
          any = true;
        }
        if (got.carbs) {
          c += got.carbs;
          any = true;
        }
        if (got.fats) {
          f += got.fats;
          any = true;
        }
        if (got.fibre) {
          fb += got.fibre;
          any = true;
        }
      }
      if (any) macros = { protein: p, carbs: c, fats: f, fibre: fb };
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
