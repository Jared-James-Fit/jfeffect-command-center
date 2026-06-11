import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ArrowRight, BarChart3, Dumbbell, ListChecks, Trophy } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";

const sb = supabase as any;

type Block = { id: string; name: string; start_date: string | null; end_date: string | null; status: string; archived: boolean };
type Row = { id: string; day_id: string; exercise_id: string | null; exercise_name_override: string | null; sort_order: number };
type Day = { id: string; week_id: string; day_index: number; title: string | null };
type Week = { id: string; block_id: string; week_index: number };
type Result = { row_id: string; set_index: number; actual_load: number | null; actual_load_unit: string | null; actual_reps: number | null; actual_rpe: string | null; notes: string | null; completed_at: string | null };
type Completion = { day_id: string; completed_at: string | null };
type Exercise = { id: string; name: string };

type BlockData = {
  block: Block;
  weeks: Week[];
  days: Day[];
  rows: Row[];
  results: Result[];
  completions: Completion[];
  exerciseNameById: Map<string, string>;
};

async function loadBlockData(blockId: string, clientId: string): Promise<BlockData | null> {
  const { data: block } = await sb.from("pl_blocks").select("id, name, start_date, end_date, status, archived").eq("id", blockId).maybeSingle();
  if (!block) return null;
  const { data: weeks = [] } = await sb.from("pl_weeks").select("id, block_id, week_index").eq("block_id", blockId);
  const weekIds = (weeks as Week[]).map((w) => w.id);
  const { data: days = [] } = weekIds.length
    ? await sb.from("pl_days").select("id, week_id, day_index, title").in("week_id", weekIds)
    : { data: [] };
  const dayIds = (days as Day[]).map((d) => d.id);
  const [{ data: rows = [] }, { data: completions = [] }] = await Promise.all([
    dayIds.length ? sb.from("pl_exercise_rows").select("id, day_id, exercise_id, exercise_name_override, sort_order").in("day_id", dayIds) : Promise.resolve({ data: [] }),
    dayIds.length ? sb.from("pl_day_completions").select("day_id, completed_at").in("day_id", dayIds).eq("client_id", clientId) : Promise.resolve({ data: [] }),
  ]);
  const rowIds = (rows as Row[]).map((r) => r.id);
  const { data: results = [] } = rowIds.length
    ? await sb.from("pl_row_results").select("row_id, set_index, actual_load, actual_load_unit, actual_reps, actual_rpe, notes, completed_at").in("row_id", rowIds).eq("client_id", clientId)
    : { data: [] };
  const exerciseIds = Array.from(new Set((rows as Row[]).map((r) => r.exercise_id).filter(Boolean) as string[]));
  const { data: exercises = [] } = exerciseIds.length
    ? await sb.from("exercises").select("id, name").in("id", exerciseIds)
    : { data: [] };
  const exerciseNameById = new Map<string, string>((exercises as Exercise[]).map((e) => [e.id, e.name]));
  return {
    block: block as Block,
    weeks: weeks as Week[],
    days: days as Day[],
    rows: rows as Row[],
    results: results as Result[],
    completions: completions as Completion[],
    exerciseNameById,
  };
}

function rowExerciseName(r: Row, nameMap: Map<string, string>): string {
  return r.exercise_name_override ?? (r.exercise_id ? nameMap.get(r.exercise_id) ?? "Exercise" : "Exercise");
}

function bestSet(results: Result[]): Result | null {
  if (results.length === 0) return null;
  // Best by load, tiebreak by reps
  return [...results].sort((a, b) => {
    const la = a.actual_load ?? -1;
    const lb = b.actual_load ?? -1;
    if (lb !== la) return lb - la;
    return (b.actual_reps ?? 0) - (a.actual_reps ?? 0);
  })[0];
}

function fmtSet(s: Result | null): string {
  if (!s) return "—";
  const load = s.actual_load != null ? `${s.actual_load}${s.actual_load_unit ? ` ${s.actual_load_unit}` : ""}` : "BW";
  const reps = s.actual_reps != null ? ` × ${s.actual_reps}` : "";
  const rpe = s.actual_rpe ? ` @ RPE ${s.actual_rpe}` : "";
  return `${load}${reps}${rpe}`;
}

function blockSummary(data: BlockData) {
  const totalWorkouts = data.days.length;
  const completedDayIds = new Set(data.completions.filter((c) => c.completed_at).map((c) => c.day_id));
  const completed = completedDayIds.size;
  const pct = totalWorkouts > 0 ? Math.round((completed / totalWorkouts) * 100) : 0;

  // Top PRs: group results by exercise key, pick best set
  const byExercise = new Map<string, Result[]>();
  for (const r of data.rows) {
    const name = rowExerciseName(r, data.exerciseNameById);
    const list = byExercise.get(name) ?? [];
    const matches = data.results.filter((res) => res.row_id === r.id);
    list.push(...matches);
    byExercise.set(name, list);
  }
  const prs = [...byExercise.entries()]
    .map(([name, results]) => ({ name, best: bestSet(results) }))
    .filter((x) => x.best && x.best.actual_load != null)
    .sort((a, b) => (b.best!.actual_load ?? 0) - (a.best!.actual_load ?? 0))
    .slice(0, 3);

  return { totalWorkouts, completed, missed: totalWorkouts - completed, pct, prs };
}

/* ============================== */
export function ProgressComparison({ clientId }: { clientId: string }) {
  const { data: blocks = [], isLoading: blocksLoading } = useQuery({
    queryKey: ["progress-comp-blocks", clientId],
    queryFn: async () => {
      const { data } = await sb
        .from("pl_blocks")
        .select("id, name, start_date, end_date, status, archived")
        .eq("client_id", clientId)
        .order("start_date", { ascending: false, nullsFirst: false });
      return (data ?? []) as Block[];
    },
  });

  const [blockAId, setBlockAId] = useState<string | null>(null);
  const [blockBId, setBlockBId] = useState<string | null>(null);

  // Default: A = current (latest non-archived), B = next previous
  useEffect(() => {
    if (blocks.length === 0 || blockAId || blockBId) return;
    const active = blocks.find((b) => !b.archived && b.status !== "Completed") ?? blocks[0];
    const others = blocks.filter((b) => b.id !== active?.id);
    setBlockAId(active?.id ?? null);
    setBlockBId(others[0]?.id ?? null);
  }, [blocks, blockAId, blockBId]);

  const aQuery = useQuery({
    queryKey: ["progress-comp-data", clientId, blockAId],
    enabled: !!blockAId,
    queryFn: () => loadBlockData(blockAId!, clientId),
  });
  const bQuery = useQuery({
    queryKey: ["progress-comp-data", clientId, blockBId],
    enabled: !!blockBId,
    queryFn: () => loadBlockData(blockBId!, clientId),
  });

  if (blocksLoading) {
    return <Card className="p-6 text-sm text-muted-foreground">Loading blocks…</Card>;
  }
  if (blocks.length < 1) {
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">
        <BarChart3 className="mx-auto mb-2 h-6 w-6 opacity-60" />
        Not enough history yet. Once more workouts are completed, progress comparisons will appear here.
      </Card>
    );
  }

  const a = aQuery.data ?? null;
  const b = bQuery.data ?? null;

  return (
    <div className="space-y-4">
      {/* Block pickers */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <BlockPicker label="Current / Block A" blocks={blocks} value={blockAId} onChange={setBlockAId} tone="primary" />
        <BlockPicker label="Previous / Block B" blocks={blocks} value={blockBId} onChange={setBlockBId} />
      </div>

      <Tabs defaultValue="summary" className="space-y-3">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="summary" className="text-xs sm:text-sm"><Trophy className="mr-1 h-3.5 w-3.5" />Summary</TabsTrigger>
          <TabsTrigger value="exercise" className="text-xs sm:text-sm"><Dumbbell className="mr-1 h-3.5 w-3.5" />Exercise</TabsTrigger>
          <TabsTrigger value="completion" className="text-xs sm:text-sm"><ListChecks className="mr-1 h-3.5 w-3.5" />Workout Days</TabsTrigger>
        </TabsList>

        <TabsContent value="summary">
          <SummaryView a={a} b={b} loadingA={aQuery.isLoading} loadingB={bQuery.isLoading} />
        </TabsContent>
        <TabsContent value="exercise">
          <ExerciseView a={a} b={b} loadingA={aQuery.isLoading} loadingB={bQuery.isLoading} />
        </TabsContent>
        <TabsContent value="completion">
          <CompletionView a={a} b={b} loadingA={aQuery.isLoading} loadingB={bQuery.isLoading} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function BlockPicker({
  label, blocks, value, onChange, tone,
}: { label: string; blocks: Block[]; value: string | null; onChange: (v: string) => void; tone?: "primary" }) {
  return (
    <div>
      <div className={`mb-1 text-[11px] font-bold uppercase tracking-widest ${tone === "primary" ? "text-primary" : "text-muted-foreground"}`}>{label}</div>
      <Select value={value ?? undefined} onValueChange={onChange}>
        <SelectTrigger><SelectValue placeholder="Select a block" /></SelectTrigger>
        <SelectContent>
          {blocks.map((b) => (
            <SelectItem key={b.id} value={b.id}>
              <span className="font-semibold">{b.name}</span>
              {b.start_date && <span className="ml-2 text-xs text-muted-foreground">{format(parseISO(b.start_date), "MMM yyyy")}</span>}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/* -------- Summary -------- */
function SummaryView({ a, b, loadingA, loadingB }: { a: BlockData | null; b: BlockData | null; loadingA: boolean; loadingB: boolean }) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <SummaryCard data={a} loading={loadingA} tone="primary" />
      <SummaryCard data={b} loading={loadingB} />
    </div>
  );
}
function SummaryCard({ data, loading, tone }: { data: BlockData | null; loading: boolean; tone?: "primary" }) {
  if (loading) return <Card className="p-4 text-sm text-muted-foreground">Loading…</Card>;
  if (!data) return <Card className="p-4 text-sm text-muted-foreground">Select a block.</Card>;
  const s = blockSummary(data);
  return (
    <Card className={`p-4 ${tone === "primary" ? "border-primary/40" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-black">{data.block.name}</div>
          <div className="text-[11px] text-muted-foreground">
            {data.block.start_date ? format(parseISO(data.block.start_date), "MMM d, yyyy") : "—"}
            {data.block.end_date ? ` → ${format(parseISO(data.block.end_date), "MMM d, yyyy")}` : ""}
          </div>
        </div>
        <Badge variant="outline" className="text-[10px]">{data.block.status}</Badge>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Stat label="Completed" value={String(s.completed)} />
        <Stat label="Missed" value={String(s.missed)} />
        <Stat label="Rate" value={`${s.pct}%`} />
      </div>
      <div className="mt-3">
        <div className="mb-1 flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          <Trophy className="h-3 w-3" /> Top PRs
        </div>
        {s.prs.length === 0 ? (
          <div className="text-xs text-muted-foreground">No logged sets yet.</div>
        ) : (
          <ul className="space-y-1 text-xs">
            {s.prs.map((p) => (
              <li key={p.name} className="flex justify-between gap-2">
                <span className="truncate font-semibold">{p.name}</span>
                <span className="shrink-0 text-muted-foreground">{fmtSet(p.best)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-secondary/40 p-2">
      <div className="text-base font-black">{value}</div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
    </div>
  );
}

/* -------- Exercise -------- */
function ExerciseView({ a, b, loadingA, loadingB }: { a: BlockData | null; b: BlockData | null; loadingA: boolean; loadingB: boolean }) {
  const allNames = useMemo(() => {
    const set = new Set<string>();
    for (const d of [a, b]) {
      if (!d) continue;
      for (const r of d.rows) set.add(rowExerciseName(r, d.exerciseNameById));
    }
    return [...set].sort();
  }, [a, b]);

  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (!selected && allNames.length > 0) setSelected(allNames[0]);
  }, [allNames, selected]);

  if (loadingA || loadingB) return <Card className="p-4 text-sm text-muted-foreground">Loading…</Card>;
  if (allNames.length === 0) {
    return <Card className="p-6 text-center text-sm text-muted-foreground">No exercises logged in either block yet.</Card>;
  }

  const resultsFor = (d: BlockData | null, name: string): Result[] => {
    if (!d) return [];
    const rowIds = d.rows.filter((r) => rowExerciseName(r, d.exerciseNameById) === name).map((r) => r.id);
    return d.results.filter((res) => rowIds.includes(res.row_id) && res.actual_load != null);
  };

  const aResults = selected ? resultsFor(a, selected) : [];
  const bResults = selected ? resultsFor(b, selected) : [];
  const aBest = bestSet(aResults);
  const bBest = bestSet(bResults);
  const recent = (rs: Result[]) =>
    [...rs].sort((x, y) => (y.completed_at ?? "").localeCompare(x.completed_at ?? ""))[0] ?? null;

  const delta = aBest && bBest && aBest.actual_load != null && bBest.actual_load != null
    ? aBest.actual_load - bBest.actual_load : null;

  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Exercise</div>
        <Select value={selected ?? undefined} onValueChange={setSelected}>
          <SelectTrigger><SelectValue placeholder="Pick an exercise" /></SelectTrigger>
          <SelectContent>
            {allNames.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {selected && aResults.length === 0 && bResults.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">No logged sets found for this exercise yet.</Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <ExerciseCard label={a?.block.name ?? "Block A"} best={aBest} recent={recent(aResults)} count={aResults.length} tone="primary" />
          <ExerciseCard label={b?.block.name ?? "Block B"} best={bBest} recent={recent(bResults)} count={bResults.length} />
        </div>
      )}

      {delta != null && (
        <Card className="p-3 text-center text-sm">
          <span className="text-muted-foreground">Best-set delta:</span>{" "}
          <span className={`font-bold ${delta > 0 ? "text-emerald-600" : delta < 0 ? "text-destructive" : ""}`}>
            {delta > 0 ? "+" : ""}{delta}{aBest?.actual_load_unit ? ` ${aBest.actual_load_unit}` : ""}
          </span>
          {aBest && bBest && aBest.actual_reps === bBest.actual_reps && (
            <span className="ml-1 text-xs text-muted-foreground">at same reps</span>
          )}
        </Card>
      )}
    </div>
  );
}
function ExerciseCard({ label, best, recent, count, tone }: { label: string; best: Result | null; recent: Result | null; count: number; tone?: "primary" }) {
  return (
    <Card className={`p-3 ${tone === "primary" ? "border-primary/40" : ""}`}>
      <div className="truncate text-sm font-bold">{label}</div>
      <div className="mt-2 space-y-1 text-xs">
        <div className="flex justify-between gap-2"><span className="text-muted-foreground">Best set</span><span className="font-semibold">{fmtSet(best)}</span></div>
        <div className="flex justify-between gap-2"><span className="text-muted-foreground">Most recent</span><span>{fmtSet(recent)}</span></div>
        <div className="flex justify-between gap-2"><span className="text-muted-foreground">Sets logged</span><span>{count}</span></div>
      </div>
      {recent?.notes && <div className="mt-2 line-clamp-2 rounded bg-secondary/40 p-1.5 text-[11px] text-foreground/80">"{recent.notes}"</div>}
    </Card>
  );
}

/* -------- Completion (by workout-day title) -------- */
function CompletionView({ a, b, loadingA, loadingB }: { a: BlockData | null; b: BlockData | null; loadingA: boolean; loadingB: boolean }) {
  if (loadingA || loadingB) return <Card className="p-4 text-sm text-muted-foreground">Loading…</Card>;

  const byDayTitle = (d: BlockData | null) => {
    const map = new Map<string, { total: number; completed: number }>();
    if (!d) return map;
    const completedSet = new Set(d.completions.filter((c) => c.completed_at).map((c) => c.day_id));
    for (const day of d.days) {
      const title = day.title ?? `Day ${day.day_index}`;
      const entry = map.get(title) ?? { total: 0, completed: 0 };
      entry.total += 1;
      if (completedSet.has(day.id)) entry.completed += 1;
      map.set(title, entry);
    }
    return map;
  };

  const am = byDayTitle(a);
  const bm = byDayTitle(b);
  const titles = [...new Set([...am.keys(), ...bm.keys()])].sort();

  if (titles.length === 0) {
    return <Card className="p-6 text-center text-sm text-muted-foreground">No workout days to compare yet.</Card>;
  }

  return (
    <Card className="p-3">
      <ul className="divide-y divide-border">
        {titles.map((t) => {
          const av = am.get(t);
          const bv = bm.get(t);
          return (
            <li key={t} className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-2 py-2 text-xs">
              <span className="min-w-0 truncate font-semibold">{t}</span>
              <span className="shrink-0 text-muted-foreground">{av ? `${av.completed}/${av.total}` : "—"}</span>
              <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="shrink-0 text-muted-foreground">{bv ? `${bv.completed}/${bv.total}` : "—"}</span>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 text-[10px] text-muted-foreground">Block A → Block B</div>
    </Card>
  );
}
