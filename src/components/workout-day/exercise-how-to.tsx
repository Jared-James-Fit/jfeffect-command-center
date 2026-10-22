import { Component, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Play, RotateCcw } from "lucide-react";
import { exerciseVideoSetGlobalQuery } from "@/hooks/use-exercise-video-set";
import { exerciseGuideQuery, guideVideoUrl, type ExerciseGuide } from "@/lib/exercise-guide";
import type { VideoSet } from "@/lib/exercise-video";
import { warmDemoPlayer } from "@/lib/demo-video";
import { ExerciseDemoVideo } from "@/components/exercise-demo-video";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

/**
 * How To on an exercise card: the demo, cues and mistakes in a sheet over the
 * workout. It's part of the logger itself (no code to fetch on the tap, so it
 * opens in the same frame and a stale build after a publish can't break it),
 * the button stays where it is while the sheet is up (the row never shifts),
 * and the demo opens as a cover with Play: the Vimeo / YouTube player and the
 * phone's audio switch only start on that tap (ExerciseDemoVideo).
 */
export function ExerciseHowToButton({
  exerciseId,
  fallbackName,
  className,
}: {
  exerciseId: string | null;
  fallbackName: string;
  className?: string;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  // Mounted from the first tap on, so closing slides the sheet away instead of cutting it.
  const [used, setUsed] = useState(false);
  // Touch-down starts what the sheet needs: the guide (video link, cues), which
  // video set is live, and the connection to the player.
  const warm = () => {
    warmDemoPlayer();
    void qc.prefetchQuery(exerciseGuideQuery(exerciseId, fallbackName));
    void qc.prefetchQuery(exerciseVideoSetGlobalQuery);
  };

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        data-how-to
        onPointerDown={warm}
        onFocus={warm}
        onClick={() => {
          warm();
          setUsed(true);
          setOpen(true);
        }}
        className={className ?? "h-7 rounded-full px-2.5 text-xs"}
      >
        <Play className="mr-1 h-3 w-3 fill-current" /> How&nbsp;To
      </Button>
      {used && (
        <ExerciseHowToSheet open={open} onOpenChange={setOpen} exerciseId={exerciseId} fallbackName={fallbackName} />
      )}
    </>
  );
}

function ExerciseHowToSheet({
  open,
  onOpenChange,
  exerciseId,
  fallbackName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  exerciseId: string | null;
  fallbackName: string;
}) {
  // Usually already cached: the button starts both on touch-down.
  const guide = useQuery(exerciseGuideQuery(exerciseId, fallbackName));
  const videoSet = useQuery(exerciseVideoSetGlobalQuery);
  const exercise = guide.data ?? null;
  const name = exercise?.name ?? fallbackName;
  const close = () => onOpenChange(false);
  const details = [exercise?.category, exercise?.muscle_group].filter(Boolean).join(" · ");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        hideCloseButton
        data-how-to-sheet
        className="h-[92vh] overflow-y-auto overscroll-contain p-0 sm:mx-auto sm:max-w-xl sm:rounded-t-2xl"
      >
        {/* Solid bars: a blur over the player made the slide-in heavier. */}
        <SheetHeader className="sticky top-0 z-10 border-b bg-background px-5 pb-3 pt-3 text-left">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" className="h-10 shrink-0 rounded-full px-3" onClick={close}>
              <ArrowLeft className="mr-1 h-4 w-4" /> Back
            </Button>
            <SheetTitle className="min-w-0 truncate text-base font-black">{name}</SheetTitle>
          </div>
          {details ? (
            <SheetDescription className="text-xs">{details}</SheetDescription>
          ) : (
            <SheetDescription className="sr-only">How to do {name}</SheetDescription>
          )}
        </SheetHeader>
        <GuideBoundary>
          <GuideBody
            exercise={exercise}
            globalSet={videoSet.data ?? null}
            loading={guide.isPending || videoSet.isPending}
            failed={guide.isError && !exercise}
            onRetry={() => void guide.refetch()}
            name={name}
          />
        </GuideBoundary>
        <div className="sticky bottom-0 left-0 right-0 border-t bg-background px-5 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3">
          <Button className="h-12 w-full" size="lg" onClick={close}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Workout
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** The sheet's contents: the demo (a cover until Play is tapped), cues, mistakes. */
function GuideBody({
  exercise,
  globalSet,
  loading,
  failed,
  onRetry,
  name,
}: {
  exercise: ExerciseGuide | null;
  globalSet: VideoSet | null;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  name: string;
}) {
  // Not uploaded yet: the closest exercise's demo, labelled as such. Both
  // queries settle first so the cover never shows one video and switches.
  const ownUrl = guideVideoUrl(exercise, globalSet);
  const borrowed = !ownUrl ? exercise?.borrowed ?? null : null;
  const borrowedUrl = borrowed ? guideVideoUrl(borrowed, globalSet) : null;
  const videoUrl = ownUrl ?? borrowedUrl;

  let video: ReactNode;
  if (failed) {
    video = (
      <div className="grid aspect-video w-full place-items-center rounded-xl border bg-muted/40 px-6 text-center text-sm text-muted-foreground">
        <div className="flex flex-col items-center gap-2.5">
          Couldn't load this guide.
          <Button type="button" size="sm" variant="outline" className="h-10 rounded-full px-4" onClick={onRetry}>
            <RotateCcw className="mr-1.5 h-4 w-4" /> Try again
          </Button>
        </div>
      </div>
    );
  } else if (loading) {
    // The player's own look, so the swap to the cover is seamless.
    video = (
      <div className="grid aspect-video w-full place-items-center rounded-xl border bg-black" aria-label="Loading exercise guide">
        <Loader2 className="h-6 w-6 animate-spin text-white/70" />
      </div>
    );
  } else if (!videoUrl) {
    video = (
      <div className="grid aspect-video w-full place-items-center rounded-xl border border-dashed bg-black/40 text-sm text-muted-foreground">
        Video coming soon.
      </div>
    );
  } else {
    video = (
      <div className="space-y-1.5">
        <ExerciseDemoVideo url={videoUrl} title={`${name} video`} />
        {borrowedUrl && borrowed && (
          <p data-borrowed-demo className="text-[12px] leading-snug text-muted-foreground">
            Showing the <span className="font-semibold text-foreground">{borrowed.name}</span> demo: same movement. This exercise's own video is on its way.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4 px-5 py-4">
      {video}
      {exercise?.cues && <GuideText title="Coaching cues" value={exercise.cues} />}
      {exercise?.common_mistakes && <GuideText title="Common mistakes" value={exercise.common_mistakes} />}
      {exercise?.muscle_group && <GuideText title="Muscles worked" value={exercise.muscle_group} />}
    </div>
  );
}

function GuideText({ title, value }: { title: string; value: string | string[] }) {
  return (
    <section>
      <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{title}</h3>
      <p className="mt-1 whitespace-pre-wrap text-[15px] leading-relaxed">
        {Array.isArray(value) ? value.join("\n• ") : value}
      </p>
    </section>
  );
}

/**
 * Anything that breaks inside the guide stays in the sheet. Without it the
 * error reached the logger's own boundary, which swaps the whole workout for
 * "Workout didn't load properly".
 */
class GuideBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    // eslint-disable-next-line no-console
    console.error("[how-to] guide crashed", error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="px-5 py-8 text-center text-sm text-muted-foreground">
        <p>Couldn't show this guide.</p>
        <Button type="button" size="sm" variant="outline" className="mt-3 h-10 rounded-full px-4" onClick={() => this.setState({ error: null })}>
          <RotateCcw className="mr-1.5 h-4 w-4" /> Try again
        </Button>
      </div>
    );
  }
}
