import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Droplets } from "lucide-react";

const LB_TO_KG = 0.45359237;

export function WaterCalculator() {
  const [bw, setBw] = useState("180");
  const [unit, setUnit] = useState<"lb" | "kg">("lb");
  const [activity, setActivity] = useState<"low" | "moderate" | "high">("moderate");

  const targets = useMemo(() => {
    const n = parseFloat(bw);
    if (!n) return undefined;
    const lb = unit === "kg" ? n / LB_TO_KG : n;
    // 0.5 oz/lb baseline, +12/+20 oz for moderate/high activity
    const baseOz = lb * 0.5;
    const addOz = activity === "low" ? 0 : activity === "moderate" ? 12 : 24;
    const totalOz = Math.round(baseOz + addOz);
    const liters = Math.round((totalOz / 33.814) * 10) / 10;
    const cups = Math.round(totalOz / 8);
    return { oz: totalOz, liters, cups };
  }, [bw, unit, activity]);

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Droplets className="h-5 w-5 text-primary" />
        <div>
          <div className="font-semibold">Water Intake</div>
          <div className="text-xs text-muted-foreground">Daily hydration target from bodyweight + activity</div>
        </div>
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="wc-bw">Bodyweight</Label>
          <Input id="wc-bw" type="number" inputMode="decimal" value={bw} onChange={(e) => setBw(e.target.value)} />
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
        <Label>Activity</Label>
        <div className="grid grid-cols-3 gap-2">
          {(["low", "moderate", "high"] as const).map((a) => (
            <Button key={a} type="button" size="sm" variant={activity === a ? "default" : "outline"} onClick={() => setActivity(a)} className="capitalize">
              {a}
            </Button>
          ))}
        </div>
      </div>
      {targets ? (
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat label="Liters" value={`${targets.liters}L`} />
          <Stat label="Ounces" value={`${targets.oz}oz`} />
          <Stat label="Cups" value={targets.cups} />
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">Enter your bodyweight to see a target.</div>
      )}
      <div className="text-[11px] text-muted-foreground">Add more on hot days or hard training sessions.</div>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-muted/40 p-2.5">
      <div className="text-base font-bold">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}