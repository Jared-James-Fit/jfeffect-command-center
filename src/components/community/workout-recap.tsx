import { useLayoutEffect, useRef, useState } from "react";
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
  recapKeyLifts,
  recapMeta,
  recapMoreLabel,
  recapPr,
  splitBestSet,
} from "@/lib/workout-recap";

/** A lift row's height on the slide, between these: more room gives each lift more air, never more lifts than fit. */
const ROW_MIN = 60;
const ROW_MAX = 92;
/** At most this many exercises and the slide shows them big (one or two lifts), never a short list in a tall space. */
const FEATURE_MAX = 2;

/**
 * A workout post's last swipe (Nov 20 2026; full canvas Nov 21 2026): a slide
 * of the post like its clips, the whole screen edge to edge (Crew's bar and
 * the "7/7" over its top, the post's words and buttons over its foot), never a
 * card floating in it. Its name and one quiet line (how long, how many sets)
 * at the top; its key lifts in the middle, each with its best set as the big
 * number in the unit it was typed in (the other unit is in the sheet), the
 * headline PR loud in amber and any other record quiet, as many as fit (at
 * most four), spaced to the room the screen has; one or two exercises are
 * shown big instead of as a short list. Every set is one tap away at its foot
 * ("All 6 exercises ›"), in the post's sheet (Workout | Comments) over the
 * post, so closing it lands back on this slide; a tap anywhere on it opens the
 * same (after the double-tap window, so two taps still ❤️). Its exercises load
 * once it's the next swipe (`load`), from the read the sheet uses.
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
  const feature = exercises.length > 0 && exercises.length <= FEATURE_MAX;

  // how many lifts fit, and how tall each is: the room the middle has, divided among them (ROW_MIN–ROW_MAX); a row
  // that doesn't fit whole is left for the sheet. Read from the middle's own box, which never depends on its rows
  const middle = useRef<HTMLDivElement | null>(null);
  const list = useRef<HTMLUListElement | null>(null);
  const [room, setRoom] = useState(0);
  // lifts dropped because the list still ran past its room (a long name on two lines): never a row cut in half
  const [over, setOver] = useState(0);
  useLayoutEffect(() => {
    const el = middle.current;
    if (!el || shrunk) return;
    const read = () => {
      setRoom(el.clientHeight);
      setOver(0);
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [shrunk]);
  // a list row may take two lines for a long name: count on the taller row so nothing is cut
  const cap = Math.max(
    1,
    (room > 0 ? Math.min(RECAP_MAX_LIFTS, Math.floor(room / ROW_MIN)) : RECAP_MAX_LIFTS) - over,
  );
  const lifts = s ? recapKeyLifts(exercises, s, feature ? FEATURE_MAX : cap) : [];
  const rowH =
    lifts.length && room > 0
      ? Math.min(ROW_MAX, Math.max(ROW_MIN, Math.floor(room / lifts.length)))
      : ROW_MIN;
  useLayoutEffect(() => {
    const ul = list.current;
    if (!ul || feature || room <= 0 || lifts.length <= 1) return;
    if (ul.offsetHeight > room + 1) setOver((o) => o + 1);
    // each drop is a smaller list, so this stops (at one lift at most)
  }, [feature, room, lifts.length, loading]);

  if (!s) return null;
  const meta = recapMeta(s);
  const title = workoutHeadline(s);

  if (shrunk) {
    // its post's sheet open: the small card above it is the name and its line, laid out at a phone card's width and
    // scaled to fit, under the "7/7" at its top
    return (
      <div
        className="absolute inset-0 bg-card px-2.5 pb-2.5 pt-8 text-foreground"
        data-workout-recap="compact"
      >
        <FitScale width={300}>
          <div className="px-1" data-recap-card>
            <h3
              className="line-clamp-2 break-words text-[20px] font-semibold leading-tight tracking-[-0.01em]"
              data-recap-title
            >
              {title}
            </h3>
            {meta && (
              <p className="mt-1 text-[14px] text-muted-foreground" data-recap-meta>
                {meta}
              </p>
            )}
          </div>
        </FitScale>
      </div>
    );
  }

  return (
    // the whole slide, edge to edge like a clip that fills the screen; what's on it sits between Crew's bar and the
    // post's words, clear of the buttons down the right
    <div
      className="absolute inset-0 bg-card text-foreground"
      data-workout-recap="full"
      data-recap-card
      aria-label={`Workout: ${title}`}
    >
      <div
        className="absolute inset-x-0 flex flex-col pl-5 pr-16"
        style={{
          top: "calc(var(--feed-bar-room) + 0.75rem)",
          bottom: "calc(var(--feed-words-room, 0px) + 0.25rem)",
        }}
      >
        <header className="shrink-0">
          <h3
            className="line-clamp-3 break-words text-[26px] font-semibold leading-[1.12] tracking-[-0.02em]"
            data-recap-title
          >
            {title}
          </h3>
          {meta && (
            <p className="mt-2 text-[15px] text-muted-foreground" data-recap-meta>
              {meta}
            </p>
          )}
        </header>

        {/* the key lifts, in the room between the name and the way to every set */}
        <div
          ref={middle}
          className="mt-6 flex min-h-0 flex-1 flex-col overflow-hidden"
          data-recap-exercises
        >
          {loading || !load ? (
            <ul aria-hidden className="space-y-6 pt-2">
              {[0, 1, 2].map((i) => (
                <li key={i} className="flex items-center gap-4">
                  <Skeleton className="h-4 w-2/5 rounded" />
                  <span className="flex-1" />
                  <Skeleton className="h-5 w-20 rounded" />
                </li>
              ))}
            </ul>
          ) : detail.isError ? (
            <p className="pt-2 text-[15px] text-muted-foreground">
              Couldn't load the lifts. Tap to see the workout.
            </p>
          ) : feature ? (
            // one or two exercises: each its own block, the best set big
            <ul className={cn("my-auto flex flex-col gap-9", arrive)}>
              {lifts.map(({ exercise: e, index }) => {
                const best = splitBestSet(exerciseBestLines(e, unit).main);
                const pr = recapPr(e, s);
                return (
                  <li key={`${e.name}-${index}`} data-recap-exercise>
                    <div className="break-words text-[18px] font-medium leading-snug text-foreground/80">
                      {e.name}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 tabular-nums">
                      <Load
                        text={best.big}
                        className={cn(
                          "font-semibold leading-none tracking-[-0.02em]",
                          lifts.length === 1 ? "text-[56px]" : "text-[44px]",
                        )}
                        unitClassName={lifts.length === 1 ? "text-[24px]" : "text-[20px]"}
                      />
                      {best.small && (
                        <span className="text-[22px] font-medium text-foreground/70">
                          {best.small}
                        </span>
                      )}
                    </div>
                    {pr && <PrTag pr={pr} className="mt-2.5" />}
                  </li>
                );
              })}
            </ul>
          ) : (
            // three or more: the ones that matter most, one row each, given the room there is
            <ul ref={list} className={cn("my-auto", arrive)}>
              {lifts.map(({ exercise: e, index }) => {
                const best = splitBestSet(exerciseBestLines(e, unit).main);
                const pr = recapPr(e, s);
                return (
                  <li
                    key={`${e.name}-${index}`}
                    className="flex items-center gap-4 border-t border-border/50 first:border-t-0"
                    style={{ minHeight: rowH }}
                    data-recap-exercise
                  >
                    <div className="min-w-0 flex-1 py-2">
                      <div className="line-clamp-2 break-words text-[17px] font-medium leading-snug">
                        {e.name}
                      </div>
                      {pr && <PrTag pr={pr} className="mt-1" />}
                    </div>
                    <div className="shrink-0 whitespace-nowrap text-right tabular-nums">
                      <Load
                        text={best.big}
                        className="text-[24px] font-semibold leading-none tracking-[-0.01em]"
                        unitClassName="text-[15px]"
                      />
                      {best.small && (
                        <span className="ml-1.5 text-[16px] font-medium text-foreground/70">
                          {best.small}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* the way to every set, quiet, just above the post's words */}
        <button
          type="button"
          // its own tap opens at once; the rest of the slide waits out a double tap (❤️), PostCard's onHeroTap
          onClick={(e) => {
            e.stopPropagation();
            onOpenWorkout();
          }}
          className="-ml-1 mt-3 inline-flex h-11 shrink-0 items-center gap-1 self-start rounded-full px-1 text-[15px] font-medium text-foreground/75 transition-colors active:text-foreground"
          data-recap-open
        >
          {recapMoreLabel(exercises.length, loading ? exercises.length : lifts.length)}
          <ChevronRight className="h-[18px] w-[18px]" aria-hidden />
        </button>
      </div>
    </div>
  );
}

/** A load as the big number with its unit a step smaller ("455" "lb"); anything else as it is. */
function Load({
  text,
  className,
  unitClassName,
}: {
  text: string;
  className: string;
  unitClassName: string;
}) {
  const m = /^(.*\d)\s(lb|kg)$/.exec(text);
  if (!m) return <span className={className}>{text}</span>;
  return (
    <span className={className}>
      {m[1]}
      <span className={cn("ml-1 font-medium text-foreground/80", unitClassName)}>{m[2]}</span>
    </span>
  );
}

/** A record on the slide: the workout's headline PR in amber with the trophy, any other record said quietly. */
function PrTag({ pr, className }: { pr: { label: string; loud: boolean }; className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center gap-1 text-[13px] leading-tight",
        pr.loud ? "font-semibold text-warning" : "text-muted-foreground",
        className,
      )}
      data-recap-pr={pr.loud ? "headline" : "quiet"}
    >
      {pr.loud && <Trophy className="h-3.5 w-3.5 shrink-0" aria-hidden />}
      {pr.label}
    </div>
  );
}
