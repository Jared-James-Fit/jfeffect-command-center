import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Apple } from "lucide-react";
import { computeMemberTargets, type GoalKind } from "@/lib/member-targets";

const LB_TO_KG = 0.45359237;

export function MacroCalculator() {
  const [bw, setBw] = useState("180");
  const [unit, setUnit] = useState<"lb" | "kg">("lb");
  const [goal, setGoal] = useState<GoalKind>("maintain");

  const targets = useMemo(() => {
    const n = parseFloat(bw);
    if (!n) return undefined;
    const kg = unit === "lb" ? n * LB_TO_KG : n;
    return computeMemberTargets(kg, goal);
  }, [bw, unit, goal]);

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
      <div className="text-[11px] text-muted-foreground">Baseline only. Adjust with your coach based on progress.</div>
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