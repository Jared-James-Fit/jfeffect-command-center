import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const RPE_ROWS: Array<[string, string]> = [
  ["10", "Max — nothing left"],
  ["9", "1 more rep in the tank"],
  ["8", "2 more reps"],
  ["7", "3 more reps — moving well"],
  ["6", "4+ more — fast and easy"],
];

/**
 * The RPE/RIR column header: label + a tiny info button explaining the scale
 * and how filling works. Kept to one glance — this is a logger, not a lesson.
 */
export function EffortScaleHeader({ rir }: { rir: boolean }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {rir ? "RIR" : "RPE"}
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" aria-label={rir ? "What is RIR?" : "What is RPE?"} className="-m-1 inline-flex h-6 w-6 items-center justify-center rounded-full normal-case tracking-normal hover:bg-foreground/10">
            <Info className="h-3 w-3" />
          </button>
        </PopoverTrigger>
        <PopoverContent side="bottom" className="w-64 text-xs normal-case tracking-normal">
          <p className="font-semibold text-foreground">{rir ? "RIR = reps in reserve" : "RPE = how hard the set was"}</p>
          <table className="mt-1.5 w-full text-muted-foreground">
            <tbody>
              {RPE_ROWS.map(([rpe, meaning]) => (
                <tr key={rpe}>
                  <td className="w-8 py-0.5 font-bold tabular-nums text-foreground">{rir ? String(10 - Number(rpe)) : rpe}</td>
                  <td className="py-0.5">{meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1.5 text-muted-foreground">Halves are fine ({rir ? "1.5" : "8.5"}). Be honest — it sets your next suggestion.</p>
          <p className="mt-1 text-muted-foreground"><span className="font-semibold text-foreground">Tap any box to type.</span> Change set 1 and the sets below follow, unless you changed them yourself.</p>
        </PopoverContent>
      </Popover>
    </span>
  );
}
