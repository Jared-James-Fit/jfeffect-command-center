import { useEffect, useMemo, useRef } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft, ChevronRight, Clock, Play, RotateCcw, CheckCircle2,
  Eye, Lock, Crosshair, Dumbbell,
} from "lucide-react";
import { format, parseISO, startOfDay } from "date-fns";
import { cn } from "@/lib/utils";
import { getBlockTree, durationRange } from "@/lib/pl-programs";
import { supabase } from "@/integrations/supabase/client";
import {
  effectiveRestSeconds, resolveCategory, derivePurposeLabels, purposeLabelBadgeClass,
} from "@/lib/exercise-metadata";
import { weekDisplayRange, isCurrentWeek, formatWeekRange } from "@/lib/block-dates";
import { isWeekLocked, dayScheduledDate } from "@/lib/workout-today";

/* ──────────────────────────────────────────────────────────────────────────
   ClientBlockView
   - Canonical Block View used by the Day View ↔ Block View toggle and the
     Open Block button.
   - The hierarchy is week → days → exercises (NOT week columns).
   - Desktop / large tablet: side-by-side day columns with horizontal scroll.
   - Mobile: snap carousel of day cards with day chips at top.
   - URL persistence via ?view=block&week=N (handled by parent).
   ────────────────────────────────────────────────────────────────────────── */

function fmtRest(sec: number | null | undefined): string {
  if (sec == null) return "—";
  if (sec < 60) return `${sec} sec`;
  if (sec % 60 === 0) return `${sec / 60} min`;
  const m = Math.floor(sec / 60); const s = sec % 60;
  return `${m}m ${s}s`;
}

type Mode = "client" | "admin";

/** Block lifecycle status derived from its dates + stored status. */
type BlockStatus = "completed" | "current" | "upcoming" | "not-started";

function parseBlockDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = parseISO(s);
  return isNaN(d.getTime()) ? null : startOfDay(d);
}

export function blockLifecycleStatus(block: any, today: Date = startOfDay(new Date())): BlockStatus {
  const status = String(block?.status ?? "").toLowerCase();
  if (status === "completed" || block?.archived) return "completed";
  const start = parseBlockDate(block?.start_date);
  const end = parseBlockDate(block?.end_date);
  if (!start && !end) return status === "active" ? "current" : "not-started";
  if (end && end < today) return "completed";
  if (start && start > today) return "upcoming";
  return "current";
}

/**
 * A block is "available to complete" when its start date has arrived (or no
 * dates are set yet — i.e. legacy blocks). Upcoming blocks default to
 * preview-only so a client can view the program without logging early.
 * Coaches can override per-block by setting status="Active".
 */
export function isBlockAvailable(block: any, today: Date = startOfDay(new Date())): boolean {
  if (!block) return false;
  const status = String(block?.status ?? "").toLowerCase();
  if (status === "active") return true;
  if (status === "locked" || block?.archived) return false;
  const start = parseBlockDate(block?.start_date);
  if (!start) return true; // no start date -> treat as available (legacy)
  return start <= today;
}

export function ClientBlockView({
  block,
  blocks,
  selectedBlockId,
  onBlockChange,
  selectedWeekIndex,
  onWeekChange,
  selectedDayId,
  onDayChange,
  mode = "client",
}: {
  block: any;
  /** Full list of visible blocks (current + next + previous). Optional for back-compat. */
  blocks?: any[];
  selectedBlockId?: string | null;
  onBlockChange?: (blockId: string) => void;
  selectedWeekIndex: number | null;
  onWeekChange: (idx: number) => void;
  selectedDayId?: string | null;
  onDayChange?: (dayId: string) => void;
  mode?: Mode;
}) {
  const blockId: string | null = block?.id ?? null;

  // Today, computed once per render.
  const today = startOfDay(new Date());

  // ── Block list (sorted by start_date asc, with un-dated at the end) ───────
  const orderedBlocks = useMemo(() => {
    const list = (blocks && blocks.length ? blocks : block ? [block] : []).slice();
    list.sort((a: any, b: any) => {
      const da = parseBlockDate(a?.start_date)?.getTime() ?? Number.POSITIVE_INFINITY;
      const db = parseBlockDate(b?.start_date)?.getTime() ?? Number.POSITIVE_INFINITY;
      if (da !== db) return da - db;
      return String(a?.created_at ?? "").localeCompare(String(b?.created_at ?? ""));
    });
    return list;
  }, [blocks, block]);

  const blockStatusFor = (b: any): BlockStatus => blockLifecycleStatus(b, today);
  const blockAvailable = isBlockAvailable(block, today);
  const blockStatus: BlockStatus = blockLifecycleStatus(block, today);

  const currentBlockIdx = orderedBlocks.findIndex((b: any) => b?.id === blockId);
  const prevBlock = currentBlockIdx > 0 ? orderedBlocks[currentBlockIdx - 1] : null;
  const nextBlock = currentBlockIdx >= 0 && currentBlockIdx < orderedBlocks.length - 1
    ? orderedBlocks[currentBlockIdx + 1] : null;

  // Single source of truth for tree (cached by react-query).
  const { data: tree, isLoading } = useQuery({
    queryKey: ["client-block-tree", blockId],
    enabled: !!blockId,
    queryFn: () => getBlockTree(blockId!),
    staleTime: 60_000,
  });

  // Pull completions for state-aware actions (Start / Continue / Review).
  const dayIds: string[] = useMemo(
    () => (tree?.days ?? []).map((d: any) => d.id),
    [tree?.days],
  );
  const { data: completions = [] } = useQuery({
    queryKey: ["client-block-completions", blockId, dayIds.length],
    enabled: dayIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("pl_day_completions").select("*").in("day_id", dayIds);
      return data ?? [];
    },
    staleTime: 15_000,
  });
  const completionByDay = useMemo(() => {
    const m = new Map<string, any>();
    for (const c of completions as any[]) m.set(c.day_id, c);
    return m;
  }, [completions]);

  const weeks = useMemo(
    () => (tree?.weeks ?? []).slice().sort((a: any, b: any) => a.week_index - b.week_index),
    [tree?.weeks],
  );

  // Resolve the currently-selected week. Defaults to the "current" week
  // (date-anchored) or the first week if none matches.
  const resolvedWeek = useMemo(() => {
    if (!weeks.length) return null;
    if (selectedWeekIndex != null) {
      const w = weeks.find((w: any) => w.week_index === selectedWeekIndex);
      if (w) return w;
    }
    const cur = weeks.find((w: any) => {
      const r = weekDisplayRange(block, w);
      return isCurrentWeek(r);
    });
    return cur ?? weeks[0];
  }, [weeks, selectedWeekIndex, block]);

  const weekRange = resolvedWeek ? weekDisplayRange(block, resolvedWeek) : null;
  const weekIsCurrent = isCurrentWeek(weekRange);
  const weekLocked = mode === "client" && resolvedWeek ? isWeekLocked(block, resolvedWeek) : false;

  // Days for the selected week.
  const days = useMemo(() => {
    if (!resolvedWeek) return [] as any[];
    return (tree?.days ?? [])
      .filter((d: any) => d.week_id === resolvedWeek.id)
      .slice()
      .sort((a: any, b: any) => a.day_index - b.day_index);
  }, [tree?.days, resolvedWeek]);

  // Rows grouped by day.
  const rowsByDay = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const r of tree?.rows ?? []) {
      const list = m.get(r.day_id) ?? [];
      list.push(r);
      m.set(r.day_id, list);
    }
    return m;
  }, [tree?.rows]);

  // Canonical per-day scheduled date — same pipeline used by the Overview
  // tab, SmartTodayCard, and workout-logger header. Honors explicit
  // day.scheduled_date, then week.training_days, then a linear fallback.
  const dayDate = (d: any): Date | null =>
    resolvedWeek ? dayScheduledDate({ day: d, week: resolvedWeek, block, completion: null }) : null;

  // ── Selected day (URL-persisted via parent). Falls back to today, then the
  // first not-yet-completed day, then index 0. Invalid IDs fall back safely. ──
  const activeDayIdx = useMemo(() => {
    if (!days.length) return 0;
    if (selectedDayId) {
      const idx = days.findIndex((d: any) => d.id === selectedDayId);
      if (idx >= 0) return idx;
    }
    const tIdx = days.findIndex((d: any) => {
      const dd = dayDate(d);
      return !!dd && dd.getTime() === today.getTime();
    });
    if (tIdx >= 0) return tIdx;
    const firstOpen = days.findIndex((d: any) => !completionByDay.get(d.id)?.completed_at);
    return firstOpen >= 0 ? firstOpen : 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, selectedDayId, completionByDay, today.getTime()]);

  const selectDay = (dayId: string, idx: number) => {
    onDayChange?.(dayId);
    const el = document.getElementById(`cbv-day-${dayId}`);
    el?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
    void idx;
  };

  // Scroll the active day into view on mount / when activeDayIdx changes (mobile).
  const carouselRef = useRef<HTMLDivElement | null>(null);
  const weekStripRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const root = weekStripRef.current;
    if (!root || !resolvedWeek?.id) return;
    const el = root.querySelector<HTMLElement>(`[data-week-id="${resolvedWeek.id}"]`);
    el?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [resolvedWeek?.id]);
  useEffect(() => {
    if (!days.length) return;
    const d = days[activeDayIdx];
    if (!d) return;
    const el = document.getElementById(`cbv-day-${d.id}`);
    if (el && carouselRef.current && window.innerWidth < 768) {
      el.scrollIntoView({ behavior: "auto", inline: "start", block: "nearest" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedWeek?.id]);

  // Observe which day is most-visible in the mobile carousel and sync the URL.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const root = carouselRef.current;
    if (!root || !days.length) return;
    if (window.innerWidth >= 768) return; // desktop scrolls horizontally too but no chip sync needed
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        const top = visible[0];
        if (!top) return;
        const id = (top.target as HTMLElement).dataset.dayId;
        if (id && id !== days[activeDayIdx]?.id) {
          onDayChange?.(id);
        }
      },
      { root, threshold: [0.55, 0.75] },
    );
    const cards = root.querySelectorAll<HTMLElement>("[data-day-id]");
    cards.forEach((c) => io.observe(c));
    return () => io.disconnect();
  }, [days, activeDayIdx, onDayChange]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (!blockId) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        No assigned block.
      </Card>
    );
  }
  if (isLoading || !tree) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">Loading block…</Card>
    );
  }
  if (!weeks.length) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        This block has no weeks yet.
      </Card>
    );
  }

  const curIdx = weeks.findIndex((w: any) => w.id === resolvedWeek?.id);
  const prevWeek = curIdx > 0 ? weeks[curIdx - 1] : null;
  const nextWeek = curIdx >= 0 && curIdx < weeks.length - 1 ? weeks[curIdx + 1] : null;
  // Allow navigating from the last week of this block straight into the
  // next block's week 1 (if a next block is visible).
  const canAdvanceToNextBlock = !nextWeek && !!nextBlock && !!onBlockChange;
  const canRecedeToPrevBlock = !prevWeek && !!prevBlock && !!onBlockChange;
  const onWeekPrev = () => {
    if (prevWeek) return onWeekChange(prevWeek.week_index);
    if (canRecedeToPrevBlock && prevBlock) onBlockChange!(prevBlock.id);
  };
  const onWeekNext = () => {
    if (nextWeek) return onWeekChange(nextWeek.week_index);
    if (canAdvanceToNextBlock && nextBlock) onBlockChange!(nextBlock.id);
  };
  const goCurrentWeek = () => {
    const cur = weeks.find((w: any) => isCurrentWeek(weekDisplayRange(block, w)));
    if (cur) onWeekChange(cur.week_index);
  };

  // Per-week completion stats for the horizontal week strip.
  const weekStats = useMemo(() => {
    const m = new Map<string, { total: number; done: number }>();
    for (const w of weeks as any[]) {
      const ds = (tree?.days ?? []).filter((d: any) => d.week_id === w.id);
      let done = 0;
      for (const d of ds) if (completionByDay.get(d.id)?.completed_at) done++;
      m.set(w.id, { total: ds.length, done });
    }
    return m;
  }, [weeks, tree?.days, completionByDay]);

  return (
    <section className="space-y-3">
      {/* Block selector — current + next + previously assigned blocks. */}
      {orderedBlocks.length > 1 && (
        <div
          className="-mx-3 flex snap-x snap-mandatory items-stretch gap-2 overflow-x-auto px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          aria-label="Training blocks"
        >
          {orderedBlocks.map((b: any) => {
            const isSel = b.id === blockId;
            const st = blockStatusFor(b);
            const start = parseBlockDate(b?.start_date);
            const end = parseBlockDate(b?.end_date);
            const range = start && end
              ? `${format(start, "MMM d")} – ${format(end, "MMM d")}`
              : start ? `from ${format(start, "MMM d")}` : null;
            const weekCount = typeof b?.weeks === "number" ? b.weeks : null;
            const statusLabel =
              st === "current" ? "Current"
              : st === "upcoming" ? "Upcoming"
              : st === "completed" ? "Completed"
              : "Not Started";
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => onBlockChange?.(b.id)}
                disabled={!onBlockChange}
                className={cn(
                  "snap-start shrink-0 min-w-[10rem] max-w-[18rem] rounded-lg border px-3 py-2 text-left transition-colors",
                  isSel
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-foreground/85 hover:bg-secondary/60",
                )}
                aria-pressed={isSel}
                aria-label={`${b.name ?? "Block"} — ${statusLabel}`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-xs font-black uppercase tracking-wider">
                    {b.name ?? `Block`}
                  </span>
                  {st === "current" && (
                    <Badge className={cn("h-4 shrink-0 px-1 text-[9px] font-bold",
                      isSel ? "bg-primary-foreground/20 text-primary-foreground" : "bg-primary/15 text-primary")}>
                      Current
                    </Badge>
                  )}
                  {st === "upcoming" && (
                    <Badge variant="outline" className={cn("h-4 shrink-0 px-1 text-[9px] font-bold",
                      isSel ? "border-primary-foreground/40 text-primary-foreground" : "border-amber-500/40 text-amber-500")}>
                      Next
                    </Badge>
                  )}
                  {st === "completed" && (
                    <Badge variant="outline" className={cn("h-4 shrink-0 px-1 text-[9px] font-bold",
                      isSel ? "border-primary-foreground/40 text-primary-foreground" : "border-emerald-500/40 text-emerald-500")}>
                      Done
                    </Badge>
                  )}
                </div>
                <div className={cn("mt-0.5 text-[10px]",
                  isSel ? "text-primary-foreground/80" : "text-foreground/65")}>
                  {range ?? "Dates pending"}
                  {weekCount ? ` · ${weekCount} wk${weekCount === 1 ? "" : "s"}` : null}
                </div>
                {st === "upcoming" && !isBlockAvailable(b, today) && (
                  <div className={cn("mt-0.5 text-[10px] font-semibold",
                    isSel ? "text-primary-foreground/85" : "text-amber-600")}>
                    Preview · not available yet
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Sticky week selector — sits below the app header */}
      <div className="sticky top-0 z-30 -mx-3 border-b border-border bg-background/95 px-3 py-2 backdrop-blur">
        <div className="flex items-center gap-2">
          <Button
            size="icon" variant="outline" className="h-8 w-8 shrink-0"
            disabled={!prevWeek && !canRecedeToPrevBlock}
            onClick={onWeekPrev}
            aria-label="Previous week"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          {/* Horizontal swipeable week strip */}
          <div
            ref={weekStripRef}
            className="-mx-1 flex flex-1 snap-x snap-mandatory items-center gap-1.5 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            aria-label="Weeks"
          >
            {weeks.map((w: any) => {
              const r = weekDisplayRange(block, w);
              const isCur = isCurrentWeek(r);
              const isSel = w.id === resolvedWeek?.id;
              const stats = weekStats.get(w.id) ?? { total: 0, done: 0 };
              const allDone = stats.total > 0 && stats.done === stats.total;
              return (
                <button
                  key={w.id}
                  type="button"
                  data-week-id={w.id}
                  onClick={() => onWeekChange(w.week_index)}
                  className={cn(
                    "snap-start shrink-0 rounded-md border px-3 py-1.5 text-left transition-colors",
                    isSel
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-foreground/80 hover:bg-secondary/60",
                  )}
                  aria-pressed={isSel}
                  aria-label={`Week ${w.week_index}${isCur ? " — current" : ""}`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-black uppercase tracking-wider">W{w.week_index}</span>
                    {isCur && (
                      <Crosshair className={cn("h-3 w-3", isSel ? "" : "text-primary")} />
                    )}
                    {allDone && <CheckCircle2 className="h-3 w-3 text-emerald-500" />}
                  </div>
                  {stats.total > 0 && (
                    <div className={cn("mt-0.5 text-[9px] font-semibold tabular-nums", isSel ? "text-primary-foreground/80" : "text-foreground/55")}>
                      {stats.done}/{stats.total}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          <Button
            size="icon" variant="outline" className="h-8 w-8 shrink-0"
            disabled={!nextWeek && !canAdvanceToNextBlock}
            onClick={onWeekNext}
            aria-label="Next week"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-foreground/70">
          {weekRange && (
            <span>{formatWeekRange(weekRange.start, weekRange.end)} · {days.length} day{days.length === 1 ? "" : "s"}</span>
          )}
          {weekIsCurrent ? (
            <Badge className="h-5 border-primary/40 bg-primary/15 px-1.5 text-[9px] font-bold text-primary hover:bg-primary/20">
              <Crosshair className="mr-1 h-2.5 w-2.5" />Current
            </Badge>
          ) : (
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={goCurrentWeek}>
              <Crosshair className="mr-1 h-3 w-3" /> Jump to current
            </Button>
          )}
          {weekLocked && (
            <Badge variant="outline" className="h-5 px-1.5 text-[9px]">
              <Lock className="mr-1 h-2.5 w-2.5" /> Locked
            </Badge>
          )}
        </div>

        {/* Mobile day chips — horizontal snap row, bleeds past parent
            padding so the last chip never sits clipped under the screen
            edge. Compact two-line label keeps long day titles off-screen
            (full title + date appear in the workout card below). */}
        {days.length > 0 && (
          <div
            className="-mx-3 mt-2 flex snap-x snap-mandatory gap-1.5 overflow-x-auto px-3 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:hidden"
            aria-label="Days in this week"
            style={{ scrollPaddingLeft: 12, scrollPaddingRight: 12 }}
          >
            {days.map((d: any, i: number) => {
              const c = completionByDay.get(d.id);
              const done = !!c?.completed_at;
              const started = !!c && !done;
              const dd = dayDate(d);
              const isToday = !!dd && dd.getTime() === today.getTime();
              const isSel = activeDayIdx === i;
              return (
                <button
                  key={d.id}
                  type="button"
                  data-day-chip-id={d.id}
                  onClick={() => selectDay(d.id, i)}
                  className={cn(
                    "snap-start shrink-0 rounded-lg border px-2.5 py-1 text-left text-[11px] font-semibold leading-tight min-h-[44px] min-w-[64px]",
                    isSel
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-foreground/85",
                    isToday && !isSel && "ring-1 ring-primary/40",
                  )}
                  aria-pressed={isSel}
                  aria-label={`Day ${d.day_index}${dd ? `, ${format(dd, "EEEE, MMMM d")}` : ""}${done ? ", completed" : started ? ", in progress" : ""}`}
                >
                  <div className="flex items-center gap-1 whitespace-nowrap">
                    <span className="font-black uppercase tracking-wide">Day {d.day_index}</span>
                    {done && <CheckCircle2 className="h-3 w-3 text-emerald-500" />}
                    {started && !done && <span className="text-[9px] text-amber-500">●</span>}
                  </div>
                  <div className={cn("mt-0.5 text-[10px] font-medium whitespace-nowrap",
                    isSel ? "text-primary-foreground/80" : "text-foreground/60")}>
                    {dd ? format(dd, "EEE · MMM d") : "—"}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Day columns / carousel */}
      {days.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">
          No workouts programmed for this week.
        </Card>
      ) : (
        <div
          ref={carouselRef}
          className={cn(
            // Mobile = snap carousel. Desktop/tablet = wrapped grid so no day/exercise
            // column is clipped off the right edge of the Block View.
            "-mx-3 flex snap-x snap-mandatory gap-3 overflow-x-auto px-3",
            "md:mx-0 md:grid md:grid-cols-2 md:items-start md:overflow-visible md:px-0 md:snap-none xl:grid-cols-3",
            // Clearance so the fixed mobile bottom nav never covers the final card.
            "pb-[calc(var(--bottom-nav-clearance,0px)+env(safe-area-inset-bottom)+16px)]",
          )}
          style={{ scrollPaddingLeft: 12, scrollPaddingRight: 12 }}
        >
          {days.map((d: any) => {
            const rows = rowsByDay.get(d.id) ?? [];
            const c = completionByDay.get(d.id);
            const done = !!c?.completed_at;
            const started = !!c && !done;
            const dd = dayDate(d);
            const isToday = !!dd && dd.getTime() === today.getTime();
            const isPast = !!dd && dd < today;
            const purpose = derivePurposeLabels(rows, (r) => r.exercises ?? null);
            const duration = durationRange(d.duration_override_min ?? d.duration_estimate_min ?? 60);

            const Action = () => {
              if (mode !== "client") return (
                <Link to="/admin/blocks/$blockId" params={{ blockId: block.id }}>
                  <Button size="sm" className="w-full"><Eye className="mr-1 h-3.5 w-3.5" /> Open in builder</Button>
                </Link>
              );
              // Upcoming block: visible for preview, but Start is gated until
              // the block's start date arrives (or coach sets status=Active).
              const previewOnly = !blockAvailable && !done && !started;
              const label = done
                ? "Review Workout"
                : started
                ? "Continue Workout"
                : previewOnly
                ? "Not available yet"
                : weekLocked
                ? "Locked"
                : isToday
                ? "Start Workout"
                : isPast === false && !isToday && dd
                ? "View Workout"
                : "Start Workout";
              const Icon = done ? RotateCcw : started ? Play : (weekLocked || previewOnly) ? Lock : Play;
              const disabled = (weekLocked || previewOnly) && !done && !started;
              const variant = done ? "outline" : previewOnly ? "outline" : "default";
              return (
                <Link
                  to="/portal/workouts/$dayId"
                  params={{ dayId: d.id }}
                  className={cn("block", disabled && "pointer-events-none opacity-60")}
                  aria-disabled={disabled || undefined}
                >
                  <Button size="sm" variant={variant as any} className="w-full font-bold uppercase tracking-wide">
                    <Icon className="mr-1.5 h-3.5 w-3.5" /> {label}
                  </Button>
                </Link>
              );
            };

            return (
              <div
                key={d.id}
                id={`cbv-day-${d.id}`}
                data-day-id={d.id}
                className={cn(
                  "flex min-w-0 snap-start flex-col rounded-lg border bg-card",
                  // Mobile: ~85vw per card with a small peek of the next day.
                  "w-[calc(100vw-3rem)] max-w-[380px] shrink-0",
                  // Desktop/tablet grid cards fill their column instead of forcing horizontal overflow.
                  "md:w-full md:max-w-none md:shrink md:snap-none",
                  isToday && !done && blockStatus === "current" && "border-primary ring-2 ring-primary/40",
                )}
              >
                {/* Sticky day header inside the column */}
                <div className="sticky top-[64px] z-10 rounded-t-lg border-b border-border bg-card/95 p-3 backdrop-blur">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <h3 className="min-w-0 break-words text-sm font-black uppercase tracking-wide">
                          {d.title || `Day ${d.day_index}`}
                        </h3>
                        {isToday && !done && blockStatus === "current" && (
                          <Badge className="h-4 shrink-0 whitespace-nowrap border-primary/40 bg-primary/15 px-1 text-[9px] font-bold text-primary hover:bg-primary/20">
                            Today
                          </Badge>
                        )}
                        {blockStatus === "upcoming" && !done && (
                          <Badge variant="outline" className="h-4 shrink-0 whitespace-nowrap border-amber-500/40 bg-amber-500/10 px-1 text-[9px] font-bold text-amber-500">
                            Upcoming
                          </Badge>
                        )}
                      </div>
                      {d.focus && (
                        <p className="mt-0.5 break-words text-[11px] text-foreground/70">{d.focus}</p>
                      )}
                      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-foreground/70">
                        {dd && <span className="shrink-0 whitespace-nowrap">{format(dd, "EEEE, MMM d")}</span>}
                        <span className="inline-flex min-w-0 items-center gap-1 whitespace-nowrap"><Clock className="h-3 w-3 shrink-0" />{duration}</span>
                        <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap"><Dumbbell className="h-3 w-3 shrink-0" />{rows.length} ex</span>
                      </div>
                    </div>
                    <div className="shrink-0 whitespace-nowrap">
                      {done ? (
                        <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-[10px] text-emerald-500">
                          <CheckCircle2 className="mr-0.5 h-3 w-3" /> Done
                        </Badge>
                      ) : started ? (
                        <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-500">
                          In Progress
                        </Badge>
                      ) : weekLocked ? (
                        <Badge variant="outline" className="text-[10px]">
                          <Lock className="mr-0.5 h-3 w-3" /> Locked
                        </Badge>
                      ) : isPast && blockStatus === "current" ? (
                        <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-[10px] text-destructive">
                          Missed
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">Scheduled</Badge>
                      )}
                    </div>
                  </div>
                </div>

                {/* Exercise list */}
                <div className="flex-1 space-y-1.5 p-3">
                  {rows.length === 0 ? (
                    <p className="text-[12px] italic text-foreground/60">No exercises programmed.</p>
                  ) : rows.map((r: any, i: number) => {
                    const name = r.exercises?.name ?? r.exercise_name_override ?? "Exercise";
                    const meta = r.exercises ?? null;
                    const rest = effectiveRestSeconds(r, meta);
                    const cat = resolveCategory(meta);
                    const isComp = !!meta?.is_competition_lift;
                    const reps = r.reps_text ?? "—";
                    const sets = r.sets ?? "—";
                    const loadUnit: string = r.load_unit === "lb" ? "lb" : "kg";
                    const loadVal = loadUnit === "kg" ? r.load_kg : r.load_lb;
                    const pct = r.percentage;
                    const rpe = r.rpe;
                    const rir = r.rir;
                    return (
                      <div key={r.id ?? i} className={cn(
                        "min-w-0 rounded-md border bg-background/40 p-2",
                        isComp ? "border-primary/40" : "border-border",
                      )}>
                        <div className="grid grid-cols-1 gap-2">
                          <div className="min-w-0">
                            <div className="break-words text-[13px] font-bold leading-snug">{name}</div>
                            <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground/70">
                              {purpose[i] && (
                                <span className={cn("break-words rounded border px-1 py-0", purposeLabelBadgeClass(purpose[i]))}>{purpose[i]}</span>
                              )}
                              {isComp && <span className="shrink-0 rounded bg-primary/15 px-1 text-primary">Comp</span>}
                              <span className="break-words text-foreground/50">· {cat}</span>
                            </div>
                          </div>
                        </div>
                        <div className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] tabular-nums sm:grid-cols-3">
                          <div className="min-w-0"><span className="text-foreground/60">Sets</span> <span className="font-bold break-words">{sets}</span></div>
                          <div className="min-w-0"><span className="text-foreground/60">Reps</span> <span className="font-bold break-words">{reps}</span></div>
                          <div className="min-w-0"><span className="text-foreground/60">Rest</span> <span className="font-bold break-words">{fmtRest(rest)}</span></div>
                          {(rpe != null && rpe !== "") && <div className="min-w-0"><span className="text-foreground/60">RPE</span> <span className="font-bold break-words">{rpe}</span></div>}
                          {(rir != null && rir !== "") && <div className="min-w-0"><span className="text-foreground/60">RIR</span> <span className="font-bold break-words">{rir}</span></div>}
                          {(loadVal != null) && <div className="min-w-0"><span className="text-foreground/60">Load</span> <span className="font-bold break-words">{loadVal}{loadUnit}</span></div>}
                          {(pct != null && pct !== "") && <div className="min-w-0"><span className="text-foreground/60">%</span> <span className="font-bold break-words">{pct}%</span></div>}
                          {r.tempo && <div className="col-span-2 min-w-0 sm:col-span-3"><span className="text-foreground/60">Tempo</span> <span className="font-bold break-words">{r.tempo}</span></div>}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Bottom action */}
                <div className="border-t border-border p-3">
                  <Action />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}