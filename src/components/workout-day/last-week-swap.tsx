import { ArrowLeftRight } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { displayLoadInUnit } from "@/lib/workout-unit-persistence";
import { resolveLoadType } from "@/lib/workout-load-type";

/** A logged set from last week (the pl_row_results columns the chip reads). */
export type LastWeekSet = {
  id?: string;
  set_index?: number | null;
  entered_value?: number | string | null;
  entered_unit?: string | null;
  actual_load?: number | string | null;
  actual_load_unit?: string | null;
  normalized_kg?: number | string | null;
  normalized_lb?: number | string | null;
  actual_reps?: number | null;
  actual_rpe?: string | null;
  actual_rpe_num?: number | null;
  load_type?: string | null;
  is_bodyweight?: boolean | null;
};

/** Last week's logged sets in this card's slot, when it held a different exercise. */
export type LastWeekSwap = {
  name: string;
  /** Completed sets, any order. */
  sets: LastWeekSet[];
};

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10));

export function lastWeekSetLine(r: LastWeekSet, unit: "kg" | "lb"): string {
  const type = resolveLoadType(r.load_type, r.is_bodyweight);
  const load = displayLoadInUnit(r as Parameters<typeof displayLoadInUnit>[0], unit);
  const weight =
    type === "bodyweight" ? "BW"
      : load == null ? "—"
      : type === "assisted" ? `${fmt(load)} ${unit} assist`
      : `${fmt(load)} ${unit}`;
  const reps = r.actual_reps != null ? ` × ${r.actual_reps}` : "";
  const rpe = r.actual_rpe_num ?? r.actual_rpe;
  return `${weight}${reps}${rpe != null && rpe !== "" ? ` @ ${rpe}` : ""}`;
}

/**
 * A small pill in the card's badge row: "⇄ Last wk: Seated Cable Row". Tap for
 * last week's sets in this slot. Only shown when the slot held a different
 * exercise last week and it was logged (see previous-week-slot.ts).
 */
export function LastWeekSwapChip({ swap, unit }: { swap: LastWeekSwap; unit: "kg" | "lb" }) {
  const sets = [...swap.sets].sort((a, b) => Number(a.set_index) - Number(b.set_index));
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="last-week-swap"
          aria-label={`Last week this slot was ${swap.name}. Show what you did`}
          className="inline-flex h-5 min-w-0 max-w-[13rem] items-center gap-1 rounded-full border border-violet-500/35 bg-violet-500/10 px-1.5 text-[11px] font-semibold text-violet-700 transition active:scale-[0.97] dark:text-violet-300"
        >
          <ArrowLeftRight className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="shrink-0">Last wk:</span>
          <span className="truncate">{swap.name}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-64 p-3 text-xs">
        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Last week in this slot</div>
        <div className="mt-0.5 text-sm font-bold leading-tight text-foreground">{swap.name}</div>
        <ol className="mt-1.5 space-y-0.5" data-testid="last-week-swap-sets">
          {sets.map((r, i) => (
            <li key={r.id ?? i} className="flex gap-2 tabular-nums">
              <span className="w-4 text-right text-muted-foreground">{i + 1}</span>
              <span className="font-semibold text-foreground">{lastWeekSetLine(r, unit)}</span>
            </li>
          ))}
        </ol>
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
          This week's card has a different exercise (swapped or changed in the program).
        </p>
      </PopoverContent>
    </Popover>
  );
}
