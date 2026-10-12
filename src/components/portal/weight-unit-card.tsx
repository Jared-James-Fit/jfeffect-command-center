import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { saveWeightUnitChoice } from "@/lib/weight-unit-pref";
import type { WeightUnit } from "@/lib/weight-lifted";

/**
 * The client's default weight unit (clients.preferred_weight_unit): what
 * workouts, PRs, analytics and the community show by default. A single lift
 * can still be switched in the logger (that's saved per exercise), which is
 * how most lifters run competition lifts in kg and machines in lb.
 * Until they pick (weight_unit_confirmed_at is null) lb is used and the card
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

  return (
    <Card className={`space-y-4 border-border bg-card p-5 sm:p-6 ${isConfirmed ? "" : "border-amber-500/50"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Weight units *</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            The unit you lift in. Used for workouts, maxes, PRs, analytics and the Crew. You can still switch a single lift in the workout logger.
          </p>
        </div>
        {!isConfirmed && (
          <Badge variant="outline" className="shrink-0 border-amber-500/40 text-amber-600 dark:text-amber-400">
            Not chosen yet, using lb
          </Badge>
        )}
      </div>
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
                "flex h-14 items-center justify-center gap-2 rounded-lg border-2 text-sm font-bold transition disabled:opacity-60",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : unit === u
                    ? "border-primary/60 bg-primary/5 text-foreground"
                    : "border-border bg-background text-muted-foreground hover:border-primary/50",
              ].join(" ")}
            >
              {saving === u ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {u === "lb" ? "Pounds (lb)" : "Kilograms (kg)"}
            </button>
          );
        })}
      </div>
      {!isConfirmed && (
        <p className="text-[11px] text-muted-foreground">Tap the one you use to lock it in.</p>
      )}
    </Card>
  );
}
