import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Moon } from "lucide-react";

// 90-min sleep cycles + ~14 min to fall asleep.
const CYCLE_MIN = 90;
const FALL_ASLEEP_MIN = 14;

function parseTime(s: string): { h: number; m: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h > 23 || min > 59) return null;
  return { h, m: min };
}

function fmt(h: number, m: number): string {
  const h12 = ((h + 11) % 12) + 1;
  const ampm = h < 12 ? "AM" : "PM";
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function add(time: { h: number; m: number }, minutes: number) {
  const total = ((time.h * 60 + time.m + minutes) % (24 * 60) + 24 * 60) % (24 * 60);
  return { h: Math.floor(total / 60), m: total % 60 };
}

export function SleepCalculator() {
  const [mode, setMode] = useState<"wake" | "bed">("wake");
  const [time, setTime] = useState("06:30");

  const results = useMemo(() => {
    const t = parseTime(time);
    if (!t) return null;
    // Show 4, 5, 6 cycles (best 5-6 for most adults).
    const cycles = [6, 5, 4];
    return cycles.map((c) => {
      const delta = c * CYCLE_MIN + FALL_ASLEEP_MIN;
      const result = mode === "wake" ? add(t, -delta) : add(t, delta);
      return { cycles: c, hours: (c * CYCLE_MIN) / 60, label: fmt(result.h, result.m) };
    });
  }, [time, mode]);

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Moon className="h-5 w-5 text-primary" />
        <div>
          <div className="font-semibold">Sleep Cycle</div>
          <div className="text-xs text-muted-foreground">Wake refreshed — based on 90-min cycles</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {([["wake", "I wake at…"], ["bed", "I'm going to bed at…"]] as const).map(([v, label]) => (
          <Button key={v} type="button" size="sm" variant={mode === v ? "default" : "outline"} onClick={() => setMode(v as any)}>
            {label}
          </Button>
        ))}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="sc-t">Time (24h)</Label>
        <Input id="sc-t" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
      </div>
      {results ? (
        <div className="space-y-1.5">
          <div className="text-xs text-muted-foreground">
            {mode === "wake" ? "Go to bed at one of these times:" : "Set your alarm for one of these times:"}
          </div>
          {results.map((r) => (
            <div key={r.cycles} className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2">
              <div className="text-base font-bold">{r.label}</div>
              <div className="text-[11px] text-muted-foreground">{r.hours}h · {r.cycles} cycles</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">Enter a time like 06:30.</div>
      )}
      <div className="text-[11px] text-muted-foreground">Most adults feel best with 5-6 full cycles (7.5-9h).</div>
    </Card>
  );
}