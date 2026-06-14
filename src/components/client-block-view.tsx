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
import { format, startOfDay } from "date-fns";
import { cn } from "@/lib/utils";
import { getBlockTree, durationRange } from "@/lib/pl-programs";
import { supabase } from "@/integrations/supabase/client";
import {
  effectiveRestSeconds, resolveCategory, derivePurposeLabels, purposeLabelBadgeClass,
} from "@/lib/exercise-metadata";
import { weekDisplayRange, isCurrentWeek, formatWeekRange } from "@/lib/block-dates";
import { isWeekLocked } from "@/lib/workout-today";

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

export function ClientBlockView({
  block,
  selectedWeekIndex,
  onWeekChange,
  selectedDayId,
  onDayChange,
  mode = "client",
}: {
  block: any;
  selectedWeekIndex: number | null;
  onWeekChange: (idx: number) => void;
  selectedDayId?: string | null;
  onDayChange?: (dayId: string) => void;
  mode?: Mode;
}) {
  const blockId: string | null = block?.id ?? null;

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
  const today = startOfDay(new Date());

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

  // Resolve per-day scheduled date (explicit > derived from week range).
  const dayDate = (d: any): Date | null => {
    if (d?.scheduled_date) return startOfDay(new Date(d.scheduled_date + "T00:00:00"));
    if (!weekRange) return null;
    const idx = Math.max(0, (d?.day_index ?? 1) - 1);
    const dt = new Date(weekRange.start);
    dt.setDate(dt.getDate() + Math.min(6, idx));
    return startOfDay(dt);
  };

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
      {/* Sticky week selector — sits below the app header */}
      <div className="sticky top-0 z-30 -mx-3 border-b border-border bg-background/95 px-3 py-2 backdrop-blur">
        <div className="flex items-center gap-2">
          <Button
            size="icon" variant="outline" className="h-8 w-8 shrink-0"
            disabled={!prevWeek}
            onClick={() => prevWeek && onWeekChange(prevWeek.week_index)}
            aria-label="Previous week"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          {/* Horizontal swipeable week strip */}
          <div
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
            disabled={!nextWeek}
            onClick={() => nextWeek && onWeekChange(nextWeek.week_index)}
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

        {/* Mobile day chips (snap-target navigation) */}
        {days.length > 0 && (
          <div className="mt-2 flex gap-1.5 overflow-x-auto md:hidden" aria-label="Days in this week">
            {days.map((d: any, i: number) => {
              const c = completionByDay.get(d.id);
              const done = !!c?.completed_at;
              const started = !!c && !done;
              const dd = dayDate(d);
              const isToday = !!dd && dd.getTime() === today.getTime();
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => selectDay(d.id, i)}
                  className={cn(
                    "shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold whitespace-nowrap",
                    activeDayIdx === i
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-foreground/80",
                    isToday && activeDayIdx !== i && "ring-1 ring-primary/40",
                  )}
                >
                  {d.title || `Day ${d.day_index}`}
                  {done && <CheckCircle2 className="ml-1 inline h-3 w-3 text-emerald-500" />}
                  {started && !done && <span className="ml-1 text-[9px] text-amber-500">●</span>}
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
              const label = done ? "Review Workout" : started ? "Continue Workout" : (weekLocked || (isPast === false && !isToday && dd)) ? (isToday ? "Start Workout" : (weekLocked ? "Locked" : "View Workout")) : "Start Workout";
              const Icon = done ? RotateCcw : started ? Play : weekLocked ? Lock : Play;
              const disabled = weekLocked && !done && !started;
              const variant = done ? "outline" : "default";
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
                  isToday && !done && "border-primary ring-2 ring-primary/40",
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
                        {isToday && !done && (
                          <Badge className="h-4 shrink-0 whitespace-nowrap border-primary/40 bg-primary/15 px-1 text-[9px] font-bold text-primary hover:bg-primary/20">
                            Today
                          </Badge>
                        )}
                      </div>
                      {d.focus && (
                        <p className="mt-0.5 break-words text-[11px] text-foreground/70">{d.focus}</p>
                      )}
                      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-foreground/70">
                        {dd && <span className="shrink-0 whitespace-nowrap">{format(dd, "EEE · MMM d")}</span>}
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
                      ) : isPast ? (
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