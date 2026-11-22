import { useMemo, useState } from "react";
import { format, parseISO, subDays } from "date-fns";
import { Check, ChevronDown, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  type AnalyticsBlock as SharedAnalyticsBlock,
  parseLocalDate,
  resolveCurrentBlock,
  resolvePreviousBlock,
} from "@/lib/analytics/blocks";

/** Re-export so existing consumers keep importing from this module. */
export type AnalyticsBlock = SharedAnalyticsBlock;

type Said = {
  /** what the period is, in a word or two ("This block", "12 weeks") */
  short: string;
  /** its dates ("Nov 15 – Dec 12") */
  range: string;
  /** both, for older readers ("This block · Nov 15 – Dec 12") */
  label: string;
};

export type AnalyticsFilter =
  | ({ preset: "current_block"; blockId: string; start: Date; end: Date } & Said)
  | ({ preset: "previous_block"; blockId: string; start: Date; end: Date } & Said)
  | ({
      preset: "exact_block";
      blockId: string;
      /** For undated blocks these fall back to lifetime bounds — blockId is the authoritative boundary. */
      start: Date;
      end: Date;
      /** True when the underlying block has real start/end dates. */
      hasBlockDates: boolean;
    } & Said)
  | ({ preset: "last_4w" | "last_8w" | "last_12w" | "last_26w" | "last_52w" | "lifetime"; start: Date; end: Date } & Said)
  | ({ preset: "custom"; start: Date; end: Date } & Said);

export type PeriodPreset = AnalyticsFilter["preset"];

/** "Nov 15 – Dec 12", with the year only when it isn't this year or the range crosses one. */
export function rangeWords(start: Date, end: Date): string {
  const now = new Date().getFullYear();
  const sy = start.getFullYear();
  const ey = end.getFullYear();
  if (sy === ey) return sy === now ? `${format(start, "MMM d")} – ${format(end, "MMM d")}` : `${format(start, "MMM d")} – ${format(end, "MMM d, yyyy")}`;
  return `${format(start, "MMM d, yyyy")} – ${format(end, "MMM d, yyyy")}`;
}

function said(short: string, start: Date, end: Date, range = rangeWords(start, end)): Said {
  return { short, range, label: `${short} · ${range}` };
}

function blockRange(b: AnalyticsBlock): { start: Date; end: Date } {
  const start = parseLocalDate(b.start_date) ?? subDays(new Date(), 28);
  const end = parseLocalDate(b.end_date) ?? new Date();
  return { start, end };
}

function lifetimeBounds(blocks: AnalyticsBlock[]): { start: Date; end: Date } {
  const earliest = blocks
    .map((b) => b.start_date)
    .filter((s): s is string => !!s)
    .sort()[0];
  return {
    start: earliest ? parseISO(earliest) : subDays(new Date(), 365),
    end: new Date(),
  };
}

function currentBlockFilter(b: AnalyticsBlock): AnalyticsFilter {
  const { start, end } = blockRange(b);
  return { preset: "current_block", blockId: b.id, start, end, ...said("This block", start, end) };
}

function previousBlockFilter(b: AnalyticsBlock): AnalyticsFilter {
  const { start, end } = blockRange(b);
  return { preset: "previous_block", blockId: b.id, start, end, ...said("Last block", start, end) };
}

export function exactBlockFilter(b: AnalyticsBlock, allBlocks: AnalyticsBlock[]): AnalyticsFilter {
  const start = parseLocalDate(b.start_date);
  const end = parseLocalDate(b.end_date);
  const hasBlockDates = !!start;
  const range = start && end ? rangeWords(start, end) : start ? `from ${format(start, "MMM d, yyyy")}` : "Not scheduled";
  // Undated blocks use lifetime bounds for chart display only; blockId stays
  // the data boundary (downstream reads key off `hasBlockDates`).
  const fallback = lifetimeBounds(allBlocks);
  const name = (b.name ?? "").trim() || "Block";
  return {
    preset: "exact_block",
    blockId: b.id,
    start: start ?? fallback.start,
    end: end ?? fallback.end,
    hasBlockDates,
    short: name,
    range,
    label: `${name} · ${range}`,
  };
}

/** Default filter given the block set. */
export function defaultAnalyticsFilter(blocks: AnalyticsBlock[]): AnalyticsFilter {
  const current = resolveCurrentBlock(blocks);
  if (current) return currentBlockFilter(current);
  return lastNWeeks(12);
}

const WEEK_PRESETS = { 4: "last_4w", 8: "last_8w", 12: "last_12w", 26: "last_26w", 52: "last_52w" } as const;
const WEEK_WORDS: Record<keyof typeof WEEK_PRESETS, string> = { 4: "4 weeks", 8: "8 weeks", 12: "12 weeks", 26: "6 months", 52: "1 year" };

/** "since Aug 31" / "since Nov 23, 2025": a period that runs to today. */
function sinceWords(start: Date): string {
  return `since ${format(start, start.getFullYear() === new Date().getFullYear() ? "MMM d" : "MMM yyyy")}`;
}

export function lastNWeeks(n: keyof typeof WEEK_PRESETS): AnalyticsFilter {
  const end = new Date();
  const start = subDays(end, n * 7);
  return { preset: WEEK_PRESETS[n], start, end, ...said(WEEK_WORDS[n], start, end, sinceWords(start)) };
}

export function lifetimeFilter(blocks: AnalyticsBlock[], firstDataDate?: Date | null): AnalyticsFilter {
  const b = lifetimeBounds(blocks).start;
  const start = firstDataDate && firstDataDate < b ? firstDataDate : b;
  const end = new Date();
  return { preset: "lifetime", start, end, ...said("All time", start, end, `since ${format(start, "MMM yyyy")}`) };
}

export function customFilter(start: Date, end: Date): AnalyticsFilter {
  return { preset: "custom", start, end, ...said("Custom", start, end) };
}

/** Days the period covers (the strength chart's resolution reads it). */
export function periodDays(f: Pick<AnalyticsFilter, "start" | "end">): number {
  return Math.max(1, Math.round((f.end.getTime() - f.start.getTime()) / 86_400_000));
}

/**
 * The page's one period control: a button that says what's shown ("This
 * block · Nov 15 – Dec 12") and opens one sheet with every choice, including
 * a block by name. Replaces two rows of chips, a full-width "Browse Blocks"
 * button and a line that repeated the selection.
 */
export function AnalyticsPeriodControl({
  blocks,
  value,
  onChange,
  onOpenBlocks,
  firstDataDate,
  className,
}: {
  blocks: AnalyticsBlock[];
  value: AnalyticsFilter;
  onChange: (f: AnalyticsFilter) => void;
  /** Opens the block picker (search, years). */
  onOpenBlocks?: () => void;
  /** The first logged set: "All time" starts there when it's before any block. */
  firstDataDate?: Date | null;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = useMemo(() => resolveCurrentBlock(blocks), [blocks]);
  const prev = useMemo(() => resolvePreviousBlock(blocks, current), [blocks, current]);
  const [customOpen, setCustomOpen] = useState(false);
  const [customStart, setCustomStart] = useState(() => format(value.start ?? new Date(), "yyyy-MM-dd"));
  const [customEnd, setCustomEnd] = useState(() => format(value.end ?? new Date(), "yyyy-MM-dd"));

  const pick = (f: AnalyticsFilter) => {
    onChange(f);
    setOpen(false);
    setCustomOpen(false);
  };

  const options: Array<{ key: PeriodPreset; short: string; range?: string; build: () => AnalyticsFilter; disabled?: boolean }> = [];
  if (current) options.push({ key: "current_block", short: "This block", range: rangeWords(blockRange(current).start, blockRange(current).end), build: () => currentBlockFilter(current) });
  if (prev) options.push({ key: "previous_block", short: "Last block", range: rangeWords(blockRange(prev).start, blockRange(prev).end), build: () => previousBlockFilter(prev) });
  options.push(
    { key: "last_4w", short: "4 weeks", build: () => lastNWeeks(4) },
    { key: "last_12w", short: "12 weeks", build: () => lastNWeeks(12) },
    { key: "last_26w", short: "6 months", build: () => lastNWeeks(26) },
    { key: "last_52w", short: "1 year", build: () => lastNWeeks(52) },
    { key: "lifetime", short: "All time", build: () => lifetimeFilter(blocks, firstDataDate) },
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex h-10 min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-left transition hover:bg-muted/50 active:scale-[0.99]",
          className,
        )}
        aria-haspopup="dialog"
        aria-label={`Period: ${value.label}. Change`}
        data-analytics-period
      >
        <span className="shrink-0 text-[14px] font-semibold text-foreground">{value.short}</span>
        <span className="min-w-0 truncate text-[13px] text-muted-foreground">{value.range}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>

      <Sheet open={open} onOpenChange={(o) => { setOpen(o); if (!o) setCustomOpen(false); }}>
        <SheetContent side="bottom" swipeToClose className="max-h-[88dvh] overflow-y-auto rounded-t-2xl p-0">
          <div className="mx-auto max-w-lg px-4 pb-6 pt-3">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted-foreground/30" aria-hidden />
            <SheetHeader className="text-left">
              <SheetTitle className="text-lg">Period</SheetTitle>
              <SheetDescription className="sr-only">What every chart and number on this page covers</SheetDescription>
            </SheetHeader>
            <ul className="mt-2 divide-y divide-border/60" role="listbox" aria-label="Periods">
              {options.map((o) => {
                const on = value.preset === o.key;
                return (
                  <li key={o.key}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={on}
                      onClick={() => pick(o.build())}
                      className="flex min-h-12 w-full items-center gap-3 px-1 text-left"
                      data-period-option={o.key}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-medium text-foreground">{o.short}</span>
                        {o.range && <span className="block truncate text-[12px] text-muted-foreground">{o.range}</span>}
                      </span>
                      {on && <Check className="h-4 w-4 shrink-0 text-foreground" aria-hidden />}
                    </button>
                  </li>
                );
              })}
              <li>
                <button
                  type="button"
                  aria-expanded={customOpen}
                  onClick={() => setCustomOpen((v) => !v)}
                  className="flex min-h-12 w-full items-center gap-3 px-1 text-left"
                  data-period-option="custom"
                >
                  <span className="min-w-0 flex-1 text-[15px] font-medium text-foreground">Custom dates</span>
                  {value.preset === "custom" && <Check className="h-4 w-4 shrink-0 text-foreground" aria-hidden />}
                </button>
                {customOpen && (
                  <div className="flex flex-wrap items-end gap-2 px-1 pb-3">
                    <label className="text-xs font-medium text-muted-foreground">
                      From
                      <Input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="mt-1 h-10 w-40" />
                    </label>
                    <label className="text-xs font-medium text-muted-foreground">
                      To
                      <Input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="mt-1 h-10 w-40" />
                    </label>
                    <Button
                      className="h-10"
                      onClick={() => {
                        const s = parseISO(customStart);
                        const e = parseISO(customEnd);
                        if (isNaN(s.getTime()) || isNaN(e.getTime())) return;
                        pick(customFilter(s <= e ? s : e, s <= e ? e : s));
                      }}
                    >
                      Show
                    </Button>
                  </div>
                )}
              </li>
              {onOpenBlocks && blocks.length > 0 && (
                <li>
                  <button
                    type="button"
                    onClick={() => { setOpen(false); onOpenBlocks(); }}
                    className="flex min-h-12 w-full items-center gap-3 px-1 text-left"
                    data-period-option="block"
                  >
                    <Layers className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-medium text-foreground">A block…</span>
                      <span className="block text-[12px] text-muted-foreground">{blocks.length} on file</span>
                    </span>
                    {value.preset === "exact_block" && <Check className="h-4 w-4 shrink-0 text-foreground" aria-hidden />}
                  </button>
                </li>
              )}
            </ul>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

/** The period as the page's address keeps it (`?filter=` / `?blockId=`), so Back and links land on it. */
export function searchFromFilter(f: AnalyticsFilter): { filter: string; blockId: string } {
  if (f.preset === "exact_block") return { filter: "exact_block", blockId: f.blockId };
  if (f.preset === "current_block" || f.preset === "custom") return { filter: "", blockId: "" };
  return { filter: f.preset, blockId: "" };
}

/** The period an address asks for, else the default (this block, or 12 weeks). */
export function filterFromSearch(filter: string, blockId: string, blocks: AnalyticsBlock[]): AnalyticsFilter {
  if (filter === "exact_block" && blockId) {
    const b = blocks.find((x) => x.id === blockId);
    if (b) return exactBlockFilter(b, blocks);
  }
  if (filter === "previous_block") {
    const prev = resolvePreviousBlock(blocks, resolveCurrentBlock(blocks));
    if (prev) return previousBlockFilter(prev);
  }
  if (filter === "last_4w") return lastNWeeks(4);
  if (filter === "last_8w") return lastNWeeks(8);
  if (filter === "last_12w") return lastNWeeks(12);
  if (filter === "last_26w") return lastNWeeks(26);
  if (filter === "last_52w") return lastNWeeks(52);
  if (filter === "lifetime") return lifetimeFilter(blocks);
  return defaultAnalyticsFilter(blocks);
}
