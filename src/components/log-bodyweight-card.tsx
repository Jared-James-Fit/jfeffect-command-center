import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Scale, Check, TrendingDown, TrendingUp, Target } from "lucide-react";
import { Link } from "@tanstack/react-router";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine, ReferenceArea,
} from "recharts";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import { useAuth } from "@/lib/auth";
import {
  acknowledgementForLog, averageOfLast, computeGoalProgress, convertWeight,
  filterByRange, formatWeight, normalizedBodyweightSeries, weeklyChange,
  type ProgressMetric, type RangeValue, type WeightUnit,
} from "@/lib/progress-metrics";
import { useBodyweightGoal } from "@/lib/use-bodyweight-goal";

interface Props {
  clientId: string;
  defaultUnit?: WeightUnit;
}

const COMPACT_RANGES: { value: RangeValue; label: string }[] = [
  { value: "7", label: "7D" },
  { value: "30", label: "30D" },
  { value: "90", label: "90D" },
];

export function LogBodyweightCard({ clientId, defaultUnit = "lb" }: Props) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [unit, setUnit] = useState<WeightUnit>(defaultUnit);
  const [weight, setWeight] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [range, setRange] = useState<RangeValue>("30");

  const { data: rows = [] } = useQuery({
    queryKey: ["progress-metrics", clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const { data } = await supabase
        .from("progress_metrics").select("*")
        .eq("client_id", clientId).order("entry_date", { ascending: false }).limit(120);
      return (data ?? []) as ProgressMetric[];
    },
  });

  const { data: goal = null } = useBodyweightGoal(clientId);

  const series = useMemo(() => normalizedBodyweightSeries(rows, unit), [rows, unit]);
  const chartSeries = useMemo(
    () => filterByRange(series, range).map((p) => ({ date: p.date, value: Number(p.value.toFixed(1)) })),
    [series, range],
  );
  const latest = series[series.length - 1] ?? null;
  const avg7 = averageOfLast(series, 7);
  const change = weeklyChange(series);
  const progress = computeGoalProgress(goal, series, unit);

  const goalTarget = goal ? convertWeight(goal.value, goal.unit, unit) : null;
  const goalMax = goal?.value_max != null ? convertWeight(goal.value_max, goal.unit, unit) : null;

  const save = async () => {
    const v = Number(weight);
    if (!weight || Number.isNaN(v) || v <= 0) {
      toast.error("Enter a valid bodyweight.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("progress_metrics").insert({
      client_id: clientId,
      entry_date: date,
      bodyweight: v,
      bodyweight_unit: unit,
      source: "manual",
      created_by: user?.id ?? null,
    } as never);
    setSaving(false);
    if (error) { toast.error(error.message); return; }

    toast.success(acknowledgementForLog({
      prior: latest?.value ?? null,
      next: convertWeight(v, unit, unit),
      goal,
      displayUnit: unit,
    }));
    setWeight("");
    setJustSaved(true);
    window.setTimeout(() => setJustSaved(false), 1400);
    qc.invalidateQueries({ queryKey: ["progress-metrics", clientId] });
  };

  const trendIcon = change == null ? null : change <= 0 ? (
    <TrendingDown className="h-3 w-3 text-primary" />
  ) : (
    <TrendingUp className="h-3 w-3 text-muted-foreground" />
  );

  return (
    <Card className={`relative overflow-hidden border-border bg-card p-5 space-y-4 card-hover ${justSaved ? "ring-1 ring-primary/60" : ""}`}>
      {justSaved && (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-background/40 backdrop-blur-[1px] animate-fade-in">
          <div className="flex flex-col items-center gap-1 text-primary animate-scale-in">
            <div className="grid h-10 w-10 place-items-center rounded-full bg-primary/15 ring-1 ring-primary/40">
              <Check className="h-5 w-5" />
            </div>
            <span className="text-[10px] font-bold uppercase tracking-widest">Saved</span>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Scale className="h-4 w-4 text-primary" />
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Log Bodyweight</h3>
        </div>
        <Link to="/portal/progress-metrics" className="text-xs text-primary hover:underline">View history</Link>
      </div>

      <div className="grid gap-2 sm:grid-cols-[1fr_80px_auto]">
        <div>
          <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Weight</Label>
          <Input type="number" step="0.1" inputMode="decimal" placeholder="e.g. 182.4" value={weight} onChange={(e) => setWeight(e.target.value)} />
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
        <div>
          <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Date</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>

      <Button onClick={save} disabled={saving} className="w-full bg-gradient-primary font-bold uppercase btn-press">
        {saving ? "Saving…" : "Save Bodyweight"}
      </Button>

      {/* Mini sparkline + range toggle */}
      <div className="space-y-2 border-t border-border pt-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Trend</span>
          <div className="flex items-center gap-1 rounded-full border border-border bg-secondary/40 p-0.5">
            {COMPACT_RANGES.map((r) => (
              <button
                key={r.value}
                type="button"
                onClick={() => setRange(r.value)}
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest transition ${
                  range === r.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >{r.label}</button>
            ))}
          </div>
        </div>
        {chartSeries.length < 2 ? (
          <div className="rounded-md border border-dashed border-border/70 p-4 text-center text-xs text-muted-foreground">
            Add a few more weigh-ins to see your trend.
          </div>
        ) : (
          <div className="h-[110px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartSeries} margin={{ top: 4, right: 6, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="bwGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" hide />
                <YAxis domain={["auto", "auto"]} hide />
                {goal && goal.type === "maintain" && goalMax != null && goalTarget != null && (
                  <ReferenceArea
                    y1={Math.min(goalTarget, goalMax)}
                    y2={Math.max(goalTarget, goalMax)}
                    fill="var(--primary)"
                    fillOpacity={0.08}
                  />
                )}
                {goal && goal.type !== "maintain" && goalTarget != null && (
                  <ReferenceLine y={goalTarget} stroke="var(--primary)" strokeDasharray="4 4" strokeOpacity={0.6} />
                )}
                <Tooltip
                  contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                  labelFormatter={(d) => format(parseISO(d as string), "MMM d")}
                  formatter={(v: unknown) => [`${v} ${unit}`, "Bodyweight"]}
                />
                <Area
                  type="monotone" dataKey="value"
                  stroke="var(--primary)" strokeWidth={2}
                  fill="url(#bwGrad)"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 border-t border-border pt-3 text-center">
        <Mini label="Latest" value={latest ? formatWeight(latest.value, unit) : "—"} />
        <Mini label="7-day avg" value={avg7 != null ? formatWeight(avg7, unit) : "—"} />
        <Mini
          label="Weekly change"
          value={change != null ? `${change > 0 ? "+" : ""}${change.toFixed(1)} ${unit}` : "—"}
          icon={trendIcon}
        />
      </div>

      {goal && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-secondary/30 px-3 py-2 text-xs">
          <div className="flex items-center gap-2">
            <Target className="h-3.5 w-3.5 text-primary" />
            <span className="text-muted-foreground">Goal</span>
            <span className="font-bold">
              {goal.type === "maintain" && goal.value_max != null
                ? `${goal.value}–${goal.value_max} ${goal.unit}`
                : `${goal.value} ${goal.unit}`}
            </span>
          </div>
          <span className={`font-bold ${
            progress.state === "ahead" || progress.state === "in_range" || progress.state === "at_goal"
              ? "text-primary" : "text-muted-foreground"
          }`}>
            {progress.status || "—"}
          </span>
        </div>
      )}
    </Card>
  );
}

function Mini({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="flex items-center justify-center gap-1 text-sm font-bold">{icon}{value}</div>
    </div>
  );
}
