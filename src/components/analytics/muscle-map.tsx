/**
 * The muscle training map (muscle-read.ts): which muscles got the most
 * training, on a 3D body built from the app's own anatomical drawing
 * (body3d/), turned with a finger, pinched or scrolled to zoom, a tap on a
 * muscle for its sets. Three readings: Most trained (five levels, relative
 * to the most-trained muscle: training, never size, strength or growth),
 * Your goal and Progress. A 2D front-and-back drawing stands in where WebGL2
 * isn't there, and the List is the same data as bars. How a supporting
 * muscle counts (half a set by default) is a small settings menu, remembered
 * on the device.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, RotateCcw, SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FineMuscle, LoadSet } from "@/lib/analytics/training-load";
import {
  compareMuscleWindows,
  DEFAULT_SUPPORT_CREDIT,
  MUSCLE_LEVELS,
  SUPPORT_CREDITS,
  fmtSets,
  isSupportCredit,
  periodChangeWords,
  type DevStatus,
  type FitStatus,
  type MuscleLevel,
  type MuscleRead,
  type MuscleReadRow,
  type SupportCredit,
} from "@/lib/analytics/muscle-read";
import { atlasView, type ViewKey } from "@/lib/pain/anatomy/atlas";
import { muscleOfSite } from "@/lib/body3d/muscle-sites";
import { BODY_THEME, MARK_COLORS, muscleAt, paintView, partShowsMark, type BodyMark } from "@/lib/body3d/paint";
import { Segmented } from "@/components/analytics/viz";
import { InfoTip } from "@/components/analytics/info-tip";
import { claimGesture, heldByOther, isBackEdge, onGestureReset, releaseGesture } from "@/lib/gesture-arena";
import { useIsMobile } from "@/hooks/use-mobile";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";

export type MuscleMode = "distribution" | "fit" | "development" | "change";
export const MUSCLE_MODES: Array<{ key: MuscleMode; label: string }> = [
  { key: "distribution", label: "Volume" },
  { key: "fit", label: "Goals" },
  { key: "development", label: "Progress" },
];

// The body is a 3D asset: its colours are concrete (light and dark), never
// resolved from CSS at draw time. Levels 1–4 are one blue, lighter to darker
// in light mode and darker to lighter in dark, so "more" always stands out.
const PALETTE = {
  light: {
    levels: ["#b7cdee", "#7da6e2", "#3f7cd0", "#1c4c9f"],
    supported: "#1baf7a",
    look: "#e3a034",
    gap: "#c25f22",
    more: "#3f7cd0",
    steady: "#8b93a1",
  },
  dark: {
    levels: ["#3d5679", "#406fae", "#5b92e3", "#a5c8fb"],
    supported: "#199e70",
    look: "#d9962e",
    gap: "#c96a2c",
    more: "#5b92e3",
    steady: "#6b7280",
  },
} as const;

const FIT_WORD: Record<FitStatus, string> = {
  supported: "On track for target or reference",
  look: "Lighter than your other main muscles",
  gap: "Below training target or reference",
  more: "Above training target or reference",
  unknown: "Not enough training to tell yet",
};
const FIT_SHORT: Record<FitStatus, string> = {
  supported: "On track",
  look: "Lighter",
  gap: "Below target",
  more: "Above target",
  unknown: "Too early",
};
const DEV_WORD: Record<DevStatus, string> = {
  strength: "Its lifts are improving",
  opportunity: "Worth a look",
  steady: "No clear signal",
  unknown: "Not enough training to tell yet",
};
const DEV_SHORT: Record<DevStatus, string> = {
  strength: "Improving",
  opportunity: "Worth a look",
  steady: "No signal",
  unknown: "Too early",
};
const ROLE_WORD = {
  prime: "A main muscle for your goal",
  support: "A supporting muscle for your goal",
  optional: "Optional for your goal",
} as const;

/** What each reading means, said once under its legend. */
export function modeMeans(mode: MuscleMode, reference: number): string {
  if (mode === "change") return "Credited working sets compared with an equal-length historical period. No earlier logs means no comparison, not zero.";
  if (mode === "distribution")
    return "Colours compare your muscles with each other by the sets they got. They show training, not muscle size, strength or growth.";
  if (mode === "fit")
    return `Each muscle against its elapsed planned sets when available, otherwise your own training reference${reference > 0 ? ` (about ${fmtSets(reference)} sets a week)` : ""}. Fewer sets never means a muscle is weak.`;
  return "Shown only when two things agree: how the lifts that use a muscle are going and how much work it gets. Logs can't measure muscle growth.";
}

const CREDIT_KEY = "jf-muscle-support-credit";
/** How a supporting muscle counts, remembered on this device (half a set until changed). */
export function useSupportCredit(): [SupportCredit, (c: SupportCredit) => void] {
  const [credit, setCredit] = useState<SupportCredit>(DEFAULT_SUPPORT_CREDIT);
  useEffect(() => {
    try {
      const v = Number(window.localStorage.getItem(CREDIT_KEY));
      if (window.localStorage.getItem(CREDIT_KEY) != null && isSupportCredit(v)) setCredit(v);
    } catch {
      /* private mode: the default */
    }
  }, []);
  const set = useCallback((c: SupportCredit) => {
    setCredit(c);
    try {
      if (c === DEFAULT_SUPPORT_CREDIT) window.localStorage.removeItem(CREDIT_KEY);
      else window.localStorage.setItem(CREDIT_KEY, String(c));
    } catch {
      /* not remembered */
    }
  }, []);
  return [credit, set];
}

export function useDark() {
  const [dark, setDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );
  useEffect(() => {
    const el = document.documentElement;
    const mo = new MutationObserver(() => setDark(el.classList.contains("dark")));
    mo.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);
  return dark;
}

export function levelColor(level: MuscleLevel, dark: boolean): string | null {
  return level > 0 ? PALETTE[dark ? "dark" : "light"].levels[level - 1] : null;
}

export function muscleColor(
  row: MuscleReadRow | undefined,
  mode: MuscleMode,
  dark: boolean,
): string | null {
  if (!row) return null;
  const p = PALETTE[dark ? "dark" : "light"];
  if (mode === "distribution") return levelColor(row.level, dark);
  if (mode === "change") {
    if (!row.period.before) return null;
    const delta = row.period.total - row.period.before.total;
    if (Math.abs(delta) < 0.5) return p.steady;
    const magnitude=Math.abs(delta);
    return delta>0?(magnitude>=10?"#36a6cf":"#46798e"):(magnitude>=10?"#bf665d":"#895d58");
  }
  if (mode === "fit") {
    const s = row.fit.status;
    return s === "unknown"
      ? null
      : s === "supported"
        ? row.perWeek > 0
          ? p.supported
          : null
        : p[s];
  }
  const s = row.dev.status;
  return s === "strength"
    ? p.supported
    : s === "opportunity"
      ? p.look
      : s === "steady"
        ? p.steady
        : null;
}

export function MuscleMap({
  read: baseRead,
  coached,
  history = [],
  start,
  end,
  periods = [],
  credit = DEFAULT_SUPPORT_CREDIT,
  onCredit,
  onExercise,
}: {
  read: MuscleRead;
  history?: LoadSet[];
  start?: string;
  end?: string;
  periods?: Array<{id:string;name:string;start:string;end:string}>;
  coached: boolean;
  credit?: SupportCredit;
  onCredit?: (c: SupportCredit) => void;
  onExercise?: (name: string) => void;
}) {
  const dark = useDark();
  const phone = useIsMobile();
  const [mode, setMode] = useState<MuscleMode>("distribution");
  const [display, setDisplay] = useState<"body" | "list">("body");
  const [comparePeriod,setComparePeriod]=useState("previous");
  const [customStart,setCustomStart]=useState("");
  const [customEnd,setCustomEnd]=useState("");
  const chosen=periods.find(p=>p.id===comparePeriod);
  const comparison=comparePeriod==="custom"?{start:customStart,end:customEnd}:chosen;
  const read=useMemo(()=>mode==="change"&&comparison&&start&&end&&comparison.start&&comparison.end&&comparison.end>=comparison.start&&comparison.end<start?compareMuscleWindows(baseRead,history,{start,end},comparison,credit):baseRead,[mode,comparePeriod,customStart,customEnd,chosen,baseRead,history,start,end,credit]);
  const rows = useMemo(() => new Map(read.rows.map((r) => [r.muscle, r])), [read]);
  const [picked, setPicked] = useState<FineMuscle | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const ranked = useMemo(() => [...baseRead.rows].filter(r=>r.period.total>0).sort((a,b)=>b.period.total-a.period.total), [baseRead]);
  const progressCount = baseRead.rows.filter(r=>r.dev.status!=="unknown").length;
  const hasComparison = read.rows.some(r=>r.period.before!=null);
  const colorOf = useCallback(
    (m: FineMuscle) => muscleColor(rows.get(m), mode, dark),
    [rows, mode, dark],
  );
  const pickedRow = picked ? rows.get(picked) : undefined;
  // a phone opens a tapped muscle in a sheet; a computer shows it beside the body
  const pickFromBody = (m: FineMuscle | null) => {
    setPicked(m);
    if (phone && m) setSheetOpen(true);
  };

  return (
    <div data-muscle-map data-muscle-mode={mode}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <label className="text-xs text-muted-foreground" htmlFor="muscle-heatmap-reading">Heatmap</label>
          <select id="muscle-heatmap-reading" aria-label="Muscle heatmap metric" value={mode}
            onChange={e=>setMode(e.target.value as MuscleMode)}
            className="min-h-10 min-w-0 rounded-lg border border-border bg-background px-2.5 text-sm font-medium text-foreground"
            data-muscle-metric-select>
            {MUSCLE_MODES.map(m=><option key={m.key} value={m.key}>{m.label==="Goals"?"Plan vs actual":m.label==="Progress"?"Exercise progress":m.label}</option>)}
            <option value="change">Compare periods</option>
          </select>
          <InfoTip label="About muscle colours">{modeMeans(mode, read.reference)}</InfoTip>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" aria-pressed={display==="list"} onClick={()=>setDisplay(d=>d==="body"?"list":"body")} className="min-h-10 rounded-lg px-2 text-xs font-medium text-muted-foreground hover:text-foreground">{display==="body"?"List view":"Body view"}</button>
          {onCredit && <MapSettings credit={credit} onCredit={onCredit} phone={phone}/>}
        </div>
      </div>
      {mode==="change"&&<div className="my-2 space-y-2"><select aria-label="Compare muscle training period" className="min-h-10 w-full rounded-lg border bg-background px-2 text-xs" value={comparePeriod} onChange={e=>setComparePeriod(e.target.value)}><option value="previous">Previous equal period</option>{periods.filter(p=>start&&p.end<start).map(p=><option key={p.id} value={p.id}>{p.name} · {p.start} – {p.end}</option>)}<option value="custom">Custom dates</option></select>{comparePeriod==="custom"&&<div className="grid grid-cols-2 gap-2"><label className="text-xs">From<input className="block min-h-10 w-full rounded-lg border bg-background text-xs" type="date" value={customStart} onChange={e=>setCustomStart(e.target.value)}/></label><label className="text-xs">To<input className="block min-h-10 w-full rounded-lg border bg-background text-xs" type="date" max={start} value={customEnd} onChange={e=>setCustomEnd(e.target.value)}/></label></div>}{comparison&&start&&(!comparison.start||!comparison.end||comparison.end<comparison.start||comparison.end>=start)?<p className="text-xs text-muted-foreground">Choose a valid earlier period; showing previous equal period until then.</p>:<p className="text-xs text-muted-foreground">Comparing equal elapsed days.</p>}</div>}
      <ModeLegend mode={mode} dark={dark} />
      {mode==="development"&&progressCount===0&&<p className="mt-2 text-xs text-muted-foreground">No reliable exercise trend for this period. Select a muscle to see its recorded sets and exercises, or widen the date range.</p>}
      {mode==="change"&&!hasComparison&&<p className="mt-2 text-xs text-muted-foreground">No comparable training logs in the selected periods.</p>}
      {credit !== DEFAULT_SUPPORT_CREDIT && onCredit && (
        <p className="mt-1 text-[12px] text-muted-foreground" data-muscle-credit-note>
          Supporting muscles count as{" "}
          {credit === 1 ? "a full set" : "nothing"} here.{" "}
          <button
            type="button"
            onClick={() => onCredit(DEFAULT_SUPPORT_CREDIT)}
            className="font-medium text-foreground underline underline-offset-2"
          >
            Back to half a set
          </button>
        </p>
      )}
      {display === "body" ? (
        <div className="mt-3 grid gap-4 md:grid-cols-[minmax(180px,0.85fr)_minmax(0,1.15fr)] md:items-center" data-muscle-workspace>
          <BodyView colorOf={colorOf} picked={picked} onPick={pickFromBody} dark={dark}
            heightClass="h-[320px] sm:h-[360px] md:h-[360px]" compactControls />
          <div className="min-w-0 md:self-start">
            {!phone && pickedRow ? (
              <MuscleDetail row={pickedRow} mode={mode} coached={coached} credit={credit} enough={read.enoughData}
                onExercise={onExercise} onClear={()=>setPicked(null)} />
            ) : (
              <MuscleOverview ranked={ranked} rows={baseRead.rows} onPick={pickFromBody} />
            )}
          </div>
        </div>
      ) : (
        <MuscleList read={read} mode={mode} dark={dark} picked={picked} onPick={setPicked}
          coached={coached} credit={credit} onExercise={onExercise} />
      )}
      {phone && display === "body" && (
        <Sheet open={sheetOpen && !!pickedRow} onOpenChange={setSheetOpen}>
          <SheetContent
            side="bottom"
            swipeToClose
            hideCloseButton
            className="max-h-[82dvh] gap-0 overflow-y-auto rounded-t-[22px] p-0 pb-[max(env(safe-area-inset-bottom),1rem)]"
            data-muscle-sheet
          >
            <span
              aria-hidden
              className="mx-auto mt-2.5 block h-1 w-10 rounded-full bg-muted-foreground/30"
            />
            {pickedRow && (
              <>
                <SheetTitle className="sr-only">{pickedRow.muscle}</SheetTitle>
                <SheetDescription className="sr-only">
                  The sets behind {pickedRow.muscle.toLowerCase()} this period.
                </SheetDescription>
                <MuscleDetail
                  row={pickedRow}
                  mode={mode}
                  coached={coached}
                  credit={credit}
                  enough={read.enoughData}
                  onExercise={onExercise}
                  onClear={() => setSheetOpen(false)}
                  bare
                />
              </>
            )}
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}

/** Useful at first paint, without requiring an athlete to discover a muscle by trial and error. */
function MuscleOverview({ranked,rows,onPick}:{ranked:MuscleReadRow[];rows:MuscleReadRow[];onPick:(m:FineMuscle)=>void}) {
  const low=rows.filter(r=>r.role==="prime"&&r.period.total>0).sort((a,b)=>a.period.total-b.period.total)[0];
  const zero=rows.filter(r=>r.role==="prime"&&r.period.total===0);
  const max=ranked[0]?.period.total??1;
  return <div className="space-y-3" data-muscle-overview>
    <div className="flex items-center justify-between gap-2">
      <div><div className="text-sm font-semibold">Training distribution</div><div className="text-xs text-muted-foreground">Select a muscle for details</div></div>
      <div className="text-right"><div className="text-lg font-semibold tabular-nums">{ranked.length}<span className="text-xs text-muted-foreground">/{rows.length}</span></div><div className="text-[11px] text-muted-foreground">Muscles trained</div></div>
    </div>
    {ranked.length ? <div className="space-y-1">
      {ranked.slice(0,3).map(r=><button type="button" onClick={()=>onPick(r.muscle)} key={r.muscle} className="block min-h-11 w-full rounded-lg px-2 py-1 text-left hover:bg-muted/40 focus-visible:outline focus-visible:outline-2">
        <span className="flex items-center justify-between gap-2 text-xs"><span className="font-medium">{r.muscle}</span><span className="tabular-nums text-muted-foreground">{fmtSets(r.period.total)} sets ›</span></span>
        <span className="mt-1.5 block h-1.5 rounded-full bg-muted"><span className="block h-full rounded-full bg-blue-400/80" style={{width:100*r.period.total/max+"%"}} /></span>
      </button>)}
      {low&&ranked.slice(0,3).every(r=>r.muscle!==low.muscle)&&<button type="button" onClick={()=>onPick(low.muscle)} className="flex min-h-10 w-full items-center justify-between gap-2 border-t border-border text-xs"><span className="text-muted-foreground">Least trained priority · {low.muscle}</span><span className="font-medium tabular-nums">{fmtSets(low.period.total)} sets ›</span></button>}
      {zero.length>0&&<button type="button" onClick={()=>onPick(zero[0].muscle)} className="flex min-h-10 w-full items-center justify-between gap-2 border-t border-border text-xs"><span className="text-muted-foreground">No logged work · {zero[0].muscle}{zero.length>1?" +"+(zero.length-1)+" more":""}</span><span>›</span></button>}
    </div>:<p className="text-xs text-muted-foreground">No working sets logged in this period.</p>}
    <div className="flex flex-wrap gap-1.5">{rows.map(r=><button type="button" key={r.muscle} onClick={()=>onPick(r.muscle)} className="min-h-8 rounded-md px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2">{r.muscle}</button>)}</div>
  </div>;
}

/** The supporting-muscle setting: a small popover on a computer, a bottom sheet on a phone. */
function MapSettings({
  credit,
  onCredit,
  phone,
}: {
  credit: SupportCredit;
  onCredit: (c: SupportCredit) => void;
  phone: boolean;
}) {
  const [open, setOpen] = useState(false);
  const trigger = (
    <button
      type="button"
      aria-label="Map settings: how supporting muscles are counted"
      className="relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted/60 hover:text-foreground"
      data-muscle-settings
      onClick={phone ? () => setOpen(true) : undefined}
    >
      <SlidersHorizontal className="h-4 w-4" />
      {credit !== DEFAULT_SUPPORT_CREDIT && (
        <span aria-hidden className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-foreground" />
      )}
    </button>
  );
  const body = (
    <CreditChoices
      credit={credit}
      onPick={(c) => {
        onCredit(c);
        setOpen(false);
      }}
    />
  );
  if (phone)
    return (
      <>
        {trigger}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent
            side="bottom"
            swipeToClose
            hideCloseButton
            className="gap-0 rounded-t-[22px] px-5 pb-[max(env(safe-area-inset-bottom),1rem)] pt-0"
            data-muscle-settings-sheet
          >
            <span
              aria-hidden
              className="mx-auto mt-2.5 block h-1 w-10 rounded-full bg-muted-foreground/30"
            />
            <SheetTitle className="mt-4 text-[17px] font-semibold">
              How supporting muscles are counted
            </SheetTitle>
            <SheetDescription className="sr-only">
              Choose how a set counts for a muscle the exercise only helps.
            </SheetDescription>
            {body}
          </SheetContent>
        </Sheet>
      </>
    );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" className="w-80 rounded-xl p-4" data-muscle-settings-popover>
        <div className="text-[14px] font-semibold text-foreground">
          How supporting muscles are counted
        </div>
        {body}
      </PopoverContent>
    </Popover>
  );
}

function CreditChoices({
  credit,
  onPick,
}: {
  credit: SupportCredit;
  onPick: (c: SupportCredit) => void;
}) {
  return (
    <div>
      <p className="mt-2 text-[14px] leading-relaxed text-foreground/85">
        Exercises often train more than one muscle. For example, bench press mainly trains your
        chest but also works your triceps. We count supporting muscles as half a set by default.
      </p>
      <div className="mt-3 space-y-1" role="radiogroup" aria-label="Count a supporting muscle as">
        {SUPPORT_CREDITS.map((c) => (
          <button
            key={c.value}
            type="button"
            role="radio"
            aria-checked={credit === c.value}
            onClick={() => onPick(c.value)}
            className={cn(
              "flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 text-left text-[14px] transition",
              credit === c.value ? "bg-secondary font-semibold text-foreground" : "hover:bg-muted/60",
            )}
            data-credit={c.value}
          >
            <span>
              {c.label}
              {c.value === DEFAULT_SUPPORT_CREDIT && (
                <span className="ml-1.5 font-normal text-muted-foreground">(default)</span>
              )}
            </span>
            {credit === c.value && <Check className="h-4 w-4" />}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[12px] text-muted-foreground">
        Changes the map, the list and the muscle numbers on this page. Saved on this device.
      </p>
    </div>
  );
}

function ModeLegend({ mode, dark }: { mode: MuscleMode; dark: boolean }) {
  const p = PALETTE[dark ? "dark" : "light"];
  const skin = BODY_THEME[dark ? "dark" : "light"].skin;
  const sw = (c: string, label: string, outline = false) => (
    <span key={label} className="inline-flex items-center gap-1.5">
      <span
        className={cn("h-3 w-3 shrink-0 rounded-[3px]", outline && "border border-border")}
        style={{ background: c }}
      />
      {label}
    </span>
  );
  return (
    <div
      className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-muted-foreground"
      data-muscle-legend
    >
      {mode === "change"
        ? [sw("#bf665d", "Fewer sets"), sw(p.steady, "Similar"), sw("#36a6cf", "More sets"), sw(skin, "No data", true)]
        : mode === "distribution"
        ? MUSCLE_LEVELS.map((l) => sw(levelColor(l.level, dark) ?? skin, l.label, l.level === 0))
        : mode === "fit"
          ? [
              sw(p.supported, "On track"),
              sw(p.look, "Lighter"),
              sw(p.gap, "Almost no work"),
              sw(p.more, "Much more"),
              sw(skin, "Too early to tell", true),
            ]
          : [
              sw(p.supported, "Lifts improving"),
              sw(p.look, "Worth a look"),
              sw(p.steady, "No clear signal"),
              sw(skin, "Too early to tell", true),
            ]}
    </div>
  );
}

// ── the body ───────────────────────────────────────────────────────────

type ViewSnap = "front" | "side" | "back";
/** Where the camera goes for each area (the drawing's y mapped into the 3D world, y up). */
export type BodyFocus = "full" | "head" | "hands" | "feet";
const FOCUS_CAM: Record<BodyFocus, { zoom: number; panY: number; pitch: number }> = {
  full: { zoom: 1, panY: 0, pitch: 0.04 },
  head: { zoom: 3, panY: 0.83, pitch: 0.02 },
  hands: { zoom: 2.2, panY: -0.15, pitch: 0.04 },
  feet: { zoom: 2.9, panY: -0.9, pitch: 0.12 },
};
const FOCUS_LABEL: Record<BodyFocus, string> = { full: "Body", head: "Head", hands: "Hands", feet: "Feet" };
const SNAP_YAW: Record<ViewSnap, number> = { front: 0.22, side: Math.PI / 2, back: Math.PI };
/** Past this zoom a vertical drag moves the body instead of scrolling the page. */
const PAN_ZOOM = 1.15;

/**
 * The 3D body (2D where WebGL2 isn't there), coloured by `colorOf`. Shared by
 * the muscle training map and the Workouts page's recovery (`preview`: a
 * small still body on the dashboard, no controls and no gestures, its tap the
 * caller's; the full-screen recovery page uses the interactive one).
 */
export function BodyView({
  colorOf,
  picked,
  onPick,
  dark,
  onList,
  preview = false,
  heightClass,
  ariaLabel = "Body coloured by the selected mode. Drag to turn, pinch to zoom, tap a muscle for details.",
  marks,
  focusAreas = false,
  compactControls = false,
}: {
  colorOf: (m: FineMuscle) => string | null;
  picked: FineMuscle | null;
  onPick: (m: FineMuscle | null) => void;
  dark: boolean;
  /** Reported symptoms drawn over the colours (paint.ts: a hatch and an edge on the spot). */
  marks?: BodyMark[];
  /** Body · Head · Hands · Feet: the camera goes there in one tap (the full-screen views). */
  focusAreas?: boolean;
  compactControls?: boolean;
  /** the List button (the muscle map's table view); none when not given */
  onList?: () => void;
  preview?: boolean;
  heightClass?: string;
  ariaLabel?: string;
}) {
  const [mode3d, setMode3d] = useState<"loading" | "3d" | "2d">("loading");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const rendRef = useRef<import("@/lib/body3d/renderer").BodyRenderer | null>(null);
  const animRef = useRef<number | null>(null);
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [snap, setSnap] = useState<ViewSnap>("front");
  // zoomed in, a drag up or down moves the body (it owns both directions); at full size up and
  // down scroll the page and only sideways turns it (gesture arena)
  const [zoomed, setZoomed] = useState(false);
  const syncZoomed = useCallback(() => {
    const r = rendRef.current;
    setZoomed(!!r && r.cam.zoom > PAN_ZOOM);
  }, []);
  const arenaId = `body3d:${useId()}`;

  // build after the page paints: the mesh takes ~200 ms once, then it's cached
  useEffect(() => {
    let cancelled = false;
    const start = () => {
      void (async () => {
        try {
          const [{ bodyMesh }, { BodyRenderer, webgl2Available }] = await Promise.all([
            import("@/lib/body3d/body-mesh"),
            import("@/lib/body3d/renderer"),
          ]);
          if (cancelled) return;
          if (!webgl2Available()) return setMode3d("2d");
          const mesh = bodyMesh();
          if (cancelled || !canvasRef.current) return;
          const r = new BodyRenderer(canvasRef.current, mesh);
          r.cam = { yaw: reduced || preview ? SNAP_YAW.front : -0.7, pitch: 0.04, zoom: 1, panY: 0 };
          rendRef.current = r;
          setMode3d("3d");
        } catch {
          setMode3d("2d");
        }
      })();
    };
    const w = window as any;
    const h = w.requestIdleCallback
      ? w.requestIdleCallback(start, { timeout: 600 })
      : window.setTimeout(start, 60);
    return () => {
      cancelled = true;
      if (w.cancelIdleCallback) w.cancelIdleCallback(h);
      else window.clearTimeout(h);
      rendRef.current?.dispose();
      rendRef.current = null;
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const draw = useCallback(() => {
    const r = rendRef.current;
    const c = canvasRef.current;
    const box = boxRef.current;
    if (!r || !c || !box) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(box.clientWidth * dpr);
    const h = Math.round(box.clientHeight * dpr);
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    r.render();
  }, []);

  // repaint the skin whenever the colours, the pick or the theme change
  useEffect(() => {
    const r = rendRef.current;
    if (mode3d !== "3d" || !r) return;
    const th = BODY_THEME[dark ? "dark" : "light"];
    const views = (["front", "back", "side"] as ViewKey[]).map((k) =>
      paintView(k, colorOf, th, picked, undefined, marks ?? [], dark),
    );
    r.setTheme(dark);
    r.setTextures(views as [HTMLCanvasElement, HTMLCanvasElement, HTMLCanvasElement]);
    draw();
  }, [mode3d, colorOf, picked, dark, draw, marks]);

  // a first, gentle turn into the three-quarter view (none with reduced motion)
  const animateTo = useCallback(
    (target: Partial<{ yaw: number; zoom: number; panY: number; pitch: number }>, ms = 650) => {
      const r = rendRef.current;
      if (!r) return;
      if (animRef.current) cancelAnimationFrame(animRef.current);
      const from = { ...r.cam };
      // the short way round
      let ty = target.yaw ?? from.yaw;
      while (ty - from.yaw > Math.PI) ty -= 2 * Math.PI;
      while (from.yaw - ty > Math.PI) ty += 2 * Math.PI;
      const to = { ...from, ...target, yaw: ty };
      if (reduced) {
        r.cam = to;
        draw();
        syncZoomed();
        return;
      }
      const t0 = performance.now();
      const step = (t: number) => {
        const k = Math.min(1, (t - t0) / ms);
        const e = 1 - Math.pow(1 - k, 3);
        r.cam = {
          yaw: from.yaw + (to.yaw - from.yaw) * e,
          pitch: from.pitch + (to.pitch - from.pitch) * e,
          zoom: from.zoom + (to.zoom - from.zoom) * e,
          panY: from.panY + (to.panY - from.panY) * e,
        };
        draw();
        if (k < 1) animRef.current = requestAnimationFrame(step);
        else syncZoomed();
      };
      animRef.current = requestAnimationFrame(step);
    },
    [draw, reduced, syncZoomed],
  );
  useEffect(() => {
    if (mode3d === "3d" && !preview) animateTo({ yaw: SNAP_YAW.front }, 1100);
  }, [mode3d, animateTo, preview]);
  useEffect(() => {
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(box);
    return () => ro.disconnect();
  }, [draw, mode3d]);

  // gestures: drag turns, pinch / wheel zooms, a still tap picks a muscle. The body holds the
  // finger in the gesture arena while it turns, so swipe-back and the other screen gestures stand
  // down; a touch that starts on the back edge (where the edge is the app's) is the back swipe's.
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{
    x: number;
    y: number;
    t: number;
    moved: boolean;
    dist: number | null;
    zoom: number;
  } | null>(null);
  // the gesture is over without a pick: a cancel, lost capture, someone else took the finger, the app hidden
  const endGesture = useCallback(() => {
    ptrs.current.clear();
    gesture.current = null;
    releaseGesture(arenaId);
    syncZoomed();
  }, [arenaId, syncZoomed]);
  useEffect(() => {
    const stop = onGestureReset(endGesture);
    return () => {
      stop();
      releaseGesture(arenaId);
    };
  }, [endGesture, arenaId]);
  const onDown = (e: React.PointerEvent) => {
    const r = rendRef.current;
    if (!r) return;
    if (e.pointerType !== "mouse" && isBackEdge(e.clientX)) return;
    if (!claimGesture(arenaId)) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (animRef.current) cancelAnimationFrame(animRef.current);
    const pts = [...ptrs.current.values()];
    gesture.current = {
      x: e.clientX,
      y: e.clientY,
      t: performance.now(),
      moved: pts.length > 1,
      dist: pts.length === 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : null,
      zoom: r.cam.zoom,
    };
  };
  const onMove = (e: React.PointerEvent) => {
    const r = rendRef.current;
    const g = gesture.current;
    if (!r || !g || !ptrs.current.has(e.pointerId)) return;
    // the back swipe (or another screen gesture) has the finger: stop turning
    if (heldByOther(arenaId)) return endGesture();
    const prev = ptrs.current.get(e.pointerId)!;
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...ptrs.current.values()];
    if (pts.length === 2 && g.dist) {
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      r.cam.zoom = Math.max(1, Math.min(3.2, (g.zoom * d) / g.dist));
      g.moved = true;
      draw();
      return;
    }
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > 6) g.moved = true;
    if (!g.moved) return;
    r.cam.yaw += dx * 0.012;
    if (r.cam.zoom > PAN_ZOOM)
      r.cam.panY = Math.max(-0.95, Math.min(0.95, r.cam.panY - dy * (0.004 / r.cam.zoom)));
    else r.cam.pitch = Math.max(-0.35, Math.min(0.35, r.cam.pitch + dy * 0.006));
    draw();
  };
  const onUp = (e: React.PointerEvent) => {
    const r = rendRef.current;
    const g = gesture.current;
    ptrs.current.delete(e.pointerId);
    if (!r || !g || ptrs.current.size) return;
    gesture.current = null;
    releaseGesture(arenaId);
    syncZoomed();
    if (!g.moved && performance.now() - g.t < 400) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const hit = r.pick(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
      if (!hit) return onPick(null);
      const { front, back } = hit.weights;
      const view: ViewKey =
        front >= back && front >= hit.weights.side
          ? "front"
          : back >= hit.weights.side
            ? "back"
            : "side";
      const [x, y, z] = hit.p;
      const m =
        view === "front"
          ? muscleAt("front", x, y)
          : view === "back"
            ? muscleAt("back", 400 - x, y)
            : muscleAt("side", z + 205, y);
      onPick(m);
    }
  };
  // a cancelled finger (the page started scrolling, the phone took the touch) never picks a muscle
  const onCancel = (e: React.PointerEvent) => {
    ptrs.current.delete(e.pointerId);
    if (!ptrs.current.size) endGesture();
  };
  // a trackpad pinch (ctrl + wheel) or ⌘ / shift + wheel zooms; a plain wheel scrolls the page
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const onWheel = (e: WheelEvent) => {
      const r = rendRef.current;
      if (!r || !(e.ctrlKey || e.metaKey || e.shiftKey)) return;
      e.preventDefault();
      r.cam.zoom = Math.max(1, Math.min(3.2, r.cam.zoom * Math.exp(-e.deltaY * 0.0025)));
      draw();
      syncZoomed();
    };
    box.addEventListener("wheel", onWheel, { passive: false });
    return () => box.removeEventListener("wheel", onWheel);
  }, [draw, mode3d, syncZoomed]);
  const [focus, setFocus] = useState<BodyFocus>("full");
  const reset = () => {
    setFocus("full");
    animateTo({ yaw: SNAP_YAW[snap], zoom: 1, panY: 0, pitch: 0.04 });
  };
  const focusOn = (f: BodyFocus) => {
    setFocus(f);
    animateTo({ ...FOCUS_CAM[f], yaw: SNAP_YAW[snap] });
  };

  if (mode3d === "2d")
    return <Body2D colorOf={colorOf} picked={picked} onPick={onPick} dark={dark} still={preview} marks={marks} />;
  return (
    <div className="relative" data-body3d={mode3d} data-body-preview={preview ? "" : undefined}>
      <div
        ref={boxRef}
        className={cn(
          "relative w-full select-none overflow-hidden rounded-2xl",
          heightClass ?? "h-[420px] md:h-[480px]",
          // at full size up and down scroll the page; zoomed in they move the body
          preview ? "pointer-events-none" : zoomed ? "touch-none" : "touch-pan-y",
          "bg-[radial-gradient(ellipse_at_50%_40%,var(--muted)_0%,transparent_70%)]",
        )}
        onPointerDown={preview ? undefined : onDown}
        onPointerMove={preview ? undefined : onMove}
        onPointerUp={preview ? undefined : onUp}
        onPointerCancel={preview ? undefined : onCancel}
        onLostPointerCapture={preview ? undefined : onCancel}
        data-gesture={preview ? undefined : zoomed ? "x y" : "x"}
        onDoubleClick={preview ? undefined : reset}
        role="img"
        aria-label={ariaLabel}
      >
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
        {mode3d === "loading" && (
          <div className="absolute inset-0 jf-skeleton rounded-2xl bg-muted/40" aria-hidden />
        )}
      </div>
      {!preview && focusAreas && (
        <div className="mt-2 grid grid-cols-4 gap-1 rounded-lg bg-muted/50 p-0.5" role="group" aria-label="Zoom to" data-body-focus>
          {(Object.keys(FOCUS_CAM) as BodyFocus[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => focusOn(f)}
              aria-pressed={focus === f}
              className={cn("h-9 rounded-md text-[13px] font-medium transition-colors", focus === f ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground")}
              data-body-focus-area={f}
            >
              {FOCUS_LABEL[f]}
            </button>
          ))}
        </div>
      )}
      {!preview && (
      <div className="mt-2 flex items-center gap-2">
        {compactControls ? <select aria-label="Body orientation" value={snap} onChange={e=>{const v=e.target.value as ViewSnap;setSnap(v);animateTo({yaw:SNAP_YAW[v]});}} className="min-h-10 flex-1 rounded-lg border border-border bg-background px-2.5 text-xs font-medium"><option value="front">Front</option><option value="side">Side</option><option value="back">Back</option></select> : (
        <Segmented
          value={snap}
          onChange={(v) => {
            setSnap(v);
            animateTo({ yaw: SNAP_YAW[v] });
          }}
          options={[
            { key: "front", label: "Front" },
            { key: "side", label: "Side" },
            { key: "back", label: "Back" },
          ]}
          label="Turn the body to"
          size="sm"
          className="flex-1"
        />
        )}
        <button
          type="button"
          onClick={reset}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground"
          aria-label="Reset the view"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
        {onList && (
          <button
            type="button"
            onClick={onList}
            className="h-9 shrink-0 rounded-lg border border-border px-2.5 text-[12px] font-medium text-muted-foreground hover:text-foreground"
            data-muscle-show-list
          >
            List
          </button>
        )}
      </div>
      )}
    </div>
  );
}

/** The front and back drawings side by side, coloured the same way: the fallback, and lighter on old phones. */
function Body2D({
  colorOf,
  picked,
  onPick,
  dark,
  still = false,
  marks,
}: {
  colorOf: (m: FineMuscle) => string | null;
  picked: FineMuscle | null;
  onPick: (m: FineMuscle | null) => void;
  dark: boolean;
  /** a small preview: no taps of its own, as tall as its box */
  still?: boolean;
  marks?: BodyMark[];
}) {
  const th = BODY_THEME[dark ? "dark" : "light"];
  const markColors = MARK_COLORS[dark ? "dark" : "light"];
  const hatchId = useId().replace(/:/g, "");
  return (
    <div className={cn("grid grid-cols-2 gap-2", still && "pointer-events-none")} data-body2d>
      {(["front", "back"] as const).map((k) => {
        const v = atlasView(k, "R");
        return (
          <figure key={k} className="min-w-0">
            <svg
              viewBox="0 0 400 920"
              className={still ? "h-[150px] w-full" : "h-[340px] w-full"}
              role="img"
              aria-label={`${k === "front" ? "Front" : "Back"} of the body`}
            >
              <path d={v.silhouette} fill={th.skin} />
              <path d={v.head} fill={th.skin} />
              {v.parts
                .filter((p) => !p.deep && p.kind === "muscle" && muscleOfSite(p.site))
                .map((p) => {
                  const m = muscleOfSite(p.site)!;
                  return (
                    <path
                      key={p.id}
                      d={p.d}
                      fill={colorOf(m) ?? th.skin}
                      stroke={picked === m ? th.pickEdge : th.line}
                      strokeWidth={picked === m ? 2.4 : 0.8}
                      onClick={() => onPick(m)}
                      className="cursor-pointer"
                    >
                      <title>{m}</title>
                    </path>
                  );
                })}
              {marks?.length ? (
                <>
                  <defs>
                    {(["limit", "general", "reported"] as const).map((t) => (
                      <pattern key={t} id={`${hatchId}-${t}`} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                        {t === "reported" ? <circle cx="4" cy="4" r="1.1" fill={markColors[t]} opacity="0.7" /> : <line x1="0" y1="0" x2="0" y2="8" stroke={markColors[t]} strokeWidth="2.4" opacity="0.85" />}
                      </pattern>
                    ))}
                  </defs>
                  {(["reported", "general", "limit"] as const).flatMap((t) =>
                    v.parts
                      .filter((p) => (!p.deep || marks.some((m) => m.site === p.site)) && marks.some((m) => m.tone === t && partShowsMark(p, m, true)))
                      .map((p) => (
                        <path key={`${t}-${p.id}`} d={p.d} fill={`url(#${hatchId}-${t})`} stroke={markColors[t]} strokeWidth={1.8} strokeDasharray={t === "reported" ? "3 2.5" : undefined} pointerEvents="none" data-body-mark={t} />
                      )),
                  )}
                </>
              ) : null}
            </svg>
            <figcaption className="text-center text-[11px] text-muted-foreground">
              {k === "front" ? "Front" : "Back"}
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}

// ── detail & list ──────────────────────────────────────────────────────

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[12px] text-muted-foreground">{label}</div>
      <div className="text-[20px] font-semibold leading-tight tabular-nums text-foreground">{value}</div>
      {sub && <div className="text-[11px] leading-snug text-muted-foreground">{sub}</div>}
    </div>
  );
}

function MuscleDetail({
  row,
  mode,
  coached,
  credit,
  enough,
  onClear,
  onExercise,
  bare = false,
}: {
  row: MuscleReadRow | undefined;
  mode: MuscleMode;
  coached: boolean;
  credit: SupportCredit;
  enough: boolean;
  onClear: () => void;
  onExercise?: (name: string) => void;
  bare?: boolean;
}) {
  if (!row)
    return (
      <div
        className="rounded-2xl bg-muted/40 p-4 text-[13px] text-muted-foreground"
        data-muscle-detail-empty
      >
        {enough || mode === "distribution"
          ? "Tap a muscle to see its sets. Drag to turn the body."
          : "There isn't enough training in this period to tell yet. Pick a longer period above."}
      </div>
    );
  const p = row.period;
  const status =
    mode === "change"
      ? !row.period.before ? "No comparable prior period" : row.period.total > row.period.before.total ? "More training" : row.period.total < row.period.before.total ? "Less training" : "Similar training"
      : mode === "fit"
      ? FIT_WORD[row.fit.status]
      : mode === "development"
        ? DEV_WORD[row.dev.status]
        : MUSCLE_LEVELS[row.level].label;
  const change = periodChangeWords(p, p.before ? shortRange(p.before.start, p.before.end) : undefined);
  const supportingSub =
    p.supporting === 0
      ? "none"
      : credit === 0
        ? "not counted"
        : credit === 1
          ? "counted in full"
          : `counted as ${fmtSets(p.supporting * credit)}`;
  return (
    <div
      className={cn("text-[13px]", bare ? "px-5 pt-4" : "rounded-2xl bg-muted/40 p-4")}
      data-muscle-detail={row.muscle}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[18px] font-semibold text-foreground">{row.muscle}</div>
          <div className="text-[13px] text-muted-foreground">{status}</div>
        </div>
        <button
          type="button"
          onClick={onClear}
          aria-label="Close"
          className="-mr-2 -mt-1 inline-flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3" data-muscle-stats>
        <Stat label="Total sets" value={fmtSets(p.total)} sub={row.perWeek > 0 ? `about ${fmtSets(row.perWeek)} a week` : undefined} />
        <Stat label={mode==="fit"&&row.targetSets!=null?"Planned sets":"Direct sets"} value={mode==="fit"&&row.targetSets!=null?fmtSets(row.targetSets):p.direct} sub={mode==="fit"&&row.targetSets!=null?"elapsed plan":"aimed at it"} />
        <Stat label="Days trained" value={p.days} />
        {mode!=="change"&&row.averageRpe!=null?<Stat label="Average effort" value={row.averageRpe} sub="rated sets · RPE"/>:<Stat
          label="Change"
          value={
            p.changePct != null ? (
              <span className={p.changePct >= 5 ? "text-success" : undefined}>
                {p.changePct > 0 ? "+" : p.changePct < 0 ? "−" : ""}
                {Math.abs(p.changePct)}%
              </span>
            ) : p.before && p.before.total <= 0 && p.total > 0 ? (
              "New"
            ) : (
              "—"
            )
          }
          sub={p.before ? "vs comparison period" : "nothing earlier to compare"}
        /> }
      </div>
      {mode === "change" && change && <p className="mt-3 text-[13px] text-foreground/85" data-muscle-change>{change}</p>}
      <details className="mt-2 text-xs text-muted-foreground"><summary className="min-h-9 cursor-pointer pt-2 font-medium">Set breakdown</summary><p>{p.direct} direct · {p.supporting} supporting ({supportingSub}) · {p.exerciseCount} exercises.</p></details>
      {row.targetSets!=null && mode!=="change" && <div className="mt-3 border-t border-border pt-2 text-xs"><span className="font-medium">Plan vs actual</span><div className="mt-1 flex justify-between text-muted-foreground"><span>{fmtSets(p.total)} completed / {fmtSets(row.targetSets)} planned sets</span></div>{row.targetSets>0&&<div className="mt-1.5 h-1.5 rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{width:Math.min(100,p.total/row.targetSets*100)+"%"}}/></div>}</div>}
      {mode!=="change"&&<details className="mt-2 border-t border-border text-xs"><summary className="min-h-9 cursor-pointer pt-2 font-medium">Exercise progress <span className="font-normal text-muted-foreground">· {DEV_SHORT[row.dev.status]}</span></summary>
        <div className="space-y-1 pb-2 text-muted-foreground">{row.dev.why&&<p>{row.dev.why}</p>}{row.dev.evidence.slice(0,3).map(e=><p key={e}>{e}</p>)}{row.dev.consider&&<p>{row.dev.consider}</p>}{row.dev.status==="unknown"&&<p>No reliable trend in this period. Open a contributing exercise for its actual logged performance.</p>}</div>
      </details>}
      {row.exercises.length > 0 && (
        <div className="mt-3">
          <div className="text-[12px] font-medium text-muted-foreground">Exercises that trained it</div>
          <ul className="mt-1 space-y-1">
            {row.exercises.map((e) => (
              <li key={e.name}>
                <button type="button" disabled={!onExercise} onClick={() => onExercise?.(e.name)} className="flex min-h-10 w-full items-center justify-between gap-2 text-left">
                  <span className="min-w-0 text-foreground">{e.name}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{e.sets} set{e.sets === 1 ? "" : "s"}{e.direct ? "" : " · supporting"}{onExercise ? " ›" : ""}</span>
                </button>
                <div className="h-1 rounded-full bg-muted"><div className="h-1 rounded-full bg-foreground/40" style={{ width: `${100 * e.sets / Math.max(1, ...row.exercises.map((x) => x.sets))}%` }} /></div>
              </li>
            ))}
          </ul>
        </div>
      )}

    </div>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function shortRange(a: string, b: string): string {
  const d = (s: string) => `${MONTHS[Number(s.slice(5, 7)) - 1]} ${Number(s.slice(8, 10))}`;
  return a.slice(0, 7) === b.slice(0, 7) ? `${d(a)} – ${Number(b.slice(8, 10))}` : `${d(a)} – ${d(b)}`;
}

function MuscleList({
  read,
  mode,
  dark,
  picked,
  onPick,
  coached,
  credit,
  onExercise,
}: {
  read: MuscleRead;
  mode: MuscleMode;
  dark: boolean;
  picked: FineMuscle | null;
  onPick: (m: FineMuscle | null) => void;
  coached: boolean;
  credit: SupportCredit;
  onExercise?: (name: string) => void;
}) {
  const order: Record<string, number> = {
    gap: 0,
    look: 1,
    more: 2,
    opportunity: 0,
    strength: 1,
    supported: 3,
    steady: 3,
    unknown: 4,
  };
  const rows = [...read.rows].sort((a, b) =>
    mode === "distribution"
      ? b.period.total - a.period.total
      : mode === "fit"
        ? order[a.fit.status] - order[b.fit.status] || b.perWeek - a.perWeek
        : order[a.dev.status] - order[b.dev.status] || b.perWeek - a.perWeek,
  );
  const max = Math.max(1, ...rows.map((r) => r.period.total));
  const pickedRow = picked ? read.rows.find((r) => r.muscle === picked) : undefined;
  return (
    <div className="mt-2" data-muscle-list>
      <ul className="space-y-1">
        {rows.map((r) => {
          const c = muscleColor(r, mode, dark) ?? "var(--muted-foreground)";
          return (
            <li key={r.muscle}>
              <button
                type="button"
                onClick={() => onPick(picked === r.muscle ? null : r.muscle)}
                aria-pressed={picked === r.muscle}
                aria-expanded={picked === r.muscle}
                className={cn(
                  "flex min-h-11 w-full items-center gap-3 rounded-lg px-1.5 text-left transition hover:bg-muted/40",
                  picked === r.muscle && "bg-muted/60",
                )}
              >
                <span className="w-24 shrink-0 truncate text-[14px] text-foreground">
                  {r.muscle}
                </span>
                <span className="relative h-2.5 flex-1 rounded-full bg-muted/60">
                  <span
                    className="absolute inset-y-0 left-0 rounded-full"
                    style={{
                      width: `${(r.period.total / max) * 100}%`,
                      background: c,
                      minWidth: r.period.total > 0 ? 4 : 0,
                    }}
                  />
                </span>
                <span className="w-24 shrink-0 text-right text-[13px] tabular-nums text-muted-foreground">
                  {mode === "distribution"
                    ? `${fmtSets(r.period.total)} set${r.period.total === 1 ? "" : "s"}`
                    : mode === "change"
                      ? r.period.before ? `${r.period.total - r.period.before.total > 0 ? "+" : ""}${fmtSets(r.period.total - r.period.before.total)} sets` : "No data"
                      : mode === "fit"
                      ? FIT_SHORT[r.fit.status]
                      : r.dev.status === "unknown" || r.dev.status === "steady"
                        ? `${fmtSets(r.period.total)} sets`
                        : DEV_SHORT[r.dev.status]}
                </span>
              </button>
              {picked === r.muscle && pickedRow && (
                <div className="mb-2 mt-1">
                  <MuscleDetail
                    row={pickedRow}
                    mode={mode}
                    coached={coached}
                    credit={credit}
                    enough={read.enoughData}
                    onExercise={onExercise}
                    onClear={() => onPick(null)}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
