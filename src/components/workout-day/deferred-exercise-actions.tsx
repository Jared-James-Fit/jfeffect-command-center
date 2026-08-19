import { lazy, Suspense, useState } from "react";
import { ArrowLeftRight, History, Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";

const LazyExerciseHistorySheet = lazy(() => import("./deferred-exercise-history-sheet"));
const LazyExerciseHowToSheet = lazy(() => import("./deferred-exercise-how-to-sheet"));
const LazyQuickSwapButton = lazy(() =>
  import("./QuickSwapButton").then((module) => ({ default: module.QuickSwapButton })),
);

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
  if (!clientId || (!exerciseId && !exerciseName)) return null;

  if (!requested) {
    return (
      <Button
        size="sm"
        variant="outline"
        className={className ?? "w-auto h-7 rounded-full px-2.5 text-xs"}
        onClick={() => setRequested(true)}
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
}: {
  exerciseId: string | null;
  fallbackName: string;
}) {
  const [requested, setRequested] = useState(false);

  if (!requested) {
    return (
      <Button
        size="sm"
        variant="outline"
        onClick={() => setRequested(true)}
        className="h-7 rounded-full px-2.5 text-xs"
      >
        <Play className="mr-1 h-3 w-3 fill-current" /> How&nbsp;To
      </Button>
    );
  }

  return (
    <Suspense fallback={<LoadingAction>Loading guide…</LoadingAction>}>
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
