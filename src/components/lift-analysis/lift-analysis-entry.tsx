/**
 * The way into a set video's bar path & speed: one quiet line under the clip
 * (the set video's sheet, its card in the coach chat). It says the set's
 * read once there is one ("Bar path · 5 reps · avg 0.21 m/s · 18% velocity
 * loss"), how far a read on this phone has got while it runs, that the bar
 * needs a look when it wasn't sure on its own, or offers "Analyze bar path"
 * for a barbell lift. Nothing for an exercise without a
 * bar. The full view loads only when it's opened.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Activity, ChevronRight, PenLine } from "lucide-react";
import { useChatSignedUrl } from "@/hooks/use-chat-signed-urls";
import { noteClock } from "@/lib/lift-analysis/film-notes";
import { importWithRetry } from "@/lib/chunk-import";
import { analysableExercise } from "@/lib/lift-analysis/exercise";
import { summaryLine } from "@/lib/lift-analysis/format";
import { isRead, useSetVideoAnalyses } from "@/lib/lift-analysis/queries";
import { overallProgress } from "@/lib/lift-analysis/progress";
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
  const stored = data?.[setVideoId] ?? null;
  const saved = isRead(stored) ? stored : null;
  // tried on its own: the plate needs a tap, or the video couldn't be read on that phone
  const notRead =
    stored && !saved ? (stored.status === "needs_tap" ? "needs_tap" : "failed") : null;
  const running = useRunningAnalysis(setVideoId);
  const [open, setOpen] = useState(false);
  const [, setLoaded] = useState(0);
  const barbell = analysableExercise(exerciseName);
  if (!stored && !running && !barbell) return null;

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
    ? `Reading bar path… ${Math.round(100 * overallProgress(running))}%`
    : saved
      ? `Bar path · ${summaryLine(saved.result)}`
      : notRead === "needs_tap"
        ? "Bar path · check the bar to read it"
        : notRead === "failed"
          ? "Bar path · couldn't read this video"
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
        data-lift-analysis-entry={saved ? "done" : running ? "running" : (notRead ?? "offer")}
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
          startOnOpen={!stored && !running}
        />
      )}
    </>
  );
}

/**
 * Under a film note's picture in the chat: opens the clip on that exact
 * frame, in Technique, with the note picked (the athlete's or the coach's
 * own copy: the same set video both can see).
 */
export function FilmNoteOpen({
  note,
  className,
}: {
  note: {
    note_id: string;
    set_video_id: string;
    t: number;
    exercise?: string;
    label?: string;
    video_path: string;
    poster_path?: string | null;
    layers?: Record<string, boolean>;
  };
  className?: string;
}) {
  const src = useChatSignedUrl(note.video_path);
  const poster = useChatSignedUrl(note.poster_path ?? undefined);
  const [open, setOpen] = useState(false);
  const [, setLoaded] = useState(0);
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
  return (
    <>
      <button
        type="button"
        onPointerDown={() => void loadView().catch(() => {})}
        onClick={openView}
        className={cn(
          "flex h-10 w-full min-w-0 items-center gap-2 rounded-lg px-1 text-left text-sm text-muted-foreground hover:text-foreground",
          className,
        )}
        data-film-note-open={note.note_id}
      >
        <PenLine className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate tabular-nums">
          Open the clip at {noteClock(note.t)}
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
      {View && open && (
        <View
          open={open}
          onOpenChange={setOpen}
          setVideoId={note.set_video_id}
          src={src}
          poster={poster}
          exerciseName={note.exercise ?? "Set video"}
          setLabel={note.label}
          openAt={{ t: note.t, noteId: note.note_id, layers: note.layers }}
        />
      )}
    </>
  );
}
