import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Redo2, RotateCcw, SplitSquareHorizontal, Star, Undo2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { feedback } from "@/lib/feedback";
import {
  ADJUST_KEYS,
  ADJUST_LABELS,
  FILTER_KEYS,
  FILTER_LABELS,
  HSL_LABELS,
  HSL_RANGES,
  HSL_SWATCH,
  ONE_WAY,
  compileGrade,
  gradePixels,
  hasOwnEdits,
  withFilter,
  type AdjustKey,
  type FilterKey,
  type HslRange,
  type HslShift,
  type MediaGrade,
  type MediaStats,
} from "@/lib/media-grade";
import { sameGrade, type FilterPreset } from "@/lib/media-filter-prefs";

const THUMB = 56;
/** Every tab's body is this tall, so switching tabs never moves the picture or the buttons. */
const BODY_H = 124;
/** A change is one step to undo once the picture's held still this long (a slider drag is one step, not fifty). */
const HISTORY_SETTLE_MS = 350;

/** A small square of the picture, once (the filter thumbnails are graded from it). */
function useThumbPixels(source: CanvasImageSource | null, w: number, h: number) {
  return useMemo(() => {
    if (!source || !w || !h || typeof document === "undefined") return null;
    const c = document.createElement("canvas");
    c.width = THUMB * 2;
    c.height = THUMB * 2;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    const side = Math.min(w, h);
    try {
      ctx.drawImage(source, (w - side) / 2, (h - side) / 2, side, side, 0, 0, c.width, c.height);
      return ctx.getImageData(0, 0, c.width, c.height);
    } catch {
      return null;
    } finally {
      c.width = 0;
      c.height = 0;
    }
  }, [source, w, h]);
}

function FilterThumb({
  base,
  grade,
  label,
  on,
  onPick,
  badge,
  onRemove,
  testId,
}: {
  base: ImageData | null;
  grade: MediaGrade;
  label: string;
  on: boolean;
  onPick: () => void;
  badge?: React.ReactNode;
  onRemove?: () => void;
  testId?: string;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  // redrawn only when what it shows changes (the grade object is new every render)
  const key = JSON.stringify([grade.filter, grade.intensity, grade.adjust ?? null, grade.hsl ?? null, grade.stats?.p50 ?? null]);
  useEffect(() => {
    const c = ref.current;
    if (!c || !base) return;
    // drawn a beat later, a few at a time, so opening the panel never stalls a frame
    const t = window.setTimeout(() => {
      c.width = base.width;
      c.height = base.height;
      const img = new ImageData(new Uint8ClampedArray(base.data), base.width, base.height);
      gradePixels(img.data, base.width, base.height, compileGrade(grade));
      c.getContext("2d")?.putImageData(img, 0, 0);
    }, 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, key]);
  return (
    <div className="relative w-[62px] shrink-0">
      <button type="button" onClick={onPick} aria-pressed={on} aria-label={label} className="flex w-full flex-col items-center gap-1" data-filter-pick={testId ?? grade.filter}>
        <span className={cn("relative block overflow-hidden rounded-xl ring-2 ring-offset-2 ring-offset-black transition", on ? "ring-white" : "ring-transparent")} style={{ width: THUMB, height: THUMB }}>
          {base ? <canvas ref={ref} className="h-full w-full" /> : <span className="block h-full w-full bg-zinc-800" />}
          {badge && <span className="absolute left-1 top-1">{badge}</span>}
        </span>
        <span className={cn("line-clamp-2 h-[26px] w-full text-center text-[10.5px] font-semibold leading-[13px]", on ? "text-white" : "text-white/60")}>{label}</span>
      </button>
      {onRemove && on && (
        <button type="button" onClick={onRemove} className="absolute -right-1 -top-1 grid h-6 w-6 place-items-center rounded-full bg-white text-black shadow active:scale-90" aria-label={`Delete ${label}`} data-preset-remove>
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/** One slider: its name, the track (precise: a 32px tall touch area), the value; a tap on the value puts it back to 0. */
function Slider({
  label,
  value,
  min,
  max,
  onChange,
  onLive,
  testId,
  suffix,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  onLive?: (on: boolean) => void;
  testId?: string;
  suffix?: string;
}) {
  return (
    <div className="flex h-8 items-center gap-3 text-[13px]">
      <span className="w-[76px] shrink-0 truncate text-white/75">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerDown={() => onLive?.(true)}
        onPointerUp={() => onLive?.(false)}
        onPointerCancel={() => onLive?.(false)}
        className="h-8 min-w-0 flex-1 accent-white"
        aria-label={label}
        data-adjust={testId}
      />
      <button
        type="button"
        onClick={() => onChange(0)}
        disabled={value === 0}
        className="w-10 shrink-0 text-right tabular-nums text-white/85 disabled:text-white/40"
        aria-label={`Reset ${label}`}
        data-adjust-value={testId}
      >
        {value > 0 && min < 0 ? `+${value}` : value}
        {suffix}
      </button>
    </div>
  );
}

export type FilterScope = {
  /** The other slides (and this one), to pick which get this filter. */
  items: { id: string; thumb: string | null }[];
  currentId: string;
  onApply: (ids: string[]) => void;
};

type Tab = "filters" | "adjust" | "colour";
const TABS: { key: Tab; label: string }[] = [
  { key: "filters", label: "Filters" },
  { key: "adjust", label: "Adjust" },
  { key: "colour", label: "Colour" },
];

/**
 * The colour of one photo or clip (Nov 23 2026), a compact panel over the
 * picture's foot: Filters (the curated looks and the person's own presets as
 * thumbnails of the picture itself, with a strength), Adjust (one tool at a
 * time: a row of names, one precise slider with its number), Colour (HSL: the
 * eight ranges, hue / saturation / luminance). Every tab's body is the same
 * height, so switching never moves the picture; the chevron folds it to its
 * tab row to see the whole picture, and holding Compare shows the original.
 * Undo / Redo step through this visit's changes. Nothing is posted until
 * Share; the colour filter is separate from a story's templates and goes on
 * under them.
 */
export function FilterPanel({
  grade,
  stats,
  onChange,
  onLive,
  onCompare,
  source,
  sourceSize,
  defaultGrade,
  onSaveDefault,
  onClearDefault,
  presets,
  onSavePreset,
  onDeletePreset,
  scope,
  onDone,
  className,
}: {
  grade: MediaGrade | null;
  stats: MediaStats | null;
  onChange: (g: MediaGrade) => void;
  /** A finger is on a slider (the stage can repaint lighter until it lifts). */
  onLive?: (on: boolean) => void;
  /** Held: show the picture as it was shot (released: back to the edit). */
  onCompare?: (on: boolean) => void;
  source: CanvasImageSource | null;
  sourceSize: { w: number; h: number } | null;
  defaultGrade: MediaGrade | null;
  onSaveDefault?: () => void;
  onClearDefault?: () => void;
  presets?: FilterPreset[];
  onSavePreset?: (g: MediaGrade) => void;
  onDeletePreset?: (p: FilterPreset) => void;
  scope?: FilterScope | null;
  onDone?: () => void;
  className?: string;
}) {
  const current: MediaGrade = grade ?? { filter: "original", intensity: 1 };
  const base = useThumbPixels(source, sourceSize?.w ?? 0, sourceSize?.h ?? 0);
  const [tab, setTab] = useState<Tab>("filters");
  const [folded, setFolded] = useState(false);
  const [tool, setTool] = useState<AdjustKey>("exposure");
  const [range, setRange] = useState<HslRange>("red");
  const [picking, setPicking] = useState<Set<string> | null>(null);
  const [comparing, setComparing] = useState(false);

  // this visit's history (undo / redo): one step per settled change
  const history = useRef<{ list: MediaGrade[]; at: number }>({ list: [current], at: 0 });
  const [, bump] = useState(0);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const record = (g: MediaGrade, now = false) => {
    if (settle.current) clearTimeout(settle.current);
    const push = () => {
      const h = history.current;
      if (sameGrade(h.list[h.at], g) && h.list[h.at]?.filter === g.filter) return;
      h.list = [...h.list.slice(0, h.at + 1), g].slice(-40);
      h.at = h.list.length - 1;
      bump((n) => n + 1);
    };
    if (now) push();
    else settle.current = setTimeout(push, HISTORY_SETTLE_MS);
  };
  useEffect(() => () => {
    if (settle.current) clearTimeout(settle.current);
  }, []);
  const go = (dir: -1 | 1) => {
    if (settle.current) {
      // a change still settling counts as a step first
      clearTimeout(settle.current);
      settle.current = null;
      const h = history.current;
      if (!sameGrade(h.list[h.at], current) || h.list[h.at]?.filter !== current.filter) {
        h.list = [...h.list.slice(0, h.at + 1), current];
        h.at = h.list.length - 1;
      }
    }
    const h = history.current;
    const at = h.at + dir;
    if (at < 0 || at >= h.list.length) return;
    h.at = at;
    feedback("tap");
    onChange({ ...h.list[at], stats: stats ?? h.list[at].stats ?? null });
    bump((n) => n + 1);
  };
  const canUndo = history.current.at > 0 || !!settle.current;
  const canRedo = history.current.at < history.current.list.length - 1;

  const set = (g: MediaGrade, now = false) => {
    const next = { ...g, stats: stats ?? g.stats ?? null };
    onChange(next);
    record(next, now);
  };
  const pick = (f: FilterKey) => {
    feedback("detent");
    set(withFilter(current, f), true);
  };
  const applyPreset = (p: FilterPreset) => {
    feedback("detent");
    set({ ...p.grade }, true);
  };
  const setAdjust = (k: AdjustKey, v: number) => set({ ...current, adjust: { ...(current.adjust ?? {}), [k]: v } });
  const setHsl = (r: HslRange, k: keyof HslShift, v: number) => set({ ...current, hsl: { ...(current.hsl ?? {}), [r]: { ...(current.hsl?.[r] ?? {}), [k]: v } } });
  const changed = current.filter !== "original" || hasOwnEdits(current);
  const isDefault = !!defaultGrade && sameGrade(current, defaultGrade);
  const live = (on: boolean) => onLive?.(on);
  const compare = (on: boolean) => {
    setComparing(on);
    onCompare?.(on);
  };
  const presetOn = (p: FilterPreset) => sameGrade(current, p.grade);
  const adjusted = (k: AdjustKey) => (current.adjust?.[k] ?? 0) !== 0;
  const moved = (r: HslRange) => !!current.hsl?.[r] && Object.values(current.hsl[r]!).some((v) => !!v);
  const tabEdited: Record<Tab, boolean> = {
    filters: current.filter !== "original",
    adjust: ADJUST_KEYS.some(adjusted),
    colour: HSL_RANGES.some(moved),
  };

  return (
    <div className={cn("text-white", className)} data-filter-panel data-filter-folded={folded ? "" : undefined}>
      {/* a grip: tap to fold the controls down to the tabs (the whole picture in view) and back */}
      <button
        type="button"
        onClick={() => setFolded((f) => !f)}
        className="mx-auto -mt-0.5 flex h-4 w-16 items-start justify-center"
        aria-label={folded ? "Show the controls" : "Hide the controls"}
        aria-expanded={!folded}
        data-filter-fold
      >
        <span className="mt-1 block h-1 w-9 rounded-full bg-white/35" aria-hidden />
      </button>
      {/* the tabs, Compare (hold) and Done */}
      <div className="flex h-10 items-center gap-1">
        <div className="flex min-w-0 items-center gap-0.5" role="tablist" aria-label="Edit">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => {
                setTab(t.key);
                if (folded) setFolded(false);
              }}
              className={cn("relative h-9 shrink-0 rounded-full px-3 text-[13px] font-bold transition-colors", tab === t.key && !folded ? "bg-white text-black" : "text-white/75 active:bg-white/10")}
              data-filter-tab={t.key}
            >
              {t.label}
              {tabEdited[t.key] && <span className={cn("absolute right-1 top-1.5 h-1.5 w-1.5 rounded-full", tab === t.key && !folded ? "bg-black/60" : "bg-white")} aria-hidden />}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        {onCompare && (
          <button
            type="button"
            disabled={!changed}
            onPointerDown={() => changed && compare(true)}
            onPointerUp={() => compare(false)}
            onPointerLeave={() => comparing && compare(false)}
            onPointerCancel={() => compare(false)}
            onKeyDown={(e) => (e.key === " " || e.key === "Enter") && compare(true)}
            onKeyUp={() => compare(false)}
            onContextMenu={(e) => e.preventDefault()}
            className={cn("grid h-9 w-9 shrink-0 touch-none select-none place-items-center rounded-full disabled:opacity-30", comparing ? "bg-white text-black" : "active:bg-white/10")}
            aria-label="Hold to compare with the original"
            data-filter-compare
          >
            <SplitSquareHorizontal className="h-[18px] w-[18px]" />
          </button>
        )}
        {onDone && (
          <button type="button" onClick={onDone} className="ml-0.5 h-9 shrink-0 rounded-full bg-white px-4 text-[13px] font-bold text-black active:scale-95" data-studio-enhance-done>
            Done
          </button>
        )}
      </div>

      {!folded && (
        <>
          <div className="mt-1.5" style={{ height: BODY_H }} data-filter-body={tab}>
            {tab === "filters" && (
              <div className="flex h-full flex-col justify-between">
                <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label="Filters">
                  {(presets ?? []).map((p) => (
                    <FilterThumb
                      key={p.id}
                      base={base}
                      grade={{ ...p.grade, stats }}
                      label={p.name}
                      on={presetOn(p)}
                      onPick={() => applyPreset(p)}
                      badge={<Star className="h-3.5 w-3.5 fill-white text-white drop-shadow" />}
                      onRemove={onDeletePreset ? () => onDeletePreset(p) : undefined}
                      testId={`preset:${p.id}`}
                    />
                  ))}
                  {FILTER_KEYS.map((f) => (
                    // each thumbnail is the filter itself at full strength (a slider never redraws them)
                    <FilterThumb key={f} base={base} grade={{ filter: f, intensity: 1, stats }} label={FILTER_LABELS[f]} on={current.filter === f && !(presets ?? []).some(presetOn)} onPick={() => pick(f)} />
                  ))}
                </div>
                {/* the strength's row is always there (empty on Original), so nothing jumps */}
                <div className="h-8" data-filter-intensity>
                  {current.filter !== "original" ? (
                    <Slider label="Strength" value={Math.round(current.intensity * 100)} min={0} max={100} onChange={(v) => set({ ...current, intensity: v / 100 })} onLive={live} testId="intensity" />
                  ) : (
                    <p className="flex h-8 items-center text-[12px] text-white/55">Pick a filter. Templates and stickers go on top of it.</p>
                  )}
                </div>
              </div>
            )}

            {tab === "adjust" && (
              <div className="flex h-full flex-col justify-between">
                <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label="Adjustments">
                  {ADJUST_KEYS.map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => {
                        feedback("tap");
                        setTool(k);
                      }}
                      aria-pressed={tool === k}
                      className={cn(
                        "relative h-9 shrink-0 rounded-full px-3 text-[13px] font-semibold transition-colors",
                        tool === k ? "bg-white text-black" : "bg-white/10 text-white/85 active:bg-white/20",
                      )}
                      data-adjust-tool={k}
                    >
                      {ADJUST_LABELS[k]}
                      {adjusted(k) && <span className={cn("ml-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle", tool === k ? "bg-black/60" : "bg-white")} aria-label="changed" />}
                    </button>
                  ))}
                </div>
                <div className="space-y-1">
                  <p className="text-[12px] text-white/55" data-adjust-hint>
                    {ADJUST_HINT[tool]}
                  </p>
                  <Slider label={ADJUST_LABELS[tool]} value={current.adjust?.[tool] ?? 0} min={ONE_WAY.has(tool) ? 0 : -100} max={100} onChange={(v) => setAdjust(tool, v)} onLive={live} testId={tool} />
                </div>
              </div>
            )}

            {tab === "colour" && (
              <div className="flex h-full flex-col justify-between">
                <div className="flex items-center justify-between px-1 pt-0.5" role="group" aria-label="Colour ranges">
                  {HSL_RANGES.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => {
                        feedback("tap");
                        setRange(r);
                      }}
                      aria-pressed={range === r}
                      aria-label={HSL_LABELS[r]}
                      className={cn("relative grid h-8 w-8 place-items-center rounded-full ring-2 ring-offset-2 ring-offset-black transition", range === r ? "ring-white" : "ring-transparent")}
                      data-hsl-range={r}
                    >
                      <span className="block h-6 w-6 rounded-full" style={{ background: HSL_SWATCH[r] }} />
                      {moved(r) && <span className="absolute -bottom-1 h-1.5 w-1.5 rounded-full bg-white" aria-hidden />}
                    </button>
                  ))}
                </div>
                <div>
                  <Slider label={`${HSL_LABELS[range]} hue`} value={current.hsl?.[range]?.h ?? 0} min={-100} max={100} onChange={(v) => setHsl(range, "h", v)} onLive={live} testId={`hsl-${range}-h`} />
                  <Slider label="Saturation" value={current.hsl?.[range]?.s ?? 0} min={-100} max={100} onChange={(v) => setHsl(range, "s", v)} onLive={live} testId={`hsl-${range}-s`} />
                  <Slider label="Luminance" value={current.hsl?.[range]?.l ?? 0} min={-100} max={100} onChange={(v) => setHsl(range, "l", v)} onLive={live} testId={`hsl-${range}-l`} />
                </div>
              </div>
            )}
          </div>

          {/* the edit as a whole: back to the original, keep it as a preset or the default, other slides */}
          <div className="mt-1.5 flex h-9 items-center gap-0.5 overflow-x-auto text-[13px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <button type="button" onClick={() => go(-1)} disabled={!canUndo} className="grid h-9 w-9 shrink-0 place-items-center rounded-full active:bg-white/10 disabled:opacity-30" aria-label="Undo" data-filter-undo>
              <Undo2 className="h-[18px] w-[18px]" />
            </button>
            <button type="button" onClick={() => go(1)} disabled={!canRedo} className="grid h-9 w-9 shrink-0 place-items-center rounded-full active:bg-white/10 disabled:opacity-30" aria-label="Redo" data-filter-redo>
              <Redo2 className="h-[18px] w-[18px]" />
            </button>
            <button
              type="button"
              disabled={!changed}
              onClick={() => {
                feedback("tap");
                set({ filter: "original", intensity: 1 }, true);
              }}
              className="flex h-9 shrink-0 items-center gap-1 rounded-full px-2.5 font-semibold text-white/80 active:bg-white/10 disabled:opacity-35"
              data-filter-reset
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </button>
            {onSavePreset && (
              <button type="button" disabled={!changed} onClick={() => onSavePreset(current)} className="flex h-9 shrink-0 items-center gap-1 rounded-full px-2.5 font-semibold text-white/80 active:bg-white/10 disabled:opacity-35" aria-label="Save this look as a preset" data-filter-save-preset>
                <Star className="h-3.5 w-3.5" />
                Preset
              </button>
            )}
            <span className="flex-1" />
            {scope && scope.items.length > 1 && !picking && (
              <button type="button" onClick={() => setPicking(new Set(scope.items.map((i) => i.id)))} className="h-9 shrink-0 rounded-full bg-white/10 px-3 font-semibold active:bg-white/20" data-filter-apply-to>
                Other slides…
              </button>
            )}
            {isDefault ? (
              <button type="button" onClick={onClearDefault} className="flex h-9 shrink-0 items-center gap-1 px-1.5 text-white/70 active:text-white" data-filter-default="saved" aria-label="Your default filter. Tap to remove it as your default">
                <Check className="h-3.5 w-3.5" />
                Your default
              </button>
            ) : (
              onSaveDefault &&
              (changed || defaultGrade) && (
                <button type="button" onClick={onSaveDefault} className="h-9 shrink-0 px-1.5 font-semibold text-white/85 underline-offset-2 active:underline" data-filter-default="save">
                  Set as default
                </button>
              )
            )}
          </div>

          {scope && scope.items.length > 1 && picking && (
            <div className="mt-1.5 space-y-2 text-[13px]" data-filter-scope>
              <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
                {scope.items.map((it, i) => {
                  const on = picking.has(it.id);
                  return (
                    <button
                      key={it.id}
                      type="button"
                      onClick={() =>
                        setPicking((p) => {
                          const next = new Set(p);
                          if (next.has(it.id)) next.delete(it.id);
                          else next.add(it.id);
                          return next;
                        })
                      }
                      aria-pressed={on}
                      aria-label={`Slide ${i + 1}`}
                      className={cn("relative h-12 w-12 shrink-0 overflow-hidden rounded-lg ring-2", on ? "ring-white" : "ring-transparent opacity-50")}
                    >
                      {it.thumb ? <img src={it.thumb} alt="" className="h-full w-full object-cover" /> : <span className="block h-full w-full bg-zinc-800" />}
                      {on && <Check className="absolute right-0.5 top-0.5 h-3.5 w-3.5 rounded-full bg-white p-0.5 text-black" />}
                    </button>
                  );
                })}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={!picking.size}
                  onClick={() => {
                    scope.onApply([...picking]);
                    setPicking(null);
                    feedback("tap");
                  }}
                  className="h-9 rounded-full bg-white px-4 font-semibold text-black disabled:opacity-40"
                  data-filter-apply
                >
                  Apply to {picking.size === scope.items.length ? "all" : picking.size}
                </button>
                <button type="button" onClick={() => setPicking(null)} className="h-9 px-3 text-white/70">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** One line on what the tool does (shown over its slider). */
const ADJUST_HINT: Record<AdjustKey, string> = {
  exposure: "Overall light, like opening up the camera.",
  brightness: "Midtones lighter or darker, black and white held.",
  contrast: "Darks darker and lights lighter, or flatter.",
  saturation: "All colour up or down (−100 is black and white).",
  vibrance: "Quiet colours up, skin kept natural.",
  highlights: "Bring back or brighten the bright parts.",
  shadows: "Open up or deepen the dark parts.",
  whites: "Only the very brightest tones.",
  blacks: "Only the very darkest tones.",
  warmth: "Cooler (blue) or warmer (amber) light.",
  tint: "Greener or more magenta.",
  sharpness: "Crisper fine edges.",
  clarity: "Midtone punch (negative for a soft glow).",
  structure: "Texture and detail brought out.",
  fade: "Lifted, matte blacks.",
  vignette: "Darker corners.",
  grain: "Film grain.",
};
