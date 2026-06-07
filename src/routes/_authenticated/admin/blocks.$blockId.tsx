import { createFileRoute, Link } from "@tanstack/react-router";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { ArrowLeft, Plus, Trash2, Copy, Save, Clock, RotateCcw, Eye, EyeOff, GripVertical, MoreHorizontal, Columns2, Rows3, ChevronDown, ChevronRight, TrendingUp, Zap, LayoutGrid, CalendarDays, CalendarRange, User, Unlink, ChevronsDownUp, ChevronsUpDown, Crosshair, Link2 } from "lucide-react";
import { toast } from "sonner";
import {
  getBlockTree, addDay, addRow, updateRow, deleteRow, updateDay,
  estimateDayMinutes, durationRange, TIME_PROFILES, PERCENTAGE_BASES,
  saveBlockAsTemplate, updateBlock, duplicateDay, duplicateWeek, deleteDay, deleteWeek, moveRow,
  BLOCK_STATUSES, addWeek, addRowFromExercise, moveRowToDay, duplicateRow, copyWeek,
  copyWeekToAll, expandLinkedDays, countCustomDownstream, applyRowPatchAcrossDays,
  applyDayPatchAcrossDays, breakDayLink, relinkDay, applyProgression,
  copyDayToFutureWeeks, clearFutureWeeks, breakAllLinks,
  type TimeProfile, type PercentageBasis, type TrainingStyle, type BlockStatus,
  type EditScope, type ProgressionRuleType,
} from "@/lib/pl-programs";
import {
  ExerciseLibraryPanel, CellInput, CopyWeekDialog, useDensity, DENSITY_CLASSES,
  useSaveState, SaveStatePill, readDrop, setDragRow, movementAccent, inferPriority,
  EditScopeDialog, LinkBadge, type EditScopeChoice, type ExerciseRef,
} from "@/components/program-builder";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/blocks/$blockId")({ component: BlockEditor });

type BuilderView = "block" | "week" | "day" | "preview";
const VIEW_KEY = "pl.builder.view";
const VIEW_WEEK_KEY = "pl.builder.weekIdx";
const VIEW_DAY_KEY = "pl.builder.dayId";

/** Fields that should trigger an edit-scope prompt on linked days. */
const CASCADE_ROW_KEYS = new Set([
  "sets", "reps_text", "rpe", "rir", "percentage", "percentage_basis",
  "load_kg", "load_lb", "rest_seconds", "tempo", "time_profile",
]);
const CASCADE_DAY_KEYS = new Set(["title", "focus"]);

function BlockEditor() {
  const { blockId } = Route.useParams();
  const qc = useQueryClient();
  const [tplOpen, setTplOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyDefault, setCopyDefault] = useState<string | undefined>(undefined);
  const [view, setView] = useState<BuilderView>(() => {
    if (typeof window === "undefined") return "block";
    return ((localStorage.getItem(VIEW_KEY) as BuilderView) || "block");
  });
  const [focusedWeekIdx, setFocusedWeekIdx] = useState<number>(() => {
    if (typeof window === "undefined") return 1;
    return Number(localStorage.getItem(VIEW_WEEK_KEY) || 1);
  });
  const [focusedDayId, setFocusedDayId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(VIEW_DAY_KEY);
  });
  useEffect(() => { try { localStorage.setItem(VIEW_KEY, view); } catch {} }, [view]);
  useEffect(() => { try { localStorage.setItem(VIEW_WEEK_KEY, String(focusedWeekIdx)); } catch {} }, [focusedWeekIdx]);
  useEffect(() => { try {
    if (focusedDayId) localStorage.setItem(VIEW_DAY_KEY, focusedDayId);
    else localStorage.removeItem(VIEW_DAY_KEY);
  } catch {} }, [focusedDayId]);
  const [libCollapsed, setLibCollapsed] = useState(false);
  const [density, setDensity] = useDensity();
  const [selectedDayId, setSelectedDayId] = useState<string | null>(null);
  const [progressionOpen, setProgressionOpen] = useState(false);
  const [collapsedWeekIds, setCollapsedWeekIds] = useState<Set<string>>(new Set());
  const save = useSaveState();

  // --- Edit scope dialog state ---
  const scopeResolver = useRef<((c: EditScopeChoice) => void) | null>(null);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [scopeCustomCount, setScopeCustomCount] = useState(0);
  const [scopeDescription, setScopeDescription] = useState<string | undefined>();
  const askScope = (description: string, customCount: number) =>
    new Promise<EditScopeChoice>((resolve) => {
      scopeResolver.current = resolve;
      setScopeDescription(description);
      setScopeCustomCount(customCount);
      setScopeOpen(true);
    });
  const onScopeChoose = (c: EditScopeChoice) => {
    setScopeOpen(false);
    scopeResolver.current?.(c);
    scopeResolver.current = null;
  };

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

  // Current week (1-based) based on block.start_date if available.
  const currentWeekIndex: number | null = (() => {
    const sd: string | null = (block as any).start_date ?? null;
    if (!sd) return null;
    const start = new Date(sd + "T00:00:00");
    if (isNaN(start.getTime())) return null;
    const now = new Date();
    const ms = now.getTime() - start.getTime();
    const offset = (block as any).week_start_index ?? 0;
    const idx = Math.floor(ms / (7 * 86400000)) + 1 - (offset || 0);
    if (idx < 1 || idx > (weeks as any[]).length) return null;
    return idx;
  })();

  // Per-week stats: day count, row count, estimated total minutes, linked/custom counts.
  const weekStats = useMemo(() => {
    const map = new Map<string, { days: number; rows: number; minutes: number; linked: number; custom: number }>();
    for (const w of weeks as any[]) {
      const wDays = (days as any[]).filter((d: any) => d.week_id === w.id);
      let rowCount = 0;
      let minutes = 0;
      let linked = 0;
      let custom = 0;
      for (const d of wDays) {
        const dayRows = (rows as any[]).filter((r: any) => r.day_id === d.id);
        rowCount += dayRows.length;
        const auto = estimateDayMinutes(dayRows);
        const shown = d.duration_source === "manual" && d.duration_override_min ? d.duration_override_min : auto;
        minutes += shown || 0;
        if (d.is_custom) custom++;
        else if (d.source_day_id) linked++;
      }
      map.set(w.id, { days: wDays.length, rows: rowCount, minutes, linked, custom });
    }
    return map;
  }, [weeks, days, rows]);

  const toggleWeekCollapse = (wid: string) =>
    setCollapsedWeekIds((prev) => {
      const next = new Set(prev);
      if (next.has(wid)) next.delete(wid); else next.add(wid);
      return next;
    });
  const collapseAllWeeks = () => setCollapsedWeekIds(new Set((weeks as any[]).map((w: any) => w.id)));
  const expandAllWeeks = () => setCollapsedWeekIds(new Set());
  const jumpToWeek = (wid: string) => {
    setCollapsedWeekIds((prev) => { const n = new Set(prev); n.delete(wid); return n; });
    requestAnimationFrame(() => {
      const el = document.getElementById(`pl-week-${wid}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  // Which weeks to render based on the chosen view.
  const focusedWeek =
    (weeks as any[]).find((w: any) => w.week_index === focusedWeekIdx) ?? (weeks as any[])[0];
  const focusedDay =
    (days as any[]).find((d: any) => d.id === focusedDayId) ??
    (days as any[]).find((d: any) => d.week_id === focusedWeek?.id) ??
    (days as any[])[0];
  const visibleWeeks: any[] =
    view === "block" || view === "preview"
      ? (weeks as any[])
      : view === "week"
        ? (focusedWeek ? [focusedWeek] : [])
        : (focusedDay ? [(weeks as any[]).find((w: any) => w.id === focusedDay.week_id)] : []);

  // Day index helpers for link badges and cascade-relevance.
  const weekById = useMemo(() => new Map((weeks as any[]).map((w: any) => [w.id, w])), [weeks]);
  const dayById = useMemo(() => new Map((days as any[]).map((d: any) => [d.id, d])), [days]);
  const siblingCount = useMemo(() => {
    // For each day, how many other days share the same day_index in this block
    const byIdx = new Map<number, number>();
    for (const d of days as any[]) byIdx.set(d.day_index, (byIdx.get(d.day_index) ?? 0) + 1);
    return byIdx;
  }, [days]);

  const selectedDay = selectedDayId ? (dayById.get(selectedDayId) as any) : null;
  const selectedDayLabel = selectedDay
    ? `W${(weekById.get(selectedDay.week_id) as any)?.week_index ?? "?"} ${selectedDay.title || `D${selectedDay.day_index}`}`
    : null;

  const dayLinkInfo = (dayId: string): { sourceLabel: string | null; isCustom: boolean; hasSiblings: boolean } => {
    const d = dayById.get(dayId) as any;
    if (!d) return { sourceLabel: null, isCustom: false, hasSiblings: false };
    const hasSiblings = (siblingCount.get(d.day_index) ?? 0) > 1;
    const isCustom = !!d.is_custom;
    let sourceLabel: string | null = null;
    if (d.source_day_id) {
      const sd = dayById.get(d.source_day_id) as any;
      if (sd) {
        const sw = weekById.get(sd.week_id) as any;
        sourceLabel = `W${sw?.week_index ?? "?"} D${sd.day_index}`;
      }
    }
    return { sourceLabel, isCustom, hasSiblings };
  };

  // Scope-aware row patch
  const onRowPatch = async (rowId: string, dayId: string, patch: Record<string, any>) => {
    const keys = Object.keys(patch);
    const cascadable = keys.some((k) => CASCADE_ROW_KEYS.has(k));
    const { hasSiblings, isCustom } = dayLinkInfo(dayId);
    if (!cascadable || !hasSiblings || isCustom) {
      run(() => updateRow(rowId, patch));
      return;
    }
    const customCount = await countCustomDownstream(dayId);
    const choice = await askScope("This day is linked to other weeks. Apply this change to:", customCount);
    if (choice === "cancel") { refresh(); return; }
    save.wrap(async () => {
      if (choice === "this") {
        await updateRow(rowId, patch);
      } else {
        const dayIds = await expandLinkedDays(dayId, choice as EditScope);
        await applyRowPatchAcrossDays(rowId, dayIds, patch);
      }
      refresh();
    }).catch((e: any) => toast.error(e.message));
  };

  const onDayPatch = async (dayId: string, patch: Record<string, any>) => {
    const keys = Object.keys(patch);
    const cascadable = keys.some((k) => CASCADE_DAY_KEYS.has(k));
    const { hasSiblings, isCustom } = dayLinkInfo(dayId);
    if (!cascadable || !hasSiblings || isCustom) {
      run(() => updateDay(dayId, patch));
      return;
    }
    const customCount = await countCustomDownstream(dayId);
    const choice = await askScope("Apply this day-level change to:", customCount);
    if (choice === "cancel") { refresh(); return; }
    save.wrap(async () => {
      if (choice === "this") {
        await updateDay(dayId, patch);
      } else {
        const dayIds = await expandLinkedDays(dayId, choice as EditScope);
        await applyDayPatchAcrossDays(dayIds, patch);
      }
      refresh();
    }).catch((e: any) => toast.error(e.message));
  };

  const quickAddToSelected = (exId: string) => {
    if (!selectedDayId) { toast.error("Select a day first (click a day card)"); return; }
    run(() => addRowFromExercise(selectedDayId, exId));
  };

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
            <div className="flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5 text-[11px]">
              <ViewToggleBtn active={view === "block"} onClick={() => setView("block")} icon={<LayoutGrid className="h-3 w-3" />} label="Full Block" />
              <ViewToggleBtn active={view === "week"} onClick={() => setView("week")} icon={<CalendarRange className="h-3 w-3" />} label="Weekly" />
              <ViewToggleBtn active={view === "day"} onClick={() => setView("day")} icon={<CalendarDays className="h-3 w-3" />} label="Day" />
              <ViewToggleBtn active={view === "preview"} onClick={() => setView("preview")} icon={<User className="h-3 w-3" />} label="Client" />
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
            {weeks.length > 1 && (
              <Button size="sm" variant="outline" onClick={async () => {
                if (!confirm(`Copy Week 1 into all ${weeks.length - 1} other weeks? This replaces those weeks.`)) return;
                const wk1 = (weeks as any[])[0];
                await save.wrap(() => copyWeekToAll(wk1.id, { prescriptions: true, notes: true }));
                refresh();
                toast.success("Week 1 copied to all weeks");
              }}>
                <Zap className="mr-1 h-4 w-4" /> W1 → All
              </Button>
            )}
            {weeks.length > 1 && (
              <Button size="sm" variant="outline" onClick={() => setProgressionOpen(true)}>
                <TrendingUp className="mr-1 h-4 w-4" /> Progression…
              </Button>
            )}
            {weeks.length > 1 && (
              <Button size="sm" variant="outline" onClick={async () => {
                if (!confirm("Break all linked days so future cascades stop touching them?")) return;
                await save.wrap(() => breakAllLinks(blockId));
                refresh();
                toast.success("All days marked custom");
              }}>
                <Unlink className="mr-1 h-4 w-4" /> Break links
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setTplOpen(true)}><Save className="mr-1 h-4 w-4" /> Save Block as Template</Button>
          </div>
        </div>

        {view === "week" && weeks.length > 1 && (
          <div className="flex flex-wrap items-center gap-1">
            {(weeks as any[]).map((w: any) => (
              <button
                key={w.id}
                onClick={() => setFocusedWeekIdx(w.week_index)}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-[11px]",
                  focusedWeek?.id === w.id ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                Week {w.week_index}
              </button>
            ))}
          </div>
        )}
        {view === "day" && (
          <div className="flex flex-wrap items-center gap-1">
            {(weeks as any[]).map((w: any) =>
              (days as any[]).filter((d: any) => d.week_id === w.id).map((d: any) => (
                <button
                  key={d.id}
                  onClick={() => { setFocusedDayId(d.id); setFocusedWeekIdx(w.week_index); }}
                  className={cn(
                    "rounded-md border px-2 py-1 text-[10px]",
                    focusedDay?.id === d.id ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:text-foreground",
                  )}
                >
                  W{w.week_index} · {d.title || `D${d.day_index}`}
                </button>
              ))
            )}
          </div>
        )}

        <div className="flex h-[calc(100vh-180px)] overflow-hidden rounded-md border border-border bg-background">
          {view !== "preview" && (
            <ExerciseLibraryPanel
              exercises={exercises as ExerciseRef[]}
              recentIds={recentIds}
              collapsed={libCollapsed}
              onToggleCollapse={() => setLibCollapsed((v) => !v)}
              selectedDayLabel={selectedDayLabel}
              onQuickAdd={quickAddToSelected}
              onPick={(exId) => {
                const target = selectedDayId ? (dayById.get(selectedDayId) as any) : (days as any[])[0];
                if (!target) { toast.error("Add a day first"); return; }
                run(() => addRowFromExercise(target.id, exId));
              }}
            />
          )}
          <div className="flex-1 overflow-auto">
            {view === "preview" ? (
              <ClientPreview weeks={weeks} days={days} rows={rows} />
            ) : view === "day" && focusedDay ? (
              <div className="p-3">
                <DayBlock
                  key={focusedDay.id}
                  day={focusedDay}
                  rows={(rows as any[]).filter((r: any) => r.day_id === focusedDay.id)}
                  exercises={exercises as ExerciseRef[]}
                  density={density}
                  onAction={run}
                  selected={selectedDayId === focusedDay.id}
                  onSelect={() => setSelectedDayId(focusedDay.id)}
                  link={dayLinkInfo(focusedDay.id)}
                  onRowPatch={onRowPatch}
                  onDayPatch={onDayPatch}
                  weekIndex={(weekById.get(focusedDay.week_id) as any)?.week_index ?? 0}
                  onCopyDayToFuture={async () => {
                    const r = await save.wrap(() => copyDayToFutureWeeks(focusedDay.id));
                    refresh();
                    toast.success(`Copied to ${r?.copied ?? 0} future week(s)`);
                  }}
                />
              </div>
            ) : view === "block" ? (
              <div className="flex flex-col">
                {(weeks as any[]).map((w: any) => (
                  <WeekColumn
                    key={w.id}
                    week={w}
                    days={(days as any[]).filter((d: any) => d.week_id === w.id)}
                    rows={rows}
                    exercises={exercises as ExerciseRef[]}
                    density={density}
                    onAction={run}
                    selectedDayId={selectedDayId}
                    onSelectDay={setSelectedDayId}
                    dayLinkInfo={dayLinkInfo}
                    onRowPatch={onRowPatch}
                    onDayPatch={onDayPatch}
                    onCopyWeek={() => { setCopyDefault(w.id); setCopyOpen(true); }}
                    onCopyDayToFuture={async (dayId: string) => {
                      const r = await save.wrap(() => copyDayToFutureWeeks(dayId));
                      refresh();
                      toast.success(`Copied to ${r?.copied ?? 0} future week(s)`);
                    }}
                  />
                ))}
              </div>
            ) : (
              <div className="grid h-full" style={{ gridTemplateColumns: `repeat(${visibleWeeks.length || 1}, minmax(560px, 1fr))` }}>
                {visibleWeeks.map((w: any) => (
                  <WeekColumn
                    key={w.id}
                    week={w}
                    days={(days as any[]).filter((d: any) => d.week_id === w.id)}
                    rows={rows}
                    exercises={exercises as ExerciseRef[]}
                    density={density}
                    onAction={run}
                    selectedDayId={selectedDayId}
                    onSelectDay={setSelectedDayId}
                    dayLinkInfo={dayLinkInfo}
                    onRowPatch={onRowPatch}
                    onDayPatch={onDayPatch}
                    onCopyWeek={() => { setCopyDefault(w.id); setCopyOpen(true); }}
                    onCopyDayToFuture={async (dayId: string) => {
                      const r = await save.wrap(() => copyDayToFutureWeeks(dayId));
                      refresh();
                      toast.success(`Copied to ${r?.copied ?? 0} future week(s)`);
                    }}
                  />
                ))}
              </div>
            )}
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
      <EditScopeDialog
        open={scopeOpen}
        onOpenChange={setScopeOpen}
        onChoose={onScopeChoose}
        customDownstream={scopeCustomCount}
        description={scopeDescription}
      />
      <ProgressionDialog
        open={progressionOpen}
        onOpenChange={setProgressionOpen}
        onApply={async (rule) => {
          const res = await save.wrap(() => applyProgression(blockId, rule));
          refresh();
          toast.success(`Updated ${res?.updated ?? 0} rows${res?.skippedCustom ? ` · skipped ${res.skippedCustom} custom days` : ""}`);
        }}
      />
    </>
  );
}

function WeekColumn({
  week, days, rows, exercises, density, onAction, onCopyWeek,
  selectedDayId, onSelectDay, dayLinkInfo, onRowPatch, onDayPatch, onCopyDayToFuture,
}: {
  week: any;
  days: any[];
  rows: any[];
  exercises: ExerciseRef[];
  density: "compact" | "comfortable";
  onAction: (fn: () => Promise<any>) => void;
  onCopyWeek: () => void;
  selectedDayId: string | null;
  onSelectDay: (id: string | null) => void;
  dayLinkInfo: (id: string) => { sourceLabel: string | null; isCustom: boolean; hasSiblings: boolean };
  onRowPatch: (rowId: string, dayId: string, patch: Record<string, any>) => void | Promise<void>;
  onDayPatch: (dayId: string, patch: Record<string, any>) => void | Promise<void>;
  onCopyDayToFuture?: (dayId: string) => void | Promise<void>;
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
            selected={selectedDayId === d.id}
            onSelect={() => onSelectDay(d.id)}
            link={dayLinkInfo(d.id)}
            onRowPatch={onRowPatch}
            onDayPatch={onDayPatch}
            weekIndex={week.week_index}
            onCopyDayToFuture={onCopyDayToFuture ? () => onCopyDayToFuture(d.id) : undefined}
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
  day, rows, exercises, density, onAction, selected, onSelect, link, onRowPatch, onDayPatch,
  weekIndex, onCopyDayToFuture,
}: {
  day: any;
  rows: any[];
  exercises: ExerciseRef[];
  density: "compact" | "comfortable";
  onAction: (fn: () => Promise<any>) => void;
  selected: boolean;
  onSelect: () => void;
  link: { sourceLabel: string | null; isCustom: boolean; hasSiblings: boolean };
  onRowPatch: (rowId: string, dayId: string, patch: Record<string, any>) => void | Promise<void>;
  onDayPatch: (dayId: string, patch: Record<string, any>) => void | Promise<void>;
  weekIndex?: number;
  onCopyDayToFuture?: () => void | Promise<void>;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const rowsRef = useRef<HTMLTableSectionElement | null>(null);
  const auto = estimateDayMinutes(rows);
  const shownMinutes = day.duration_source === "manual" && day.duration_override_min ? day.duration_override_min : auto;

  const onDrop = (e: React.DragEvent, position?: number) => {
    e.preventDefault();
    setDragOver(false);
    const pos = position ?? dropIndex ?? undefined;
    setDropIndex(null);
    const payload = readDrop(e);
    if (!payload) return;
    if (payload.kind === "exercise") {
      onAction(() => addRowFromExercise(day.id, payload.exerciseId, pos));
    } else if (payload.kind === "row") {
      onAction(() => moveRowToDay(payload.rowId, day.id, pos));
    }
  };

  const computeDropIndex = (clientY: number): number => {
    const tbody = rowsRef.current;
    if (!tbody) return rows.length;
    const trs = Array.from(tbody.querySelectorAll<HTMLTableRowElement>("tr[data-row-idx]"));
    for (let i = 0; i < trs.length; i++) {
      const r = trs[i].getBoundingClientRect();
      if (clientY < r.top + r.height / 2) return i;
    }
    return trs.length;
  };

  return (
    <Card
      className={cn(
        "p-2 transition-colors cursor-pointer",
        dragOver && "border-primary bg-primary/5",
        selected && "ring-2 ring-primary/60",
      )}
      onClick={onSelect}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
        setDropIndex(computeDropIndex(e.clientY));
      }}
      onDragLeave={(e) => {
        // Only reset if cursor truly leaves the card
        if (!(e.currentTarget as Node).contains(e.relatedTarget as Node)) {
          setDragOver(false);
          setDropIndex(null);
        }
      }}
      onDrop={(e) => onDrop(e)}
    >
      <div className="flex flex-wrap items-center gap-1.5 pb-1" onClick={(e) => e.stopPropagation()}>
        <Input
          defaultValue={day.title ?? ""}
          placeholder={`Day ${day.day_index}`}
          className="h-6 max-w-[180px] border-0 bg-transparent px-1 text-xs font-bold focus-visible:ring-1"
          onBlur={(e) => { if (e.target.value !== (day.title ?? "")) onDayPatch(day.id, { title: e.target.value }); }}
        />
        <Input
          defaultValue={day.focus ?? ""}
          placeholder="Focus"
          className="h-6 max-w-[160px] border-0 bg-transparent px-1 text-[11px] text-muted-foreground focus-visible:ring-1"
          onBlur={(e) => { if (e.target.value !== (day.focus ?? "")) onDayPatch(day.id, { focus: e.target.value }); }}
        />
        <LinkBadge
          isCustom={link.isCustom}
          sourceLabel={link.sourceLabel}
          onBreak={link.sourceLabel && !link.isCustom ? () => onAction(() => breakDayLink(day.id)) : undefined}
          onRelink={link.isCustom ? () => onAction(() => relinkDay(day.id)) : undefined}
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
              {onCopyDayToFuture && (
                <DropdownMenuItem onClick={() => onCopyDayToFuture()}>
                  <Zap className="mr-2 h-3 w-3" /> Copy day → future weeks
                </DropdownMenuItem>
              )}
              {link.sourceLabel && !link.isCustom && (
                <DropdownMenuItem onClick={() => onAction(() => breakDayLink(day.id))}>Break link to {link.sourceLabel}</DropdownMenuItem>
              )}
              {link.isCustom && (
                <DropdownMenuItem onClick={() => onAction(() => relinkDay(day.id))}>Re-link to previous week</DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive"
                onClick={() => { if (confirm("Delete day?")) onAction(() => deleteDay(day.id)); }}>
                <Trash2 className="mr-2 h-3 w-3" /> Delete day
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="overflow-x-auto" data-pb-grid data-pb-cols="8" onClick={(e) => e.stopPropagation()}>
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="border-b border-border text-[9px] uppercase tracking-wider text-muted-foreground">
              <th className="w-10"></th>
              <th className="px-1 text-left">Movement</th>
              <th className="w-10 px-1">Sets</th>
              <th className="w-16 px-1">Reps</th>
              <th className="w-12 px-1">RPE</th>
              <th className="w-16 px-1">% / Basis</th>
              <th className="w-16 px-1">Load</th>
              <th className="w-12 px-1">Rest</th>
              <th className="w-6"></th>
            </tr>
          </thead>
          <tbody ref={rowsRef}>
            {rows.length === 0 && (
              <tr><td colSpan={9} className="px-2 py-4 text-center text-[11px] text-muted-foreground">
                <div className={cn("mb-2", dragOver && "text-primary")}>Drag exercises here, or:</div>
                <div className="flex flex-wrap justify-center gap-1">
                  <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => onAction(() => addRow(day.id, 0))}>+ Empty row</Button>
                </div>
              </td></tr>
            )}
            {rows.map((r: any, idx: number) => (
              <Fragment key={r.id}>
                {dragOver && dropIndex === idx && <InsertionRow />}
                <CompactRow row={r} exercises={exercises} density={density} onAction={onAction} onRowPatch={onRowPatch} dayId={day.id} rowIdx={idx} />
              </Fragment>
            ))}
            {dragOver && dropIndex === rows.length && rows.length > 0 && <InsertionRow />}
          </tbody>
        </table>
      </div>

      <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground" onClick={(e) => e.stopPropagation()}>
        <Input
          defaultValue={day.notes ?? ""}
          placeholder={day.notes ? "" : "+ Note"}
          className="h-6 border-0 bg-transparent px-1 text-[11px] focus-visible:ring-1"
          onBlur={(e) => { if (e.target.value !== (day.notes ?? "")) onAction(() => updateDay(day.id, { notes: e.target.value })); }}
        />
      </div>
    </Card>
  );
}

function CompactRow({
  row, exercises, density, onAction, onRowPatch, dayId, rowIdx,
}: {
  row: any;
  exercises: ExerciseRef[];
  density: "compact" | "comfortable";
  onAction: (fn: () => Promise<any>) => void;
  onRowPatch: (rowId: string, dayId: string, patch: Record<string, any>) => void | Promise<void>;
  dayId: string;
  rowIdx?: number;
}) {
  const exName = row.exercises?.name ?? row.exercise_name_override ?? "(unnamed)";
  const accent = movementAccent(exName);
  const priority = inferPriority(row.time_profile, exName);
  const cell = DENSITY_CLASSES[density].cell;
  const [expanded, setExpanded] = useState(false);
  const patch = (p: Record<string, any>) => onRowPatch(row.id, dayId, p);

  return (
    <>
    <tr
      className="group border-b border-border/40 hover:bg-secondary/30"
      data-row-idx={rowIdx}
      draggable
      onDragStart={(e) => setDragRow(e, row.id, dayId)}
    >
      <td className={cn(cell, "relative")}>
        <div className={cn("absolute left-0 top-0 h-full w-1", accent)} title={priority} />
        <div className="flex items-center gap-0.5 pl-1">
          <button onClick={() => setExpanded((v) => !v)} className="text-muted-foreground/70 hover:text-foreground" title={expanded ? "Collapse" : "Expand"}>
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
          <GripVertical className="h-3 w-3 cursor-grab text-muted-foreground/40 group-hover:text-muted-foreground" />
        </div>
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
          onCommit={(v) => patch({ sets: parseInt(v) || null })} />
      </td>
      <td className={cell}>
        <CellInput density={density} value={row.reps_text} placeholder="8-12"
          onCommit={(v) => patch({ reps_text: v || null })} />
      </td>
      <td className={cell}>
        <CellInput density={density} inputMode="decimal" value={row.rpe} placeholder="8"
          onCommit={(v) => patch({ rpe: v || null })} />
      </td>
      <td className={cell}>
        <div className="flex gap-0.5">
          <CellInput density={density} className="w-12" inputMode="decimal" value={row.percentage} placeholder="%"
            onCommit={(v) => patch({ percentage: parseFloat(v) || null })} />
          <Select value={row.percentage_basis ?? "manual"} onValueChange={(v) => patch({ percentage_basis: v as PercentageBasis })}>
            <SelectTrigger className={cn("border-0 bg-transparent px-1", DENSITY_CLASSES[density].input)}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>{PERCENTAGE_BASES.map((b) => <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </td>
      <td className={cell}>
        <CellInput density={density} inputMode="decimal" value={row.load_kg} placeholder="kg"
          onCommit={(v) => patch({ load_kg: parseFloat(v) || null })} />
      </td>
      <td className={cell}>
        <CellInput density={density} inputMode="numeric" value={row.rest_seconds} placeholder="s"
          onCommit={(v) => patch({ rest_seconds: parseInt(v) || null })} />
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
    {expanded && (
      <tr className="border-b border-border/40 bg-secondary/10">
        <td colSpan={9} className="px-2 py-1.5">
          <div className="grid grid-cols-1 gap-1.5 md:grid-cols-3">
            <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <span className="w-12 uppercase">Tempo</span>
              <CellInput density={density} value={row.tempo} placeholder="3-1-1"
                onCommit={(v) => patch({ tempo: v || null })} />
            </label>
            <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <span className="w-12 uppercase">Profile</span>
              <Select value={row.time_profile ?? "accessory_compound"} onValueChange={(v) => patch({ time_profile: v as TimeProfile })}>
                <SelectTrigger className={cn("border-0 bg-transparent px-1 focus:ring-1", DENSITY_CLASSES[density].input)}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIME_PROFILES.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
            <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <span className="w-12 uppercase">RIR</span>
              <CellInput density={density} value={row.rir} placeholder="2"
                onCommit={(v) => patch({ rir: v || null })} />
            </label>
            <label className="col-span-1 flex items-start gap-1 text-[10px] text-muted-foreground md:col-span-3">
              <span className="mt-1 w-12 uppercase">Notes</span>
              <CellInput density={density} value={row.notes} placeholder="cue / note / form reminder"
                onCommit={(v) => onAction(() => updateRow(row.id, { notes: v || null }))} />
            </label>
          </div>
        </td>
      </tr>
    )}
    </>
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

function ProgressionDialog({
  open, onOpenChange, onApply,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onApply: (rule: { type: ProgressionRuleType; amount?: number; exerciseFilter?: string }) => Promise<void>;
}) {
  const [type, setType] = useState<ProgressionRuleType>("add_kg");
  const [amount, setAmount] = useState<string>("2.5");
  const [filter, setFilter] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const needsAmount = type === "add_kg" || type === "add_lb" || type === "add_pct";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Apply progression across weeks</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">
            Walks weeks in order. For each week ≥ 2, derives prescriptions from the previous week's matching row. Custom days are skipped.
          </p>
          <div>
            <Label>Rule</Label>
            <Select value={type} onValueChange={(v) => setType(v as ProgressionRuleType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="add_kg">Add load (kg) each week</SelectItem>
                <SelectItem value="add_lb">Add load (lb) each week</SelectItem>
                <SelectItem value="add_pct">Add intensity (%) each week</SelectItem>
                <SelectItem value="repeat">Repeat (same load every week)</SelectItem>
                <SelectItem value="deload">Deload (−10% from previous week)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {needsAmount && (
            <div>
              <Label>Amount</Label>
              <Input type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
          )}
          <div>
            <Label>Exercise filter (optional)</Label>
            <Input placeholder="e.g. squat, bench" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <p className="mt-1 text-[11px] text-muted-foreground">Leave empty to apply to every row.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button disabled={busy} onClick={async () => {
            setBusy(true);
            try {
              await onApply({
                type,
                amount: needsAmount ? (parseFloat(amount) || 0) : undefined,
                exerciseFilter: filter.trim() || undefined,
              });
              onOpenChange(false);
            } finally { setBusy(false); }
          }}>{busy ? "Applying…" : "Apply"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
// ---------------- View toggle button ----------------
function ViewToggleBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={cn(
        "inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px]",
        active ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      <span className="hidden md:inline">{label}</span>
    </button>
  );
}

// ---------------- Insertion-line row ----------------
function InsertionRow() {
  return (
    <tr aria-hidden className="pointer-events-none">
      <td colSpan={9} className="p-0">
        <div className="h-0.5 w-full bg-primary" />
      </td>
    </tr>
  );
}

// ---------------- Read-only client preview ----------------
function ClientPreview({ weeks, days, rows }: { weeks: any[]; days: any[]; rows: any[] }) {
  return (
    <div className="space-y-4 p-4">
      <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary">
        Client preview — read-only view of what the client will see.
      </div>
      {(weeks as any[]).map((w: any) => (
        <div key={w.id} className="space-y-2">
          <h3 className="text-sm font-bold">Week {w.week_index}</h3>
          <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
            {(days as any[]).filter((d: any) => d.week_id === w.id).map((d: any) => {
              const dayRows = (rows as any[]).filter((r: any) => r.day_id === d.id);
              return (
                <Card key={d.id} className="p-3">
                  <div className="mb-1 flex items-center justify-between">
                    <div className="text-sm font-semibold">{d.title || `Day ${d.day_index}`}</div>
                    {d.focus && <div className="text-[10px] text-muted-foreground">{d.focus}</div>}
                  </div>
                  {dayRows.length === 0 ? (
                    <div className="text-[11px] text-muted-foreground">No exercises.</div>
                  ) : (
                    <ul className="space-y-1 text-[11px]">
                      {dayRows.map((r: any) => {
                        const name = r.exercises?.name ?? r.exercise_name_override ?? "(unnamed)";
                        const prescription = [
                          r.sets ? `${r.sets}×${r.reps_text ?? "?"}` : null,
                          r.rpe ? `@${r.rpe} RPE` : null,
                          r.percentage ? `${r.percentage}%` : null,
                          r.load_kg ? `${r.load_kg}kg` : null,
                          r.rest_seconds ? `${r.rest_seconds}s rest` : null,
                        ].filter(Boolean).join(" · ");
                        return (
                          <li key={r.id}>
                            <span className="font-medium">{name}</span>
                            {prescription && <span className="text-muted-foreground"> — {prescription}</span>}
                            {r.notes && <div className="pl-2 text-[10px] text-muted-foreground">{r.notes}</div>}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {d.notes && <div className="mt-2 rounded-sm bg-muted/40 px-2 py-1 text-[10px]">{d.notes}</div>}
                </Card>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
