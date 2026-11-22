/**
 * Add a food to a meal: search everything (their own foods first), pick one,
 * set the amount in the way it's measured, see what it adds, Add. A food that
 * isn't there is added from its label in the same sheet.
 */
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Plus, Search } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { searchFoods } from "@/lib/nutrition-studio/search";
import type { StudioFood } from "@/lib/nutrition-studio/foods";
import { amountProblem, itemMacros, type StudioUnit } from "@/lib/nutrition-studio/model";
import { CustomFoodForm } from "@/components/nutrition-studio/custom-food-form";

export type PickedFood = { foodId: string; qty: number; unit: StudioUnit };

const SOURCE_WORD: Record<StudioFood["source"], string> = { label: "Your food", usda: "", recipe: "Recipe" };

/** The amount a food starts at (a convenience: they change it). */
export function startAmount(f: StudioFood): { qty: number; unit: StudioUnit } {
  if (f.perServing && !f.per100) return { qty: 1, unit: "each" };
  if (f.each && f.each.grams >= 25) return { qty: f.id === "b:eggs" ? 2 : 1, unit: "each" };
  if (f.id === "b:oats") return { qty: 60, unit: "g" };
  if (/_dry$/.test(f.id)) return { qty: 60, unit: "g" };
  switch (f.category) {
    case "protein":
      return { qty: 150, unit: "g" };
    case "carb":
      return { qty: 150, unit: "g" };
    case "dairy":
      return { qty: 170, unit: "g" };
    case "fat":
      return f.tbspGrams ? { qty: 1, unit: "tbsp" } : { qty: 15, unit: "g" };
    case "veg":
    case "fruit":
      return { qty: 100, unit: "g" };
    default:
      return { qty: 15, unit: "g" };
  }
}

export function unitChoices(f: StudioFood): Array<{ unit: StudioUnit; label: string }> {
  const out: Array<{ unit: StudioUnit; label: string }> = [];
  if (f.each || f.perServing) out.push({ unit: "each", label: f.each?.word || f.perServing?.label || "each" });
  if (f.per100) out.push({ unit: "g", label: "g" });
  if (f.per100 && f.tbspGrams) out.push({ unit: "tbsp", label: "tbsp" }, { unit: "tsp", label: "tsp" });
  if (f.per100 && /milk|egg_whites/.test(f.id)) out.push({ unit: "ml", label: "ml" });
  return out;
}

export function FoodPicker({
  open,
  onOpenChange,
  foods,
  onPick,
  title = "Add a food",
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  foods: StudioFood[];
  onPick: (p: PickedFood) => void;
  title?: string;
}) {
  const [q, setQ] = useState("");
  const [chosen, setChosen] = useState<StudioFood | null>(null);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    if (!open) {
      setQ("");
      setChosen(null);
      setAdding(false);
    }
  }, [open]);
  const results = useMemo(() => searchFoods(q, foods, 60), [q, foods]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" swipeToClose className="flex max-h-[88svh] flex-col gap-0 rounded-t-2xl p-0">
        <SheetHeader className="border-b border-border px-4 pb-3 pt-4 text-left">
          <SheetTitle className="flex items-center gap-2 text-base">
            {(chosen || adding) && (
              <button type="button" aria-label="Back" className="-ml-1 grid h-9 w-9 place-items-center rounded-lg hover:bg-muted" onClick={() => (adding ? setAdding(false) : setChosen(null))}>
                <ChevronLeft className="h-5 w-5" />
              </button>
            )}
            {adding ? "Add your own food" : chosen ? chosen.name : title}
          </SheetTitle>
        </SheetHeader>
        {adding ? (
          <div className="overflow-y-auto px-4 py-4">
            <CustomFoodForm
              initialName={q}
              onSaved={(f) => {
                setAdding(false);
                setChosen(f);
              }}
            />
          </div>
        ) : chosen ? (
          <AmountStep
            food={chosen}
            onAdd={(qty, unit) => {
              onPick({ foodId: chosen.id, qty, unit });
              onOpenChange(false);
            }}
          />
        ) : (
          <>
            <div className="px-4 pt-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search foods, your foods or recipes"
                  className="h-11 pl-9 text-base"
                  name="search-food"
                  autoComplete="off"
                />
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2" data-food-results>
              {results.map((f) => {
                const per = f.per100;
                return (
                  <button key={f.id} type="button" onClick={() => setChosen(f)} className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-muted">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px]">{f.name}</div>
                      <div className="text-[12px] text-muted-foreground">
                        {[
                          SOURCE_WORD[f.source],
                          per ? `${Math.round(per[0])} kcal · ${fmt(per[1])}P ${fmt(per[2])}C ${fmt(per[3])}F per 100 g` : f.perServing ? `${Math.round(f.perServing.kcal)} kcal · ${fmt(f.perServing.protein)}P per ${f.perServing.label}` : "",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </div>
                  </button>
                );
              })}
              {q.trim() && !results.length && <p className="px-2 py-4 text-sm text-muted-foreground">Nothing called that yet.</p>}
            </div>
            <div className="border-t border-border px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <Button variant="outline" className="h-11 w-full gap-1.5" onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" /> Add your own food from its label
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

const fmt = (n: number) => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10);

export function AmountStep({ food, onAdd, initial, action = "Add" }: { food: StudioFood; onAdd: (qty: number, unit: StudioUnit) => void; initial?: { qty: number; unit: StudioUnit }; action?: string }) {
  const start = initial ?? startAmount(food);
  const [unit, setUnit] = useState<StudioUnit>(start.unit);
  const [qtyText, setQtyText] = useState(String(start.qty));
  const qty = Number(qtyText.replace(",", "."));
  const problem = amountProblem(Number.isFinite(qty) ? qty : null, unit);
  const m = !problem ? itemMacros(food, qty, unit) : null;
  const choices = unitChoices(food);
  return (
    <div className="space-y-4 px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="flex items-end gap-2">
        <div className="w-28 space-y-1.5">
          <label className="text-[13px] text-muted-foreground" htmlFor="studio-amount">Amount</label>
          <Input id="studio-amount" inputMode="decimal" value={qtyText} onChange={(e) => setQtyText(e.target.value)} className="h-11 text-base tabular-nums" autoFocus />
        </div>
        <div className="flex flex-wrap gap-1.5 pb-0.5">
          {choices.map((c) => (
            <button
              key={c.unit}
              type="button"
              onClick={() => setUnit(c.unit)}
              className={cn("h-10 rounded-lg border px-3 text-sm", unit === c.unit ? "border-foreground bg-foreground text-background" : "border-border")}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
      <div className="rounded-xl bg-muted/60 px-3 py-2.5 text-sm tabular-nums" data-amount-macros>
        {m ? (
          <>
            <span className="font-semibold">{Math.round(m.kcal)} kcal</span>
            <span className="text-muted-foreground"> · {Math.round(m.protein)} g protein · {Math.round(m.carbs)} g carbs · {Math.round(m.fat)} g fat</span>
          </>
        ) : (
          <span className="text-muted-foreground">{problem ?? "Enter an amount"}</span>
        )}
      </div>
      {food.source === "usda" && <p className="text-[12px] text-muted-foreground">USDA values, {/raw|dry/i.test(food.name) ? "as weighed" : "cooked weight unless it says otherwise"}.</p>}
      <Button className="h-11 w-full" disabled={!m} onClick={() => m && onAdd(qty, unit)}>
        {action}
      </Button>
    </div>
  );
}
