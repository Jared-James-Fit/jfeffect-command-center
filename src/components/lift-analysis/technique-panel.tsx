/**
 * Technique: the athlete's body read on this device and drawn over the set
 * (lazy, part of the full view). Opening it starts the read (the model's
 * first download is measured in bytes, then frames read); the skeleton shows
 * on the video as the frames come in. Every overlay is its own switch, a rep
 * can be laid over another as a ghost, and each rep's lift-specific numbers
 * and the patterns worth a look are listed with the moment to jump to.
 *
 * Film notes: a coach (or the athlete) pauses on a frame, draws on it (lines,
 * arrows, circles, or a joint that then follows the body), writes a comment,
 * and saves it on the video or sends it to the coach chat as the marked
 * frame; the chat card opens the clip on that frame. The video itself is
 * never changed.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ArrowUpRight,
  Clapperboard,
  Circle,
  Download,
  Eye,
  EyeOff,
  Loader2,
  MoreHorizontal,
  PenLine,
  Send,
  Slash,
  Trash2,
  Undo2,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { DrawMode, DrawTool, PlayerApi } from "@/components/lift-analysis/bar-path-player";
import {
  DEFAULT_LAYERS,
  repAt as repAtTime,
  repSpan,
  valueAt,
  type Compare,
  type Layers,
  type PoseScene,
} from "@/components/lift-analysis/overlay-draw";
import { useAuth } from "@/lib/auth";
import { saveFiles } from "@/lib/file-share";
import type { LiftAnalysis } from "@/lib/lift-analysis/analyze";
import type { GuideLift } from "@/lib/lift-analysis/exercise";
import {
  deleteFilmNote,
  hideFilmNote,
  noteClock,
  saveFilmNote,
  sendFilmNote,
  useRefreshFilmNotes,
  type FilmNote,
  type Shape,
} from "@/lib/lift-analysis/film-notes";
import { canvasToPng, grabFrame, renderAnnotatedClip } from "@/lib/lift-analysis/frame-grab";
import { runPose, type PoseProgress } from "@/lib/lift-analysis/pose/pose-run";
import { nearSide, smoothTrack, viewOf, type PoseTrack } from "@/lib/lift-analysis/pose/skeleton";
import { readTechnique, type TechniqueRead } from "@/lib/lift-analysis/pose/technique";
import { storedPoseCovers, unpackPose } from "@/lib/lift-analysis/pose/pose-pack";
import { useStoredPose } from "@/lib/lift-analysis/pose/pose-queries";
import { isViewingAsClient } from "@/lib/pov-guard";
import { cn } from "@/lib/utils";

const LAYER_KEY = "jf-technique-layers-v1";

const LAYER_WORDS: { key: keyof Layers; label: string; needsAngles?: boolean }[] = [
  { key: "bar", label: "Bar path" },
  { key: "skeleton", label: "Skeleton" },
  { key: "angles", label: "Joint angles", needsAngles: true },
  { key: "segments", label: "Torso & shin", needsAngles: true },
  { key: "vertical", label: "Vertical line" },
  { key: "horizontal", label: "Horizontal line" },
  { key: "paths", label: "Hip & knee paths" },
];

function readLayers(): Layers {
  try {
    const raw = localStorage.getItem(LAYER_KEY);
    if (raw) return { ...DEFAULT_LAYERS, ...(JSON.parse(raw) as Partial<Layers>) };
  } catch {
    /* private mode */
  }
  return DEFAULT_LAYERS;
}

/* ── the body's read ─────────────────────────────────────────────────── */

export type TechniqueState = {
  status: "idle" | "running" | "done" | "failed";
  progress: PoseProgress | null;
  failure: string;
  track: PoseTrack | null;
  read: TechniqueRead | null;
  layers: Layers;
  setLayers: (l: Layers) => void;
  compare: Compare | null;
  setCompare: (c: Compare | null) => void;
  scene: PoseScene | null;
  /** The body came from the server's read (stored on upload), not this device. */
  fromServer: boolean;
  start: () => void;
  cancel: () => void;
};

export function useTechnique(input: {
  active: boolean;
  src?: string;
  analysis: LiftAnalysis | null;
  lift: GuideLift;
  initialLayers?: Partial<Layers>;
  /** The set video, for the body read the server stored on upload (pl_set_video_poses). */
  setVideoId?: string;
}): TechniqueState {
  const { active, src, analysis, lift, setVideoId } = input;
  const storedQ = useStoredPose(setVideoId, active);
  const [fromServer, setFromServer] = useState(false);
  const [status, setStatus] = useState<TechniqueState["status"]>("idle");
  const [progress, setProgress] = useState<PoseProgress | null>(null);
  const [failure, setFailure] = useState("");
  const [raw, setRaw] = useState<PoseTrack | null>(null);
  const [layers, setLayersState] = useState<Layers>(() => ({
    ...readLayers(),
    ...(input.initialLayers ?? {}),
  }));
  const [compare, setCompare] = useState<Compare | null>(null);
  const ctrl = useRef<AbortController | null>(null);

  const setLayers = useCallback((l: Layers) => {
    setLayersState(l);
    try {
      localStorage.setItem(LAYER_KEY, JSON.stringify(l));
    } catch {
      /* private mode */
    }
  }, []);

  const start = useCallback(() => {
    if (!src) return;
    setFromServer(false);
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setStatus("running");
    setFailure("");
    setProgress({ stage: "model", progress: 0 });
    const win = analysis
      ? { start: Math.max(0, analysis.window.start - 0.5), end: analysis.window.end + 0.5 }
      : { start: 0, end: 90 };
    const barAt = analysis
      ? (t: number) => {
          const S = analysis.series;
          const x = valueAt(S.t, S.x, t);
          const y = valueAt(S.t, S.y, t);
          return x != null && y != null ? { fx: x, fy: y } : null;
        }
      : undefined;
    void runPose({
      source: src,
      window: win,
      barAt,
      signal: c.signal,
      onProgress: setProgress,
      onPartial: setRaw,
    }).then((res) => {
      if (c.signal.aborted) return;
      setProgress(null);
      if (res.ok) {
        setRaw(res.track);
        setStatus("done");
        return;
      }
      if (res.why === "cancelled") return setStatus("idle");
      setFailure(
        res.why === "no_body"
          ? "No one was found in this video. The whole body needs to be in the frame, side-on."
          : res.why === "model_failed"
            ? "The body model couldn't load. Check the connection and try again."
            : "This video couldn't be read on this device.",
      );
      setStatus("failed");
    });
  }, [src, analysis]);

  const cancel = useCallback(() => {
    ctrl.current?.abort();
    setProgress(null);
    setStatus("idle");
  }, []);

  useEffect(() => () => ctrl.current?.abort(), []);
  // opening Technique starts the read (once): the server's stored read when it covers the set,
  // else the device's own (a stored read still being made, or none, never holds Technique up)
  useEffect(() => {
    if (!active || status !== "idle" || raw || !src) return;
    if (setVideoId && storedQ.isLoading) return;
    const stored = storedQ.data;
    if (stored && stored.window && storedPoseCovers(stored.window, analysis)) {
      if (stored.status === "done") {
        const track = unpackPose(stored.track);
        if (track) {
          setRaw(track);
          setFromServer(true);
          setStatus("done");
          return;
        }
      }
      if (stored.status === "no_body") {
        setFailure("No one was found in this video. The whole body needs to be in the frame, side-on.");
        setStatus("failed");
        return;
      }
    }
    start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, src, storedQ.isLoading, storedQ.data]);

  const track = useMemo(() => (raw ? smoothTrack(raw) : null), [raw]);
  const read = useMemo(
    () => (track && analysis && status === "done" ? readTechnique(track, analysis, lift) : null),
    [track, analysis, lift, status],
  );
  const scene = useMemo<PoseScene | null>(() => {
    if (!track) return null;
    // until the read is done (or with no bar read to split reps), the view is judged on what's been read so far
    const view = read?.view ?? viewOf(track);
    const side = read ? read.side : nearSide(track);
    return {
      track,
      side,
      view,
      angles: read ? read.angles : view === "side" && side != null,
      layers,
      compare,
    };
  }, [track, read, layers, compare]);

  return {
    status,
    progress,
    failure,
    track,
    read,
    layers,
    setLayers,
    compare,
    setCompare,
    scene,
    fromServer,
    start,
    cancel,
  };
}

/* ── film notes being drawn ──────────────────────────────────────────── */

export type NoteDraft = {
  id: string | null;
  t: number;
  shapes: Shape[];
  body: string;
};

export function useNoteDraft(api: React.MutableRefObject<PlayerApi | null>) {
  const [draft, setDraft] = useState<NoteDraft | null>(null);
  const [tool, setTool] = useState<DrawTool>("arrow");
  const begin = (from?: FilmNote) => {
    api.current?.pause();
    if (from) {
      api.current?.seek(from.t);
      setDraft({ id: from.id, t: from.t, shapes: from.shapes, body: from.body });
    } else setDraft({ id: null, t: api.current?.time() ?? 0, shapes: [], body: "" });
  };
  const draw: DrawMode | null = draft
    ? {
        tool,
        shapes: draft.shapes,
        onAdd: (shape) => setDraft((d) => (d ? { ...d, shapes: [...d.shapes, shape] } : d)),
      }
    : null;
  return { draft, setDraft, tool, setTool, begin, draw, end: () => setDraft(null) };
}

/* ── the panel ───────────────────────────────────────────────────────── */

const STAGE: Record<PoseProgress["stage"], string> = {
  model: "Loading the body model (first time only)",
  detecting: "Detecting the athlete",
};

function fmt(v: number | null | undefined, unit: string, approx?: boolean): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${approx ? "≈" : ""}${Math.round(v)}${unit === "%" ? "%" : unit === "°" ? "°" : ` ${unit}`}`;
}

export function TechniquePanel({
  tech,
  analysis,
  setVideoId,
  src,
  exerciseName,
  selected,
  onSelectRep,
  onJump,
  api,
  notes,
  focusNote,
  onFocusNote,
  noteDraft,
  onNeedBar,
}: {
  tech: TechniqueState;
  analysis: LiftAnalysis | null;
  setVideoId: string;
  src?: string;
  exerciseName: string;
  selected: number | null;
  onSelectRep: (i: number | null) => void;
  /** Show a moment (paused there), and the rep it's in when given. */
  onJump: (t: number, rep: number | null) => void;
  api: React.MutableRefObject<PlayerApi | null>;
  notes: FilmNote[];
  focusNote: string | null;
  onFocusNote: (id: string | null) => void;
  noteDraft: ReturnType<typeof useNoteDraft>;
  onNeedBar: () => void;
}) {
  const { read, layers } = tech;
  const repIdx = selected ?? 0;

  if (noteDraft.draft) {
    return (
      <NoteEditor
        draftState={noteDraft}
        tech={tech}
        setVideoId={setVideoId}
        src={src}
        exerciseName={exerciseName}
        api={api}
      />
    );
  }

  return (
    <div className="space-y-4" data-technique-panel>
      {tech.status === "running" && tech.progress && (
        <div className="rounded-2xl border border-border p-4" data-technique-progress>
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0 flex-1 font-medium">{STAGE[tech.progress.stage]}</span>
            <span className="tabular-nums text-muted-foreground">
              {Math.round(100 * tech.progress.progress)}%
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-foreground transition-[width]"
              style={{ width: `${Math.round(100 * tech.progress.progress)}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            On this device. The video isn't uploaded anywhere.
          </p>
          <button
            type="button"
            className="mt-1 h-9 text-sm text-muted-foreground hover:text-foreground"
            onClick={tech.cancel}
          >
            Cancel
          </button>
        </div>
      )}
      {tech.status === "failed" && (
        <div className="rounded-2xl border border-border p-4">
          <p className="text-sm">{tech.failure}</p>
          <Button variant="outline" className="mt-3 h-10" onClick={tech.start}>
            Try again
          </Button>
        </div>
      )}
      {tech.status === "idle" && !tech.track && (
        <div className="rounded-2xl border border-border p-4">
          <p className="text-sm text-muted-foreground">
            Finds the athlete's joints on this device. Nothing is uploaded.
          </p>
          <Button className="mt-3 h-11 w-full" onClick={tech.start} disabled={!src}>
            Read technique
          </Button>
        </div>
      )}

      {/* overlays */}
      <section>
        <div className="mb-1.5 text-[13px] font-medium text-muted-foreground">
          Show on the video
        </div>
        <div className="flex flex-wrap gap-1.5" data-technique-layers>
          {LAYER_WORDS.map(({ key, label, needsAngles }) => {
            const off = needsAngles && read != null && !read.angles;
            const on = layers[key] && !off;
            return (
              <button
                key={key}
                type="button"
                disabled={off}
                onClick={() => tech.setLayers({ ...layers, [key]: !layers[key] })}
                className={cn(
                  "h-9 rounded-full px-3 text-[13px] font-medium",
                  on ? "bg-foreground text-background" : "bg-secondary text-foreground",
                  off && "opacity-40",
                )}
                aria-pressed={on}
                data-layer={key}
              >
                {label}
              </button>
            );
          })}
        </div>
        {read && !read.angles && (
          <p className="mt-1.5 text-xs text-muted-foreground">Joint angles need a side view.</p>
        )}
      </section>

      {/* comparisons */}
      {analysis && analysis.reps.length > 0 && tech.track && (
        <section>
          <div className="mb-1.5 text-[13px] font-medium text-muted-foreground">
            Compare (a ghost over rep {repIdx + 1})
          </div>
          <div className="flex flex-wrap gap-1.5" data-technique-compare>
            <CompareChip on={!tech.compare} onClick={() => tech.setCompare(null)} label="Off" />
            <CompareChip
              on={tech.compare?.kind === "start"}
              onClick={() => tech.setCompare({ kind: "start" })}
              label="Start position"
            />
            {analysis.reps.map((_, i) =>
              i === repIdx ? null : (
                <CompareChip
                  key={i}
                  on={tech.compare?.kind === "rep" && tech.compare.rep === i}
                  onClick={() => tech.setCompare({ kind: "rep", rep: i })}
                  label={
                    i === 0
                      ? "First rep"
                      : i === analysis.reps.length - 1
                        ? "Last rep"
                        : `Rep ${i + 1}`
                  }
                />
              ),
            )}
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Lined up by phase: the bottoms play together, whatever each rep's speed.
          </p>
        </section>
      )}

      {/* the read */}
      {tech.status === "done" && !analysis && (
        <div className="rounded-2xl bg-muted/50 p-3 text-sm">
          <p>Read the bar first to split the set into reps for the numbers.</p>
          <button
            type="button"
            className="mt-1 h-9 font-medium underline-offset-2 hover:underline"
            onClick={onNeedBar}
          >
            Find the bar
          </button>
        </div>
      )}
      {read && (
        <>
          <p className="text-xs text-muted-foreground" data-technique-view={read.view}>
            {viewLine(read)}
          </p>
          {read.observations.length > 0 && (
            <section className="space-y-2" data-technique-observations>
              <h3 className="text-[15px] font-semibold">Worth a look</h3>
              {read.observations.map((o) => (
                <div key={o.id} className="flex items-start gap-3 rounded-xl bg-muted/50 p-3">
                  <p className="min-w-0 flex-1 text-sm leading-snug">{o.text}</p>
                  {o.t != null && (
                    <button
                      type="button"
                      className="h-9 shrink-0 rounded-full bg-secondary px-3 text-[13px] font-medium"
                      onClick={() => onJump(o.t!, o.rep != null ? o.rep - 1 : null)}
                    >
                      Show
                    </button>
                  )}
                </div>
              ))}
            </section>
          )}
          {read.rows.length > 0 && (
            <section className="rounded-2xl border border-border p-3" data-technique-metrics>
              <h3 className="text-[15px] font-semibold">Each rep</h3>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm tabular-nums">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="py-1 pr-2 font-normal" />
                      {read.reps.map((r, i) => (
                        <th key={r.n} className="px-1.5 py-1 text-right font-normal">
                          <button
                            type="button"
                            className={cn(
                              "h-7 min-w-7 rounded-full px-1.5",
                              i === repIdx ? "bg-foreground text-background" : "",
                            )}
                            onClick={() => onJump(r.at.turn, i)}
                          >
                            {r.n}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {read.rows.map((row) => (
                      <tr key={row.key} className="border-t border-border">
                        <td className="py-1.5 pr-2">
                          <div className="text-[13px]">{row.label}</div>
                          <div className="text-[11px] leading-snug text-muted-foreground">
                            {row.hint}
                          </div>
                        </td>
                        {read.reps.map((r, i) => (
                          <td
                            key={r.n}
                            className={cn(
                              "px-1.5 py-1.5 text-right align-top",
                              i === repIdx && "font-semibold",
                            )}
                          >
                            {fmt(r.m[row.key], row.unit, row.approx)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          {read.limits.length > 0 && (
            <ul className="space-y-1 text-xs text-muted-foreground" data-technique-limits>
              {read.limits.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* film notes */}
      <section className="space-y-2" data-film-notes>
        <div className="flex items-center justify-between">
          <h3 className="text-[15px] font-semibold">Notes on the video</h3>
          <div className="flex gap-1">
            <SaveFrameButton api={api} src={src} exerciseName={exerciseName} />
            <SaveClipButton
              api={api}
              src={src}
              exerciseName={exerciseName}
              span={() => {
                const now = api.current?.time() ?? 0;
                const i = selected ?? (analysis ? repAtTime(analysis, now) : -1);
                const sp = analysis && i >= 0 ? repSpan(analysis, i) : null;
                return sp
                  ? { start: Math.max(0, sp.start - 0.4), end: sp.end + 0.4 }
                  : { start: Math.max(0, now - 2.5), end: now + 2.5 };
              }}
            />
            <Button
              variant="outline"
              className="h-9 gap-1.5 px-3"
              onClick={() => noteDraft.begin()}
              data-film-note-add
            >
              <PenLine className="h-4 w-4" /> Draw
            </Button>
          </div>
        </div>
        {notes.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Pause on a frame and draw on it. A note can go to the coach chat as the marked frame.
          </p>
        ) : (
          notes.map((n) => (
            <NoteRow
              key={n.id}
              note={n}
              focused={focusNote === n.id}
              onOpen={() => {
                onFocusNote(focusNote === n.id ? null : n.id);
                api.current?.seek(n.t);
              }}
              onEdit={() => noteDraft.begin(n)}
              setVideoId={setVideoId}
            />
          ))
        )}
      </section>
    </div>
  );
}

function viewLine(r: TechniqueRead): string {
  const side = r.side ? `, ${r.side} side nearest the camera` : "";
  const cov = `body found in ${Math.round(100 * r.coverage)}% of frames`;
  if (r.view === "side") return `Side view${side} · ${cov}`;
  if (r.view === "front") return `Front or rear view · ${cov}`;
  if (r.view === "oblique") return `Angled view · ${cov}`;
  return cov[0].toUpperCase() + cov.slice(1);
}

function CompareChip({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-9 rounded-full px-3 text-[13px] font-medium",
        on ? "bg-foreground text-background" : "bg-secondary text-foreground",
      )}
      aria-pressed={on}
    >
      {label}
    </button>
  );
}

function NoteRow({
  note,
  focused,
  onOpen,
  onEdit,
  setVideoId,
}: {
  note: FilmNote;
  focused: boolean;
  onOpen: () => void;
  onEdit: () => void;
  setVideoId: string;
}) {
  const { user } = useAuth();
  const refresh = useRefreshFilmNotes();
  const mine = user?.id === note.author_id;
  const act = async (f: () => Promise<void>, done: string) => {
    try {
      await f();
      await refresh(setVideoId);
      toast.success(done);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That didn't work.");
    }
  };
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-xl border p-2.5",
        focused ? "border-foreground" : "border-border",
        note.hidden_at && "opacity-60",
      )}
      data-film-note={note.id}
    >
      <button type="button" className="min-w-0 flex-1 text-left" onClick={onOpen}>
        <div className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
          <span className="font-semibold text-foreground">{noteClock(note.t)}</span>
          <span>{mine ? "You" : "Coach"}</span>
          {note.message_id && <span>· sent</span>}
          {note.hidden_at && <span>· hidden</span>}
        </div>
        <p className="mt-0.5 text-sm leading-snug">
          {note.body || `${note.shapes.length} mark${note.shapes.length === 1 ? "" : "s"}`}
        </p>
      </button>
      {mine && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full hover:bg-muted"
              aria-label="Note options"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[12rem]">
            <DropdownMenuItem className="h-11 gap-2" onSelect={onEdit}>
              <PenLine className="h-4 w-4" /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              className="h-11 gap-2"
              onSelect={() =>
                void act(
                  () => hideFilmNote(note.id, !note.hidden_at),
                  note.hidden_at ? "Shown" : "Hidden",
                )
              }
            >
              {note.hidden_at ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              {note.hidden_at ? "Show on the video" : "Hide from the video"}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="h-11 gap-2 text-destructive focus:text-destructive"
              onSelect={() => void act(() => deleteFilmNote(note.id), "Note removed")}
            >
              <Trash2 className="h-4 w-4" /> Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

/** The frame on screen with what's drawn on it, as a picture (decoded at the clip's own size). */
async function frameWithOverlays(
  api: React.MutableRefObject<PlayerApi | null>,
  src: string,
): Promise<{ blob: Blob; t: number } | null> {
  const t = api.current?.time() ?? 0;
  const f = await grabFrame(src, t);
  if (!f) return null;
  const ctx = f.canvas.getContext("2d");
  if (!ctx) return null;
  api.current?.drawOverlays(ctx, f.w, f.h, t);
  const blob = await canvasToPng(f.canvas);
  return blob ? { blob, t } : null;
}

function SaveFrameButton({
  api,
  src,
  exerciseName,
}: {
  api: React.MutableRefObject<PlayerApi | null>;
  src?: string;
  exerciseName: string;
}) {
  // the share sheet must open from the tap itself: the picture is made first, then a second tap hands it over
  const [ready, setReady] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  if (!src) return null;
  if (ready) {
    return (
      <Button
        className="h-9 gap-1.5 px-3"
        onClick={async () => {
          const out = await saveFiles([ready]);
          if (out === "failed") toast.error("That couldn't be saved.");
          setReady(null);
        }}
      >
        <Download className="h-4 w-4" /> Save
      </Button>
    );
  }
  return (
    <Button
      variant="outline"
      className="h-9 gap-1.5 px-3"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const shot = await frameWithOverlays(api, src);
          if (!shot) throw new Error("no frame");
          const name = `${exerciseName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${noteClock(shot.t).replace(/[:.]/g, "-")}.png`;
          setReady(new File([shot.blob], name, { type: "image/png" }));
        } catch {
          toast.error("That frame couldn't be saved.");
        } finally {
          setBusy(false);
        }
      }}
      data-save-frame
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Frame
    </Button>
  );
}

function SaveClipButton({
  api,
  src,
  exerciseName,
  span,
}: {
  api: React.MutableRefObject<PlayerApi | null>;
  src?: string;
  exerciseName: string;
  span: () => { start: number; end: number };
}) {
  const [ready, setReady] = useState<File | null>(null);
  const [share, setShare] = useState<number | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => () => ctrl.current?.abort(), []);
  if (!src) return null;
  if (ready) {
    return (
      <Button
        className="h-9 gap-1.5 px-3"
        onClick={async () => {
          const out = await saveFiles([ready]);
          if (out === "failed") toast.error("That couldn't be saved.");
          setReady(null);
        }}
      >
        <Download className="h-4 w-4" /> Save clip
      </Button>
    );
  }
  if (share != null) {
    return (
      <Button
        variant="outline"
        className="h-9 gap-1.5 px-3 tabular-nums"
        onClick={() => {
          ctrl.current?.abort();
          setShare(null);
        }}
        aria-label="Stop making the clip"
      >
        <Loader2 className="h-4 w-4 animate-spin" /> {Math.round(100 * share)}%
      </Button>
    );
  }
  return (
    <Button
      variant="outline"
      className="h-9 gap-1.5 px-3"
      onClick={async () => {
        const c = new AbortController();
        ctrl.current = c;
        setShare(0);
        try {
          const sp = span();
          const blob = await renderAnnotatedClip({
            source: src,
            start: sp.start,
            end: sp.end,
            draw: (ctx, w, h, t) => api.current?.drawOverlays(ctx, w, h, t),
            signal: c.signal,
            onProgress: setShare,
          });
          if (c.signal.aborted) return;
          if (!blob) {
            toast.error("This device can't make a video clip. Save a frame instead.");
            return;
          }
          const name = `${exerciseName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${noteClock(sp.start).replace(/[:.]/g, "-")}.mp4`;
          setReady(new File([blob], name, { type: "video/mp4" }));
        } catch {
          if (!c.signal.aborted) toast.error("That clip couldn't be made.");
        } finally {
          setShare(null);
        }
      }}
      data-save-clip
    >
      <Clapperboard className="h-4 w-4" /> Clip
    </Button>
  );
}

const TOOLS: { tool: DrawTool; label: string; icon: typeof Slash }[] = [
  { tool: "arrow", label: "Arrow", icon: ArrowUpRight },
  { tool: "line", label: "Line", icon: Slash },
  { tool: "circle", label: "Circle", icon: Circle },
  { tool: "joint", label: "Joint", icon: UserRound },
];

function NoteEditor({
  draftState,
  tech,
  setVideoId,
  src,
  exerciseName,
  api,
}: {
  draftState: ReturnType<typeof useNoteDraft>;
  tech: TechniqueState;
  setVideoId: string;
  src?: string;
  exerciseName: string;
  api: React.MutableRefObject<PlayerApi | null>;
}) {
  const { draft, setDraft, tool, setTool, end } = draftState;
  const { user, role } = useAuth();
  const refresh = useRefreshFilmNotes();
  const [busy, setBusy] = useState<"save" | "send" | null>(null);
  if (!draft) return null;
  const staff = role != null && role !== "client";
  const save = async (send: boolean) => {
    if (!user) return;
    if (!draft.shapes.length && !draft.body.trim()) {
      toast.message("Draw something or write a comment first.");
      return;
    }
    setBusy(send ? "send" : "save");
    try {
      // the note is on the frame it was drawn on (where the video is now)
      const t = api.current?.time() ?? draft.t;
      const layers = { ...tech.layers } as Record<string, boolean>;
      const id = await saveFilmNote({
        id: draft.id,
        setVideoId,
        t,
        shapes: draft.shapes,
        body: draft.body,
        layers,
      });
      if (send) {
        if (await isViewingAsClient()) {
          toast.message("Previewing as the client: the note is saved, nothing was sent.");
        } else if (src) {
          const shot = await frameWithOverlays(api, src);
          if (!shot) throw new Error("That frame couldn't be read.");
          await sendFilmNote({
            note: { id, t, body: draft.body.trim(), layers },
            setVideoId,
            png: shot.blob,
            senderId: user.id,
            senderRole: staff ? "admin" : "client",
            exerciseName,
          });
          toast.success("Sent to the chat");
        }
      } else toast.success("Note saved on the video");
      await refresh(setVideoId);
      end();
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "That note couldn't be saved.");
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="space-y-3" data-film-note-editor>
      <div className="flex items-center justify-between">
        <h3 className="text-[15px] font-semibold">
          {draft.id ? "Edit note" : "New note"}{" "}
          <span className="font-normal text-muted-foreground tabular-nums">on this frame</span>
        </h3>
        <button
          type="button"
          className="h-9 px-2 text-sm text-muted-foreground hover:text-foreground"
          onClick={end}
        >
          Cancel
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5" data-draw-tools>
        {TOOLS.map(({ tool: t, label, icon: Icon }) => (
          <button
            key={t}
            type="button"
            disabled={t === "joint" && !tech.track}
            onClick={() => setTool(t)}
            className={cn(
              "flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium",
              tool === t ? "bg-foreground text-background" : "bg-secondary text-foreground",
              t === "joint" && !tech.track && "opacity-40",
            )}
            aria-pressed={tool === t}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
        <button
          type="button"
          disabled={!draft.shapes.length}
          onClick={() => setDraft({ ...draft, shapes: draft.shapes.slice(0, -1) })}
          className="flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] text-muted-foreground disabled:opacity-40"
          aria-label="Undo the last mark"
        >
          <Undo2 className="h-4 w-4" /> Undo
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        {tool === "joint"
          ? "Tap a joint to circle it: the circle follows it as the video plays."
          : "Drag on the video to draw. Step a frame with ‹ › to pick the moment."}
      </p>
      <Textarea
        value={draft.body}
        onChange={(e) => setDraft({ ...draft, body: e.target.value.slice(0, 1000) })}
        placeholder="What to look at (optional)"
        className="min-h-[76px] text-[16px]"
      />
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          className="h-11"
          disabled={!!busy}
          onClick={() => void save(false)}
        >
          {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save on video
        </Button>
        <Button
          className="h-11 gap-1.5"
          disabled={!!busy}
          onClick={() => void save(true)}
          data-film-note-send
        >
          {busy === "send" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          {staff ? "Send in chat" : "Send to coach"}
        </Button>
      </div>
    </div>
  );
}
