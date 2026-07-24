import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { TimeWindow } from "@/lib/analytics/performance-insights";

const OPTIONS: { value: TimeWindow; label: string }[] = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "block", label: "Block" },
  { value: "year", label: "Year" },
  { value: "all", label: "All" },
];

export function PerformanceTimeFilter({
  value,
  onChange,
}: {
  value: TimeWindow;
  onChange: (v: TimeWindow) => void;
}) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(v) => v && onChange(v as TimeWindow)}
      className="flex flex-wrap gap-1 rounded-full bg-muted p-1"
    >
      {OPTIONS.map((o) => (
        <ToggleGroupItem
          key={o.value}
          value={o.value}
          className="rounded-full px-3 py-1 text-xs font-semibold data-[state=on]:bg-background data-[state=on]:shadow-sm"
        >
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}