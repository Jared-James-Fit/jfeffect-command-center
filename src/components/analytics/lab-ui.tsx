/**
 * The analytics page's small shared pieces: a card heading, a neutral
 * segmented choice, a ‹ period › stepper and a weight said in both units.
 * One look for every module (Strength DNA, the calendar, the muscle map,
 * lifetime), so they read as one system.
 */
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { dualLoad, type Unit } from "@/lib/analytics/units";

/** A module's heading: 16px title, an optional line under it, a tip and an action on the right. */
export function LabHeader({
  title,
  sub,
  tip,
  action,
  className,
}: {
  title: ReactNode;
  sub?: ReactNode;
  tip?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start gap-2", className)}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <h3 className="truncate text-[16px] font-semibold text-foreground">{title}</h3>
          {tip}
        </div>
        {sub && <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{sub}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** A neutral segmented choice (the one on is a filled neutral chip, never the brand red). */
export function Seg<T extends string | number>({
  value,
  options,
  onChange,
  label,
  size = "md",
  className,
  testId,
  stretch = false,
}: {
  value: T;
  options: Array<[T, ReactNode]>;
  onChange: (v: T) => void;
  label: string;
  size?: "sm" | "md";
  className?: string;
  testId?: string;
  /** fill the row: every option the same width (true), or each as wide as its word ("auto") */
  stretch?: boolean | "auto";
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      data-testid={testId}
      className={cn(
        "max-w-full items-center gap-0.5 overflow-x-auto rounded-lg bg-muted p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        stretch ? "flex w-full" : "inline-flex",
        className,
      )}
    >
      {options.map(([v, text]) => {
        const on = v === value;
        return (
          <button
            key={String(v)}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(v)}
            data-seg={String(v)}
            className={cn(
              "truncate rounded-md font-medium transition-colors",
              stretch === "auto"
                ? "min-w-0 flex-auto px-1.5"
                : stretch
                  ? "min-w-0 flex-1 px-1"
                  : "shrink-0",
              size === "sm" ? "h-8 text-[12px]" : "h-9 text-[13px]",
              !stretch && (size === "sm" ? "px-2.5" : "px-3"),
              on
                ? "bg-card text-foreground shadow-[0_0_0_1px_var(--border)]"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {text}
          </button>
        );
      })}
    </div>
  );
}

/** ‹ label › for stepping a period. A side with nowhere to go is quiet and can't be tapped. */
export function Stepper({
  label,
  onPrev,
  onNext,
  className,
}: {
  label: ReactNode;
  onPrev?: (() => void) | null;
  onNext?: (() => void) | null;
  className?: string;
}) {
  const btn =
    "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30";
  return (
    <div className={cn("flex min-w-0 items-center gap-1", className)}>
      <button
        type="button"
        className={btn}
        onClick={() => onPrev?.()}
        disabled={!onPrev}
        aria-label="Earlier"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <div
        className="min-w-0 flex-1 truncate text-center text-[14px] font-semibold text-foreground"
        aria-live="polite"
      >
        {label}
      </div>
      <button
        type="button"
        className={btn}
        onClick={() => onNext?.()}
        disabled={!onNext}
        aria-label="Later"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

/** A weight in the unit on screen, with the other unit beside it, quieter. */
export function DualWeight({
  lb,
  unit,
  size = "md",
  stacked = false,
  className,
}: {
  lb: number;
  unit: Unit;
  size?: "sm" | "md" | "lg" | "xl";
  stacked?: boolean;
  className?: string;
}) {
  const d = dualLoad(lb, unit);
  const main = {
    sm: "text-[13px] font-semibold",
    md: "text-[15px] font-semibold",
    lg: "text-2xl font-semibold tracking-tight",
    xl: "text-[34px] font-semibold leading-none tracking-tight",
  }[size];
  const other = size === "xl" || size === "lg" ? "text-[15px]" : "text-[12px]";
  return (
    <span
      className={cn(
        stacked ? "inline-flex flex-col" : "inline-flex flex-wrap items-baseline gap-x-1.5",
        "tabular-nums",
        className,
      )}
    >
      <span className={cn(main, "text-foreground")}>{d.main}</span>
      <span className={cn(other, "font-normal text-muted-foreground")}>{d.other}</span>
    </span>
  );
}

/** A small figure: a label over a value with a quiet line under it. */
export function Figure({
  label,
  value,
  sub,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="truncate text-[12px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-[18px] font-semibold tabular-nums tracking-tight text-foreground">
        {value}
      </div>
      {sub && <div className="text-[11px] leading-snug text-muted-foreground">{sub}</div>}
    </div>
  );
}
