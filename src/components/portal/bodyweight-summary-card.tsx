import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/components/action-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Scale, TrendingDown, TrendingUp, Target, Plus, History } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import {
  averageOfLast, convertWeight, filterByRange, formatWeight,
  normalizedBodyweightSeries, weeklyChange,
  type ProgressMetric, type WeightUnit,
} from "@/lib/progress-metrics";
import { useBodyweightGoal } from "@/lib/use-bodyweight-goal";
import { todayLocalISO } from "@/lib/today";

interface Props {
  clientId: string;
  defaultUnit?: WeightUnit;
}

export function BodyweightSummaryCard({ clientId, defaultUnit = "lb" }: Props) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [unit, setUnit] = useState<WeightUnit>(defaultUnit);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [weight, setWeight] = useState("");
  const [date, setDate] = useState(todayLocalISO());
  const [saving, setSaving] = useState(false);

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
  const sparkSeries = useMemo(
    () => filterByRange(series, "30").map((p) => ({ d: p.date, v: Number(p.value.toFixed(1)) })),
    [series],
  );
  const latest = series[series.length - 1] ?? null;
  const avg7 = averageOfLast(series, 7);
  const change = weeklyChange(series);
  const goalTarget = goal ? convertWeight(goal.value, goal.unit, unit) : null;

  const todayEntry = rows.find((r) => r.entry_date === date);

  const openSheet = () => {
    setWeight(todayEntry?.bodyweight != null
      ? String(convertWeight(Number(todayEntry.bodyweight), (todayEntry.bodyweight_unit as WeightUnit) ?? unit, unit))
      : "");
    setDate(todayLocalISO());
    setSheetOpen(true);
  };

  const save = async () => {
    const v = Number(weight);
    if (!weight || Number.isNaN(v) || v <= 0) throw new Error("Enter a valid bodyweight.");
    setSaving(true);
    try {
      // If an entry exists for that date, update it; else insert.
      const existing = rows.find((r) => r.entry_date === date);
      if (existing) {
        const { error } = await supabase.from("progress_metrics").update({
          bodyweight: v, bodyweight_unit: unit, source: "manual",
        } as never).eq("id", existing.id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase.from("progress_metrics").insert({
          client_id: clientId, entry_date: date, bodyweight: v,
          bodyweight_unit: unit, source: "manual", created_by: user?.id ?? null,
        } as never);
        if (error) throw new Error(error.message);
      }
      toast.success("Bodyweight saved");
      qc.invalidateQueries({ queryKey: ["progress-metrics", clientId] });
      setSheetOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const trendIcon = change == null ? null : change <= 0
    ? <TrendingDown className="h-3.5 w-3.5 text-emerald-500" />
    : <TrendingUp className="h-3.5 w-3.5 text-amber-500" />;

  const hasData = series.length > 0;

  return (
    <Card className="border-border bg-card p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Scale className="h-5 w-5 text-primary" />
          <h3 className="text-base font-bold">Bodyweight</h3>
        </div>
        <Link to="/portal/progress-metrics" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <History className="h-3.5 w-3.5" /> History
        </Link>
      </div>

      {hasData ? (
        <>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <Mini label="Latest" value={latest ? formatWeight(latest.value, unit) : "—"} />
            <Mini label="7-day avg" value={avg7 != null ? formatWeight(avg7, unit) : "—"} />
            <Mini
              label="Weekly"
              value={change != null ? `${change > 0 ? "+" : ""}${change.toFixed(1)} ${unit}` : "—"}
              icon={trendIcon}
            />
          </div>

          {sparkSeries.length >= 2 && (
            <div className="mt-3 h-[64px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={sparkSeries} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="bwSpark" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="d" hide />
                  <YAxis domain={["auto", "auto"]} hide />
                  <Area type="monotone" dataKey="v" stroke="var(--primary)" strokeWidth={2}
                    fill="url(#bwSpark)" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {goalTarget != null && (
            <div className="mt-3 flex items-center gap-2 rounded-md border border-border bg-secondary/30 px-3 py-2 text-xs">
              <Target className="h-3.5 w-3.5 text-primary" />
              <span className="text-muted-foreground">Goal</span>
              <span className="font-bold">{formatWeight(goalTarget, unit)}</span>
            </div>
          )}
        </>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">Track your weight over time — log your first weigh-in to get started.</p>
      )}

      <Button
        onClick={openSheet}
        className="mt-4 h-12 w-full bg-gradient-primary text-sm font-bold uppercase"
      >
        <Plus className="mr-1.5 h-4 w-4" />
        {hasData ? "Log Weight" : "Log First Weight"}
      </Button>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl p-0">
          <SheetHeader className="border-b border-border px-5 py-4">
            <SheetTitle>Log Bodyweight</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 p-5 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
            <div>
              <Label className="text-xs uppercase tracking-widest text-muted-foreground">Weight</Label>
              <Input
                autoFocus
                type="number" step="0.1" inputMode="decimal"
                placeholder="e.g. 182.4"
                className="h-12 text-lg"
                value={weight} onChange={(e) => setWeight(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs uppercase tracking-widest text-muted-foreground">Unit</Label>
                <Select value={unit} onValueChange={(v) => setUnit(v as WeightUnit)}>
                  <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="lb">lb</SelectItem>
                    <SelectItem value="kg">kg</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-widest text-muted-foreground">Date</Label>
                <Input type="date" className="h-11" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
            </div>
            {todayEntry && (
              <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs">
                You already logged a weight for this date. Saving will update it.
              </div>
            )}
            <ActionButton
              onAction={save}
              disabled={saving}
              loadingLabel="Saving…"
              successLabel="Saved"
              successToast={false}
              className="h-12 w-full bg-gradient-primary font-bold uppercase"
            >
              Save Bodyweight
            </ActionButton>
          </div>
        </SheetContent>
      </Sheet>
    </Card>
  );
}

function Mini({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-0.5 flex items-center justify-center gap-1 text-sm font-bold">{icon}{value}</div>
    </div>
  );
}