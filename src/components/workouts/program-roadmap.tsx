import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { CheckCircle2, Flag, Pencil, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { parseLocalDate, todayLocalISO } from "@/lib/today";
import { isAtHomeBackupSessionBlock } from "@/lib/at-home-backup";
import {
  buildProgramRoadmap,
  type ProgramRoadmap,
  type RoadmapBlockView,
  type RoadmapNoteRow,
  type RoadmapStatus,
} from "@/lib/training-roadmap";

const sb = supabase as any;

/* ──────────────────────────────────────────────────────────────────────────
   Program roadmap: the athlete's whole program at a glance. Which week of
   how many, every block as a segment of the timeline (tap one to open it in
   Block View), the meet countdown, and what this week is about. The words
   are the coach's when they wrote them, else Cleo's (pl_roadmap_notes).
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
export function useProgramRoadmap(clientId: string, blocks: any[] | undefined) {
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
          ? sb.from("pl_preps").select("id, event_name, event_date").in("id", prepIds)
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
    });
  }, [primary, data]);
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

const SEGMENT_TONE: Record<RoadmapStatus, string> = {
  completed: "bg-emerald-500/70",
  current: "bg-primary",
  upcoming: "bg-muted-foreground/25",
};

export function ProgramRoadmapCard({
  roadmap,
  selectedBlockId,
  onSelectBlock,
  coach = false,
}: {
  roadmap: ProgramRoadmap | null;
  selectedBlockId?: string | null;
  onSelectBlock?: (blockId: string) => void;
  /** Coach viewing an athlete: shows where to edit the words. */
  coach?: boolean;
}) {
  if (!roadmap || !roadmap.blocks.length) return null;
  const { blocks, programWeek, totalWeeks, meet } = roadmap;
  const current = blocks.find((b) => b.id === roadmap.currentBlockId) ?? null;
  const currentIdx = current ? blocks.indexOf(current) : -1;
  const thisWeek = current?.weeks.find((w) => w.status === "current") ?? null;
  const allDone = blocks.every((b) => b.status === "completed");
  const notStarted = !allDone && blocks.every((b) => b.status === "upcoming");

  const headline = allDone
    ? "Program complete"
    : notStarted
      ? `Starts ${fmt(blocks[0]?.start) ?? "soon"}`
      : programWeek
        ? `Week ${programWeek} of ${totalWeeks}`
        : `${totalWeeks} week${totalWeeks === 1 ? "" : "s"}`;
  const sub = [
    current && blocks.length > 1 ? `Block ${currentIdx + 1} of ${blocks.length}` : null,
    current ? current.label ?? current.name : null,
    !programWeek && !allDone && !notStarted && current ? "between blocks" : null,
  ].filter(Boolean).join(" · ");

  return (
    <Card className="space-y-3 p-3 sm:p-4" aria-label="Your training program">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Your program</div>
          <div className="mt-0.5 text-lg font-black leading-tight tabular-nums">{headline}</div>
          {sub && <div className="truncate text-xs text-muted-foreground">{sub}</div>}
        </div>
        <div className="shrink-0 text-right">
          {meet ? (
            <div className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] font-bold text-primary">
              <Flag className="h-3 w-3" />
              {meetText(meet.daysOut)}
            </div>
          ) : roadmap.end && !allDone ? (
            <div className="text-[11px] text-muted-foreground">Ends {fmt(roadmap.end)}</div>
          ) : null}
          {meet && (
            <div className="mt-0.5 text-[10px] text-muted-foreground">
              {[meet.name, fmt(meet.date)].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>
      </div>

      {/* Timeline: one segment per block, sized by its weeks; one tick per week. */}
      <div className="flex items-stretch gap-1" role="list" aria-label="Blocks in this program">
        {blocks.map((b) => (
          <TimelineSegment
            key={b.id}
            block={b}
            selected={b.id === selectedBlockId}
            onSelect={onSelectBlock ? () => onSelectBlock(b.id) : undefined}
          />
        ))}
      </div>

      {thisWeek && (thisWeek.label || thisWeek.focus) ? (
        <div className="rounded-md bg-secondary/50 px-2.5 py-2">
          <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            This week{thisWeek.label ? ` · ${thisWeek.label}` : ""}
          </div>
          {thisWeek.focus && <p className="mt-0.5 text-xs leading-snug text-foreground/85">{thisWeek.focus}</p>}
        </div>
      ) : current?.purpose && !allDone ? (
        <p className="text-xs leading-snug text-foreground/80">{current.purpose}</p>
      ) : null}

      {coach && (
        <div className="flex items-center justify-between gap-2 border-t pt-2 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Sparkles className="h-3 w-3" /> Block and week notes are written by Cleo from the program. Yours override hers.
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

function TimelineSegment({ block, selected, onSelect }: { block: RoadmapBlockView; selected: boolean; onSelect?: () => void }) {
  const ticks = block.weeks.length
    ? block.weeks.map((w) => ({ id: w.id, status: w.status }))
    : Array.from({ length: Math.max(1, block.weekCount) }, (_, i) => ({ id: `${block.id}-${i}`, status: block.status }));
  const range = [fmt(block.start), fmt(block.end)].filter(Boolean).join(" – ");
  const statusWord = block.status === "completed" ? "done" : block.status === "current" ? "current" : "upcoming";
  return (
    <button
      type="button"
      role="listitem"
      onClick={onSelect}
      disabled={!onSelect}
      style={{ flexGrow: Math.max(1, block.weekCount), flexBasis: 0 }}
      className={cn(
        "group min-w-0 rounded-md p-1 text-left transition-colors",
        onSelect && "hover:bg-secondary/60",
        selected && "bg-secondary ring-1 ring-primary/50",
      )}
      aria-pressed={selected}
      aria-label={`${block.name}${block.label ? `, ${block.label}` : ""}, ${block.weekCount} weeks${range ? `, ${range}` : ""}, ${statusWord}`}
    >
      <div className="flex gap-[2px]">
        {ticks.map((t) => (
          <span
            key={t.id}
            className={cn(
              "h-2 flex-1 rounded-[2px]",
              SEGMENT_TONE[t.status],
              t.status === "current" && block.status === "current" && "ring-2 ring-primary/30 ring-offset-1 ring-offset-background",
            )}
          />
        ))}
      </div>
      <div className="mt-1 flex items-center gap-1">
        {block.status === "completed" && <CheckCircle2 className="h-2.5 w-2.5 shrink-0 text-emerald-500" />}
        <span
          className={cn(
            "truncate text-[10px] font-bold uppercase tracking-wide",
            block.status === "current" ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {block.label ?? block.name}
        </span>
      </div>
      <div className="hidden truncate text-[10px] text-muted-foreground sm:block">
        {block.weekCount} wk{block.weekCount === 1 ? "" : "s"}{range ? ` · ${range}` : ""}
      </div>
    </button>
  );
}
