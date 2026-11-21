import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { FitScale } from "@/components/community/fit-scale";
import { ChevronRight, Trophy } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { exerciseBestLines, workoutHeadline, type CommunityPost } from "@/lib/community";
import { usePostDetail } from "@/lib/community.queries";
import { useArrivalClass } from "@/hooks/use-arrival";
import {
  RECAP_MAX_LIFTS,
  recapExercises,
  recapFit,
  recapKeyLifts,
  recapMeta,
  recapMoreLabel,
  recapPr,
} from "@/lib/workout-recap";

/** Every lift row is this tall, so how many fit is a division (recapFit), never a scroll. */
const ROW_H = 52;

/**
 * A workout post's last swipe (Nov 20 2026, compact Nov 21 2026): a glance at
 * the workout, never a page of it. Its name, one quiet line (the day, how
 * long, how many sets), then its key lifts with their best sets (the
 * headline PR loud in amber, any other record quiet), at most four and only
 * as many as fit without scrolling (a vertical swipe stays the feed's). Every
 * set is one tap away in the post's sheet (Workout | Comments), which opens
 * over the post, so closing it lands back on this slide with the post as it
 * was: a tap anywhere on the card opens it (after the double-tap window, so
 * two taps still ❤️), its quiet last row at once. The exercises load once the
 * recap is next to the slide on screen (`load`), from the same read the sheet
 * uses, so the sheet opens with them.
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
  /** Its post's sheet is open: it sits in the small card above it (the name and its line only). */
  shrunk?: boolean;
}) {
  const s = post.stats;
  const detail = usePostDetail(load && s ? post.id : null);
  const exercises = recapExercises(detail.data?.exercises);
  const loading = detail.isLoading || (!detail.data && !detail.isError);
  const arrive = useArrivalClass(loading && load);
  // how many lift rows fit: the room its box has, less everything on the card but the list (none of which depends
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
  const meta = recapMeta(s);
  const { shown } = recapFit(room, ROW_H, Math.min(RECAP_MAX_LIFTS, exercises.length));
  const lifts = recapKeyLifts(exercises, s, shown);
  const box: CSSProperties = shrunk
    ? { inset: 0 }
    : {
        top: "calc(var(--feed-bar-room) + 0.75rem)",
        bottom: "var(--feed-words-room, 0px)",
        left: 0,
        right: 0,
      };
  return (
    // its post's sheet open: the small card above it is the name and its line, under the "7/7" at its top
    <div
      ref={boxRef}
      className={cn(
        "absolute flex flex-col justify-center",
        shrunk ? "px-2.5 pb-2.5 pt-8" : "pl-3 pr-16",
      )}
      style={box}
      data-workout-recap={shrunk ? "compact" : "full"}
    >
      <Shrink on={shrunk}>
        <section
          ref={cardRef}
          className="mx-auto flex max-h-full w-full max-w-[420px] flex-col overflow-hidden rounded-2xl bg-muted text-foreground"
          aria-label={`Workout: ${workoutHeadline(s)}`}
          data-recap-card
        >
          <header className={cn("shrink-0 px-4", shrunk ? "py-3.5" : "pb-1 pt-4")}>
            <h3
              className="line-clamp-2 break-words text-[19px] font-semibold leading-snug tracking-[-0.01em]"
              data-recap-title
            >
              {workoutHeadline(s)}
            </h3>
            {meta && (
              <p className="mt-1 truncate text-[13px] text-muted-foreground" data-recap-meta>
                {meta}
              </p>
            )}
          </header>

          {!shrunk && (
            <ul
              ref={listRef}
              className={cn("min-h-0 shrink overflow-hidden px-4", arrive)}
              data-recap-exercises
            >
              {loading || !load ? (
                [0, 1, 2].map((i) => (
                  <li
                    key={i}
                    className="flex items-center gap-3 border-t border-border/60 first:border-t-0"
                    style={{ height: ROW_H }}
                    aria-hidden
                  >
                    <Skeleton className="h-3.5 w-2/5 rounded" />
                    <span className="flex-1" />
                    <Skeleton className="h-3.5 w-16 rounded" />
                  </li>
                ))
              ) : detail.isError ? (
                <li
                  className="flex items-center text-[13px] text-muted-foreground"
                  style={{ height: ROW_H }}
                >
                  Couldn't load the lifts.
                </li>
              ) : (
                // the key lifts that fit whole, in the order they were trained; the rest are on the sheet
                lifts.map(({ exercise: e, index }) => {
                  const best = exerciseBestLines(e, unit);
                  const pr = recapPr(e, s);
                  return (
                    <li
                      key={`${e.name}-${index}`}
                      className="flex items-center gap-3 border-t border-border/60 first:border-t-0"
                      style={{ height: ROW_H }}
                      data-recap-exercise
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[15px] font-medium leading-tight">
                          {e.name}
                        </div>
                        {pr && (
                          <div
                            className={cn(
                              "mt-0.5 flex min-w-0 items-center gap-1 text-[12px] leading-tight",
                              pr.loud ? "font-semibold text-warning" : "text-muted-foreground",
                            )}
                            data-recap-pr={pr.loud ? "headline" : "quiet"}
                          >
                            {pr.loud && <Trophy className="h-3 w-3 shrink-0" aria-hidden />}
                            <span className="truncate">{pr.label}</span>
                          </div>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="whitespace-nowrap text-[15px] font-semibold leading-tight tabular-nums">
                          {best.main}
                        </div>
                        {best.other && (
                          <div className="mt-0.5 whitespace-nowrap text-[11.5px] leading-tight tabular-nums text-muted-foreground">
                            {best.other}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })
              )}
            </ul>
          )}

          {!shrunk && (
            <button
              type="button"
              // its own tap opens at once; the rest of the card waits out a double tap (❤️), PostCard's onHeroTap
              onClick={(e) => {
                e.stopPropagation();
                onOpenWorkout();
              }}
              className="flex h-11 w-full shrink-0 items-center justify-between gap-2 border-t border-border/60 px-4 text-[13px] font-medium text-muted-foreground transition-colors active:bg-foreground/5"
              data-recap-open
            >
              <span>
                {recapMoreLabel(exercises.length, loading ? exercises.length : lifts.length)}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
            </button>
          )}
        </section>
      </Shrink>
    </div>
  );
}

/**
 * The compact card above an open sheet: laid out at a phone card's width and scaled to its room (FitScale), so the
 * name keeps its lines however narrow the post's card is; on the screen the card fits its rows instead.
 */
function Shrink({ on, children }: { on: boolean; children: ReactNode }) {
  return on ? <FitScale width={300}>{children}</FitScale> : <>{children}</>;
}
