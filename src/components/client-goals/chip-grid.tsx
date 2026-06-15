import { Check } from "lucide-react";

type Props<T extends string | number> = {
  options: readonly T[];
  value: T | T[] | null | undefined;
  onChange: (next: any) => void;
  multi?: boolean;
  maxSelections?: number;
  labelFor?: (v: T) => string;
  className?: string;
};

/**
 * Big tap-friendly chip selector. Single or multi select.
 * Renders as a 2+ column grid on small screens, more on wider screens.
 */
export function ChipGrid<T extends string | number>({
  options, value, onChange, multi, maxSelections, labelFor, className,
}: Props<T>) {
  const arr = Array.isArray(value) ? (value as T[]) : [];
  const isOn = (v: T) =>
    multi ? arr.includes(v) : value === v;

  const toggle = (v: T) => {
    if (!multi) {
      onChange(value === v ? null : v);
      return;
    }
    const has = arr.includes(v);
    let next = has ? arr.filter((x) => x !== v) : [...arr, v];
    if (maxSelections && !has && next.length > maxSelections) return;
    onChange(next);
  };

  return (
    <div className={["grid gap-2 grid-cols-2 sm:grid-cols-3", className].filter(Boolean).join(" ")}>
      {options.map((opt) => {
        const on = isOn(opt);
        return (
          <button
            key={String(opt)}
            type="button"
            onClick={() => toggle(opt)}
            className={[
              "relative flex min-h-[56px] items-center justify-center rounded-xl border px-3 py-3 text-center text-sm font-medium transition-all",
              on
                ? "border-primary bg-primary/15 text-primary shadow-sm"
                : "border-border bg-card hover:border-primary/40 hover:bg-secondary/40",
            ].join(" ")}
          >
            {on && <Check className="absolute right-2 top-2 h-3.5 w-3.5 text-primary" />}
            {labelFor ? labelFor(opt) : String(opt)}
          </button>
        );
      })}
    </div>
  );
}