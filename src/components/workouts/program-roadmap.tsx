import { useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Archive, Check, ChevronDown, ChevronRight, Eye, Flag, Pencil, Settings2, Sparkles } from "lucide-react";
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
}: {
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

  return (
    <Card className="overflow-hidden p-0" aria-label="Your training program">
      <div className="px-4 pb-3 pt-3.5">
        <ActiveProgramHeader
          name={name}
          line={
            progress.meet && roadmap.meet ? (
              <span className="inline-flex flex-wrap items-center gap-x-1" title={[roadmap.meet.name, fmt(roadmap.meet.date)].filter(Boolean).join(" · ")}>
                {progress.where && <>{progress.where} <span aria-hidden>·</span></>}
                <Flag className="h-3 w-3" aria-hidden /> {progress.until}
              </span>
            ) : (
              [progress.where, progress.until].filter(Boolean).join(" · ")
            )
          }
          blocks={blocks}
          onManage={!(allDone && nextProgramTo) ? onManage : undefined}
        />

        {/* This week, in the coach's (or Cleo's) words: what today's training is for. */}
        {!allDone && (wk || focus) && !multi && (
          <div className="mt-3" data-roadmap-now>
            <p className="text-[14px] font-medium text-foreground" data-roadmap-week>
              This week{wk?.name ? ` · ${wk.name}` : ""}
            </p>
            {focus && <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-muted-foreground">{focus}</p>}
          </div>
        )}
      </div>

      {/* The phases, always in view: done, now (with this week), what's next. A tap opens the full plan there. */}
      {multi && (
        <ol className="border-t border-border/60 px-2 py-1" aria-label="Blocks in this program" data-roadmap-timeline>
          {blocks.map((b, i) => {
            const isNow = b.id === current?.id && !allDone;
            return (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => open(b.id)}
                  className={cn("flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-secondary/40 active:bg-secondary/60", isNow && "py-2.5")}
                  data-roadmap-block={b.status}
                >
                  <span
                    className={cn(
                      "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold tabular-nums",
                      b.status === "completed" && "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
                      b.status === "current" && "bg-foreground text-background",
                      b.status === "upcoming" && "border border-border text-muted-foreground",
                    )}
                    aria-hidden
                  >
                    {b.status === "completed" ? <Check className="h-3 w-3" /> : i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className={cn("truncate text-[14px]", isNow ? "font-semibold text-foreground" : b.status === "completed" ? "text-muted-foreground" : "text-foreground/85")}>
                        {blockTitle(b)}
                      </span>
                      <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">
                        {isNow ? "Now" : b.status === "completed" ? "Done" : fmt(b.start) ?? weeksLabel(b.weekCount)}
                      </span>
                    </span>
                    {isNow && (wk || focus) && (
                      <span className="mt-1 block" data-roadmap-now>
                        <span className="block text-[13px] font-medium text-foreground/90" data-roadmap-week>
                          This week{wk?.name ? ` · ${wk.name}` : wk ? ` · week ${wk.number}` : ""}
                        </span>
                        {focus && <span className="mt-0.5 line-clamp-2 block text-[13px] leading-snug text-muted-foreground">{focus}</span>}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}

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
          onClick={() => open(current?.id ?? null)}
          className="flex min-h-11 w-full items-center justify-between gap-2 border-t border-border/60 px-4 py-2.5 text-[13px] font-medium transition hover:bg-secondary/40"
          data-roadmap-toggle
        >
          <span>Full plan</span>
          <span className="inline-flex items-center gap-1 text-muted-foreground tabular-nums">
            {weeksLabel(roadmap.totalWeeks || blocks.reduce((a, b) => a + b.weekCount, 0))}
            <ChevronRight className="h-4 w-4" />
          </span>
        </button>
      )}

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
    </Card>
  );
}

/**
 * The whole plan in one place: every block with every week and what it's
 * for, all in view (no folds), and other programs to look back at. Opening
 * one never changes the schedule.
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
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        swipeToClose
        className="max-h-[90dvh] overflow-y-auto rounded-t-2xl p-0"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          if (!focusBlockId) return;
          window.setTimeout(() => {
            document.querySelector(`[data-plan-block="${focusBlockId}"]`)?.scrollIntoView({ block: "start" });
          }, 60);
        }}
      >
        <div className="mx-auto max-w-lg px-4 pb-8 pt-3">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted-foreground/30" aria-hidden />
          <SheetHeader className="text-left">
            <SheetTitle className="text-lg leading-snug">{name}</SheetTitle>
            <SheetDescription className="text-[13px]">
              {[
                weeksLabel(roadmap.totalWeeks),
                rangeLabel(roadmap.start, roadmap.end) || null,
                !browsing ? progress.where : null,
                roadmap.meet ? `Meet ${fmt(roadmap.meet.date, "MMM d")}` : null,
              ].filter(Boolean).join(" · ")}
            </SheetDescription>
          </SheetHeader>
          {browsing && (
            <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-secondary/60 px-3 py-2 text-[12px] text-muted-foreground">
              <span className="inline-flex items-center gap-1"><Eye className="h-3.5 w-3.5" /> Viewing only. Your schedule is unchanged.</span>
              <button type="button" onClick={() => onSelectProgram?.(null)} className="shrink-0 font-semibold text-foreground">Current</button>
            </div>
          )}

          <ol className="mt-4 space-y-5" aria-label="Blocks">
            {roadmap.blocks.map((b, i) => (
              <li key={b.id} data-plan-block={b.id} className="scroll-mt-4">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="min-w-0 text-[15px] font-semibold">
                    <span className="mr-1.5 text-muted-foreground tabular-nums">{i + 1}</span>
                    {blockTitle(b)}
                    {b.status === "current" && <span className="ml-2 rounded bg-secondary px-1.5 align-middle text-[11px] font-medium">Now</span>}
                  </h3>
                  <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">{rangeLabel(b.start, b.end)}</span>
                </div>
                {b.purpose && <p className="mt-1 text-[13px] leading-snug text-foreground/80">{b.purpose}</p>}
                {b.weeks.length > 0 && (
                  <ul className="mt-2 divide-y divide-border/50 rounded-xl border border-border/60">
                    {b.weeks.map((w) => {
                      const p = weekParts(w);
                      return (
                        <li key={w.id} className={cn("px-3 py-2", w.status === "current" && "bg-secondary/50")}>
                          <div className="flex items-center justify-between gap-2 text-[13px]">
                            <span className="min-w-0 truncate font-medium">
                              Week {p.number}{p.name ? ` · ${p.name}` : ""}
                            </span>
                            <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">
                              {w.status === "completed" ? "Done" : w.status === "current" ? "This week" : fmt(w.start) ?? ""}
                            </span>
                          </div>
                          {w.focus && <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{w.focus}</p>}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {onOpenBlockView && !browsing && (
                  <button type="button" onClick={() => onOpenBlockView(b.id)} className="mt-1 inline-flex min-h-10 items-center gap-0.5 text-[13px] font-medium text-foreground">
                    See its workouts <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                )}
              </li>
            ))}
          </ol>

          {roadmap.programs.length > 1 && onSelectProgram && (
            <div className="mt-6">
              <div className="mb-1 text-[13px] font-medium text-muted-foreground">Your programs</div>
              <ProgramList programs={roadmap.programs} selectedId={roadmap.program.id} defaultId={currentProgramId} onSelect={(id) => onSelectProgram(id === currentProgramId ? null : id)} />
            </div>
          )}

          {coach && (
            <div className="mt-5 flex items-center justify-between gap-2 border-t border-border/60 pt-3 text-[12px] text-muted-foreground">
              <span className="inline-flex min-w-0 items-center gap-1">
                <Sparkles className="h-3 w-3 shrink-0" /> <span className="truncate">Notes are written by Cleo from the program. Yours always win.</span>
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
function ProgramBar({ blocks }: { blocks: RoadmapBlockView[] }) {
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
