import { cn } from "@/lib/utils";
import { MUSCLE_GROUPS, MUSCLE_GROUP_LABELS } from "@/lib/volume";

const PICKABLE = MUSCLE_GROUPS.filter((m) => m !== "other");

/**
 * One chip per muscle. Tap cycles: off → PRIMARY → SECONDARY → off.
 * Primary order is tap order, so the first primary is the main muscle.
 */
export function MuscleTagPicker({
  primary,
  secondary,
  onChange,
  disabled,
}: {
  primary: string[];
  secondary: string[];
  onChange: (next: { primary: string[]; secondary: string[] }) => void;
  disabled?: boolean;
}) {
  const cycle = (m: string) => {
    if (primary.includes(m)) {
      onChange({ primary: primary.filter((x) => x !== m), secondary: [...secondary, m] });
    } else if (secondary.includes(m)) {
      onChange({ primary, secondary: secondary.filter((x) => x !== m) });
    } else {
      onChange({ primary: [...primary.filter((x) => x !== "other"), m], secondary });
    }
  };
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {PICKABLE.map((m) => {
          const p = primary.includes(m);
          const s = secondary.includes(m);
          return (
            <button
              key={m}
              type="button"
              disabled={disabled}
              onClick={() => cycle(m)}
              aria-pressed={p || s}
              aria-label={`${MUSCLE_GROUP_LABELS[m]}: ${p ? "primary" : s ? "secondary" : "not tagged"}`}
              className={cn(
                "min-h-8 rounded-full border px-2.5 text-xs font-semibold transition-colors",
                p && "border-primary bg-primary text-primary-foreground",
                s && "border-primary/50 bg-primary/10 text-primary",
                !p && !s && "border-border bg-background text-muted-foreground hover:bg-accent",
              )}
            >
              {MUSCLE_GROUP_LABELS[m]}
              {p && primary.indexOf(m) === 0 && primary.length > 1 && <span className="ml-1 opacity-80">★</span>}
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        Tap once = <b className="text-primary">Primary</b> (full set) · twice = <span className="text-primary">Secondary</span> (½ set) · three times = off.
        {primary.length > 1 && " ★ = main muscle (first tapped)."}
      </p>
    </div>
  );
}
