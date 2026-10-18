import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, Calculator, AlertTriangle, MessageCircle, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  calculateTargets,
  DEFAULT_FORMULA_SETTINGS,
  applyIntensity,
  ageFromDob,
  ACTIVITY_OPTIONS,
  GOAL_OPTIONS,
  type ActivityLevel,
  type BiologicalSex,
  type NutritionGoal,
  type GoalIntensity,
} from "@/lib/nutrition-targets/formula";
import {
  getTargetsSetupPrefill,
  saveCalculatedTargets,
} from "@/lib/nutrition-targets/member-targets.functions";
import {
  activityFromTrainingDays,
  bodyInputIssues,
  toMetricBody,
  type BodyFields,
  type Units,
} from "@/lib/nutrition-targets/calc-input";

// the pace is its own question, so the goal cards don't say how fast
const GOAL_HINT: Record<NutritionGoal, string> = {
  lose: "Eat a little under",
  maintain: "Hold your weight",
  gain: "Eat a little over",
};

const PACE: { value: GoalIntensity; label: string; hint: string }[] = [
  { value: "conservative", label: "Slow", hint: "Easiest to stick to" },
  { value: "standard", label: "Steady", hint: "Recommended" },
  { value: "aggressive", label: "Fast", hint: "Harder to sustain" },
];

/**
 * Suggested targets in one screen: everything we know is filled in, each
 * answer is a big tap (no dropdowns), a wrong number says what's wrong in
 * plain words, and the result updates live above the one button that saves
 * it. Saving updates the Nutrition screen right away (targets, water, the
 * day's progress bars, history).
 */
export function MacroCalculatorDialog({
  open,
  onOpenChange,
  viewer,
  hasCoachApprovedTargets = false,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  viewer: "member" | "client";
  hasCoachApprovedTargets?: boolean;
  /** after a member's targets save (the page shows them straight away) */
  onSaved?: () => void;
}) {
  const queryClient = useQueryClient();
  const prefillFn = useServerFn(getTargetsSetupPrefill);
  const saveFn = useServerFn(saveCalculatedTargets);

  const prefillQ = useQuery({
    queryKey: ["macro-calc-prefill"],
    queryFn: () => prefillFn({}),
    enabled: open,
    retry: false,
    staleTime: 60_000,
  });

  const [units, setUnits] = useState<Units>("imperial");
  const [age, setAge] = useState<string>("");
  // No default: a wrong guess skews calories by ~166 kcal/day. Prefilled from
  // the profile when it's on file, otherwise the athlete picks.
  const [sex, setSex] = useState<BiologicalSex | null>(null);
  const [weight, setWeight] = useState<string>("");
  const [heightCm, setHeightCm] = useState<string>("");
  const [heightFt, setHeightFt] = useState<string>("");
  const [heightIn, setHeightIn] = useState<string>("");
  const [activity, setActivity] = useState<ActivityLevel | null>(null);
  const [goal, setGoal] = useState<NutritionGoal | null>(null);
  const [intensity, setIntensity] = useState<GoalIntensity>("standard");
  const [saving, setSaving] = useState(false);
  const [filled, setFilled] = useState<{ weightDate: string | null; any: boolean }>({ weightDate: null, any: false });

  // Prefill from profile
  useEffect(() => {
    if (!prefillQ.data || !open) return;
    const m: any = prefillQ.data.member;
    const bwKg: number | null = prefillQ.data.bodyweightKg ?? null;
    let any = false;
    const useMetric = m?.units_preference === "metric";
    if (m?.units_preference === "metric" || m?.units_preference === "imperial") setUnits(m.units_preference);
    const dobAge = ageFromDob(m?.date_of_birth);
    if (dobAge && !age) {
      setAge(String(dobAge));
      any = true;
    }
    if (m?.biological_sex === "male" || m?.biological_sex === "female") {
      setSex(m.biological_sex);
      any = true;
    }
    if (m?.activity_level) setActivity(m.activity_level as ActivityLevel);
    else if (!activity) {
      const guess = activityFromTrainingDays((prefillQ.data as any).trainingDaysPerWeek);
      if (guess) setActivity(guess);
    }
    if (m?.height_cm) {
      setHeightCm(String(Math.round(Number(m.height_cm))));
      const totalIn = Number(m.height_cm) / 2.54;
      let ft = Math.floor(totalIn / 12);
      let inch = Math.round(totalIn - ft * 12);
      if (inch === 12) {
        ft += 1;
        inch = 0;
      }
      setHeightFt(String(ft));
      setHeightIn(String(inch));
      any = true;
    }
    if (bwKg && !weight) {
      setWeight(useMetric ? bwKg.toFixed(1) : (bwKg / 0.45359237).toFixed(1));
      any = true;
    }
    setFilled({ weightDate: bwKg ? ((prefillQ.data as any).bodyweightDate ?? null) : null, any });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillQ.data, open]);

  // switching units converts what's typed, so nobody saves 70 "lb"
  const switchUnits = (next: Units) => {
    if (next === units) return;
    const w = Number(weight);
    if (w > 0) setWeight(next === "metric" ? (w * 0.45359237).toFixed(1) : (w / 0.45359237).toFixed(1));
    if (next === "metric") {
      const ft = Number(heightFt || 0);
      const inch = Number(heightIn || 0);
      if (ft || inch) setHeightCm(String(Math.round((ft * 12 + inch) * 2.54)));
    } else if (Number(heightCm) > 0) {
      const totalIn = Number(heightCm) / 2.54;
      let ft = Math.floor(totalIn / 12);
      let inch = Math.round(totalIn - ft * 12);
      if (inch === 12) {
        ft += 1;
        inch = 0;
      }
      setHeightFt(String(ft));
      setHeightIn(String(inch));
    }
    setUnits(next);
  };

  const body: BodyFields = { units, age, weight, heightCm, heightFt, heightIn };
  const issues = bodyInputIssues(body);

  const missing: string[] = [];
  if (!sex) missing.push("sex");
  if (!age) missing.push("age");
  if (!weight) missing.push("weight");
  if (units === "metric" ? !heightCm : !heightFt) missing.push("height");
  if (!activity) missing.push("activity");
  if (!goal) missing.push("goal");

  const computed = useMemo(() => {
    if (!sex || !activity || !goal) return null;
    const m = toMetricBody(body);
    if (!m) return null;
    const settings = applyIntensity(DEFAULT_FORMULA_SETTINGS, goal, intensity);
    const input = { bodyweightKg: m.kg, heightCm: m.cm, ageYears: m.age, sex, activity, goal, intensity };
    return { input, result: calculateTargets(input, settings) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [age, weight, units, heightCm, heightFt, heightIn, sex, activity, goal, intensity]);

  const handleClose = () => onOpenChange(false);

  const handleSave = async () => {
    if (!computed) return;
    setSaving(true);
    try {
      const row = await saveFn({ data: { ...computed.input, unitsPreference: units } });
      // the page shows the new numbers now, not after a refetch
      queryClient.setQueriesData({ queryKey: ["m-nutrition-targets"] }, row);
      for (const key of [
        "m-nutrition-targets",
        "nutrition-dashboard",
        "m-targets-history",
        "water-target",
        "m-nutrition-context",
        "macro-calc-prefill",
      ]) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
      toast.success("Your targets are set", {
        description: `${computed.result.calories.toLocaleString()} kcal · ${computed.result.protein_g}g protein a day`,
      });
      handleClose();
      onSaved?.();
    } catch (e: any) {
      console.error("[macro-calc] save failed", e);
      toast.error("Could not save targets", { description: e?.message ?? "Please try again." });
    } finally {
      setSaving(false);
    }
  };

  const handleSendToCoach = () => {
    if (!computed) return;
    const r = computed.result;
    const summary = `Macro calculator estimate:\n• Calories: ${r.calories}\n• Protein: ${r.protein_g}g\n• Carbs: ${r.carbs_g}g\n• Fat: ${r.fat_g}g\n• Water: ${Math.round(r.water_ml / 100) / 10}L\nGoal: ${goal} (${intensity})`;
    try {
      navigator.clipboard?.writeText(summary);
    } catch {}
    toast.success("Estimate copied", { description: "Paste it into a message to your coach for review." });
  };

  const unitW = units === "metric" ? "kg" : "lb";

  return (
    <Sheet open={open} onOpenChange={(v) => (v ? onOpenChange(true) : handleClose())}>
      <SheetContent side="bottom" safeTopClose className="h-[95dvh] overflow-hidden p-0">
        <div className="flex h-full flex-col">
          <div className="shrink-0 border-b bg-background">
            <SheetHeader className="py-4 pr-4 pl-28">
              <SheetTitle className="flex items-center gap-2">
                <Calculator className="h-5 w-5 text-primary" /> {viewer === "member" ? "Your daily targets" : "Macro Calculator"}
              </SheetTitle>
              <SheetDescription>
                {filled.any ? "We filled in what's on your profile. Check it and pick the rest." : "Six quick answers. Takes about 30 seconds."}
              </SheetDescription>
            </SheetHeader>
          </div>

          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain p-4">
            {viewer === "client" && hasCoachApprovedTargets && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Coach-approved targets active</AlertTitle>
                <AlertDescription>
                  Your coach has already set your nutrition targets. You can calculate an estimate,
                  but it will not replace your current plan unless your coach approves it.
                </AlertDescription>
              </Alert>
            )}

            <Step n={1} title="About you">
              <div className="space-y-4">
                <div>
                  <Label className="text-xs text-muted-foreground">Sex (used by the formula)</Label>
                  <Segmented
                    className="mt-1.5"
                    value={sex}
                    onChange={(v) => setSex(v as BiologicalSex)}
                    options={[
                      { value: "male", label: "Male" },
                      { value: "female", label: "Female" },
                    ]}
                  />
                </div>

                <div className="flex items-center justify-between gap-2">
                  <Label className="text-xs text-muted-foreground">Units</Label>
                  <Segmented
                    size="sm"
                    value={units}
                    onChange={(v) => switchUnits(v as Units)}
                    options={[
                      { value: "imperial", label: "lb · ft" },
                      { value: "metric", label: "kg · cm" },
                    ]}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Age" htmlFor="calc-age" error={issues.age}>
                    <Suffixed suffix="yrs">
                      <Input
                        id="calc-age"
                        inputMode="numeric"
                        placeholder="30"
                        value={age}
                        maxLength={3}
                        onChange={(e) => setAge(e.target.value.replace(/[^0-9]/g, ""))}
                      />
                    </Suffixed>
                  </Field>
                  <Field
                    label="Weight"
                    htmlFor="calc-weight"
                    error={issues.weight}
                    hint={filled.weightDate && !issues.weight ? "From your last weigh-in" : undefined}
                  >
                    <Suffixed suffix={unitW}>
                      <Input
                        id="calc-weight"
                        inputMode="decimal"
                        placeholder={units === "metric" ? "80" : "180"}
                        value={weight}
                        maxLength={6}
                        onChange={(e) => setWeight(e.target.value.replace(/[^0-9.]/g, ""))}
                      />
                    </Suffixed>
                  </Field>
                </div>

                <Field label="Height" htmlFor={units === "metric" ? "calc-hcm" : "calc-hft"} error={issues.height}>
                  {units === "metric" ? (
                    <Suffixed suffix="cm">
                      <Input
                        id="calc-hcm"
                        inputMode="numeric"
                        placeholder="175"
                        value={heightCm}
                        maxLength={3}
                        onChange={(e) => setHeightCm(e.target.value.replace(/[^0-9]/g, ""))}
                      />
                    </Suffixed>
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      <Suffixed suffix="ft">
                        <Input
                          id="calc-hft"
                          inputMode="numeric"
                          placeholder="5"
                          value={heightFt}
                          maxLength={1}
                          onChange={(e) => setHeightFt(e.target.value.replace(/[^0-9]/g, ""))}
                        />
                      </Suffixed>
                      <Suffixed suffix="in">
                        <Input
                          aria-label="Inches"
                          inputMode="numeric"
                          placeholder="10"
                          value={heightIn}
                          maxLength={2}
                          onChange={(e) => setHeightIn(e.target.value.replace(/[^0-9]/g, ""))}
                        />
                      </Suffixed>
                    </div>
                  )}
                </Field>
              </div>
            </Step>

            <Step n={2} title="How active is your week?" subtitle="Count your training and your job.">
              <div className="space-y-1.5" role="radiogroup" aria-label="Activity">
                {ACTIVITY_OPTIONS.map((o) => (
                  <ChoiceRow
                    key={o.value}
                    selected={activity === o.value}
                    onClick={() => setActivity(o.value)}
                    label={o.label}
                    hint={o.hint}
                  />
                ))}
              </div>
            </Step>

            <Step n={3} title="Your goal">
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Goal">
                {GOAL_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={goal === o.value}
                    onClick={() => setGoal(o.value)}
                    className={cn(
                      "rounded-xl border p-3 text-left transition-colors",
                      goal === o.value ? "border-primary bg-primary/10 ring-1 ring-primary" : "border-border bg-card",
                    )}
                  >
                    <div className="text-sm font-bold leading-tight">{o.label}</div>
                    <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{GOAL_HINT[o.value]}</div>
                  </button>
                ))}
              </div>
              {goal && goal !== "maintain" && (
                <div className="mt-4">
                  <Label className="text-xs text-muted-foreground">How fast?</Label>
                  <Segmented
                    className="mt-1.5"
                    value={intensity}
                    onChange={(v) => setIntensity(v as GoalIntensity)}
                    options={PACE.map((p) => ({ value: p.value, label: p.label, hint: p.hint }))}
                  />
                </div>
              )}
            </Step>

            {viewer === "member" && (
              <Alert className="border-border/70 bg-secondary/30">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <AlertTitle className="text-xs">Suggested targets only</AlertTitle>
                <AlertDescription className="text-[11px] leading-snug text-muted-foreground">
                  A general starting point, not medical advice or a prescription. Pregnant, on medication or
                  managing a health condition? Check with a qualified healthcare professional first.
                </AlertDescription>
              </Alert>
            )}
          </div>

          <div className="shrink-0 border-t bg-background px-4 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)]">
            {computed ? (
              <div className="mb-3 flex items-end justify-between gap-3" aria-live="polite">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    {viewer === "member" ? "Your daily target" : "Estimated daily target"}
                  </div>
                  <div className="text-3xl font-black leading-none tabular-nums">
                    {computed.result.calories.toLocaleString()}
                    <span className="ml-1 text-sm font-semibold text-muted-foreground">kcal</span>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  {[
                    { l: "Protein", v: computed.result.protein_g },
                    { l: "Carbs", v: computed.result.carbs_g },
                    { l: "Fat", v: computed.result.fat_g },
                  ].map((m) => (
                    <div key={m.l}>
                      <div className="text-base font-black leading-none tabular-nums">{m.v}g</div>
                      <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">{m.l}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="mb-3 text-xs text-muted-foreground" aria-live="polite">
                {missing.length ? `Add your ${listWords(missing)} to see your targets.` : "Check the numbers marked in red."}
              </p>
            )}
            {viewer === "member" ? (
              <Button onClick={handleSave} disabled={saving || !computed} className="h-12 w-full text-base font-bold">
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                Save my targets
              </Button>
            ) : computed ? (
              <Button asChild className="h-12 w-full gap-1.5 text-base font-bold" onClick={handleSendToCoach}>
                <Link to="/portal/messages">
                  <MessageCircle className="h-4 w-4" /> Send to Coach for Review
                </Link>
              </Button>
            ) : (
              // a link can't be disabled: no estimate yet, nothing to send
              <Button disabled className="h-12 w-full gap-1.5 text-base font-bold">
                <MessageCircle className="h-4 w-4" /> Send to Coach for Review
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function listWords(words: string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

function Step({ n, title, subtitle, children }: { n: number; title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex items-baseline gap-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-black text-primary-foreground">
          {n}
        </span>
        <div>
          <h3 className="text-sm font-black">{title}</h3>
          {subtitle && <p className="text-[11px] text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function Field({
  label, htmlFor, error, hint, children,
}: {
  label: string;
  htmlFor?: string;
  error?: string | null;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={htmlFor} className="text-xs text-muted-foreground">{label}</Label>
      <div className={cn("mt-1.5", error && "[&_input]:border-destructive")}>{children}</div>
      {error ? (
        <p className="mt-1 text-[11px] font-medium text-destructive">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function Suffixed({ suffix, children }: { suffix: string; children: ReactNode }) {
  return (
    <div className="relative [&_input]:h-11 [&_input]:pr-10 [&_input]:text-base [&_input]:tabular-nums">
      {children}
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-semibold text-muted-foreground">
        {suffix}
      </span>
    </div>
  );
}

function Segmented({
  value, onChange, options, size = "md", className,
}: {
  value: string | null;
  onChange: (v: string) => void;
  options: { value: string; label: string; hint?: string }[];
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      className={cn("grid gap-1 rounded-xl border border-border bg-secondary/30 p-1", className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-lg px-3 font-semibold transition-colors",
              size === "sm" ? "py-1 text-xs" : "py-2.5 text-sm",
              on ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground",
            )}
          >
            {o.label}
            {o.hint && size === "md" && (
              <span className={cn("block text-[10px] font-medium", on ? "text-primary-foreground/80" : "text-muted-foreground/80")}>
                {o.hint}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function ChoiceRow({ selected, onClick, label, hint }: { selected: boolean; onClick: () => void; label: string; hint: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
        selected ? "border-primary bg-primary/10 ring-1 ring-primary" : "border-border bg-card",
      )}
    >
      <span
        className={cn(
          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
          selected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40",
        )}
      >
        {selected && <Check className="h-3 w-3" />}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold leading-tight">{label}</span>
        <span className="block text-[11px] text-muted-foreground">{hint}</span>
      </span>
    </button>
  );
}
