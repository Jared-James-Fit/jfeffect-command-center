/**
 * Bar path & speed for one set video, full screen (lazy: opened from the set
 * video's sheet or its card in the coach chat). Four steps, one main button
 * each:
 *
 *   1. Find: the bar's plate is looked for on this device (a second or two).
 *   2. Confirm: the video paused on the plate with one ring on it, the best
 *      guess (never a choice of circles: a guess that's only a circle the
 *      finder saw is snapped to the plate's rim first). Drag the ring onto
 *      the plate (the picture under the finger magnified), drag its edge dot
 *      to the plate's rim, or tap the plate anywhere and the ring snaps to
 *      it. The plate's size is one row, changed only if it
 *      isn't a standard 450 mm plate. What about the footage will cost
 *      accuracy is said here, with how to film it better. Analyze.
 *   3. Analyze: followed through every frame, both ways from the marker.
 *   4. Results: the path over the video, the set and each rep. Where the
 *      plate was lost, Fix tracking puts the ring back on it on that frame
 *      and reads it again from the same marker, never from scratch.
 *
 * A set video read by itself after it was sent (auto.ts) opens straight on
 * its results, or on Confirm with the ring already where it found the plate.
 * The athlete, their coach and admins can read, redo or remove it.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronLeft,
  Crosshair,
  MoreHorizontal,
  RotateCcw,
  Ruler,
  Trash2,
  Video,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  BarPathPlayer,
  type Marker,
  type PickSuggestion,
} from "@/components/lift-analysis/bar-path-player";
import { FilmingGuide } from "@/components/lift-analysis/filming-guide";
import {
  LoadVelocityChart,
  RepSpeedBars,
  RepSpeedCurve,
} from "@/components/lift-analysis/velocity-charts";
import { useClientWeightUnit } from "@/hooks/use-client-weight-unit";
import type { LiftAnalysis } from "@/lib/lift-analysis/analyze";
import { DEFAULT_PLATE, STANDARD_PLATE_MM } from "@/lib/lift-analysis/calibrate";
import { guideLift, repDirection } from "@/lib/lift-analysis/exercise";
import { FOOTAGE_WORDS, type FootageIssue } from "@/lib/lift-analysis/footage";
import {
  cm,
  noteWords,
  percent,
  seconds,
  shownNotes,
  speed,
  speedMargin,
  tierWord,
  whyWords,
  withinNoise,
} from "@/lib/lift-analysis/format";
import type { Metric } from "@/lib/lift-analysis/kinematics";
import type { LvPoint, LvProfile } from "@/lib/lift-analysis/profile";
import {
  compareToExpected,
  fitLoadVelocity,
  predictVelocity,
  whyNoPrediction,
} from "@/lib/lift-analysis/velocity-model";
import {
  deleteAnalysis,
  isRead,
  preselectOf,
  saveAnalysis,
  type Suggestion,
  useVelocityHistory,
  useSetForVideo,
  useSetVideoAnalyses,
} from "@/lib/lift-analysis/queries";
import { loggedState, type LoggedSet } from "@/lib/lift-analysis/verdict";
import {
  analyzeVideo,
  locatePlate,
  overallProgress,
  toShownKey,
  type RunProgress,
  type ShownProposal,
  type ShownSeed,
} from "@/lib/lift-analysis/run";
import { useRunningAnalysis } from "@/lib/lift-analysis/store";
import { oneRing } from "@/lib/lift-analysis/suggestions";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  setVideoId: string;
  /** The video's signed link (and poster). */
  src?: string;
  poster?: string;
  exerciseName: string;
  /** "Top set · 455 lb × 1", or "". */
  setLabel?: string;
  /** Start finding the bar straight away when there's no analysis yet. */
  startOnOpen?: boolean;
};

const STAGE_WORDS: Record<RunProgress["stage"], string> = {
  opening: "Opening the video",
  finding: "Finding the bar",
  tracking: "Following the bar through every frame",
  measuring: "Measuring the plate",
  reading: "Reading the reps",
};

/** The plates a bar can carry, by diameter. */
const PLATE_SIZES = [
  { mm: 450, label: "450 mm", sub: "20 kg / 45 lb, every bumper" },
  { mm: 400, label: "400 mm", sub: "15 kg calibrated" },
  { mm: 325, label: "325 mm", sub: "10 kg calibrated" },
] as const;

type Step = "idle" | "detecting" | "confirm" | "analyzing" | "results" | "fix" | "failed";

export default function LiftAnalysisView(props: Props) {
  const { open, onOpenChange } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="fixed inset-0 left-0 top-0 flex h-[100dvh] max-h-none w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-background p-0 sm:left-1/2 sm:top-1/2 sm:h-[min(96dvh,920px)] sm:max-w-[520px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[28px] outline-none focus:outline-none focus-visible:outline-none [&>button]:hidden"
        onOpenAutoFocus={(e) => e.preventDefault()}
        data-lift-analysis-view
      >
        <DialogTitle className="sr-only">Bar path and speed</DialogTitle>
        <DialogDescription className="sr-only">
          The set video with its bar path, and each rep's speed.
        </DialogDescription>
        {open && <Body {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function Body({
  onOpenChange,
  setVideoId,
  src,
  poster,
  exerciseName,
  setLabel,
  startOnOpen,
}: Props) {
  const { data: storedMap, isLoading } = useSetVideoAnalyses([setVideoId]);
  const stored = storedMap?.[setVideoId] ?? null;
  const saved = isRead(stored) ? stored : null;
  // tried by itself after it was sent: the bar needs confirming (with where it thinks it is), or it couldn't be read
  const notRead = stored && !saved ? stored : null;
  const { data: loggedSet } = useSetForVideo(setVideoId);
  const autoRun = useRunningAnalysis(setVideoId);
  const [fresh, setFresh] = useState<LiftAnalysis | null>(null);
  const [step, setStep] = useState<Step>("idle");
  const [guide, setGuide] = useState(false);
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [proposal, setProposal] = useState<ShownProposal | null>(null);
  const [candidates, setCandidates] = useState<PickSuggestion[]>([]);
  const [marker, setMarker] = useState<Marker | null>(null);
  const [locating, setLocating] = useState(false);
  /** Bumped whenever the ring is moved, so a snap that lands later never moves it back. */
  const ringMoves = useRef(0);
  /** The clip's width ÷ height (a ring's height as a share of the frame follows from its width). */
  const [aspect, setAspect] = useState(9 / 16);
  const [corrections, setCorrections] = useState<Marker[]>([]);
  const [failure, setFailure] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [plateMm, setPlateMm] = useState<number | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const analysis = fresh ?? saved?.result ?? null;
  const dirHint = repDirection(exerciseName) ?? undefined;
  const lift = guideLift(exerciseName);

  useEffect(() => () => ctrl.current?.abort(), []);
  // each step (and the guide) starts at its own top
  useEffect(() => {
    if (panel.current) panel.current.scrollTop = 0;
  }, [step, guide]);

  // the plate's size: the athlete's pick, else a size confirmed on an earlier read, else the standard one (unconfirmed)
  const plateFor = (mm: number | null) =>
    mm == null ? DEFAULT_PLATE : { mm, rel: 0.005, confirmed: true };
  const knownPlate = plateMm ?? (analysis?.plate.confirmed ? analysis.plate.mm : null);

  const abortable = () => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    return c;
  };

  /** 1. Find the bar (detection only) and show it to confirm. */
  const detect = async () => {
    if (!src) return;
    const c = abortable();
    setStep("detecting");
    setProgress({ stage: "opening", progress: 0 });
    const res = await analyzeVideo({
      source: src,
      detectOnly: true,
      signal: c.signal,
      onProgress: setProgress,
    });
    if (c.signal.aborted) return;
    setProgress(null);
    if (res.ok) return; // detectOnly never reads
    if (res.why === "cancelled") return setStep(analysis ? "results" : "idle");
    if (res.why === "unreadable" || res.why === "too_short") {
      setFailure(
        res.why === "too_short"
          ? "This clip is too short to read a rep from."
          : "This video couldn't be opened on this device.",
      );
      return setStep("failed");
    }
    const shape = res.clip ? res.clip.width / Math.max(1, res.clip.height) : aspect;
    setAspect(shape);
    setProposal(res.proposal);
    setCandidates(res.proposal?.candidates ?? []);
    const k = res.proposal?.key;
    openOnRing(
      k ? { t: k.t, fx: k.fx, fy: k.fy, fa: k.fa, fb: k.fb } : null,
      res.proposal?.candidates ?? [],
      shape,
    );
    setStep("confirm");
  };

  /** Confirm's one ring: the best guess, snapped to the plate's rim when it's only a circle the finder saw. */
  const openOnRing = (pre: Marker | null, circles: PickSuggestion[], shape: number) => {
    const one = oneRing(pre, circles, shape);
    ringMoves.current++;
    setMarker(one?.ring ?? null);
    if (one?.fromCircle) void snapRing(one.ring);
  };

  const snapRing = async (ring: Marker) => {
    if (!src) return;
    const move = ++ringMoves.current;
    setLocating(true);
    const found = await locatePlate({ source: src, t: ring.t, fx: ring.fx, fy: ring.fy }).catch(
      () => null,
    );
    if (move !== ringMoves.current) return; // moved meanwhile: theirs wins
    setLocating(false);
    if (found)
      setMarker({
        t: found.key.t,
        fx: found.key.fx,
        fy: found.key.fy,
        fa: found.key.fa,
        fb: found.key.fb,
      });
  };

  /** The athlete dragged or resized the ring. */
  const moveRing = (m: Marker) => {
    ringMoves.current++;
    setLocating(false);
    setMarker(m);
  };

  /** 3. Follow it through the set and read it. */
  const analyze = async (seed: ShownSeed, extra: { fx: number; fy: number; t: number }[] = []) => {
    if (!src) return;
    const c = abortable();
    setStep("analyzing");
    setSelected(null);
    setProgress({ stage: "opening", progress: 0 });
    const res = await analyzeVideo({
      source: src,
      seed,
      corrections: extra,
      plate: plateFor(knownPlate),
      dirHint,
      signal: c.signal,
      onProgress: setProgress,
    });
    if (c.signal.aborted) return;
    setProgress(null);
    if (res.ok) {
      setFresh(res.analysis);
      setCorrections([]);
      setStep("results");
      try {
        await saveAnalysis(setVideoId, res.analysis);
      } catch (e) {
        toast.error(e instanceof Error && e.message ? e.message : "Couldn't save the analysis.");
      }
      return;
    }
    if (res.why === "cancelled") return setStep(seed.kind === "keys" ? "fix" : "confirm");
    if (res.why === "unreadable" || res.why === "too_short") {
      setFailure("This video couldn't be read on this device.");
      return setStep("failed");
    }
    // never a dead end: back to the marker, with what the plate looked like
    toast.message(
      res.why === "no_plate_at_tap"
        ? "No plate under the marker. Put the ring on the end of the bar."
        : "The plate couldn't be followed from there. Put the ring on the plate where it's easy to see.",
    );
    if (res.proposal) setCandidates(res.proposal.candidates);
    if (!marker && res.proposal) openOnRing(res.proposal.key, res.proposal.candidates, aspect);
    setStep("confirm");
  };

  // opening: results if there's a read; confirm straight away when it was found by itself but needs a look
  const started = useRef(false);
  useEffect(() => {
    if (started.current || isLoading || autoRun) return;
    if (saved) {
      started.current = true;
      setStep("results");
      return;
    }
    if (!src) return;
    if (notRead?.status === "needs_tap") {
      started.current = true;
      const s = (notRead.result as unknown as { suggestions?: Suggestion[] })?.suggestions ?? [];
      const pre = preselectOf(s);
      // a read stored before Nov 22 2026 kept the other circles but not its best guess: find it again
      // (a second or two) rather than open on a circle that isn't the plate
      if (!pre) {
        void detect();
        return;
      }
      setCandidates(s.filter((x) => !x.preselect));
      openOnRing(pre, [], aspect);
      setStep("confirm");
      return;
    }
    if (!startOnOpen && notRead) return;
    if (!startOnOpen) return;
    started.current = true;
    void detect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startOnOpen, isLoading, !!saved, notRead?.status, autoRun, src]);

  // a read by itself landed while this was open
  useEffect(() => {
    if (saved && step === "idle") setStep("results");
  }, [saved, step]);

  const placeAt = async (t: number, fx: number, fy: number) => {
    if (!src) return;
    // a ringed circle: take it as it is
    const hit = candidates.find((c) => Math.hypot(c.fx - fx, (c.fy - fy) / aspect) <= c.fr * 1.1);
    const move = ++ringMoves.current;
    setLocating(true);
    const found = await locatePlate({ source: src, t, fx: hit?.fx ?? fx, fy: hit?.fy ?? fy }).catch(
      () => null,
    );
    if (move !== ringMoves.current) return; // moved again meanwhile
    setLocating(false);
    if (found) {
      setMarker({
        t: found.key.t,
        fx: found.key.fx,
        fy: found.key.fy,
        fa: found.key.fa,
        fb: found.key.fb,
      });
      return;
    }
    // nothing round there: the ring goes where the finger was, for the athlete to size
    const size = marker
      ? { fa: marker.fa, fb: marker.fb }
      : hit
        ? { fa: hit.fr, fb: hit.fr * aspect }
        : { fa: 0.09, fb: 0.09 * aspect };
    setMarker({ t, fx, fy, ...size });
    toast.message(
      "Couldn't find the plate's edge there. Drag the ring's dot out to the plate's rim.",
    );
  };

  const startFix = () => {
    if (!analysis) return;
    setCorrections([]);
    setSelected(null);
    setStep("fix");
  };

  const reanalyzeWithFixes = () => {
    if (!analysis) return;
    const w = analysis.frame.w;
    const h = analysis.frame.h;
    const keys = analysis.track?.keys?.length
      ? analysis.track.keys.map((k) => toShownKey(k, w, h))
      : [
          {
            t: analysis.plate.t,
            fx: analysis.plate.x / w,
            fy: analysis.plate.y / h,
            fa: analysis.plate.r / w,
            fb: analysis.plate.r / h,
            source: "confirmed" as const,
          },
        ];
    void analyze(
      { kind: "keys", keys },
      corrections.map((c) => ({ t: c.t, fx: c.fx, fy: c.fy })),
    );
  };

  const remove = async () => {
    try {
      await deleteAnalysis(setVideoId);
      setFresh(null);
      toast.success("Analysis removed");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "Couldn't remove it.");
    }
  };

  const running = step === "detecting" || step === "analyzing" || (!!autoRun && !saved);
  const shownProgress = progress ?? autoRun;
  const fixSize = useMemo(() => {
    if (!analysis) return undefined;
    const k = analysis.track?.keys?.[0];
    const w = analysis.frame.w;
    const h = analysis.frame.h;
    return k
      ? { fa: k.a / w, fb: k.b / h }
      : { fa: analysis.plate.r / w, fb: analysis.plate.r / h };
  }, [analysis]);
  const lostStretches = analysis?.track?.lost ?? [];

  const playerMarker =
    step === "confirm"
      ? {
          value: marker,
          onChange: moveRing,
          onTap: (t: number, fx: number, fy: number) => void placeAt(t, fx, fy),
          busy: locating,
        }
      : step === "fix"
        ? {
            value: null,
            corrections,
            size: fixSize,
            onChange: (m: Marker) =>
              setCorrections((cs) => [
                ...cs.filter((c) => Math.abs(c.t - m.t) > 0.6 / Math.max(1, analysis?.fps ?? 30)),
                m,
              ]),
          }
        : null;

  return (
    <>
      <header
        className="flex shrink-0 items-center gap-1 px-2 pb-1.5"
        style={{ paddingTop: "max(env(safe-area-inset-top), 0.6rem)" }}
      >
        <button
          type="button"
          onClick={() => {
            if (guide) return setGuide(false);
            if (step === "fix") return setStep("results");
            onOpenChange(false);
          }}
          className="grid h-11 w-11 place-items-center rounded-full hover:bg-muted"
          aria-label="Back"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold">{exerciseName}</div>
          <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span className="truncate">
              {setLabel ? `${setLabel} · bar path & speed` : "Bar path & speed"}
            </span>
            <span
              className="shrink-0 rounded-full bg-muted px-1.5 py-px text-[10px] font-semibold text-muted-foreground"
              data-beta
            >
              Beta
            </span>
          </div>
        </div>
        {step === "results" && analysis && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="grid h-11 w-11 place-items-center rounded-full hover:bg-muted"
                aria-label="More"
                data-lift-analysis-more
              >
                <MoreHorizontal className="h-5 w-5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[14rem]">
              <DropdownMenuItem className="h-11 gap-2" onSelect={startFix}>
                <Crosshair className="h-4 w-4" /> Fix tracking
              </DropdownMenuItem>
              <DropdownMenuItem className="h-11 gap-2" onSelect={() => void detect()}>
                <RotateCcw className="h-4 w-4" /> Start over
              </DropdownMenuItem>
              <DropdownMenuItem className="h-11 gap-2" onSelect={() => setGuide(true)}>
                <Video className="h-4 w-4" /> How to film it
              </DropdownMenuItem>
              <DropdownMenuItem
                className="h-11 gap-2 text-destructive focus:text-destructive"
                onSelect={() => void remove()}
              >
                <Trash2 className="h-4 w-4" /> Remove analysis
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>

      <BarPathPlayer
        src={src}
        poster={poster}
        analysis={step === "results" || step === "fix" ? analysis : null}
        selectedRep={selected}
        onSelectRep={setSelected}
        marker={playerMarker}
        lost={step === "results" || step === "fix" ? lostStretches : undefined}
        onVideoSize={(w, h) => setAspect(w / Math.max(1, h))}
        initialTime={
          step === "confirm"
            ? (marker?.t ?? candidates[0]?.t ?? null)
            : step === "fix"
              ? (lostStretches[0]?.start ?? analysis?.window.start ?? null)
              : null
        }
        className="h-[min(56dvh,520px)] shrink-0"
      />

      <div
        ref={panel}
        className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-3"
      >
        {guide ? (
          <section data-guide-panel>
            <h3 className="text-[16px] font-semibold">How to film a set for bar speed</h3>
            <div className="mt-3">
              <FilmingGuide lift={lift} />
            </div>
            <Button variant="outline" className="mt-4 h-11 w-full" onClick={() => setGuide(false)}>
              Done
            </Button>
          </section>
        ) : running && shownProgress ? (
          <ProgressPanel
            progress={shownProgress}
            onCancel={
              step === "detecting" || step === "analyzing"
                ? () => {
                    ctrl.current?.abort();
                    setProgress(null);
                    setStep(step === "analyzing" ? "confirm" : analysis ? "results" : "idle");
                  }
                : undefined
            }
          />
        ) : step === "confirm" ? (
          <ConfirmPanel
            marker={marker}
            proposal={proposal}
            locating={locating}
            plateMm={knownPlate ?? STANDARD_PLATE_MM}
            plateSet={knownPlate != null}
            onPlate={setPlateMm}
            onGuide={() => setGuide(true)}
            onAnalyze={() =>
              marker &&
              void analyze({
                kind: "marker",
                t: marker.t,
                fx: marker.fx,
                fy: marker.fy,
                fa: marker.fa,
                fb: marker.fb,
              })
            }
          />
        ) : step === "fix" ? (
          <FixPanel
            count={corrections.length}
            lost={lostStretches.length}
            onUndo={() => setCorrections((cs) => cs.slice(0, -1))}
            onCancel={() => setStep("results")}
            onAnalyze={reanalyzeWithFixes}
          />
        ) : step === "failed" ? (
          <div className="rounded-2xl border border-border p-4">
            <p className="text-sm">{failure}</p>
            <Button variant="outline" className="mt-3 h-10" onClick={() => void detect()}>
              Try again
            </Button>
          </div>
        ) : step === "results" && analysis ? (
          <Results
            analysis={analysis}
            selected={selected}
            onSelect={setSelected}
            setVideoId={setVideoId}
            clientId={saved?.client_id ?? null}
            exerciseId={saved?.exercise_id ?? null}
            loggedSet={loggedSet ?? null}
            fresh={!!fresh}
            onFix={startFix}
            onGuide={() => setGuide(true)}
            exerciseName={exerciseName}
          />
        ) : !isLoading ? (
          <div className="rounded-2xl border border-border p-4">
            <p className="text-sm text-muted-foreground">
              {notRead?.status === "failed"
                ? "This video couldn't be read on the phone that sent it. Try it here."
                : "Reads the bar's path and speed from the video, on this device. Nothing is uploaded."}
            </p>
            <Button
              className="mt-3 h-11 w-full"
              onClick={() => void detect()}
              disabled={!src}
              data-lift-analysis-start
            >
              Find the bar
            </Button>
            <button
              type="button"
              className="mt-2 h-10 w-full text-sm text-muted-foreground hover:text-foreground"
              onClick={() => setGuide(true)}
            >
              How to film it
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}

function ProgressPanel({ progress, onCancel }: { progress: RunProgress; onCancel?: () => void }) {
  return (
    <div className="rounded-2xl border border-border p-4" data-lift-analysis-progress>
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{STAGE_WORDS[progress.stage]}…</span>
        {onCancel && (
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            onClick={onCancel}
          >
            Cancel
          </button>
        )}
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-foreground transition-[width] duration-300"
          style={{ width: `${Math.round(100 * overallProgress(progress))}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Read on this device. Nothing is uploaded.
      </p>
    </div>
  );
}

function ConfirmPanel({
  marker,
  proposal,
  locating,
  plateMm,
  plateSet,
  onPlate,
  onGuide,
  onAnalyze,
}: {
  marker: Marker | null;
  proposal: ShownProposal | null;
  locating: boolean;
  plateMm: number;
  plateSet: boolean;
  onPlate: (mm: number | null) => void;
  onGuide: () => void;
  onAnalyze: () => void;
}) {
  const [plateOpen, setPlateOpen] = useState(false);
  const [other, setOther] = useState("");
  const issues: FootageIssue[] = proposal?.footage ?? [];
  const sure = proposal?.confidence === "high" && !!marker;
  const otherMm = Number(other);
  const otherOk = Number.isFinite(otherMm) && otherMm >= 150 && otherMm <= 500;
  return (
    <div className="space-y-3" data-lift-analysis-confirm>
      <div>
        <p className="text-[16px] font-semibold">
          {marker
            ? sure
              ? "Is the ring on the end of the bar?"
              : "Check the ring"
            : "Tap the end of the bar"}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {locating
            ? "Finding the plate there…"
            : marker
              ? "Drag it onto the plate if it's off, and its dot out to the plate's rim. Or tap the plate anywhere."
              : "Pause where the plate is easy to see, then tap the plate on the end of the bar."}
        </p>
      </div>

      {issues.length > 0 && (
        <div className="rounded-xl bg-muted/50 p-3" data-footage-issues>
          <p className="text-sm font-medium">This video will be less exact</p>
          <ul className="mt-1.5 space-y-1.5">
            {issues.map((k) => (
              <li key={k} className="text-xs leading-snug text-muted-foreground">
                <span className="font-medium text-foreground">{FOOTAGE_WORDS[k].title}.</span>{" "}
                {FOOTAGE_WORDS[k].fix}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-xl border border-border" data-plate-size>
        <button
          type="button"
          className="flex h-12 w-full items-center gap-2 px-3 text-left text-sm"
          onClick={() => setPlateOpen((o) => !o)}
          aria-expanded={plateOpen}
        >
          <Ruler className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            Biggest plate: <span className="font-medium">{Math.round(plateMm)} mm</span>
            {!plateSet && plateMm === STANDARD_PLATE_MM && (
              <span className="text-muted-foreground"> · standard</span>
            )}
          </span>
          <span className="text-muted-foreground">Change</span>
        </button>
        {plateOpen && (
          <div className="space-y-1.5 border-t border-border p-3">
            <p className="text-xs text-muted-foreground">
              Its diameter is the ruler every speed is measured with. Pick it from the plate, never
              its look.
            </p>
            {PLATE_SIZES.map((p) => (
              <button
                key={p.mm}
                type="button"
                onClick={() => {
                  onPlate(p.mm);
                  setPlateOpen(false);
                }}
                className={cn(
                  "flex h-11 w-full items-center justify-between rounded-lg border px-3 text-left text-sm",
                  plateMm === p.mm && plateSet ? "border-foreground" : "border-border",
                )}
              >
                <span className="font-medium">{p.label}</span>
                <span className="text-xs text-muted-foreground">{p.sub}</span>
              </button>
            ))}
            <label className="flex items-center gap-2 pt-1 text-sm">
              <span className="text-muted-foreground">Other</span>
              <input
                inputMode="decimal"
                value={other}
                onChange={(e) => setOther(e.target.value)}
                placeholder="mm"
                className="h-10 w-24 rounded-lg border border-border bg-transparent px-2 text-base"
                aria-label="Plate diameter in millimetres"
              />
              <span className="text-muted-foreground">mm across</span>
              <Button
                variant="outline"
                className="ml-auto h-10"
                disabled={!otherOk}
                onClick={() => {
                  onPlate(otherMm);
                  setPlateOpen(false);
                }}
              >
                Use
              </Button>
            </label>
          </div>
        )}
      </div>

      <Button
        className="h-12 w-full"
        disabled={!marker || locating}
        onClick={onAnalyze}
        data-lift-analysis-analyze
      >
        Analyze
      </Button>
      <button
        type="button"
        className="h-10 w-full text-sm text-muted-foreground hover:text-foreground"
        onClick={onGuide}
      >
        How to film it
      </button>
    </div>
  );
}

function FixPanel({
  count,
  lost,
  onUndo,
  onCancel,
  onAnalyze,
}: {
  count: number;
  lost: number;
  onUndo: () => void;
  onCancel: () => void;
  onAnalyze: () => void;
}) {
  return (
    <div className="space-y-3" data-lift-analysis-fix>
      <div>
        <p className="text-[16px] font-semibold">Fix tracking</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {lost
            ? "Amber on the timeline is where the plate was lost. Go there, and drag the ring onto the plate."
            : "Move the video to where the ring is off the plate, and drag it back onto the plate."}{" "}
          Everything else stays as it was.
        </p>
      </div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          {count ? `${count} ${count === 1 ? "frame" : "frames"} fixed` : "No frames fixed yet"}
        </span>
        {count > 0 && (
          <button
            type="button"
            className="h-10 px-2 text-muted-foreground hover:text-foreground"
            onClick={onUndo}
          >
            Undo
          </button>
        )}
      </div>
      <Button
        className="h-12 w-full"
        disabled={!count}
        onClick={onAnalyze}
        data-lift-analysis-reanalyze
      >
        Analyze again
      </Button>
      <button
        type="button"
        className="h-10 w-full text-sm text-muted-foreground hover:text-foreground"
        onClick={onCancel}
      >
        Cancel
      </button>
    </div>
  );
}

function TierNote({ m }: { m: Metric }) {
  if (m.tier === "unavailable")
    return (
      <span className="text-xs text-muted-foreground">{whyWords(m.why) || tierWord(m.tier)}</span>
    );
  return (
    <span className="text-xs text-muted-foreground">
      {tierWord(m.tier)}
      {m.u != null ? ` · ${speedMargin(m)}` : ""}
    </span>
  );
}

function Stat({
  label,
  value,
  sub,
  testId,
}: {
  label: string;
  value: string;
  sub?: string;
  testId?: string;
}) {
  return (
    <div className="min-w-0" data-stat={testId}>
      <div className="text-[12px] text-muted-foreground">{label}</div>
      <div className="text-[17px] font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-[11px] leading-snug text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Results({
  analysis: a,
  selected,
  onSelect,
  setVideoId,
  clientId,
  exerciseId,
  loggedSet,
  fresh,
  onFix,
  onGuide,
  exerciseName,
}: {
  exerciseName: string;
  analysis: LiftAnalysis;
  selected: number | null;
  onSelect: (i: number | null) => void;
  setVideoId: string;
  clientId: string | null;
  exerciseId: string | null;
  loggedSet: LoggedSet | null;
  /** Read just now, on this device (the set is read again once the save lands). */
  fresh: boolean;
  onFix: () => void;
  onGuide: () => void;
}) {
  const calibrated = a.units === "mm";
  const headline = a.set.reps > 1 ? a.set.bestMcv : a.set.firstMcv;
  const repIdx =
    selected ??
    (a.reps.length
      ? Math.max(
          0,
          a.reps.findIndex((r) => r.mcv.v === a.set.bestMcv.v),
        )
      : 0);
  const rep = a.reps[repIdx];
  const notes = shownNotes(a);
  const incomplete = a.reps.filter((r) => !r.complete).length;
  // an older read (before set velocities were logged) has no verdict: nothing said
  const logged = a.velocity ? loggedState(a, loggedSet, setVideoId) : null;
  const notLogged = logged && !logged.logged ? logged.text : null;

  const lost = a.track?.lost?.length ?? 0;
  if (!a.reps.length) {
    return (
      <div className="rounded-2xl border border-border p-4">
        <p className="text-sm font-semibold">No reps found</p>
        <p className="mt-1 text-sm text-muted-foreground">
          The bar didn't move up and down enough to count a rep, or the plate was lost. Fix tracking
          puts the ring back on the plate where it went wrong.
        </p>
        <Button variant="outline" className="mt-3 h-10" onClick={onFix}>
          Fix tracking
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-lift-analysis-results>
      {/* the set at a glance */}
      <section>
        {a.velocity?.accepted && a.velocity.value != null ? (
          <SetAverage analysis={a} setVideoId={setVideoId} loggedSet={loggedSet} fresh={fresh} />
        ) : calibrated && headline.tier !== "unavailable" ? (
          <>
            <div className="text-[12px] text-muted-foreground">
              {a.set.reps > 1 ? "Fastest rep · mean velocity up" : "Mean velocity up"}
            </div>
            <div className="flex items-baseline gap-2">
              <span
                className="text-[32px] font-semibold leading-tight tabular-nums"
                data-headline-speed
              >
                {speed(headline)}
              </span>
            </div>
            <TierNote m={headline} />
            {notLogged && (
              <p className="mt-1 text-xs text-muted-foreground" data-velocity-not-logged>
                {notLogged.replace("Not logged:", "Set velocity not logged:")}
              </p>
            )}
          </>
        ) : (
          <>
            <div className="text-[15px] font-semibold">Bar speed not available</div>
            <p className="text-sm text-muted-foreground">
              {calibrated ? whyWords(headline.why) : noteWords("not_calibrated").tip}
            </p>
          </>
        )}
        <div className="mt-3 grid grid-cols-3 gap-3">
          <Stat
            label="Reps"
            value={String(a.set.reps)}
            sub={incomplete ? `${incomplete} not finished` : undefined}
            testId="reps"
          />
          <Stat
            label="Velocity loss"
            value={a.set.reps > 1 ? percent(a.set.velocityLoss) : "—"}
            sub={
              a.set.reps > 1
                ? a.set.velocityLoss.tier === "unavailable"
                  ? whyWords(a.set.velocityLoss.why)
                  : "fastest rep to last"
                : "needs 2+ reps"
            }
            testId="velocity-loss"
          />
          <Stat
            label="Range of motion"
            value={cm(a.set.romMean)}
            sub={calibrated ? "average, bar" : undefined}
            testId="rom"
          />
        </div>
      </section>

      {/* each rep */}
      <section className="rounded-2xl border border-border p-3">
        <div className="mb-1 flex items-baseline justify-between">
          <h3 className="text-[15px] font-semibold">Each rep</h3>
          <span className="text-xs text-muted-foreground">
            {calibrated ? "mean velocity up, m/s" : "tap a rep"}
          </span>
        </div>
        {calibrated && (
          <RepSpeedBars
            analysis={a}
            selected={selected}
            onSelect={(i) => onSelect(selected === i ? null : i)}
          />
        )}
        {rep && <RepDetail analysis={a} index={repIdx} lift={guideLift(exerciseName)} />}
      </section>

      {notes.length > 0 && (
        <section className="space-y-2" data-quality-notes>
          {notes.map((n) => (
            <div key={n} className="rounded-xl bg-muted/50 p-3">
              <div className="text-sm font-medium">{noteWords(n).title}</div>
              <div className="mt-0.5 text-xs leading-snug text-muted-foreground">
                {noteWords(n).tip}
              </div>
              {(n === "tracking_gaps" || n === "plate_hidden") && (
                <button
                  type="button"
                  className="mt-1.5 h-9 text-sm font-medium underline-offset-2 hover:underline"
                  onClick={onFix}
                >
                  Fix tracking
                </button>
              )}
            </div>
          ))}
          {notes.some((n) => FILMING_NOTES.has(n)) && (
            <button
              type="button"
              className="h-10 text-sm text-muted-foreground hover:text-foreground"
              onClick={onGuide}
            >
              How to film it next time
            </button>
          )}
        </section>
      )}

      {lost > 0 && !notes.includes("tracking_gaps") && (
        <button
          type="button"
          className="flex h-11 w-full items-center gap-2 rounded-xl border border-border px-3 text-left text-sm"
          onClick={onFix}
        >
          <Crosshair className="h-4 w-4 text-muted-foreground" />
          <span className="flex-1">
            The plate was lost {lost === 1 ? "once" : `${lost} times`}. Fix tracking
          </span>
        </button>
      )}

      <MoreDetail>
        <Consistency analysis={a} />
        {clientId && exerciseId && calibrated && (
          <Compare
            setVideoId={setVideoId}
            clientId={clientId}
            exerciseId={exerciseId}
            analysis={a}
          />
        )}
        <HowMeasured analysis={a} />
      </MoreDetail>
    </div>
  );
}

/** Notes a better video would fix. */
const FILMING_NOTES = new Set([
  "camera_moved",
  "camera_tilted",
  "camera_turned",
  "plate_small",
  "low_fps",
  "plate_edge_faint",
  "not_calibrated",
]);

/** Rep to rep, compared with other sets and how it's measured: folded until asked for. */
function MoreDetail({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        className="flex h-11 w-full items-center justify-between border-t border-border text-sm font-medium"
        data-more-detail
      >
        More detail
        <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 pb-2">{children}</CollapsibleContent>
    </Collapsible>
  );
}

/** The set's average of every rep, and whether it's the set's velocity in the logger. */
function SetAverage({
  analysis: a,
  setVideoId,
  loggedSet,
  fresh,
}: {
  analysis: LiftAnalysis;
  setVideoId: string;
  loggedSet: LoggedSet | null;
  fresh: boolean;
}) {
  const state = loggedState(a, loggedSet, setVideoId);
  const reps = a.velocity.reps;
  return (
    <div data-set-average>
      <div className="text-[12px] text-muted-foreground">
        {reps > 1 ? `Average velocity · all ${reps} reps` : "Mean velocity up"}
      </div>
      <div className="text-[32px] font-semibold leading-tight tabular-nums" data-headline-speed>
        {a.velocity.value!.toFixed(2)} m/s
      </div>
      <p
        className="text-xs text-muted-foreground"
        data-logged-state={state.logged ? "logged" : state.why}
      >
        {state.logged
          ? "Logged to the set"
          : fresh && state.why === "other"
            ? "Saving to the set…"
            : state.text}
      </p>
    </div>
  );
}

/** Each phase of a rep in the lift's own words. */
const PHASE_WORDS: Record<
  ReturnType<typeof guideLift>,
  { down: string; pause: string; up: string; lowering: string }
> = {
  bench: {
    down: "Down to the chest",
    pause: "Pause on the chest",
    up: "Press up",
    lowering: "Lowering",
  },
  squat: { down: "Down", pause: "Pause at the bottom", up: "Up", lowering: "Lowering" },
  deadlift: {
    down: "Down",
    pause: "Pause at the bottom",
    up: "Pull up",
    lowering: "Lowering to the floor",
  },
  other: {
    down: "Down (eccentric)",
    pause: "Pause at the bottom",
    up: "Up (concentric)",
    lowering: "Lowering",
  },
};

function RepDetail({
  analysis: a,
  index,
  lift,
}: {
  analysis: LiftAnalysis;
  index: number;
  lift: ReturnType<typeof guideLift>;
}) {
  const r = a.reps[index];
  const calibrated = a.units === "mm";
  const lowerFirst = r.dir === "lower_first";
  const words = PHASE_WORDS[lift];
  const stick = r.sticking;
  // a sticking point is said only when a dip could have been seen: the peak read, at 50 fps or more
  const stickReadable = !!stick || (r.peak.tier !== "unavailable" && a.fps >= 50);
  return (
    <div className="mt-2 border-t border-border/60 pt-3" data-rep-detail={index + 1}>
      <div className="mb-2 text-sm font-semibold">
        Rep {index + 1}
        {!r.complete && (
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            didn't reach the top
          </span>
        )}
      </div>
      {calibrated && <RepSpeedCurve analysis={a} rep={index} />}
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3">
        <Stat
          label="Mean velocity up"
          value={speed(r.mcv)}
          sub={
            r.mcv.tier === "unavailable"
              ? whyWords(r.mcv.why)
              : `${tierWord(r.mcv.tier)} ${speedMargin(r.mcv)}`
          }
          testId="mcv"
        />
        <Stat
          label="Peak velocity"
          value={speed(r.peak)}
          sub={
            r.peak.tier === "unavailable"
              ? whyWords(r.peak.why)
              : r.peak.at != null
                ? `${Math.round(r.peak.at * 100)}% of the way up`
                : undefined
          }
          testId="peak"
        />
        {lowerFirst && <Stat label={words.down} value={seconds(r.eccDur)} testId="ecc" />}
        {lowerFirst && r.pause.v != null && r.pause.tier !== "unavailable" && (
          <Stat
            label={words.pause}
            value={r.pause.v < 0.08 ? "None" : seconds(r.pause)}
            testId="pause"
          />
        )}
        <Stat label={words.up} value={seconds(r.conDur)} testId="con" />
        {!lowerFirst && <Stat label={words.lowering} value={seconds(r.eccDur)} testId="ecc" />}
        <Stat label="Range of motion" value={cm(r.rom)} testId="rep-rom" />
        <Stat
          label="Bar drift (up)"
          value={withinNoise(r.xDev) ? "None" : cm(r.xDev)}
          sub={r.xDev.tier !== "unavailable" ? "most the bar moved sideways" : undefined}
          testId="drift"
        />
        {stickReadable && (
          <Stat
            label="Sticking point"
            value={stick ? `${Math.round(stick.at * 100)}% up` : "None"}
            sub={
              stick
                ? `${stick.height.tier !== "unavailable" ? `${cm(stick.height)} off the bottom · ` : ""}${Math.round(stick.dip * 100)}% slower`
                : "speed built without a dip"
            }
            testId="sticking"
          />
        )}
      </div>
    </div>
  );
}

function Consistency({ analysis: a }: { analysis: LiftAnalysis }) {
  if (a.units !== "mm" || a.set.completeReps < 2) return null;
  const complete = a.reps.filter((r) => r.complete);
  const lines: string[] = [];
  if (a.dir === "lower_first" && a.set.depthSpread.v != null) {
    const spread = a.set.depthSpread;
    if (withinNoise(spread) || spread.v! < 20)
      lines.push(
        `Same depth every rep (bar within ${Math.max(1, Math.round(Math.max(spread.v!, spread.u ?? 0) / 10))} cm).`,
      );
    else {
      const deepest = Math.min(...complete.map((r) => r.bottom));
      const shallow = complete.reduce((b, r) => (r.bottom > b.bottom ? r : b));
      lines.push(
        `Rep ${shallow.n}'s bar stopped ${Math.round((shallow.bottom - deepest) / 10)} cm higher than your deepest.`,
      );
    }
  }
  if (a.set.pathSpread.v != null) {
    const p = a.set.pathSpread;
    lines.push(
      p.v! <= Math.max(15, p.u ?? 0)
        ? "Every rep followed the same bar path."
        : `The bar's path varied by about ${Math.round(p.v! / 10)} cm between reps.`,
    );
  }
  if (!lines.length) return null;
  return (
    <section className="rounded-2xl border border-border p-3" data-consistency>
      <h3 className="text-[15px] font-semibold">Rep to rep</h3>
      <ul className="mt-1 space-y-1 text-sm">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </section>
  );
}

function Compare({
  setVideoId,
  clientId,
  exerciseId,
  analysis,
}: {
  setVideoId: string;
  clientId: string;
  exerciseId: string;
  analysis: LiftAnalysis;
}) {
  // one definition throughout: each measured set's average speed (the logger's), the athlete's own line
  const { data: rows } = useVelocityHistory(clientId, exerciseId);
  const { data: set } = useSetForVideo(setVideoId);
  const { unit } = useClientWeightUnit(clientId);
  const others = useMemo(() => (rows ?? []).filter((r) => r.id !== setVideoId), [rows, setVideoId]);
  const model = useMemo(() => fitLoadVelocity(others.map((r) => r.sample)), [others]);
  if (!rows) return null;
  const fmtLoad = (kg: number) =>
    unit === "lb" ? `${Math.round(kg * 2.20462)} lb` : `${Math.round(kg * 2) / 2} kg`;
  const kg = set?.actual_load_kg != null ? Number(set.actual_load_kg) : null;
  const reps = set?.actual_reps ?? analysis.reps.length;
  const measured = analysis.velocity?.accepted ? analysis.velocity.value : null;
  const pred = kg && kg > 0 && !set?.is_bodyweight ? predictVelocity(model, kg, reps) : null;
  let line: string;
  if (pred) {
    const range = `${pred.lo.toFixed(2)}–${pred.hi.toFixed(2)}`;
    const basis = `from ${pred.sets} of your measured sets`;
    if (measured != null) {
      const call = compareToExpected(measured, pred);
      line = `At ${fmtLoad(kg!)} you were expected to move ${pred.v.toFixed(2)} m/s (${range}, ${basis}). Measured ${measured.toFixed(2)}: ${
        call === "as_expected"
          ? "about as expected"
          : call === "faster"
            ? "faster than expected"
            : "slower than expected"
      }.`;
    } else {
      line = `At ${fmtLoad(kg!)} you're expected to move ${pred.v.toFixed(2)} m/s (${range}, ${basis}). This video's average wasn't measured closely enough to compare.`;
    }
  } else {
    line = `No expected speed yet. ${whyNoPrediction(model)}`;
  }
  const points: LvPoint[] = (rows ?? []).map((r) => ({
    id: r.id,
    kg: r.sample.loadKg,
    v: r.sample.mcv,
    tier: "measured",
    at: r.sample.at,
  }));
  const profile: LvProfile | null =
    model.ok && model.kind === "line"
      ? {
          slope: model.b,
          intercept: model.a - model.b * model.meanLoad,
          r2: 1,
          n: model.n,
          minKg: model.loadRange[0],
          maxKg: model.loadRange[1],
        }
      : null;
  return (
    <section className="rounded-2xl border border-border p-3" data-load-velocity>
      <h3 className="text-[15px] font-semibold">Expected and measured</h3>
      <p className="mt-1 text-sm" data-expected-velocity={pred ? pred.v.toFixed(2) : undefined}>
        {line}
      </p>
      {points.length >= 2 && (
        <>
          <LoadVelocityChart points={points} profile={profile} todayId={setVideoId} unit={unit} />
          <p className="text-[11px] text-muted-foreground">
            Each measured set's average speed by load. This set filled. Expected speeds are worked
            out from your own sets only, never a chart for everyone.
          </p>
        </>
      )}
    </section>
  );
}

function HowMeasured({ analysis: a }: { analysis: LiftAnalysis }) {
  const [open, setOpen] = useState(false);
  const fps = Math.round(a.fps);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        className="flex h-11 w-full items-center justify-between text-sm font-medium"
        data-how-measured
      >
        How it's measured
        <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 pb-2 text-[13px] leading-snug text-muted-foreground">
        <p>
          The plate on the end of the bar is found and followed through every frame ({fps} fps
          here), on this device. Its rim is measured to a fraction of a pixel, and its size (
          {Math.round(a.plate.mm)} mm{a.plate.confirmed ? "" : ", the standard plate"}) is the
          ruler: no sensor on the bar.
        </p>
        <p>
          A rep's velocity up runs from when the bar starts moving up to when it stops at the top.
          Peak velocity is the fastest moment; the sticking point is the slowest moment after the
          first burst of speed, when the bar speeds up again after it.
        </p>
        <p>
          Every number carries a 95% margin worked out from this footage (tracking noise, frame
          timing, the plate's size). Measured means within ±8%; an estimate (≈) has a wider margin;
          anything the footage can't support isn't shown.
        </p>
        <p>
          Camera:{" "}
          {a.plate.view === "side"
            ? "side-on"
            : `about ${Math.round(a.plate.offDeg)}° off side-on (corrected from the plate's shape)`}
          . Bar found {a.plate.source === "tap" ? "from your tap" : "on its own"}. Plate followed in{" "}
          {Math.round(a.quality.tracked * 100)}% of frames.
        </p>
        <p>
          Best results: phone propped (not held), level, 2–3 m away, straight at the end of the bar,
          the whole plate in view, 60 fps.
        </p>
        <p>
          New (beta): checked against test clips with known bar speeds. If a number looks wrong, use
          ⋯ to read it again or pick the bar yourself, and tell your coach.
        </p>
      </CollapsibleContent>
    </Collapsible>
  );
}
