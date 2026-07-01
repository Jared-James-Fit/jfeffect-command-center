import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Apple, Loader2, Check, Target } from "lucide-react";
import { computeMemberTargets, type GoalKind } from "@/lib/member-targets";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { saveManualTargets } from "@/lib/nutrition-targets/member-targets.functions";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const LB_TO_KG = 0.45359237;

export function MacroCalculator() {
  const [bw, setBw] = useState("180");
  const [unit, setUnit] = useState<"lb" | "kg">("lb");
  const [goal, setGoal] = useState<GoalKind>("maintain");
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const saveFn = useServerFn(saveManualTargets);
  const qc = useQueryClient();

  const targets = useMemo(() => {
    const n = parseFloat(bw);
    if (!n) return undefined;
    const kg = unit === "lb" ? n * LB_TO_KG : n;
    return computeMemberTargets(kg, goal);
  }, [bw, unit, goal]);

  async function handleApply() {
    if (!targets) return;
    setSaving(true);
    try {
      const goalMap: Record<GoalKind, "lose" | "maintain" | "gain"> = {
        cut: "lose",
        maintain: "maintain",
        bulk: "gain",
      };
      await saveFn({
        data: {
          calories: Math.round(Number(targets.calories) || 0),
          protein_g: Math.round(Number(targets.protein) || 0),
          carbs_g: Math.round(Number(targets.carbs) || 0),
          fat_g: Math.round(Number(targets.fats) || 0),
          goal: goalMap[goal],
        },
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["m-nutrition-targets"] }),
        qc.invalidateQueries({ queryKey: ["m-nutrition-context"] }),
        qc.invalidateQueries({ queryKey: ["member-targets-history"] }),
      ]);
      toast.success("Nutrition targets updated", {
        description: "Your new targets are now live on the Nutrition page.",
      });
      setConfirmOpen(false);
    } catch (e: any) {
      toast.error("Couldn't save targets", { description: e?.message ?? "Please try again." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Apple className="h-5 w-5 text-primary" />
        <div>
          <div className="font-semibold">Macro Calculator</div>
          <div className="text-xs text-muted-foreground">Baseline calories + macros from bodyweight</div>
        </div>
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="mc-bw">Bodyweight</Label>
          <Input id="mc-bw" type="number" inputMode="decimal" value={bw} onChange={(e) => setBw(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>&nbsp;</Label>
          <div className="flex rounded-md border">
            {(["lb", "kg"] as const).map((u) => (
              <Button key={u} type="button" size="sm" variant={unit === u ? "default" : "ghost"} className="rounded-none first:rounded-l-md last:rounded-r-md" onClick={() => setUnit(u)}>
                {u}
              </Button>
            ))}
          </div>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Goal</Label>
        <div className="grid grid-cols-3 gap-2">
          {(["cut", "maintain", "bulk"] as const).map((g) => (
            <Button key={g} type="button" size="sm" variant={goal === g ? "default" : "outline"} onClick={() => setGoal(g)} className="capitalize">
              {g}
            </Button>
          ))}
        </div>
      </div>
      {targets ? (
        <div className="grid grid-cols-4 gap-2 text-center">
          <Stat label="Cal" value={targets.calories} />
          <Stat label="Protein" value={`${targets.protein}g`} />
          <Stat label="Carbs" value={`${targets.carbs}g`} />
          <Stat label="Fats" value={`${targets.fats}g`} />
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">Enter your bodyweight to see targets.</div>
      )}
      <Button
        type="button"
        className="w-full h-11 text-base"
        disabled={!targets || saving}
        onClick={() => setConfirmOpen(true)}
      >
        <Target className="mr-2 h-4 w-4" />
        Set as my nutrition targets
      </Button>
      <div className="text-[11px] text-muted-foreground">
        Baseline only. Adjust with your coach based on progress.
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apply these targets?</AlertDialogTitle>
            <AlertDialogDescription>
              This will replace your current daily targets on the Nutrition page with the values
              below. You can recalculate or change them any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {targets && (
            <div className="grid grid-cols-4 gap-2 text-center rounded-lg border p-3">
              <Stat label="Cal" value={targets.calories} />
              <Stat label="Protein" value={`${targets.protein}g`} />
              <Stat label="Carbs" value={`${targets.carbs}g`} />
              <Stat label="Fats" value={`${targets.fats}g`} />
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleApply();
              }}
              disabled={saving}
            >
              {saving ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</>
              ) : (
                <><Check className="mr-2 h-4 w-4" />Yes, apply</>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value == null) return null;
  return (
    <div className="rounded-lg bg-muted/40 p-2.5">
      <div className="text-base font-bold">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}