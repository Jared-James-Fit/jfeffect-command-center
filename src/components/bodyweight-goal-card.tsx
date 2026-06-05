import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Target, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  computeGoalProgress, formatWeight, GOAL_TYPE_LABELS,
  type BodyweightGoal, type GoalType, type WeightUnit,
} from "@/lib/progress-metrics";

interface Props {
  clientId: string;
  goal: BodyweightGoal | null;
  series: Array<{ value: number }>;
  displayUnit: WeightUnit;
  canEdit?: boolean;
}

export function BodyweightGoalCard({ clientId, goal, series, displayUnit, canEdit = true }: Props) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [type, setType] = useState<GoalType>(goal?.type ?? "lose");
  const [value, setValue] = useState<string>(goal?.value != null ? String(goal.value) : "");
  const [valueMax, setValueMax] = useState<string>(goal?.value_max != null ? String(goal.value_max) : "");
  const [unit, setUnit] = useState<WeightUnit>(goal?.unit ?? displayUnit);

  useEffect(() => {
    if (!editing) {
      setType(goal?.type ?? "lose");
      setValue(goal?.value != null ? String(goal.value) : "");
      setValueMax(goal?.value_max != null ? String(goal.value_max) : "");
      setUnit(goal?.unit ?? displayUnit);
    }
  }, [goal, displayUnit, editing]);

  const save = useMutation({
    mutationFn: async (payload: Partial<{
      bodyweight_goal_type: GoalType | null;
      bodyweight_goal_value: number | null;
      bodyweight_goal_value_max: number | null;
      bodyweight_goal_unit: WeightUnit | null;
      bodyweight_goal_set_at: string | null;
    }>) => {
      const { error } = await supabase
        .from("clients")
        .update(payload as never)
        .eq("id", clientId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["client-bodyweight-goal", clientId] });
      qc.invalidateQueries({ queryKey: ["client", clientId] });
    },
  });

  const onSave = async () => {
    const v = Number(value);
    if (!value || Number.isNaN(v) || v <= 0) {
      toast.error("Enter a valid target weight.");
      return;
    }
    let vMax: number | null = null;
    if (type === "maintain" && valueMax) {
      const m = Number(valueMax);
      if (Number.isNaN(m) || m <= 0) { toast.error("Enter a valid upper weight."); return; }
      vMax = m;
    }
    await save.mutateAsync({
      bodyweight_goal_type: type,
      bodyweight_goal_value: v,
      bodyweight_goal_value_max: vMax,
      bodyweight_goal_unit: unit,
      bodyweight_goal_set_at: new Date().toISOString(),
    });
    toast.success("Goal saved.");
    setEditing(false);
  };

  const onRemove = async () => {
    if (!confirm("Remove your bodyweight goal?")) return;
    await save.mutateAsync({
      bodyweight_goal_type: null,
      bodyweight_goal_value: null,
      bodyweight_goal_value_max: null,
      bodyweight_goal_unit: null,
      bodyweight_goal_set_at: null,
    });
    toast.success("Goal removed.");
    setEditing(false);
  };

  const progress = computeGoalProgress(goal, series, displayUnit);
  const current = series[series.length - 1]?.value ?? null;

  return (
    <Card className="border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Bodyweight Goal</h3>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <Label htmlFor="goal-toggle" className="text-[11px] text-muted-foreground">
              {goal || editing ? "Editing" : "Set goal"}
            </Label>
            <Switch
              id="goal-toggle"
              checked={!!goal || editing}
              onCheckedChange={(checked) => {
                if (!checked && goal) { onRemove(); return; }
                setEditing(checked);
              }}
            />
          </div>
        )}
      </div>

      {!goal && !editing && (
        <p className="text-sm text-muted-foreground">
          Set an optional bodyweight goal to track progress alongside your log.
        </p>
      )}

      {(editing || !goal) && editing && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Goal type</Label>
              <Select value={type} onValueChange={(v) => setType(v as GoalType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(GOAL_TYPE_LABELS).map(([k, label]) => (
                    <SelectItem key={k} value={k}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Unit</Label>
              <Select value={unit} onValueChange={(v) => setUnit(v as WeightUnit)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="lb">lb</SelectItem>
                  <SelectItem value="kg">kg</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">
                {type === "maintain" ? "Low end" : "Target"}
              </Label>
              <Input
                type="number" step="0.1" inputMode="decimal"
                placeholder="e.g. 155"
                value={value} onChange={(e) => setValue(e.target.value)}
              />
            </div>
            {type === "maintain" && (
              <div>
                <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">High end</Label>
                <Input
                  type="number" step="0.1" inputMode="decimal"
                  placeholder="e.g. 160"
                  value={valueMax} onChange={(e) => setValueMax(e.target.value)}
                />
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={onSave} disabled={save.isPending} className="bg-gradient-primary font-bold uppercase btn-press">
              {save.isPending ? "Saving…" : "Save goal"}
            </Button>
            {goal && (
              <Button variant="outline" size="sm" onClick={onRemove} disabled={save.isPending}>
                <Trash2 className="mr-1 h-3.5 w-3.5" /> Remove
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {goal && !editing && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3 rounded-md border border-border bg-secondary/30 p-3 text-center">
            <div>
              <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Goal</div>
              <div className="text-sm font-bold">
                {goal.type === "maintain" && goal.value_max != null
                  ? `${goal.value}–${goal.value_max} ${goal.unit}`
                  : formatWeight(goal.value, goal.unit)}
              </div>
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Current</div>
              <div className="text-sm font-bold">
                {current != null ? formatWeight(current, displayUnit) : "—"}
              </div>
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Status</div>
              <div className={`text-sm font-bold ${
                progress.state === "ahead" || progress.state === "in_range" || progress.state === "at_goal"
                  ? "text-primary" : ""
              }`}>
                {progress.status || "—"}
              </div>
            </div>
          </div>
          {progress.ratio != null && (
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] uppercase tracking-widest text-muted-foreground">
                <span>Start</span><span>{Math.round(progress.ratio * 100)}%</span><span>Goal</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-gradient-primary transition-[width] duration-500"
                  style={{ width: `${Math.round(progress.ratio * 100)}%` }}
                />
              </div>
            </div>
          )}
          <div className="text-[11px] text-muted-foreground">
            {GOAL_TYPE_LABELS[goal.type]}
            {goal.type === "maintain" && goal.value_max != null
              ? ` · ${goal.value}–${goal.value_max} ${goal.unit}`
              : ""}
          </div>
        </div>
      )}
    </Card>
  );
}
