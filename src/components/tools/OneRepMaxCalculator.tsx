import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dumbbell } from "lucide-react";

const PCT = [100, 95, 90, 85, 80, 75, 70, 65, 60];

export function OneRepMaxCalculator() {
  const [weight, setWeight] = useState("225");
  const [reps, setReps] = useState("5");

  const oneRm = useMemo(() => {
    const w = parseFloat(weight);
    const r = parseInt(reps, 10);
    if (!w || !r || r < 1 || r > 12) return null;
    // Epley formula
    return Math.round(w * (1 + r / 30));
  }, [weight, reps]);

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Dumbbell className="h-5 w-5 text-primary" />
        <div>
          <div className="font-semibold">1 Rep Max</div>
          <div className="text-xs text-muted-foreground">Estimate from a recent set (Epley)</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="orm-w">Weight lifted</Label>
          <Input id="orm-w" type="number" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="orm-r">Reps (1-12)</Label>
          <Input id="orm-r" type="number" inputMode="numeric" value={reps} onChange={(e) => setReps(e.target.value)} />
        </div>
      </div>
      {oneRm ? (
        <div className="space-y-2">
          <div className="rounded-lg bg-muted/40 p-3 text-center">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Estimated 1RM</div>
            <div className="text-3xl font-bold">{oneRm}</div>
          </div>
          <div className="grid grid-cols-3 gap-1.5 text-center text-xs">
            {PCT.map((p) => (
              <div key={p} className="rounded bg-muted/30 p-1.5">
                <div className="font-mono">{Math.round((oneRm * p) / 100)}</div>
                <div className="text-muted-foreground">{p}%</div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">Enter weight and reps (1-12) to estimate.</div>
      )}
    </Card>
  );
}