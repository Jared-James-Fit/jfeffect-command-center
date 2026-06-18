import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { PageHeader } from "@/components/app-shell";
import { ArrowLeft, ArrowRight, Check, Flame, Beef, Wheat, Cookie, Droplets } from "lucide-react";
import {
  ACTIVITY_OPTIONS,
  GOAL_OPTIONS,
  calculateTargets,
  DEFAULT_FORMULA_SETTINGS,
  ageFromDob,
  type ActivityLevel,
  type BiologicalSex,
  type NutritionGoal,
} from "@/lib/nutrition-targets/formula";
import {
  getTargetsSetupPrefill,
  getFormulaSettings,
  saveCalculatedTargets,
  saveManualTargets,
} from "@/lib/nutrition-targets/member-targets.functions";

export const Route = createFileRoute("/_authenticated/m/nutrition/targets-setup")({
  component: TargetsSetup,
});

const LB_PER_KG = 2.2046226218;
const IN_PER_CM = 0.3937007874;

type Units = "metric" | "imperial";

function TargetsSetup() {
  const navigate = useNavigate();
  const prefillFn = useServerFn(getTargetsSetupPrefill);
  const settingsFn = useServerFn(getFormulaSettings);
  const saveFn = useServerFn(saveCalculatedTargets);
  const saveManualFn = useServerFn(saveManualTargets);

  const prefillQ = useQuery({ queryKey: ["nt-prefill"], queryFn: () => prefillFn({}) });
  const settingsQ = useQuery({ queryKey: ["nt-settings"], queryFn: () => settingsFn({}) });

  const [units, setUnits] = useState<Units>("metric");
  const [bodyweight, setBodyweight] = useState<string>("");
  const [height, setHeight] = useState<string>("");
  const [heightFt, setHeightFt] = useState<string>("");
  const [heightIn, setHeightIn] = useState<string>("");
  const [age, setAge] = useState<string>("");
  const [sex, setSex] = useState<BiologicalSex | null>(null);
  const [activity, setActivity] = useState<ActivityLevel | null>(null);
  const [goal, setGoal] = useState<NutritionGoal | null>(null);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [mCal, setMCal] = useState("");
  const [mProt, setMProt] = useState("");
  const [mCarb, setMCarb] = useState("");
  const [mFat, setMFat] = useState("");
  const [mWater, setMWater] = useState("");

  // Prefill from member profile once loaded.
  useEffect(() => {
    const d = prefillQ.data;
    if (!d) return;
    const m = d.member;
    const pref = (m?.units_preference as Units | undefined) ?? "metric";
    setUnits(pref);
    if (d.bodyweightKg && !bodyweight) {
      setBodyweight(
        pref === "metric"
          ? d.bodyweightKg.toFixed(1)
          : (d.bodyweightKg * LB_PER_KG).toFixed(1),
      );
    }
    if (m?.height_cm && !height && !heightFt) {
      if (pref === "metric") setHeight(String(Math.round(Number(m.height_cm))));
      else {
        const totalIn = Number(m.height_cm) * IN_PER_CM;
        setHeightFt(String(Math.floor(totalIn / 12)));
        setHeightIn(String(Math.round(totalIn % 12)));
      }
    }
    if (m?.date_of_birth && !age) {
      const a = ageFromDob(m.date_of_birth);
      if (a) setAge(String(a));
    }
    if (m?.biological_sex && !sex) setSex(m.biological_sex as BiologicalSex);
    if (m?.activity_level && !activity) setActivity(m.activity_level as ActivityLevel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillQ.data]);

  const bodyweightKg = useMemo(() => {
    const v = parseFloat(bodyweight);
    if (!v || isNaN(v)) return null;
    return units === "metric" ? v : v / LB_PER_KG;
  }, [bodyweight, units]);

  const heightCm = useMemo(() => {
    if (units === "metric") {
      const v = parseFloat(height);
      return !v || isNaN(v) ? null : v;
    }
    const ft = parseFloat(heightFt);
    const inch = parseFloat(heightIn || "0");
    if (!ft || isNaN(ft)) return null;
    return (ft * 12 + (isNaN(inch) ? 0 : inch)) / IN_PER_CM;
  }, [units, height, heightFt, heightIn]);

  const ageYears = useMemo(() => {
    const v = parseInt(age, 10);
    return !v || isNaN(v) ? null : v;
  }, [age]);

  const preview = useMemo(() => {
    if (!bodyweightKg || !heightCm || !ageYears || !sex || !activity || !goal) return null;
    return calculateTargets(
      { bodyweightKg, heightCm, ageYears, sex, activity, goal },
      settingsQ.data ?? DEFAULT_FORMULA_SETTINGS,
    );
  }, [bodyweightKg, heightCm, ageYears, sex, activity, goal, settingsQ.data]);

  const steps = [
    { label: "Body" },
    { label: "About You" },
    { label: "Activity" },
    { label: "Goal" },
    { label: "Review" },
  ];

  const canNext = (() => {
    switch (step) {
      case 0: return !!bodyweightKg && !!heightCm;
      case 1: return !!ageYears && !!sex;
      case 2: return !!activity;
      case 3: return !!goal;
      case 4: return !!preview;
    }
    return false;
  })();

  async function handleSave() {
    if (!preview || !bodyweightKg || !heightCm || !ageYears || !sex || !activity || !goal) return;
    setSaving(true);
    try {
      await saveFn({
        data: {
          bodyweightKg,
          heightCm,
          ageYears,
          sex,
          activity,
          goal,
          unitsPreference: units,
        },
      });
      toast.success("Targets saved");
      navigate({ to: "/m/nutrition" });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save targets");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveManual() {
    const cal = parseInt(mCal, 10);
    const prot = parseInt(mProt, 10);
    const carb = parseInt(mCarb, 10);
    const fat = parseInt(mFat, 10);
    const waterL = parseFloat(mWater);
    if (!cal || isNaN(cal) || cal <= 0) {
      toast.error("Enter a calorie target");
      return;
    }
    setSaving(true);
    try {
      await saveManualFn({
        data: {
          calories: cal,
          protein_g: isNaN(prot) ? 0 : prot,
          carbs_g: isNaN(carb) ? 0 : carb,
          fat_g: isNaN(fat) ? 0 : fat,
          water_ml: !isNaN(waterL) && waterL > 0 ? Math.round(waterL * 1000) : undefined,
          goal: goal ?? undefined,
        },
      });
      toast.success("Targets saved");
      navigate({ to: "/m/nutrition" });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save targets");
    } finally {
      setSaving(false);
    }
  }

  function enterManualMode() {
    // Prefill manual fields from the calculated preview, when available.
    if (preview) {
      setMCal(String(preview.calories));
      setMProt(String(preview.protein_g));
      setMCarb(String(preview.carbs_g));
      setMFat(String(preview.fat_g));
      setMWater((preview.water_ml / 1000).toFixed(1));
    }
    setManualMode(true);
  }

  return (
    <>
      <PageHeader title="Set Up My Targets" subtitle="A few quick taps — we'll calculate the rest." />
      <div className="space-y-4 p-4 pb-28 md:p-6 md:pb-12 max-w-2xl mx-auto">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Step {step + 1} of {steps.length}</span>
            <span>{steps[step].label}</span>
          </div>
          <Progress value={((step + 1) / steps.length) * 100} className="h-2" />
        </div>

        <Card className="p-5">
          {step === 0 && (
            <div className="space-y-5">
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={units === "metric" ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => setUnits("metric")}
                >Metric (kg / cm)</Button>
                <Button
                  type="button"
                  variant={units === "imperial" ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => setUnits("imperial")}
                >Imperial (lb / ft)</Button>
              </div>
              <div className="space-y-2">
                <Label>Bodyweight ({units === "metric" ? "kg" : "lb"})</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  placeholder={units === "metric" ? "e.g. 75" : "e.g. 165"}
                  value={bodyweight}
                  onChange={(e) => setBodyweight(e.target.value)}
                />
              </div>
              {units === "metric" ? (
                <div className="space-y-2">
                  <Label>Height (cm)</Label>
                  <Input
                    type="number"
                    inputMode="numeric"
                    placeholder="e.g. 178"
                    value={height}
                    onChange={(e) => setHeight(e.target.value)}
                  />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Height (ft)</Label>
                    <Input type="number" inputMode="numeric" value={heightFt} onChange={(e) => setHeightFt(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>(in)</Label>
                    <Input type="number" inputMode="numeric" value={heightIn} onChange={(e) => setHeightIn(e.target.value)} />
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-5">
              <div className="space-y-2">
                <Label>Age</Label>
                <Input
                  type="number"
                  inputMode="numeric"
                  placeholder="e.g. 30"
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Biological sex</Label>
                <p className="text-xs text-muted-foreground">Used by the formula only — affects baseline metabolism.</p>
                <div className="grid grid-cols-2 gap-3">
                  {(["male", "female"] as BiologicalSex[]).map((s) => (
                    <Button
                      key={s}
                      type="button"
                      variant={sex === s ? "default" : "outline"}
                      className="h-14 capitalize"
                      onClick={() => setSex(s)}
                    >
                      {sex === s && <Check className="mr-2 h-4 w-4" />} {s}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <Label>How active are you on a typical week?</Label>
              <div className="space-y-2">
                {ACTIVITY_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setActivity(o.value)}
                    className={[
                      "w-full rounded-lg border p-4 text-left transition active:scale-[0.99]",
                      activity === o.value
                        ? "border-primary bg-primary/10"
                        : "border-border bg-card hover:border-primary/40",
                    ].join(" ")}
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-semibold">{o.label}</div>
                      {activity === o.value && <Check className="h-5 w-5 text-primary" />}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{o.hint}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <Label>What's your main goal right now?</Label>
              <div className="space-y-2">
                {GOAL_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setGoal(o.value)}
                    className={[
                      "w-full rounded-lg border p-4 text-left transition active:scale-[0.99]",
                      goal === o.value
                        ? "border-primary bg-primary/10"
                        : "border-border bg-card hover:border-primary/40",
                    ].join(" ")}
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-semibold">{o.label}</div>
                      {goal === o.value && <Check className="h-5 w-5 text-primary" />}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{o.hint}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 4 && preview && (
            <div className="space-y-4">
              {!manualMode ? (
                <>
                  <div>
                    <div className="text-sm font-semibold">Your calculated targets</div>
                    <div className="text-xs text-muted-foreground">
                      BMR {preview.bmr} · TDEE {preview.tdee} kcal · {goal && GOAL_OPTIONS.find((g) => g.value === goal)?.label}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    <Tile icon={Flame} label="Cal" value={preview.calories} />
                    <Tile icon={Beef} label="Protein" value={`${preview.protein_g}g`} />
                    <Tile icon={Wheat} label="Carbs" value={`${preview.carbs_g}g`} />
                    <Tile icon={Cookie} label="Fat" value={`${preview.fat_g}g`} />
                    <Tile icon={Droplets} label="Water" value={`${(preview.water_ml / 1000).toFixed(1)}L`} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    These will be saved as your active targets. You can edit them any time, and bodyweight changes won't overwrite them automatically.
                  </p>
                  <Button type="button" variant="outline" className="w-full" onClick={enterManualMode}>
                    Enter my own numbers instead
                  </Button>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold">Enter your own targets</div>
                      <div className="text-xs text-muted-foreground">Saved as Manual — won't be auto-recalculated.</div>
                    </div>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setManualMode(false)}>
                      Use calculated
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Calories</Label>
                      <Input type="number" inputMode="numeric" value={mCal} onChange={(e) => setMCal(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Water (L)</Label>
                      <Input type="number" inputMode="decimal" value={mWater} onChange={(e) => setMWater(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Protein (g)</Label>
                      <Input type="number" inputMode="numeric" value={mProt} onChange={(e) => setMProt(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Carbs (g)</Label>
                      <Input type="number" inputMode="numeric" value={mCarb} onChange={(e) => setMCarb(e.target.value)} />
                    </div>
                    <div className="space-y-1.5 col-span-2">
                      <Label>Fat (g)</Label>
                      <Input type="number" inputMode="numeric" value={mFat} onChange={(e) => setMFat(e.target.value)} />
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </Card>

        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => (step === 0 ? navigate({ to: "/m/nutrition" }) : setStep(step - 1))}
            disabled={saving}
          >
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            {step === 0 ? "Cancel" : "Back"}
          </Button>
          {step < steps.length - 1 ? (
            <Button type="button" onClick={() => setStep(step + 1)} disabled={!canNext}>
              Next <ArrowRight className="ml-1.5 h-4 w-4" />
            </Button>
          ) : (
            <Button
              type="button"
              onClick={manualMode ? handleSaveManual : handleSave}
              disabled={(!canNext && !manualMode) || saving}
            >
              {saving ? "Saving…" : "Save Targets"}
            </Button>
          )}
        </div>
      </div>
    </>
  );
}

function Tile({ icon: Icon, label, value }: { icon: any; label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border/60 bg-secondary/30 p-3 text-center">
      <Icon className="mx-auto h-4 w-4 text-primary" />
      <div className="mt-1 text-lg font-black leading-none">{value}</div>
      <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}