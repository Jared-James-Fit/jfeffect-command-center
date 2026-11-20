/**
 * Small, plain charts for lift analysis (inline SVG, theme colours): each
 * rep's mean speed as a bar, one rep's speed over time with its peak and
 * sticking point, and the athlete's load–velocity line with today's set.
 * An estimate is drawn lighter, a missed rep crossed out; nothing is drawn
 * for a number that isn't there.
 */
import type { LiftAnalysis } from "@/lib/lift-analysis/analyze";
import type { LvPoint, LvProfile } from "@/lib/lift-analysis/profile";

const FG = "var(--foreground)";
const MUTED = "var(--muted-foreground)";
const GRID = "color-mix(in oklch, var(--muted-foreground) 25%, transparent)";
const AMBER = "var(--warning, #f59e0b)";

export function RepSpeedBars({
  analysis,
  selected,
  onSelect,
}: {
  analysis: LiftAnalysis;
  selected: number | null;
  onSelect: (i: number) => void;
}) {
  const reps = analysis.reps;
  const vals = reps.map((r) => (r.mcv.tier !== "unavailable" ? r.mcv.v : null));
  const max = Math.max(0.1, ...vals.map((v) => v ?? 0));
  const W = 320;
  const H = 120;
  const pad = { l: 4, r: 4, t: 18, b: 20 };
  const bw = Math.min(44, (W - pad.l - pad.r) / Math.max(1, reps.length) - 8);
  const step = (W - pad.l - pad.r) / Math.max(1, reps.length);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-[120px] w-full"
      role="img"
      aria-label="Mean concentric velocity by rep"
      data-rep-speed-bars
    >
      {reps.map((r, i) => {
        const v = vals[i];
        const x = pad.l + step * i + (step - bw) / 2;
        const h = v != null ? ((H - pad.t - pad.b) * v) / max : 0;
        const y = H - pad.b - h;
        const est = r.mcv.tier === "estimated";
        const on = selected === i;
        return (
          <g key={i} onClick={() => onSelect(i)} className="cursor-pointer">
            <rect x={pad.l + step * i} y={0} width={step} height={H} fill="transparent" />
            {v != null ? (
              <>
                <rect
                  x={x}
                  y={y}
                  width={bw}
                  height={h}
                  rx={5}
                  fill={FG}
                  opacity={est ? 0.35 : on || selected == null ? 0.9 : 0.45}
                />
                <text
                  x={x + bw / 2}
                  y={y - 5}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight={600}
                  fill={FG}
                  className="tabular-nums"
                >
                  {est ? "≈" : ""}
                  {v.toFixed(2)}
                </text>
              </>
            ) : (
              <text x={x + bw / 2} y={H - pad.b - 6} textAnchor="middle" fontSize={11} fill={MUTED}>
                —
              </text>
            )}
            <text
              x={x + bw / 2}
              y={H - 5}
              textAnchor="middle"
              fontSize={11}
              fill={on ? FG : MUTED}
              fontWeight={on ? 700 : 500}
              textDecoration={r.complete ? undefined : "line-through"}
            >
              {i + 1}
            </text>
          </g>
        );
      })}
      <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke={GRID} />
    </svg>
  );
}

/** One rep's speed over its time, from the start of its lowering (or lift) to the top. */
export function RepSpeedCurve({ analysis, rep }: { analysis: LiftAnalysis; rep: number }) {
  const r = analysis.reps[rep];
  const S = analysis.series;
  if (!r || analysis.units !== "mm") return null;
  const t0 = Math.min(r.ecc?.start ?? r.con.start, r.con.start) - 0.15;
  const t1 = Math.max(r.con.end, r.ecc && r.dir === "lift_first" ? r.ecc.end : r.con.end) + 0.15;
  const pts: { t: number; v: number }[] = [];
  for (let i = 0; i < S.t.length; i++) {
    if (S.t[i] < t0 || S.t[i] > t1) continue;
    const v = S.v[i];
    if (v != null) pts.push({ t: S.t[i], v });
  }
  if (pts.length < 4) return null;
  const vmax = Math.max(0.2, ...pts.map((p) => p.v));
  const vmin = Math.min(0, ...pts.map((p) => p.v));
  const W = 320;
  const H = 130;
  const pad = { l: 30, r: 8, t: 10, b: 18 };
  const X = (t: number) => pad.l + ((t - t0) / (t1 - t0)) * (W - pad.l - pad.r);
  const Y = (v: number) => pad.t + ((vmax - v) / (vmax - vmin)) * (H - pad.t - pad.b);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join("");
  const conX0 = X(r.con.start);
  const conX1 = X(r.con.end);
  const peakT = r.peak.v != null ? pts.reduce((b, p) => (p.v > b.v ? p : b)).t : null;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-[130px] w-full"
      role="img"
      aria-label={`Rep ${rep + 1} speed over time`}
      data-rep-speed-curve
    >
      <rect
        x={conX0}
        y={pad.t}
        width={Math.max(0, conX1 - conX0)}
        height={H - pad.t - pad.b}
        fill={GRID}
        opacity={0.5}
      />
      <line x1={pad.l} x2={W - pad.r} y1={Y(0)} y2={Y(0)} stroke={GRID} />
      <text
        x={pad.l - 4}
        y={Y(vmax) + 4}
        textAnchor="end"
        fontSize={10}
        fill={MUTED}
        className="tabular-nums"
      >
        {vmax.toFixed(1)}
      </text>
      <text x={pad.l - 4} y={Y(0) + 4} textAnchor="end" fontSize={10} fill={MUTED}>
        0
      </text>
      <path d={d} fill="none" stroke={FG} strokeWidth={2} strokeLinejoin="round" />
      {peakT != null && r.peak.tier !== "unavailable" && (
        <circle cx={X(peakT)} cy={Y(r.peak.v!)} r={3.5} fill={FG} />
      )}
      {r.sticking && (
        <circle
          cx={X(r.sticking.time)}
          cy={Y(
            pts.reduce((b, p) =>
              Math.abs(p.t - r.sticking!.time) < Math.abs(b.t - r.sticking!.time) ? p : b,
            ).v,
          )}
          r={4.5}
          fill={AMBER}
          stroke="var(--background)"
          strokeWidth={1.5}
        />
      )}
      <text x={(conX0 + conX1) / 2} y={H - 4} textAnchor="middle" fontSize={10} fill={MUTED}>
        up
      </text>
      <text x={pad.l - 4} y={H - 4} textAnchor="end" fontSize={10} fill={MUTED}>
        m/s
      </text>
    </svg>
  );
}

/** The athlete's load–velocity points and line, today's set ringed. */
export function LoadVelocityChart({
  points,
  profile,
  todayId,
  unit,
}: {
  points: LvPoint[];
  profile: LvProfile | null;
  todayId: string;
  unit: "kg" | "lb";
}) {
  if (points.length < 2) return null;
  const toU = (kg: number) => (unit === "lb" ? kg * 2.20462 : kg);
  const xs = points.map((p) => toU(p.kg));
  const ys = points.map((p) => p.v);
  const xmin = Math.min(...xs) * 0.95;
  const xmax = Math.max(...xs) * 1.05;
  const ymax = Math.max(...ys) * 1.15;
  const ymin = Math.max(0, Math.min(...ys) * 0.8);
  const W = 320;
  const H = 150;
  const pad = { l: 30, r: 8, t: 8, b: 22 };
  const X = (x: number) => pad.l + ((x - xmin) / (xmax - xmin || 1)) * (W - pad.l - pad.r);
  const Y = (y: number) => pad.t + ((ymax - y) / (ymax - ymin || 1)) * (H - pad.t - pad.b);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-[150px] w-full"
      role="img"
      aria-label="Bar speed by load"
      data-lv-chart
    >
      <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke={GRID} />
      {profile && (
        <line
          x1={X(toU(profile.minKg))}
          y1={Y(profile.intercept + profile.slope * profile.minKg)}
          x2={X(toU(profile.maxKg))}
          y2={Y(profile.intercept + profile.slope * profile.maxKg)}
          stroke={MUTED}
          strokeWidth={1.5}
          strokeDasharray="5 4"
        />
      )}
      {points.map((p) => {
        const today = p.id === todayId;
        return (
          <circle
            key={p.id}
            cx={X(toU(p.kg))}
            cy={Y(p.v)}
            r={today ? 6 : 4}
            fill={today ? FG : "transparent"}
            stroke={FG}
            strokeWidth={today ? 2 : 1.5}
            opacity={p.tier === "estimated" && !today ? 0.5 : 1}
          />
        );
      })}
      <text
        x={pad.l - 4}
        y={Y(ymax) + 10}
        textAnchor="end"
        fontSize={10}
        fill={MUTED}
        className="tabular-nums"
      >
        {ymax.toFixed(1)}
      </text>
      <text
        x={pad.l - 4}
        y={Y(ymin) + 4}
        textAnchor="end"
        fontSize={10}
        fill={MUTED}
        className="tabular-nums"
      >
        {ymin.toFixed(1)}
      </text>
      <text
        x={X(Math.min(...xs))}
        y={H - 6}
        textAnchor="middle"
        fontSize={10}
        fill={MUTED}
        className="tabular-nums"
      >
        {Math.round(Math.min(...xs))} {unit}
      </text>
      <text
        x={X(Math.max(...xs))}
        y={H - 6}
        textAnchor="middle"
        fontSize={10}
        fill={MUTED}
        className="tabular-nums"
      >
        {Math.round(Math.max(...xs))} {unit}
      </text>
    </svg>
  );
}
