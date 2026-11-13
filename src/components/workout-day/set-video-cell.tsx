/**
 * A set's video, at the end of its row (a coaching client's sets only):
 *   · a quiet camera on every set, logged or not (people film the set before
 *     they log it): one tap opens the phone's own sheet (Take Video / Photo
 *     Library / Choose File) and the clip goes in the background while they
 *     keep logging; one filmed before the set is saved goes on it by its row
 *     and set number, and the database ties it to the set once it's saved
 *   · a ring with how far it's got while it's on its way
 *   · the clip's poster once it's on the set (and in the coach chat): a tap
 *     plays it, says where it is in the chat, or takes it off
 *   · red when it didn't send (a dropped connection retries by itself)
 * A clip filmed in the app (Take Video, never in Photos) is offered for the
 * phone right away, on the clip and at the end of the workout
 * (set-video-phone-copy.tsx).
 * Light on purpose: the uploader, the trimmer and the sheet load only when a
 * clip is picked or opened, so the logger doesn't carry any video code.
 *
 * The first set a client logs in a workout points its camera out ("Film your
 * sets for Jared", set-videos/tip.ts): a small bubble with Film this set /
 * Not now, at most once a day and a few days, until they've sent one.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Camera, CloudOff, Play, Video } from "lucide-react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { claimSetVideoTip, releaseSetVideoTip, setVideoTipCopy, useSetVideoTip } from "@/lib/set-videos/tip";
import { looksFilmedInApp } from "@/lib/set-videos/phone-copy";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { importWithRetry } from "@/lib/chunk-import";
import { useChatSignedUrl } from "@/hooks/use-chat-signed-urls";
import {
  dropSetVideoJob,
  isActiveJob,
  jobOnSet,
  jobStatusText,
  jobsForSet,
  useSetVideoJobs,
  videoOnSet,
  type SetVideoJob,
} from "@/lib/set-videos/jobs";

export type SetVideo = {
  id: string;
  row_id: string | null;
  result_id: string | null;
  set_index: number;
  exercise_name: string | null;
  label: string;
  storage_path: string;
  thumbnail_path: string | null;
  duration_s: number | null;
  width: number | null;
  height: number | null;
  size_bytes: number | null;
  message_id: string | null;
  uploaded_by: string;
  created_at: string;
  /** Its 720p copy for Crew, when the phone made one (the workout film uses it). */
  feed_path?: string | null;
  feed_width?: number | null;
  feed_height?: number | null;
  feed_duration_s?: number | null;
  feed_size_bytes?: number | null;
};

type FlowComponent = (typeof import("@/components/workout-day/set-video-flow"))["default"];
type SheetComponent = (typeof import("@/components/workout-day/set-video-sheet"))["default"];
/**
 * The flow and the sheet load on demand and render only once loaded: never
 * through React.lazy, which suspends the workout or draws a "couldn't load"
 * box inside the set row when there's no connection. A load that fails says
 * so in a toast and leaves the row as it was.
 */
let Flow: FlowComponent | null = null;
let Sheet: SheetComponent | null = null;
const loadFlow = (): Promise<FlowComponent> =>
  Flow
    ? Promise.resolve(Flow)
    : importWithRetry(() => import("@/components/workout-day/set-video-flow")).then(
        (m) => (Flow = m.default),
      );
const loadSheet = (): Promise<SheetComponent> =>
  Sheet
    ? Promise.resolve(Sheet)
    : importWithRetry(() => import("@/components/workout-day/set-video-sheet")).then(
        (m) => (Sheet = m.default),
      );

const NO_CONNECTION =
  "The video couldn't start without a connection. Try again once you have signal.";
let warmed = false;
/**
 * The video code (uploader, engine, trimmer, sheet) is loaded in the
 * background once someone is logging sets, so a clip picked at a gym with no
 * signal still starts (and sends once the connection is back). The service
 * worker never caches the app's code, so without this the pick would do
 * nothing offline. Skipped on Save Data; once per app open.
 */
function warmSetVideoCode() {
  if (warmed || typeof window === "undefined") return;
  if (
    navigator.onLine === false ||
    (navigator as { connection?: { saveData?: boolean } }).connection?.saveData
  )
    return;
  warmed = true;
  const run = () => {
    Promise.all([
      loadFlow(),
      loadSheet(),
      import("@/lib/set-videos/uploader")
        .then(() => import("@/lib/video-edit/pick"))
        .then((m) => m.preloadVideoEngine()),
    ]).catch(() => {
      warmed = false;
    });
  };
  window.setTimeout(() => {
    const idle = (
      window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
    ).requestIdleCallback;
    if (idle) idle(run, { timeout: 8_000 });
    else run();
  }, 6_000);
}

export const setVideosKey = (dayId: string) => ["set-videos", dayId] as const;
/** Sent clips the day's list was already asked to read back (every cell shares one query: ask once). */
const readBackAsked = new Set<string>();

/** A workout's set videos (one read for every row), refreshed when one of its uploads lands. */
export function useSetVideosForDay(dayId: string, enabled: boolean) {
  const qc = useQueryClient();
  const jobs = useSetVideoJobs();
  const query = useQuery({
    queryKey: setVideosKey(dayId),
    enabled: enabled && !!dayId,
    staleTime: 60_000,
    queryFn: async (): Promise<SetVideo[]> => {
      const { data, error } = await (supabase as any)
        .from("pl_set_videos")
        .select(
          "id, row_id, result_id, set_index, exercise_name, label, storage_path, thumbnail_path, duration_s, width, height, size_bytes, message_id, uploaded_by, created_at, feed_path, feed_width, feed_height, feed_duration_s, feed_size_bytes",
        )
        .eq("day_id", dayId)
        .is("deleted_at", null)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as SetVideo[];
    },
  });
  // A clip of this workout just landed: read the list again; once it's in it, the job is done with.
  const data = query.data;
  useEffect(() => {
    if (!enabled) return;
    const done = jobs.filter((j) => j.dayId === dayId && j.state === "done" && j.setVideoId);
    if (!done.length) return;
    const have = new Set((data ?? []).map((v) => v.id));
    const missing = done.filter((j) => !have.has(j.setVideoId!) && !readBackAsked.has(j.id));
    for (const j of done) {
      if (!have.has(j.setVideoId!)) continue;
      readBackAsked.delete(j.id);
      dropSetVideoJob(j.id);
    }
    if (!missing.length) return;
    for (const j of missing) readBackAsked.add(j.id);
    void qc.invalidateQueries({ queryKey: setVideosKey(dayId) });
  }, [jobs, data, dayId, enabled, qc]);
  return query;
}

/** Whether this exercise has a video on any set (or one on its way): its rows get the video column even read-only. */
export function useRowHasSetVideos(dayId: string, rowId: string, enabled: boolean): boolean {
  const { data } = useSetVideosForDay(dayId, enabled);
  const jobs = useSetVideoJobs();
  return useMemo(
    () =>
      enabled &&
      ((data ?? []).some((v) => v.row_id === rowId) ||
        jobs.some((j) => j.rowId === rowId && j.state !== "done")),
    [data, jobs, rowId, enabled],
  );
}

export type SetVideoCellProps = {
  clientId: string | undefined;
  rowId: string;
  dayId: string;
  dayTitle: string;
  exerciseName: string;
  setIndex: number;
  /** The logged set (pl_row_results.id): the video belongs to it. */
  resultId: string | null;
  /** The set has numbers saved: a video can go on it. */
  logged: boolean;
  readonly: boolean;
  focusMode?: boolean;
  /** "100 kg × 5 @ RPE 8": what the coach's card says about the set. */
  label: string;
};

export function SetVideoCell(props: SetVideoCellProps) {
  const { clientId, rowId, dayId, setIndex, resultId, logged, readonly, focusMode } = props;
  const { user } = useAuth();
  const { data } = useSetVideosForDay(dayId, !!clientId);
  const allJobs = useSetVideoJobs();
  const inputRef = useRef<HTMLInputElement>(null);
  /** Each pick mounts its own flow (keyed), and clears only itself when it's done. */
  const [picked, setPicked] = useState<{ file: File; key: number; filmedHere: boolean } | null>(null);
  const pickSeq = useRef(0);
  const [sheetOpen, setSheetOpen] = useState(false);

  const set = useMemo(() => ({ rowId, setIndex, resultId }), [rowId, setIndex, resultId]);
  const stored = useMemo(() => (data ?? []).filter((v) => videoOnSet(v, set)), [data, set]);
  // Just sent and not read back yet: shown from the job, so the set never flicks back to the camera.
  const videos = useMemo(() => {
    const landed = allJobs.filter(
      (j) =>
        j.state === "done" &&
        jobOnSet(j, set) &&
        j.setVideoId &&
        // the day's list has it anywhere (a clip moved to another set must not stay here)
        !(data ?? []).some((v) => v.id === j.setVideoId),
    );
    if (!landed.length) return stored;
    return [
      ...stored,
      ...landed.map(
        (j): SetVideo => ({
          id: j.setVideoId!,
          row_id: j.rowId,
          result_id: j.resultId,
          set_index: j.setIndex,
          exercise_name: j.exerciseName,
          label: j.label,
          storage_path: "",
          thumbnail_path: j.posterPath ?? null,
          duration_s: null,
          width: null,
          height: null,
          size_bytes: null,
          message_id: j.messageId ?? null,
          uploaded_by: j.userId,
          created_at: new Date(j.createdAt).toISOString(),
        }),
      ),
    ];
  }, [stored, data, allJobs, set]);
  const jobs = useMemo(() => jobsForSet(allJobs, set), [allJobs, set]);
  const active = jobs.find(isActiveJob) ?? null;
  const failed = !active ? (jobs.find((j) => j.state === "failed") ?? null) : null;
  // Every set, logged or not: the clip is filmed while the set happens, before it's logged.
  const canAdd = !readonly && !!clientId && !!user?.id;

  useEffect(() => {
    if (canAdd) warmSetVideoCode();
  }, [canAdd]);

  // The point-out: the moment this set is logged (not when the workout opens
  // on sets logged before), if it's due and nothing else holds the screen.
  const tip = useSetVideoTip(clientId, canAdd);
  const [tipOpen, setTipOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const wasLogged = useRef(logged);
  const tipLive = useRef({ due: tip.due, canAdd, has: false });
  tipLive.current = { due: tip.due, canAdd, has: videos.length > 0 || !!active };
  useEffect(() => {
    const was = wasLogged.current;
    wasLogged.current = logged;
    if (was || !logged) return;
    if (!canAdd || !tip.due || videos.length || active) return;
    if (!claimSetVideoTip()) return;
    let tries = 0;
    let timer = 0;
    let settled = false;
    const settle = () => {
      const live = tipLive.current;
      if (!live.canAdd || !live.due || live.has || !buttonRef.current?.isConnected) {
        settled = true;
        releaseSetVideoTip();
        return;
      }
      const el = document.activeElement;
      // still typing (the RPE that finished the set), or a sheet / dialog is up: wait
      const busy =
        (el instanceof HTMLElement && el.matches("input, textarea, select, [contenteditable='true']")) ||
        !!document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]');
      if (busy) {
        if (++tries > 20) {
          settled = true;
          releaseSetVideoTip(); // ~10 s: another set can have it
        } else timer = window.setTimeout(settle, 500);
        return;
      }
      settled = true;
      setTipOpen(true);
      tip.markShown();
    };
    timer = window.setTimeout(settle, 1200);
    return () => {
      window.clearTimeout(timer);
      // the set came undone or left the screen before it showed: hand it on
      if (!settled) releaseSetVideoTip();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logged]);

  const openPicker = () => {
    if (!canAdd) return;
    // the video code starts loading while the phone's picker is open
    void loadFlow().catch(() => {});
    void import("@/lib/video-edit/pick").then((m) => m.preloadVideoEngine()).catch(() => {});
    inputRef.current?.click();
  };
  const onPicked = (f: File) => {
    // straight from the camera (not in Photos): it's offered for the phone once it's on its way
    const filmedHere = looksFilmedInApp(f);
    loadFlow().then(
      () => setPicked({ file: f, key: ++pickSeq.current, filmedHere }),
      () => toast.error(NO_CONNECTION),
    );
  };
  const openSheet = () => {
    loadSheet().then(
      () => setSheetOpen(true),
      () => toast.error("Couldn't open it without a connection. Try again once you have signal."),
    );
  };

  const size = focusMode ? "h-9 w-9" : "h-8 w-8";
  let content: React.ReactNode = null;
  let label = "";
  let onTap: (() => void) | null = null;
  if (active) {
    const pct = Math.max(4, Math.min(100, active.progress));
    label = `Set ${setIndex} video: ${jobStatusText(active)}`;
    onTap = openSheet;
    content = <ProgressRing pct={pct} className={size} />;
  } else if (failed) {
    label = failed.autoRetry
      ? `Set ${setIndex} video: waiting for a connection`
      : `Set ${setIndex} video didn't send. Open to try again`;
    onTap = openSheet;
    content = (
      <span
        className={cn(
          "inline-flex items-center justify-center rounded-full border",
          size,
          failed.autoRetry
            ? "border-amber-500/60 text-amber-600 dark:text-amber-400"
            : "border-destructive bg-destructive/10 text-destructive",
        )}
      >
        {failed.autoRetry ? (
          <CloudOff className="h-3.5 w-3.5" />
        ) : (
          <AlertTriangle className="h-3.5 w-3.5" />
        )}
      </span>
    );
  } else if (videos.length) {
    label = `Set ${setIndex} video${videos.length > 1 ? `s (${videos.length})` : ""}`;
    onTap = openSheet;
    content = (
      <PosterChip video={videos[videos.length - 1]} count={videos.length} className={size} />
    );
  } else if (canAdd) {
    label = `Add a video of set ${setIndex} for your coach`;
    onTap = () => {
      setTipOpen(false);
      openPicker();
    };
    content = (
      <span
        className={cn(
          "inline-flex items-center justify-center rounded-full transition-colors",
          tipOpen
            ? "bg-muted text-foreground ring-2 ring-foreground/50 motion-safe:animate-pulse"
            : "text-muted-foreground/70",
          size,
        )}
      >
        <Camera className="h-4 w-4" />
      </span>
    );
  }
  const tipCopy = setVideoTipCopy(tip.coachFirst);
  const showTip = tipOpen && canAdd && !active && !videos.length;

  return (
    <div className="flex justify-center">
      {content && onTap ? (
        <Popover open={showTip} onOpenChange={(o) => { if (!o) setTipOpen(false); }}>
          <PopoverAnchor asChild>
            <button
              ref={buttonRef}
              type="button"
              onClick={onTap}
              aria-label={label}
              title={label}
              data-set-video={active ? "uploading" : failed ? "failed" : videos.length ? "sent" : "add"}
              className="flex h-11 w-full items-center justify-center rounded-md transition active:scale-95 sm:h-9"
            >
              {content}
            </button>
          </PopoverAnchor>
          {showTip && (
            <PopoverContent
              side="top"
              align="end"
              sideOffset={6}
              collisionPadding={12}
              data-set-video-tip
              aria-label={tipCopy.title}
              onOpenAutoFocus={(e) => e.preventDefault()}
              onCloseAutoFocus={(e) => e.preventDefault()}
              className="w-[min(19rem,calc(100vw-2rem))] rounded-2xl p-3.5 shadow-lg"
            >
              <div className="flex gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-foreground">
                  <Video className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold leading-snug">{tipCopy.title}</p>
                  <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{tipCopy.body}</p>
                </div>
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <Button type="button" variant="ghost" className="h-10 px-3" onClick={() => setTipOpen(false)}>
                  Not now
                </Button>
                <Button
                  type="button"
                  className="h-10 gap-1.5 bg-foreground px-3.5 text-background hover:bg-foreground/90"
                  onClick={() => {
                    setTipOpen(false);
                    // the phone's picker opens from this tap
                    openPicker();
                  }}
                >
                  <Camera className="h-4 w-4" aria-hidden /> Film this set
                </Button>
              </div>
              <PopoverPrimitive.Arrow className="fill-popover" width={16} height={8} />
            </PopoverContent>
          )}
        </Popover>
      ) : null}
      {canAdd && (
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          className="hidden"
          aria-hidden
          tabIndex={-1}
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            e.target.value = "";
            if (f) onPicked(f);
          }}
        />
      )}
      {picked && Flow && user?.id && clientId && (
        <Flow
          key={picked.key}
          file={picked.file}
          filmedHere={picked.filmedHere}
          start={{
            userId: user.id,
            clientId,
            rowId,
            dayId,
            resultId,
            setIndex,
            exerciseName: props.exerciseName,
            dayTitle: props.dayTitle,
            // what the set was, only once it's logged (an unlogged set's boxes can hold its targets)
            label: logged ? props.label : "",
          }}
          onDone={() => {
            const done = picked.key;
            setPicked((cur) => (cur?.key === done ? null : cur));
          }}
        />
      )}
      {sheetOpen && Sheet && (
        <Sheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          dayId={dayId}
          clientId={clientId ?? ""}
          exerciseName={props.exerciseName}
          setIndex={setIndex}
          label={props.label}
          videos={stored}
          jobs={jobs as SetVideoJob[]}
          canAdd={canAdd}
          onAdd={openPicker}
        />
      )}
    </div>
  );
}

function ProgressRing({ pct, className }: { pct: number; className?: string }) {
  const r = 13;
  const c = 2 * Math.PI * r;
  return (
    <span
      className={cn("relative inline-flex items-center justify-center", className)}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <svg viewBox="0 0 32 32" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden>
        <circle
          cx="16"
          cy="16"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          className="text-muted"
        />
        <circle
          cx="16"
          cy="16"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct / 100)}
          className="text-foreground transition-[stroke-dashoffset] duration-300"
        />
      </svg>
      <span className="text-[9px] font-semibold tabular-nums text-foreground">
        {Math.round(pct)}
      </span>
    </span>
  );
}

function PosterChip({
  video,
  count,
  className,
}: {
  video: SetVideo;
  count: number;
  className?: string;
}) {
  const poster = useChatSignedUrl(video.thumbnail_path ?? undefined);
  return (
    <span
      className={cn(
        "relative inline-flex overflow-hidden rounded-md border border-border bg-muted",
        className,
      )}
    >
      {poster ? (
        <img src={poster} alt="" className="h-full w-full object-cover" draggable={false} />
      ) : null}
      <span className="absolute inset-0 flex items-center justify-center bg-black/25 text-white">
        <Play className="h-3 w-3 fill-current" />
      </span>
      {count > 1 && (
        <span className="absolute -right-0.5 -top-0.5 rounded-full bg-foreground px-1 text-[9px] font-bold leading-[14px] text-background">
          {count}
        </span>
      )}
    </span>
  );
}
