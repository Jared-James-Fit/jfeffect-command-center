import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { feedback } from "@/lib/feedback";
import {
  ADJUST_KEYS,
  ADJUST_LABELS,
  FILTER_KEYS,
  FILTER_LABELS,
  compileGrade,
  gradePixels,
  withFilter,
  type AdjustKey,
  type FilterKey,
  type MediaGrade,
  type MediaStats,
} from "@/lib/media-grade";
import { sameGrade } from "@/lib/media-filter-prefs";

const THUMB = 56;

/** A small square of the picture, once (the six filter thumbnails are graded from it). */
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
    }
  }, [source, w, h]);
}

function FilterThumb({ base, grade, label, on, onPick }: { base: ImageData | null; grade: MediaGrade; label: string; on: boolean; onPick: () => void }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  // redrawn only when what it shows changes (the grade object is new every render)
  const key = JSON.stringify([grade.filter, grade.intensity, grade.adjust ?? null, grade.stats?.p50 ?? null]);
  useEffect(() => {
    const c = ref.current;
    if (!c || !base) return;
    c.width = base.width;
    c.height = base.height;
    const img = new ImageData(new Uint8ClampedArray(base.data), base.width, base.height);
    gradePixels(img.data, base.width, base.height, compileGrade(grade));
    c.getContext("2d")?.putImageData(img, 0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, key]);
  return (
    <button type="button" onClick={onPick} aria-pressed={on} className="flex w-[64px] shrink-0 flex-col items-center gap-1.5" data-filter-pick={grade.filter}>
      <span className={cn("block overflow-hidden rounded-xl ring-2 ring-offset-2 ring-offset-black transition", on ? "ring-white" : "ring-transparent")} style={{ width: THUMB, height: THUMB }}>
        {base ? <canvas ref={ref} className="h-full w-full" /> : <span className="block h-full w-full bg-zinc-800" />}
      </span>
      <span className={cn("text-[11px] font-semibold", on ? "text-white" : "text-white/60")}>{label}</span>
    </button>
  );
}

export type FilterScope = {
  /** The other slides (and this one), to pick which get this filter. */
  items: { id: string; thumb: string | null }[];
  currentId: string;
  onApply: (ids: string[]) => void;
};

/**
 * The filters and adjustments for one photo or clip (Nov 22 2026): the six
 * filters as thumbnails of the picture itself, how strong (only once one is
 * picked), Adjust folded under them, and a quiet "Save as default". Everything
 * shows at once on the stage (the GPU grades the preview); nothing is posted
 * until Share. `scope`: a carousel, where the filter can go on others too.
 */
export function FilterPanel({
  grade,
  stats,
  onChange,
  onLive,
  source,
  sourceSize,
  defaultGrade,
  onSaveDefault,
  onClearDefault,
  scope,
  className,
}: {
  grade: MediaGrade | null;
  stats: MediaStats | null;
  onChange: (g: MediaGrade) => void;
  /** A finger is on a slider (the stage can repaint lighter until it lifts). */
  onLive?: (on: boolean) => void;
  source: CanvasImageSource | null;
  sourceSize: { w: number; h: number } | null;
  defaultGrade: MediaGrade | null;
  onSaveDefault?: () => void;
  onClearDefault?: () => void;
  scope?: FilterScope | null;
  className?: string;
}) {
  const current: MediaGrade = grade ?? { filter: "original", intensity: 1 };
  const base = useThumbPixels(source, sourceSize?.w ?? 0, sourceSize?.h ?? 0);
  const [adjusting, setAdjusting] = useState(() => !!current.adjust && Object.keys(current.adjust).length > 0);
  const [picking, setPicking] = useState<Set<string> | null>(null);
  const set = (g: MediaGrade) => onChange({ ...g, stats: stats ?? g.stats ?? null });
  const pick = (f: FilterKey) => {
    feedback("detent");
    set(withFilter(current, f));
  };
  const setAdjust = (k: AdjustKey, v: number) => set({ ...current, adjust: { ...(current.adjust ?? {}), [k]: v } });
  const changed = current.filter !== "original" || ADJUST_KEYS.some((k) => (current.adjust?.[k] ?? 0) !== 0);
  const isDefault = !!defaultGrade && sameGrade(current, defaultGrade);
  const live = (on: boolean) => onLive?.(on);

  return (
    <div className={cn("space-y-3 text-white", className)} data-filter-panel>
      <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]" role="group" aria-label="Filters">
        {FILTER_KEYS.map((f) => (
          // each thumbnail is the filter itself at full strength (a slider never redraws six of them)
          <FilterThumb key={f} base={base} grade={{ filter: f, intensity: 1, stats }} label={FILTER_LABELS[f]} on={current.filter === f} onPick={() => pick(f)} />
        ))}
      </div>

      {current.filter !== "original" && (
        <label className="flex items-center gap-3 text-[13px]" data-filter-intensity>
          <span className="w-[70px] shrink-0 text-white/70">Strength</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(current.intensity * 100)}
            onChange={(e) => set({ ...current, intensity: Number(e.target.value) / 100 })}
            onPointerDown={() => live(true)}
            onPointerUp={() => live(false)}
            onPointerCancel={() => live(false)}
            className="h-6 min-w-0 flex-1 accent-white"
            aria-label="Filter strength"
          />
          <span className="w-8 text-right tabular-nums text-white/80">{Math.round(current.intensity * 100)}</span>
        </label>
      )}

      <div className="flex items-center gap-2 text-[13px]">
        <button type="button" onClick={() => setAdjusting((a) => !a)} aria-expanded={adjusting} className="flex h-9 items-center gap-1 rounded-full bg-white/10 px-3 font-semibold active:bg-white/20" data-filter-adjust-toggle>
          Adjust
          <ChevronDown className={cn("h-4 w-4 transition-transform", adjusting && "rotate-180")} />
        </button>
        {changed && (
          <button type="button" onClick={() => set({ filter: "original", intensity: 1 })} className="flex h-9 items-center gap-1 rounded-full px-3 text-white/70 active:text-white" data-filter-reset>
            <RotateCcw className="h-3.5 w-3.5" />
            Original
          </button>
        )}
        <span className="flex-1" />
        {isDefault ? (
          <button type="button" onClick={onClearDefault} className="flex h-9 items-center gap-1 px-1 text-white/70 active:text-white" data-filter-default="saved" aria-label="Your default filter. Tap to remove it as your default">
            <Check className="h-3.5 w-3.5" />
            Your default
          </button>
        ) : (
          onSaveDefault &&
          (changed || defaultGrade) && (
            <button type="button" onClick={onSaveDefault} className="h-9 px-1 font-semibold text-white/90 underline-offset-2 active:underline" data-filter-default="save">
              Save as default
            </button>
          )
        )}
      </div>

      {adjusting && (
        <div className="space-y-1" data-filter-adjust>
          {ADJUST_KEYS.map((k) => {
            const v = current.adjust?.[k] ?? 0;
            const min = k === "sharpness" ? 0 : -100;
            return (
              <div key={k} className="flex items-center gap-3 text-[13px]">
                <span className="w-[70px] shrink-0 text-white/70">{ADJUST_LABELS[k]}</span>
                <input
                  type="range"
                  min={min}
                  max={100}
                  value={v}
                  onChange={(e) => setAdjust(k, Number(e.target.value))}
                  onPointerDown={() => live(true)}
                  onPointerUp={() => live(false)}
                  onPointerCancel={() => live(false)}
                  className="h-6 min-w-0 flex-1 accent-white"
                  aria-label={ADJUST_LABELS[k]}
                  data-adjust={k}
                />
                <button type="button" onClick={() => setAdjust(k, 0)} disabled={v === 0} className="w-9 text-right tabular-nums text-white/80 disabled:text-white/35" aria-label={`Reset ${ADJUST_LABELS[k]}`}>
                  {v > 0 ? `+${v}` : v}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {scope && scope.items.length > 1 && (
        <div className="text-[13px]" data-filter-scope>
          {picking ? (
            <div className="space-y-2">
              <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
                {scope.items.map((it, i) => {
                  const on = picking.has(it.id);
                  return (
                    <button
                      key={it.id}
                      type="button"
                      onClick={() => setPicking((p) => {
                        const next = new Set(p);
                        if (next.has(it.id)) next.delete(it.id);
                        else next.add(it.id);
                        return next;
                      })}
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
          ) : (
            <button type="button" onClick={() => setPicking(new Set(scope.items.map((i) => i.id)))} className="h-9 rounded-full bg-white/10 px-3 font-semibold active:bg-white/20" data-filter-apply-to>
              Apply to other slides…
            </button>
          )}
        </div>
      )}
    </div>
  );
}
