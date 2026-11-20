/**
 * Bar path & speed for one set video, full screen (lazy: opened from the set
 * video's sheet or its card in the coach chat). The video with the bar's path
 * drawn over it on top; under it, in this order and only what the footage
 * supports: the set's headline speed and velocity loss, each rep's speed
 * (tap one for its details), how consistent the reps were, how this set
 * compares with the athlete's other sets of the exercise (load–velocity), and
 * what limited the reading with how to film it better. "How it's measured"
 * is folded at the end.
 *
 * Opened on a video with no analysis yet it reads it at once (on this
 * device); when the plate isn't clear it asks for one tap on the end of the
 * bar. The athlete, their coach and admins can read, redo or remove it.
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
import { BarPathPlayer, type PickSuggestion } from "@/components/lift-analysis/bar-path-player";
import {
  LoadVelocityChart,
  RepSpeedBars,
  RepSpeedCurve,
} from "@/components/lift-analysis/velocity-charts";
import { useClientWeightUnit } from "@/hooks/use-client-weight-unit";
import type { LiftAnalysis } from "@/lib/lift-analysis/analyze";
import { DEFAULT_PLATE, STANDARD_PLATE_MM } from "@/lib/lift-analysis/calibrate";
import { repDirection } from "@/lib/lift-analysis/exercise";
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
import { compareToProfile, fitProfile } from "@/lib/lift-analysis/profile";
import {
  deleteAnalysis,
  saveAnalysis,
  useLoadVelocityPoints,
  useSetVideoAnalyses,
} from "@/lib/lift-analysis/queries";
import { analyzeVideo, type RunProgress } from "@/lib/lift-analysis/run";
import { useRunningAnalysis } from "@/lib/lift-analysis/store";
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
  /** Read it straight away when there's no analysis yet. */
  startOnOpen?: boolean;
};

const STAGE_WORDS: Record<RunProgress["stage"], string> = {
  opening: "Opening the video",
  finding: "Finding the bar",
  tracking: "Following the bar",
  reading: "Reading the reps",
};

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
  const { data: stored, isLoading } = useSetVideoAnalyses([setVideoId]);
  const saved = stored?.[setVideoId] ?? null;
  const autoRun = useRunningAnalysis(setVideoId);
  const [fresh, setFresh] = useState<LiftAnalysis | null>(null);
  const [mode, setMode] = useState<"idle" | "running" | "pick" | "failed">("idle");
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [suggestions, setSuggestions] = useState<PickSuggestion[]>([]);
  const [failure, setFailure] = useState<string>("");
  const [selected, setSelected] = useState<number | null>(null);
  const [plateMm, setPlateMm] = useState<number | null>(null);
  const [plateOpen, setPlateOpen] = useState(false);
  const ctrl = useRef<AbortController | null>(null);
  const analysis = fresh ?? saved?.result ?? null;
  const dirHint = repDirection(exerciseName) ?? undefined;

  useEffect(() => () => ctrl.current?.abort(), []);

  const run = async (
    opts: { tap?: { t: number; fx: number; fy: number }; plate?: number | null } = {},
  ) => {
    if (!src) return;
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setMode("running");
    setProgress({ stage: "opening", progress: 0 });
    setSelected(null);
    const mm = opts.plate ?? plateMm ?? analysis?.plate.mm ?? STANDARD_PLATE_MM;
    const plate =
      mm === STANDARD_PLATE_MM && !(opts.plate || plateMm)
        ? DEFAULT_PLATE
        : { mm, rel: 0.005, confirmed: true };
    const res = await analyzeVideo({
      source: src,
      tap: opts.tap,
      plate,
      dirHint,
      signal: c.signal,
      onProgress: setProgress,
    });
    if (c.signal.aborted) return;
    setProgress(null);
    if (res.ok) {
      setFresh(res.analysis);
      setMode("idle");
      if (!res.analysis.reps.length) {
        toast.message("No reps found. Try tapping the end of the bar.");
        return;
      }
      try {
        await saveAnalysis(setVideoId, res.analysis);
      } catch (e) {
        toast.error(e instanceof Error && e.message ? e.message : "Couldn't save the analysis.");
      }
      return;
    }
    if (res.why === "cancelled") return setMode("idle");
    if (res.why === "ambiguous" || res.why === "no_plate" || res.why === "no_plate_at_tap") {
      setSuggestions(res.suggestions ?? []);
      setMode("pick");
      if (res.why === "no_plate_at_tap")
        toast.message("No plate there. Tap the round end of the bar.");
      return;
    }
    setFailure(
      res.why === "too_short"
        ? "This clip is too short to read a rep from."
        : "This video couldn't be read on this device.",
    );
    setMode("failed");
  };

  // opened to analyse: start once the stored read is known to be missing (and no auto run is going)
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !startOnOpen || isLoading || saved || autoRun || !src) return;
    started.current = true;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startOnOpen, isLoading, saved, autoRun, src]);

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

  const busy = mode === "running" || !!autoRun;
  const shownProgress = progress ?? autoRun;

  return (
    <>
      <header
        className="flex shrink-0 items-center gap-1 px-2 pb-1.5"
        style={{ paddingTop: "max(env(safe-area-inset-top), 0.6rem)" }}
      >
        <button
          type="button"
          onClick={() => onOpenChange(false)}
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
        {!busy && (
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
              <DropdownMenuItem className="h-11 gap-2" onSelect={() => void run()}>
                <RotateCcw className="h-4 w-4" /> Read it again
              </DropdownMenuItem>
              <DropdownMenuItem
                className="h-11 gap-2"
                onSelect={() => {
                  setSuggestions([]);
                  setMode("pick");
                }}
              >
                <Crosshair className="h-4 w-4" /> Pick the bar myself
              </DropdownMenuItem>
              <DropdownMenuItem className="h-11 gap-2" onSelect={() => setPlateOpen(true)}>
                <Ruler className="h-4 w-4" /> Plate size
              </DropdownMenuItem>
              {(saved || fresh) && (
                <DropdownMenuItem
                  className="h-11 gap-2 text-destructive focus:text-destructive"
                  onSelect={() => void remove()}
                >
                  <Trash2 className="h-4 w-4" /> Remove analysis
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>

      <BarPathPlayer
        src={src}
        poster={poster}
        analysis={mode === "pick" ? null : analysis}
        selectedRep={selected}
        onSelectRep={setSelected}
        pick={
          mode === "pick"
            ? { suggestions, onPick: (t, fx, fy) => void run({ tap: { t, fx, fy } }) }
            : null
        }
        className="h-[min(50dvh,460px)] shrink-0"
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-2">
        {plateOpen && (
          <PlateSizeCard
            current={plateMm ?? analysis?.plate.mm ?? STANDARD_PLATE_MM}
            onCancel={() => setPlateOpen(false)}
            onApply={(mm) => {
              setPlateOpen(false);
              setPlateMm(mm);
              void run({ plate: mm });
            }}
          />
        )}
        {busy && shownProgress && (
          <div className="rounded-2xl border border-border p-4" data-lift-analysis-progress>
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{STAGE_WORDS[shownProgress.stage]}…</span>
              {mode === "running" && (
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    ctrl.current?.abort();
                    setMode("idle");
                    setProgress(null);
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-foreground transition-[width] duration-300"
                style={{
                  width: `${Math.round(100 * ((["opening", "finding", "tracking", "reading"].indexOf(shownProgress.stage) + shownProgress.progress) / 4))}%`,
                }}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Read on this device. Nothing is uploaded.
            </p>
          </div>
        )}
        {mode === "pick" && (
          <div className="rounded-2xl border border-border p-4" data-lift-analysis-pick>
            <p className="text-sm font-semibold">Tap the end of the bar</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {suggestions.length
                ? "The plate wasn't clear on its own. Tap the plate on the end of the bar (a ringed circle if it's the one)."
                : "Pause where the plate is easy to see, then tap the plate on the end of the bar."}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Works when the camera is side-on to the bar, with the plate in view.
            </p>
            <Button
              variant="ghost"
              className="mt-2 h-10 px-2 text-muted-foreground"
              onClick={() => setMode("idle")}
            >
              Cancel
            </Button>
          </div>
        )}
        {mode === "failed" && (
          <div className="rounded-2xl border border-border p-4">
            <p className="text-sm">{failure}</p>
            <Button variant="outline" className="mt-3 h-10" onClick={() => void run()}>
              Try again
            </Button>
          </div>
        )}
        {!busy && mode !== "pick" && !analysis && !isLoading && mode !== "failed" && (
          <div className="rounded-2xl border border-border p-4">
            <p className="text-sm text-muted-foreground">
              Reads the bar's path and speed from the video, on this device: film side-on with the
              end of the bar in view.
            </p>
            <Button
              className="mt-3 h-11"
              onClick={() => void run()}
              disabled={!src}
              data-lift-analysis-start
            >
              Analyze bar path
            </Button>
          </div>
        )}
        {analysis && mode !== "pick" && !busy && (
          <Results
            analysis={analysis}
            selected={selected}
            onSelect={setSelected}
            setVideoId={setVideoId}
            clientId={saved?.client_id ?? null}
            exerciseId={saved?.exercise_id ?? null}
          />
        )}
      </div>
    </>
  );
}

function PlateSizeCard({
  current,
  onCancel,
  onApply,
}: {
  current: number;
  onCancel: () => void;
  onApply: (mm: number) => void;
}) {
  const [value, setValue] = useState(String(Math.round(current)));
  const presets = [
    { mm: 450, label: "45 lb / 20 kg+ or bumper · 450 mm" },
    { mm: 400, label: "15 kg calibrated · 400 mm" },
    { mm: 325, label: "10 kg calibrated · 325 mm" },
  ];
  const n = Number(value);
  const ok = Number.isFinite(n) && n >= 150 && n <= 500;
  return (
    <div className="mb-3 rounded-2xl border border-border p-4" data-plate-size>
      <p className="text-sm font-semibold">The biggest plate on the bar</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Its size is the ruler every speed is measured with.
      </p>
      <div className="mt-3 flex flex-col gap-1.5">
        {presets.map((p) => (
          <button
            key={p.mm}
            type="button"
            onClick={() => setValue(String(p.mm))}
            className={cn(
              "h-11 rounded-lg border px-3 text-left text-sm",
              Number(value) === p.mm ? "border-foreground" : "border-border",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Other</span>
        <input
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-10 w-24 rounded-lg border border-border bg-transparent px-2 text-base"
        />
        <span className="text-muted-foreground">mm across</span>
      </label>
      <div className="mt-3 flex gap-2">
        <Button className="h-10" disabled={!ok} onClick={() => onApply(n)}>
          Use and read again
        </Button>
        <Button variant="ghost" className="h-10" onClick={onCancel}>
          Cancel
        </Button>
      </div>
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
}: {
  analysis: LiftAnalysis;
  selected: number | null;
  onSelect: (i: number | null) => void;
  setVideoId: string;
  clientId: string | null;
  exerciseId: string | null;
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

  if (!a.reps.length) {
    return (
      <div className="rounded-2xl border border-border p-4">
        <p className="text-sm font-semibold">No reps found</p>
        <p className="mt-1 text-sm text-muted-foreground">{noteWords("no_reps").tip}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-lift-analysis-results>
      {/* the set at a glance */}
      <section>
        {calibrated && headline.tier !== "unavailable" ? (
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
        {rep && <RepDetail analysis={a} index={repIdx} />}
      </section>

      <Consistency analysis={a} />

      {clientId && exerciseId && calibrated && (
        <Compare setVideoId={setVideoId} clientId={clientId} exerciseId={exerciseId} />
      )}

      {notes.length > 0 && (
        <section className="space-y-2" data-quality-notes>
          {notes.map((n) => (
            <div key={n} className="rounded-xl bg-muted/50 p-3">
              <div className="text-sm font-medium">{noteWords(n).title}</div>
              <div className="mt-0.5 text-xs leading-snug text-muted-foreground">
                {noteWords(n).tip}
              </div>
            </div>
          ))}
        </section>
      )}

      <HowMeasured analysis={a} />
    </div>
  );
}

function RepDetail({ analysis: a, index }: { analysis: LiftAnalysis; index: number }) {
  const r = a.reps[index];
  const calibrated = a.units === "mm";
  const lowerFirst = r.dir === "lower_first";
  const stick = r.sticking;
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
        <Stat label="Up (concentric)" value={seconds(r.conDur)} testId="con" />
        <Stat
          label={lowerFirst ? "Down (eccentric)" : "Lowering"}
          value={seconds(r.eccDur)}
          testId="ecc"
        />
        {lowerFirst && r.pause.v != null && r.pause.tier !== "unavailable" && (
          <Stat
            label="Pause at the bottom"
            value={r.pause.v < 0.08 ? "None" : seconds(r.pause)}
            testId="pause"
          />
        )}
        <Stat label="Range of motion" value={cm(r.rom)} testId="rep-rom" />
        <Stat
          label="Bar drift (up)"
          value={withinNoise(r.xDev) ? "None" : cm(r.xDev)}
          sub={r.xDev.tier !== "unavailable" ? "most the bar moved sideways" : undefined}
          testId="drift"
        />
        <Stat
          label="Sticking point"
          value={stick ? `${Math.round(stick.at * 100)}% up` : "None"}
          sub={
            stick
              ? `${stick.height.tier !== "unavailable" ? `${cm(stick.height)} off the bottom · ` : ""}${Math.round(stick.dip * 100)}% slower`
              : r.peak.tier === "unavailable" && r.peak.why === "plate_hidden"
                ? "plate hidden"
                : "speed built without a dip"
          }
          testId="sticking"
        />
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
}: {
  setVideoId: string;
  clientId: string;
  exerciseId: string;
}) {
  const { data: points } = useLoadVelocityPoints(clientId, exerciseId);
  const { unit } = useClientWeightUnit(clientId);
  const today = points?.find((p) => p.id === setVideoId) ?? null;
  const others = useMemo(
    () => (points ?? []).filter((p) => p.id !== setVideoId),
    [points, setVideoId],
  );
  const profile = useMemo(() => fitProfile(others), [others]);
  if (!points || points.length < 2 || !today) return null;
  const fmtLoad = (kg: number) =>
    unit === "lb" ? `${Math.round(kg * 2.20462)} lb` : `${Math.round(kg * 2) / 2} kg`;
  const cmp = profile ? compareToProfile(profile, today.kg, today.v, today.u ?? 0) : null;
  // the closest earlier set at the same weight (±2.5 %), when there's no line yet
  const same = others
    .filter((p) => Math.abs(p.kg / today.kg - 1) <= 0.025)
    .sort((x, y) => (x.at < y.at ? 1 : -1))[0];
  let line: string;
  if (cmp) {
    const pct = Math.round(Math.abs(cmp.diff) * 100);
    line =
      cmp.call === "usual"
        ? `At ${fmtLoad(today.kg)} the bar moved about as usual for you (${cmp.expected.toFixed(2)} m/s expected).`
        : `At ${fmtLoad(today.kg)} the bar moved ${pct}% ${cmp.call} than usual for you (${cmp.expected.toFixed(2)} m/s expected).`;
  } else if (same) {
    const d = today.v / same.v - 1;
    line = `Last time at ${fmtLoad(same.kg)}: ${same.v.toFixed(2)} m/s (${new Date(same.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}). Today ${Math.abs(d) < 0.06 ? "about the same" : `${Math.round(Math.abs(d) * 100)}% ${d > 0 ? "faster" : "slower"}`}.`;
  } else {
    line = `${others.length} other ${others.length === 1 ? "set" : "sets"} analysed. A line of your speed by load shows once there are 3 at weights 15% or more apart.`;
  }
  return (
    <section className="rounded-2xl border border-border p-3" data-load-velocity>
      <h3 className="text-[15px] font-semibold">Compared with your other sets</h3>
      <p className="mt-1 text-sm">{line}</p>
      <LoadVelocityChart points={points} profile={profile} todayId={setVideoId} unit={unit} />
      <p className="text-[11px] text-muted-foreground">
        Fastest rep of each analysed set by load. Today ringed and filled.
      </p>
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
