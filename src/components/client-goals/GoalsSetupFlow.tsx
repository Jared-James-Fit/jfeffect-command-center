import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, ChevronLeft, ChevronRight, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { ChipGrid } from "./chip-grid";
import {
  MAIN_GOALS, TRAINING_DAYS, WEEKDAYS, WEEKDAY_LABELS, WORKOUT_LENGTHS,
  EXPERIENCE_LEVELS, TRAINING_STYLES, TRAINING_LOCATIONS, EQUIPMENT_OPTIONS,
  NUTRITION_GOALS, NUTRITION_PREFS, NUTRITION_CHALLENGES, NUTRITION_CHALLENGES_MAX,
  type ClientGoalsSetupRow,
} from "@/lib/client-goals/schema";
import { saveGoalsSetupFn } from "@/lib/client-goals/goals.functions";

type Props = {
  clientId: string;
  /** Optional: called after a successful Finish. */
  onComplete?: () => void;
  /** Render compact in a sheet (skip the full progress header). */
  compact?: boolean;
};

const STEPS = [
  "Goals",
  "Training availability",
  "Training experience",
  "Gym & equipment",
  "Nutrition",
  "Injuries",
  "Final notes",
] as const;

export function GoalsSetupFlow({ clientId, onComplete, compact }: Props) {
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const saveGoalsSetup = useServerFn(saveGoalsSetupFn);

  const { data: row, isLoading } = useQuery({
    queryKey: ["client-goals-setup", clientId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("client_goals_setup")
        .select("*")
        .eq("client_id", clientId)
        .maybeSingle();
      if (error) throw error;
      return data as ClientGoalsSetupRow | null;
    },
  });

  // Local working copy hydrated from server.
  const [local, setLocal] = useState<Partial<ClientGoalsSetupRow>>({});
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (row && !hydratedRef.current) {
      setLocal(row);
      hydratedRef.current = true;
    } else if (!row && !hydratedRef.current && !isLoading) {
      setLocal({});
      hydratedRef.current = true;
    }
  }, [row, isLoading]);

  const setField = <K extends keyof ClientGoalsSetupRow>(k: K, v: ClientGoalsSetupRow[K]) =>
    setLocal((p) => ({ ...p, [k]: v }));

  const upsert = useMutation({
    mutationFn: async (patch: Partial<ClientGoalsSetupRow> & { completed?: boolean }) => {
      await saveGoalsSetup({ data: { clientId, patch } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["client-goals-setup", clientId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not save"),
  });

  const saveAndAdvance = async (extra?: Partial<ClientGoalsSetupRow>) => {
    const patch = { ...local, ...(extra ?? {}) };
    await upsert.mutateAsync(patch);
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };

  const saveAndExit = async () => {
    await upsert.mutateAsync(local);
    toast.success("Saved — you can finish later");
    onComplete?.();
  };

  const finish = async () => {
    await upsert.mutateAsync({ ...local, completed: true } as any);
    toast.success("Goals & Setup saved");
    onComplete?.();
  };

  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  const pct = Math.round(((step + 1) / STEPS.length) * 100);

  return (
    <div className="space-y-4">
      {!compact && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold uppercase tracking-wide text-muted-foreground">
              Step {step + 1} of {STEPS.length}
            </span>
            <span className="text-muted-foreground">{STEPS[step]}</span>
          </div>
          <Progress value={pct} />
        </div>
      )}

      <Card className="p-4 sm:p-5">
        {step === 0 && <GoalsStep value={local} setField={setField} />}
        {step === 1 && <AvailabilityStep value={local} setField={setField} />}
        {step === 2 && <ExperienceStep value={local} setField={setField} />}
        {step === 3 && <EquipmentStep value={local} setField={setField} />}
        {step === 4 && <NutritionStep value={local} setField={setField} />}
        {step === 5 && <InjuriesStep value={local} setField={setField} />}
        {step === 6 && <FinalStep value={local} setField={setField} />}
      </Card>

      {/* Sticky bottom bar — mobile-friendly */}
      <div className="sticky bottom-0 z-10 -mx-3 border-t border-border bg-background/95 px-3 py-3 backdrop-blur sm:rounded-lg sm:border sm:bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            variant="ghost"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0 || upsert.isPending}
          >
            <ChevronLeft className="mr-1 h-4 w-4" /> Back
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={saveAndExit} disabled={upsert.isPending}>
              Save & continue later
            </Button>
            {step < STEPS.length - 1 ? (
              <Button onClick={() => saveAndAdvance()} disabled={upsert.isPending}>
                {upsert.isPending ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" />Saving</> : <>Next <ChevronRight className="ml-1 h-4 w-4" /></>}
              </Button>
            ) : (
              <Button onClick={finish} disabled={upsert.isPending}>
                {upsert.isPending ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" />Saving</> : <>Finish <CheckCircle2 className="ml-1 h-4 w-4" /></>}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- shared helpers ---------- */

function Q({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <h3 className="flex flex-wrap items-center gap-2 text-base font-semibold sm:text-lg">
      <span>
        {children}
        {required && <span className="ml-1 text-destructive" aria-hidden>*</span>}
      </span>
      {required && (
        <span className="rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-destructive">
          Required
        </span>
      )}
    </h3>
  );
}
function Sub({ children }: { children: React.ReactNode }) {
  return <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">{children}</p>;
}

type StepProps = {
  value: Partial<ClientGoalsSetupRow>;
  setField: <K extends keyof ClientGoalsSetupRow>(k: K, v: ClientGoalsSetupRow[K]) => void;
};

/* ---------- Step 1: Goals ---------- */
function GoalsStep({ value, setField }: StepProps) {
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Q required>What is your main goal?</Q>
        <ChipGrid
          options={MAIN_GOALS}
          value={value.main_goal ?? null}
          onChange={(v) => setField("main_goal", v)}
        />
        {value.main_goal === "Other" && (
          <Input
            placeholder="Describe your main goal…"
            value={value.main_goal_other ?? ""}
            onChange={(e) => setField("main_goal_other", e.target.value)}
            maxLength={200}
          />
        )}
      </div>
      <div className="space-y-2">
        <Q>Do you have a specific goal, target, or deadline?</Q>
        <Sub>Optional. Examples: goal body weight, strength target, competition date, event date.</Sub>
        <Textarea
          placeholder="Optional…"
          value={value.goal_target ?? ""}
          onChange={(e) => setField("goal_target", e.target.value)}
          maxLength={400}
          rows={3}
        />
      </div>
    </div>
  );
}

/* ---------- Step 2: Training availability ---------- */
function AvailabilityStep({ value, setField }: StepProps) {
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Q required>How many days per week can you realistically train?</Q>
        <ChipGrid
          options={TRAINING_DAYS}
          value={value.training_days_per_week ?? null}
          onChange={(v) => setField("training_days_per_week", v)}
          labelFor={(n) => `${n} days`}
        />
      </div>
      <div className="space-y-3">
        <Q>Which days are you available?</Q>
        <ChipGrid
          options={WEEKDAYS}
          value={(value.available_weekdays ?? []) as any}
          onChange={(v) => {
            const order = WEEKDAYS as readonly string[];
            const sorted = [...(v as string[])].sort(
              (a, b) => order.indexOf(a) - order.indexOf(b),
            );
            setField("available_weekdays", sorted as any);
          }}
          multi
          labelFor={(d) => WEEKDAY_LABELS[d as keyof typeof WEEKDAY_LABELS]}
        />
      </div>
      <div className="space-y-3">
        <Q required>How long can each workout be?</Q>
        <ChipGrid
          options={WORKOUT_LENGTHS}
          value={value.workout_length_minutes ?? null}
          onChange={(v) => setField("workout_length_minutes", v)}
          labelFor={(n) => `${n} min`}
        />
      </div>
    </div>
  );
}

/* ---------- Step 3: Experience ---------- */
function ExperienceStep({ value, setField }: StepProps) {
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Q required>What is your training experience?</Q>
        <ChipGrid
          options={EXPERIENCE_LEVELS}
          value={value.training_experience ?? null}
          onChange={(v) => setField("training_experience", v)}
        />
      </div>
      <div className="space-y-3">
        <Q>What style of training do you want?</Q>
        <Sub>Select all that apply.</Sub>
        <ChipGrid
          options={TRAINING_STYLES}
          value={value.training_styles ?? []}
          onChange={(v) => setField("training_styles", v)}
          multi
        />
      </div>
    </div>
  );
}

const ALL_OF_IT = "All of it";
const OTHER = "Other";
const OTHER_PREFIX = "Other: ";
// "Real" equipment excludes the meta chips ("All of it" and "Other"),
// so selecting "All of it" doesn't toggle the custom-text Other chip.
const REAL_EQUIPMENT = EQUIPMENT_OPTIONS.filter(
  (o) => o !== ALL_OF_IT && o !== OTHER,
);

function getOtherText(equipment: string[] | undefined): string {
  const entry = (equipment ?? []).find((x) => x.startsWith(OTHER_PREFIX));
  return entry ? entry.slice(OTHER_PREFIX.length) : "";
}

function hasOther(equipment: string[] | undefined): boolean {
  return (equipment ?? []).some((x) => x === OTHER || x.startsWith(OTHER_PREFIX));
}

function setOtherText(equipment: string[] | undefined, text: string): string[] {
  const base = (equipment ?? []).filter((x) => x !== OTHER && !x.startsWith(OTHER_PREFIX));
  const trimmed = text.trim();
  base.push(trimmed ? `${OTHER_PREFIX}${trimmed}` : OTHER);
  return base;
}

function equipmentDisplayValue(equipment: string[] | undefined): string[] {
  const eq = equipment ?? [];
  const displayed: string[] = eq.filter(
    (x) => x !== OTHER && !x.startsWith(OTHER_PREFIX),
  );
  if (hasOther(eq)) displayed.push(OTHER);
  const realSelected = displayed.filter((x) => x !== OTHER);
  const hasAllReal =
    REAL_EQUIPMENT.every((o) => realSelected.includes(o)) &&
    realSelected.length === REAL_EQUIPMENT.length;
  if (hasAllReal) {
    return [...displayed, ALL_OF_IT];
  }
  return displayed;
}

function handleEquipmentChange(
  prev: string[] | undefined,
  next: string[],
  onChange: (v: string[]) => void,
) {
  const prevArr = prev ?? [];
  const prevDisplay = equipmentDisplayValue(prevArr);
  const hadAll = prevDisplay.includes(ALL_OF_IT);
  const hasAll = next.includes(ALL_OF_IT);
  const hadOther = hasOther(prevArr);
  const wantsOther = next.includes(OTHER);
  const existingOtherText = getOtherText(prevArr);

  if (hasAll && !hadAll) {
    // Selected "All of it" → select every real option (preserve Other if set)
    const base = [...REAL_EQUIPMENT];
    if (hadOther) {
      base.push(existingOtherText ? `${OTHER_PREFIX}${existingOtherText}` : OTHER);
    }
    onChange(base);
  } else if (!hasAll && hadAll) {
    // Deselected "All of it" → clear everything (preserve Other if set)
    const base: string[] = [];
    if (hadOther) {
      base.push(existingOtherText ? `${OTHER_PREFIX}${existingOtherText}` : OTHER);
    }
    onChange(base);
  } else {
    // Normal toggle — strip meta chips and re-apply Other state
    const cleaned = next.filter((x) => x !== ALL_OF_IT && x !== OTHER);
    if (wantsOther) {
      cleaned.push(existingOtherText ? `${OTHER_PREFIX}${existingOtherText}` : OTHER);
    }
    onChange(cleaned);
  }
}

/* ---------- Step 4: Gym & equipment ---------- */
function EquipmentStep({ value, setField }: StepProps) {
  const multiLoc = value.training_location === "Multiple locations";
  const byLoc = (value.equipment_by_location as Record<string, string[]>) ?? {};
  const locKeys = Object.keys(byLoc);

  const renameLoc = (oldKey: string, newKey: string) => {
    if (!newKey.trim() || newKey === oldKey) return;
    const next = { ...byLoc };
    next[newKey] = next[oldKey] ?? [];
    delete next[oldKey];
    setField("equipment_by_location", next);
  };
  const setLocEquip = (k: string, eq: string[]) => {
    setField("equipment_by_location", { ...byLoc, [k]: eq });
  };
  const addLoc = () => {
    let i = 1;
    let name = "Location 1";
    while (byLoc[name]) { i++; name = `Location ${i}`; }
    setField("equipment_by_location", { ...byLoc, [name]: [] });
  };
  const removeLoc = (k: string) => {
    const next = { ...byLoc }; delete next[k];
    setField("equipment_by_location", next);
  };

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Q required>Where will you train?</Q>
        <ChipGrid
          options={TRAINING_LOCATIONS}
          value={value.training_location ?? null}
          onChange={(v) => setField("training_location", v)}
        />
      </div>

      {!multiLoc ? (
        <div className="space-y-3">
          <Q>What equipment do you have access to?</Q>
          <Sub>Select all that apply.</Sub>
          <ChipGrid
            options={EQUIPMENT_OPTIONS}
            value={equipmentDisplayValue(value.equipment)}
            onChange={(v) =>
              handleEquipmentChange(value.equipment, v, (eq) =>
                setField("equipment", eq),
              )
            }
            multi
          />
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <Q>Equipment per location</Q>
            <Sub>Add each place you train and pick the equipment available there.</Sub>
          </div>
          {locKeys.length === 0 && (
            <p className="text-sm text-muted-foreground">No locations yet — add one to get started.</p>
          )}
          <div className="space-y-4">
            {locKeys.map((k) => (
              <Card key={k} className="space-y-3 p-3">
                <div className="flex items-center gap-2">
                  <Input
                    value={k}
                    onChange={(e) => renameLoc(k, e.target.value)}
                    placeholder="Location name (e.g. Home, Hotel gym)"
                    className="font-medium"
                  />
                  <Button size="icon" variant="ghost" onClick={() => removeLoc(k)} aria-label="Remove location">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <ChipGrid
                  options={EQUIPMENT_OPTIONS}
                  value={equipmentDisplayValue(byLoc[k])}
                  onChange={(v) =>
                    handleEquipmentChange(byLoc[k], v, (eq) =>
                      setLocEquip(k, eq),
                    )
                  }
                  multi
                />
              </Card>
            ))}
          </div>
          <Button variant="outline" onClick={addLoc}>
            <Plus className="mr-1 h-4 w-4" /> Add location
          </Button>
        </div>
      )}
    </div>
  );
}

/* ---------- Step 5: Nutrition ---------- */
function NutritionStep({ value, setField }: StepProps) {
  const challenges = value.nutrition_challenges ?? [];
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Q required>What is your nutrition goal?</Q>
        <ChipGrid
          options={NUTRITION_GOALS}
          value={value.nutrition_goal ?? null}
          onChange={(v) => setField("nutrition_goal", v)}
        />
      </div>
      <div className="space-y-3">
        <Q>How do you prefer to manage nutrition?</Q>
        <ChipGrid
          options={NUTRITION_PREFS}
          value={value.nutrition_preference ?? null}
          onChange={(v) => setField("nutrition_preference", v)}
        />
      </div>
      <div className="space-y-3">
        <Q required>Do you have any food allergies, intolerances, or foods you must avoid?</Q>
        <ChipGrid
          options={["No", "Yes"]}
          value={value.food_restrictions_has ? "Yes" : value.food_restrictions_has === false ? "No" : null}
          onChange={(v) => setField("food_restrictions_has", v === "Yes")}
        />
        {value.food_restrictions_has && (
          <Textarea
            required
            placeholder="List any allergies, intolerances, or foods to avoid…"
            value={value.food_restrictions_details ?? ""}
            onChange={(e) => setField("food_restrictions_details", e.target.value)}
            rows={3}
            maxLength={800}
          />
        )}
      </div>
      <div className="space-y-3">
        <Q>What is your biggest nutrition challenge?</Q>
        <Sub>Select up to {NUTRITION_CHALLENGES_MAX}.</Sub>
        <ChipGrid
          options={NUTRITION_CHALLENGES}
          value={challenges}
          onChange={(v) => setField("nutrition_challenges", v)}
          multi
          maxSelections={NUTRITION_CHALLENGES_MAX}
        />
        <div className="text-[11px] text-muted-foreground">
          {challenges.length}/{NUTRITION_CHALLENGES_MAX} selected
        </div>
      </div>
    </div>
  );
}

/* ---------- Step 6: Injuries ---------- */
function InjuriesStep({ value, setField }: StepProps) {
  return (
    <div className="space-y-4">
      <Q required>Do you have any injuries, pain, medical restrictions, or movement limitations that could affect training?</Q>
      <ChipGrid
        options={["No", "Yes"]}
        value={value.injuries_has ? "Yes" : value.injuries_has === false ? "No" : null}
        onChange={(v) => setField("injuries_has", v === "Yes")}
      />
      {value.injuries_has && (
        <>
          <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            This information will be flagged for your coach.
          </div>
          <Textarea
            required
            placeholder="Describe the injury / pain / restriction, when it started, and what movements aggravate it…"
            value={value.injuries_details ?? ""}
            onChange={(e) => setField("injuries_details", e.target.value)}
            rows={5}
            maxLength={2000}
          />
        </>
      )}
    </div>
  );
}

/* ---------- Step 7: Final notes ---------- */
function FinalStep({ value, setField }: StepProps) {
  return (
    <div className="space-y-4">
      <Q>Is there anything else your coach should know before building your workout or nutrition plan?</Q>
      <Sub>Optional.</Sub>
      <Textarea
        placeholder="Optional notes…"
        value={value.final_notes ?? ""}
        onChange={(e) => setField("final_notes", e.target.value)}
        rows={6}
        maxLength={2000}
      />
      <div className="rounded-md border border-border bg-secondary/30 p-3 text-xs text-muted-foreground">
        Tap <span className="font-semibold text-foreground">Finish</span> to save. You can update any answer later from your account.
      </div>
    </div>
  );
}

// Re-export Badge to keep import surface tidy.
export { Badge };