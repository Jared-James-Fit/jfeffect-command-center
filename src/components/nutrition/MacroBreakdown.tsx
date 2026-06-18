import { Card } from "@/components/ui/card";
import { Beef, Wheat, Cookie } from "lucide-react";
import type { NutritionTargets } from "./NutritionDashboard";

/**
 * Visual macro split: shows each macronutrient's share of total calories
 * as a stacked bar plus per-macro breakdown (grams, kcal, %).
 * Uses standard Atwater factors: protein 4, carbs 4, fat 9 kcal/g.
 */

function toNum(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

export function MacroBreakdown({ targets }: { targets?: NutritionTargets }) {
  const protein = toNum(targets?.protein);
  const carbs = toNum(targets?.carbs);
  const fats = toNum(targets?.fats);
  const calories = toNum(targets?.calories);

  if (protein == null || carbs == null || fats == null) return null;

  const pKcal = protein * 4;
  const cKcal = carbs * 4;
  const fKcal = fats * 9;
  const totalKcal = pKcal + cKcal + fKcal || 1;

  const pct = (k: number) => Math.round((k / totalKcal) * 100);
  const pPct = pct(pKcal);
  const cPct = pct(cKcal);
  const fPct = 100 - pPct - cPct;

  const rows = [
    { label: "Protein", icon: Beef, grams: protein, kcal: pKcal, pct: pPct, color: "hsl(346 77% 50%)" },
    { label: "Carbs", icon: Wheat, grams: carbs, kcal: cKcal, pct: cPct, color: "hsl(38 92% 50%)" },
    { label: "Fats", icon: Cookie, grams: fats, kcal: fKcal, pct: fPct, color: "hsl(217 91% 60%)" },
  ];

  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <div className="text-sm font-bold uppercase tracking-wide">Macro split</div>
        <div className="text-[11px] text-muted-foreground">
          {Math.round(totalKcal)} kcal from macros
          {calories && Math.abs(calories - totalKcal) > 25 ? (
            <span className="ml-1 text-amber-500">· {calories} target</span>
          ) : null}
        </div>
      </div>
      <div className="mb-4 flex h-3 w-full overflow-hidden rounded-full bg-secondary">
        {rows.map((r) => (
          <div
            key={r.label}
            style={{ width: `${r.pct}%`, backgroundColor: r.color }}
            title={`${r.label} ${r.pct}%`}
          />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {rows.map((r) => (
          <div key={r.label} className="rounded-lg border border-border/60 bg-secondary/30 p-3">
            <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
              <r.icon className="h-3.5 w-3.5" style={{ color: r.color }} />
              {r.label}
            </div>
            <div className="mt-1 text-lg font-black leading-none">{r.pct}%</div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {Math.round(r.grams)}g · {Math.round(r.kcal)} kcal
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}