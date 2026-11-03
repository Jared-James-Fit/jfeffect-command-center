import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { saveWeightUnitChoice } from "@/lib/weight-unit-pref";
import type { WeightUnit } from "@/lib/weight-lifted";

/**
 * The client's default weight unit (clients.preferred_weight_unit): what
 * workouts, PRs, analytics and the community show by default. A single lift
 * can still be switched in the logger (that's saved per exercise), which is
 * how most lifters run competition lifts in kg and machines in lb.
 * Until they pick (weight_unit_confirmed_at is null) lb is used and the block
 * says so; tapping either unit, even the current one, records the choice.
 */
export function WeightUnitCard({
  clientId,
  value,
  confirmed,
}: {
  clientId: string;
  value: string | null | undefined;
  confirmed: boolean;
}) {
  const qc = useQueryClient();
  const [unit, setUnit] = useState<WeightUnit>(value === "kg" ? "kg" : "lb");
  const [isConfirmed, setIsConfirmed] = useState(confirmed);
  const [saving, setSaving] = useState<WeightUnit | null>(null);

  const save = async (next: WeightUnit) => {
    if (saving || (next === unit && isConfirmed)) return;
    const prev = unit;
    setUnit(next);
    setSaving(next);
    try {
      await saveWeightUnitChoice({ clientId }, next);
    } catch (e) {
      setUnit(prev);
      toast.error(e instanceof Error ? e.message : "Couldn't save your unit");
      return;
    } finally {
      setSaving(null);
    }
    setIsConfirmed(true);
    toast.success(next === "kg" ? "Weights now show in kg" : "Weights now show in lb");
    // Workouts, analytics, PRs and the community all read this; refresh what's on screen.
    if (next !== prev) qc.invalidateQueries();
    else {
      qc.invalidateQueries({ queryKey: ["weight-unit-setup"] });
      qc.invalidateQueries({ queryKey: ["my-client-account"] });
    }
  };

  // Account → Units & training days: a plain block inside its section (the section row is the title).
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">Weight units</div>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Weight units">
        {(["lb", "kg"] as const).map((u) => {
          const active = unit === u && isConfirmed;
          return (
            <button
              key={u}
              type="button"
              role="radio"
              aria-checked={unit === u}
              disabled={!!saving}
              onClick={() => void save(u)}
              className={[
                "flex h-12 items-center justify-center gap-2 rounded-lg border text-sm font-semibold transition disabled:opacity-60",
                active
                  ? "border-foreground bg-secondary text-foreground"
                  : unit === u
                    ? "border-warning/60 bg-background text-foreground"
                    : "border-border bg-background text-muted-foreground hover:bg-muted/50",
              ].join(" ")}
            >
              {saving === u ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {u === "lb" ? "Pounds (lb)" : "Kilograms (kg)"}
            </button>
          );
        })}
      </div>
      {isConfirmed ? (
        <p className="text-xs text-muted-foreground">
          Workouts, maxes, PRs and the Crew use it. A single lift can still switch in the workout logger.
        </p>
      ) : (
        <p className="text-xs text-warning">Not chosen yet, so lb is used. Tap the one you lift in.</p>
      )}
    </div>
  );
}
