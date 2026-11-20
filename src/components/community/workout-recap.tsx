import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { FitScale } from "@/components/community/fit-scale";
import { CalendarCheck, ChevronRight, Trophy } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { WeightOther } from "@/components/dual-weight";
import { cn } from "@/lib/utils";
import {
  SCOPE_WORD,
  exerciseBestLines,
  workoutHeadline,
  workoutSubtitle,
  type CommunityPost,
} from "@/lib/community";
import { usePostDetail } from "@/lib/community.queries";
import { useArrivalClass } from "@/hooks/use-arrival";
import {
  recapButtonLabel,
  recapDay,
  recapExercises,
  recapFit,
  recapHighlights,
  shortStatLabel,
  summaryStats,
} from "@/lib/workout-recap";

/** Every exercise row is this tall, so how many fit is a division (recapFit), never a scroll. */
const ROW_H = 48;

/**
 * A workout post's last swipe (Nov 20 2026): the workout itself, as part of
 * the post rather than a page it sends you to. What it was and where it sits
 * in the program, its numbers once each (Time · Sets · Volume · PRs), what it
 * earned, then every exercise with its best set and its records, as many as
 * fit the screen without scrolling (a vertical swipe stays the feed's); the
 * rest, and every set, one tap away on the full workout. The numbers come
 * with the post; the exercises load once the recap is next to the slide on
 * screen (`load`), from the same read the full workout uses, so opening it
 * afterwards is instant. A tap on it does nothing but its button; two taps ❤️
 * like anywhere on the post.
 */
export function WorkoutRecap({
  post,
  unit,
  load,
  onOpenWorkout,
  shrunk = false,
}: {
  post: CommunityPost;
  unit: "kg" | "lb";
  /** Load its exercises (it's on screen, or the next swipe). */
  load: boolean;
  onOpenWorkout: () => void;
  /** Its post's sheet is open: it sits in the small card above it. */
  shrunk?: boolean;
}) {
  const s = post.stats;
  const detail = usePostDetail(load && s ? post.id : null);
  const exercises = recapExercises(detail.data?.exercises);
  const loading = detail.isLoading || (!detail.data && !detail.isError);
  const arrive = useArrivalClass(loading && load);
  // how many exercise rows fit: the room its box has, less everything on the card but the list (none of which depends
  // on the list), so rendering fewer rows never changes the answer
  const boxRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const [room, setRoom] = useState(0);
  useLayoutEffect(() => {
    const box = boxRef.current;
    const card = cardRef.current;
    if (!box || !card || shrunk) return;
    const read = () => {
      const cs = getComputedStyle(box);
      const inner =
        box.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
      const rest = card.offsetHeight - (listRef.current?.offsetHeight ?? 0);
      setRoom(Math.max(0, Math.floor(inner - rest)));
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(box);
    ro.observe(card);
    return () => ro.disconnect();
  }, [shrunk, loading]);
  if (!s) return null;
  const stats = summaryStats(s, unit);
  const highlights = recapHighlights(s);
  const sub = workoutSubtitle(s);
  const day = recapDay(s.completed_at);
  const { shown, hidden } = recapFit(room, ROW_H, exercises.length);
  const anySub = stats.some((t) => t.sub);
  const box: CSSProperties = shrunk
    ? { inset: 0 }
    : {
        top: "calc(var(--feed-bar-room) + 0.75rem)",
        bottom: "var(--feed-words-room, 0px)",
        left: 0,
        right: 0,
      };
  return (
    // its post's sheet open: the small card above it holds what it was and its numbers (the exercises come back with
    // the screen), clear of the "2/2" in its corner
    <div
      ref={boxRef}
      className={cn("absolute flex flex-col justify-center", shrunk ? "p-2.5 pr-12" : "pl-3 pr-16")}
      style={box}
      data-workout-recap={shrunk ? "compact" : "full"}
    >
      <Shrink on={shrunk}>
        <section
          ref={cardRef}
          className="mx-auto flex max-h-full w-full max-w-[440px] flex-col overflow-hidden rounded-2xl bg-muted text-foreground"
          aria-label={`Workout recap: ${workoutHeadline(s)}`}
        >
          <header className="shrink-0 px-4 pt-3.5">
            <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-muted-foreground">
              <span className="inline-flex items-center gap-1 text-success" data-recap-eyebrow>
                <CalendarCheck className="h-3.5 w-3.5" aria-hidden />
                Workout recap
              </span>
              {day && <span className="truncate">{day}</span>}
            </div>
            <h3 className="mt-1.5 line-clamp-2 break-words text-[18px] font-semibold leading-snug tracking-[-0.01em]">
              {workoutHeadline(s)}
            </h3>
            {sub && <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground">{sub}</p>}
          </header>

          {stats.length > 0 && (
            // the numbers in one row at their own widths, a step closer together on a small phone so four still fit
            <dl
              className="mx-4 mt-3 flex shrink-0 flex-wrap gap-x-4 gap-y-2 border-t border-border/70 pt-2.5 min-[380px]:gap-x-5"
              data-recap-stats
            >
              {stats.map((t) => (
                <div key={t.label} className="flex min-w-0 flex-col-reverse">
                  <dt className="text-[11px] text-muted-foreground">{shortStatLabel(t.label)}</dt>
                  {t.sub ? (
                    <WeightOther className="text-[11px] font-medium leading-tight">
                      {t.sub}
                    </WeightOther>
                  ) : anySub ? (
                    <span aria-hidden className="text-[11px] leading-tight">
                      {" "}
                    </span>
                  ) : null}
                  <dd
                    className={cn(
                      "whitespace-nowrap text-[16px] font-semibold leading-tight tabular-nums",
                      t.pr && "text-warning",
                    )}
                  >
                    {t.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}

          {highlights.length > 0 && !shrunk && (
            <div
              className="mx-4 mt-2.5 flex shrink-0 flex-wrap gap-1.5 overflow-hidden [max-height:26px]"
              data-recap-highlights
            >
              {highlights.map((h) => (
                <span
                  key={h.kind}
                  className={cn(
                    "inline-flex h-[26px] max-w-full items-center gap-1 truncate rounded-full px-2.5 text-[12px] font-medium",
                    h.kind === "pr"
                      ? "bg-warning/15 text-warning"
                      : "bg-background/60 text-foreground/80",
                  )}
                  data-recap-highlight={h.kind}
                >
                  {h.kind === "pr" && <Trophy className="h-3.5 w-3.5 shrink-0" aria-hidden />}
                  <span className="truncate">{h.text}</span>
                </span>
              ))}
            </div>
          )}

          {!shrunk && (
            <>
              <div className="mx-4 mt-3 flex shrink-0 items-baseline justify-between gap-3 border-b border-border/70 pb-1.5 text-[12px]">
                <span className="font-semibold">
                  Exercises
                  {exercises.length > 0 && (
                    <span className="ml-1 font-normal text-muted-foreground">
                      {exercises.length}
                    </span>
                  )}
                </span>
                <span className="text-muted-foreground">Best set</span>
              </div>
              <ul
                ref={listRef}
                className={cn("min-h-0 shrink overflow-hidden px-4", arrive)}
                data-recap-exercises
              >
                {loading || !load ? (
                  [0, 1, 2, 3].map((i) => (
                    <li
                      key={i}
                      className="flex items-center gap-3"
                      style={{ height: ROW_H }}
                      aria-hidden
                    >
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <Skeleton className="h-3.5 w-3/5 rounded" />
                        <Skeleton className="h-3 w-1/4 rounded" />
                      </div>
                      <Skeleton className="h-3.5 w-16 rounded" />
                    </li>
                  ))
                ) : detail.isError ? (
                  <li
                    className="flex items-center text-[13px] text-muted-foreground"
                    style={{ height: ROW_H }}
                  >
                    Couldn't load the exercises.
                  </li>
                ) : exercises.length === 0 ? (
                  <li
                    className="flex items-center text-[13px] text-muted-foreground"
                    style={{ height: ROW_H }}
                  >
                    Every set is on the full workout.
                  </li>
                ) : (
                  // only the rows that fit whole; the rest are counted on the button
                  exercises.slice(0, shown).map((e, i) => {
                    const best = exerciseBestLines(e, unit);
                    return (
                      <li
                        key={`${e.name}-${i}`}
                        className="flex items-center gap-3"
                        style={{ height: ROW_H }}
                        data-recap-exercise
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[14px] font-medium leading-tight">
                            {e.name}
                          </div>
                          <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[12px] leading-tight text-muted-foreground">
                            <span className="shrink-0">
                              {e.sets} {e.sets === 1 ? "set" : "sets"}
                            </span>
                            {e.pr && (
                              <span
                                className="inline-flex min-w-0 items-center gap-1 font-medium text-warning"
                                data-recap-pr
                              >
                                <Trophy className="h-3 w-3 shrink-0" aria-hidden />
                                <span className="truncate">{SCOPE_WORD[e.pr]}</span>
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="whitespace-nowrap text-[14px] font-semibold leading-tight tabular-nums">
                            {best.main}
                          </div>
                          {best.other && (
                            <div className="mt-0.5 whitespace-nowrap text-[11px] leading-tight tabular-nums text-muted-foreground">
                              {best.other}
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })
                )}
              </ul>
            </>
          )}

          <div className="shrink-0 px-3 pb-3 pt-2">
            <button
              type="button"
              // its own tap opens at once; the post around it waits out a double tap (❤️)
              onClick={(e) => {
                e.stopPropagation();
                onOpenWorkout();
              }}
              className="flex h-10 w-full items-center justify-center gap-1 rounded-xl bg-background/60 text-[13px] font-semibold text-foreground transition-colors active:bg-background/90"
              data-recap-open
            >
              {recapButtonLabel(exercises.length, loading ? 0 : hidden)}
              <ChevronRight className="h-4 w-4 opacity-70" aria-hidden />
            </button>
          </div>
        </section>
      </Shrink>
    </div>
  );
}

/** The compact card above an open sheet scales to its room (FitScale); on the screen the card fits its rows instead. */
function Shrink({ on, children }: { on: boolean; children: ReactNode }) {
  return on ? <FitScale>{children}</FitScale> : <>{children}</>;
}
