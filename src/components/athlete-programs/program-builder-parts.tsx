import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { GOALS, LEVELS, type ProgramDraft } from "@/lib/athlete-programs";

/** Goal, level and about: what a program is for (its weeks and blocks are the builder's own). */
export function ProgramDetailsFields({
  d,
  updateMeta,
}: {
  d: ProgramDraft;
  updateMeta: (patch: Partial<Omit<ProgramDraft, "plan" | "id">>) => void;
}) {
  return (
    <div className="space-y-4">
      <ChoiceRow label="Goal" options={GOALS} value={d.goal} onChange={(goal) => updateMeta({ goal })} />
      <ChoiceRow label="Level" options={LEVELS} value={d.level} onChange={(level) => updateMeta({ level })} />
      <div>
        <div className="mb-1.5 text-[15px] font-medium">
          About it <span className="font-normal text-muted-foreground">(optional)</span>
        </div>
        <Textarea
          value={d.description}
          onChange={(e) => updateMeta({ description: e.target.value.slice(0, 1000) })}
          placeholder="Who it's for, how to progress, what it's good at"
          className="min-h-[88px] text-base"
        />
      </div>
    </div>
  );
}

/** − N + with 40px taps. */
export function Stepper({
  value,
  min,
  max,
  less,
  more,
  onChange,
  size = "md",
}: {
  value: number;
  min: number;
  max: number;
  less: string;
  more: string;
  onChange: (n: number) => void;
  size?: "md" | "lg";
}) {
  const box = size === "lg" ? "h-12 w-12" : "h-10 w-10";
  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="secondary"
        size="icon"
        className={box}
        aria-label={less}
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
      >
        <Minus className="h-4 w-4" />
      </Button>
      <span
        className={cn(
          "text-center font-semibold tabular-nums",
          size === "lg" ? "w-12 text-[22px]" : "w-8 text-[17px]",
        )}
        aria-live="polite"
      >
        {value}
      </span>
      <Button
        type="button"
        variant="secondary"
        size="icon"
        className={box}
        aria-label={more}
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
      >
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  );
}

export function ChoiceRow<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: T; label: string }[];
  value: T | null;
  onChange: (v: T | null) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 text-[15px] font-medium">
        {label} <span className="font-normal text-muted-foreground">(optional)</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <ChoiceChip
            key={o.id}
            selected={value === o.id}
            onClick={() => onChange(value === o.id ? null : o.id)}
          >
            {o.label}
          </ChoiceChip>
        ))}
      </div>
    </div>
  );
}

/** A one-tap answer: filled when it's the one picked. */
export function ChoiceChip({
  selected,
  onClick,
  children,
  className,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "h-10 rounded-full border px-3.5 text-[14px] tabular-nums transition active:scale-[0.97]",
        selected
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-background",
        className,
      )}
    >
      {children}
    </button>
  );
}
