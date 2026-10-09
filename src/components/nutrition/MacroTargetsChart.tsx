import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { MACRO_COLOR, formatKcal, kcalShares, toMacroNumber } from "./macro-palette";

type Num = number | string | null | undefined;

/**
 * Client daily targets as one picture: a calorie ring split by where the
 * calories come from (protein / carbs / fat), the grams beside it, and the
 * secondary targets (fibre, water) underneath. Read-only coach data.
 */
export function MacroTargetsChart({
  calories,
  protein,
  carbs,
  fats,
  fibre,
  water,
  className,
}: {
  calories?: Num;
  protein?: Num;
  carbs?: Num;
  fats?: Num;
  fibre?: Num;
  water?: string | null;
  className?: string;
}) {
  const p = toMacroNumber(protein);
  const c = toMacroNumber(carbs);
  const f = toMacroNumber(fats);
  const target = toMacroNumber(calories);
  const fib = toMacroNumber(fibre);
  const waterText = water && String(water).trim() ? String(water).trim() : null;

  const hasMacros = p != null && c != null && f != null;
  const split = hasMacros ? kcalShares(p, c, f) : null;
  const centerKcal = target ?? (split && split.kcal > 0 ? split.kcal : null);
  const mismatch =
    !!split && target != null && split.kcal > 0 && Math.abs(target - split.kcal) > 25;

  const rows = [
    { key: "protein", label: "Protein", grams: p, color: MACRO_COLOR.protein },
    { key: "carbs", label: "Carbs", grams: c, color: MACRO_COLOR.carbs },
    { key: "fats", label: "Fat", grams: f, color: MACRO_COLOR.fats },
  ].map((r, i) => ({ ...r, share: split?.shares[i] ?? 0, pct: split?.pcts[i] ?? null }));

  const extras = [
    fib != null ? { label: "Fibre", value: `${fib} g` } : null,
    waterText ? { label: "Water", value: waterText } : null,
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex items-center gap-5">
        <MacroRing
          segments={rows.map((r) => ({ key: r.key, share: r.share, color: r.color }))}
          label={
            split
              ? `Calories: ${rows.map((r) => `${r.label} ${r.pct}%`).join(", ")}`
              : "Calorie target"
          }
        >
          <div className="text-[28px] font-black leading-none tracking-tight tabular-nums">
            {centerKcal != null ? formatKcal(centerKcal) : "—"}
          </div>
          <div className="mt-1 text-xs font-medium text-muted-foreground">kcal</div>
        </MacroRing>

        <ul className="min-w-0 flex-1 space-y-3">
          {rows.map((r) => (
            <li key={r.key} className="flex items-stretch gap-3">
              <span
                aria-hidden
                className="w-1 shrink-0 rounded-full"
                style={{ backgroundColor: r.color }}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                  <span>{r.label}</span>
                  {r.pct != null && <span className="tabular-nums">{r.pct}%</span>}
                </div>
                <div className="text-xl font-black leading-tight tabular-nums">
                  {r.grams ?? "—"}
                  {r.grams != null && (
                    <span className="ml-0.5 text-sm font-semibold text-muted-foreground">g</span>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {extras.length > 0 && (
        <div
          className={cn(
            "grid divide-x divide-border overflow-hidden rounded-xl border border-border bg-secondary/30",
            extras.length > 1 ? "grid-cols-2" : "grid-cols-1",
          )}
        >
          {extras.map((x) => (
            <div key={x.label} className="flex items-baseline justify-between gap-2 px-4 py-3">
              <span className="text-xs text-muted-foreground">{x.label}</span>
              <span className="text-base font-bold tabular-nums">{x.value}</span>
            </div>
          ))}
        </div>
      )}

      {mismatch && split && (
        <p className="text-xs text-muted-foreground">
          Your macros add up to {formatKcal(split.kcal)} kcal.
        </p>
      )}
    </div>
  );
}

const R = 52;
const STROKE = 11;
const CIRC = 2 * Math.PI * R;
const GAP = 3.5;

function prefersReducedMotion() {
  try {
    return (
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  } catch {
    return false;
  }
}

/** Donut with gaps between segments; draws itself in once on mount. */
export function MacroRing({
  segments,
  label,
  size = 132,
  children,
}: {
  segments: { key: string; share: number; color: string }[];
  label: string;
  size?: number;
  children?: ReactNode;
}) {
  const [drawn, setDrawn] = useState(prefersReducedMotion);
  useEffect(() => {
    if (drawn) return;
    const id = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(id);
  }, [drawn]);

  const visible = segments.filter((s) => s.share > 0);
  const gap = visible.length > 1 ? GAP : 0;
  let offset = 0;

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={label}
    >
      <svg viewBox="0 0 120 120" className="block h-full w-full -rotate-90" aria-hidden>
        <circle
          cx="60"
          cy="60"
          r={R}
          fill="none"
          stroke="var(--secondary)"
          strokeWidth={STROKE}
          opacity={visible.length ? 0.6 : 1}
        />
        {segments.map((s) => {
          const span = s.share * CIRC;
          const len = s.share > 0 ? Math.max(span - gap, 0.5) : 0;
          const start = offset + (visible.length > 1 ? gap / 2 : 0);
          offset += span;
          return (
            <circle
              key={s.key}
              cx="60"
              cy="60"
              r={R}
              fill="none"
              stroke={s.color}
              strokeWidth={STROKE}
              strokeDasharray={`${drawn ? len : 0} ${CIRC}`}
              strokeDashoffset={-start}
              className="transition-[stroke-dasharray,stroke-dashoffset] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
            />
          );
        })}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>{children}</div>
      </div>
    </div>
  );
}
