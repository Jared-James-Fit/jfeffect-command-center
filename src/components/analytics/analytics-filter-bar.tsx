import { useMemo, useState } from "react";
import { format, subDays, parseISO } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type AnalyticsBlock = {
  id: string;
  name: string;
  status: string | null;
  start_date: string | null;
  end_date: string | null;
};

export type AnalyticsFilter =
  | { preset: "current_block"; blockId: string; start: Date; end: Date; label: string }
  | { preset: "previous_block"; blockId: string; start: Date; end: Date; label: string }
  | { preset: "last_4w" | "last_8w" | "last_12w" | "lifetime"; start: Date; end: Date; label: string }
  | { preset: "custom"; start: Date; end: Date; label: string };

function orderedBlocks(blocks: AnalyticsBlock[]): AnalyticsBlock[] {
  return [...blocks]
    .filter((b) => b.start_date)
    .sort((a, b) => (b.start_date ?? "").localeCompare(a.start_date ?? ""));
}

function activeBlock(blocks: AnalyticsBlock[]): AnalyticsBlock | null {
  return blocks.find((b) => (b.status ?? "").toLowerCase() === "active") ?? null;
}

function previousBlock(blocks: AnalyticsBlock[]): AnalyticsBlock | null {
  const sorted = orderedBlocks(blocks);
  const activeIdx = sorted.findIndex((b) => (b.status ?? "").toLowerCase() === "active");
  if (activeIdx >= 0 && sorted[activeIdx + 1]) return sorted[activeIdx + 1];
  // fallback: most recent block whose end_date is in the past
  const today = new Date().toISOString().slice(0, 10);
  return sorted.find((b) => (b.end_date ?? "") < today) ?? null;
}

function blockRange(b: AnalyticsBlock): { start: Date; end: Date } {
  const start = b.start_date ? parseISO(b.start_date) : subDays(new Date(), 28);
  const end = b.end_date ? parseISO(b.end_date) : new Date();
  return { start, end };
}

/** Compute default filter given blocks. */
export function defaultAnalyticsFilter(blocks: AnalyticsBlock[]): AnalyticsFilter {
  const active = activeBlock(blocks);
  if (active) {
    const { start, end } = blockRange(active);
    return {
      preset: "current_block",
      blockId: active.id,
      start,
      end,
      label: `Current Block · ${format(start, "MMM d")}–${format(end, "MMM d")}`,
    };
  }
  const end = new Date();
  const start = subDays(end, 56);
  return { preset: "last_8w", start, end, label: `Last 8W · ${format(start, "MMM d")}–${format(end, "MMM d")}` };
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
  return { preset: "lifetime", start, end, label: `Lifetime · ${format(start, "MMM d, yyyy")}–${format(end, "MMM d, yyyy")}` };
}

interface Props {
  blocks: AnalyticsBlock[];
  value: AnalyticsFilter;
  onChange: (f: AnalyticsFilter) => void;
}

export function AnalyticsFilterBar({ blocks, value, onChange }: Props) {
  const active = useMemo(() => activeBlock(blocks), [blocks]);
  const prev = useMemo(() => previousBlock(blocks), [blocks]);
  const [customOpen, setCustomOpen] = useState(value.preset === "custom");
  const [customStart, setCustomStart] = useState<string>(format(value.start, "yyyy-MM-dd"));
  const [customEnd, setCustomEnd] = useState<string>(format(value.end, "yyyy-MM-dd"));

  const chips: { key: AnalyticsFilter["preset"]; label: string; disabled?: boolean; onSelect: () => void }[] = [
    {
      key: "current_block",
      label: "Current Block",
      disabled: !active,
      onSelect: () => {
        if (!active) return;
        const { start, end } = blockRange(active);
        onChange({
          preset: "current_block",
          blockId: active.id,
          start,
          end,
          label: `Current Block · ${format(start, "MMM d")}–${format(end, "MMM d")}`,
        });
        setCustomOpen(false);
      },
    },
    {
      key: "previous_block",
      label: "Previous Block",
      disabled: !prev,
      onSelect: () => {
        if (!prev) return;
        const { start, end } = blockRange(prev);
        onChange({
          preset: "previous_block",
          blockId: prev.id,
          start,
          end,
          label: `Previous Block · ${format(start, "MMM d")}–${format(end, "MMM d")}`,
        });
        setCustomOpen(false);
      },
    },
    { key: "last_4w", label: "Last 4W", onSelect: () => { onChange(lastNWeeks(4)); setCustomOpen(false); } },
    { key: "last_8w", label: "Last 8W", onSelect: () => { onChange(lastNWeeks(8)); setCustomOpen(false); } },
    { key: "last_12w", label: "Last 12W", onSelect: () => { onChange(lastNWeeks(12)); setCustomOpen(false); } },
    { key: "custom", label: "Custom", onSelect: () => setCustomOpen(true) },
    { key: "lifetime", label: "Lifetime", onSelect: () => { onChange(lifetimeFilter(blocks)); setCustomOpen(false); } },
  ];

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
      {customOpen && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-card p-3">
          <label className="text-xs font-semibold text-muted-foreground">
            Start
            <Input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="mt-1 h-8 w-40" />
          </label>
          <label className="text-xs font-semibold text-muted-foreground">
            End
            <Input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="mt-1 h-8 w-40" />
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
      <div className="text-xs font-semibold text-muted-foreground">{value.label}</div>
    </div>
  );
}