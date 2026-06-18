import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Layers } from "lucide-react";

const PLATES_LB = [45, 35, 25, 10, 5, 2.5];
const PLATES_KG = [25, 20, 15, 10, 5, 2.5, 1.25];

export function PlateCalculator() {
  const [target, setTarget] = useState("315");
  const [unit, setUnit] = useState<"lb" | "kg">("lb");
  const bar = unit === "lb" ? 45 : 20;
  const plates = unit === "lb" ? PLATES_LB : PLATES_KG;

  const breakdown = useMemo(() => {
    const total = parseFloat(target);
    if (!total || total < bar) return null;
    let perSide = (total - bar) / 2;
    const result: Array<{ size: number; count: number }> = [];
    for (const p of plates) {
      const count = Math.floor(perSide / p);
      if (count > 0) {
        result.push({ size: p, count });
        perSide -= count * p;
      }
    }
    return { result, leftover: Math.round(perSide * 100) / 100 };
  }, [target, unit, bar, plates]);

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Layers className="h-5 w-5 text-primary" />
        <div>
          <div className="font-semibold">Plate Calculator</div>
          <div className="text-xs text-muted-foreground">Plates per side for a target bar weight</div>
        </div>
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="pc-t">Target total ({unit})</Label>
          <Input id="pc-t" type="number" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
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
      {breakdown ? (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">Bar: {bar}{unit} · Per side:</div>
          {breakdown.result.length === 0 ? (
            <div className="text-sm">Just the bar.</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {breakdown.result.map((p) => (
                <div key={p.size} className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                  <span className="font-bold">{p.count}×</span> {p.size}{unit}
                </div>
              ))}
            </div>
          )}
          {breakdown.leftover > 0 && (
            <div className="text-xs text-amber-600">⚠ {breakdown.leftover}{unit} per side can't be matched with available plates.</div>
          )}
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">Target must be at least the bar weight ({bar}{unit}).</div>
      )}
    </Card>
  );
}