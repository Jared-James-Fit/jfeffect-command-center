/**
 * The way into a set video's bar path & speed: one quiet line under the clip
 * (the set video's sheet, its card in the coach chat). It says the set's
 * read once there is one ("Bar path · 3 reps · best 0.53 m/s · 31% velocity
 * loss"), how far a read on this phone has got while it runs, or offers
 * "Analyze bar path" for a barbell lift. Nothing for an exercise without a
 * bar. The full view loads only when it's opened.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Activity, ChevronRight } from "lucide-react";
import { importWithRetry } from "@/lib/chunk-import";
import { analysableExercise } from "@/lib/lift-analysis/exercise";
import { summaryLine } from "@/lib/lift-analysis/format";
import { useSetVideoAnalyses } from "@/lib/lift-analysis/queries";
import { useRunningAnalysis } from "@/lib/lift-analysis/store";
import { cn } from "@/lib/utils";

type ViewComponent = (typeof import("@/components/lift-analysis/lift-analysis-view"))["default"];
let View: ViewComponent | null = null;
const loadView = (): Promise<ViewComponent> =>
  View
    ? Promise.resolve(View)
    : importWithRetry(() => import("@/components/lift-analysis/lift-analysis-view")).then(
        (m) => (View = m.default),
      );

export function LiftAnalysisEntry({
  setVideoId,
  src,
  poster,
  exerciseName,
  setLabel,
  className,
}: {
  setVideoId: string;
  src?: string;
  poster?: string;
  exerciseName: string;
  setLabel?: string;
  className?: string;
}) {
  const { data } = useSetVideoAnalyses([setVideoId]);
  const saved = data?.[setVideoId] ?? null;
  const running = useRunningAnalysis(setVideoId);
  const [open, setOpen] = useState(false);
  const [, setLoaded] = useState(0);
  const barbell = analysableExercise(exerciseName);
  if (!saved && !running && !barbell) return null;

  const openView = () => {
    if (View) return setOpen(true);
    loadView()
      .then(() => {
        setLoaded((n) => n + 1);
        setOpen(true);
      })
      .catch(() =>
        toast.error("That couldn't open without a connection. Try again once you have signal."),
      );
  };

  const label = running
    ? `Reading bar path… ${Math.round(100 * ((["opening", "finding", "tracking", "reading"].indexOf(running.stage) + running.progress) / 4))}%`
    : saved
      ? `Bar path · ${summaryLine(saved.result)}`
      : "Analyze bar path";

  return (
    <>
      <button
        type="button"
        onPointerDown={() => void loadView().catch(() => {})}
        onClick={openView}
        className={cn(
          "flex h-10 w-full min-w-0 items-center gap-2 rounded-lg px-1 text-left text-sm",
          saved ? "text-foreground" : "text-muted-foreground hover:text-foreground",
          className,
        )}
        data-lift-analysis-entry={saved ? "done" : running ? "running" : "offer"}
      >
        <Activity className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate tabular-nums">{label}</span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
      {View && open && (
        <View
          open={open}
          onOpenChange={setOpen}
          setVideoId={setVideoId}
          src={src}
          poster={poster}
          exerciseName={exerciseName}
          setLabel={setLabel}
          startOnOpen={!saved && !running}
        />
      )}
    </>
  );
}
