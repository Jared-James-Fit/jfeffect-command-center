import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Apple, Save } from "lucide-react";
import { toast } from "sonner";
import {
  getMemberTargetsForUser,
  saveCoachOverrideTargets,
} from "@/lib/nutrition-targets/member-targets.functions";

type Props = { userId: string | null | undefined };

const SOURCE_TONE: Record<string, string> = {
  calculated: "bg-sky-500/10 text-sky-700 border-sky-500/30",
  manual: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  coach: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
};

export function CoachNutritionOverrideCard({ userId }: Props) {
  const qc = useQueryClient();
  const fetchTargets = useServerFn(getMemberTargetsForUser);
  const saveOverride = useServerFn(saveCoachOverrideTargets);

  const { data, isLoading } = useQuery({
    queryKey: ["coach-member-targets", userId],
    queryFn: () => fetchTargets({ data: { userId: userId! } }),
    enabled: !!userId,
  });

  const target = data?.target;

  const [editing, setEditing] = useState(false);
  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fat, setFat] = useState("");
  const [water, setWater] = useState("");
  const [goal, setGoal] = useState<"lose" | "maintain" | "gain" | "">("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!editing) {
      setCalories(target?.calories?.toString() ?? "");
      setProtein(target?.protein_g?.toString() ?? "");
      setCarbs(target?.carbs_g?.toString() ?? "");
      setFat(target?.fat_g?.toString() ?? "");
      setWater(target?.water_ml?.toString() ?? "");
      setGoal((target?.goal as any) ?? "");
      setNote("");
    }
  }, [target, editing]);

  const save = useMutation({
    mutationFn: () =>
      saveOverride({
        data: {
          userId: userId!,
          calories: Number(calories),
          protein_g: Number(protein),
          carbs_g: Number(carbs),
          fat_g: Number(fat),
          water_ml: water ? Number(water) : undefined,
          goal: (goal || undefined) as any,
          note: note || undefined,
        },
      }),
    onSuccess: () => {
      toast.success("Coach override saved");
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["coach-member-targets", userId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to save"),
  });

  if (!userId) {
    return (
      <Card className="border-border bg-card p-6 space-y-2">
        <h3 className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
          <Apple className="h-4 w-4" /> Calculated Macros (App)
        </h3>
        <p className="text-xs text-muted-foreground">
          This client has no linked login yet, so app-side macros can't be set.
        </p>
      </Card>
    );
  }

  const source = target?.source as string | undefined;

  return (
    <Card className="border-border bg-card p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
          <Apple className="h-4 w-4" /> Calculated Macros (App)
        </h3>
        {source && (
          <Badge variant="outline" className={`text-[11px] ${SOURCE_TONE[source] ?? ""}`}>
            Source: {source}
          </Badge>
        )}
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : !target && !editing ? (
        <>
          <p className="text-xs text-muted-foreground">
            No app-side macro targets set yet. You can enter coach-set numbers below.
          </p>
          <Button size="sm" className="bg-gradient-primary font-bold uppercase" onClick={() => setEditing(true)}>
            Set Coach Targets
          </Button>
        </>
      ) : !editing ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label="Calories" value={target!.calories} unit="kcal" />
            <Stat label="Protein" value={target!.protein_g} unit="g" />
            <Stat label="Carbs" value={target!.carbs_g} unit="g" />
            <Stat label="Fat" value={target!.fat_g} unit="g" />
            <Stat label="Water" value={target!.water_ml ?? "—"} unit={target!.water_ml ? "ml" : ""} />
          </div>
          {target!.goal && (
            <p className="text-[11px] text-muted-foreground">Goal: <span className="font-medium text-foreground">{target!.goal}</span></p>
          )}
          <Button size="sm" variant="outline" className="min-h-[44px]" onClick={() => setEditing(true)}>
            Edit / Override
          </Button>
        </>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <NumField label="Calories" value={calories} onChange={setCalories} />
            <NumField label="Protein (g)" value={protein} onChange={setProtein} />
            <NumField label="Carbs (g)" value={carbs} onChange={setCarbs} />
            <NumField label="Fat (g)" value={fat} onChange={setFat} />
            <NumField label="Water (ml)" value={water} onChange={setWater} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Goal</Label>
              <select
                value={goal}
                onChange={(e) => setGoal(e.target.value as any)}
                className="mt-1 min-h-[44px] w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">—</option>
                <option value="lose">Lose</option>
                <option value="maintain">Maintain</option>
                <option value="gain">Gain</option>
              </select>
            </div>
            <div>
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Note (internal)</Label>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="Why are you overriding?"
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              className="min-h-[44px] bg-gradient-primary font-bold uppercase"
              onClick={() => save.mutate()}
              disabled={save.isPending || !calories || !protein || !carbs || !fat}
            >
              <Save className="mr-2 h-4 w-4" />
              {save.isPending ? "Saving…" : "Save as Coach Override"}
            </Button>
            <Button size="sm" variant="outline" className="min-h-[44px]" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Saving deactivates the current active target and creates a new one with source “coach”. The member will see this immediately.
          </p>
        </div>
      )}
    </Card>
  );
}

function Stat({ label, value, unit }: { label: string; value: number | string; unit: string }) {
  return (
    <div className="rounded-md border border-border bg-secondary/30 p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-base font-semibold">
        {value} {unit && <span className="text-xs font-normal text-muted-foreground">{unit}</span>}
      </div>
    </div>
  );
}

function NumField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      <Input
        className="mt-1 min-h-[44px]"
        type="number"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}