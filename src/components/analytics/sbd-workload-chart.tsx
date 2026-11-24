/**
 * Squat, bench and deadlift workload in one interactive chart (sbd-workload.ts):
 * pick the metric, the lift (or all three), competition lifts, barbell
 * variations or both, and the grain. Sums stack by lift with what was written
 * as an outline (sets); averages are per lift and never averaged across lifts
 * (an average weight on all three is small multiples, each on its own axis).
 * The line above the chart says how each lift moved, first third to last.
 */
import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { COMP_LIFT_LABEL } from "@/lib/analytics/competition-strength";
import {
  buildWorkload,
  defaultGrain,
  grainsFor,
  WORKLOAD_METRICS,
  workloadShifts,
  type WorkloadGrain,
  type WorkloadMetric,
  type WorkloadScope,
} from "@/lib/analytics/sbd-workload";
import { LIFTS, type Lift, type LoadSet, type PlanRow } from "@/lib/analytics/training-load";
import type { EnvelopePoint } from "@/lib/analytics/strength-estimate";
import {
  ChipRow,
  niceTicks,
  Segmented,
  useWidth,
  LB_PER_KG,
  LIFT_SERIES,
} from "@/components/analytics/viz";

type LiftPick = Lift | "all";
const GRAIN_WORD: Record<WorkloadGrain, string> = {
  day: "By day",
  week: "By week",
  month: "By month",
  block: "By block",
};
const GRAIN_UNIT: Record<WorkloadGrain, string> = {
  day: "days",
  week: "weeks",
  month: "months",
  block: "blocks",
};
const SCOPE_WORD: Record<WorkloadScope, string> = {
  comp: "Competition lifts",
  variations: "Barbell variations",
  both: "Competition + variations",
};

export function SbdWorkloadChart({
  sets,
  plan,
  start,
  end,
  today,
  unit,
  envelopes,
  blocks,
}: {
  sets: LoadSet[];
  plan?: PlanRow[];
  start: string;
  end: string;
  today: string;
  unit: "lb" | "kg";
  envelopes: Partial<Record<Lift, EnvelopePoint[]>>;
  blocks: Array<{ id: string; name: string; start: string; end: string }>;
}) {
  const [metric, setMetric] = useState<WorkloadMetric>("sets");
  const [lift, setLift] = useState<LiftPick>("all");
  const [scope, setScope] = useState<WorkloadScope>("both");
  const grains = grainsFor(start, end, blocks.length >= 2);
  const [grainPick, setGrain] = useState<WorkloadGrain | null>(null);
  const grain = grainPick && grains.includes(grainPick) ? grainPick : defaultGrain(start, end);
  const [picked, setPicked] = useState<string | null>(null);
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const def = WORKLOAD_METRICS.find((m) => m.key === metric)!;
  const buckets = useMemo(() => {
    const all = buildWorkload({
      sets,
      plan,
      metric,
      scope,
      grain,
      start,
      end,
      today,
      envelopes,
      blocks,
    });
    // start at the first bucket with training (months before anything was logged say nothing)
    const first = all.findIndex(
      (b) =>
        LIFTS.some((l) => (b.values[l] ?? 0) > 0) ||
        (b.prescribed && LIFTS.some((l) => b.prescribed![l] > 0)),
    );
    return first > 0 ? all.slice(first) : all;
  }, [sets, plan, metric, scope, grain, start, end, today, envelopes, blocks]);
  const lifts: Lift[] = lift === "all" ? LIFTS : [lift];
  const shifts = useMemo(() => workloadShifts(buckets, lifts), [buckets, lifts]);
  const any = buckets.some((b) => lifts.some((l) => (b.values[l] ?? 0) > 0));
  const conv = (v: number) =>
    metric === "tonnage" || metric === "avgLoad" ? (unit === "kg" ? v / LB_PER_KG : v) : v;
  const fmtV = (v: number | null) => {
    if (v == null) return "—";
    const x = conv(v);
    if (metric === "relIntensity") return `${Math.round(x)}%`;
    if (metric === "avgRpe") return x.toFixed(1);
    if (metric === "tonnage")
      return x >= 10_000 ? `${Math.round(x / 1000)}k` : Math.round(x).toLocaleString();
    return String(Math.round(x * 10) / 10);
  };

  const H = 190;
  const pad = { l: 38, r: 6, t: 10, b: 22 };
  const n = Math.max(1, buckets.length);
  const slot = (width - pad.l - pad.r) / n;
  const bx = (i: number) => pad.l + i * slot;
  const sel = buckets.find((b) => b.key === picked) ?? null;
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((width - pad.l) / 44))));

  let chart: React.ReactNode;
  if (!any) {
    chart = (
      <div className="flex h-[150px] items-center justify-center text-[13px] text-muted-foreground">
        No {SCOPE_WORD[scope].toLowerCase()} logged in this period.
      </div>
    );
  } else if (def.kind === "sum") {
    const totals = buckets.map((b) => lifts.reduce((a, l) => a + conv(b.values[l] ?? 0), 0));
    const pres = buckets.map((b) =>
      b.prescribed ? lifts.reduce((a, l) => a + b.prescribed![l], 0) : 0,
    );
    const ax = niceTicks(0, Math.max(1, ...totals, ...pres), 4);
    const y = (v: number) => pad.t + (1 - v / ax.hi) * (H - pad.t - pad.b);
    const bw = Math.max(3, Math.min(28, slot * 0.62));
    chart = (
      <svg
        width={width}
        height={H}
        role="img"
        aria-label={`${def.label} by ${grain}`}
        className="touch-pan-y select-none"
        data-workload-svg
      >
        {ax.ticks.map((t) => (
          <g key={t}>
            <line
              x1={pad.l}
              x2={width - pad.r}
              y1={y(t)}
              y2={y(t)}
              stroke="var(--border)"
              strokeOpacity={0.55}
            />
            <text
              x={pad.l - 6}
              y={y(t) + 3.5}
              textAnchor="end"
              fontSize={10.5}
              fill="var(--muted-foreground)"
              className="tabular-nums"
            >
              {metric === "tonnage" && t >= 1000 ? `${t / 1000}k` : t}
            </text>
          </g>
        ))}
        {buckets.map((b, i) => {
          const cx = bx(i) + slot / 2;
          let acc = 0;
          const on = picked === b.key;
          return (
            <g
              key={b.key}
              onClick={() => setPicked(on ? null : b.key)}
              onPointerEnter={(e) => e.pointerType === "mouse" && setPicked(b.key)}
              className="cursor-pointer"
              data-workload-bucket={b.key}
            >
              <rect
                x={bx(i)}
                y={pad.t}
                width={slot}
                height={H - pad.t - pad.b}
                fill={on ? "var(--muted)" : "transparent"}
                opacity={0.6}
              />
              {pres[i] > 0 && (
                <rect
                  x={cx - bw / 2 - 1.5}
                  y={y(pres[i])}
                  width={bw + 3}
                  height={H - pad.b - y(pres[i])}
                  fill="none"
                  stroke="var(--muted-foreground)"
                  strokeOpacity={0.45}
                  strokeDasharray="3 2"
                  rx={3}
                />
              )}
              {lifts.map((l) => {
                const v = conv(b.values[l] ?? 0);
                if (!(v > 0)) return null;
                const y0 = y(acc);
                acc += v;
                const y1 = y(acc);
                return (
                  <rect
                    key={l}
                    x={cx - bw / 2}
                    y={y1 + 1}
                    width={bw}
                    height={Math.max(1, y0 - y1 - 1)}
                    fill={LIFT_SERIES[l]}
                    opacity={b.current ? 0.5 : 1}
                    rx={2}
                  />
                );
              })}
              {i % labelEvery === 0 && (
                <text
                  x={cx}
                  y={H - 6}
                  fontSize={10}
                  fill="var(--muted-foreground)"
                  textAnchor="middle"
                >
                  {grain === "block"
                    ? b.label.slice(0, Math.max(3, Math.floor(slot / 6)))
                    : b.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    );
  } else {
    // averages: one line per lift; an average weight on all three is small multiples
    const multiples = metric === "avgLoad" && lifts.length > 1;
    const panels: Lift[][] = multiples ? lifts.map((l) => [l]) : [lifts];
    const PH = multiples ? 84 : H;
    chart = (
      <div className={cn(multiples && "space-y-2")}>
        {panels.map((ps) => {
          const vals = buckets
            .flatMap((b) => ps.map((l) => b.values[l]).filter((v): v is number => v != null))
            .map(conv);
          if (!vals.length) return null;
          const minSpan =
            metric === "avgRpe" ? 2 : metric === "relIntensity" ? 10 : unit === "kg" ? 10 : 20;
          const ax = niceTicks(Math.min(...vals), Math.max(...vals), multiples ? 2 : 4, minSpan);
          const y = (v: number) =>
            pad.t + (1 - (v - ax.lo) / (ax.hi - ax.lo)) * (PH - pad.t - pad.b);
          return (
            <div key={ps.join()}>
              {multiples && (
                <div className="text-[11px] font-medium text-muted-foreground">
                  {COMP_LIFT_LABEL[ps[0]]}
                </div>
              )}
              <svg
                width={width}
                height={PH}
                role="img"
                aria-label={`${def.label} by ${grain}`}
                className="touch-pan-y select-none"
              >
                {ax.ticks.map((t) => (
                  <g key={t}>
                    <line
                      x1={pad.l}
                      x2={width - pad.r}
                      y1={y(t)}
                      y2={y(t)}
                      stroke="var(--border)"
                      strokeOpacity={0.55}
                    />
                    <text
                      x={pad.l - 6}
                      y={y(t) + 3.5}
                      textAnchor="end"
                      fontSize={10.5}
                      fill="var(--muted-foreground)"
                      className="tabular-nums"
                    >
                      {metric === "relIntensity" ? `${t}%` : t}
                    </text>
                  </g>
                ))}
                {buckets.map((b, i) => (
                  <rect
                    key={b.key}
                    x={bx(i)}
                    y={pad.t}
                    width={slot}
                    height={PH - pad.t - pad.b}
                    fill={picked === b.key ? "var(--muted)" : "transparent"}
                    opacity={0.6}
                    onClick={() => setPicked(picked === b.key ? null : b.key)}
                    onPointerEnter={(e) => e.pointerType === "mouse" && setPicked(b.key)}
                    className="cursor-pointer"
                  />
                ))}
                {ps.map((l) => {
                  const pts = buckets
                    .map((b, i) => ({ i, v: b.values[l] }))
                    .filter((p): p is { i: number; v: number } => p.v != null);
                  // a gap in the data breaks the line (never a slope nobody trained)
                  let d = "";
                  let prev = -2;
                  for (const p of pts) {
                    d += `${p.i === prev + 1 ? "L" : "M"}${bx(p.i) + slot / 2} ${y(conv(p.v))} `;
                    prev = p.i;
                  }
                  return (
                    <g key={l}>
                      <path
                        d={d}
                        fill="none"
                        stroke={LIFT_SERIES[l]}
                        strokeWidth={2}
                        strokeLinejoin="round"
                      />
                      {pts.map((p) => (
                        <circle
                          key={p.i}
                          cx={bx(p.i) + slot / 2}
                          cy={y(conv(p.v))}
                          r={3}
                          fill={LIFT_SERIES[l]}
                          stroke="var(--card)"
                          strokeWidth={1.25}
                        />
                      ))}
                    </g>
                  );
                })}
                {!multiples &&
                  buckets.map((b, i) =>
                    i % labelEvery === 0 ? (
                      <text
                        key={b.key}
                        x={bx(i) + slot / 2}
                        y={PH - 6}
                        fontSize={10}
                        fill="var(--muted-foreground)"
                        textAnchor="middle"
                      >
                        {grain === "block"
                          ? b.label.slice(0, Math.max(3, Math.floor(slot / 6)))
                          : b.label}
                      </text>
                    ) : null,
                  )}
              </svg>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div data-sbd-workload data-workload-metric={metric}>
      <ChipRow
        value={metric}
        options={WORKLOAD_METRICS.map((m) => ({ key: m.key, label: m.short }))}
        onChange={(m) => setMetric(m)}
        label="Workload metric"
        className="mb-2.5"
      />
      <Segmented
        value={lift}
        onChange={(v) => setLift(v)}
        label="Lift"
        size="sm"
        options={[
          { key: "all" as LiftPick, label: "All three" },
          ...LIFTS.map((l) => ({ key: l as LiftPick, label: COMP_LIFT_LABEL[l] })),
        ]}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2" data-workload-filters>
        <PillMenu
          label="Which sets"
          value={scope}
          options={(Object.keys(SCOPE_WORD) as WorkloadScope[]).map((k) => ({
            key: k,
            label: SCOPE_WORD[k],
          }))}
          onChange={setScope}
          data="scope"
        />
        <PillMenu
          label="Grouping"
          value={grain}
          options={grains.map((g) => ({ key: g, label: GRAIN_WORD[g] }))}
          onChange={setGrain}
          data="grain"
        />
      </div>

      {shifts.some((s) => s.pct != null) && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px]" data-workload-shifts>
          <span className="w-full text-[12px] text-muted-foreground">
            Change from the first {GRAIN_UNIT[grain]} to the last:
          </span>
          {shifts
            .filter((s) => s.pct != null)
            .map((s) => (
              <span key={s.lift} className="inline-flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: LIFT_SERIES[s.lift] }}
                  aria-hidden
                />
                <span className="text-muted-foreground">{COMP_LIFT_LABEL[s.lift]}</span>
                <span className="font-semibold tabular-nums text-foreground">
                  {Math.abs(s.pct!) < 5
                    ? "about the same"
                    : `${s.pct! > 0 ? "up" : "down"} ${Math.abs(s.pct!)}%`}
                </span>
              </span>
            ))}
        </div>
      )}

      <div ref={wrapRef} className="mt-2 w-full">
        {chart}
      </div>

      <div
        className="mt-1 min-h-[36px] text-[12px] leading-snug text-muted-foreground"
        aria-live="polite"
        data-workload-detail
      >
        {sel ? (
          <span>
            <span className="font-medium text-foreground">{sel.blockName ?? sel.label}</span>
            {" · "}
            {lifts
              .map(
                (l) =>
                  `${COMP_LIFT_LABEL[l]} ${fmtV(sel.values[l])}${def.kind === "avg" && sel.n[l] ? ` (${sel.n[l]} sets)` : ""}`,
              )
              .join(" · ")}
            {sel.prescribed && metric === "sets"
              ? ` · ${lifts.reduce((a, l) => a + sel.prescribed![l], 0)} planned`
              : ""}
            {sel.current ? " · not over yet" : ""}
          </span>
        ) : (
          <span>
            {metric === "sets"
              ? `Sets ${GRAIN_WORD[grain].toLowerCase()}, not counting warm-ups.${plan?.length ? " The dashed outline is what your program planned." : ""}`
              : null}
            {metric === "reps" ? "Reps in your sets, not counting warm-ups." : null}
            {metric === "tonnage"
              ? `Each set's weight × its reps, added up (${unit}). It shows how much work you did, not how tired it made you.`
              : null}
            {metric === "avgLoad"
              ? `The average weight on the bar in your sets (${unit}), each lift on its own.`
              : null}
            {metric === "relIntensity"
              ? "How heavy your sets were compared with your estimated max at the time. 80% means 80% of the most you could likely lift once."
              : null}
            {metric === "avgRpe"
              ? "How hard your sets felt, out of 10 (RPE). 10 means you couldn't do another rep. Sets without a rating are left out."
              : null}{" "}
            Tap a bar for its numbers.
          </span>
        )}
      </div>
    </div>
  );
}

/** A small pill that opens its choices (native selects grow to 16px on phones). */
function PillMenu<T extends string>({
  label,
  value,
  options,
  onChange,
  data,
}: {
  label: string;
  value: T;
  options: Array<{ key: T; label: string }>;
  onChange: (v: T) => void;
  data: string;
}) {
  const cur = options.find((o) => o.key === value) ?? options[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${label}: ${cur?.label}`}
          className="inline-flex h-9 items-center gap-1 rounded-full border border-border px-3 text-[13px] font-medium text-foreground transition hover:bg-muted/50"
          data-workload-menu={data}
        >
          {cur?.label}
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as T)}>
          {options.map((o) => (
            <DropdownMenuRadioItem key={o.key} value={o.key}>
              {o.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
