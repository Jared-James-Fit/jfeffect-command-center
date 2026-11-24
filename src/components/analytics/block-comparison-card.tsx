/**
 * Training blocks compared (block-comparison.ts): one row per block, its
 * type's colour and name (the builder's own), and bars for the metric picked.
 * Strength is each lift's change across the block (bars either side of zero);
 * volume, intensity and adherence one bar each. Opens on blocks of the same
 * kind as the latest one, so a peak is compared with a peak; a lighter block
 * says its lower workload was planned.
 */
import { useMemo, useState } from "react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { parseLocalDate } from "@/lib/today";
import { BLOCK_COLOR_CLASS } from "@/lib/block-types";
import { COMP_LIFTS, COMP_LIFT_LABEL } from "@/lib/analytics/competition-strength";
import {
  BLOCK_METRICS,
  defaultBlockType,
  type BlockMetric,
  type BlockRow,
} from "@/lib/analytics/block-comparison";
import { ChipRow, Segmented, LIFT_SERIES } from "@/components/analytics/viz";

const fmt = (d: string) => {
  const x = parseLocalDate(d);
  return x ? format(x, x.getFullYear() === new Date().getFullYear() ? "MMM d" : "MMM d, yyyy") : d;
};

export function BlockComparisonCard({
  rows,
  powerlifter,
}: {
  rows: BlockRow[];
  powerlifter: boolean;
}) {
  const [metric, setMetric] = useState<BlockMetric>(powerlifter ? "strength" : "volume");
  const types = useMemo(() => {
    const m = new Map<string, { name: string; n: number }>();
    for (const r of rows)
      if (r.typeKey) m.set(r.typeKey, { name: r.typeName, n: (m.get(r.typeKey)?.n ?? 0) + 1 });
    return [...m.entries()];
  }, [rows]);
  const [type, setType] = useState<string | null | undefined>(undefined);
  const shownType = type === undefined ? defaultBlockType(rows) : type;
  const [open, setOpen] = useState<string | null>(null);
  if (rows.length < 2) return null;
  const shown = (shownType ? rows.filter((r) => r.typeKey === shownType) : rows)
    .slice(-8)
    .reverse();
  const metrics = BLOCK_METRICS.filter((m) => m.key !== "strength" || powerlifter);
  const maxVol = Math.max(1, ...shown.map((r) => r.setsPerWeek ?? 0));
  const maxAbs = Math.max(
    2,
    ...shown.flatMap((r) => COMP_LIFTS.map((l) => Math.abs(r.strengthPct[l] ?? 0))),
  );

  return (
    <div data-block-comparison data-block-metric={metric}>
      <Segmented
        value={metric}
        options={metrics}
        onChange={setMetric}
        label="Compare blocks by"
        size="sm"
      />
      {types.length > 1 && (
        <ChipRow
          value={(shownType ?? "all") as string}
          onChange={(v) => setType(v === "all" ? null : v)}
          label="Block type"
          className="mt-2"
          options={[
            { key: "all", label: "All blocks" },
            ...types.map(([k, v]) => ({ key: k, label: `${v.name} (${v.n})` })),
          ]}
        />
      )}
      <ul className="mt-3 space-y-1" aria-label="Blocks">
        {shown.map((r) => {
          const c = BLOCK_COLOR_CLASS[r.color];
          const isOpen = open === r.id;
          return (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : r.id)}
                aria-expanded={isOpen}
                className="w-full rounded-lg px-1 py-2 text-left transition hover:bg-muted/40"
                data-block-row={r.id}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", c.dot)} aria-hidden />
                    <span className="truncate text-[14px] font-medium text-foreground">
                      {r.name}
                    </span>
                    {r.current && (
                      <span className="shrink-0 text-[11px] text-muted-foreground">Now</span>
                    )}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{fmt(r.start)}</span>
                </div>
                <div className="mt-1.5 pl-[18px]">
                  {metric === "strength" ? (
                    <div className="space-y-1">
                      {COMP_LIFTS.map((l) => {
                        const v = r.strengthPct[l];
                        const w = v == null ? 0 : (Math.abs(v) / maxAbs) * 50;
                        return (
                          <div key={l} className="flex items-center gap-2">
                            <span className="w-14 shrink-0 text-[11px] text-muted-foreground">
                              {COMP_LIFT_LABEL[l]}
                            </span>
                            <span className="relative h-2 flex-1 rounded-full bg-muted/60">
                              <span className="absolute inset-y-0 left-1/2 w-px bg-muted-foreground/40" />
                              {v != null && (
                                <span
                                  className="absolute inset-y-0 rounded-full"
                                  style={{
                                    background: LIFT_SERIES[l],
                                    width: `${w}%`,
                                    left: v >= 0 ? "50%" : `${50 - w}%`,
                                    opacity: v >= 0 ? 1 : 0.55,
                                  }}
                                />
                              )}
                            </span>
                            <span className="w-12 shrink-0 text-right text-[12px] tabular-nums text-foreground">
                              {v == null ? "—" : `${v > 0 ? "+" : ""}${v}%`}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="relative h-2.5 flex-1 rounded-full bg-muted/60">
                        <span
                          className={cn("absolute inset-y-0 left-0 rounded-full", c.bar)}
                          style={{
                            width: `${
                              metric === "volume"
                                ? ((r.setsPerWeek ?? 0) / maxVol) * 100
                                : metric === "intensity"
                                  ? (Math.max(0, (r.avgRpe ?? 5) - 5) / 5) * 100
                                  : (r.adherence ?? 0)
                            }%`,
                          }}
                        />
                      </span>
                      <span className="w-20 shrink-0 text-right text-[12px] tabular-nums text-foreground">
                        {metric === "volume"
                          ? r.setsPerWeek != null
                            ? `${r.setsPerWeek} sets a week`
                            : "—"
                          : metric === "intensity"
                            ? r.avgRpe != null
                              ? `RPE ${r.avgRpe} / 10`
                              : "—"
                            : r.adherence != null
                              ? `${r.adherence}%`
                              : "—"}
                      </span>
                    </div>
                  )}
                  {r.light && (
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {r.typeName}: doing less here is planned
                    </div>
                  )}
                </div>
              </button>
              {isOpen && (
                <div
                  className="mb-1 ml-[22px] grid grid-cols-3 gap-2 rounded-lg bg-muted/40 p-2.5 text-[12px] tabular-nums"
                  data-block-detail={r.id}
                >
                  <span>
                    <span className="block text-[11px] text-muted-foreground">Type</span>
                    <span className={cn("font-medium", c.text)}>{r.typeName}</span>
                  </span>
                  <span>
                    <span className="block text-[11px] text-muted-foreground">Sets a week</span>
                    <span className="font-medium text-foreground">{r.setsPerWeek ?? "—"}</span>
                  </span>
                  <span>
                    <span className="block text-[11px] text-muted-foreground">Workouts done</span>
                    <span className="font-medium text-foreground">
                      {r.adherence != null ? `${r.adherence}%` : "—"}
                    </span>
                  </span>
                  <span className="col-span-3 text-[11px] text-muted-foreground">
                    {fmt(r.start)} – {fmt(r.end)}
                    {r.avgRpe != null ? ` · average RPE ${r.avgRpe} on the main lifts` : ""}
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
        {metric === "strength"
          ? "How much each lift's estimated max changed from the start of the block to its end. Compare blocks of the same kind: a taper or deload is lighter on purpose."
          : metric === "volume"
            ? "Sets a week in each block, counting only weeks that are over."
            : metric === "intensity"
              ? "How hard your squat, bench and deadlift sets felt on average (RPE, out of 10)."
              : "Planned workouts done in each block, counting only weeks that are over."}
      </p>
    </div>
  );
}
