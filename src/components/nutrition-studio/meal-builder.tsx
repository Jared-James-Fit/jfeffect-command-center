/**
 * The meals of one plan day, built food by food. It edits the day's own text
 * (the paste format) and hands back new text on every change, so wherever a
 * plan's meals are written (the coach's plan editor, a member's Studio) the
 * same readers keep working. Untouched meals come back exactly as they were.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Bookmark, Copy, Plus, Repeat2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { CardMenu, CardMenuItem, CardMenuSeparator } from "@/components/workout-day/card-menu";
import { cn } from "@/lib/utils";
import {
  dayMacros,
  duplicateMeal,
  itemMacros,
  mealMacros,
  moveMeal,
  newId,
  newMeal,
  readDay,
  readItemLine,
  removeMeal,
  updateMeal,
  writeDay,
  itemLine,
  type Macros,
  type StudioDay,
  type StudioItem,
  type StudioMeal,
  type FoodLookup,
} from "@/lib/nutrition-studio/model";
import type { StudioFood } from "@/lib/nutrition-studio/foods";
import { swapOptions } from "@/lib/nutrition-studio/swaps";
import { MEAL_TIMING_LABEL, type MealTiming } from "@/lib/nutrition-targets/meal-timing";
import { COVER_KCAL_SHARE, COVER_PROTEIN_G } from "@/lib/nutrition-targets/plan-coverage";
import { AmountStep, FoodPicker, unitChoices } from "@/components/nutrition-studio/food-picker";
import { useSaveMealTemplate, useStudioFoods, type SavedMeal } from "@/components/nutrition-studio/use-studio-foods";

export type DayTargets = { calories?: number | null; protein?: number | null; carbs?: number | null; fats?: number | null };

const r = Math.round;

export function MealBuilder({
  notes,
  onChange,
  targets,
  dayLabel,
}: {
  notes: string;
  onChange: (text: string) => void;
  targets?: DayTargets | null;
  dayLabel?: string;
}) {
  const { all, readable, lookup, savedMeals } = useStudioFoods();
  const emitted = useRef<string | null>(null);
  const [day, setDay] = useState<StudioDay>(() => readDay(notes, readable));
  // read the text again only when it changed from outside (another tab, a paste, the AI)
  useEffect(() => {
    if (notes !== emitted.current) setDay(readDay(notes, readable));
    // readable changes once custom foods load: read again so their lines resolve
  }, [notes, readable]);

  const commit = (next: StudioDay) => {
    setDay(next);
    const text = writeDay(next, lookup);
    emitted.current = text;
    onChange(text);
  };

  const [picker, setPicker] = useState<{ mealId: string; replaceId?: string } | null>(null);
  const [swap, setSwap] = useState<{ mealId: string; item: StudioItem } | null>(null);
  const [savedOpen, setSavedOpen] = useState(false);
  const saveTemplate = useSaveMealTemplate();

  const total = useMemo(() => dayMacros(day, lookup), [day, lookup]);

  const setItems = (mealId: string, fn: (items: StudioItem[]) => StudioItem[]) => commit(updateMeal(day, mealId, (m) => ({ ...m, items: fn(m.items) })));

  const removeWithUndo = (meal: StudioMeal) => {
    const before = day;
    commit(removeMeal(day, meal.id));
    toast(`${meal.title} removed`, { action: { label: "Undo", onClick: () => commit(before) } });
  };

  const insertSaved = (s: SavedMeal) => {
    const base = newMeal(day);
    const meal: StudioMeal = { ...base, title: `${base.title} · ${s.name}`, timing: s.timing, items: s.lines.map((l) => readItemLine(l, readable)) };
    commit({ ...day, meals: [...day.meals, meal] });
    setSavedOpen(false);
  };

  return (
    <div className="space-y-3" data-meal-builder>
      <DayBar total={total} targets={targets} />
      {day.lead.trim() && <p className="whitespace-pre-wrap text-[13px] text-muted-foreground">{day.lead}</p>}
      {day.meals.map((meal, idx) => (
        <MealCard
          key={meal.id}
          meal={meal}
          index={idx}
          count={day.meals.length}
          lookup={lookup}
          onTitle={(title) => commit(updateMeal(day, meal.id, (m) => ({ ...m, title })))}
          onTiming={(timing) => commit(updateMeal(day, meal.id, (m) => ({ ...m, timing })))}
          onItems={(fn) => setItems(meal.id, fn)}
          onAddFood={() => setPicker({ mealId: meal.id })}
          onReplace={(item) => setPicker({ mealId: meal.id, replaceId: item.id })}
          onSwap={(item) => setSwap({ mealId: meal.id, item })}
          onDuplicate={() => commit(duplicateMeal(day, meal.id))}
          onMove={(dir) => commit(moveMeal(day, meal.id, dir))}
          onRemove={() => removeWithUndo(meal)}
          onSaveAsMeal={async () => {
            const lines = meal.items.map((i) => itemLine(i, lookup)).filter(Boolean);
            if (!lines.length) return toast.error("Add a food first");
            const m = mealMacros({ ...meal, dirty: true }, lookup);
            const name = meal.title.split(" · ")[1] ?? `${dayLabel ? `${dayLabel} ` : ""}${meal.title}`;
            try {
              await saveTemplate.mutateAsync({ name, lines, timing: meal.timing, kcal: m ? r(m.kcal) : null, protein: m ? r(m.protein) : null, carbs: m ? r(m.carbs) : null, fat: m ? r(m.fat) : null });
              toast.success(`Saved "${name}" to your meals`);
            } catch (e: any) {
              toast.error(e?.message ?? "Couldn't save the meal");
            }
          }}
        />
      ))}
      {day.tail.trim() && <p className="whitespace-pre-wrap text-[13px] text-muted-foreground">{day.tail}</p>}
      <div className="flex gap-2">
        <Button variant="outline" className="h-11 flex-1 gap-1.5" onClick={() => commit({ ...day, meals: [...day.meals, newMeal(day)] })}>
          <Plus className="h-4 w-4" /> Add meal
        </Button>
        {savedMeals.length > 0 && (
          <Button variant="outline" className="h-11 flex-1 gap-1.5" onClick={() => setSavedOpen(true)}>
            <Bookmark className="h-4 w-4" /> Your meals
          </Button>
        )}
      </div>

      <FoodPicker
        open={!!picker}
        onOpenChange={(o) => !o && setPicker(null)}
        foods={all}
        title={picker?.replaceId ? "Replace with a food" : "Add a food"}
        onPick={(p) => {
          if (!picker) return;
          const item: StudioItem = { id: newId("i"), foodId: p.foodId, qty: p.qty, unit: p.unit };
          setItems(picker.mealId, (items) => (picker.replaceId ? items.map((i) => (i.id === picker.replaceId ? item : i)) : [...items, item]));
        }}
      />
      <SwapSheet
        open={!!swap}
        onOpenChange={(o) => !o && setSwap(null)}
        item={swap?.item ?? null}
        lookup={lookup}
        foods={all}
        onPick={(food, qty, unit) => {
          if (!swap) return;
          setItems(swap.mealId, (items) => items.map((i) => (i.id === swap.item.id ? { ...i, foodId: food, qty, unit } : i)));
          setSwap(null);
        }}
      />
      <Sheet open={savedOpen} onOpenChange={setSavedOpen}>
        <SheetContent side="bottom" swipeToClose className="max-h-[80svh] overflow-y-auto rounded-t-2xl">
          <SheetHeader className="text-left">
            <SheetTitle className="text-base">Your meals</SheetTitle>
          </SheetHeader>
          <div className="mt-2 divide-y divide-border">
            {savedMeals.map((s) => (
              <button key={s.id} type="button" onClick={() => insertSaved(s)} className="flex w-full flex-col items-start gap-0.5 px-1 py-3 text-left hover:bg-muted">
                <span className="text-[15px] font-medium">{s.name}</span>
                <span className="text-[12px] text-muted-foreground">
                  {s.kcal != null ? `${s.kcal} kcal · ${s.protein}P ${s.carbs}C ${s.fat}F · ` : ""}
                  {s.lines.slice(0, 3).join(", ")}
                  {s.lines.length > 3 ? "…" : ""}
                </span>
              </button>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** The day's meals against its targets: under 5% (and 10 g of protein) apart is on target. */
function DayBar({ total, targets }: { total: Macros | null; targets?: DayTargets | null }) {
  const tk = targets?.calories ?? null;
  const tp = targets?.protein ?? null;
  const kcalOff = total && tk ? total.kcal - tk : null;
  const proteinShort = total && tp ? tp - total.protein : null;
  const onTarget = kcalOff != null && Math.abs(kcalOff) <= tk! * COVER_KCAL_SHARE && (proteinShort == null || proteinShort <= COVER_PROTEIN_G);
  return (
    <div className="rounded-xl bg-muted/60 px-3 py-2.5 text-[13px] tabular-nums" data-day-bar>
      {total ? (
        <div>
          <span className="font-semibold">{r(total.kcal).toLocaleString()} kcal</span>
          <span className="text-muted-foreground">
            {" "}
            · P {r(total.protein)} · C {r(total.carbs)} · F {r(total.fat)}
          </span>
        </div>
      ) : (
        <div className="text-muted-foreground">Add foods to see the day add up.</div>
      )}
      {tk ? (
        <div className={cn("mt-0.5", onTarget ? "text-success" : "text-muted-foreground")} data-day-vs-target>
          {onTarget
            ? "On target"
            : kcalOff != null
              ? `${Math.abs(r(kcalOff)).toLocaleString()} kcal ${kcalOff > 0 ? "over" : "under"} ${tk.toLocaleString()}${proteinShort != null && proteinShort > COVER_PROTEIN_G ? ` · ${r(proteinShort)} g protein short` : ""}`
              : `Target ${tk.toLocaleString()} kcal`}
        </div>
      ) : null}
    </div>
  );
}

function MealCard({
  meal,
  index,
  count,
  lookup,
  onTitle,
  onTiming,
  onItems,
  onAddFood,
  onReplace,
  onSwap,
  onDuplicate,
  onMove,
  onRemove,
  onSaveAsMeal,
}: {
  meal: StudioMeal;
  index: number;
  count: number;
  lookup: FoodLookup;
  onTitle: (t: string) => void;
  onTiming: (t: MealTiming) => void;
  onItems: (fn: (items: StudioItem[]) => StudioItem[]) => void;
  onAddFood: () => void;
  onReplace: (item: StudioItem) => void;
  onSwap: (item: StudioItem) => void;
  onDuplicate: () => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onSaveAsMeal: () => void;
}) {
  const m = meal.dirty ? mealMacros(meal, lookup) : (meal.written ?? mealMacros(meal, lookup));
  const [title, setTitle] = useState(meal.title);
  useEffect(() => setTitle(meal.title), [meal.title]);
  return (
    <div className="rounded-2xl border border-border bg-card" data-meal-card>
      <div className="flex items-center gap-2 px-3 pt-2.5">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title !== meal.title && onTitle(title.trim())}
          className="h-9 flex-1 border-transparent bg-transparent px-1 text-[15px] font-semibold shadow-none focus-visible:border-border"
          aria-label="Meal name"
          name="search-meal-name"
          autoComplete="off"
        />
        {meal.timing && <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px]">{MEAL_TIMING_LABEL[meal.timing]}</span>}
        <CardMenu name={meal.title} description="Options for this meal" buttonClassName="h-9 w-9" align="end">
          <CardMenuItem onSelect={() => onTiming(meal.timing === "pre" ? null : "pre")}>{meal.timing === "pre" ? "Not pre-workout" : "Pre-workout meal"}</CardMenuItem>
          <CardMenuItem onSelect={() => onTiming(meal.timing === "post" ? null : "post")}>{meal.timing === "post" ? "Not post-workout" : "Post-workout meal"}</CardMenuItem>
          <CardMenuSeparator />
          <CardMenuItem onSelect={onDuplicate}>
            <Copy className="h-4 w-4" /> Duplicate
          </CardMenuItem>
          <CardMenuItem onSelect={onSaveAsMeal}>
            <Bookmark className="h-4 w-4" /> Save to your meals
          </CardMenuItem>
          {index > 0 && (
            <CardMenuItem onSelect={() => onMove(-1)}>
              <ArrowUp className="h-4 w-4" /> Move up
            </CardMenuItem>
          )}
          {index < count - 1 && (
            <CardMenuItem onSelect={() => onMove(1)}>
              <ArrowDown className="h-4 w-4" /> Move down
            </CardMenuItem>
          )}
          <CardMenuSeparator />
          <CardMenuItem onSelect={onRemove} className="text-destructive">
            <Trash2 className="h-4 w-4" /> Remove meal
          </CardMenuItem>
        </CardMenu>
      </div>
      <ul className="px-3 py-1">
        {meal.items.map((it) => (
          <ItemRow
            key={it.id}
            item={it}
            lookup={lookup}
            onChange={(next) => onItems((items) => items.map((x) => (x.id === it.id ? next : x)))}
            onRemove={() => onItems((items) => items.filter((x) => x.id !== it.id))}
            onReplace={() => onReplace(it)}
            onSwap={() => onSwap(it)}
          />
        ))}
        {meal.notes.map((n, i) => (
          <li key={`n${i}`} className="py-1 text-[13px] text-muted-foreground">
            {n}
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2 border-t border-border px-3 py-2">
        <button type="button" onClick={onAddFood} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-[14px] font-medium hover:bg-muted" data-add-food>
          <Plus className="h-4 w-4" /> Add food
        </button>
        <span className="ml-auto text-[12px] tabular-nums text-muted-foreground" data-meal-macros>
          {m ? `${r(m.kcal)} kcal · ${r(m.protein)}P ${r(m.carbs)}C ${r(m.fat)}F` : meal.items.length ? "Macros unknown for a food" : ""}
        </span>
      </div>
    </div>
  );
}

function ItemRow({
  item,
  lookup,
  onChange,
  onRemove,
  onReplace,
  onSwap,
}: {
  item: StudioItem;
  lookup: FoodLookup;
  onChange: (i: StudioItem) => void;
  onRemove: () => void;
  onReplace: () => void;
  onSwap: () => void;
}) {
  const food = item.foodId ? lookup(item.foodId) : null;
  const [qty, setQty] = useState(item.qty != null ? String(item.qty) : "");
  useEffect(() => setQty(item.qty != null ? String(item.qty) : ""), [item.qty]);
  if (!food) {
    return (
      <li className="flex items-center gap-2 py-1.5" data-kept-line>
        <span className="min-w-0 flex-1 text-[14px]">
          {item.text}
          <span className="ml-1.5 text-[11px] text-muted-foreground">not in the food list</span>
        </span>
        <CardMenu name={item.text ?? "Food"} description="Options for this food" buttonClassName="h-8 w-8" align="end">
          <CardMenuItem onSelect={onReplace}>Replace with a food from the list</CardMenuItem>
          <CardMenuItem onSelect={onRemove} className="text-destructive">
            Remove
          </CardMenuItem>
        </CardMenu>
      </li>
    );
  }
  const m = itemMacros(food, item.qty, item.unit);
  const units = unitChoices(food);
  const unitLabel = units.find((u) => u.unit === item.unit)?.label ?? item.unit;
  return (
    <li className="flex items-center gap-2 py-1.5" data-item-row>
      <Input
        value={qty}
        inputMode="decimal"
        onChange={(e) => {
          setQty(e.target.value);
          const n = Number(e.target.value.replace(",", "."));
          if (Number.isFinite(n) && n > 0) onChange({ ...item, qty: n });
        }}
        className="h-9 w-16 px-2 text-right text-[15px] tabular-nums"
        aria-label={`Amount of ${food.name}`}
        name="search-amount"
        autoComplete="off"
      />
      {units.length > 1 ? (
        <button
          type="button"
          className="h-9 min-w-9 shrink-0 rounded-lg px-1.5 text-[13px] text-muted-foreground hover:bg-muted"
          onClick={() => {
            const i = units.findIndex((u) => u.unit === item.unit);
            const next = units[(i + 1) % units.length].unit;
            onChange({ ...item, unit: next });
          }}
          aria-label="Change unit"
        >
          {unitLabel}
        </button>
      ) : (
        <span className="w-9 shrink-0 text-[13px] text-muted-foreground">{unitLabel}</span>
      )}
      <span className="min-w-0 flex-1 truncate text-[14px]">{food.name}</span>
      <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">{m ? `${r(m.kcal)}` : "–"}</span>
      <CardMenu name={food.name} description="Options for this food" buttonClassName="h-8 w-8" align="end">
        <CardMenuItem onSelect={onSwap}>
          <Repeat2 className="h-4 w-4" /> Swap for something like it
        </CardMenuItem>
        <CardMenuItem onSelect={onReplace}>Replace with another food</CardMenuItem>
        <CardMenuItem onSelect={onRemove} className="text-destructive">
          <Trash2 className="h-4 w-4" /> Remove
        </CardMenuItem>
      </CardMenu>
    </li>
  );
}

function SwapSheet({
  open,
  onOpenChange,
  item,
  lookup,
  foods,
  onPick,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  item: StudioItem | null;
  lookup: FoodLookup;
  foods: StudioFood[];
  onPick: (foodId: string, qty: number, unit: StudioItem["unit"]) => void;
}) {
  const current = item?.foodId ? lookup(item.foodId) : null;
  const options = useMemo(() => (item && current ? swapOptions(item, current, foods) : []), [item, current, foods]);
  const [chosen, setChosen] = useState<(typeof options)[number] | null>(null);
  useEffect(() => {
    if (!open) setChosen(null);
  }, [open]);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" swipeToClose className="max-h-[85svh] overflow-y-auto rounded-t-2xl">
        <SheetHeader className="text-left">
          <SheetTitle className="text-base">{chosen ? chosen.food.name : current ? `Instead of ${current.name.toLowerCase()}` : "Swap"}</SheetTitle>
        </SheetHeader>
        {chosen ? (
          <AmountStep food={chosen.food} initial={{ qty: chosen.qty, unit: chosen.unit }} action="Swap" onAdd={(qty, unit) => onPick(chosen.food.id, qty, unit)} />
        ) : (
          <div className="mt-2 divide-y divide-border" data-swap-options>
            {options.map((o) => (
              <button key={o.food.id} type="button" onClick={() => setChosen(o)} className="flex w-full items-center gap-3 px-1 py-3 text-left hover:bg-muted">
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px]">{o.food.name}</span>
                  <span className="text-[12px] text-muted-foreground tabular-nums">
                    {o.unit === "each" ? `${o.qty} ${o.food.each?.word || o.food.perServing?.label || ""}`.trim() : `${o.qty} g`} · {r(o.macros.protein)}P {r(o.macros.carbs)}C {r(o.macros.fat)}F
                  </span>
                </span>
                <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">
                  {o.kcalDelta === 0 ? "same kcal" : `${o.kcalDelta > 0 ? "+" : "−"}${Math.abs(o.kcalDelta)} kcal`}
                </span>
              </button>
            ))}
            {!options.length && <p className="py-4 text-sm text-muted-foreground">Nothing close enough to swap for this one.</p>}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
