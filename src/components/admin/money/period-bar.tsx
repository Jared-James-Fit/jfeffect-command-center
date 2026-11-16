/**
 * The one period control on every money screen: ‹ November 2026 › steps a
 * month (or a quarter, a year, a range) in one tap, the presets sit in a row
 * under it, and the label opens the full picker (a month by name, a custom
 * range, what to compare with). Every figure and chart on the page follows it.
 */
import { useMemo, useState } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  PRESETS, canStepForward, comparisonFor, customPeriod, monthPeriod, periodFor, stepPeriod, yearPeriod,
  type CompareMode, type Period,
} from "@/lib/books/period";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const COMPARE: Array<{ key: CompareMode; label: string }> = [
  { key: "previous", label: "Previous period" },
  { key: "last_year", label: "Same time last year" },
  { key: "none", label: "Off" },
];

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "h-9 shrink-0 rounded-full border px-3.5 text-[13px] transition-colors",
        active ? "border-foreground bg-foreground text-background" : "border-border bg-card text-foreground hover:bg-muted/50",
      )}
    >
      {children}
    </button>
  );
}

export function PeriodBar({ period, compare, today, firstYear, onPeriod, onCompare }: {
  period: Period;
  compare: CompareMode;
  today: string;
  /** The earliest year with anything in the books. */
  firstYear: number;
  onPeriod: (p: Period) => void;
  onCompare: (c: CompareMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pickYear, setPickYear] = useState(Number(period.start.slice(0, 4)));
  const [from, setFrom] = useState(period.start);
  const [to, setTo] = useState(period.end > today ? today : period.end);
  const vs = useMemo(() => comparisonFor(period, compare, today), [period, compare, today]);
  const thisYear = Number(today.slice(0, 4));
  const years = useMemo(() => {
    const out: number[] = [];
    for (let y = thisYear; y >= Math.min(firstYear, thisYear); y--) out.push(y);
    return out;
  }, [firstYear, thisYear]);

  const pick = (p: Period) => {
    onPeriod(p);
    setOpen(false);
  };

  return (
    <div className="space-y-2" data-period-bar>
      <div className="flex items-center gap-1.5">
        <Button variant="outline" size="icon" className="h-10 w-10 shrink-0 rounded-full" aria-label="Previous period" onClick={() => onPeriod(stepPeriod(period, -1, today))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) { setPickYear(Number(period.start.slice(0, 4))); setFrom(period.start); setTo(period.end > today ? today : period.end); } }}>
          <PopoverTrigger asChild>
            <button type="button" className="flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full border border-border bg-card px-3 text-[15px] font-semibold hover:bg-muted/40" data-period-label>
              <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{period.label}</span>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="center" className="w-[min(92vw,360px)] space-y-4 p-4" data-period-picker>
            <div>
              <div className="mb-2 text-[13px] font-medium text-muted-foreground">Quick picks</div>
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((x) => (
                  <Chip key={x.key} active={period.preset === x.key} onClick={() => pick(periodFor(x.key, today))}>{x.label}</Chip>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[13px] font-medium text-muted-foreground">A month</span>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Earlier year" disabled={pickYear <= Math.min(...years)} onClick={() => setPickYear(pickYear - 1)}><ChevronLeft className="h-4 w-4" /></Button>
                  <button type="button" className="min-w-12 text-[14px] font-semibold tabular-nums" onClick={() => pick(yearPeriod(pickYear, today))}>{pickYear}</button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Later year" disabled={pickYear >= thisYear} onClick={() => setPickYear(pickYear + 1)}><ChevronRight className="h-4 w-4" /></Button>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {MON.map((m, i) => {
                  const ym = `${pickYear}-${String(i + 1).padStart(2, "0")}`;
                  const future = ym > today.slice(0, 7);
                  const active = period.unit === "month" && period.start.slice(0, 7) === ym;
                  return (
                    <button
                      key={m}
                      type="button"
                      disabled={future}
                      onClick={() => pick(monthPeriod(ym, today))}
                      className={cn(
                        "h-10 rounded-lg border text-[14px] transition-colors disabled:opacity-35",
                        active ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted/50",
                      )}
                    >
                      {m}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <div className="mb-2 text-[13px] font-medium text-muted-foreground">Custom dates</div>
              <div className="grid grid-cols-2 gap-2">
                <DateField value={from} onChange={setFrom} max={today} aria-label="From" className="h-10" />
                <DateField value={to} onChange={setTo} max={today} min={from} aria-label="To" className="h-10" />
              </div>
              <Button variant="outline" className="mt-2 h-10 w-full" disabled={!from || !to} onClick={() => pick(customPeriod(from, to, today))}>Show these dates</Button>
            </div>
            <div>
              <div className="mb-2 text-[13px] font-medium text-muted-foreground">Compare with</div>
              <div className="grid grid-cols-3 gap-1.5">
                {COMPARE.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => onCompare(c.key)}
                    aria-pressed={compare === c.key}
                    className={cn("min-h-10 rounded-lg border px-2 text-[12px] leading-tight", compare === c.key ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted/50")}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          </PopoverContent>
        </Popover>
        <Button variant="outline" size="icon" className="h-10 w-10 shrink-0 rounded-full" aria-label="Next period" disabled={!canStepForward(period, today)} onClick={() => onPeriod(stepPeriod(period, 1, today))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] sm:mx-0 sm:px-0 lg:flex-wrap lg:overflow-visible [&::-webkit-scrollbar]:hidden" data-period-presets>
        {PRESETS.map((x) => (
          <Chip key={x.key} active={period.preset === x.key} onClick={() => onPeriod(periodFor(x.key, today))}>{x.label}</Chip>
        ))}
      </div>
      {vs ? (
        <p className="text-center text-[12px] text-muted-foreground sm:text-left" data-period-vs>
          Compared with {vs.label}{period.end > today && period.start <= today ? ", the same number of days" : ""}
        </p>
      ) : null}
    </div>
  );
}
