/**
 * The Training Plan, full screen (opened from the Program card): the program
 * as a timeline, Program → Block → Week → Workout (training-plan.ts). The
 * block today falls in is open, the others one tap; inside a block its weeks
 * (numbered across the program, with dates, its own name and "N of M done"),
 * inside a week its workouts by day with their status. A meet's countdown sits
 * under the program. A block's "Every exercise" opens Block View (the coach's
 * prescriptions, `ClientBlockView`) in place. Old programs are their own
 * Training history at the end (read-only), then Programs (build, import,
 * crew, my programs). Nothing here changes the schedule.
 */
import { useMemo, useState, type ReactNode } from "react";
import { format } from "date-fns";
import { Check, ChevronDown, ChevronRight, Eye, Flag, ListChecks } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseLocalDate, todayLocalISO } from "@/lib/today";
import { meetWords, roadmapProgressParts, type ProgramRoadmap } from "@/lib/training-roadmap";
import { buildPlanTimeline, type PlanBlockRow, type PlanEntry, type PlanWeekRow } from "@/lib/workouts/training-plan";
import { WorkoutStatusMark } from "@/components/workouts/workout-status-mark";
import { ProgramBar, programHeading, programName, weekRange } from "@/components/workouts/program-roadmap";

const fmt = (iso: string | null, f = "MMM d") => {
  const d = parseLocalDate(iso);
  return d ? format(d, f) : null;
};

const KIND_WORD: Record<NonNullable<PlanEntry["kind"]>, string | null> = {
  done: "Done",
  missed: "Missed",
  progress: "In progress",
  scheduled: null,
  skipped: "Skipped",
};

export function TrainingPlanPage({
  roadmap,
  browsing,
  entries,
  onOpenWorkout,
  onOpenBlock,
  onSelectProgram,
  history,
  programs,
  coachEdit,
}: {
  /** the program shown (today's, or another one being looked at) */
  roadmap: ProgramRoadmap;
  /** another program than today's: read-only, says so */
  browsing: boolean;
  entries: PlanEntry[];
  onOpenWorkout: (e: PlanEntry) => void;
  /** Every exercise in a block (Block View); only for today's program */
  onOpenBlock?: (blockId: string) => void;
  /** look at another program (null = back to today's) */
  onSelectProgram?: (id: string | null) => void;
  /** past programs that live elsewhere (a coaching client's archive, a member's Program history) */
  history?: ReactNode;
  /** Programs: build, import, crew, my programs */
  programs?: ReactNode;
  coachEdit?: ReactNode;
}) {
  const today = todayLocalISO();
  const timeline = useMemo(() => buildPlanTimeline(roadmap, entries), [roadmap, entries]);
  // what's open is kept per program for the visit
  const [openBlocks, setOpenBlocks] = useState<Record<string, boolean>>({});
  const [openWeeks, setOpenWeeks] = useState<Record<string, boolean>>({});
  const blockOpen = (id: string) => openBlocks[id] ?? id === timeline.openBlockId;
  const weekOpen = (id: string) => openWeeks[id] ?? id === timeline.openWeekId;
  const progress = roadmapProgressParts(roadmap, today);
  const meet = roadmap.meet && roadmap.meet.daysOut >= 0 ? roadmap.meet : null;
  const past = roadmap.programs.filter((p) => p.status === "completed" && p.id !== roadmap.defaultProgramId);

  return (
    <div className="space-y-5" data-training-plan>
      {browsing && (
        <div className="flex items-center justify-between gap-2 rounded-xl bg-secondary/60 px-3 py-2 text-[13px] text-muted-foreground" data-plan-browsing>
          <span className="inline-flex items-center gap-1.5"><Eye className="h-4 w-4" aria-hidden /> Viewing only. Your schedule is unchanged.</span>
          <button type="button" onClick={() => onSelectProgram?.(null)} className="h-9 shrink-0 font-semibold text-foreground">Current</button>
        </div>
      )}

      {/* the program: where you are, one bar, the meet */}
      <section>
        <h2 className="text-[20px] font-bold leading-tight">{programHeading(roadmap.program, !browsing)}</h2>
        <p className="mt-0.5 text-[13px] tabular-nums text-muted-foreground">
          {[progress.where, `${timeline.blocks.length} block${timeline.blocks.length === 1 ? "" : "s"}`, timeline.planned ? `${timeline.done} of ${timeline.planned} workouts done` : null].filter(Boolean).join(" · ")}
        </p>
        {timeline.blocks.length > 0 && <ProgramBar blocks={roadmap.blocks} />}
        {meet && (
          <div className="mt-3 flex items-center gap-3 rounded-xl border border-border px-3 py-2.5" data-plan-meet>
            <Flag className="h-4 w-4 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-semibold">{meet.name ?? "Competition"}</div>
              <div className="text-[12.5px] text-muted-foreground">{fmt(meet.date, "EEE, MMM d")}</div>
            </div>
            <div className="shrink-0 text-[14px] font-semibold tabular-nums">{meetWords(meet.daysOut)}</div>
          </div>
        )}
      </section>

      {/* the timeline */}
      <ol className="relative space-y-2" aria-label="Blocks" data-plan-timeline>
        {timeline.blocks.map((b) => (
          <BlockRow
            key={b.id}
            block={b}
            open={blockOpen(b.id)}
            onToggle={() => setOpenBlocks((s) => ({ ...s, [b.id]: !blockOpen(b.id) }))}
            weekOpen={weekOpen}
            onToggleWeek={(id) => setOpenWeeks((s) => ({ ...s, [id]: !weekOpen(id) }))}
            onOpenWorkout={onOpenWorkout}
            onOpenBlock={!browsing ? onOpenBlock : undefined}
            today={today}
          />
        ))}
      </ol>

      {coachEdit}

      {/* Training history: old programs, apart from today's */}
      {(past.length > 0 || history) && (
        <section data-plan-history>
          <h3 className="mb-1 text-[15px] font-semibold">Training history</h3>
          {past.length > 0 && onSelectProgram && (
            <ul className="divide-y divide-border/60">
              {past.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => onSelectProgram(p.id)}
                    className={cn("flex min-h-12 w-full items-center gap-2 py-2 text-left", roadmap.program.id === p.id && "font-semibold")}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px]">{programName(p)}</span>
                      <span className="block truncate text-[12px] tabular-nums text-muted-foreground">
                        {[`${p.blockCount} block${p.blockCount === 1 ? "" : "s"}`, `${p.totalWeeks} weeks`, p.start ? [fmt(p.start), fmt(p.end)].filter(Boolean).join(" – ") : null].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {history}
        </section>
      )}

      {programs}
    </div>
  );
}

function BlockRow({
  block,
  open,
  onToggle,
  weekOpen,
  onToggleWeek,
  onOpenWorkout,
  onOpenBlock,
  today,
}: {
  block: PlanBlockRow;
  open: boolean;
  onToggle: () => void;
  weekOpen: (id: string) => boolean;
  onToggleWeek: (id: string) => void;
  onOpenWorkout: (e: PlanEntry) => void;
  onOpenBlock?: (blockId: string) => void;
  today: string;
}) {
  const now = block.status === "current";
  const dates = [fmt(block.start), fmt(block.end)].filter(Boolean).join(" – ");
  return (
    <li className={cn("rounded-2xl border", now ? "border-foreground/25" : "border-border")} data-plan-block={block.id} data-plan-block-status={block.status}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left">
        <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-semibold tabular-nums", block.status === "completed" ? "bg-muted text-muted-foreground" : now ? "bg-foreground text-background" : "border border-border text-muted-foreground")} aria-hidden>
          {block.status === "completed" ? <Check className="h-3.5 w-3.5" /> : block.no}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold">{block.title}</span>
          <span className="block truncate text-[12.5px] tabular-nums text-muted-foreground">
            {[`Block ${block.no}`, dates || null, `${block.weeks.length} week${block.weeks.length === 1 ? "" : "s"}`, block.planned ? `${block.done} of ${block.planned} done` : null].filter(Boolean).join(" · ")}
          </span>
        </span>
        {now && <span className="shrink-0 text-[12px] font-semibold">Now</span>}
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div className="border-t border-border/60 px-2 pb-2 pt-1">
          {block.purpose && <p className="px-2 pb-1 pt-1.5 text-[13px] text-muted-foreground">{block.purpose}</p>}
          <ol aria-label={`Weeks of ${block.title}`}>
            {block.weeks.map((w) => (
              <WeekRow key={w.id} week={w} open={weekOpen(w.id)} onToggle={() => onToggleWeek(w.id)} onOpenWorkout={onOpenWorkout} today={today} />
            ))}
          </ol>
          {onOpenBlock && (
            <button type="button" onClick={() => onOpenBlock(block.id)} className="mt-1 flex min-h-11 w-full items-center gap-2 rounded-xl px-2 text-[13.5px] font-medium hover:bg-muted/50" data-plan-block-detail>
              <ListChecks className="h-4 w-4 text-muted-foreground" aria-hidden />
              <span className="flex-1 text-left">Every exercise in this block</span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function WeekRow({
  week,
  open,
  onToggle,
  onOpenWorkout,
  today,
}: {
  week: PlanWeekRow;
  open: boolean;
  onToggle: () => void;
  onOpenWorkout: (e: PlanEntry) => void;
  today: string;
}) {
  const now = week.status === "current";
  const range = weekRange(week.start, week.end);
  return (
    <li data-plan-week={week.n}>
      <button type="button" onClick={onToggle} aria-expanded={open} className={cn("flex min-h-12 w-full items-center gap-2 rounded-xl px-2 py-2 text-left", now && "bg-muted/50")}>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium">
            Week {week.n}
            {week.name && <span className="font-normal text-muted-foreground"> · {week.name}</span>}
          </span>
          {range && <span className="block text-[12px] tabular-nums text-muted-foreground">{range}{now ? " · This week" : ""}</span>}
        </span>
        <span className="shrink-0 text-[12.5px] tabular-nums text-muted-foreground">
          {week.planned ? (week.status === "completed" && week.done === week.planned ? <Check className="inline h-4 w-4" aria-label="All done" /> : `${week.done}/${week.planned}`) : null}
        </span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div className="pb-1 pl-2">
          {week.focus && <p className="px-2 pb-1 text-[13px] text-muted-foreground">{week.focus}</p>}
          {week.days.length ? (
            <ul>
              {week.days.map((d) => {
                const word = d.iso === today && d.kind !== "done" ? "Today" : d.kind ? KIND_WORD[d.kind] : null;
                return (
                  <li key={d.key}>
                    <button type="button" onClick={() => onOpenWorkout(d)} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left hover:bg-muted/50" data-plan-day={d.dayId}>
                      <span className="w-[4.5rem] shrink-0 text-[12.5px] tabular-nums text-muted-foreground">{d.iso ? fmt(d.iso, "EEE MMM d") : "No date"}</span>
                      <span className="min-w-0 flex-1 truncate text-[14px]">{d.title}{d.optional ? <span className="text-muted-foreground"> · optional</span> : null}</span>
                      {word && <span className="shrink-0 text-[12px] text-muted-foreground">{word}</span>}
                      <span className="flex w-3 shrink-0 justify-center">{d.kind && <WorkoutStatusMark mark={d.kind === "progress" ? { kind: "progress", pct: d.pct ?? 0 } : { kind: d.kind }} />}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-2 py-2 text-[13px] text-muted-foreground">No workouts written for this week yet.</p>
          )}
        </div>
      )}
    </li>
  );
}
