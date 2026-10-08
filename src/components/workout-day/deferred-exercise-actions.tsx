import { Suspense, useEffect, useState } from "react";
import { ArrowLeftRight, History, Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { chunkFailureAction, lazyWithRetry, type ChunkFallbackContext } from "@/lib/lazy-chunk";

// A failed chunk fetch stays inside the action row as a small retry chip; it
// never escalates to the full-page reload screen.
function ActionChunkFallback(ctx: ChunkFallbackContext) {
  const action = chunkFailureAction(ctx);
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="h-7 rounded-full px-2.5 text-xs"
      onClick={action.run}
    >
      {ctx.failures >= 2 ? action.label : `Couldn\u2019t load \u00b7 ${action.label}`}
    </Button>
  );
}

const chunkOptions = { fallback: ActionChunkFallback };

const LazyExerciseHistorySheet = lazyWithRetry(() => import("./deferred-exercise-history-sheet"), chunkOptions);
const LazyExerciseHowToSheet = lazyWithRetry(() => import("./deferred-exercise-how-to-sheet"), chunkOptions);
const LazyQuickSwapButton = lazyWithRetry(
  () => import("./QuickSwapButton").then((module) => ({ default: module.QuickSwapButton })),
  chunkOptions,
);

let idlePreloadScheduled = false;

/**
 * Fetch the small secondary sheets while the logger is idle so the first tap
 * opens instantly instead of waiting on the network. Quick Swap is large, so it
 * is only preloaded on touch-down. Runs once per page load.
 */
function useIdleActionPreload() {
  useEffect(() => {
    if (idlePreloadScheduled || typeof window === "undefined") return;
    idlePreloadScheduled = true;
    const run = () => {
      void LazyExerciseHowToSheet.preload();
      void LazyExerciseHistorySheet.preload();
    };
    const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void })
      .requestIdleCallback;
    if (typeof idle === "function") idle(run, { timeout: 4000 });
    else window.setTimeout(run, 1500);
  }, []);
}

function LoadingAction({ children }: { children: string }) {
  return (
    <Button size="sm" variant="outline" disabled className="h-7 rounded-full px-2.5 text-xs">
      <Loader2 className="mr-1 h-3 w-3 animate-spin" /> {children}
    </Button>
  );
}

export function DeferredExerciseHistoryButton({
  clientId,
  exerciseId,
  exerciseName,
  displayUnit,
  currentDayIndex,
  className,
}: {
  clientId: string | null | undefined;
  exerciseId: string | null | undefined;
  exerciseName: string;
  displayUnit?: "kg" | "lb";
  currentDayIndex?: number | null;
  className?: string;
}) {
  const [requested, setRequested] = useState(false);
  useIdleActionPreload();
  if (!clientId || (!exerciseId && !exerciseName)) return null;

  if (!requested) {
    return (
      <Button
        size="sm"
        variant="outline"
        className={className ?? "w-auto h-7 rounded-full px-2.5 text-xs"}
        onClick={() => setRequested(true)}
        onPointerDown={() => void LazyExerciseHistorySheet.preload()}
      >
        <History className="mr-1 h-3 w-3" /> History
      </Button>
    );
  }

  return (
    <Suspense fallback={<LoadingAction>Loading history…</LoadingAction>}>
      <LazyExerciseHistorySheet
        clientId={clientId}
        exerciseId={exerciseId}
        exerciseName={exerciseName}
        displayUnit={displayUnit}
        currentDayIndex={currentDayIndex}
        onClose={() => setRequested(false)}
      />
    </Suspense>
  );
}

export function DeferredExerciseHowToButton({
  exerciseId,
  fallbackName,
  className,
}: {
  exerciseId: string | null;
  fallbackName: string;
  className?: string;
}) {
  const [requested, setRequested] = useState(false);
  useIdleActionPreload();

  const button = (loading: boolean) => (
    <Button
      size="sm"
      variant="outline"
      onClick={() => setRequested(true)}
      onPointerDown={() => void LazyExerciseHowToSheet.preload()}
      onFocus={() => void LazyExerciseHowToSheet.preload()}
      aria-busy={loading || undefined}
      className={className ?? "h-7 rounded-full px-2.5 text-xs"}
    >
      {loading ? (
        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
      ) : (
        <Play className="mr-1 h-3 w-3 fill-current" />
      )}{" "}
      How&nbsp;To
    </Button>
  );

  if (!requested) return button(false);

  // While the sheet resolves, keep the very same button in place (spinner in
  // the icon slot) so the action row never jumps.
  return (
    <Suspense fallback={button(true)}>
      <LazyExerciseHowToSheet
        exerciseId={exerciseId}
        fallbackName={fallbackName}
        onClose={() => setRequested(false)}
      />
    </Suspense>
  );
}

export function DeferredQuickSwapButton(props: {
  rowId: string;
  exerciseId: string | null;
  exerciseName: string;
  muscleGroup?: string | null;
  category?: string | null;
  equipment?: string | null;
  difficulty?: string | null;
  swapContext?:
    | { kind: "client" }
    | {
        kind: "member";
        enrollmentId: string;
        weekIndex: number;
        dayIndex: number;
        exerciseIndex: number;
      };
}) {
  const [requested, setRequested] = useState(false);

  if (!requested) {
    return (
      <Button
        size="sm"
        variant="outline"
        onClick={() => setRequested(true)}
        onPointerDown={() => void LazyQuickSwapButton.preload()}
        className="h-7 rounded-full px-2.5 text-xs"
        aria-label={`Quick swap ${props.exerciseName}`}
      >
        <ArrowLeftRight className="mr-1 h-3 w-3" /> Swap
      </Button>
    );
  }

  return (
    <Suspense fallback={<LoadingAction>Loading swaps…</LoadingAction>}>
      <LazyQuickSwapButton
        {...props}
        open
        hideTrigger
        onOpenChange={(open) => {
          if (!open) setRequested(false);
        }}
      />
    </Suspense>
  );
}
