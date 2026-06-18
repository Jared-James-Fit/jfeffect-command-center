import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import {
  getNutritionDashboard,
  logMeal,
  deleteMeal,
  parseMealFromText,
  logSupplement,
  undoSupplementLog,
  upsertSupplement,
} from "@/lib/nutrition-dashboard.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Trash2, Sparkles, Pill, Flame, Beef, Wheat, Droplet, Clock } from "lucide-react";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function sumMacros(meals: any[]) {
  return meals.reduce(
    (acc, m) => ({
      calories: acc.calories + Number(m.calories || 0),
      protein: acc.protein + Number(m.protein_g || 0),
      carbs: acc.carbs + Number(m.carbs_g || 0),
      fat: acc.fat + Number(m.fat_g || 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

export function DailyNutritionPanel() {
  const qc = useQueryClient();
  const [date, setDate] = useState(todayISO());
  const getDashboard = useServerFn(getNutritionDashboard);

  const dashQ = useQuery({
    queryKey: ["nutrition-dashboard", date],
    queryFn: () => getDashboard({ data: { date } }),
  });

  const meals = dashQ.data?.meals ?? [];
  const presets = dashQ.data?.presets ?? [];
  const supplements = dashQ.data?.supplements ?? [];
  const supplementLogs = dashQ.data?.supplementLogs ?? [];
  const target = dashQ.data?.target as any;
  const pendingTarget = dashQ.data?.pendingTarget as any;

  const totals = useMemo(() => sumMacros(meals), [meals]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["nutrition-dashboard"] });

  return (
    <div className="grid gap-4 p-4 md:p-6 md:grid-cols-2">
      {pendingTarget && !target && (
        <Card className="md:col-span-2 border-amber-500/40 bg-amber-500/5 p-4 text-sm">
          <div className="font-semibold mb-1">Your coach is reviewing your targets</div>
          <div className="text-muted-foreground">
            You'll see your daily macro goals once your coach approves them.
          </div>
        </Card>
      )}

      <Card className="p-4 md:col-span-2">
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <div>
            <div className="text-lg font-bold">Today's intake</div>
            <div className="text-xs text-muted-foreground">
              {format(parseISO(date), "EEEE, MMM d")}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value || todayISO())}
              className="h-9 w-[150px]"
            />
            <LogFoodSheet
              presets={presets}
              onLogged={invalidate}
              defaultDate={date}
            />
          </div>
        </div>

        {target ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <MacroBar
              icon={<Flame className="h-4 w-4" />}
              label="Calories"
              current={totals.calories}
              target={target.calories}
              unit="kcal"
            />
            <MacroBar
              icon={<Beef className="h-4 w-4" />}
              label="Protein"
              current={totals.protein}
              target={target.protein_g}
              unit="g"
            />
            <MacroBar
              icon={<Wheat className="h-4 w-4" />}
              label="Carbs"
              current={totals.carbs}
              target={target.carbs_g}
              unit="g"
            />
            <MacroBar
              icon={<Droplet className="h-4 w-4" />}
              label="Fat"
              current={totals.fat}
              target={target.fat_g}
              unit="g"
            />
          </div>
        ) : (
          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            Set up your nutrition targets to see progress bars here.
          </div>
        )}
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-lg font-bold">Meals</div>
          <span className="text-xs text-muted-foreground">{meals.length} logged</span>
        </div>
        {meals.length === 0 ? (
          <div className="text-sm text-muted-foreground">No meals logged for this day.</div>
        ) : (
          <ul className="space-y-2">
            {meals.map((m: any) => (
              <MealRow key={m.id} meal={m} onChanged={invalidate} />
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-lg font-bold flex items-center gap-2"><Pill className="h-4 w-4" /> Supplements</div>
          <AddSupplementButton onAdded={invalidate} />
        </div>
        {supplements.length === 0 ? (
          <div className="text-sm text-muted-foreground">Add a supplement to start tracking it daily.</div>
        ) : (
          <ul className="space-y-2">
            {supplements.map((s: any) => {
              const count = supplementLogs.filter((l: any) => l.supplement_id === s.id).length;
              return (
                <li key={s.id} className="flex items-center justify-between rounded-md border p-2">
                  <div>
                    <div className="font-medium text-sm">{s.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {count}/{s.daily_target_count} today
                    </div>
                  </div>
                  <SupplementCounter
                    supplement={s}
                    count={count}
                    onChange={invalidate}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <WeeklyTrendCard weekMeals={dashQ.data?.weekMeals ?? []} target={target} />
    </div>
  );
}

function MacroBar({
  icon,
  label,
  current,
  target,
  unit,
}: {
  icon: React.ReactNode;
  label: string;
  current: number;
  target: number;
  unit: string;
}) {
  const pct = target ? Math.min(100, Math.round((current / target) * 100)) : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="flex items-center gap-1.5 text-muted-foreground">{icon}{label}</span>
        <span className="font-medium">
          {Math.round(current)} / {target} {unit}
        </span>
      </div>
      <Progress value={pct} />
    </div>
  );
}

function MealRow({ meal, onChanged }: { meal: any; onChanged: () => void }) {
  const del = useServerFn(deleteMeal);
  const mutation = useMutation({
    mutationFn: () => del({ data: { id: meal.id } }),
    onSuccess: () => {
      toast.success("Meal removed");
      onChanged();
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't delete"),
  });
  return (
    <li className="flex items-center justify-between rounded-md border p-2 text-sm">
      <div className="min-w-0">
        <div className="font-medium truncate">{meal.name}</div>
        <div className="text-xs text-muted-foreground flex items-center gap-2">
          <Clock className="h-3 w-3" />
          {format(parseISO(meal.logged_at), "p")} · {meal.calories} kcal · P{Math.round(meal.protein_g)}/C{Math.round(meal.carbs_g)}/F{Math.round(meal.fat_g)}
        </div>
      </div>
      <Button size="icon" variant="ghost" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
        <Trash2 className="h-4 w-4 text-muted-foreground" />
      </Button>
    </li>
  );
}

function LogFoodSheet({
  presets,
  onLogged,
  defaultDate,
}: {
  presets: any[];
  onLogged: () => void;
  defaultDate: string;
}) {
  const [open, setOpen] = useState(false);
  const log = useServerFn(logMeal);
  const parse = useServerFn(parseMealFromText);

  const [manual, setManual] = useState({ name: "", calories: "", protein_g: "", carbs_g: "", fat_g: "" });
  const [aiText, setAiText] = useState("");
  const [aiResult, setAiResult] = useState<null | { name: string; calories: number; protein_g: number; carbs_g: number; fat_g: number }>(null);

  const parseM = useMutation({
    mutationFn: () => parse({ data: { text: aiText } }),
    onSuccess: (r) => setAiResult(r),
    onError: (e: any) => toast.error(e?.message ?? "AI parse failed"),
  });

  function buildLoggedAt() {
    if (defaultDate === todayISO()) return undefined;
    return new Date(`${defaultDate}T12:00:00.000Z`).toISOString();
  }

  async function logPreset(p: any) {
    try {
      await log({
        data: {
          name: p.name,
          calories: p.calories,
          protein_g: Number(p.protein_g),
          carbs_g: Number(p.carbs_g),
          fat_g: Number(p.fat_g),
          source: "preset",
          preset_id: p.id,
          logged_at: buildLoggedAt(),
        },
      });
      toast.success("Logged");
      setOpen(false);
      onLogged();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't log");
    }
  }

  async function logManual(savePreset = false) {
    if (!manual.name.trim()) return toast.error("Name required");
    try {
      await log({
        data: {
          name: manual.name.trim(),
          calories: Number(manual.calories) || 0,
          protein_g: Number(manual.protein_g) || 0,
          carbs_g: Number(manual.carbs_g) || 0,
          fat_g: Number(manual.fat_g) || 0,
          source: "manual",
          save_as_preset: savePreset,
          logged_at: buildLoggedAt(),
        },
      });
      toast.success(savePreset ? "Logged & saved as preset" : "Logged");
      setManual({ name: "", calories: "", protein_g: "", carbs_g: "", fat_g: "" });
      setOpen(false);
      onLogged();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't log");
    }
  }

  async function logAi(savePreset = false) {
    if (!aiResult) return;
    try {
      await log({
        data: {
          ...aiResult,
          source: "ai",
          raw_text: aiText,
          save_as_preset: savePreset,
          logged_at: buildLoggedAt(),
        },
      });
      toast.success("Logged");
      setAiText("");
      setAiResult(null);
      setOpen(false);
      onLogged();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't log");
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Log food</Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="h-[85vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Log a meal</SheetTitle>
        </SheetHeader>
        <Tabs defaultValue="presets" className="mt-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="presets">Presets</TabsTrigger>
            <TabsTrigger value="manual">Manual</TabsTrigger>
            <TabsTrigger value="ai">AI</TabsTrigger>
          </TabsList>

          <TabsContent value="presets" className="mt-4 space-y-2">
            {presets.length === 0 ? (
              <p className="text-sm text-muted-foreground">No saved meals yet. Log a manual meal and check "Save as preset".</p>
            ) : (
              presets.map((p) => (
                <button
                  key={p.id}
                  onClick={() => logPreset(p)}
                  className="w-full text-left rounded-md border p-3 hover:bg-accent"
                >
                  <div className="font-medium text-sm">{p.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {p.calories} kcal · P{Math.round(p.protein_g)}/C{Math.round(p.carbs_g)}/F{Math.round(p.fat_g)}
                  </div>
                </button>
              ))
            )}
          </TabsContent>

          <TabsContent value="manual" className="mt-4 space-y-3">
            <div>
              <Label>Name</Label>
              <Input value={manual.name} onChange={(e) => setManual({ ...manual, name: e.target.value })} placeholder="Chicken & rice" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Calories</Label>
                <Input inputMode="numeric" value={manual.calories} onChange={(e) => setManual({ ...manual, calories: e.target.value })} />
              </div>
              <div>
                <Label>Protein (g)</Label>
                <Input inputMode="numeric" value={manual.protein_g} onChange={(e) => setManual({ ...manual, protein_g: e.target.value })} />
              </div>
              <div>
                <Label>Carbs (g)</Label>
                <Input inputMode="numeric" value={manual.carbs_g} onChange={(e) => setManual({ ...manual, carbs_g: e.target.value })} />
              </div>
              <div>
                <Label>Fat (g)</Label>
                <Input inputMode="numeric" value={manual.fat_g} onChange={(e) => setManual({ ...manual, fat_g: e.target.value })} />
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => logManual(false)} className="flex-1">Log</Button>
              <Button onClick={() => logManual(true)} variant="outline" className="flex-1">Log & save preset</Button>
            </div>
          </TabsContent>

          <TabsContent value="ai" className="mt-4 space-y-3">
            <div>
              <Label>Describe what you ate</Label>
              <Input
                value={aiText}
                onChange={(e) => setAiText(e.target.value)}
                placeholder="2 eggs, toast and butter"
              />
            </div>
            <Button onClick={() => parseM.mutate()} disabled={parseM.isPending || !aiText.trim()} className="w-full">
              <Sparkles className="h-4 w-4 mr-1" />
              {parseM.isPending ? "Estimating…" : "Estimate macros"}
            </Button>
            {aiResult && (
              <Card className="p-3 space-y-2">
                <div className="font-medium">{aiResult.name}</div>
                <div className="grid grid-cols-4 gap-2 text-sm">
                  <Input value={aiResult.calories} onChange={(e) => setAiResult({ ...aiResult, calories: Number(e.target.value) || 0 })} />
                  <Input value={aiResult.protein_g} onChange={(e) => setAiResult({ ...aiResult, protein_g: Number(e.target.value) || 0 })} />
                  <Input value={aiResult.carbs_g} onChange={(e) => setAiResult({ ...aiResult, carbs_g: Number(e.target.value) || 0 })} />
                  <Input value={aiResult.fat_g} onChange={(e) => setAiResult({ ...aiResult, fat_g: Number(e.target.value) || 0 })} />
                </div>
                <div className="grid grid-cols-4 gap-2 text-[10px] text-muted-foreground uppercase">
                  <span>kcal</span><span>P</span><span>C</span><span>F</span>
                </div>
                <div className="flex gap-2">
                  <Button onClick={() => logAi(false)} className="flex-1">Log</Button>
                  <Button onClick={() => logAi(true)} variant="outline" className="flex-1">Log & save preset</Button>
                </div>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

function SupplementCounter({
  supplement,
  count,
  onChange,
}: {
  supplement: any;
  count: number;
  onChange: () => void;
}) {
  const log = useServerFn(logSupplement);
  const undo = useServerFn(undoSupplementLog);
  return (
    <div className="flex items-center gap-1">
      <Button
        size="icon"
        variant="ghost"
        disabled={count === 0}
        onClick={async () => {
          await undo({ data: { supplement_id: supplement.id, supplement_name: supplement.name } });
          onChange();
        }}
      >
        −
      </Button>
      <span className="w-6 text-center text-sm font-medium">{count}</span>
      <Button
        size="icon"
        onClick={async () => {
          await log({ data: { supplement_id: supplement.id, supplement_name: supplement.name } });
          onChange();
        }}
      >
        +
      </Button>
    </div>
  );
}

function AddSupplementButton({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [count, setCount] = useState("1");
  const up = useServerFn(upsertSupplement);
  async function save() {
    if (!name.trim()) return;
    try {
      await up({ data: { name: name.trim(), daily_target_count: Number(count) || 1, active: true } });
      toast.success("Added");
      setName("");
      setCount("1");
      setOpen(false);
      onAdded();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save");
    }
  }
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="sm" variant="outline"><Plus className="h-4 w-4 mr-1" /> Add</Button>
      </SheetTrigger>
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle>Add supplement</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-3">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Creatine" />
          </div>
          <div>
            <Label>Doses per day</Label>
            <Input inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} />
          </div>
          <Button onClick={save} className="w-full">Save</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function WeeklyTrendCard({ weekMeals, target }: { weekMeals: any[]; target: any }) {
  // Group by date
  const byDay = new Map<string, { calories: number; protein: number; carbs: number; fat: number }>();
  for (const m of weekMeals) {
    const d = (m.logged_at as string).slice(0, 10);
    const cur = byDay.get(d) ?? { calories: 0, protein: 0, carbs: 0, fat: 0 };
    cur.calories += Number(m.calories || 0);
    cur.protein += Number(m.protein_g || 0);
    cur.carbs += Number(m.carbs_g || 0);
    cur.fat += Number(m.fat_g || 0);
    byDay.set(d, cur);
  }
  const days: { day: string; pct: number; kcal: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const totals = byDay.get(d) ?? { calories: 0, protein: 0, carbs: 0, fat: 0 };
    const pct = target?.calories ? Math.min(120, Math.round((totals.calories / target.calories) * 100)) : 0;
    days.push({ day: d, pct, kcal: totals.calories });
  }
  return (
    <Card className="p-4">
      <div className="text-lg font-bold mb-3">Last 7 days</div>
      {!target ? (
        <div className="text-sm text-muted-foreground">Adherence chart appears once targets are approved.</div>
      ) : (
        <div className="flex items-end gap-1.5 h-32">
          {days.map((d) => (
            <div key={d.day} className="flex-1 flex flex-col items-center gap-1 min-w-0">
              <div className="flex-1 w-full flex items-end">
                <div
                  className="w-full rounded-t-sm bg-primary/70"
                  style={{ height: `${Math.max(2, d.pct)}%` }}
                  title={`${d.kcal} kcal · ${d.pct}%`}
                />
              </div>
              <div className="text-[10px] text-muted-foreground">
                {format(parseISO(d.day), "EEEEE")}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}