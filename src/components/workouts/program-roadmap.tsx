import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Archive, Check, ChevronDown, ChevronLeft, ChevronRight, Eye, Flag, Pencil, Settings2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { parseLocalDate, todayLocalISO } from "@/lib/today";
import { isAtHomeBackupSessionBlock } from "@/lib/at-home-backup";
import {
  blockNameParts,
  buildProgramRoadmap,
  programShortName,
  roadmapProgressParts,
  type ProgramRoadmap,
  type ProgramSummary,
  type RoadmapBlockView,
  type RoadmapNoteRow,
  type RoadmapWeekView,
} from "@/lib/training-roadmap";

const sb = supabase as any;

/* ──────────────────────────────────────────────────────────────────────────
   Program roadmap: sits under the calendar. The calendar says what to do
   today; this is the one place that says where you are in the program (the
   block by its own name, "Block N of M · Week N of M", one bar) and where
   it's going: this week's focus, then every block as a step on the roadmap
   (tap one to see its weeks). Dates, block numbers and weeks come from the
   same pl_blocks / pl_weeks as the calendar. The words are the coach's when
   they wrote them, else Cleo's, written from the actual programming
   (pl_roadmap_notes); nothing here changes a prescription.
   ────────────────────────────────────────────────────────────────────────── */

/** Every client-visible block (shared with Block View's block picker). */
export function useClientVisibleBlocks(clientId: string) {
  return useQuery({
    queryKey: ["client-visible-blocks", clientId],
    enabled: !!clientId,
    staleTime: 30_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("pl_blocks")
        .select("*")
        .eq("client_id", clientId)
        .eq("client_visible", true)
        .neq("status", "Archived")
        .order("start_date", { ascending: true, nullsFirst: false })
        .order("sort_order", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true });
      return (data ?? []) as any[];
    },
  });
}

/** Weeks, roadmap notes and meet dates for a client's blocks → the roadmap. */
export function useProgramRoadmap(
  clientId: string,
  blocks: any[] | undefined,
  opts: { programId?: string | null; ownerName?: string | null } = {},
) {
  const primary = useMemo(() => (blocks ?? []).filter((b) => b?.id && !isAtHomeBackupSessionBlock(b)), [blocks]);
  const ids = useMemo(() => primary.map((b) => b.id as string).sort(), [primary]);
  const prepIds = useMemo(() => [...new Set(primary.map((b) => b.prep_id).filter(Boolean))] as string[], [primary]);

  const { data } = useQuery({
    queryKey: ["program-roadmap", clientId, ids.join(","), prepIds.join(",")],
    enabled: !!clientId && ids.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const [weeks, notes, preps] = await Promise.all([
        sb
          .from("pl_weeks")
          .select("id, block_id, week_index, start_date, end_date, manually_completed, archived, deleted_at")
          .in("block_id", ids),
        sb
          .from("pl_roadmap_notes")
          .select("id, block_id, week_id, ai_label, ai_summary, ai_style, coach_label, coach_summary, hidden, generated_at, edited_at")
          .in("block_id", ids),
        prepIds.length
          ? sb.from("pl_preps").select("id, title, status, archived, event_name, event_date").in("id", prepIds)
          : Promise.resolve({ data: [] }),
      ]);
      return {
        weeks: ((weeks.data ?? []) as any[]).filter((w) => !w.archived && !w.deleted_at),
        // A missing table (migration not applied yet) just means no words yet.
        notes: (notes.error ? [] : notes.data ?? []) as RoadmapNoteRow[],
        preps: (preps.data ?? []) as any[],
      };
    },
  });

  return useMemo<ProgramRoadmap | null>(() => {
    if (!primary.length) return null;
    return buildProgramRoadmap({
      blocks: primary,
      weeks: data?.weeks ?? [],
      notes: data?.notes ?? [],
      preps: data?.preps ?? [],
      today: todayLocalISO(),
      programId: opts.programId,
      ownerName: opts.ownerName,
    });
  }, [primary, data, opts.programId, opts.ownerName]);
}

const fmt = (iso: string | null, f = "MMM d") => {
  const d = parseLocalDate(iso);
  return d ? format(d, f) : null;
};

const weeksLabel = (n: number) => `${n} week${n === 1 ? "" : "s"}`;
const rangeLabel = (start: string | null, end: string | null) => [fmt(start), fmt(end)].filter(Boolean).join(" – ");

/** One sentence the athlete can act on: the week's own note, else the block's purpose. */
function weekLine(week: RoadmapWeekView | null, block: RoadmapBlockView | null): string | null {
  return week?.focus ?? block?.purpose ?? null;
}

/**
 * A week's own words without a "Week 2 ·" the label already carries:
 * "Week 2 · Base volume" → { number: 2, name: "Base volume" }. The roadmap
 * used to print "Week 1 · Week 1 · Calibration".
 */
export function weekParts(w: Pick<RoadmapWeekView, "index" | "label">): { number: number; name: string | null } {
  const label = (w.label ?? "").trim();
  const m = label.match(/^week\s*(\d+)\s*(?:[·:|\-–—]\s*)?(.*)$/i);
  if (m) return { number: Number(m[1]), name: m[2].trim() || null };
  return { number: w.index, name: label || null };
}

export function ProgramRoadmapCard({
  roadmap,
  browseRoadmap,
  selectedBlockId,
  onSelectBlock,
  coach = false,
  onSelectProgram,
  onManage,
  nextProgramTo,
  onOpenPlan,
}: {
  /**
   * Opens the full-screen Training Plan (the Workouts page, Nov 25 2026): the
   * card is then only the summary, and no plan sheet is drawn.
   */
  onOpenPlan?: () => void;
  /** Today's program: what the card always shows. */
  roadmap: ProgramRoadmap | null;
  /** The program picked inside the plan sheet (another program, read-only); null = today's. */
  browseRoadmap?: ProgramRoadmap | null;
  /** The athlete's own program (one they started or built): Manage sits beside its name. */
  onManage?: () => void;
  /** A finished program of their own: its last row is the way to the next one. */
  nextProgramTo?: string;
  /** Look at another program in the plan sheet (read-only). null = back to the current one. */
  onSelectProgram?: (programId: string | null) => void;
  selectedBlockId?: string | null;
  /** Opens a block in Block View. */
  onSelectBlock?: (blockId: string) => void;
  /** Coach viewing an athlete: shows where to edit the words. */
  coach?: boolean;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [focusBlock, setFocusBlock] = useState<string | null>(null);
  if (!roadmap || !roadmap.blocks.length) return null;
  const { blocks } = roadmap;
  const current = blocks.find((b) => b.id === roadmap.currentBlockId) ?? null;
  const thisWeek = current?.weeks.find((w) => w.status === "current") ?? null;
  const allDone = blocks.every((b) => b.status === "completed");
  const multi = blocks.length > 1;
  const name = programHeading(roadmap.program, true);
  const progress = roadmapProgressParts(roadmap, todayLocalISO());
  const wk = thisWeek ? weekParts(thisWeek) : null;
  const focus = !allDone ? weekLine(thisWeek, current) : null;
  const open = (blockId: string | null) => {
    setFocusBlock(blockId);
    setSheetOpen(true);
  };

  // One line: where you are and what phase it is, then the meet (or the end).
  // Upcoming phases and every week's notes are the full plan's, one tap away.
  const phase = current && !allDone ? blockTitle(current) : null;
  return (
    <Card className="overflow-hidden p-0" aria-label="Your training program">
      <div className="px-4 pb-3.5 pt-3.5">
        <ActiveProgramHeader
          name={name}
          line={
            <span className="inline-flex flex-wrap items-center gap-x-1" data-program-line>
              {progress.where && <span>{progress.where}</span>}
              {phase && multi && (
                <>
                  {progress.where && <span aria-hidden>·</span>}
                  <span className="text-foreground/85" data-program-phase>{phase}</span>
                </>
              )}
              {progress.until && (
                <>
                  {(progress.where || (phase && multi)) && <span aria-hidden>·</span>}
                  {progress.meet && roadmap.meet ? (
                    <span className="inline-flex items-center gap-1" title={[roadmap.meet.name, fmt(roadmap.meet.date)].filter(Boolean).join(" · ")}>
                      <Flag className="h-3 w-3" aria-hidden /> {progress.until}
                    </span>
                  ) : (
                    <span>{progress.until}</span>
                  )}
                </>
              )}
            </span>
          }
          blocks={blocks}
          onManage={!(allDone && nextProgramTo) ? onManage : undefined}
        />
        {/* a one-block program has no phases to name: its week's focus, in one line */}
        {!allDone && !multi && (wk?.name || focus) && (
          <p className="mt-2.5 line-clamp-1 text-[13px] text-muted-foreground" data-roadmap-week>
            This week{wk?.name ? ` · ${wk.name}` : focus ? ` · ${focus}` : ""}
          </p>
        )}
      </div>

      {/* A finished program of their own: the way to the next one. */}
      {nextProgramTo && allDone ? (
        <Link
          to={nextProgramTo as any}
          className="flex min-h-12 w-full items-center justify-between gap-2 border-t border-border/60 px-4 py-3 text-[14px] font-semibold transition hover:bg-secondary/40"
          data-next-program
        >
          <span>Choose your next program</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Link>
      ) : (
        <button
          type="button"
          onClick={() => (onOpenPlan ? onOpenPlan() : open(current?.id ?? null))}
          className="flex min-h-11 w-full items-center justify-between gap-2 border-t border-border/60 px-4 py-2.5 text-[13px] font-medium transition hover:bg-secondary/40"
          data-roadmap-toggle
          data-open-training-plan={onOpenPlan ? "" : undefined}
        >
          {onOpenPlan ? <span>Training plan</span> : <span>Full plan</span>}
          <span className="inline-flex items-center gap-1 text-muted-foreground tabular-nums">
            {weeksLabel(roadmap.totalWeeks || blocks.reduce((a, b) => a + b.weekCount, 0))}
            <ChevronRight className="h-4 w-4" />
          </span>
        </button>
      )}

      {!onOpenPlan && (
      <ProgramPlanSheet
        open={sheetOpen}
        onOpenChange={(o) => {
          setSheetOpen(o);
          if (!o) onSelectProgram?.(null);
        }}
        roadmap={browseRoadmap ?? roadmap}
        currentProgramId={roadmap.defaultProgramId}
        focusBlockId={focusBlock}
        selectedBlockId={selectedBlockId ?? null}
        onSelectProgram={onSelectProgram}
        onOpenBlockView={
          onSelectBlock
            ? (id) => {
                setSheetOpen(false);
                onSelectProgram?.(null);
                onSelectBlock(id);
              }
            : undefined
        }
        coach={coach}
      />
      )}
    </Card>
  );
}

type PlanMode = "focus" | "list";
const PLAN_MODE_KEY = "jf-plan-view";

function readPlanMode(): PlanMode {
  try {
    return window.localStorage.getItem(PLAN_MODE_KEY) === "list" ? "list" : "focus";
  } catch {
    return "focus";
  }
}

/** One week of the plan, numbered across the whole program (week 7 of 12, not block 2 week 1). */
export type PlanWeek = { n: number; blockNo: number; block: RoadmapBlockView; week: RoadmapWeekView };

export function planWeeks(roadmap: Pick<ProgramRoadmap, "blocks">): PlanWeek[] {
  let n = 0;
  return roadmap.blocks.flatMap((block, i) => block.weeks.map((week) => ({ n: ++n, blockNo: i + 1, block, week })));
}

/** The week the plan opens on: this week, else the block asked for, else the next week to come, else the last. */
export function planStartIndex(weeks: PlanWeek[], focusBlockId: string | null): number {
  if (!weeks.length) return 0;
  const now = weeks.findIndex((w) => w.week.status === "current");
  if (focusBlockId) {
    const inBlock = weeks.findIndex((w) => w.block.id === focusBlockId && w.week.status === "current");
    if (inBlock >= 0) return inBlock;
    const first = weeks.findIndex((w) => w.block.id === focusBlockId);
    if (first >= 0 && now < 0) return first;
  }
  if (now >= 0) return now;
  const next = weeks.findIndex((w) => w.week.status === "upcoming");
  return next >= 0 ? next : weeks.length - 1;
}

/** "Nov 23 – 29", "Dec 28 – Jan 3": a week's dates, short. */
export function weekRange(start: string | null, end: string | null): string | null {
  const a = parseLocalDate(start);
  const b = parseLocalDate(end);
  if (!a) return null;
  if (!b) return format(a, "MMM d");
  return a.getMonth() === b.getMonth() ? `${format(a, "MMM d")} – ${format(b, "d")}` : `${format(a, "MMM d")} – ${format(b, "MMM d")}`;
}

function WeekStatus({ week, dated = false }: { week: RoadmapWeekView; dated?: boolean }) {
  if (week.status === "completed")
    return (
      <span className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-muted-foreground" data-plan-status="done">
        <Check className="h-3.5 w-3.5" /> Done
      </span>
    );
  if (week.status === "current")
    return <span className="shrink-0 rounded-full bg-foreground px-2 py-0.5 text-[11px] font-semibold text-background" data-plan-status="now">This week</span>;
  // a week whose dates are already on screen (Focus) says nothing more
  if (dated) return null;
  return <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground" data-plan-status="later">{week.start ? `Starts ${fmt(week.start)}` : ""}</span>;
}

/**
 * The whole plan, written for the athlete. Focus (the default) is one week at a time: where it
 * sits, what it's called and one plain sentence, stepped with ‹ › , a swipe or the strip of weeks.
 * List is every week in one line each, grouped by block, a tap opening that week in Focus. The
 * choice is remembered on the phone. Opening it never changes the schedule.
 */
function ProgramPlanSheet({
  open,
  onOpenChange,
  roadmap,
  currentProgramId,
  focusBlockId,
  selectedBlockId,
  onSelectProgram,
  onOpenBlockView,
  coach,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roadmap: ProgramRoadmap;
  currentProgramId: string;
  focusBlockId: string | null;
  selectedBlockId: string | null;
  onSelectProgram?: (id: string | null) => void;
  onOpenBlockView?: (blockId: string) => void;
  coach: boolean;
}) {
  const browsing = roadmap.program.id !== currentProgramId;
  const name = programHeading(roadmap.program, !browsing);
  const progress = roadmapProgressParts(roadmap, todayLocalISO());
  const editBlock = selectedBlockId ?? roadmap.currentBlockId ?? roadmap.blocks[0]?.id ?? null;
  const weeks = useMemo(() => planWeeks(roadmap), [roadmap]);
  const [mode, setModeState] = useState<PlanMode>("focus");
  const [at, setAt] = useState(0);
  // each time it opens: the mode they last used, on this week
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const openKey = open ? `${roadmap.program.id}:${focusBlockId ?? ""}` : null;
  if (openKey !== openedFor) {
    setOpenedFor(openKey);
    if (openKey) {
      setModeState(readPlanMode());
      setAt(planStartIndex(weeks, focusBlockId));
    }
  }
  const setMode = (m: PlanMode) => {
    setModeState(m);
    try {
      window.localStorage.setItem(PLAN_MODE_KEY, m);
    } catch {
      // the choice just isn't remembered
    }
  };
  const showWeek = (i: number) => {
    setAt(i);
    setMode("focus");
  };
  const multi = roadmap.blocks.length > 1;
  const line = [
    !browsing ? progress.where : weeksLabel(roadmap.totalWeeks),
    roadmap.meet ? `Meet ${fmt(roadmap.meet.date)}` : roadmap.end ? `Ends ${fmt(roadmap.end)}` : null,
  ].filter(Boolean).join(" · ");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        swipeToClose
        hideCloseButton
        className="max-h-[90dvh] overflow-y-auto rounded-t-[24px] p-0 sm:mx-auto sm:max-w-lg"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="mx-auto max-w-lg px-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-2" data-plan-sheet data-plan-mode={mode}>
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted-foreground/30" aria-hidden />
          {/* the app's bottom-sheet header: the program on the left, Done on the right */}
          <div className="flex items-start gap-3">
            <SheetHeader className="min-h-0 min-w-0 flex-1 space-y-0.5 p-0 text-left">
              <SheetTitle className="break-words text-[20px] font-semibold leading-tight">{name}</SheetTitle>
              {line && <SheetDescription className="text-[13px] tabular-nums">{line}</SheetDescription>}
            </SheetHeader>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="-mr-1 inline-flex h-10 shrink-0 items-center rounded-full px-3 text-[15px] font-semibold text-foreground transition hover:bg-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-plan-done
            >
              Done
            </button>
          </div>
          {browsing && (
            <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-secondary/60 px-3 py-2 text-[12px] text-muted-foreground">
              <span className="inline-flex items-center gap-1"><Eye className="h-3.5 w-3.5" /> Viewing only. Your schedule is unchanged.</span>
              <button type="button" onClick={() => onSelectProgram?.(null)} className="shrink-0 font-semibold text-foreground">Current</button>
            </div>
          )}

          {weeks.length > 0 && (
            <div className="mt-3 grid grid-cols-2 rounded-lg bg-secondary/70 p-0.5 text-[13px] font-medium" role="group" aria-label="How to show the plan" data-plan-modes>
              {(["focus", "list"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={mode === m}
                  onClick={() => setMode(m)}
                  className={cn("min-h-9 rounded-md transition", mode === m ? "bg-background text-foreground shadow-sm" : "text-muted-foreground")}
                  data-plan-mode-button={m}
                >
                  {m === "focus" ? "Focus" : "List"}
                </button>
              ))}
            </div>
          )}

          {weeks.length > 0 && mode === "focus" ? (
            <PlanFocus
              weeks={weeks}
              at={Math.min(at, weeks.length - 1)}
              onAt={setAt}
              total={Math.max(weeks.length, roadmap.totalWeeks || 0)}
              multi={multi}
              blockCount={roadmap.blocks.length}
              onOpenBlockView={!browsing ? onOpenBlockView : undefined}
            />
          ) : (
            <PlanList roadmap={roadmap} weeks={weeks} onWeek={weeks.length ? showWeek : undefined} />
          )}

          {mode === "list" && roadmap.programs.length > 1 && onSelectProgram && (
            <div className="mt-6">
              <div className="mb-1 text-[13px] font-medium text-muted-foreground">Your programs</div>
              <ProgramList programs={roadmap.programs} selectedId={roadmap.program.id} defaultId={currentProgramId} onSelect={(id) => onSelectProgram(id === currentProgramId ? null : id)} />
            </div>
          )}

          {coach && (
            <div className="mt-5 flex items-center justify-between gap-2 border-t border-border/60 pt-3 text-[12px] text-muted-foreground">
              <span className="inline-flex min-w-0 items-center gap-1">
                <span className="truncate">Written from the program in plain words. Your words always win.</span>
              </span>
              {editBlock && (
                <Link to="/admin/blocks/$blockId" params={{ blockId: editBlock }} hash="roadmap" className="inline-flex shrink-0 items-center gap-1 font-semibold text-foreground hover:underline">
                  <Pencil className="h-3 w-3" /> Edit
                </Link>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** One week at a time: the strip of weeks, then this week in a sentence, ‹ › to move. */
export function PlanFocus({
  weeks,
  at,
  onAt,
  total,
  multi,
  blockCount,
  onOpenBlockView,
}: {
  weeks: PlanWeek[];
  at: number;
  onAt: (i: number) => void;
  total: number;
  multi: boolean;
  blockCount: number;
  onOpenBlockView?: (blockId: string) => void;
}) {
  const cur = weeks[at];
  const [touch, setTouch] = useState<{ x: number; y: number } | null>(null);
  const go = (d: number) => onAt(Math.max(0, Math.min(weeks.length - 1, at + d)));
  const p = weekParts(cur.week);
  const title = p.name ?? `Week ${cur.n}`;
  const dates = weekRange(cur.week.start, cur.week.end);
  const blockName = blockTitle(cur.block);
  return (
    <div className="mt-4" data-plan-focus>
      {/* every week of the program, one tap each; a gap between blocks */}
      <div className="flex items-center gap-0.5" role="group" aria-label="Weeks" data-plan-strip>
        {weeks.map((w, i) => {
          const newBlock = i > 0 && weeks[i - 1].block.id !== w.block.id;
          const selected = i === at;
          return (
            <button
              key={w.week.id}
              type="button"
              onClick={() => onAt(i)}
              aria-label={`Week ${w.n} of ${total}${w.week.status === "current" ? ", this week" : ""}`}
              aria-current={selected ? "step" : undefined}
              className={cn("flex h-8 min-w-0 flex-1 items-center", newBlock && "ml-1.5")}
              data-plan-strip-week={w.n}
            >
              <span
                className={cn(
                  "block w-full rounded-full transition-all",
                  selected ? "h-2.5" : "h-1.5",
                  w.week.status === "completed" ? "bg-foreground/55" : w.week.status === "current" ? "bg-foreground" : "bg-muted-foreground/25",
                  selected && w.week.status !== "current" && "bg-foreground/80",
                )}
              />
            </button>
          );
        })}
      </div>

      <div
        className="mt-2 rounded-2xl border border-border/70 bg-card p-4"
        onTouchStart={(e) => setTouch({ x: e.touches[0].clientX, y: e.touches[0].clientY })}
        onTouchEnd={(e) => {
          if (!touch) return;
          const dx = e.changedTouches[0].clientX - touch.x;
          const dy = e.changedTouches[0].clientY - touch.y;
          setTouch(null);
          if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
        }}
        data-plan-week={cur.n}
      >
        {(multi || cur.block.label) && (
          <div className="text-[12px] font-medium text-muted-foreground" data-plan-block-line>
            {multi ? `Block ${cur.blockNo} of ${blockCount}` : "This block"}
            {blockName ? ` · ${blockName}` : ""}
          </div>
        )}
        <div className="mt-2 flex min-h-6 items-center justify-between gap-2">
          {/* a week with no name of its own yet is titled "Week 7" below: its number isn't said twice */}
          <span className="text-[13px] tabular-nums text-muted-foreground" data-plan-week-when>
            {[p.name ? `Week ${cur.n}` : null, dates].filter(Boolean).join(" · ")}
          </span>
          <WeekStatus week={cur.week} dated={!!dates} />
        </div>
        <h3 className="mt-1 text-[22px] font-semibold leading-tight tracking-tight" data-plan-week-title>{title}</h3>
        {cur.week.focus && <p className="mt-1.5 text-[15px] leading-snug text-foreground/85" data-plan-week-focus>{cur.week.focus}</p>}
        {cur.block.purpose && cur.week.index === 1 && (
          <p className="mt-3 border-t border-border/60 pt-3 text-[13px] leading-snug text-muted-foreground" data-plan-block-purpose>
            {cur.block.purpose}
          </p>
        )}
        {onOpenBlockView && (
          <button type="button" onClick={() => onOpenBlockView(cur.block.id)} className="mt-2 inline-flex min-h-10 items-center gap-0.5 text-[14px] font-medium text-foreground">
            See the workouts <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </button>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => go(-1)}
          disabled={at === 0}
          className="inline-flex min-h-11 items-center justify-center gap-1 rounded-lg border border-border text-[14px] font-medium transition disabled:opacity-40"
          data-plan-prev
        >
          <ChevronLeft className="h-4 w-4" /> Previous week
        </button>
        <button
          type="button"
          onClick={() => go(1)}
          disabled={at === weeks.length - 1}
          className="inline-flex min-h-11 items-center justify-center gap-1 rounded-lg border border-border text-[14px] font-medium transition disabled:opacity-40"
          data-plan-next
        >
          Next week <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/** Every week in one line, grouped by block. A tap opens that week in Focus. */
export function PlanList({ roadmap, weeks, onWeek }: { roadmap: ProgramRoadmap; weeks: PlanWeek[]; onWeek?: (i: number) => void }) {
  const multi = roadmap.blocks.length > 1;
  // a long program opens on this week, not at its first block
  const listRef = useRef<HTMLOListElement>(null);
  const nowId = weeks.find((w) => w.week.status === "current")?.week.id ?? null;
  useEffect(() => {
    const row = nowId ? listRef.current?.querySelector<HTMLElement>('[data-plan-now="true"]') : null;
    if (row && typeof row.scrollIntoView === "function") row.scrollIntoView({ block: "center" });
  }, [nowId]);
  return (
    <ol ref={listRef} className="mt-4 space-y-4" aria-label="Blocks" data-plan-list>
      {roadmap.blocks.map((b, bi) => (
        <li key={b.id} data-plan-block={b.id}>
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="min-w-0 text-[14px] font-semibold">
              {multi ? `Block ${bi + 1}` : "This block"}
              {blockTitle(b) ? <span className="font-normal text-muted-foreground"> · {blockTitle(b)}</span> : null}
            </h3>
            <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">{rangeLabel(b.start, b.end)}</span>
          </div>
          {b.weeks.length > 0 && (
            <ul className="mt-1.5 divide-y divide-border/50 overflow-hidden rounded-xl border border-border/60">
              {b.weeks.map((w) => {
                const i = weeks.findIndex((x) => x.week.id === w.id);
                const pw = weeks[i];
                const p = weekParts(w);
                const row = (
                  <>
                    <span className="w-16 shrink-0 text-[13px] tabular-nums text-muted-foreground">Week {pw?.n ?? p.number}</span>
                    <span className={cn("min-w-0 flex-1 truncate text-[14px]", w.status === "current" ? "font-semibold" : "font-medium")}>{p.name ?? ""}</span>
                    <WeekStatus week={w} />
                    {onWeek && i >= 0 && <ChevronRight className="-mr-1 h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden />}
                  </>
                );
                return (
                  <li key={w.id} className={cn(w.status === "current" && "bg-secondary/60")} data-plan-now={w.status === "current" ? "true" : undefined}>
                    {onWeek && i >= 0 ? (
                      <button type="button" onClick={() => onWeek(i)} className="flex min-h-11 w-full items-center gap-2 px-3 text-left transition hover:bg-secondary/40" data-plan-list-week={pw.n}>
                        {row}
                      </button>
                    ) : (
                      <div className="flex min-h-11 items-center gap-2 px-3">{row}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}

/**
 * The program on their calendar, as a heading: its name (the program picker
 * when there's more than one), Manage beside it for a program that's theirs,
 * one progress line ("Week 5 of 12 · Ends Jan 10") and one bar. The Workouts
 * card and the Programs page's "On your calendar" share it, so the program
 * reads the same in both.
 */
export function ActiveProgramHeader({
  name,
  eyebrow,
  line,
  blocks,
  badge,
  picker,
  onManage,
}: {
  name: string;
  /** Where it came from, in small type over the name (the Programs page). */
  eyebrow?: string | null;
  line?: ReactNode;
  /** The bar: a segment per block, filled up to this week. */
  blocks?: RoadmapBlockView[];
  /** "Past" / "Upcoming" while looking at another program. */
  badge?: string | null;
  /** The name opens the program list. */
  picker?: { open: boolean; onToggle: () => void };
  onManage?: () => void;
}) {
  const title = (
    <span className="line-clamp-2 break-words text-[17px] font-semibold leading-snug tracking-tight" data-program-name>
      {name}
    </span>
  );
  return (
    <div>
      {/* The name and Manage share the first row; the progress line runs the
          card's full width under them, so it never wraps beside the button. */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3">
        <div className="min-w-0">
          {eyebrow && <div className="mb-0.5 truncate text-[12px] font-medium text-muted-foreground" data-program-origin>{eyebrow}</div>}
          <div className="flex items-start gap-1.5">
            {picker ? (
              <button
                type="button"
                onClick={picker.onToggle}
                aria-expanded={picker.open}
                aria-label="Choose a program"
                className="-mx-1 flex min-w-0 items-start gap-1 rounded-md px-1 text-left transition hover:bg-secondary/50"
              >
                {title}
                <ChevronDown className={cn("mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform", picker.open && "rotate-180")} />
              </button>
            ) : (
              title
            )}
            {badge && (
              <span className="mt-0.5 shrink-0 rounded bg-secondary px-1.5 text-[11px] font-medium leading-5 text-muted-foreground">{badge}</span>
            )}
          </div>
        </div>
        {onManage ? (
          <button
            type="button"
            onClick={onManage}
            // 32px to look at, 44px to tap
            className="relative inline-flex h-8 shrink-0 items-center gap-1.5 self-start rounded-full bg-secondary px-3 text-[13px] font-semibold text-foreground transition before:absolute before:-inset-x-1 before:-inset-y-1.5 before:content-[''] hover:bg-secondary/80 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-manage-program
          >
            <Settings2 className="h-4 w-4" aria-hidden />
            Manage
          </button>
        ) : (
          <span aria-hidden />
        )}
        {line && (
          <div className="col-span-2 mt-0.5 text-[13px] text-muted-foreground tabular-nums" data-program-progress>
            {line}
          </div>
        )}
      </div>
      {blocks && blocks.length > 0 && <ProgramBar blocks={blocks} />}
    </div>
  );
}

/**
 * What the heading calls a program: its short name ("Apex Hypertrophy", not
 * the level and days after it); with no name at all, today's program is
 * "Your program" and another one is named by when it started.
 */
export function programHeading(p: ProgramSummary, isCurrent = true): string {
  return programShortName(p.title) ?? (isCurrent ? "Your program" : programName(p));
}

/** A block by its own name: the roadmap's label, else the coach's name without its "Block N —". */
function blockTitle(b: RoadmapBlockView): string {
  return b.label ?? blockNameParts(b.name)?.name ?? b.name;
}

/**
 * The program in one bar: a segment per block (sized by its weeks), filled up
 * to and including this week, in one neutral ink. One indicator, not a bar
 * plus week pills, and no red or green: it's progress, not a status.
 */
export function ProgramBar({ blocks }: { blocks: RoadmapBlockView[] }) {
  return (
    <div className="mt-3 flex gap-1" aria-hidden data-roadmap-bar>
      {blocks.map((b) => {
        const elapsed = b.weeks.filter((w) => w.status !== "upcoming").length;
        const pct = b.status === "completed" ? 100 : b.status === "upcoming" ? 0 : Math.round((Math.max(1, elapsed) / Math.max(1, b.weekCount)) * 100);
        return (
          <div key={b.id} className="h-1.5 overflow-hidden rounded-full bg-muted-foreground/20" style={{ flexGrow: Math.max(1, b.weekCount), flexBasis: 0 }}>
            <div className="h-full rounded-full bg-foreground" style={{ width: `${pct}%` }} />
          </div>
        );
      })}
    </div>
  );
}

export function programName(p: ProgramSummary): string {
  return p.title ?? (p.start ? `Program from ${fmt(p.start, "MMM yyyy")}` : "Program");
}

/** The programs to look at, under the card's header. Picking one only changes what this card shows. */
function ProgramList({
  programs, selectedId, defaultId, onSelect,
}: {
  programs: ProgramSummary[];
  selectedId: string;
  defaultId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <ul className="space-y-0.5" role="listbox" aria-label="Programs">
      {programs.map((p) => {
        const isSel = p.id === selectedId;
        return (
          <li key={p.id}>
            <button
              type="button"
              role="option"
              aria-selected={isSel}
              onClick={() => onSelect(p.id)}
              className={cn(
                "flex min-h-[44px] w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-secondary/50",
                isSel && "bg-secondary/70",
              )}
            >
              {p.status === "completed" ? (
                <Archive className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <span className={cn("h-2 w-2 shrink-0 rounded-full", p.status === "active" ? "bg-foreground" : "bg-muted-foreground/40")} />
              )}
              <span className="min-w-0 flex-1">
                <span className={cn("block truncate text-[13px] font-semibold", p.status === "completed" && "text-foreground/75")}>
                  {programName(p)}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground tabular-nums">
                  {p.blockCount} block{p.blockCount === 1 ? "" : "s"} · {weeksLabel(p.totalWeeks)}
                  {p.start ? ` · ${rangeLabel(p.start, p.end)}` : ""}
                  {p.id === defaultId ? " · current" : ""}
                </span>
              </span>
              {isSel && <Check className="h-4 w-4 shrink-0 text-foreground" />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
