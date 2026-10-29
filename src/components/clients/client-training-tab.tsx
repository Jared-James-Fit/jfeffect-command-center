/**
 * The client's Training tab (admin / coach): one place to build, assign and
 * adjust their training, nothing else.
 *
 *   Program   what's running (week, next workout, done so far), what needs
 *             the coach (workouts with no date, ending with nothing after,
 *             gaps, overlaps), Edit program and one Add (library program,
 *             new block, a built block onto the calendar), the roadmap of
 *             blocks, and the program's tools in its ⋯.
 *   Schedule  the calendar (ScheduleManagerShell, coach).
 *   Setup     training days, maxes and warm-up as rows that open a sheet.
 *   Notes     what they wrote after workouts, pain first.
 *
 * Reads the same canonical schedule as the client's own calendar
 * (useClientTrainingSchedule), so a finished block never shows as running.
 */
import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import {
  AlertTriangle, Archive, BarChart3, BookOpen, CalendarDays, CalendarPlus, ChevronDown, ChevronRight,
  Download, Dumbbell, Flame, FlagOff, History, Layers, Loader2, MoreHorizontal, Pencil, Plus, Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { createBlock } from "@/lib/pl-programs";
import { listClientMaxes } from "@/lib/pl-maxes";
import { supabase } from "@/integrations/supabase/client";
import { blockNameParts } from "@/lib/training-roadmap";
import { todayISO, formatRange, type ScheduleBlock } from "@/lib/block-schedule-model";
import { useClientTrainingSchedule, clientTrainingScheduleKey } from "@/lib/use-client-training-schedule";
import { trainingRoadmap, trainingAlerts, type TrainingAlert } from "@/lib/training-tab";
import { WEEK_DAYS, SHORT_DAY, type WeekDay } from "@/lib/training-schedule";
import { downloadFullTrainingReportForClient } from "@/lib/workouts/download-full-training-report";
import { AssignProgramDialog } from "@/components/clients/assign-program-dialog";
import { WorkoutArchiveDialog } from "@/components/clients/workout-archive-dialog";
import {
  AddNextBlockDialog, ChangeBlockDatesDialog, EndBlockEarlyDialog,
} from "@/components/clients/training-schedule-board";
import { TrainingScheduleCard } from "@/components/training-schedule-card";
import { ClientNotesCard } from "@/components/messages/client-notes-log";
import { lazyWithRetry } from "@/lib/lazy-chunk";

const ScheduleManagerShell = lazyWithRetry(() =>
  import("@/components/schedule/ScheduleManagerShell").then((m) => ({ default: m.ScheduleManagerShell })),
);
const ClientMaxesPanel = lazyWithRetry(() => import("@/components/client-maxes-panel").then((m) => ({ default: m.ClientMaxesPanel })));
const ClientWarmupCard = lazyWithRetry(() => import("@/components/client-warmup-card").then((m) => ({ default: m.ClientWarmupCard })));

type ClientRow = {
  id: string;
  full_name?: string | null;
  committed_training_frequency?: number | null;
  committed_training_days?: string[] | null;
  [k: string]: unknown;
};

/** Element id of the schedule card; "Place them" and /admin/clients/$id/schedule land here. */
export const TRAINING_SCHEDULE_ANCHOR = "schedule";

export function ClientTrainingTab({ clientId, client }: { clientId: string; client: ClientRow | null }) {
  const name = (client?.full_name as string | null) ?? null;
  const hash = useRouterState({ select: (r) => r.location.hash });
  // "Manage Schedule" and old /schedule links open the tab on the calendar.
  useEffect(() => {
    if (hash.replace(/^#/, "") !== TRAINING_SCHEDULE_ANCHOR) return;
    const t = window.setTimeout(() => {
      document.getElementById(TRAINING_SCHEDULE_ANCHOR)?.scrollIntoView({ block: "start" });
    }, 400);
    return () => window.clearTimeout(t);
  }, [hash]);
  return (
    <div className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)] gap-4 md:col-span-3 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-5">
      <div className="min-w-0 space-y-4 lg:space-y-5">
        <ProgramCard clientId={clientId} clientName={name} />
        <section id={TRAINING_SCHEDULE_ANCHOR} aria-label="Schedule" className="min-w-0 scroll-mt-24">
          <Suspense fallback={<Card className="p-6 text-sm text-muted-foreground">Loading schedule…</Card>}>
            <ScheduleManagerShell clientId={clientId} mode="coach" />
          </Suspense>
        </section>
      </div>
      <div className="min-w-0 space-y-4 lg:space-y-5">
        <AthleteSetupCard clientId={clientId} client={client} />
        <ClientNotesCard clientId={clientId} name={name} />
      </div>
    </div>
  );
}

/* ───────────────────────────── Program ───────────────────────────── */

function ProgramCard({ clientId, clientName }: { clientId: string; clientName: string | null }) {
  const qc = useQueryClient();
  const { data, isLoading } = useClientTrainingSchedule(clientId);
  const [addOpen, setAddOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [scheduleBlock, setScheduleBlock] = useState<{ id: string | null } | null>(null);
  const [datesFor, setDatesFor] = useState<ScheduleBlock | null>(null);
  const [endEarlyFor, setEndEarlyFor] = useState<ScheduleBlock | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [pastOpen, setPastOpen] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);

  const blocks = useMemo(() => data?.blocks ?? [], [data?.blocks]);
  const assignmentId = data?.currentAssignmentId ?? null;
  const roadmap = useMemo(() => trainingRoadmap(blocks, assignmentId), [blocks, assignmentId]);
  const today = todayISO();
  const alerts = useMemo(
    () => trainingAlerts({ blocks, roadmap, unscheduled: data?.unscheduled ?? [], today }),
    [blocks, roadmap, data?.unscheduled, today],
  );
  const current = roadmap.current;
  // What "Edit program" opens: the running block, else the next one, else a built one.
  const focus = current ?? roadmap.live[0] ?? roadmap.drafts[0] ?? null;
  const program = useMemo(() => {
    const prepId = focus?.prep_id ?? assignmentId;
    return prepId ? (data?.preps ?? []).find((p: any) => p.id === prepId) ?? null : null;
  }, [data?.preps, focus?.prep_id, assignmentId]);
  const focusWorkouts = (data?.workouts ?? []).filter((w) => w.blockId === focus?.id);
  const done = focusWorkouts.filter((w) => w.completed).length;
  const next = data?.nextWorkout ?? null;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: clientTrainingScheduleKey(clientId) });
    qc.invalidateQueries({ queryKey: ["client-schedule", clientId] });
    qc.invalidateQueries({ queryKey: ["assigned-blocks", clientId] });
    qc.invalidateQueries({ queryKey: ["pl-blocks", clientId] });
    qc.invalidateQueries({ queryKey: ["my-workouts"] });
  };

  const downloadReport = async () => {
    setReportBusy(true);
    const id = toast.loading("Making the training report…");
    try {
      const res = await downloadFullTrainingReportForClient({ clientId, clientDisplayName: clientName });
      if (!res.ok) toast.error(res.reason, { id });
      else toast.success("Training report downloaded", { id });
    } catch {
      toast.error("Could not make the training report.", { id });
    } finally {
      setReportBusy(false);
    }
  };

  const goToSchedule = () => {
    document.getElementById(TRAINING_SCHEDULE_ANCHOR)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const alertAction = (a: TrainingAlert) => {
    if (a.kind === "unscheduled") return { label: "Place them", run: goToSchedule };
    if (a.kind === "ends_soon") return { label: "Plan next", run: () => setAddOpen(true) };
    const target = a.kind === "gap" ? roadmap.live[1] : roadmap.live[1] ?? current;
    return target ? { label: "Fix dates", run: () => setDatesFor(target) } : null;
  };

  const parts = blockNameParts(focus?.name);
  const empty = !isLoading && !focus;

  return (
    <Card className="min-w-0 overflow-hidden border-border bg-card" aria-label="Training program" data-training-program>
      <div className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              <Dumbbell className="h-3.5 w-3.5 text-primary" />
              <span className="truncate">{program?.title ?? "Training program"}</span>
            </div>
            {isLoading ? (
              <div className="mt-2 h-6 w-48 animate-pulse rounded bg-muted" />
            ) : empty ? (
              <div className="mt-1 text-lg font-bold">Nothing assigned yet</div>
            ) : (
              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                {parts?.tag && (
                  <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-bold text-primary">{parts.tag}</span>
                )}
                <span className="min-w-0 truncate text-lg font-bold leading-tight">{parts?.name ?? focus?.name}</span>
              </div>
            )}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="h-10 w-10 shrink-0" aria-label="Program tools">
                <MoreHorizontal className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {current && (
                <>
                  <DropdownMenuItem onClick={() => setDatesFor(current)}><Pencil className="mr-2 h-4 w-4" /> Change block dates</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setEndEarlyFor(current)}><FlagOff className="mr-2 h-4 w-4" /> End block early</DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem asChild>
                <Link to="/admin/client-programs/$clientId/analytics" params={{ clientId }}><BarChart3 className="mr-2 h-4 w-4" /> Analytics &amp; PRs</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/admin/client-programs/$clientId/history" params={{ clientId }}><History className="mr-2 h-4 w-4" /> Program history</Link>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setArchiveOpen(true)}><Archive className="mr-2 h-4 w-4" /> Workout archive</DropdownMenuItem>
              <DropdownMenuItem disabled={reportBusy} onClick={downloadReport}>
                {reportBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />} Download training report
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/admin/client-programs/$clientId" params={{ clientId }}><Layers className="mr-2 h-4 w-4" /> All programs &amp; blocks</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {!isLoading && focus && (
          <>
            <div className="mt-1 text-sm text-muted-foreground">
              {current
                ? [current.week_of && current.total_weeks ? `Week ${current.week_of} of ${current.total_weeks}` : null,
                   current.effective_end ? `ends ${pretty(current.effective_end, "MMM d")}` : null].filter(Boolean).join(" · ")
                : focus.effective_start
                  ? `Starts ${pretty(focus.effective_start, "EEE, MMM d")}`
                  : "Built, not on the calendar yet"}
            </div>

            {focusWorkouts.length > 0 && (
              <div className="mt-3 space-y-1">
                <Progress value={Math.round((done / focusWorkouts.length) * 100)} className="h-1.5" />
                <div className="text-xs text-muted-foreground">{done} of {focusWorkouts.length} workouts done</div>
              </div>
            )}

            <div className="mt-3 flex items-center gap-2 rounded-lg bg-secondary/40 px-3 py-2.5 text-sm">
              <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
              {next ? (
                <span className="min-w-0 truncate">
                  <span className="text-muted-foreground">Next </span>
                  <span className="font-semibold">{pretty(next.date, "EEE, MMM d")}</span>
                  <span className="text-muted-foreground"> · {next.title}</span>
                </span>
              ) : (
                <span className="text-amber-600 dark:text-amber-400">Nothing on the calendar ahead</span>
              )}
            </div>
          </>
        )}

        {alerts.length > 0 && (
          <ul className="mt-3 space-y-2" data-training-alerts>
            {alerts.map((a, i) => {
              const action = alertAction(a);
              return (
                <li key={i} className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1">{alertText(a)}</span>
                  {action && (
                    <Button size="sm" variant="outline" className="h-9 shrink-0 border-amber-500/50 bg-background/60 px-3 text-xs" onClick={action.run}>
                      {action.label}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {empty ? (
          <div className="mt-3 space-y-3">
            <p className="text-sm text-muted-foreground">
              Give {clientName?.split(" ")[0] ?? "them"} a program from your library, or build one from scratch.
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Button className="min-h-[48px]" onClick={() => setAssignOpen(true)}>
                <BookOpen className="mr-2 h-4 w-4" /> Assign from library
              </Button>
              <Button variant="outline" className="min-h-[48px]" onClick={() => setNewOpen(true)}>
                <Sparkles className="mr-2 h-4 w-4" /> Build a new block
              </Button>
            </div>
          </div>
        ) : !isLoading && focus ? (
          <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <Button asChild className="min-h-[48px]">
              <Link to="/admin/blocks/$blockId" params={{ blockId: focus.id }}>
                <Pencil className="mr-2 h-4 w-4" /> Edit program
              </Link>
            </Button>
            <Button variant="outline" className="min-h-[48px] px-4" onClick={() => setAddOpen(true)}>
              <Plus className="mr-1 h-4 w-4" /> Add
            </Button>
          </div>
        ) : null}
      </div>

      {(roadmap.live.length + roadmap.drafts.length + roadmap.past.length) > 0 && (
        <div className="border-t border-border px-4 pb-2 pt-3 sm:px-5" data-training-roadmap>
          <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Roadmap</div>
          <ul className="divide-y divide-border/60">
            {roadmap.live.map((b, i) => (
              <RoadmapRow
                key={b.id}
                block={b}
                label={b.status_derived === "Active" ? "Now" : i === (current ? 1 : 0) ? "Next" : "Planned"}
                onDates={() => setDatesFor(b)}
                onEndEarly={b.status_derived === "Active" ? () => setEndEarlyFor(b) : undefined}
              />
            ))}
            {roadmap.drafts.map((b) => (
              <RoadmapRow key={b.id} block={b} label="Not scheduled" onSchedule={() => setScheduleBlock({ id: b.id })} />
            ))}
          </ul>
          {roadmap.past.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setPastOpen((v) => !v)}
                className="flex min-h-[44px] w-full items-center justify-between text-sm text-muted-foreground"
                aria-expanded={pastOpen}
              >
                <span>Finished blocks ({roadmap.past.length})</span>
                <ChevronDown className={cn("h-4 w-4 transition-transform", pastOpen && "rotate-180")} />
              </button>
              {pastOpen && (
                <ul className="divide-y divide-border/60 pb-1">
                  {roadmap.past.map((b) => (
                    <RoadmapRow key={b.id} block={b} label={b.status_derived === "EndedEarly" ? "Ended early" : b.status_derived === "Archived" ? "Archived" : "Done"} />
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}

      <AddTrainingSheet
        open={addOpen}
        onOpenChange={setAddOpen}
        hasDrafts={roadmap.drafts.length > 0}
        onLibrary={() => { setAddOpen(false); setAssignOpen(true); }}
        onNew={() => { setAddOpen(false); setNewOpen(true); }}
        onSchedule={() => { setAddOpen(false); setScheduleBlock({ id: null }); }}
      />
      <AssignProgramDialog open={assignOpen} onOpenChange={(v) => { setAssignOpen(v); if (!v) refresh(); }} clientId={clientId} clientName={clientName} />
      <NewBlockDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        clientId={clientId}
        prepId={program?.id ?? assignmentId}
        programTitle={program?.title ?? null}
      />
      {scheduleBlock && (
        <AddNextBlockDialog
          open
          onOpenChange={(v) => !v && setScheduleBlock(null)}
          clientId={clientId}
          clientName={clientName}
          blocks={blocks}
          current={current}
          initialBlockId={scheduleBlock.id}
          onDone={() => { setScheduleBlock(null); refresh(); }}
          onAssignLibrary={() => { setScheduleBlock(null); setAssignOpen(true); }}
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
      {endEarlyFor && (
        <EndBlockEarlyDialog
          block={endEarlyFor}
          blocks={blocks}
          open
          onOpenChange={(v) => !v && setEndEarlyFor(null)}
          onDone={() => { setEndEarlyFor(null); refresh(); }}
        />
      )}
      <WorkoutArchiveDialog open={archiveOpen} onOpenChange={setArchiveOpen} clientId={clientId} clientName={clientName} />
    </Card>
  );
}

function alertText(a: TrainingAlert): string {
  switch (a.kind) {
    case "unscheduled":
      return `${a.count} workout${a.count === 1 ? "" : "s"} need${a.count === 1 ? "s" : ""} a date`;
    case "ends_soon":
      return a.daysLeft === 0
        ? "Block ends today, nothing planned after"
        : `Block ends ${pretty(a.end, "MMM d")}, nothing planned after`;
    case "gap":
      return `${a.days}-day gap before the next block`;
    case "overlap":
      return `${a.a} overlaps ${a.b}`;
  }
}

function pretty(iso: string, fmt: string): string {
  try { return format(parseISO(iso), fmt); } catch { return iso; }
}

function RoadmapRow({
  block, label, onDates, onEndEarly, onSchedule,
}: {
  block: ScheduleBlock;
  label: string;
  onDates?: () => void;
  onEndEarly?: () => void;
  onSchedule?: () => void;
}) {
  const parts = blockNameParts(block.name);
  const active = block.status_derived === "Active";
  const draft = block.status_derived === "Draft";
  const past = !active && !draft && block.status_derived !== "Upcoming";
  return (
    <li className="flex min-h-[56px] items-center gap-2 py-1.5" data-roadmap-row={block.status_derived}>
      <Link
        to="/admin/blocks/$blockId"
        params={{ blockId: block.id }}
        className="flex min-h-[44px] min-w-0 flex-1 items-center gap-3 rounded-md pr-1"
      >
        <span
          aria-hidden
          className={cn(
            "h-2.5 w-2.5 shrink-0 rounded-full",
            active ? "bg-emerald-500 ring-4 ring-emerald-500/20" : draft ? "border-2 border-dashed border-muted-foreground/60" : past ? "bg-muted-foreground/30" : "bg-primary/70",
          )}
        />
        <span className="min-w-0">
          <span className={cn("block truncate text-sm font-semibold", past && "font-medium text-muted-foreground")}>
            {parts?.name ?? block.name ?? "Block"}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {[parts?.tag, draft ? (block.weeks ? `${block.weeks} weeks` : null) : formatRange(block.effective_start, block.effective_end)]
              .filter(Boolean).join(" · ")}
          </span>
        </span>
      </Link>
      {onSchedule ? (
        <Button size="sm" variant="outline" className="h-9 shrink-0 px-3 text-xs" onClick={onSchedule}>
          <CalendarPlus className="mr-1 h-3.5 w-3.5" /> Schedule
        </Button>
      ) : (
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold",
            active ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : past ? "text-muted-foreground" : "bg-secondary text-foreground/80",
          )}
        >
          {label}
        </span>
      )}
      {(onDates || onEndEarly) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0" aria-label={`${block.name ?? "Block"} options`}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link to="/admin/blocks/$blockId" params={{ blockId: block.id }}><Pencil className="mr-2 h-4 w-4" /> Edit in builder</Link>
            </DropdownMenuItem>
            {onDates && <DropdownMenuItem onClick={onDates}><CalendarDays className="mr-2 h-4 w-4" /> Change dates</DropdownMenuItem>}
            {onEndEarly && <DropdownMenuItem onClick={onEndEarly}><FlagOff className="mr-2 h-4 w-4" /> End early</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}

/** One Add: a library program, a new block, or a built block onto the calendar. */
function AddTrainingSheet({
  open, onOpenChange, hasDrafts, onLibrary, onNew, onSchedule,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  hasDrafts: boolean;
  onLibrary: () => void;
  onNew: () => void;
  onSchedule: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto rounded-t-[24px] pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:mx-auto sm:max-w-lg">
        <SheetHeader className="mb-2 text-left">
          <SheetTitle>Add training</SheetTitle>
          <SheetDescription>What do you want to give them next?</SheetDescription>
        </SheetHeader>
        <div className="space-y-2">
          <ChoiceRow icon={<BookOpen className="h-5 w-5" />} title="From your library" text="A ready-made program, placed on their training days." onClick={onLibrary} />
          <ChoiceRow icon={<Sparkles className="h-5 w-5" />} title="Build a new block" text="Start blank and write it in the program builder." onClick={onNew} />
          {hasDrafts && (
            <ChoiceRow icon={<CalendarPlus className="h-5 w-5" />} title="Schedule a built block" text="Put a block you've already built onto the calendar." onClick={onSchedule} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ChoiceRow({ icon, title, text, onClick }: { icon: ReactNode; title: string; text: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[64px] w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left transition hover:bg-secondary/40 active:scale-[0.99]"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs text-muted-foreground">{text}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

/** A blank block in the client's current program, opened straight in the builder. */
function NewBlockDialog({
  open, onOpenChange, clientId, prepId, programTitle,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientId: string;
  prepId: string | null;
  programTitle: string | null;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [weeks, setWeeks] = useState(4);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    const clean = name.trim();
    if (!clean) return toast.error("Give the block a name");
    setBusy(true);
    try {
      const block = await createBlock({ client_id: clientId, name: clean, weeks, prep_id: prepId, status: "Draft" });
      qc.invalidateQueries({ queryKey: clientTrainingScheduleKey(clientId) });
      toast.success("Block made. Build it, then tap Schedule on it to put it on the calendar.");
      onOpenChange(false);
      setName("");
      navigate({ to: "/admin/blocks/$blockId", params: { blockId: block.id } });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not make the block");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Build a new block</DialogTitle>
          <DialogDescription>
            {programTitle ? `Part of ${programTitle}. ` : ""}It opens in the program builder. It goes on the calendar when you schedule it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="new-block-name">Name</Label>
            <Input
              id="new-block-name"
              className="mt-1 h-12 text-base"
              value={name}
              placeholder="e.g. Block 2 — Strength"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void create(); }}
            />
          </div>
          <div>
            <Label>Weeks</Label>
            <div className="mt-1 flex items-center gap-3">
              <Button type="button" variant="outline" className="h-12 w-12 text-lg" onClick={() => setWeeks((w) => Math.max(1, w - 1))} aria-label="One week fewer">−</Button>
              <div className="min-w-[4rem] text-center text-lg font-bold tabular-nums">{weeks}</div>
              <Button type="button" variant="outline" className="h-12 w-12 text-lg" onClick={() => setWeeks((w) => Math.min(16, w + 1))} aria-label="One week more">+</Button>
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="min-h-[44px]" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="min-h-[44px]" disabled={busy || !name.trim()} onClick={create}>
            {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Make it and open the builder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ───────────────────────────── Setup ───────────────────────────── */

type SetupSheet = "days" | "maxes" | "warmup" | null;

function AthleteSetupCard({ clientId, client }: { clientId: string; client: ClientRow | null }) {
  const [sheet, setSheet] = useState<SetupSheet>(null);
  const { data: maxes = [] } = useQuery({
    queryKey: ["pl-client-maxes", clientId],
    queryFn: () => listClientMaxes(clientId),
    enabled: !!clientId,
  });
  const { data: warmup } = useQuery({
    queryKey: ["client-warmup", clientId],
    queryFn: async () =>
      (await (supabase as any).from("clients").select("warmup_protocol_id").eq("id", clientId).maybeSingle()).data,
  });

  const days = (client?.committed_training_days ?? [])
    .filter((d): d is WeekDay => (WEEK_DAYS as readonly string[]).includes(d))
    .slice()
    .sort((a, b) => WEEK_DAYS.indexOf(a) - WEEK_DAYS.indexOf(b));
  const daysValue = days.length
    ? `${days.length} a week · ${days.map((d) => SHORT_DAY[d]).join(" ")}`
    : null;
  const activeMaxes = maxes.filter((m) => m.active);
  const maxesValue = activeMaxes.length
    ? activeMaxes.slice(0, 3).map((m) => `${shortLift(m.lift)} ${m.one_rm ?? m.training_max ?? "—"}`).join(" · ") + (activeMaxes.length > 3 ? ` +${activeMaxes.length - 3}` : "")
    : null;

  return (
    <Card className="min-w-0 border-border bg-card p-2" aria-label="Athlete setup" data-athlete-setup>
      <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Athlete setup</div>
      <SetupRow icon={<CalendarDays className="h-4 w-4" />} title="Training days" value={daysValue} empty="Not set: workouts can't be placed" onClick={() => setSheet("days")} />
      <SetupRow icon={<Dumbbell className="h-4 w-4" />} title="Maxes" value={maxesValue} empty="None yet: % loads can't be worked out" onClick={() => setSheet("maxes")} />
      <SetupRow icon={<Flame className="h-4 w-4" />} title="Warm-up" value={warmup?.warmup_protocol_id ? "Their own protocol" : "Program default"} onClick={() => setSheet("warmup")} />

      <Sheet open={sheet !== null} onOpenChange={(v) => !v && setSheet(null)}>
        <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto rounded-t-[24px] pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:mx-auto sm:max-w-lg">
          <SheetHeader className="mb-3 text-left">
            <SheetTitle>{sheet === "days" ? "Training days" : sheet === "maxes" ? "Maxes" : "Warm-up"}</SheetTitle>
            <SheetDescription>
              {sheet === "days"
                ? "Their upcoming workouts move onto the days you pick."
                : sheet === "maxes"
                  ? "1RMs and training maxes for this athlete."
                  : "Which warm-up they get before each workout."}
            </SheetDescription>
          </SheetHeader>
          <Suspense fallback={<div className="py-6 text-sm text-muted-foreground">Loading…</div>}>
            {sheet === "days" && client && (
              <TrainingScheduleCard
                key={JSON.stringify([client.committed_training_days, client.committed_training_frequency])}
                client={client as any}
                embedded
                defaultEditing
                coach
                onDone={() => setSheet(null)}
              />
            )}
            {sheet === "maxes" && <ClientMaxesPanel clientId={clientId} embedded />}
            {sheet === "warmup" && <ClientWarmupCard clientId={clientId} embedded onSaved={() => setSheet(null)} />}
          </Suspense>
        </SheetContent>
      </Sheet>
    </Card>
  );
}

function shortLift(lift: string): string {
  return lift.replace(/^competition\s+/i, "").replace(/\s+press$/i, "");
}

function SetupRow({
  icon, title, value, empty, onClick,
}: {
  icon: ReactNode;
  title: string;
  value: string | null;
  empty?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[56px] w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-secondary/40"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground/80">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        <span className={cn("block truncate text-xs", value ? "text-muted-foreground" : "text-amber-600 dark:text-amber-400")}>
          {value ?? empty ?? "Not set"}
        </span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}
