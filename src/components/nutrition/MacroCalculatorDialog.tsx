import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, Calculator, AlertTriangle, MessageCircle } from "lucide-react";
import {
  calculateTargets,
  DEFAULT_FORMULA_SETTINGS,
  applyIntensity,
  ageFromDob,
  ACTIVITY_OPTIONS,
  GOAL_OPTIONS,
  INTENSITY_OPTIONS,
  type ActivityLevel,
  type BiologicalSex,
  type NutritionGoal,
  type GoalIntensity,
} from "@/lib/nutrition-targets/formula";
import {
  getTargetsSetupPrefill,
  saveCalculatedTargets,
} from "@/lib/nutrition-targets/member-targets.functions";

type Units = "metric" | "imperial";

function kgFromLb(lb: number) {
  return lb * 0.45359237;
}
function cmFromFtIn(ft: number, inches: number) {
  return (ft * 12 + inches) * 2.54;
}

export function MacroCalculatorDialog({
  open,
  onOpenChange,
  viewer,
  hasCoachApprovedTargets = false,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  viewer: "member" | "client";
  hasCoachApprovedTargets?: boolean;
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
  const [sex, setSex] = useState<BiologicalSex>("male");
  const [weight, setWeight] = useState<string>("");
  const [heightCm, setHeightCm] = useState<string>("");
  const [heightFt, setHeightFt] = useState<string>("");
  const [heightIn, setHeightIn] = useState<string>("");
  const [activity, setActivity] = useState<ActivityLevel>("moderate");
  const [goal, setGoal] = useState<NutritionGoal>("maintain");
  const [intensity, setIntensity] = useState<GoalIntensity>("standard");
  const [showResults, setShowResults] = useState(false);
  const [saving, setSaving] = useState(false);

  // Prefill from profile
  useEffect(() => {
    if (!prefillQ.data || !open) return;
    const m: any = prefillQ.data.member;
    const bwKg: number | null = prefillQ.data.bodyweightKg ?? null;
    if (m?.units_preference === "metric" || m?.units_preference === "imperial") {
      setUnits(m.units_preference);
    }
    const dobAge = ageFromDob(m?.date_of_birth);
    if (dobAge && !age) setAge(String(dobAge));
    if (m?.biological_sex === "male" || m?.biological_sex === "female") setSex(m.biological_sex);
    if (m?.activity_level) setActivity(m.activity_level as ActivityLevel);
    if (m?.height_cm) {
      setHeightCm(String(Math.round(Number(m.height_cm))));
      const totalIn = Number(m.height_cm) / 2.54;
      const ft = Math.floor(totalIn / 12);
      const inch = Math.round(totalIn - ft * 12);
      setHeightFt(String(ft));
      setHeightIn(String(inch));
    }
    if (bwKg && !weight) {
      const useMetric = m?.units_preference === "metric";
      setWeight(useMetric ? bwKg.toFixed(1) : (bwKg / 0.45359237).toFixed(1));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillQ.data, open]);

  const computed = useMemo(() => {
    const a = Number(age);
    const w = Number(weight);
    if (!a || !w) return null;
    const kg = units === "metric" ? w : kgFromLb(w);
    const cm = units === "metric"
      ? Number(heightCm)
      : cmFromFtIn(Number(heightFt || 0), Number(heightIn || 0));
    if (!cm || cm < 100 || a < 10) return null;
    const settings = applyIntensity(DEFAULT_FORMULA_SETTINGS, goal, intensity);
    return {
      input: { bodyweightKg: kg, heightCm: cm, ageYears: Math.round(a), sex, activity, goal, intensity },
      result: calculateTargets({ bodyweightKg: kg, heightCm: cm, ageYears: Math.round(a), sex, activity, goal, intensity }, settings),
    };
  }, [age, weight, units, heightCm, heightFt, heightIn, sex, activity, goal, intensity]);

  const handleReset = () => {
    setShowResults(false);
  };
  const handleClose = () => {
    onOpenChange(false);
    setTimeout(() => setShowResults(false), 200);
  };

  const handleSave = async () => {
    if (!computed) return;
    setSaving(true);
    try {
      await saveFn({ data: { ...computed.input, unitsPreference: units } });
      toast.success("Targets saved", { description: "Your nutrition targets have been updated." });
      await queryClient.invalidateQueries({ queryKey: ["m-nutrition-targets"] });
      await queryClient.invalidateQueries({ queryKey: ["water-target"] });
      await queryClient.invalidateQueries({ queryKey: ["m-nutrition-context"] });
      handleClose();
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

  return (
    <Sheet open={open} onOpenChange={(v) => (v ? onOpenChange(true) : handleClose())}>
      <SheetContent side="bottom" className="h-[95vh] overflow-y-auto p-0">
        <div className="sticky top-0 z-10 bg-background border-b">
          <SheetHeader className="p-4">
            <SheetTitle className="flex items-center gap-2">
              <Calculator className="h-5 w-5 text-primary" /> Macro Calculator
            </SheetTitle>
            <SheetDescription>
              Estimate calories and macros from your body data and goal.
            </SheetDescription>
          </SheetHeader>
        </div>

        <div className="p-4 pb-28 space-y-4">
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

          {!showResults && (
            <>
              {/* Units */}
              <div className="flex items-center gap-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Units</Label>
                <div className="ml-auto inline-flex rounded-md border border-border p-0.5">
                  {(["imperial", "metric"] as Units[]).map((u) => (
                    <button
                      key={u}
                      type="button"
                      onClick={() => setUnits(u)}
                      className={`px-3 py-1 text-xs font-bold uppercase rounded ${units === u ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                    >
                      {u === "imperial" ? "lb / ft" : "kg / cm"}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="age">Age</Label>
                  <Input id="age" inputMode="numeric" value={age} onChange={(e) => setAge(e.target.value.replace(/[^0-9]/g, ""))} />
                </div>
                <div>
                  <Label>Sex (for calc)</Label>
                  <Select value={sex} onValueChange={(v) => setSex(v as BiologicalSex)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="male">Male</SelectItem>
                      <SelectItem value="female">Female</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="weight">Body weight ({units === "metric" ? "kg" : "lb"})</Label>
                  <Input id="weight" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value.replace(/[^0-9.]/g, ""))} />
                </div>
                {units === "metric" ? (
                  <div>
                    <Label htmlFor="hcm">Height (cm)</Label>
                    <Input id="hcm" inputMode="numeric" value={heightCm} onChange={(e) => setHeightCm(e.target.value.replace(/[^0-9]/g, ""))} />
                  </div>
                ) : (
                  <div>
                    <Label>Height</Label>
                    <div className="flex gap-2">
                      <Input placeholder="ft" inputMode="numeric" value={heightFt} onChange={(e) => setHeightFt(e.target.value.replace(/[^0-9]/g, ""))} />
                      <Input placeholder="in" inputMode="numeric" value={heightIn} onChange={(e) => setHeightIn(e.target.value.replace(/[^0-9]/g, ""))} />
                    </div>
                  </div>
                )}
              </div>

              <div>
                <Label>Daily activity</Label>
                <Select value={activity} onValueChange={(v) => setActivity(v as ActivityLevel)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ACTIVITY_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label} — {o.hint}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Goal</Label>
                <Select value={goal} onValueChange={(v) => setGoal(v as NutritionGoal)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {GOAL_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label} — {o.hint}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {goal !== "maintain" && (
                <div>
                  <Label>Rate of progress</Label>
                  <Select value={intensity} onValueChange={(v) => setIntensity(v as GoalIntensity)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {INTENSITY_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label} — {o.hint}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="pt-2 flex gap-2">
                <Button variant="outline" onClick={handleClose} className="flex-1">Cancel</Button>
                <Button onClick={() => setShowResults(true)} disabled={!computed} className="flex-1">
                  Calculate
                </Button>
              </div>
              {!computed && (age || weight) && (
                <div className="text-[11px] text-muted-foreground">
                  Enter age, weight and height to calculate.
                </div>
              )}
            </>
          )}

          {showResults && computed && (
            <>
              <div className="rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 to-card p-4">
                <div className="text-[11px] uppercase tracking-widest text-muted-foreground">Suggested daily target</div>
                <div className="mt-1 text-4xl font-black">{computed.result.calories}<span className="ml-1 text-sm font-normal text-muted-foreground">kcal</span></div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  Estimated maintenance: {computed.result.tdee} kcal · Goal: {goal} ({intensity})
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2">
                {[
                  { l: "Protein", v: `${computed.result.protein_g}g` },
                  { l: "Carbs", v: `${computed.result.carbs_g}g` },
                  { l: "Fat", v: `${computed.result.fat_g}g` },
                  { l: "Water", v: `${(computed.result.water_ml / 1000).toFixed(1)}L` },
                ].map((m) => (
                  <div key={m.l} className="rounded-md border border-border bg-secondary/30 p-2 text-center">
                    <div className="text-lg font-black leading-none">{m.v}</div>
                    <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">{m.l}</div>
                  </div>
                ))}
              </div>

              <div className="text-[11px] text-muted-foreground">
                These numbers are an estimated starting point. Your actual needs may change based on
                your progress, training, recovery, health, and coach recommendations.
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2">
                <Button variant="outline" onClick={handleReset}>Recalculate</Button>
                <Button variant="outline" onClick={handleClose}>Cancel</Button>
                {viewer === "client" && hasCoachApprovedTargets ? (
                  <Button onClick={handleSendToCoach} className="col-span-2 gap-1.5">
                    <MessageCircle className="h-4 w-4" /> Send to Coach for Review
                  </Button>
                ) : viewer === "client" ? (
                  <>
                    <Button onClick={handleSave} disabled={saving} className="col-span-2">
                      {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      Save My Targets
                    </Button>
                    <Button variant="ghost" onClick={handleSendToCoach} asChild className="col-span-2 gap-1.5">
                      <Link to="/portal/messages" onClick={() => handleSendToCoach()}>
                        <MessageCircle className="h-4 w-4" /> Send to Coach for Review
                      </Link>
                    </Button>
                  </>
                ) : (
                  <Button onClick={handleSave} disabled={saving} className="col-span-2">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Save My Targets
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}