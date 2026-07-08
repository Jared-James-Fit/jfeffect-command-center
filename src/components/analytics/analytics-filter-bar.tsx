import { useMemo, useState } from "react";
import { format, parseISO, subDays } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CalendarSearch, Layers, RotateCcw } from "lucide-react";
import {
  type AnalyticsBlock as SharedAnalyticsBlock,
  parseLocalDate,
  resolveCurrentBlock,
  resolvePreviousBlock,
} from "@/lib/analytics/blocks";

/** Re-export so existing consumers keep importing from this module. */
export type AnalyticsBlock = SharedAnalyticsBlock;

export type AnalyticsFilter =
  | { preset: "current_block"; blockId: string; start: Date; end: Date; label: string }
  | { preset: "previous_block"; blockId: string; start: Date; end: Date; label: string }
  | {
      preset: "exact_block";
      blockId: string;
      start: Date | null;
      end: Date | null;
      label: string;
    }
  | { preset: "last_4w" | "last_8w" | "last_12w" | "lifetime"; start: Date; end: Date; label: string }
  | { preset: "custom"; start: Date; end: Date; label: string };

function blockRange(b: AnalyticsBlock): { start: Date; end: Date } {
  const start = parseLocalDate(b.start_date) ?? subDays(new Date(), 28);
  const end = parseLocalDate(b.end_date) ?? new Date();
  return { start, end };
}

function blockRangeMaybe(b: AnalyticsBlock): { start: Date | null; end: Date | null } {
  return { start: parseLocalDate(b.start_date), end: parseLocalDate(b.end_date) };
}

function currentBlockFilter(b: AnalyticsBlock): AnalyticsFilter {
  const { start, end } = blockRange(b);
  return {
    preset: "current_block",
    blockId: b.id,
    start,
    end,
    label: `Current Block · ${format(start, "MMM d")}–${format(end, "MMM d")}`,
  };
}

function previousBlockFilter(b: AnalyticsBlock): AnalyticsFilter {
  const { start, end } = blockRange(b);
  return {
    preset: "previous_block",
    blockId: b.id,
    start,
    end,
    label: `Previous Block · ${format(start, "MMM d")}–${format(end, "MMM d")}`,
  };
}

export function exactBlockFilter(b: AnalyticsBlock): AnalyticsFilter {
  const { start, end } = blockRangeMaybe(b);
  const dateLabel =
    start && end
      ? `${format(start, "MMM d")}–${format(end, "MMM d, yyyy")}`
      : start
        ? `from ${format(start, "MMM d, yyyy")}`
        : "Not scheduled";
  return {
    preset: "exact_block",
    blockId: b.id,
    start,
    end,
    label: `${b.name} · ${dateLabel}`,
  };
}

/** Default filter given the block set. */
export function defaultAnalyticsFilter(blocks: AnalyticsBlock[]): AnalyticsFilter {
  const current = resolveCurrentBlock(blocks);
  if (current) return currentBlockFilter(current);
  const end = new Date();
  const start = subDays(end, 56);
  return {
    preset: "last_8w",
    start,
    end,
    label: `Last 8W · ${format(start, "MMM d")}–${format(end, "MMM d")}`,
  };
}

function lastNWeeks(n: number): AnalyticsFilter {
  const end = new Date();
  const start = subDays(end, n * 7);
  const key = (`last_${n}w`) as "last_4w" | "last_8w" | "last_12w";
  return {
    preset: key,
    start,
    end,
    label: `Last ${n}W · ${format(start, "MMM d")}–${format(end, "MMM d")}`,
  };
}

function lifetimeFilter(blocks: AnalyticsBlock[]): AnalyticsFilter {
  const earliest = blocks
    .map((b) => b.start_date)
    .filter((s): s is string => !!s)
    .sort()[0];
  const start = earliest ? parseISO(earliest) : subDays(new Date(), 365);
  const end = new Date();
  return {
    preset: "lifetime",
    start,
    end,
    label: `Lifetime · ${format(start, "MMM d, yyyy")}–${format(end, "MMM d, yyyy")}`,
  };
}

interface Props {
  blocks: AnalyticsBlock[];
  value: AnalyticsFilter;
  onChange: (f: AnalyticsFilter) => void;
  /** ID of the block currently being viewed (may be historical). */
  selectedBlockId?: string | null;
  /** ID of the resolved *actual* current block, independent of what's selected. */
  resolvedCurrentBlockId?: string | null;
  /** Called when the user taps "Browse Blocks". */
  onOpenPicker?: () => void;
}

export function AnalyticsFilterBar({
  blocks,
  value,
  onChange,
  selectedBlockId,
  resolvedCurrentBlockId,
  onOpenPicker,
}: Props) {
  const current = useMemo(() => resolveCurrentBlock(blocks), [blocks]);
  const prev = useMemo(() => resolvePreviousBlock(blocks, current), [blocks, current]);
  const [customOpen, setCustomOpen] = useState(value.preset === "custom");
  const [customStart, setCustomStart] = useState<string>(
    format(value.start ?? new Date(), "yyyy-MM-dd"),
  );
  const [customEnd, setCustomEnd] = useState<string>(
    format(value.end ?? new Date(), "yyyy-MM-dd"),
  );

  const selectedBlock = useMemo(
    () => blocks.find((b) => b.id === (selectedBlockId ?? "")) ?? null,
    [blocks, selectedBlockId],
  );
  const isViewingHistorical =
    value.preset === "exact_block" &&
    !!resolvedCurrentBlockId &&
    selectedBlockId !== resolvedCurrentBlockId;

  const chips: {
    key: AnalyticsFilter["preset"];
    label: string;
    disabled?: boolean;
    disabledHint?: string;
    onSelect: () => void;
  }[] = [
    {
      key: "current_block",
      label: "Current Block",
      disabled: !current,
      onSelect: () => {
        if (!current) return;
        onChange(currentBlockFilter(current));
        setCustomOpen(false);
      },
    },
    {
      key: "previous_block",
      label: "Previous Block",
      disabled: !prev,
      disabledHint: prev ? undefined : "No previous block is available.",
      onSelect: () => {
        if (!prev) return;
        onChange(previousBlockFilter(prev));
        setCustomOpen(false);
      },
    },
    {
      key: "last_4w",
      label: "Last 4W",
      onSelect: () => {
        onChange(lastNWeeks(4));
        setCustomOpen(false);
      },
    },
    {
      key: "last_8w",
      label: "Last 8W",
      onSelect: () => {
        onChange(lastNWeeks(8));
        setCustomOpen(false);
      },
    },
    {
      key: "last_12w",
      label: "Last 12W",
      onSelect: () => {
        onChange(lastNWeeks(12));
        setCustomOpen(false);
      },
    },
    { key: "custom", label: "Custom", onSelect: () => setCustomOpen(true) },
    {
      key: "lifetime",
      label: "Lifetime",
      onSelect: () => {
        onChange(lifetimeFilter(blocks));
        setCustomOpen(false);
      },
    },
  ];

  const returnToCurrent = () => {
    if (!current) return;
    onChange(currentBlockFilter(current));
    setCustomOpen(false);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {chips.map((c) => {
          const activeChip = value.preset === c.key;
          return (
            <button
              key={c.key}
              type="button"
              onClick={c.onSelect}
              disabled={c.disabled}
              title={c.disabledHint}
              className={[
                "h-8 rounded-full border px-3 text-xs font-semibold transition-colors",
                activeChip
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
                c.disabled ? "opacity-40 cursor-not-allowed" : "",
              ].join(" ")}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      {/* Browse Blocks — mandatory obvious action */}
      {onOpenPicker && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onOpenPicker}
            className="h-9 gap-1.5 w-full sm:w-auto"
          >
            <Layers className="h-4 w-4" />
            {value.preset === "lifetime" ? "Browse history by block" : "Browse Blocks"}
          </Button>
          {isViewingHistorical && current && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={returnToCurrent}
              className="h-9 gap-1.5 text-primary"
            >
              <RotateCcw className="h-4 w-4" />
              Return to Current Block
            </Button>
          )}
        </div>
      )}

      {customOpen && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-card p-3">
          <label className="text-xs font-semibold text-muted-foreground">
            Start
            <Input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="mt-1 h-8 w-40"
            />
          </label>
          <label className="text-xs font-semibold text-muted-foreground">
            End
            <Input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="mt-1 h-8 w-40"
            />
          </label>
          <Button
            size="sm"
            onClick={() => {
              const start = parseISO(customStart);
              const end = parseISO(customEnd);
              if (isNaN(start.getTime()) || isNaN(end.getTime())) return;
              onChange({
                preset: "custom",
                start,
                end,
                label: `Custom · ${format(start, "MMM d")}–${format(end, "MMM d")}`,
              });
            }}
          >
            Apply
          </Button>
        </div>
      )}

      {/* Selected-block summary line (Change button opens picker). */}
      {value.preset === "exact_block" && selectedBlock ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2">
          <div className="min-w-0 text-xs">
            <div className="truncate text-sm font-bold text-foreground">
              {selectedBlock.name}
            </div>
            <div className="truncate text-muted-foreground">
              {selectedBlock.start_date
                ? `${format(parseLocalDate(selectedBlock.start_date)!, "MMM d, yyyy")}${
                    selectedBlock.end_date
                      ? ` – ${format(parseLocalDate(selectedBlock.end_date)!, "MMM d, yyyy")}`
                      : ""
                  }`
                : "Not scheduled"}
              {" · "}
              {selectedBlock.id === resolvedCurrentBlockId
                ? "Current"
                : selectedBlock.status ?? "Block"}
            </div>
          </div>
          {onOpenPicker && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onOpenPicker}
              className="h-8 gap-1.5"
            >
              <CalendarSearch className="h-3.5 w-3.5" /> Change
            </Button>
          )}
        </div>
      ) : (
        <div className="text-xs font-semibold text-muted-foreground">{value.label}</div>
      )}
    </div>
  );
}