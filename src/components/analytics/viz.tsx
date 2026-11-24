/**
 * The analytics page's small shared pieces: a container-width hook for the
 * hand-drawn SVG charts, a neutral segmented control, a progress ring, a
 * big number with its other unit, and a section heading. One look for every
 * chart on the page (neutral ink, colour only where it means something).
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { InfoTip } from "@/components/analytics/info-tip";

const useIso = typeof window === "undefined" ? useEffect : useLayoutEffect;
export const LB_PER_KG = 2.2046226;

/** The validated split palette (styles.css --split-*): squat, bench and deadlift's colours everywhere. */
export const LIFT_SERIES = {
  squat: "var(--split-squat)",
  bench: "var(--split-bench)",
  deadlift: "var(--split-deadlift)",
} as const;

/** The element's content width, kept current (charts redraw to fit, never stretch). */
export function useWidth<T extends HTMLElement>(fallback = 340) {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(fallback);
  useIso(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setW(Math.max(120, Math.round(el.clientWidth)));
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** A neutral segmented control: equal segments, the picked one raised. Never scrolls sideways. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = "md",
  className,
}: {
  value: T;
  options: Array<{ key: T; label: ReactNode; hint?: string }>;
  onChange: (v: T) => void;
  label: string;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn("grid gap-0.5 rounded-lg bg-muted/70 p-0.5", className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="tab"
          aria-selected={value === o.key}
          title={o.hint}
          onClick={() => onChange(o.key)}
          className={cn(
            "min-w-0 truncate rounded-md px-1.5 font-medium transition",
            size === "sm" ? "h-9 text-[13px]" : "h-10 text-[14px]",
            value === o.key
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
          data-seg={o.key}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Small chips for a second-level choice (a metric, a filter): neutral, wrap instead of scrolling. */
export function ChipRow<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T;
  options: Array<{ key: T; label: ReactNode }>;
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn("flex flex-wrap gap-1.5", className)}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={value === o.key}
          onClick={() => onChange(o.key)}
          className={cn(
            "h-8 rounded-full border px-3 text-[12px] font-medium transition",
            value === o.key
              ? "border-foreground bg-foreground text-background"
              : "border-border text-muted-foreground hover:text-foreground",
          )}
          data-chip={o.key}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A ring for a share (adherence): one ink, the track muted. */
export function ProgressRing({
  pct,
  size = 56,
  stroke = 6,
  tone = "foreground",
  children,
  label,
}: {
  pct: number | null;
  size?: number;
  stroke?: number;
  tone?: "foreground" | "success";
  children?: ReactNode;
  label: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
      role="img"
      aria-label={label}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--muted)"
          strokeWidth={stroke}
        />
        {pct != null && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={tone === "success" ? "var(--success)" : "var(--foreground)"}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${(p / 100) * c} ${c}`}
            className="transition-[stroke-dasharray] duration-700 ease-out motion-reduce:transition-none"
          />
        )}
      </svg>
      {children != null && (
        <span className="absolute inset-0 flex items-center justify-center">{children}</span>
      )}
    </span>
  );
}

/** A weight in the athlete's unit, big, with the other unit quietly beside or under it. */
export function Weight({
  lb,
  unit,
  className,
  sub = "below",
  digits,
}: {
  lb: number;
  unit: "lb" | "kg";
  className?: string;
  sub?: "below" | "inline" | "none";
  digits?: number;
}) {
  const main = unit === "kg" ? lb / LB_PER_KG : lb;
  const other = unit === "kg" ? lb : lb / LB_PER_KG;
  const fmt = (v: number, d = 0) =>
    v.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: 0 });
  const d = digits ?? (Math.abs(main) < 100 ? 1 : 0);
  return (
    <span
      className={cn(
        "inline-flex flex-col leading-none",
        sub === "inline" && "flex-row items-baseline gap-1.5",
        className,
      )}
    >
      <span className="tabular-nums">
        {fmt(main, d)}
        <span className="ml-0.5 text-[0.55em] font-medium text-muted-foreground">{unit}</span>
      </span>
      {sub !== "none" && (
        <span
          className={cn(
            "tabular-nums text-[11px] font-normal text-muted-foreground",
            sub === "below" && "mt-1",
          )}
        >
          {fmt(other, Math.abs(other) < 100 ? 1 : 0)} {unit === "kg" ? "lb" : "kg"}
        </span>
      )}
    </span>
  );
}

/**
 * A section's title on its own line: what it is in plain words, one line of
 * what it shows (`sub`), an optional ⓘ for how it's worked out (`info`: a
 * popover on a computer, a bottom sheet on a phone) and an optional control
 * on the right.
 */
export function SectionTitle({
  title,
  sub,
  right,
  id,
  info,
  infoTitle,
}: {
  title: string;
  sub?: ReactNode;
  right?: ReactNode;
  id?: string;
  info?: ReactNode;
  infoTitle?: string;
}) {
  return (
    <div className="mb-2.5 flex items-end justify-between gap-3" id={id}>
      <div className="min-w-0">
        <h2 className="flex items-center gap-1.5 text-[16px] font-semibold tracking-tight text-foreground">
          <span className="min-w-0">{title}</span>
          {info && (
            <InfoTip label={`About ${title.toLowerCase()}`} title={infoTitle ?? title}>
              {info}
            </InfoTip>
          )}
        </h2>
        {sub && <div className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{sub}</div>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

/** "+4.2%" in green when it's up, the text colour otherwise (a drop is never alarm-red). */
export function Change({ pct, className }: { pct: number | null | undefined; className?: string }) {
  if (pct == null || !Number.isFinite(pct)) return null;
  const up = pct > 0.05;
  return (
    <span className={cn("tabular-nums", up ? "text-success" : "text-muted-foreground", className)}>
      {pct > 0 ? "+" : pct < 0 ? "−" : ""}
      {Math.abs(Math.round(pct * 10) / 10)}%
    </span>
  );
}

/** Points along an SVG arc, degrees clockwise from 12 o'clock. */
export function arcPath(
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number,
): string {
  const pt = (deg: number) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  const [x0, y0] = pt(startDeg);
  const [x1, y1] = pt(endDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/** Nice round ticks for a numeric axis (never zoomed past `minSpan`). */
export function niceTicks(
  min: number,
  max: number,
  count = 4,
  minSpan = 0,
): { lo: number; hi: number; ticks: number[] } {
  let lo = Math.min(min, max);
  let hi = Math.max(min, max);
  if (hi - lo < minSpan) {
    const mid = (hi + lo) / 2;
    lo = mid - minSpan / 2;
    hi = mid + minSpan / 2;
  }
  if (hi === lo) hi = lo + 1;
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const a = Math.floor(lo / step) * step;
  const b = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = a; v <= b + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
  return { lo: a, hi: b, ticks };
}
