import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Archive, Check, ChevronDown, ChevronRight, Eye, Flag, Pencil, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { parseLocalDate, todayLocalISO } from "@/lib/today";
import { isAtHomeBackupSessionBlock } from "@/lib/at-home-backup";
import {
  blockNameParts,
  buildProgramRoadmap,
  type ProgramRoadmap,
  type ProgramSummary,
  type RoadmapBlockView,
  type RoadmapNoteRow,
  type RoadmapWeekView,
} from "@/lib/training-roadmap";

const sb = supabase as any;

/* ──────────────────────────────────────────────────────────────────────────
   Program roadmap: sits under the calendar. The calendar says what to do
   today; this says where the training is going and why. Overall progress,
   the current block and week, then every block as a step on the roadmap
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

function meetText(daysOut: number): string {
  if (daysOut <= 0) return "Meet day";
  if (daysOut === 1) return "Meet tomorrow";
  if (daysOut < 14) return `Meet in ${daysOut} days`;
  return `Meet in ${Math.round(daysOut / 7)} weeks`;
}


const weeksLabel = (n: number) => `${n} week${n === 1 ? "" : "s"}`;
const rangeLabel = (start: string | null, end: string | null) => [fmt(start), fmt(end)].filter(Boolean).join(" – ");

/** One sentence the athlete can act on: the week's own note, else the block's purpose. */
function weekLine(week: RoadmapWeekView | null, block: RoadmapBlockView | null): string | null {
  return week?.focus ?? block?.purpose ?? null;
}

export function ProgramRoadmapCard({
  roadmap,
  selectedBlockId,
  onSelectBlock,
  coach = false,
  onSelectProgram,
}: {
  roadmap: ProgramRoadmap | null;
  /** Look at another program (read-only: nothing about the schedule changes). null = back to the current one. */
  onSelectProgram?: (programId: string | null) => void;
  selectedBlockId?: string | null;
  /** Opens a block in Block View. */
  onSelectBlock?: (blockId: string) => void;
  /** Coach viewing an athlete: shows where to edit the words. */
  coach?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [openBlock, setOpenBlock] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  if (!roadmap || !roadmap.blocks.length) return null;
  const { blocks, programWeek, totalWeeks, meet } = roadmap;
  // Another program than today's: a read-only look back (or ahead).
  const browsing = roadmap.program.id !== roadmap.defaultProgramId;
  const canPick = roadmap.programs.length > 1 && !!onSelectProgram;
  // A finished program has no "this week" part, so its roadmap is the content.
  const showAll = expanded || roadmap.program.status === "completed";
  const current = blocks.find((b) => b.id === roadmap.currentBlockId) ?? null;
  const currentIdx = current ? blocks.indexOf(current) : -1;
  const thisWeek = current?.weeks.find((w) => w.status === "current") ?? null;
  const thisWeekIdx = thisWeek && current ? current.weeks.indexOf(thisWeek) : -1;
  const allDone = blocks.every((b) => b.status === "completed");
  const notStarted = !allDone && blocks.every((b) => b.status === "upcoming");

  const headline = allDone
    ? "Program complete"
    : notStarted
      ? `Starts ${fmt(blocks[0]?.start) ?? "soon"}`
      : programWeek
        ? `Week ${programWeek} of ${totalWeeks}`
        : "Between blocks";
  const line = !allDone ? weekLine(thisWeek, current) : null;
  const pick = (id: string) => {
    setPicking(false);
    setExpanded(false);
    setOpenBlock(null);
    onSelectProgram?.(id === roadmap.defaultProgramId ? null : id);
  };

  return (
    <Card className="overflow-hidden p-0" aria-label="Your training program">
      {/* Where you are in the whole program: its name, the week, one bar. */}
      <div className="px-4 pb-4 pt-3.5">
        <div className="flex items-center justify-between gap-3">
          {canPick ? (
            <button
              type="button"
              onClick={() => setPicking((v) => !v)}
              aria-expanded={picking}
              aria-label="Choose a program"
              className="-mx-1 flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 text-left transition hover:bg-secondary/50"
            >
              <ProgramTitle program={roadmap.program} browsing={browsing} />
              <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", picking && "rotate-180")} />
            </button>
          ) : (
            <div className="flex min-w-0 items-center gap-1">
              <ProgramTitle program={roadmap.program} browsing={browsing} />
            </div>
          )}
          {meet ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[12px] font-bold text-primary" title={[meet.name, fmt(meet.date)].filter(Boolean).join(" · ")}>
              <Flag className="h-3 w-3" /> {meetText(meet.daysOut)}
            </span>
          ) : roadmap.end && !allDone ? (
            <span className="shrink-0 text-[12px] text-muted-foreground">Ends {fmt(roadmap.end)}</span>
          ) : allDone && roadmap.start ? (
            <span className="shrink-0 text-[12px] text-muted-foreground">{rangeLabel(roadmap.start, roadmap.end)}</span>
          ) : null}
        </div>
        <div className="mt-1 text-[22px] font-black leading-tight tracking-tight tabular-nums">{headline}</div>

        {/* One segment per block, so the shape of the program reads at a glance. */}
        <div className="mt-3 flex gap-1" aria-hidden>
          {blocks.map((b) => (
            <div key={b.id} className="h-1.5 overflow-hidden rounded-full bg-muted-foreground/20" style={{ flexGrow: Math.max(1, b.weekCount), flexBasis: 0 }}>
              <div
                className={cn("h-full rounded-full", b.status === "completed" ? "bg-emerald-500/80" : "bg-primary")}
                style={{
                  width: b.status === "completed" ? "100%" : b.status === "upcoming" ? "0%"
                    : `${Math.round(((b.weeks.filter((w) => w.status !== "upcoming").length || 1) / Math.max(1, b.weekCount)) * 100)}%`,
                }}
              />
            </div>
          ))}
        </div>
      </div>

      {picking && canPick && (
        <ProgramList programs={roadmap.programs} selectedId={roadmap.program.id} defaultId={roadmap.defaultProgramId} onSelect={pick} />
      )}

      {/* This block and this week: the one thing worth reading every day. */}
      {current && !allDone && (
        <div className="border-t border-border/60 px-4 py-3.5" data-roadmap-now>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-bold uppercase tracking-wider text-primary">
                {blocks.length > 1 ? `Block ${currentIdx + 1} of ${blocks.length}` : "This block"}
                {current.status === "upcoming" ? " · starts soon" : ""}
              </div>
              <div className="truncate text-base font-bold leading-snug">{blockTitle(current)}</div>
            </div>
            <div className="shrink-0 pt-0.5 text-right">
              <div className="text-[13px] font-semibold tabular-nums">
                {thisWeekIdx >= 0 ? `Week ${thisWeekIdx + 1} of ${current.weekCount}` : weeksLabel(current.weekCount)}
              </div>
              {current.weeks.length > 1 && <WeekPills weeks={current.weeks} />}
            </div>
          </div>
          {line && (
            <div className="mt-3">
              {thisWeek?.label && <div className="text-[15px] font-bold leading-snug">{thisWeek.label}</div>}
              <p className="mt-0.5 text-[14px] leading-relaxed text-foreground/75">{line}</p>
            </div>
          )}
        </div>
      )}

      {/* Roadmap: every block in order. Collapsed by default; always open for a finished program. */}
      {blocks.length > 1 && roadmap.program.status !== "completed" && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={showAll}
          className="flex w-full items-center justify-between gap-2 border-t border-border/60 px-4 py-3 text-[13px] font-semibold transition hover:bg-secondary/40"
        >
          <span>{showAll ? "Hide the roadmap" : "See the full roadmap"}</span>
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            {blocks.length} blocks
            <ChevronDown className={cn("h-4 w-4 transition-transform", showAll && "rotate-180")} />
          </span>
        </button>
      )}
      {(showAll || blocks.length === 1) && (
        <ol className="space-y-0 px-4 pb-3" aria-label="Blocks in this program">
          {blocks.map((b, i) => (
            <RoadmapStep
              key={b.id}
              block={b}
              number={i + 1}
              last={i === blocks.length - 1}
              open={openBlock === b.id || (blocks.length === 1 && openBlock === null)}
              selected={b.id === selectedBlockId}
              onToggle={() => setOpenBlock((id) => (id === b.id ? "" : b.id))}
              onOpenBlockView={onSelectBlock ? () => onSelectBlock(b.id) : undefined}
            />
          ))}
        </ol>
      )}

      {browsing && onSelectProgram && (
        <div className="flex items-center justify-between gap-2 border-t border-border/60 px-4 py-2 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Eye className="h-3 w-3" /> Viewing only. Your current program and schedule are unchanged.
          </span>
          <button type="button" onClick={() => pick(roadmap.defaultProgramId)} className="shrink-0 font-bold text-primary">
            Back to current
          </button>
        </div>
      )}

      {coach && (
        <div className="flex items-center justify-between gap-2 border-t border-border/60 px-4 py-2 text-[11px] text-muted-foreground">
          <span className="inline-flex min-w-0 items-center gap-1">
            <Sparkles className="h-3 w-3 shrink-0" /> <span className="truncate">Notes are written by Cleo from the program. Yours override hers.</span>
          </span>
          {(selectedBlockId ?? current?.id) && (
            <Link
              to="/admin/blocks/$blockId"
              params={{ blockId: (selectedBlockId ?? current?.id) as string }}
              hash="roadmap"
              className="inline-flex shrink-0 items-center gap-1 font-semibold text-foreground hover:underline"
            >
              <Pencil className="h-3 w-3" /> Edit
            </Link>
          )}
        </div>
      )}
    </Card>
  );
}

/** A block by its own name: the roadmap's label, else the coach's name without its "Block N —". */
function blockTitle(b: RoadmapBlockView): string {
  return b.label ?? blockNameParts(b.name)?.name ?? b.name;
}

/** The program's name, with Past / Upcoming only when it isn't today's. */
function ProgramTitle({ program, browsing }: { program: ProgramSummary; browsing: boolean }) {
  return (
    <>
      <span className="min-w-0 truncate text-[13px] font-semibold text-muted-foreground">{programName(program)}</span>
      {browsing && program.status !== "active" && (
        <span className="shrink-0 rounded px-1.5 text-[9px] font-black uppercase leading-4 tracking-wider bg-secondary text-muted-foreground">
          {program.status === "completed" ? "Past" : "Upcoming"}
        </span>
      )}
    </>
  );
}

/** This block's weeks as short bars: done green, this week red, the rest to come. */
function WeekPills({ weeks }: { weeks: RoadmapWeekView[] }) {
  const narrow = weeks.length > 6;
  return (
    <div className="mt-1.5 flex justify-end gap-1" aria-label="Weeks in this block">
      {weeks.map((w) => (
        <span
          key={w.id}
          title={[`Week ${w.index}`, w.label, w.status === "completed" ? "done" : w.status === "current" ? "this week" : null].filter(Boolean).join(" · ")}
          className={cn(
            "h-1.5 rounded-full",
            narrow ? "w-2" : "w-4",
            w.status === "completed" && "bg-emerald-500/80",
            w.status === "current" && "bg-primary",
            w.status === "upcoming" && "bg-muted-foreground/25",
          )}
        />
      ))}
    </div>
  );
}

function RoadmapStep({
  block, number, last, open, selected, onToggle, onOpenBlockView,
}: {
  block: RoadmapBlockView;
  number: number;
  last: boolean;
  open: boolean;
  selected: boolean;
  onToggle: () => void;
  onOpenBlockView?: () => void;
}) {
  const range = rangeLabel(block.start, block.end);
  return (
    <li className="relative flex gap-3">
      {/* Rail */}
      <div className="flex flex-col items-center pt-3">
        <span
          className={cn(
            "grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-black tabular-nums",
            block.status === "completed" && "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400",
            block.status === "current" && "bg-primary text-primary-foreground",
            block.status === "upcoming" && "border border-border text-muted-foreground",
          )}
        >
          {block.status === "completed" ? <Check className="h-3.5 w-3.5" /> : number}
        </span>
        {!last && <span className={cn("mt-1 w-px flex-1", block.status === "completed" ? "bg-emerald-500/40" : "bg-border")} />}
      </div>

      <div className={cn("min-w-0 flex-1 pb-2 pt-2", !last && "border-b border-border/40")}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className={cn("flex w-full items-start gap-2 rounded-lg px-1.5 py-1 text-left transition hover:bg-secondary/40", selected && "bg-secondary/60")}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className={cn("truncate text-sm font-bold", block.status === "upcoming" && "text-foreground/80")}>{blockTitle(block)}</span>
              {block.status === "current" && (
                <span className="shrink-0 rounded bg-primary/15 px-1.5 text-[9px] font-black uppercase leading-4 tracking-wider text-primary">
                  Now
                </span>
              )}
            </div>
            <div className="truncate text-[12px] text-muted-foreground tabular-nums">
              {weeksLabel(block.weekCount)}{range ? ` · ${range}` : ""}
            </div>
            {block.purpose && !open && <p className="mt-0.5 line-clamp-1 text-[12px] text-foreground/70">{block.purpose}</p>}
          </div>
          <ChevronDown className={cn("mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
        </button>

        {open && (
          <div className="space-y-2 px-1.5 pb-1 pt-1">
            {block.purpose && <p className="text-[12px] leading-snug text-foreground/80">{block.purpose}</p>}
            {block.weeks.length > 0 && (
              <ul className="space-y-1">
                {block.weeks.map((w) => (
                  <li key={w.id} className={cn("rounded-lg px-2 py-1.5", w.status === "current" ? "bg-primary/10" : "bg-secondary/30")}>
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className={cn("font-bold", w.status === "current" && "text-primary")}>
                        Week {w.index}{w.label ? ` · ${w.label}` : ""}
                      </span>
                      <span className="shrink-0 text-muted-foreground tabular-nums">
                        {w.status === "completed" ? "Done" : w.status === "current" ? "This week" : fmt(w.start) ?? ""}
                      </span>
                    </div>
                    {w.focus && <p className="mt-0.5 text-[12px] leading-snug text-foreground/75">{w.focus}</p>}
                  </li>
                ))}
              </ul>
            )}
            {onOpenBlockView && (
              <button type="button" onClick={onOpenBlockView} className="inline-flex items-center gap-0.5 text-[11px] font-bold text-primary">
                Open workouts in Block View <ChevronRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function programName(p: ProgramSummary): string {
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
    <ul className="space-y-0.5 border-t border-border/60 px-2 py-2" role="listbox" aria-label="Programs">
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
                <span className={cn("h-2 w-2 shrink-0 rounded-full", p.status === "active" ? "bg-primary" : "bg-muted-foreground/40")} />
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
              {isSel && <Check className="h-4 w-4 shrink-0 text-primary" />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
