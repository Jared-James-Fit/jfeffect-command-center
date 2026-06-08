import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Download, TrendingUp, Activity, BarChart3, Flag as FlagIcon, Trophy, Filter } from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from "recharts";
import { format, parseISO } from "date-fns";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import {
  getBlockAnalytics, buildExerciseSeries, movementCategory, analyticsToCSV,
  type BlockAnalytics,
} from "@/lib/block-analytics";

type Mode = "admin" | "client";
type BlockMetric = "volume" | "workouts_completed" | "avg_rpe" | "top_set" | "est_1rm" | "completion_pct";
type ExMetric = "top_set" | "est_1rm" | "volume" | "avg_rpe" | "reps" | "sets" | "frequency";

const BLOCK_METRIC_LABEL: Record<BlockMetric, string> = {
  volume: "Weekly Volume",
  workouts_completed: "Workouts Completed",
  avg_rpe: "Avg RPE",
  top_set: "Top Set",
  est_1rm: "Est. 1RM",
  completion_pct: "Completion %",
};
const EX_METRIC_LABEL: Record<ExMetric, string> = {
  top_set: "Top Set",
  est_1rm: "Est. 1RM",
  volume: "Volume",
  avg_rpe: "Avg RPE",
  reps: "Reps Performed",
  sets: "Sets Completed",
  frequency: "Frequency",
};

export function BlockProgressSection({ blockId, mode }: { blockId: string; mode: Mode }) {
  const { data: a, isLoading } = useQuery({
    queryKey: ["block-analytics", blockId],
    queryFn: () => getBlockAnalytics(blockId),
  });
  const [blockMetric, setBlockMetric] = useState<BlockMetric>("volume");
  const [exId, setExId] = useState<string | null>(null);
  const [exMetric, setExMetric] = useState<ExMetric>("top_set");
  const [weekFilter, setWeekFilter] = useState<string>("all");
  const [dayFilter, setDayFilter] = useState<string>("all");
  const [moveFilter, setMoveFilter] = useState<string>("all");

  if (isLoading || !a) {
    return <Card className="p-4 text-sm text-muted-foreground">Loading block progress…</Card>;
  }
  if (a.summary.sets_completed === 0 && a.summary.workouts_completed === 0) {
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground space-y-2">
        <Activity className="mx-auto h-8 w-8 opacity-50" />
        <p>No training data logged yet. Progress analytics will appear once workouts are completed.</p>
      </Card>
    );
  }

  const filteredExercises = a.exercises.filter((e) => {
    if (moveFilter !== "all" && movementCategory(e.category) !== moveFilter) return false;
    return true;
  });
  const selectedExId = exId ?? (filteredExercises[0]?.id ?? null);
  const exSeries = selectedExId ? buildExerciseSeries(a.sets.filter((s) => {
    if (weekFilter !== "all" && String(s.week_index) !== weekFilter) return false;
    if (dayFilter !== "all" && s.day_id !== dayFilter) return false;
    return true;
  }), selectedExId) : [];

  const filteredWeekly = a.weekly.filter((w) => weekFilter === "all" || String(w.week_index) === weekFilter);

  const handleExportCsv = () => {
    const csv = analyticsToCSV(a);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${a.block.name.replace(/\s+/g, "-")}-analytics.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="p-4 md:p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Block Progress</h3>
          <p className="text-sm font-bold">{a.block.name}</p>
        </div>
        {mode === "admin" && (
          <Button size="sm" variant="outline" onClick={handleExportCsv}>
            <Download className="mr-1 h-3.5 w-3.5" /> Export CSV
          </Button>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
        <Stat label="Workouts" value={`${a.summary.workouts_completed}/${a.summary.total_workouts}`} />
        <Stat label="Completion" value={`${a.summary.completion_pct}%`} />
        <Stat label="Sets" value={`${a.summary.sets_completed}/${a.summary.total_sets}`} />
        <Stat label={`Volume (${a.unit})`} value={a.summary.total_volume.toLocaleString()} />
        <Stat label="Avg RPE" value={a.summary.avg_rpe?.toString() ?? "—"} />
        <Stat label="Missed" value={String(a.summary.missed_workouts)} />
        <Stat label="Manual Weeks" value={String(a.summary.manual_weeks)} />
        <Stat label="Training Time" value={`${a.summary.total_training_min} min`} />
      </div>

      {/* Flags */}
      {a.flags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {a.flags.map((f, i) => (
            <Badge
              key={i}
              variant="outline"
              className={cn(
                "text-[10px]",
                f.tone === "warn" && "border-amber-500/40 bg-amber-500/10 text-amber-500",
                f.tone === "good" && "border-emerald-500/40 bg-emerald-500/10 text-emerald-500",
                f.tone === "info" && "border-sky-500/40 bg-sky-500/10 text-sky-500",
              )}
            >
              <FlagIcon className="mr-1 h-2.5 w-2.5" />{f.label}
            </Badge>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-secondary/20 p-2">
        <Filter className="h-3.5 w-3.5 text-muted-foreground" />
        <Select value={weekFilter} onValueChange={setWeekFilter}>
          <SelectTrigger className="h-8 w-32 text-xs"><SelectValue placeholder="Week" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All weeks</SelectItem>
            {a.weekly.map((w) => <SelectItem key={w.week_index} value={String(w.week_index)}>Week {w.week_index}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={dayFilter} onValueChange={setDayFilter}>
          <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder="Day" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All days</SelectItem>
            {a.workout_days.map((d) => (
              <SelectItem key={d.id} value={d.id}>W{d.week_index} D{d.day_index}{d.title ? ` · ${d.title}` : ""}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={moveFilter} onValueChange={setMoveFilter}>
          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {["Squat","Bench","Deadlift","Upper","Lower","Accessories"].map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Block graph */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2"><BarChart3 className="h-4 w-4 text-primary" /><span className="text-sm font-semibold">Block Trend</span></div>
          <ToggleGroup type="single" value={blockMetric} onValueChange={(v) => v && setBlockMetric(v as BlockMetric)} size="sm" className="flex-wrap">
            {(Object.keys(BLOCK_METRIC_LABEL) as BlockMetric[]).map((k) => (
              <ToggleGroupItem key={k} value={k} className="h-7 text-[10px] px-2">{BLOCK_METRIC_LABEL[k]}</ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <div className="h-56 w-full">
          <ResponsiveContainer>
            {blockMetric === "volume" || blockMetric === "workouts_completed" ? (
              <BarChart data={filteredWeekly}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="label" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Bar dataKey={blockMetric} fill="hsl(var(--primary))" />
              </BarChart>
            ) : (
              <LineChart data={filteredWeekly}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="label" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Line type="monotone" dataKey={blockMetric} stroke="hsl(var(--primary))" strokeWidth={2} dot />
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
      </div>

      {/* Exercise analytics */}
      {filteredExercises.length > 0 && (
        <div className="space-y-2 rounded-md border border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2"><TrendingUp className="h-4 w-4 text-primary" /><span className="text-sm font-semibold">Exercise Analytics</span></div>
            <Select value={selectedExId ?? ""} onValueChange={setExId}>
              <SelectTrigger className="h-8 w-56 text-xs"><SelectValue placeholder="Select exercise" /></SelectTrigger>
              <SelectContent>
                {filteredExercises.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <ToggleGroup type="single" value={exMetric} onValueChange={(v) => v && setExMetric(v as ExMetric)} size="sm" className="flex-wrap">
            {(Object.keys(EX_METRIC_LABEL) as ExMetric[]).map((k) => (
              <ToggleGroupItem key={k} value={k} className="h-7 text-[10px] px-2">{EX_METRIC_LABEL[k]}</ToggleGroupItem>
            ))}
          </ToggleGroup>
          <div className="h-56 w-full">
            <ResponsiveContainer>
              {exMetric === "volume" || exMetric === "reps" || exMetric === "sets" || exMetric === "frequency" ? (
                <BarChart data={(exMetric === "frequency"
                  ? Object.values(exSeries.reduce<Record<string, { label: string; frequency: number }>>((acc, p) => { const k = `W${p.week_index}`; acc[k] = acc[k] ?? { label: k, frequency: 0 }; acc[k].frequency += 1; return acc; }, {}))
                  : exSeries.map((p) => ({ label: p.date ? format(parseISO(p.date), "MMM d") : `W${p.week_index}`, ...p }))) as any[]}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="label" fontSize={11} />
                  <YAxis fontSize={11} />
                  <Tooltip />
                  <Bar dataKey={exMetric} fill="hsl(var(--primary))" />
                </BarChart>
              ) : (
                <LineChart data={exSeries.map((p) => ({ label: p.date ? format(parseISO(p.date), "MMM d") : `W${p.week_index}`, ...p }))}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="label" fontSize={11} />
                  <YAxis fontSize={11} />
                  <Tooltip />
                  <Line type="monotone" dataKey={exMetric} stroke="hsl(var(--primary))" strokeWidth={2} dot />
                </LineChart>
              )}
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* PRs */}
      {a.prs.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2"><Trophy className="h-4 w-4 text-amber-500" /><span className="text-sm font-semibold">Block PRs</span></div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {a.prs.map((pr, i) => (
              <div key={i} className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs">
                <div className="text-[10px] uppercase tracking-widest text-amber-600/80">{pr.label}</div>
                <div className="font-bold">{pr.value}</div>
                <div className="text-[11px] text-muted-foreground truncate">{pr.exercise}</div>
                {pr.date && <div className="text-[10px] text-muted-foreground">{format(parseISO(pr.date), "MMM d")}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Insights */}
      {a.insights.length > 0 && (
        <div className="space-y-2">
          <div className="text-sm font-semibold">Block Insights</div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {a.insights.map((it, i) => (
              <div key={i} className="rounded-md border border-border bg-secondary/30 p-2 text-xs">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{it.label}</div>
                <div className={cn("font-semibold", it.tone === "up" && "text-emerald-500", it.tone === "down" && "text-destructive")}>{it.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-secondary/20 p-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="text-sm font-bold truncate">{value}</div>
    </div>
  );
}