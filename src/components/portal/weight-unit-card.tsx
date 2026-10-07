import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { supabase } from "@/integrations/supabase/client";

/**
 * The client's default weight unit (clients.preferred_weight_unit): what
 * workouts, PRs, analytics and the community show by default. A single lift
 * can still be switched in the logger (that's saved per exercise), which is
 * how most lifters run competition lifts in kg and machines in lb.
 */
export function WeightUnitCard({ clientId, value }: { clientId: string; value: string | null | undefined }) {
  const qc = useQueryClient();
  const [unit, setUnit] = useState<"lb" | "kg">(value === "kg" ? "kg" : "lb");
  const [saving, setSaving] = useState(false);

  const save = async (next: "lb" | "kg") => {
    if (next === unit || saving) return;
    const prev = unit;
    setUnit(next);
    setSaving(true);
    const { error } = await supabase.from("clients").update({ preferred_weight_unit: next }).eq("id", clientId);
    setSaving(false);
    if (error) {
      setUnit(prev);
      toast.error(error.message);
      return;
    }
    toast.success(next === "kg" ? "Weights now show in kg" : "Weights now show in lb");
    // Workouts, analytics, PRs and the community all read this; refresh what's on screen.
    qc.invalidateQueries();
  };

  return (
    <Card className="flex items-center justify-between gap-4 border-border bg-card p-6">
      <div className="min-w-0">
        <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Weight units</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          How weights show across your workouts, PRs, analytics and the community. You can still switch a single lift in the workout logger.
        </p>
      </div>
      <ToggleGroup
        type="single"
        value={unit}
        onValueChange={(v) => v && save(v as "lb" | "kg")}
        size="sm"
        className="shrink-0 rounded-md border border-border"
        aria-label="Weight units"
        disabled={saving}
      >
        <ToggleGroupItem value="lb" className="h-8 px-3 text-xs font-bold">lb</ToggleGroupItem>
        <ToggleGroupItem value="kg" className="h-8 px-3 text-xs font-bold">kg</ToggleGroupItem>
      </ToggleGroup>
    </Card>
  );
}
