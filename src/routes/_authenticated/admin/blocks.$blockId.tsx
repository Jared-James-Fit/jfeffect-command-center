import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { ArrowLeft, Plus, Trash2, Copy, Save, Clock, RotateCcw, Eye, EyeOff, GripVertical, MoreHorizontal, Columns2, Rows3, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import {
  getBlockTree, addDay, addRow, updateRow, deleteRow, updateDay,
  estimateDayMinutes, durationRange, TIME_PROFILES, PERCENTAGE_BASES,
  saveBlockAsTemplate, updateBlock, duplicateDay, duplicateWeek, deleteDay, deleteWeek, moveRow,
  BLOCK_STATUSES, addWeek, addRowFromExercise, moveRowToDay, duplicateRow, copyWeek,
  type TimeProfile, type PercentageBasis, type TrainingStyle, type BlockStatus,
} from "@/lib/pl-programs";
import {
  ExerciseLibraryPanel, CellInput, CopyWeekDialog, useDensity, DENSITY_CLASSES,
  useSaveState, SaveStatePill, readDrop, setDragRow, movementAccent, inferPriority,
  type ExerciseRef,
} from "@/components/program-builder";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/blocks/$blockId")({ component: BlockEditor });

type ViewMode = 1 | 2 | 4 | 0; // 0 = all

function BlockEditor() {
  const { blockId } = Route.useParams();
  const qc = useQueryClient();
  const [tplOpen, setTplOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyDefault, setCopyDefault] = useState<string | undefined>(undefined);
  const [view, setView] = useState<ViewMode>(1);
  const [startWeek, setStartWeek] = useState(0);
  const [libCollapsed, setLibCollapsed] = useState(false);
  const [density, setDensity] = useDensity();
  const save = useSaveState();

  const { data: tree, isLoading } = useQuery({
    queryKey: ["pl-block-tree", blockId],
    queryFn: () => getBlockTree(blockId),
  });

  const { data: exercises = [] } = useQuery<ExerciseRef[]>({
    queryKey: ["exercises-min"],
    queryFn: async () =>
      ((await supabase.from("exercises").select("id, name, muscle_group, category, tags, equipment").order("name")).data ?? []) as any,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["pl-block-tree", blockId] });
  const run = (fn: () => Promise<any>) => save.wrap(async () => { await fn(); refresh(); }).catch((e: any) => toast.error(e.message));

  if (isLoading || !tree) return <div className="p-8 text-sm text-muted-foreground">Loading block…</div>;
  const { block, weeks, days, rows } = tree;

  const visibleCount = view === 0 ? weeks.length : Math.min(view, weeks.length);
  const clampedStart = Math.max(0, Math.min(startWeek, Math.max(0, weeks.length - visibleCount)));
  const visibleWeeks = view === 0 ? weeks : weeks.slice(clampedStart, clampedStart + visibleCount);

  const recentIds = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of rows as any[]) {
      if (r.exercise_id && !seen.has(r.exercise_id)) {
        seen.add(r.exercise_id);
        out.push(r.exercise_id);
        if (out.length >= 10) break;
      }
    }
    return out;
  }, [rows]);

  return (
    <>
      <PageHeader title={block.name} subtitle={`${block.weeks} week block · ${block.training_focus ?? "—"}`} />
      <div className="flex flex-col gap-2 p-3 md:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/admin/client-programs/$clientId" params={{ clientId: block.client_id }} className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="mr-1 h-4 w-4" /> Back to client programs
          </Link>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <SaveStatePill state={save.state} />
            <div className="flex items-center gap-1 rounded-md border border-border bg-card p-0.5 text-[11px]">
              <button onClick={() => setDensity("compact")} className={cn("rounded px-2 py-0.5", density === "compact" && "bg-secondary")} title="Compact"><Rows3 className="h-3 w-3" /></button>
              <button onClick={() => setDensity("comfortable")} className={cn("rounded px-2 py-0.5", density === "comfortable" && "bg-secondary")} title="Comfortable"><Columns2 className="h-3 w-3" /></button>
            </div>
            <div className="flex items-center gap-1 rounded-md border border-border bg-card p-0.5 text-[11px]">
              {[1, 2, 4, 0].map((n) => (
                <button key={n} onClick={() => setView(n as ViewMode)} className={cn("rounded px-2 py-0.5", view === n && "bg-secondary")}>
                  {n === 0 ? "All" : `${n}w`}
                </button>
              ))}
            </div>
            <Select value={block.status} onValueChange={(v) => run(() => updateBlock(blockId, { status: v as BlockStatus }))}>
              <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{BLOCK_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
            <Button size="sm" variant="outline" onClick={() => run(() => updateBlock(blockId, { client_visible: !block.client_visible }))}>
              {block.client_visible ? <><Eye className="mr-1 h-4 w-4" /> Visible</> : <><EyeOff className="mr-1 h-4 w-4" /> Hidden</>}
            </Button>
            <Button size="sm" variant="outline" onClick={() => run(() => addWeek(blockId))}><Plus className="mr-1 h-4 w-4" /> Week</Button>
            <Button size="sm" variant="outline" onClick={() => { setCopyDefault(undefined); setCopyOpen(true); }}><Copy className="mr-1 h-4 w-4" /> Copy week…</Button>
            <Button size="sm" variant="outline" onClick={() => setTplOpen(true)}><Save className="mr-1 h-4 w-4" /> Save Block as Template</Button>
          </div>
        </div>

        {view !== 0 && weeks.length > visibleCount && (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Button size="sm" variant="ghost" disabled={clampedStart === 0} onClick={() => setStartWeek(Math.max(0, clampedStart - 1))}>‹ Prev</Button>
            <span>Weeks {visibleWeeks.map((w: any) => w.week_index).join(", ")} of {weeks.length}</span>
            <Button size="sm" variant="ghost" disabled={clampedStart + visibleCount >= weeks.length} onClick={() => setStartWeek(clampedStart + 1)}>Next ›</Button>
          </div>
        )}

        <div className="flex h-[calc(100vh-180px)] overflow-hidden rounded-md border border-border bg-background">
          <ExerciseLibraryPanel
            exercises={exercises as ExerciseRef[]}
            recentIds={recentIds}
            collapsed={libCollapsed}
            onToggleCollapse={() => setLibCollapsed((v) => !v)}
            onPick={(exId) => {
              const firstDay = days[0];
              if (!firstDay) { toast.error("Add a day first"); return; }
              run(() => addRowFromExercise(firstDay.id, exId));
            }}
          />
          <div className="flex-1 overflow-auto">
            <div
              className="grid h-full"
              style={{ gridTemplateColumns: `repeat(${visibleWeeks.length || 1}, minmax(560px, 1fr))` }}
            >
              {visibleWeeks.map((w: any) => (
                <WeekColumn
                  key={w.id}
                  week={w}
                  days={days.filter((d: any) => d.week_id === w.id)}
                  rows={rows}
                  exercises={exercises as ExerciseRef[]}
                  density={density}
                  onAction={run}
                  onCopyWeek={() => { setCopyDefault(w.id); setCopyOpen(true); }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      <SaveAsTemplateDialog open={tplOpen} onOpenChange={setTplOpen} blockId={blockId} defaultName={block.name} />
      <CopyWeekDialog
        open={copyOpen}
        onOpenChange={setCopyOpen}
        weeks={weeks.map((w: any) => ({ id: w.id, week_index: w.week_index }))}
        defaultSrcId={copyDefault}
        onCopy={async ({ srcWeekId, targetWeekId, prescriptions, notes }) => {
          await save.wrap(() => copyWeek(srcWeekId, targetWeekId, { prescriptions, notes }));
          refresh();
          toast.success("Week copied");
        }}
      />
    </>
  );
}

function WeekColumn({
  week, days, rows, exercises, density, onAction, onCopyWeek,
}: {
  week: any;
  days: any[];
  rows: any[];
  exercises: ExerciseRef[];
  density: "compact" | "comfortable";
  onAction: (fn: () => Promise<any>) => void;
  onCopyWeek: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-col border-r border-border last:border-r-0">
      <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-border bg-card/95 px-3 py-2 backdrop-blur">
        <h3 className="text-sm font-bold">Week {week.week_index}</h3>
        <Input
          defaultValue={week.notes ?? ""}
          placeholder="Week notes"
          className="h-6 max-w-[180px] border-0 bg-transparent px-1 text-[11px] focus-visible:ring-1"
          onBlur={(e) => {
            if (e.target.value !== (week.notes ?? "")) {
              onAction(async () => {
                await (supabase as any).from("pl_weeks").update({ notes: e.target.value }).eq("id", week.id);
              });
            }
          }}
        />
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={onCopyWeek} title="Copy to / from">
            <Copy className="mr-1 h-3 w-3" /> Copy
          </Button>
          <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => onAction(() => duplicateWeek(week.id))} title="Duplicate week">
            Dup
          </Button>
          <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px] text-destructive"
            onClick={() => { if (confirm("Delete this week and all its days?")) onAction(() => deleteWeek(week.id)); }}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-2 p-2">
        {days.map((d: any) => (
          <DayBlock
            key={d.id}
            day={d}
            rows={rows.filter((r: any) => r.day_id === d.id)}
            exercises={exercises}
            density={density}
            onAction={onAction}
          />
        ))}
        <Button variant="outline" size="sm" className="h-7"
          onClick={() => onAction(() => addDay(week.id, days.length + 1, `Day ${days.length + 1}`))}>
          <Plus className="mr-1 h-3 w-3" /> Add day
        </Button>
      </div>
    </div>
  );
}

function DayBlock({
  day, rows, exercises, density, onAction,
}: {
  day: any;
  rows: any[];
  exercises: ExerciseRef[];
  density: "compact" | "comfortable";
  onAction: (fn: () => Promise<any>) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const auto = estimateDayMinutes(rows);
  const shownMinutes = day.duration_source === "manual" && day.duration_override_min ? day.duration_override_min : auto;

  const onDrop = (e: React.DragEvent, position?: number) => {
    e.preventDefault();
    setDragOver(false);
    const payload = readDrop(e);
    if (!payload) return;
    if (payload.kind === "exercise") {
      onAction(() => addRowFromExercise(day.id, payload.exerciseId, position));
    } else if (payload.kind === "row") {
      onAction(() => moveRowToDay(payload.rowId, day.id, position));
    }
  };

  return (
    <Card className={cn("p-2 transition-colors", dragOver && "border-primary bg-primary/5")}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => onDrop(e)}
    >
      <div className="flex items-center gap-1.5 pb-1">
        <Input
          defaultValue={day.title ?? ""}
          placeholder={`Day ${day.day_index}`}
          className="h-6 max-w-[180px] border-0 bg-transparent px-1 text-xs font-bold focus-visible:ring-1"
          onBlur={(e) => { if (e.target.value !== (day.title ?? "")) onAction(() => updateDay(day.id, { title: e.target.value })); }}
        />
        <Input
          defaultValue={day.focus ?? ""}
          placeholder="Focus"
          className="h-6 max-w-[160px] border-0 bg-transparent px-1 text-[11px] text-muted-foreground focus-visible:ring-1"
          onBlur={(e) => { if (e.target.value !== (day.focus ?? "")) onAction(() => updateDay(day.id, { focus: e.target.value })); }}
        />
        <div className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          <Badge variant="outline" className="h-5 px-1.5 text-[10px]">{durationRange(shownMinutes)}</Badge>
          {day.duration_source === "manual" && (
            <Button size="icon" variant="ghost" className="h-5 w-5"
              onClick={() => onAction(() => updateDay(day.id, { duration_source: "auto", duration_override_min: null, duration_estimate_min: auto }))}
              title="Clear override"><RotateCcw className="h-3 w-3" /></Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="h-5 w-5"><MoreHorizontal className="h-3 w-3" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onAction(() => duplicateDay(day.id))}><Copy className="mr-2 h-3 w-3" /> Duplicate day</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onAction(() => addRow(day.id, rows.length))}><Plus className="mr-2 h-3 w-3" /> Add empty row</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive"
                onClick={() => { if (confirm("Delete day?")) onAction(() => deleteDay(day.id)); }}>
                <Trash2 className="mr-2 h-3 w-3" /> Delete day
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="overflow-x-auto" data-pb-grid data-pb-cols="8">
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="border-b border-border text-[9px] uppercase tracking-wider text-muted-foreground">
              <th className="w-6"></th>
              <th className="px-1 text-left">Movement</th>
              <th className="w-10 px-1">Sets</th>
              <th className="w-16 px-1">Reps</th>
              <th className="w-12 px-1">RPE</th>
              <th className="w-16 px-1">% / Basis</th>
              <th className="w-16 px-1">Load</th>
              <th className="w-12 px-1">Rest</th>
              <th className="w-14 px-1">Tempo</th>
              <th className="px-1 text-left">Notes</th>
              <th className="w-6"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={11} className="px-2 py-3 text-center text-[11px] text-muted-foreground">
                Drag an exercise from the library, or use ⋯ → Add empty row.
              </td></tr>
            )}
            {rows.map((r: any) => (
              <CompactRow key={r.id} row={r} exercises={exercises} density={density} onAction={onAction} dayId={day.id} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
        <Input
          defaultValue={day.notes ?? ""}
          placeholder="Day notes / cues"
          className="h-6 border-0 bg-transparent px-1 text-[11px] focus-visible:ring-1"
          onBlur={(e) => { if (e.target.value !== (day.notes ?? "")) onAction(() => updateDay(day.id, { notes: e.target.value })); }}
        />
      </div>
    </Card>
  );
}

function CompactRow({
  row, exercises, density, onAction, dayId,
}: {
  row: any;
  exercises: ExerciseRef[];
  density: "compact" | "comfortable";
  onAction: (fn: () => Promise<any>) => void;
  dayId: string;
}) {
  const exName = row.exercises?.name ?? row.exercise_name_override ?? "(unnamed)";
  const accent = movementAccent(exName);
  const priority = inferPriority(row.time_profile, exName);
  const cell = DENSITY_CLASSES[density].cell;

  return (
    <tr
      className="group border-b border-border/40 hover:bg-secondary/30"
      draggable
      onDragStart={(e) => setDragRow(e, row.id, dayId)}
    >
      <td className={cn(cell, "relative")}>
        <div className={cn("absolute left-0 top-0 h-full w-1", accent)} title={priority} />
        <GripVertical className="h-3 w-3 cursor-grab text-muted-foreground/40 group-hover:text-muted-foreground" />
      </td>
      <td className={cell}>
        {row.exercise_id ? (
          <Select value={row.exercise_id} onValueChange={(v) => onAction(() => updateRow(row.id, { exercise_id: v === "__custom" ? null : v }))}>
            <SelectTrigger className={cn("border-0 bg-transparent px-1 focus:ring-1", DENSITY_CLASSES[density].input)}>
              <SelectValue>{exName}</SelectValue>
            </SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value="__custom">— Custom name —</SelectItem>
              {exercises.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : (
          <CellInput density={density} value={row.exercise_name_override}
            placeholder="Custom name"
            onCommit={(v) => onAction(() => updateRow(row.id, { exercise_name_override: v || null }))} />
        )}
      </td>
      <td className={cell}>
        <CellInput density={density} type="number" inputMode="numeric" value={row.sets}
          onCommit={(v) => onAction(() => updateRow(row.id, { sets: parseInt(v) || null }))} />
      </td>
      <td className={cell}>
        <CellInput density={density} value={row.reps_text} placeholder="8-12"
          onCommit={(v) => onAction(() => updateRow(row.id, { reps_text: v || null }))} />
      </td>
      <td className={cell}>
        <CellInput density={density} inputMode="decimal" value={row.rpe} placeholder="8"
          onCommit={(v) => onAction(() => updateRow(row.id, { rpe: v || null }))} />
      </td>
      <td className={cell}>
        <div className="flex gap-0.5">
          <CellInput density={density} className="w-12" inputMode="decimal" value={row.percentage} placeholder="%"
            onCommit={(v) => onAction(() => updateRow(row.id, { percentage: parseFloat(v) || null }))} />
          <Select value={row.percentage_basis ?? "manual"} onValueChange={(v) => onAction(() => updateRow(row.id, { percentage_basis: v as PercentageBasis }))}>
            <SelectTrigger className={cn("border-0 bg-transparent px-1", DENSITY_CLASSES[density].input)}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>{PERCENTAGE_BASES.map((b) => <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </td>
      <td className={cell}>
        <CellInput density={density} inputMode="decimal" value={row.load_kg} placeholder="kg"
          onCommit={(v) => onAction(() => updateRow(row.id, { load_kg: parseFloat(v) || null }))} />
      </td>
      <td className={cell}>
        <CellInput density={density} inputMode="numeric" value={row.rest_seconds} placeholder="s"
          onCommit={(v) => onAction(() => updateRow(row.id, { rest_seconds: parseInt(v) || null }))} />
      </td>
      <td className={cell}>
        <CellInput density={density} value={row.tempo} placeholder="3-1-1"
          onCommit={(v) => onAction(() => updateRow(row.id, { tempo: v || null }))} />
      </td>
      <td className={cell}>
        <CellInput density={density} value={row.notes} placeholder="cue / note"
          onCommit={(v) => onAction(() => updateRow(row.id, { notes: v || null }))} />
      </td>
      <td className={cell}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" className="h-5 w-5 opacity-0 group-hover:opacity-100"><ChevronDown className="h-3 w-3" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onAction(() => moveRow(row.id, "up"))}>Move up</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onAction(() => moveRow(row.id, "down"))}>Move down</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onAction(() => duplicateRow(row.id))}>Duplicate</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive"
              onClick={() => { if (confirm("Delete row?")) onAction(() => deleteRow(row.id)); }}>Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}

function SaveAsTemplateDialog({ open, onOpenChange, blockId, defaultName }: any) {
  const [name, setName] = useState(defaultName ?? "");
  const [style, setStyle] = useState<TrainingStyle>("powerlifting");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Save Block as Template</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Template Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><Label>Training Style</Label>
            <Select value={style} onValueChange={(v) => setStyle(v as TrainingStyle)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="powerlifting">Powerlifting</SelectItem>
                <SelectItem value="bodybuilding">Bodybuilding / Hypertrophy</SelectItem>
                <SelectItem value="strength">Strength</SelectItem>
                <SelectItem value="hybrid">Hybrid</SelectItem>
                <SelectItem value="lifestyle">Lifestyle</SelectItem>
                <SelectItem value="rehab">Rehab / Pivot</SelectItem>
                <SelectItem value="conditioning">Conditioning</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={async () => {
            try {
              await saveBlockAsTemplate(blockId, name, style);
              toast.success("Saved to Program Library");
              onOpenChange(false);
            } catch (e: any) { toast.error(e.message); }
          }}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}