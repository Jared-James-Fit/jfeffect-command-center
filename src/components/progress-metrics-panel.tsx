import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Trash2, Download, Scale } from "lucide-react";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  ReferenceLine, ReferenceArea,
} from "recharts";
import { convertWeight, filterByRange, formatWeight, RANGE_OPTIONS, type RangeValue, type WeightUnit } from "@/lib/progress-metrics";
import {
  bodyweightCsv, bodyweightTiles, clientBodyweightQueryKey, clientBodyweightRefreshKeys, inUnit,
  loadClientBodyweight, type ClientBodyweightEntry,
} from "@/lib/client-bodyweight";
import { deleteBodyweight } from "@/lib/progress";
import { todayLocalISO } from "@/lib/today";
import { BodyweightEntryDialog } from "@/components/bodyweight/bodyweight-entry-dialog";
import { BodyweightGoalCard } from "@/components/bodyweight-goal-card";
import { useBodyweightGoal } from "@/lib/use-bodyweight-goal";

interface Props {
  clientId: string;
  defaultUnit?: WeightUnit;
  canEdit?: boolean;
  showExport?: boolean;
  title?: string;
}

/**
 * The coach's read of a client's bodyweight (Progress tab): every weigh-in the
 * client logged in the app plus the older coach-entered ones
 * (`loadClientBodyweight`), never the retired `progress_metrics` table alone.
 */
export function ProgressMetricsPanel({
  clientId, defaultUnit = "lb", canEdit = true, showExport = false, title = "Bodyweight",
}: Props) {
  const qc = useQueryClient();
  const [unit, setUnit] = useState<WeightUnit>(defaultUnit);
  const [range, setRange] = useState<RangeValue>("30");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ClientBodyweightEntry | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: clientBodyweightQueryKey(clientId),
    enabled: !!clientId,
    queryFn: () => loadClientBodyweight(clientId),
  });
  const entries = data?.entries ?? [];
  const userId = data?.userId ?? null;

  const series = useMemo(
    () => entries.map((e) => ({ date: e.date, value: inUnit(e.value, e.unit, unit) })),
    [entries, unit],
  );
  const filtered = useMemo(() => filterByRange(series, range), [series, range]);
  const tiles = useMemo(() => bodyweightTiles(entries, unit, todayLocalISO()), [entries, unit]);
  const recent = useMemo(() => [...entries].reverse().slice(0, 10), [entries]);

  const { data: goal = null } = useBodyweightGoal(clientId);
  const goalTarget = goal ? convertWeight(goal.value, goal.unit, unit) : null;
  const goalMax = goal?.value_max != null ? convertWeight(goal.value_max, goal.unit, unit) : null;

  const refresh = () => {
    for (const key of clientBodyweightRefreshKeys(clientId, userId)) qc.invalidateQueries({ queryKey: [...key] });
  };

  const remove = async (e: ClientBodyweightEntry) => {
    if (!confirm(`Delete the ${format(parseISO(e.date), "MMM d")} weigh-in? This can't be undone.`)) return;
    try {
      if (e.source === "progress_bodyweight" && userId) {
        await deleteBodyweight(userId, e.id);
      } else {
        const { error } = await supabase.from("progress_metrics").delete().eq("id", e.id);
        if (error) throw error;
      }
      toast.success("Weigh-in deleted.");
      refresh();
    } catch (err) {
      toast.error((err as { message?: string })?.message ?? "Couldn't delete the weigh-in.");
    }
  };

  const exportCsv = () => {
    const blob = new Blob([bodyweightCsv(entries)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bodyweight-${clientId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : "±"}${Math.abs(n).toFixed(1)} ${unit}`;

  return (
    <>
      <Card className="space-y-5 p-6 md:col-span-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Scale className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-base font-semibold">{title}</h3>
          </div>
          <div className="flex items-center gap-2">
            <Select value={unit} onValueChange={(v) => setUnit(v as WeightUnit)}>
              <SelectTrigger className="h-9 w-[80px]" aria-label="Unit"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="lb">lb</SelectItem>
                <SelectItem value="kg">kg</SelectItem>
              </SelectContent>
            </Select>
            {showExport && entries.length > 0 && (
              <Button size="sm" variant="outline" onClick={exportCsv}>
                <Download className="mr-1 h-4 w-4" /> Export
              </Button>
            )}
            {canEdit && (
              <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true); }}>
                <Plus className="mr-1 h-4 w-4" /> Add weigh-in
              </Button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-bodyweight-tiles>
          <Tile
            label="Latest"
            value={tiles.latest ? formatWeight(tiles.latest.value, unit) : isLoading ? "…" : "—"}
            hint={tiles.latest ? format(parseISO(tiles.latest.date), "EEE, MMM d") : undefined}
          />
          <Tile
            label="7-day average"
            value={tiles.avg7 != null ? formatWeight(tiles.avg7, unit) : "—"}
            hint={tiles.avg7 != null ? undefined : "none this week"}
          />
          <Tile
            label="Weekly change"
            value={tiles.weeklyChange != null ? signed(tiles.weeklyChange) : "—"}
            hint={tiles.weeklyChange != null ? "7-day avg vs the week before" : "needs a weigh-in in each week"}
          />
          <Tile
            label="Weigh-ins this week"
            value={`${Math.min(tiles.count7, 7)} of 7`}
            hint="days logged"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-muted-foreground">Trend</div>
            <Select value={range} onValueChange={(v) => setRange(v as RangeValue)}>
              <SelectTrigger className="h-9 w-[120px]" aria-label="Range"><SelectValue /></SelectTrigger>
              <SelectContent>
                {RANGE_OPTIONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {filtered.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              {isLoading ? "Loading…" : tiles.latest
                ? `No weigh-ins in this range. The last one was ${format(parseISO(tiles.latest.date), "MMM d, yyyy")}.`
                : "No weigh-ins yet."}
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
          <div className="text-sm font-medium text-muted-foreground">Recent weigh-ins</div>
          {recent.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              {isLoading ? "Loading…" : "No weigh-ins yet."}
            </div>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {recent.map((e) => (
                <li key={`${e.source}:${e.id}`} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">{format(parseISO(e.date), "EEE, MMM d, yyyy")}</span>
                    <span className="tabular-nums">{formatWeight(inUnit(e.value, e.unit, unit), unit)}</span>
                    {e.note && <span className="truncate text-xs text-muted-foreground">· {e.note}</span>}
                  </div>
                  {canEdit && (
                    <div className="flex shrink-0 items-center">
                      <Button size="icon" variant="ghost" className="h-10 w-10" aria-label="Edit weigh-in" onClick={() => { setEditing(e); setDialogOpen(true); }}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-10 w-10" aria-label="Delete weigh-in" onClick={() => remove(e)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <BodyweightEntryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        clientId={clientId}
        userId={userId}
        defaultUnit={unit}
        entry={editing}
        onSaved={refresh}
      />
    </>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
