/**
 * The Food Log: one day of what someone ate, against what the day is aimed
 * at, with the one action that matters (Log food) under it.
 *
 * - The day is the person's own calendar day (food-log.ts), never UTC.
 * - Targets: a coaching client's are the coach's plan day for that date
 *   (FoodLogPlanProvider on the Nutrition page); a member's are their own
 *   suggested targets, read with the day as before.
 * - Logging: from the coach's plan (one tap per meal), a saved meal, a quick
 *   add from a label (calories worked out from the macros when left blank),
 *   or the AI estimate (metered by AI credits). Every log and delete says so
 *   with Undo; a logged meal opens to fix its numbers.
 * - Supplements are a daily checklist (today only), with the coach's picks
 *   one tap away; the week is the 7 days ending on the day shown, each bar a
 *   tap back to that day.
 *
 * Used by the client's Log Food sheet and inline on a member's Nutrition page.
 */

import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { usePovFn } from "@/lib/client-pov-args";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  logMeal,
  updateMeal,
  deleteMeal,
  deletePreset,
  parseMealFromText,
  logSupplement,
  undoSupplementLog,
  upsertSupplement,
  deleteSupplement,
} from "@/lib/nutrition-dashboard.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Check, ChevronLeft, ChevronRight, Loader2, Minus, Pill, Plus, Trash2, Utensils } from "lucide-react";
import { cn } from "@/lib/utils";
import { AiCreditsChip, AiCreditsSheet, AI_CREDITS_KEY, useAiCredits, useSetCreditState } from "@/components/ai-credits/ai-credits";
import { canAfford } from "@/lib/ai-credits/packs";
import { parseLocalDate, todayLocalISO } from "@/lib/today";
import {
  localDayBounds,
  loggedAtFor,
  quickAddCalories,
  shiftDate,
  sumMacros,
  weekDays,
  weekSummary,
  type DayTarget,
  type LoggedMeal,
  type MacroTotals,
  type PlanMeal,
} from "@/lib/food-log";
import { isPlanMealLogged } from "@/lib/food-log-plan";
import { FOOD_LOG_KEY, targetFromDashboard, useFoodLogDay, useFoodLogPlan, useLogFood, type MealToLog } from "./food-log-context";
import { MACRO_COLOR } from "./macro-palette";

const kcal = (v: number) => Math.round(v).toLocaleString("en-CA");
const grams = (v: number) => `${Math.round(v)} g`;

function dayLabel(date: string, today: string): string {
  if (date === today) return "Today";
  if (date === shiftDate(today, -1)) return "Yesterday";
  const d = parseLocalDate(date);
  return d ? format(d, "EEEE") : date;
}

function longDate(date: string): string {
  const d = parseLocalDate(date);
  return d ? format(d, "EEE, MMM d") : date;
}

/** Invalidate every day of the food log (the week chart reads other days too). */
function useRefreshLog() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: [FOOD_LOG_KEY] });
}

export function DailyNutritionPanel() {
  const today = todayLocalISO();
  const [date, setDate] = useState(today);
  const plan = useFoodLogPlan();
  const dashQ = useFoodLogDay(date);
  const refresh = useRefreshLog();

  const data = dashQ.data as any;
  const meals: LoggedMeal[] = useMemo(() => (Array.isArray(data?.meals) ? data.meals : []), [data]);
  const presets: any[] = Array.isArray(data?.presets) ? data.presets : [];
  const supplements: any[] = Array.isArray(data?.supplements) ? data.supplements : [];
  const supplementLogs: any[] = Array.isArray(data?.supplementLogs) ? data.supplementLogs : [];
  const memberTarget = targetFromDashboard(data?.target);
  const pendingTarget = data?.pendingTarget;

  const targetFor = (d: string): DayTarget | null => plan?.targetFor(d) ?? memberTarget;
  const target = targetFor(date);
  const totals = useMemo(() => sumMacros(meals), [meals]);
  const planMeals = plan?.mealsFor(date) ?? [];
  const [logOpen, setLogOpen] = useState(false);

  return (
    <div className="space-y-3">
      <DateStepper date={date} today={today} onChange={setDate} />

      {pendingTarget && !target && (
        <Card className="p-4 text-sm">
          <div className="font-semibold">Your coach is reviewing your targets</div>
          <div className="mt-0.5 text-muted-foreground">You'll see what's left for the day once they're approved.</div>
        </Card>
      )}

      {dashQ.isError ? (
        <Card className="p-4 text-sm">
          <div className="font-semibold">Couldn't load your food log</div>
          <div className="mt-0.5 text-muted-foreground">Check your connection and try again.</div>
          <Button variant="outline" className="mt-3 h-10" onClick={() => void dashQ.refetch()}>
            Try again
          </Button>
        </Card>
      ) : (
        <IntakeCard totals={totals} target={target} loading={dashQ.isLoading} fromPlan={!!plan?.targetFor(date)} />
      )}

      <Button className="h-11 w-full text-base" onClick={() => setLogOpen(true)} disabled={dashQ.isLoading || dashQ.isError}>
        <Plus className="h-4 w-4" /> Log food
      </Button>

      <div className="grid gap-3 md:grid-cols-2">
        <MealsCard meals={meals} isToday={date === today} loading={dashQ.isLoading} onChanged={refresh} />
        <SupplementsCard
          date={date}
          isToday={date === today}
          supplements={supplements}
          logs={supplementLogs}
          suggestions={plan?.supplements ?? []}
          onChanged={refresh}
        />
      </div>

      <WeekCard
        date={date}
        today={today}
        weekMeals={Array.isArray(data?.weekMeals) ? data.weekMeals : []}
        targetFor={targetFor}
        onPick={setDate}
      />

      <LogFoodSheet
        open={logOpen}
        onOpenChange={setLogOpen}
        date={date}
        today={today}
        presets={presets}
        planMeals={planMeals}
        loggedThatDay={meals}
        onLogged={refresh}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function DateStepper({ date, today, onChange }: { date: string; today: string; onChange: (d: string) => void }) {
  const isToday = date === today;
  return (
    <div className="flex items-center gap-2" data-food-log-date>
      <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0" aria-label="Previous day" onClick={() => onChange(shiftDate(date, -1))}>
        <ChevronLeft className="h-5 w-5" />
      </Button>
      <div className="min-w-0 flex-1 text-center">
        <div className="text-base font-semibold leading-tight">{dayLabel(date, today)}</div>
        <div className="text-xs text-muted-foreground">
          {longDate(date)}
          {!isToday && (
            <>
              {" · "}
              <button type="button" className="font-semibold text-foreground underline underline-offset-2" onClick={() => onChange(today)}>
                Back to today
              </button>
            </>
          )}
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-10 w-10 shrink-0"
        aria-label="Next day"
        disabled={isToday}
        onClick={() => onChange(shiftDate(date, 1))}
      >
        <ChevronRight className="h-5 w-5" />
      </Button>
    </div>
  );
}

function IntakeCard({
  totals,
  target,
  loading,
  fromPlan,
}: {
  totals: MacroTotals;
  target: DayTarget | null;
  loading: boolean;
  fromPlan: boolean;
}) {
  if (loading) {
    return (
      <Card className="space-y-3 p-4" aria-label="Loading">
        <div className="h-5 w-32 jf-skeleton rounded bg-muted" />
        <div className="h-2 w-full jf-skeleton rounded-full bg-muted" />
        <div className="h-16 w-full jf-skeleton rounded bg-muted" />
      </Card>
    );
  }
  const kcalTarget = target?.calories ?? null;
  const left = kcalTarget != null ? kcalTarget - totals.calories : null;
  return (
    <Card className="space-y-3 p-4" data-food-log-intake>
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-xs text-muted-foreground">Calories</div>
          <div className="text-2xl font-semibold leading-none tabular-nums">
            {kcal(totals.calories)}
            {kcalTarget != null && <span className="text-base font-normal text-muted-foreground"> / {kcal(kcalTarget)}</span>}
          </div>
        </div>
        {left != null && (
          <div className="text-right text-sm tabular-nums">
            <span className="font-semibold">{kcal(Math.abs(left))}</span>{" "}
            <span className="text-muted-foreground">{left >= 0 ? "left" : "over"}</span>
          </div>
        )}
      </div>
      {kcalTarget != null && <Bar value={totals.calories} max={kcalTarget} color="var(--foreground)" />}

      <div className="space-y-2.5 pt-1">
        <MacroLine label="Protein" value={totals.protein} max={target?.protein ?? null} color={MACRO_COLOR.protein} />
        <MacroLine label="Carbs" value={totals.carbs} max={target?.carbs ?? null} color={MACRO_COLOR.carbs} />
        <MacroLine label="Fat" value={totals.fat} max={target?.fat ?? null} color={MACRO_COLOR.fats} />
      </div>

      <p className="text-xs text-muted-foreground">
        {target
          ? fromPlan
            ? `${target.label || "Today's"} targets from your coach's plan`
            : "Your daily targets"
          : "No targets yet: what you log still adds up here."}
      </p>
    </Card>
  );
}

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="presentation">
      <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

function MacroLine({ label, value, max, color }: { label: string; value: number; max: number | null; color: string }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums">
          <span className="font-semibold">{Math.round(value)}</span>
          <span className="text-muted-foreground">{max != null ? ` / ${Math.round(max)} g` : " g"}</span>
        </span>
      </div>
      {max != null && <Bar value={value} max={max} color={color} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function SectionTitle({ icon, title, right }: { icon: ReactNode; title: string; right?: ReactNode }) {
  return (
    <div className="mb-2 flex min-h-8 items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground" aria-hidden>
          {icon}
        </span>
        <div className="text-base font-semibold">{title}</div>
      </div>
      {right}
    </div>
  );
}

function macroLine(m: { calories: unknown; protein_g: unknown; carbs_g: unknown; fat_g: unknown }) {
  const num = (v: unknown) => Math.round(Number(v) || 0);
  return `${kcal(num(m.calories))} kcal · P ${num(m.protein_g)} · C ${num(m.carbs_g)} · F ${num(m.fat_g)}`;
}

function MealsCard({
  meals,
  isToday,
  loading,
  onChanged,
}: {
  meals: LoggedMeal[];
  isToday: boolean;
  loading: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<LoggedMeal | null>(null);
  return (
    <Card className="p-4" data-food-log-meals>
      <SectionTitle
        icon={<Utensils className="h-4 w-4" />}
        title="Meals"
        right={meals.length > 0 ? <span className="text-xs text-muted-foreground">{meals.length} logged</span> : null}
      />
      {loading ? (
        <div className="h-12 jf-skeleton rounded-lg bg-muted" />
      ) : meals.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {isToday ? "Nothing logged yet. Tap Log food after you eat." : "Nothing logged on this day."}
        </p>
      ) : (
        <ul className="-mx-1 divide-y divide-border">
          {meals.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => setEditing(m)}
                className="flex min-h-12 w-full items-center gap-3 rounded-lg px-1 py-2 text-left transition hover:bg-muted/50 active:bg-muted"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{m.name}</span>
                  <span className="block text-xs text-muted-foreground tabular-nums">
                    {m.logged_at ? format(new Date(m.logged_at), "h:mm a") : "—"} · {macroLine(m)}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <EditMealSheet meal={editing} onClose={() => setEditing(null)} onChanged={onChanged} />
    </Card>
  );
}

type MacroDraft = { name: string; calories: string; protein: string; carbs: string; fat: string };
const draftOf = (m: LoggedMeal): MacroDraft => ({
  name: m.name,
  calories: String(Math.round(Number(m.calories) || 0)),
  protein: String(Math.round(Number(m.protein_g) || 0)),
  carbs: String(Math.round(Number(m.carbs_g) || 0)),
  fat: String(Math.round(Number(m.fat_g) || 0)),
});
const numOf = (s: string) => Math.max(0, Number(s) || 0);

function MacroFields({ value, onChange, autoCalories }: { value: MacroDraft; onChange: (v: MacroDraft) => void; autoCalories?: boolean }) {
  const computed = quickAddCalories("", value.protein, value.carbs, value.fat);
  const field = (key: keyof MacroDraft, label: string, unit: string, placeholder?: string) => (
    <div>
      <Label htmlFor={`fl-${key}`} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <div className="relative mt-1">
        <Input
          id={`fl-${key}`}
          inputMode="decimal"
          value={value[key]}
          placeholder={placeholder ?? "0"}
          onChange={(e) => onChange({ ...value, [key]: e.target.value.replace(/[^0-9.]/g, "") })}
          className="h-11 pr-11 tabular-nums"
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">{unit}</span>
      </div>
    </div>
  );
  return (
    <div className="grid grid-cols-2 gap-3">
      {field("protein", "Protein", "g")}
      {field("carbs", "Carbs", "g")}
      {field("fat", "Fat", "g")}
      {field("calories", "Calories", "kcal", autoCalories && computed > 0 ? String(computed) : "0")}
    </div>
  );
}

function EditMealSheet({ meal, onClose, onChanged }: { meal: LoggedMeal | null; onClose: () => void; onChanged: () => void }) {
  const update = usePovFn(useServerFn(updateMeal));
  const del = usePovFn(useServerFn(deleteMeal));
  const log = usePovFn(useServerFn(logMeal));
  const [draft, setDraft] = useState<MacroDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const current = draft ?? (meal ? draftOf(meal) : null);

  const close = () => {
    setDraft(null);
    onClose();
  };

  const save = async () => {
    if (!meal || !current) return;
    setBusy(true);
    try {
      await update({
        data: {
          id: meal.id,
          name: current.name.trim() || meal.name,
          calories: quickAddCalories(current.calories, current.protein, current.carbs, current.fat),
          protein_g: numOf(current.protein),
          carbs_g: numOf(current.carbs),
          fat_g: numOf(current.fat),
        },
      });
      toast.success("Saved");
      onChanged();
      close();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save that");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!meal) return;
    setBusy(true);
    const was = meal;
    try {
      await del({ data: { id: was.id } });
      onChanged();
      close();
      toast(`Removed ${was.name}`, {
        action: {
          label: "Undo",
          onClick: () => {
            void log({
              data: {
                name: was.name,
                calories: Math.round(Number(was.calories) || 0),
                protein_g: Number(was.protein_g) || 0,
                carbs_g: Number(was.carbs_g) || 0,
                fat_g: Number(was.fat_g) || 0,
                source: "manual",
                logged_at: new Date(was.logged_at).toISOString(),
              },
            }).then(onChanged, (e: any) => toast.error(e?.message ?? "Couldn't put it back"));
          },
        },
      });
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't remove that");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={!!meal} onOpenChange={(o) => !o && close()}>
      <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:mx-auto sm:max-w-lg sm:rounded-t-2xl">
        <SheetHeader>
          <SheetTitle>Edit meal</SheetTitle>
        </SheetHeader>
        {current && (
          <div className="space-y-4">
            <div>
              <Label htmlFor="fl-edit-name" className="text-xs text-muted-foreground">
                Name
              </Label>
              <Input id="fl-edit-name" className="mt-1 h-11" value={current.name} maxLength={120} onChange={(e) => setDraft({ ...current, name: e.target.value })} />
            </div>
            <MacroFields value={current} onChange={setDraft} autoCalories />
            <Button className="h-11 w-full" onClick={save} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save
            </Button>
            <Button variant="ghost" className="h-11 w-full text-destructive hover:text-destructive" onClick={remove} disabled={busy}>
              <Trash2 className="h-4 w-4" /> Remove from log
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */

function LogFoodSheet({
  open,
  onOpenChange,
  date,
  today,
  presets,
  planMeals,
  loggedThatDay,
  onLogged,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  date: string;
  today: string;
  presets: any[];
  planMeals: PlanMeal[];
  loggedThatDay: LoggedMeal[];
  onLogged: () => void;
}) {
  const removePreset = usePovFn(useServerFn(deletePreset));
  const parse = useServerFn(parseMealFromText);
  const qc = useQueryClient();

  const [quick, setQuick] = useState<MacroDraft>({ name: "", calories: "", protein: "", carbs: "", fat: "" });
  const [saveQuick, setSaveQuick] = useState(false);
  const [aiText, setAiText] = useState("");
  const [aiResult, setAiResult] = useState<MacroDraft | null>(null);
  const [saveAi, setSaveAi] = useState(false);
  const [busy, setBusy] = useState(false);
  const credits = useAiCredits(open);
  const setCreditState = useSetCreditState();
  const [creditsSheet, setCreditsSheet] = useState<null | "info" | "out">(null);

  const tabs = [...(planMeals.length ? ["plan"] : []), "saved", "quick", "ai"] as const;
  const defaultTab = planMeals.length ? "plan" : presets.length ? "saved" : "quick";
  const [tab, setTab] = useState<string>(defaultTab);
  // a fresh open starts on the most useful tab
  const onOpen = (v: boolean) => {
    if (v) setTab(defaultTab);
    onOpenChange(v);
  };

  const when = loggedAtFor(date, today);

  const logFood = useLogFood();
  /** Log one meal, close, and say so with Undo. */
  const submit = async (meal: Omit<MealToLog, "logged_at">) => {
    setBusy(true);
    const ok = await logFood({ ...meal, logged_at: when });
    setBusy(false);
    if (ok) onOpenChange(false);
    return ok;
  };

  const parseM = useMutation({
    mutationFn: () => parse({ data: { text: aiText } }),
    onSuccess: (r: any) => {
      setCreditState(r.credits);
      if (!r.ok) {
        setCreditsSheet("out");
        return;
      }
      setAiResult({
        name: r.name,
        calories: String(Math.round(r.calories)),
        protein: String(Math.round(r.protein_g)),
        carbs: String(Math.round(r.carbs_g)),
        fat: String(Math.round(r.fat_g)),
      });
    },
    onError: (e: any) => {
      toast.error(e?.message ?? "Couldn't estimate that. No credit was used.");
      void qc.invalidateQueries({ queryKey: [AI_CREDITS_KEY] });
    },
  });
  const estimate = () => {
    if (credits.data && !canAfford(credits.data, "meal_estimate")) {
      setCreditsSheet("out");
      return;
    }
    parseM.mutate();
  };

  const quickName = quick.name.trim() || "Quick add";
  const quickKcal = quickAddCalories(quick.calories, quick.protein, quick.carbs, quick.fat);
  const quickEmpty = !quick.calories && !quick.protein && !quick.carbs && !quick.fat;

  const tabLabel: Record<string, string> = { plan: "Your plan", saved: "Saved", quick: "Quick add", ai: "Describe" };

  return (
    <Sheet open={open} onOpenChange={onOpen}>
      <SheetContent
        side="bottom"
        className="h-[88dvh] overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:mx-auto sm:max-w-lg sm:rounded-t-2xl"
      >
        <SheetHeader>
          <SheetTitle>Log food</SheetTitle>
          {date !== today && <p className="text-xs text-muted-foreground">For {longDate(date)}</p>}
        </SheetHeader>
        <Tabs value={tab} onValueChange={setTab} className="mt-1">
          <TabsList className="grid h-10 w-full" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
            {tabs.map((t) => (
              <TabsTrigger key={t} value={t} className="h-8 px-1 text-[13px]">
                {tabLabel[t]}
              </TabsTrigger>
            ))}
          </TabsList>

          {planMeals.length > 0 && (
            <TabsContent value="plan" className="mt-4 space-y-2">
              <p className="text-xs text-muted-foreground">Tap a meal you ate. Ate more or less? Log it, then tap it in Meals to change the numbers.</p>
              {planMeals.map((m, i) => {
                const done = isPlanMealLogged(m, loggedThatDay);
                return (
                  <button
                    key={`${m.name}-${i}`}
                    type="button"
                    disabled={busy}
                    onClick={() => void submit({ ...m, source: "preset", raw_text: "From the coach's meal plan" })}
                    className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-left transition hover:bg-muted/50 active:bg-muted disabled:opacity-60"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{m.name}</span>
                      <span className="block text-xs text-muted-foreground tabular-nums">{macroLine(m)}</span>
                    </span>
                    {done ? (
                      <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-success">
                        <Check className="h-4 w-4" /> Logged
                      </span>
                    ) : (
                      <Plus className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                    )}
                  </button>
                );
              })}
            </TabsContent>
          )}

          <TabsContent value="saved" className="mt-4 space-y-2">
            {presets.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                Meals you eat often show up here. Tick <span className="font-medium text-foreground">Save for next time</span> when you log one.
              </p>
            ) : (
              presets.map((p) => (
                <div key={p.id} className="flex items-center gap-1 rounded-xl border border-border bg-card">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void submit({
                        name: p.name,
                        calories: Math.round(Number(p.calories) || 0),
                        protein_g: Number(p.protein_g) || 0,
                        carbs_g: Number(p.carbs_g) || 0,
                        fat_g: Number(p.fat_g) || 0,
                        source: "preset",
                        preset_id: p.id,
                      })
                    }
                    className="flex min-h-14 min-w-0 flex-1 flex-col justify-center rounded-xl px-3 py-2.5 text-left transition hover:bg-muted/50 active:bg-muted disabled:opacity-60"
                  >
                    <span className="block truncate text-sm font-semibold">{p.name}</span>
                    <span className="block text-xs text-muted-foreground tabular-nums">{macroLine(p)}</span>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="mr-1 h-10 w-10 shrink-0 text-muted-foreground"
                    aria-label={`Remove ${p.name} from saved meals`}
                    onClick={() =>
                      void removePreset({ data: { id: p.id } }).then(
                        () => {
                          onLogged();
                          toast(`Removed ${p.name} from saved meals`);
                        },
                        () => toast.error("Couldn't remove it"),
                      )
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))
            )}
          </TabsContent>

          <TabsContent value="quick" className="mt-4 space-y-4">
            <div>
              <Label htmlFor="fl-quick-name" className="text-xs text-muted-foreground">
                What was it?
              </Label>
              <Input
                id="fl-quick-name"
                className="mt-1 h-11"
                placeholder="Chicken & rice"
                maxLength={120}
                value={quick.name}
                onChange={(e) => setQuick({ ...quick, name: e.target.value })}
              />
            </div>
            <MacroFields value={quick} onChange={setQuick} autoCalories />
            <p className="-mt-2 text-xs text-muted-foreground">Leave calories blank and they're worked out from the macros.</p>
            <SaveForNext id="fl-save-quick" checked={saveQuick} onChange={setSaveQuick} />
            <Button
              className="h-11 w-full"
              disabled={busy || quickEmpty}
              onClick={async () => {
                const ok = await submit({
                  name: quickName,
                  calories: quickKcal,
                  protein_g: numOf(quick.protein),
                  carbs_g: numOf(quick.carbs),
                  fat_g: numOf(quick.fat),
                  source: "manual",
                  save_as_preset: saveQuick,
                });
                if (ok) {
                  setQuick({ name: "", calories: "", protein: "", carbs: "", fat: "" });
                  setSaveQuick(false);
                }
              }}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Log {quickEmpty ? "" : `${kcal(quickKcal)} kcal`}
            </Button>
          </TabsContent>

          <TabsContent value="ai" className="mt-4 space-y-4">
            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <Label htmlFor="ai-meal-text" className="text-xs text-muted-foreground">
                  Describe what you ate
                </Label>
                <AiCreditsChip state={credits.data} onClick={() => setCreditsSheet("info")} />
              </div>
              <Input
                id="ai-meal-text"
                className="h-11"
                value={aiText}
                maxLength={500}
                onChange={(e) => setAiText(e.target.value)}
                placeholder="2 eggs, 2 slices toast, black coffee"
              />
            </div>
            {!aiResult && (
              <Button onClick={estimate} disabled={parseM.isPending || aiText.trim().length < 2} className="h-11 w-full">
                {parseM.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {parseM.isPending ? "Estimating…" : "Estimate the macros"}
              </Button>
            )}
            {aiResult && (
              <div className="space-y-4 rounded-xl border border-border p-3">
                <div>
                  <div className="text-xs text-muted-foreground">Estimate: check it, fix anything that's off</div>
                  <Input
                    aria-label="Name"
                    className="mt-1 h-11"
                    value={aiResult.name}
                    maxLength={120}
                    onChange={(e) => setAiResult({ ...aiResult, name: e.target.value })}
                  />
                </div>
                <MacroFields value={aiResult} onChange={setAiResult} />
                <SaveForNext id="fl-save-ai" checked={saveAi} onChange={setSaveAi} />
                <div className="flex gap-2">
                  <Button variant="outline" className="h-11 flex-1" onClick={() => setAiResult(null)} disabled={busy}>
                    Start over
                  </Button>
                  <Button
                    className="h-11 flex-1"
                    disabled={busy}
                    onClick={async () => {
                      const ok = await submit({
                        name: aiResult.name.trim() || "Meal",
                        calories: quickAddCalories(aiResult.calories, aiResult.protein, aiResult.carbs, aiResult.fat),
                        protein_g: numOf(aiResult.protein),
                        carbs_g: numOf(aiResult.carbs),
                        fat_g: numOf(aiResult.fat),
                        source: "ai",
                        raw_text: aiText,
                        save_as_preset: saveAi,
                      });
                      if (ok) {
                        setAiText("");
                        setAiResult(null);
                        setSaveAi(false);
                      }
                    }}
                  >
                    Log it
                  </Button>
                </div>
              </div>
            )}
            <p className="text-xs text-muted-foreground">An estimate from what you typed. Weights and brands make it more accurate.</p>
          </TabsContent>
        </Tabs>
        <AiCreditsSheet
          open={creditsSheet !== null}
          onOpenChange={(o) => !o && setCreditsSheet(null)}
          out={creditsSheet === "out"}
          feature="meal_estimate"
        />
      </SheetContent>
    </Sheet>
  );
}

function SaveForNext({ id, checked, onChange }: { id: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label htmlFor={id} className="flex min-h-10 cursor-pointer items-center gap-3 text-sm">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        className="h-5 w-5 rounded-md data-[state=checked]:border-foreground data-[state=checked]:bg-foreground data-[state=checked]:text-background"
      />
      Save for next time
    </label>
  );
}

/* ------------------------------------------------------------------ */

function SupplementsCard({
  date,
  isToday,
  supplements,
  logs,
  suggestions,
  onChanged,
}: {
  date: string;
  isToday: boolean;
  supplements: any[];
  logs: any[];
  suggestions: string[];
  onChanged: () => void;
}) {
  const log = usePovFn(useServerFn(logSupplement));
  const undo = usePovFn(useServerFn(undoSupplementLog));
  const up = usePovFn(useServerFn(upsertSupplement));
  const [pending, setPending] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<any | null>(null);

  const have = new Set(supplements.map((s) => String(s.name).trim().toLowerCase()));
  const toAdd = suggestions.filter((n) => n.trim() && !have.has(n.trim().toLowerCase())).slice(0, 6);

  const step = async (s: any, dir: 1 | -1) => {
    setPending(s.id);
    try {
      if (dir === 1) await log({ data: { supplement_id: s.id, supplement_name: s.name } });
      else {
        const { start, end } = localDayBounds(date);
        await undo({ data: { supplement_id: s.id, supplement_name: s.name, dayStart: start, dayEnd: end } });
      }
      onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't update that");
    } finally {
      setPending(null);
    }
  };

  const addNamed = async (name: string) => {
    try {
      await up({ data: { name, daily_target_count: 1, active: true } });
      onChanged();
      toast.success(`Added ${name}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't add it");
    }
  };

  return (
    <Card className="p-4" data-food-log-supplements>
      <SectionTitle
        icon={<Pill className="h-4 w-4" />}
        title="Supplements"
        right={
          <Button variant="ghost" size="sm" className="h-9 px-2" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        }
      />
      {supplements.length === 0 ? (
        <p className="text-sm text-muted-foreground">Tick off what you take each day (creatine, vitamin D…).</p>
      ) : (
        <ul className="-mx-1 divide-y divide-border">
          {supplements.map((s) => {
            const count = logs.filter((l) => l.supplement_id === s.id).length;
            const goal = Math.max(1, Number(s.daily_target_count) || 1);
            const done = count >= goal;
            const busy = pending === s.id;
            return (
              <li key={s.id} className="flex min-h-12 items-center gap-2 px-1 py-1.5">
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{s.name}</span>
                  <span className={cn("block text-xs", done ? "text-success" : "text-muted-foreground")}>
                    {goal === 1 ? (done ? "Taken" : isToday ? "Not yet today" : "Not taken") : `${count} of ${goal}`}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 shrink-0 text-muted-foreground"
                  aria-label={`Stop tracking ${s.name}`}
                  onClick={() => setRemoving(s)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
                {goal === 1 ? (
                  <button
                    type="button"
                    disabled={!isToday || busy}
                    aria-pressed={done}
                    aria-label={done ? `Untick ${s.name}` : `Took ${s.name}`}
                    onClick={() => void step(s, done ? -1 : 1)}
                    className={cn(
                      "grid h-10 w-10 shrink-0 place-items-center rounded-full border transition disabled:opacity-50",
                      done ? "border-success bg-success text-white" : "border-border bg-background text-muted-foreground",
                    )}
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-5 w-5" />}
                  </button>
                ) : (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-10 w-10"
                      disabled={!isToday || busy || count === 0}
                      aria-label={`One less ${s.name}`}
                      onClick={() => void step(s, -1)}
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className={cn("h-10 w-10", done && "border-success text-success")}
                      disabled={!isToday || busy}
                      aria-label={`Took a ${s.name}`}
                      onClick={() => void step(s, 1)}
                    >
                      {done ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!isToday && supplements.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Ticked off for today only.</p>}
      {toAdd.length > 0 && (
        <div className="mt-3">
          <div className="mb-1.5 text-xs text-muted-foreground">From your coach's plan</div>
          <div className="flex flex-wrap gap-1.5">
            {toAdd.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => void addNamed(n)}
                className="inline-flex h-9 items-center gap-1 rounded-full border border-border px-3 text-sm transition hover:bg-muted active:bg-muted"
              >
                <Plus className="h-3.5 w-3.5" /> {n}
              </button>
            ))}
          </div>
        </div>
      )}
      <AddSupplementSheet open={adding} onOpenChange={setAdding} onAdded={onChanged} />
      <RemoveSupplementDialog supplement={removing} onClose={() => setRemoving(null)} onRemoved={onChanged} />
    </Card>
  );
}

function AddSupplementSheet({ open, onOpenChange, onAdded }: { open: boolean; onOpenChange: (v: boolean) => void; onAdded: () => void }) {
  const [name, setName] = useState("");
  const [count, setCount] = useState(1);
  const up = usePovFn(useServerFn(upsertSupplement));
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await up({ data: { name: name.trim(), daily_target_count: count, active: true } });
      toast.success(`Added ${name.trim()}`);
      setName("");
      setCount(1);
      onOpenChange(false);
      onAdded();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:mx-auto sm:max-w-lg sm:rounded-t-2xl">
        <SheetHeader>
          <SheetTitle>Add a supplement</SheetTitle>
        </SheetHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="fl-supp-name" className="text-xs text-muted-foreground">
              Name
            </Label>
            <Input id="fl-supp-name" className="mt-1 h-11" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Creatine" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Times a day</div>
            <div className="mt-1 grid grid-cols-4 gap-2" role="radiogroup" aria-label="Times a day">
              {[1, 2, 3, 4].map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={count === c}
                  onClick={() => setCount(c)}
                  className={cn(
                    "h-11 rounded-lg border text-sm font-semibold transition",
                    count === c ? "border-foreground bg-foreground text-background" : "border-border bg-background",
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
          <Button onClick={save} disabled={busy || !name.trim()} className="h-11 w-full">
            Add
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function RemoveSupplementDialog({ supplement, onClose, onRemoved }: { supplement: any | null; onClose: () => void; onRemoved: () => void }) {
  const del = usePovFn(useServerFn(deleteSupplement));
  const mutation = useMutation({
    mutationFn: () => del({ data: { id: supplement.id } }),
    onSuccess: () => {
      toast.success(`Removed ${supplement.name}`);
      onClose();
      onRemoved();
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't remove"),
  });
  return (
    <AlertDialog open={!!supplement} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Stop tracking {supplement?.name}?</AlertDialogTitle>
          <AlertDialogDescription>It comes off your daily checklist. What you've already ticked off stays in your history.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={mutation.isPending}>Keep it</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              mutation.mutate();
            }}
            disabled={mutation.isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {mutation.isPending ? "Removing…" : "Stop tracking"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* ------------------------------------------------------------------ */

function WeekCard({
  date,
  today,
  weekMeals,
  targetFor,
  onPick,
}: {
  date: string;
  today: string;
  weekMeals: LoggedMeal[];
  targetFor: (d: string) => DayTarget | null;
  onPick: (d: string) => void;
}) {
  const days = weekDays(date, weekMeals, targetFor);
  const sum = weekSummary(days);
  const scale = Math.max(1, ...days.map((d) => d.calories), ...days.map((d) => d.target ?? 0)) * 1.08;
  const title = date === today ? "Last 7 days" : `7 days to ${longDate(date)}`;

  return (
    <Card className="p-4" data-food-log-week>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <div className="text-base font-semibold">{title}</div>
        {sum.withTarget > 0 && <div className="text-xs text-muted-foreground">Dashes are your targets</div>}
      </div>
      <div className="flex h-28 items-end gap-1.5" role="list" aria-label="Calories logged each day">
        {days.map((d) => {
          const near = d.target != null && d.meals > 0 && Math.abs(d.calories - d.target) <= d.target * 0.1;
          const selected = d.date === date;
          const label = parseLocalDate(d.date);
          return (
            <button
              key={d.date}
              type="button"
              role="listitem"
              onClick={() => onPick(d.date)}
              aria-label={`${longDate(d.date)}: ${d.meals ? `${kcal(d.calories)} kcal, ${Math.round(d.protein)} g protein` : "nothing logged"}`}
              aria-current={selected ? "date" : undefined}
              className="relative flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
            >
              <div className="relative flex w-full flex-1 items-end">
                {d.target != null && d.target > 0 && (
                  <div
                    className="absolute inset-x-0 border-t-2 border-dashed border-muted-foreground/50"
                    style={{ bottom: `${(d.target / scale) * 100}%` }}
                    aria-hidden
                  />
                )}
                {d.meals > 0 ? (
                  <div
                    className={cn("w-full rounded-t-md", near ? "bg-success" : selected ? "bg-foreground" : "bg-muted-foreground/45")}
                    style={{ height: `${Math.max(4, (d.calories / scale) * 100)}%` }}
                  />
                ) : (
                  <div className="mx-auto mb-0.5 h-1.5 w-1.5 rounded-full bg-muted" aria-hidden />
                )}
              </div>
              <span
                className={cn(
                  "grid h-6 w-6 place-items-center rounded-full text-[11px] tabular-nums",
                  selected ? "bg-foreground font-semibold text-background" : "text-muted-foreground",
                )}
              >
                {label ? format(label, "EEEEE") : ""}
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        {sum.logged === 0
          ? "Nothing logged these 7 days."
          : `Average ${kcal(sum.avgCalories)} kcal · ${grams(sum.avgProtein)} protein on ${sum.logged} logged ${sum.logged === 1 ? "day" : "days"}${
              sum.withTarget > 0 ? ` · ${sum.onTarget} of ${sum.withTarget} within 10% of target` : ""
            }.`}
      </p>
    </Card>
  );
}
