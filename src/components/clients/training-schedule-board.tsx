/**
 * CLIENT TRAINING PROGRAM — schedule-first board.
 *
 * Replaces the old "pile of cards" (Current Blocks / Previous Blocks /
 * Recent Assignments) with a real program scheduler:
 *   Schedule  — current block, up next, block timeline, gaps/overlaps
 *   Calendar  — month/week grid of real scheduled workouts + block spans
 *   History   — finished blocks, collapsed away from the working view
 *
 * Every status shown here comes from the canonical model in
 * `@/lib/block-schedule-model`, so a finished block can never render "Active".
 */
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format, parseISO } from "date-fns";
import {
  CalendarDays, CalendarRange, History, Layers, Plus, ChevronRight, ChevronLeft,
  AlertTriangle, MoreVertical, Pencil, FlagOff, ArrowRightLeft, Loader2, Dot,
} from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { AssignProgramDialog } from "@/components/clients/assign-program-dialog";
import {
  useClientTrainingSchedule, clientTrainingScheduleKey, type CalendarWorkout,
} from "@/lib/use-client-training-schedule";
import {
  currentBlock as pickCurrent, upcomingBlocks, draftBlocks, historyBlocks,
  findOverlaps, gapDays, suggestedNextStart, todayISO, addDaysISO,
  formatRange, durationLabel, STATUS_LABEL, type ScheduleBlock,
} from "@/lib/block-schedule-model";
import {
  previewEndBlockEarlyFn, endBlockEarlyFn, setBlockScheduleFn,
} from "@/lib/block-lifecycle.functions";

type View = "schedule" | "calendar" | "history";

function statusTone(s: string) {
  switch (s) {
    case "Active": return "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
    case "Upcoming": return "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400";
    case "Completed": return "border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400";
    case "EndedEarly": return "border-violet-500/40 bg-violet-500/10 text-violet-600 dark:text-violet-400";
    default: return "border-muted-foreground/30 bg-muted/30 text-muted-foreground";
  }
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={cn("text-[10px] shrink-0", statusTone(status))}>
      {STATUS_LABEL[status as keyof typeof STATUS_LABEL] ?? status}
    </Badge>
  );
}

function pretty(iso?: string | null) {
  if (!iso) return "—";
  try { return format(parseISO(iso), "MMM d, yyyy"); } catch { return iso; }
}

export function TrainingScheduleBoard({
  clientId,
  clientName,
}: {
  clientId: string;
  clientName?: string | null;
}) {
  void todayISO();

  const qc = useQueryClient();
  const { data, isLoading } = useClientTrainingSchedule(clientId);
  const [view, setView] = useState<View>("schedule");
  const [assignOpen, setAssignOpen] = useState(false);
  const [endEarlyFor, setEndEarlyFor] = useState<ScheduleBlock | null>(null);
  const [datesFor, setDatesFor] = useState<ScheduleBlock | null>(null);
  const [addNextOpen, setAddNextOpen] = useState(false);

  const blocks = data?.blocks ?? [];
  const workouts = data?.workouts ?? [];
  const current = pickCurrent(blocks);
  const upcoming = upcomingBlocks(blocks);
  const drafts = draftBlocks(blocks);
  const history = historyBlocks(blocks);
  const overlaps = findOverlaps(blocks);

  const prepById = useMemo(() => {
    const map = new Map<string, any>();
    for (const p of data?.preps ?? []) map.set(p.id, p);
    return map;
  }, [data?.preps]);

  const currentProgram = current?.prep_id ? prepById.get(current.prep_id) : null;
  const nextBlock = upcoming[0] ?? null;
  const gap = gapDays(current?.effective_end ?? null, nextBlock?.start_date ?? null);

  const blockWorkouts = useMemo(
    () => workouts.filter((w) => w.blockId === current?.id),
    [workouts, current?.id],
  );
  const doneCount = blockWorkouts.filter((w) => w.completed).length;
  const nextWorkout = data?.nextWorkout ?? null;


  const refresh = () => {
    qc.invalidateQueries({ queryKey: clientTrainingScheduleKey(clientId) });
    qc.invalidateQueries({ queryKey: ["assigned-blocks"] });
    qc.invalidateQueries({ queryKey: ["pl-blocks", clientId] });
    qc.invalidateQueries({ queryKey: ["block-summary"] });
    qc.invalidateQueries({ queryKey: ["client-schedule", clientId] });
    qc.invalidateQueries({ queryKey: ["my-workouts"] });
  };

  return (
    <section aria-label="Training schedule" className="w-full min-w-0 space-y-4">
      {/* Top bar: views + the only actions that matter day to day */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:flex sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex min-w-0 gap-1 overflow-x-auto rounded-lg border border-border bg-muted/30 p-1">
          {([
            ["schedule", "Schedule", CalendarRange],
            ["calendar", "Calendar", CalendarDays],
            ["history", "History", History],
          ] as const).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              className={cn(
                "inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-md px-3 text-xs font-semibold",
                view === key ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" className="min-h-[40px]" onClick={() => setAddNextOpen(true)}>
            <Plus className="mr-1 h-4 w-4" /> Add Next Block
          </Button>
          <Button size="sm" variant="outline" className="min-h-[40px]" onClick={() => setAssignOpen(true)}>
            <Layers className="mr-1 h-4 w-4" /> Assign from Library
          </Button>
        </div>
      </div>

      {isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading training schedule…</Card>
      ) : view === "schedule" ? (
        <div className="space-y-4">
          {overlaps.length > 0 && (
            <Card className="border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0">
                  <div className="font-semibold">Schedule overlap detected</div>
                  {overlaps.map(({ a, b }, i) => (
                    <div key={i} className="mt-0.5">
                      {a.name} ({formatRange(a.start_date, a.effective_end)}) overlaps {b.name} ({formatRange(b.start_date, b.effective_end)})
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          )}

          {/* CURRENT */}
          <Card className="min-w-0 border-primary/30 bg-card p-4 sm:p-5">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Current</div>
            {current ? (
              <>
                <div className="mt-1 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                  <div className="min-w-0">
                    {currentProgram?.title && (
                      <div className="truncate text-xs text-muted-foreground">{currentProgram.title}</div>
                    )}
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="truncate text-lg font-bold">{current.name}</span>
                      <StatusBadge status={current.status_derived} />
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {formatRange(current.start_date, current.effective_end)}
                      {durationLabel(current) ? ` · ${durationLabel(current)}` : ""}
                    </div>
                  </div>
                  <BlockMenu
                    block={current}
                    onEndEarly={() => setEndEarlyFor(current)}
                    onEditDates={() => setDatesFor(current)}
                  />
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <Stat label="Started" value={pretty(current.start_date)} />
                  <Stat label="Ends" value={pretty(current.effective_end)} />
                  <Stat
                    label="Today"
                    value={current.week_of ? `Week ${current.week_of} of ${current.total_weeks ?? "?"}` : "—"}
                  />
                  <Stat
                    label="Next workout"
                    value={nextWorkout ? `${format(parseISO(nextWorkout.date), "EEE MMM d")} — ${nextWorkout.title}` : "Not scheduled"}
                  />
                </div>

                {blockWorkouts.length > 0 && (
                  <div className="mt-3 space-y-1">
                    <Progress value={Math.round((doneCount / blockWorkouts.length) * 100)} className="h-1.5" />
                    <div className="text-[11px] text-muted-foreground">
                      {doneCount} of {blockWorkouts.length} workouts completed
                    </div>
                  </div>
                )}

                <div className="mt-4 flex flex-wrap gap-2">
                  <Link to="/admin/blocks/$blockId" params={{ blockId: current.id }}>
                    <Button size="sm" className="min-h-[40px]">Open Block</Button>
                  </Link>
                  <Button size="sm" variant="outline" className="min-h-[40px]" onClick={() => setEndEarlyFor(current)}>
                    <FlagOff className="mr-1 h-4 w-4" /> End Block Early
                  </Button>
                  <Button size="sm" variant="outline" className="min-h-[40px]" onClick={() => setAddNextOpen(true)}>
                    <Plus className="mr-1 h-4 w-4" /> Add Next Block
                  </Button>
                  <Button size="sm" variant="ghost" className="min-h-[40px]" onClick={() => setDatesFor(current)}>
                    <Pencil className="mr-1 h-4 w-4" /> Change Dates
                  </Button>
                </div>
              </>
            ) : (
              <div className="mt-2 space-y-3">
                <p className="text-sm text-muted-foreground">
                  No block is running today for {clientName ?? "this client"}.
                  {drafts.length > 0 && " There are undated blocks ready to start."}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" className="min-h-[40px]" onClick={() => setAddNextOpen(true)}>
                    <Plus className="mr-1 h-4 w-4" /> Start a block
                  </Button>
                  <Button size="sm" variant="outline" className="min-h-[40px]" onClick={() => setAssignOpen(true)}>
                    <Layers className="mr-1 h-4 w-4" /> Assign from Library
                  </Button>
                </div>
              </div>
            )}
          </Card>

          {/* UP NEXT */}
          {nextBlock && (
            <Card className="min-w-0 p-4">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Up next</div>
                  <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
                    <span className="truncate font-bold">{nextBlock.name}</span>
                    <StatusBadge status={nextBlock.status_derived} />
                  </div>
                  <div className="mt-0.5 text-sm text-muted-foreground">
                    Starts {pretty(nextBlock.start_date)} · Ends {pretty(nextBlock.effective_end)}
                    {durationLabel(nextBlock) ? ` · ${durationLabel(nextBlock)}` : ""}
                  </div>
                  {gap > 0 && (
                    <div className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                      {gap}-day training gap after the current block
                    </div>
                  )}
                </div>
                <BlockMenu block={nextBlock} onEditDates={() => setDatesFor(nextBlock)} />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link to="/admin/blocks/$blockId" params={{ blockId: nextBlock.id }}>
                  <Button size="sm" variant="outline" className="min-h-[40px]">Open</Button>
                </Link>
                <Button size="sm" variant="ghost" className="min-h-[40px]" onClick={() => setDatesFor(nextBlock)}>
                  <Pencil className="mr-1 h-4 w-4" /> Edit Dates
                </Button>
              </div>
            </Card>
          )}

          <BlockTimeline blocks={blocks} />
        </div>
      ) : view === "calendar" ? (
        <ScheduleCalendarView blocks={blocks} workouts={workouts} />
      ) : (
        <HistoryList blocks={history} />
      )}

      <AssignProgramDialog open={assignOpen} onOpenChange={setAssignOpen} clientId={clientId} clientName={clientName} />

      {endEarlyFor && (
        <EndBlockEarlyDialog
          block={endEarlyFor}
          blocks={blocks}
          open
          onOpenChange={(v) => !v && setEndEarlyFor(null)}
          onDone={() => { setEndEarlyFor(null); refresh(); }}
        />
      )}
      {datesFor && (
        <ChangeBlockDatesDialog
          block={datesFor}
          open
          onOpenChange={(v) => !v && setDatesFor(null)}
          onDone={() => { setDatesFor(null); refresh(); }}
        />
      )}
      <AddNextBlockDialog
        open={addNextOpen}
        onOpenChange={setAddNextOpen}
        clientId={clientId}
        clientName={clientName}
        blocks={blocks}
        current={current}
        onDone={() => { setAddNextOpen(false); refresh(); }}
        onAssignLibrary={() => { setAddNextOpen(false); setAssignOpen(true); }}
      />
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-secondary/20 p-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="truncate text-sm font-semibold">{value}</div>
    </div>
  );
}

function BlockMenu({
  block,
  onEndEarly,
  onEditDates,
}: {
  block: ScheduleBlock;
  onEndEarly?: () => void;
  onEditDates?: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" className="h-10 w-10 shrink-0" aria-label="Block actions">
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {onEditDates && (
          <DropdownMenuItem onClick={onEditDates}><Pencil className="mr-2 h-4 w-4" /> Edit dates</DropdownMenuItem>
        )}
        {onEndEarly && block.status_derived === "Active" && (
          <DropdownMenuItem onClick={onEndEarly}><FlagOff className="mr-2 h-4 w-4" /> End early</DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <Link to="/admin/blocks/$blockId" params={{ blockId: block.id }}>
            <ChevronRight className="mr-2 h-4 w-4" /> Open block
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function BlockTimeline({ blocks }: { blocks: ScheduleBlock[] }) {
  const ordered = blocks.filter((b) => b.status_derived !== "Archived" && b.start_date);
  if (!ordered.length) return null;
  return (
    <Card className="min-w-0 p-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Block timeline</div>
      <div className="flex min-w-0 gap-2 overflow-x-auto pb-1">
        {ordered.map((b) => (
          <div
            key={b.id}
            className={cn(
              "w-44 shrink-0 rounded-md border p-2",
              b.status_derived === "Active" ? "border-primary/50 bg-primary/5" : "border-border bg-secondary/20",
            )}
          >
            <div className="truncate text-xs font-semibold">{b.name}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">{formatRange(b.start_date, b.effective_end)}</div>
            <div className="mt-1"><StatusBadge status={b.status_derived} /></div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function HistoryList({ blocks }: { blocks: ScheduleBlock[] }) {
  if (!blocks.length) return <Card className="p-6 text-sm text-muted-foreground">No past training blocks yet.</Card>;
  return (
    <Card className="divide-y divide-border">
      {blocks.map((b) => (
        <div key={b.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-3">
          <div className="min-w-0">
            <Link to="/admin/blocks/$blockId" params={{ blockId: b.id }} className="truncate text-sm font-semibold hover:underline">
              {b.name}
            </Link>
            <div className="text-xs text-muted-foreground">
              {formatRange(b.start_date, b.effective_end)}
              {durationLabel(b) ? ` · ${durationLabel(b)}` : ""}
              {b.status_derived === "EndedEarly" && b.original_end
                ? ` · originally ended ${pretty(b.original_end)}`
                : ""}
            </div>
          </div>
          <StatusBadge status={b.status_derived} />
        </div>
      ))}
    </Card>
  );
}

/* ───────────────────────── Calendar ───────────────────────── */

function ScheduleCalendarView({
  blocks,
  workouts,
}: {
  blocks: ScheduleBlock[];
  workouts: CalendarWorkout[];
}) {
  const today = todayISO();
  const [mode, setMode] = useState<"month" | "week">("month");
  const [cursor, setCursor] = useState(today.slice(0, 7));
  const [weekStart, setWeekStart] = useState(() => {
    const d = parseISO(today);
    return addDaysISO(today, -d.getDay());
  });

  const byDate = useMemo(() => {
    const m = new Map<string, CalendarWorkout[]>();
    for (const w of workouts) {
      if (!m.has(w.date)) m.set(w.date, []);
      m.get(w.date)!.push(w);
    }
    return m;
  }, [workouts]);

  const spans = blocks.filter((b) => b.start_date && b.status_derived !== "Archived");

  const [y, m] = cursor.split("-").map(Number);
  const firstWeekday = new Date(y, m - 1, 1).getDay();
  const daysInMonth = new Date(y, m, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${cursor}-${String(d).padStart(2, "0")}`);

  const shiftMonth = (delta: number) => {
    const d = new Date(y, m - 1 + delta, 1);
    setCursor(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };

  const weekDays = Array.from({ length: 7 }, (_, i) => addDaysISO(weekStart, i));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <Button size="icon" variant="ghost" className="h-9 w-9" onClick={() => (mode === "month" ? shiftMonth(-1) : setWeekStart(addDaysISO(weekStart, -7)))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0 truncate text-sm font-semibold">
            {mode === "month"
              ? new Date(y, m - 1).toLocaleDateString(undefined, { month: "long", year: "numeric" })
              : `${pretty(weekStart)} – ${pretty(addDaysISO(weekStart, 6))}`}
          </div>
          <Button size="icon" variant="ghost" className="h-9 w-9" onClick={() => (mode === "month" ? shiftMonth(1) : setWeekStart(addDaysISO(weekStart, 7)))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex gap-1 rounded-lg border border-border bg-muted/30 p-1">
          {(["month", "week"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setMode(k)}
              className={cn(
                "min-h-[36px] rounded-md px-3 text-xs font-semibold capitalize",
                mode === k ? "bg-background shadow-sm" : "text-muted-foreground",
              )}
            >
              {k}
            </button>
          ))}
        </div>
      </div>

      {/* Block spans make transitions obvious */}
      {spans.length > 0 && (
        <div className="flex flex-wrap gap-2 text-[11px]">
          {spans.map((b) => (
            <span
              key={b.id}
              className={cn(
                "inline-flex min-w-0 items-center gap-1 rounded-full border px-2 py-1",
                statusTone(b.status_derived),
              )}
            >
              <Dot className="h-3 w-3 shrink-0" />
              <span className="truncate">{b.name}</span>
              <span className="shrink-0 opacity-70">{formatRange(b.start_date, b.effective_end)}</span>
            </span>
          ))}
        </div>
      )}

      {mode === "month" ? (
        <Card className="overflow-hidden p-0">
          <div className="grid grid-cols-7 gap-px bg-border text-[10px]">
            {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
              <div key={i} className="bg-muted/40 px-1 py-1 text-center font-semibold uppercase">{d}</div>
            ))}
            {cells.map((iso, i) => (
              <div key={i} className={cn("min-h-[64px] bg-background p-1", iso === today && "ring-1 ring-inset ring-primary")}>
                {iso && (
                  <>
                    <div className={cn("text-[10px] font-semibold", iso === today && "text-primary")}>
                      {Number(iso.slice(8))}
                    </div>
                    {(byDate.get(iso) ?? []).map((w) => (
                      <div
                        key={w.id}
                        title={`${w.blockName ?? ""} · ${w.title}`}
                        className={cn(
                          "mt-0.5 truncate rounded px-1 text-[9px]",
                          w.completed
                            ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
                            : iso < today
                              ? "bg-rose-500/20 text-rose-700 dark:text-rose-300"
                              : "bg-secondary/70 text-foreground",
                        )}
                      >
                        {w.title}
                      </div>
                    ))}
                  </>
                )}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-border p-2 text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded bg-emerald-500/60" /> Completed</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded bg-secondary" /> Scheduled</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded bg-rose-500/50" /> Missed</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded ring-1 ring-primary" /> Today</span>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-[repeat(7,minmax(0,1fr))]">
          {weekDays.map((iso) => (
            <Card key={iso} className={cn("min-w-0 p-2", iso === today && "border-primary/50")}>
              <div className="text-[10px] font-semibold uppercase text-muted-foreground">
                {format(parseISO(iso), "EEE d")}
                {iso === today && <span className="ml-1 text-primary">Today</span>}
              </div>
              <div className="mt-1 space-y-1">
                {(byDate.get(iso) ?? []).map((w) => (
                  <div
                    key={w.id}
                    className={cn(
                      "truncate rounded px-1.5 py-1 text-[11px]",
                      w.completed ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-secondary/60",
                    )}
                  >
                    {w.title}
                  </div>
                ))}
                {!(byDate.get(iso) ?? []).length && <div className="text-[11px] text-muted-foreground">Rest</div>}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── Dialogs ───────────────────────── */

const DIALOG_CLASS =
  "max-h-[100dvh] w-full gap-3 overflow-y-auto sm:max-w-lg " +
  "pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]";

function EndBlockEarlyDialog({
  block, blocks, open, onOpenChange, onDone,
}: {
  block: ScheduleBlock;
  blocks: ScheduleBlock[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const today = todayISO();
  const preview = useServerFn(previewEndBlockEarlyFn);
  const endEarly = useServerFn(endBlockEarlyFn);
  const setSchedule = useServerFn(setBlockScheduleFn);
  const [newEnd, setNewEnd] = useState(block.effective_end && block.effective_end > today ? today : block.effective_end ?? today);
  const [info, setInfo] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [startNext, setStartNext] = useState(false);
  const candidates = blocks.filter((b) => b.id !== block.id && (b.status_derived === "Upcoming" || b.status_derived === "Draft"));
  const [nextId, setNextId] = useState(candidates[0]?.id ?? "");
  const [nextStart, setNextStart] = useState(addDaysISO(newEnd, 1));

  const loadPreview = async (date: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    try {
      setInfo(await preview({ data: { blockId: block.id, newEnd: date } }));
    } catch (e: any) {
      toast.error(e.message ?? "Could not preview this change");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={DIALOG_CLASS}>
        <DialogHeader>
          <DialogTitle>End block early</DialogTitle>
          <DialogDescription>
            Pick any date. Completed workouts, logged sets and history are never changed — only future
            sessions come off the calendar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="new-end">New final date</Label>
            <Input
              id="new-end"
              type="date"
              className="min-h-[44px]"
              value={newEnd}
              onChange={(e) => {
                setNewEnd(e.target.value);
                setNextStart(addDaysISO(e.target.value, 1));
                setInfo(null);
                void loadPreview(e.target.value);
              }}
              onBlur={() => void loadPreview(newEnd)}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Currently ends {pretty(block.effective_end)}
            </p>
          </div>

          <Button type="button" size="sm" variant="outline" className="min-h-[40px]" onClick={() => void loadPreview(newEnd)}>
            Preview changes
          </Button>

          {info && (
            <div className="rounded-md border border-border bg-secondary/20 p-3 text-xs">
              <div>Current end: <span className="font-semibold">{pretty(info.currentEnd)}</span></div>
              <div>New end: <span className="font-semibold">{pretty(info.newEnd)}</span></div>
              <div className="mt-1">
                Future workouts affected: <span className="font-semibold">{info.affectedCount}</span>
              </div>
              <div>Completed workouts: <span className="font-semibold">preserved</span></div>
              {info.affected?.length > 0 && (
                <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                  {info.affected.map((a: any) => (
                    <li key={a.id}>{pretty(a.date)} — {a.title}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {candidates.length > 0 && (
            <div className="rounded-md border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs">Start the next block too</Label>
                <Switch checked={startNext} onCheckedChange={setStartNext} />
              </div>
              {startNext && (
                <div className="mt-3 space-y-2">
                  <Select value={nextId} onValueChange={setNextId}>
                    <SelectTrigger className="min-h-[44px]"><SelectValue placeholder="Choose block" /></SelectTrigger>
                    <SelectContent>
                      {candidates.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <div>
                    <Label htmlFor="next-start" className="text-xs">Next block starts</Label>
                    <Input id="next-start" type="date" className="min-h-[44px]" value={nextStart} onChange={(e) => setNextStart(e.target.value)} />
                    {gapDays(newEnd, nextStart) > 0 && (
                      <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                        {gapDays(newEnd, nextStart)}-day training gap (allowed)
                      </p>
                    )}
                    {nextStart <= newEnd && (
                      <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                        Overlaps the block you are ending.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" className="min-h-[44px]" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            className="min-h-[44px]"
            disabled={busy || !newEnd}
            onClick={async () => {
              setBusy(true);
              try {
                await endEarly({ data: { blockId: block.id, newEnd } });
                if (startNext && nextId) {
                  await setSchedule({ data: { blockId: nextId, startDate: nextStart } });
                }
                toast.success(`Block ends ${pretty(newEnd)}`);
                onDone();
              } catch (e: any) {
                toast.error(e.message ?? "Could not end this block");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {startNext ? "Confirm schedule change" : `End block ${newEnd ? format(parseISO(newEnd), "MMM d") : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChangeBlockDatesDialog({
  block, open, onOpenChange, onDone,
}: {
  block: ScheduleBlock;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const setSchedule = useServerFn(setBlockScheduleFn);
  const [start, setStart] = useState(block.start_date ?? todayISO());
  const [end, setEnd] = useState(block.effective_end ?? "");
  const [endTouched, setEndTouched] = useState(false);
  const [shift, setShift] = useState(true);
  const [busy, setBusy] = useState(false);

  const dur = Number(block.week_duration_days ?? 7) || 7;
  const computedEnd = block.weeks ? addDaysISO(start, Number(block.weeks) * dur - 1) : end;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={DIALOG_CLASS}>
        <DialogHeader>
          <DialogTitle>Change block dates</DialogTitle>
          <DialogDescription>
            Moving a block moves its future, uncompleted workouts by the same number of days.
            Past and completed sessions keep the dates they really happened.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="blk-start">Start date</Label>
            <Input
              id="blk-start"
              type="date"
              className="min-h-[44px]"
              value={start}
              onChange={(e) => { setStart(e.target.value); if (!endTouched) setEnd(""); }}
            />
          </div>
          <div>
            <Label htmlFor="blk-end">End date</Label>
            <Input
              id="blk-end"
              type="date"
              className="min-h-[44px]"
              value={endTouched ? end : computedEnd}
              onChange={(e) => { setEnd(e.target.value); setEndTouched(true); }}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              {endTouched ? "Manual end date." : "Calculated from start + block length."}
            </p>
          </div>
          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <Label className="text-xs">Move this block's upcoming workouts too</Label>
            <Switch checked={shift} onCheckedChange={setShift} />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="min-h-[44px]" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            className="min-h-[44px]"
            disabled={busy || !start}
            onClick={async () => {
              setBusy(true);
              try {
                const res: any = await setSchedule({
                  data: {
                    blockId: block.id,
                    startDate: start,
                    endDate: (endTouched ? end : computedEnd) || null,
                    shiftWorkouts: shift,
                  },
                });
                toast.success(res?.movedWorkouts ? `Dates saved · ${res.movedWorkouts} workouts moved` : "Dates saved");
                onDone();
              } catch (e: any) {
                toast.error(e.message ?? "Could not save dates");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Save dates
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddNextBlockDialog({
  open, onOpenChange, blocks, current, onDone, onAssignLibrary,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientId: string;
  clientName?: string | null;
  blocks: ScheduleBlock[];
  current: ScheduleBlock | null;
  onDone: () => void;
  onAssignLibrary: () => void;
}) {
  const setSchedule = useServerFn(setBlockScheduleFn);
  const candidates = blocks.filter(
    (b) => b.id !== current?.id && (b.status_derived === "Draft" || b.status_derived === "Upcoming"),
  );
  const [blockId, setBlockId] = useState(candidates[0]?.id ?? "");
  const [start, setStart] = useState(suggestedNextStart(current));
  const [busy, setBusy] = useState(false);

  const chosen = candidates.find((b) => b.id === blockId) ?? null;
  const dur = Number(chosen?.week_duration_days ?? 7) || 7;
  const expectedEnd = chosen?.weeks ? addDaysISO(start, Number(chosen.weeks) * dur - 1) : null;
  const gap = gapDays(current?.effective_end ?? null, start);
  const overlaps = !!current?.effective_end && start <= current.effective_end;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={DIALOG_CLASS}>
        <DialogHeader>
          <DialogTitle>Add next block</DialogTitle>
          <DialogDescription>Start one of this client's programmed blocks, or assign a new one from the library.</DialogDescription>
        </DialogHeader>

        {candidates.length === 0 ? (
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>No programmed block is waiting. Assign one from the program library.</p>
            <Button className="min-h-[44px]" onClick={onAssignLibrary}>
              <Layers className="mr-1 h-4 w-4" /> Assign from Library
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <Label>Block</Label>
              <Select value={blockId} onValueChange={setBlockId}>
                <SelectTrigger className="min-h-[44px]"><SelectValue placeholder="Choose block" /></SelectTrigger>
                <SelectContent>
                  {candidates.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}{b.weeks ? ` · ${b.weeks} weeks` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="next-block-start">Start date</Label>
              <Input id="next-block-start" type="date" className="min-h-[44px]" value={start} onChange={(e) => setStart(e.target.value)} />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Suggested: the day after the current block ends ({pretty(suggestedNextStart(current))}).
              </p>
            </div>
            <div className="rounded-md border border-border bg-secondary/20 p-3 text-xs">
              <div>Start: <span className="font-semibold">{pretty(start)}</span></div>
              <div>Expected end: <span className="font-semibold">{pretty(expectedEnd)}</span></div>
              {gap > 0 && <div className="mt-1 text-amber-600 dark:text-amber-400">{gap}-day training gap (allowed)</div>}
              {overlaps && (
                <div className="mt-1 inline-flex items-start gap-1 text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  Overlaps the current block ({formatRange(current?.start_date, current?.effective_end)}).
                </div>
              )}
            </div>
            <Button variant="ghost" size="sm" className="min-h-[40px]" onClick={onAssignLibrary}>
              <ArrowRightLeft className="mr-1 h-4 w-4" /> Use a library program instead
            </Button>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" className="min-h-[44px]" onClick={() => onOpenChange(false)}>Cancel</Button>
          {candidates.length > 0 && (
            <Button
              className="min-h-[44px]"
              disabled={busy || !blockId || !start}
              onClick={async () => {
                setBusy(true);
                try {
                  await setSchedule({ data: { blockId, startDate: start } });
                  toast.success(`Block starts ${pretty(start)}`);
                  onDone();
                } catch (e: any) {
                  toast.error(e.message ?? "Could not start this block");
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Start block
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
