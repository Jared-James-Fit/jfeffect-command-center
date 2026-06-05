import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Trash2, Download, TrendingDown, TrendingUp, Scale } from "lucide-react";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  ReferenceLine, ReferenceArea,
} from "recharts";
import {
  averageNumeric, averageOfLast, convertWeight, filterByRange, formatWeight, normalizedBodyweightSeries,
  RANGE_OPTIONS, toCsv, weeklyChange, type ProgressMetric, type RangeValue, type WeightUnit,
} from "@/lib/progress-metrics";
import { ProgressMetricDialog } from "@/components/progress-metric-dialog";
import { BodyweightGoalCard } from "@/components/bodyweight-goal-card";
import { useBodyweightGoal } from "@/lib/use-bodyweight-goal";

interface Props {
  clientId: string;
  defaultUnit?: WeightUnit;
  canEdit?: boolean;
  showExport?: boolean;
  title?: string;
}

export function ProgressMetricsPanel({
  clientId, defaultUnit = "lb", canEdit = true, showExport = false, title = "Progress Metrics",
}: Props) {
  const qc = useQueryClient();
  const [unit, setUnit] = useState<WeightUnit>(defaultUnit);
  const [range, setRange] = useState<RangeValue>("30");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProgressMetric | null>(null);

  const { data: rows = [] } = useQuery({
    queryKey: ["progress-metrics", clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("progress_metrics")
        .select("*")
        .eq("client_id", clientId)
        .order("entry_date", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as ProgressMetric[];
    },
  });

  const series = useMemo(() => normalizedBodyweightSeries(rows, unit), [rows, unit]);
  const filtered = useMemo(() => filterByRange(series, range), [series, range]);
  const latest = series[series.length - 1] ?? null;
  const avg7 = averageOfLast(series, 7);
  const change = weeklyChange(series);
  const stepAvg = averageNumeric(rows, "steps", 7);
  const sleepAvg = averageNumeric(rows, "sleep_hours", 7);

  const recent = rows.slice(0, 10);
  const { data: goal = null } = useBodyweightGoal(clientId);
  const goalTarget = goal ? convertWeight(goal.value, goal.unit, unit) : null;
  const goalMax = goal?.value_max != null ? convertWeight(goal.value_max, goal.unit, unit) : null;

  const remove = async (id: string) => {
    if (!confirm("Delete this entry? This cannot be undone.")) return;
    const { error } = await supabase.from("progress_metrics").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Entry deleted.");
    qc.invalidateQueries({ queryKey: ["progress-metrics", clientId] });
  };

  const exportCsv = () => {
    const csv = toCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `progress-metrics-${clientId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <Card className="border-border bg-card p-6 space-y-5 md:col-span-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Scale className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">{title}</h3>
          </div>
          <div className="flex items-center gap-2">
            <Select value={unit} onValueChange={(v) => setUnit(v as WeightUnit)}>
              <SelectTrigger className="h-8 w-[80px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="lb">lb</SelectItem>
                <SelectItem value="kg">kg</SelectItem>
              </SelectContent>
            </Select>
            {showExport && (
              <Button size="sm" variant="outline" onClick={exportCsv}>
                <Download className="mr-1 h-4 w-4" /> Export
              </Button>
            )}
            {canEdit && (
              <Button size="sm" className="bg-gradient-primary font-bold uppercase" onClick={() => { setEditing(null); setDialogOpen(true); }}>
                <Plus className="mr-1 h-4 w-4" /> Add entry
              </Button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label="Latest bodyweight" value={latest ? formatWeight(latest.value, unit) : "—"} hint={latest ? format(parseISO(latest.date), "MMM d") : undefined} />
          <Tile label="7-day avg" value={avg7 != null ? formatWeight(avg7, unit) : "—"} />
          <Tile
            label="Weekly change"
            value={change != null ? `${change > 0 ? "+" : ""}${change.toFixed(1)} ${unit}` : "—"}
            hint={change != null ? (change <= 0 ? "down" : "up") : undefined}
            tone={change == null ? undefined : change <= 0 ? "down" : "up"}
          />
          <Tile label="Last logged" value={latest ? format(parseISO(latest.date), "MMM d, yyyy") : "—"} />
        </div>

        {(stepAvg != null || sleepAvg != null) && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {stepAvg != null && <Tile label="7d step avg" value={Math.round(stepAvg).toLocaleString()} />}
            {sleepAvg != null && <Tile label="7d sleep avg" value={`${sleepAvg.toFixed(1)} h`} />}
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Bodyweight trend</div>
            <Select value={range} onValueChange={(v) => setRange(v as RangeValue)}>
              <SelectTrigger className="h-8 w-[120px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {RANGE_OPTIONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {filtered.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No bodyweight entries in this range.
            </div>
          ) : (
            <div className="h-[220px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={filtered.map((p) => ({ date: p.date, value: Number(p.value.toFixed(1)) }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" tickFormatter={(d) => format(parseISO(d), "MMM d")} stroke="var(--muted-foreground)" fontSize={11} />
                  <YAxis domain={["auto", "auto"]} stroke="var(--muted-foreground)" fontSize={11} width={40} />
                  {goal && goal.type === "maintain" && goalTarget != null && goalMax != null && (
                    <ReferenceArea
                      y1={Math.min(goalTarget, goalMax)}
                      y2={Math.max(goalTarget, goalMax)}
                      fill="var(--primary)"
                      fillOpacity={0.08}
                    />
                  )}
                  {goal && goal.type !== "maintain" && goalTarget != null && (
                    <ReferenceLine
                      y={goalTarget}
                      stroke="var(--primary)"
                      strokeDasharray="4 4"
                      strokeOpacity={0.7}
                      label={{ value: `Goal ${goalTarget.toFixed(1)}`, fill: "var(--primary)", fontSize: 10, position: "insideTopRight" }}
                    />
                  )}
                  <Tooltip
                    contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8 }}
                    labelFormatter={(d) => format(parseISO(d as string), "MMM d, yyyy")}
                    formatter={(v: unknown) => [`${v} ${unit}`, "Bodyweight"]}
                  />
                  <Line type="monotone" dataKey="value" stroke="var(--primary)" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <BodyweightGoalCard
          clientId={clientId}
          goal={goal}
          series={series}
          displayUnit={unit}
          canEdit={canEdit}
        />

        <div className="space-y-2">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Recent entries</div>
          {recent.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No entries yet.</div>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {recent.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{format(parseISO(r.entry_date), "MMM d, yyyy")}</span>
                    {r.bodyweight != null && <span>{Number(r.bodyweight).toFixed(1)} {r.bodyweight_unit}</span>}
                    {r.steps != null && <Badge variant="outline" className="text-[10px]">{r.steps.toLocaleString()} steps</Badge>}
                    {r.sleep_hours != null && <Badge variant="outline" className="text-[10px]">{r.sleep_hours}h sleep</Badge>}
                    {r.resting_heart_rate != null && <Badge variant="outline" className="text-[10px]">RHR {r.resting_heart_rate}</Badge>}
                    {r.source && r.source !== "manual" && <Badge variant="outline" className="text-[10px]">Synced · {r.source}</Badge>}
                    {r.notes && <span className="text-xs text-muted-foreground">— {r.notes}</span>}
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" onClick={() => { setEditing(r); setDialogOpen(true); }}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => remove(r.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <ProgressMetricDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        clientId={clientId}
        defaultUnit={unit}
        entry={editing}
      />
    </>
  );
}

function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "up" | "down" }) {
  const Icon = tone === "down" ? TrendingDown : tone === "up" ? TrendingUp : null;
  const toneClass = tone === "down" ? "text-success" : tone === "up" ? "text-warning" : "";
  return (
    <div className="rounded-md border border-border bg-secondary/30 p-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`mt-1 flex items-center gap-1 text-lg font-black ${toneClass}`}>
        {Icon && <Icon className="h-4 w-4" />} {value}
      </div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}