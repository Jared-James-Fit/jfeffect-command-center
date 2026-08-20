import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/components/action-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Scale, TrendingDown, TrendingUp, Target, Plus, History } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import {
  averageOfLast, convertWeight, filterByRange, formatWeight,
  weeklyChange,
  type WeightUnit,
} from "@/lib/progress-metrics";
import { useBodyweightGoal } from "@/lib/use-bodyweight-goal";
import { todayLocalISO } from "@/lib/today";
import { logBodyweight } from "@/lib/progress";
import { combinedBodyweightQueryKey, getCombinedBodyweightSeries } from "@/lib/bodyweight";
import { BodyweightSheetHeader } from "@/components/bodyweight/bodyweight-sheet-header";
import { BodyweightHistorySheet } from "@/components/bodyweight/bodyweight-history-sheet";

interface Props {
  clientId: string;
  userId: string;
  defaultUnit?: WeightUnit;
}

export function BodyweightSummaryCard({ clientId, userId, defaultUnit = "lb" }: Props) {
  const qc = useQueryClient();
  const [unit, setUnit] = useState<WeightUnit>(defaultUnit);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [weight, setWeight] = useState("");
  const [date, setDate] = useState(todayLocalISO());
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: rows = [] } = useQuery({
    queryKey: combinedBodyweightQueryKey(userId),
    enabled: !!userId,
    queryFn: () => getCombinedBodyweightSeries(userId, 200),
  });
  const { data: goal = null } = useBodyweightGoal(clientId);

  const series = useMemo(
    () => rows.map((row) => ({ date: row.date, value: convertWeight(row.value, row.unit, unit) })),
    [rows, unit],
  );
  const sparkSeries = useMemo(
    () => filterByRange(series, "30").map((p) => ({ d: p.date, v: Number(p.value.toFixed(1)) })),
    [series],
  );
  const latest = series[series.length - 1] ?? null;
  const avg7 = averageOfLast(series, 7);
  const change = weeklyChange(series);
  const goalTarget = goal ? convertWeight(goal.value, goal.unit, unit) : null;

  const todayEntry = rows.find((row) => row.date === date && row.source === "progress_bodyweight");

  const openSheet = () => {
    setWeight(todayEntry?.value != null
      ? String(convertWeight(todayEntry.value, todayEntry.unit, unit))
      : "");
    setDate(todayLocalISO());
    setSheetOpen(true);
  };

  // Allow the Action Centre "Bodyweight Update" task to open the log sheet
  // in-place without navigating away from the home page.
  useEffect(() => {
    const onOpen = () => openSheet();
    window.addEventListener("portal:log-bodyweight", onOpen);
    return () => window.removeEventListener("portal:log-bodyweight", onOpen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayEntry?.value, unit]);

  const save = async () => {
    const v = Number(weight);
    if (!weight || Number.isNaN(v) || v <= 0) throw new Error("Enter a valid bodyweight.");
    setSaving(true);
    try {
      if (!userId) throw new Error("Not signed in.");
      await logBodyweight({
        user_id: userId,
        weight_value: v,
        weight_unit: unit,
        logged_date: date,
        note: null,
      });
      toast.success("Bodyweight saved");
      setSheetOpen(false);
      window.setTimeout(() => {
        qc.invalidateQueries({ queryKey: combinedBodyweightQueryKey(userId) });
      }, 280);
    } finally {
      setSaving(false);
    }
  };

  const trendIcon = change == null ? null : change <= 0
    ? <TrendingDown className="h-3.5 w-3.5 text-emerald-500" />
    : <TrendingUp className="h-3.5 w-3.5 text-amber-500" />;

  const hasData = series.length > 0;

  return (
    <Card id="bodyweight-card" className="border-border bg-card p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Scale className="h-5 w-5 text-primary" />
          <h3 className="text-base font-bold">Bodyweight</h3>
        </div>
        <Button type="button" variant="ghost" size="sm" className="h-11 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground" onClick={() => setHistoryOpen(true)}>
          <History className="h-3.5 w-3.5" /> History
        </Button>
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
        <SheetContent
          side="bottom"
          hideCloseButton
          className="gap-0 rounded-t-2xl p-0"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            window.setTimeout(() => inputRef.current?.focus(), 220);
          }}
        >
          <BodyweightSheetHeader title="Log Bodyweight" />
          <div className="space-y-4 p-5 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
            <div>
              <Label className="text-xs uppercase tracking-widest text-muted-foreground">Weight</Label>
              <Input
                ref={inputRef}
                type="text"
                inputMode="decimal"
                pattern="[0-9]*\.?[0-9]*"
                enterKeyHint="done"
                placeholder="e.g. 182.4"
                className="h-12 text-lg"
                value={weight}
                onChange={(e) => {
                  const next = e.target.value.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
                  setWeight(next);
                }}
                onKeyDown={(e) => { if (e.key === "Enter" && weight && !saving) save(); }}
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
      <BodyweightHistorySheet open={historyOpen} onOpenChange={setHistoryOpen} rows={rows} unit={unit} />
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