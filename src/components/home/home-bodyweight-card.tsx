import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Scale, TrendingDown, TrendingUp, Plus, History, Loader2 } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { bodyweightQueryKey, listBodyweight, logBodyweight, type ProgressBodyweight } from "@/lib/progress";
import { todayLocalISO } from "@/lib/today";
import { BodyweightSheetHeader } from "@/components/bodyweight/bodyweight-sheet-header";
import { BodyweightHistorySheet } from "@/components/bodyweight/bodyweight-history-sheet";

type Surface = "portal" | "member";

interface Props {
  userId: string;
  surface: Surface;
  defaultUnit?: "kg" | "lb";
}

/**
 * Shared bodyweight summary card for both the client portal Home and the
 * member Home. Reads & writes the same `progress_bodyweight` rows the
 * Progress page already uses (keyed on user_id), so members and clients
 * see the same data here as on their Progress > Weight tab.
 */
export function HomeBodyweightCard({ userId, defaultUnit = "lb" }: Props) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [val, setVal] = useState("");
  const [unit, setUnit] = useState<"kg" | "lb">(defaultUnit);
  const [date, setDate] = useState(todayLocalISO());
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: rows = [] } = useQuery({
    queryKey: bodyweightQueryKey(userId),
    enabled: !!userId,
    queryFn: () => listBodyweight(userId),
    staleTime: 30_000,
  });

  const points = useMemo(
    () => (rows as ProgressBodyweight[])
      .map((row) => ({
        date: row.logged_date,
        value: Number(row.weight_value),
        unit: row.weight_unit,
      }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    [rows],
  );

  const latestPoint = points.length ? points[points.length - 1] : null;
  const stats = latestPoint
    ? { latest: Number(latestPoint.value), unit: latestPoint.unit }
    : null;
  const spark = useMemo(() => {
    const last = points.slice(-30);
    return last.map((r) => ({
      d: r.date,
      v: r.unit === unit
        ? Number(r.value)
        : r.unit === "kg"
          ? +(Number(r.value) * 2.20462).toFixed(2)
          : +(Number(r.value) / 2.20462).toFixed(2),
    }));
  }, [points, unit]);

  // 7-day average and weekly change in the active unit
  const recent = useMemo(() => spark.slice(-7), [spark]);
  const avg7 = recent.length ? +(recent.reduce((s, r) => s + r.v, 0) / recent.length).toFixed(1) : null;
  const weekChange = useMemo(() => {
    if (spark.length < 2) return null;
    const latest = spark[spark.length - 1];
    const latestDate = new Date(latest.d);
    const target = new Date(latestDate);
    target.setDate(target.getDate() - 7);
    // closest prior point on or before target
    let prev: typeof spark[number] | null = null;
    for (let i = spark.length - 2; i >= 0; i--) {
      if (new Date(spark[i].d) <= target) { prev = spark[i]; break; }
      prev = spark[i];
    }
    if (!prev) return null;
    return +(latest.v - prev.v).toFixed(1);
  }, [spark]);

  async function save() {
    const w = Number(val);
    if (!val || !Number.isFinite(w) || w <= 0) {
      toast.error("Enter a valid bodyweight");
      return;
    }
    setSaving(true);
    try {
      await logBodyweight({ user_id: userId, weight_value: w, weight_unit: unit, logged_date: date, note: null });
      toast.success("Weight logged");
      setVal("");
      setOpen(false);
      // Defer cache invalidation until after the sheet close animation
      // finishes so we don't jank the closing transition with a re-render.
      window.setTimeout(() => {
        qc.invalidateQueries({ queryKey: bodyweightQueryKey(userId) });
      }, 280);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save weight");
    } finally {
      setSaving(false);
    }
  }

  const trendIcon = weekChange == null ? null : weekChange <= 0
    ? <TrendingDown className="h-3.5 w-3.5 text-emerald-500" />
    : <TrendingUp className="h-3.5 w-3.5 text-amber-500" />;

  const hasData = !!stats;

  return (
    <Card className="border-border bg-card p-5">
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
            <Mini label="Latest" value={`${stats!.latest} ${stats!.unit}`} />
            <Mini label="7-day avg" value={avg7 != null ? `${avg7} ${unit}` : "—"} />
            <Mini
              label="Weekly"
              value={weekChange != null ? `${weekChange > 0 ? "+" : ""}${weekChange} ${unit}` : "—"}
              icon={trendIcon}
            />
          </div>
          {spark.length >= 2 && (
            <div className="mt-3 h-[64px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={spark} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="homeBwSpark" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="d" hide />
                  <YAxis domain={["auto", "auto"]} hide />
                  <Area type="monotone" dataKey="v" stroke="var(--primary)" strokeWidth={2}
                    fill="url(#homeBwSpark)" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">Track your weight over time — log your first weigh-in to get started.</p>
      )}

      <Button
        data-log-bw-trigger
        onClick={() => { setDate(todayLocalISO()); setOpen(true); }}
        className="mt-4 h-12 w-full bg-gradient-primary text-sm font-bold uppercase"
      >
        <Plus className="mr-1.5 h-4 w-4" />
        {hasData ? "Log Weight" : "Log First Weight"}
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          hideCloseButton
          className="gap-0 rounded-t-2xl p-0"
          onOpenAutoFocus={(e) => {
            // Defer focus until after the sheet's open animation so the
            // mobile keyboard doesn't fight the slide-up transition.
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
                value={val}
                onChange={(e) => {
                  // Allow only digits + a single decimal point — keeps the
                  // value typing-smooth on mobile without numeric spinners.
                  const next = e.target.value.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
                  setVal(next);
                }}
                onKeyDown={(e) => { if (e.key === "Enter" && val && !saving) save(); }}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs uppercase tracking-widest text-muted-foreground">Unit</Label>
                <Select value={unit} onValueChange={(v) => setUnit(v as "kg" | "lb")}>
                  <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="lb">lb</SelectItem>
                    <SelectItem value="kg">kg</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-widest text-muted-foreground">Date</Label>
                <Input type="date" className="h-11" max={todayLocalISO()} value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
            </div>
            {(rows as ProgressBodyweight[]).some((row) => row.logged_date === date) ? (
              <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs">
                You already logged a weight for this date. Saving will update it.
              </div>
            ) : null}
            <Button onClick={save} disabled={saving || !val} className="h-12 w-full bg-gradient-primary font-bold uppercase">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Bodyweight"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
      <BodyweightHistorySheet open={historyOpen} onOpenChange={setHistoryOpen} rows={rows as ProgressBodyweight[]} unit={unit} />
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