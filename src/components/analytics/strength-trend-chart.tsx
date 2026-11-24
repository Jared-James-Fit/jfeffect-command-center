/**
 * The competition lifts over time (lift-strength.ts): every session as a dot
 * (solid for a hard set, faint for a lighter one, a ring for an unrated one,
 * a dashed ring for an estimate far off the rest), meets as diamonds, and the
 * estimated-strength line through them: solid where hard sets set it, dashed
 * where it's held with no hard set behind it. One lift at a time on its own
 * axis; Compare puts the three lines on one axis as % change.
 */
import { useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { parseLocalDate } from "@/lib/today";
import { COMP_LIFTS, COMP_LIFT_LABEL, type CompLift } from "@/lib/analytics/competition-strength";
import type { LiftStrength } from "@/lib/analytics/lift-strength";
import {
  envelopeAt,
  envelopeTrend,
  type EnvelopePoint,
  type SessionEstimate,
} from "@/lib/analytics/strength-estimate";
import {
  Change,
  niceTicks,
  Segmented,
  useWidth,
  LB_PER_KG,
  LIFT_SERIES,
} from "@/components/analytics/viz";

type View = CompLift | "compare";
const DAY = 86_400_000;
const dayMs = (d: string) => Date.parse(`${d}T12:00:00Z`);
const fmtDay = (d: string, f = "MMM d") => {
  const x = parseLocalDate(d);
  return x ? format(x, f) : d;
};

type Pt =
  | { kind: "session"; s: SessionEstimate }
  | { kind: "meet"; day: string; lb: number; name: string | null };

export function StrengthTrendChart({
  strength,
  start,
  end,
  unit,
  onWiden,
}: {
  strength: Record<CompLift, LiftStrength>;
  start: string;
  end: string;
  unit: "lb" | "kg";
  onWiden?: () => void;
}) {
  const conv = (lb: number) => (unit === "kg" ? lb / LB_PER_KG : lb);
  const trained = COMP_LIFTS.filter((l) => strength[l].sessions.length || strength[l].meets.length);
  const defaultLift = useMemo<CompLift>(() => {
    const n = (l: CompLift) =>
      strength[l].sessions.filter((s) => s.day >= start && s.day <= end).length;
    return [...COMP_LIFTS].sort((a, b) => n(b) - n(a))[0];
  }, [strength, start, end]);
  const [picked, setPicked] = useState<View | null>(null);
  const view: View = picked ?? defaultLift;
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<Pt | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  if (!trained.length) return null;

  const H = 210;
  const pad = { l: 40, r: 8, t: 10, b: 22 };
  const sMs = dayMs(start);
  const eMs = Math.max(dayMs(end), sMs + DAY);
  const x = (d: string) => pad.l + ((dayMs(d) - sMs) / (eMs - sMs)) * (width - pad.l - pad.r);

  // ── one lift ─────────────────────────────────────────────────────────
  let body: React.ReactNode;
  let headline: React.ReactNode = null;
  if (view !== "compare") {
    const ls = strength[view];
    const sessions = ls.sessions.filter((s) => s.day >= start && s.day <= end);
    const meets = ls.meets.filter((m) => m.day >= start && m.day <= end);
    const env = ls.envelope.filter((p) => p.day >= start && p.day <= end);
    const atStart = envelopeAt(ls.envelope, start);
    const line: EnvelopePoint[] = [
      ...(atStart && atStart.day < start ? [{ ...atStart, day: start }] : []),
      ...env,
    ];
    const vals = [
      ...sessions.filter((s) => !s.outlier).map((s) => s.e1rm),
      ...meets.map((m) => m.lb),
      ...line.map((p) => p.value),
    ].map(conv);
    const now = envelopeAt(ls.envelope, end);
    const trend = envelopeTrend(ls.envelope, start, end);
    const liftWord = COMP_LIFT_LABEL[view].toLowerCase();
    const r = (lb: number) => Math.round(conv(lb));
    headline = (
      <div data-strength-headline>
        <div className="text-[12px] text-muted-foreground">Your estimated {liftWord} max</div>
        <div className="text-[28px] font-semibold leading-tight tabular-nums tracking-tight">
          {now ? r(now.value) : "—"}
          <span className="ml-1 text-[13px] font-medium text-muted-foreground">{unit}</span>
          {now && (
            <span className="ml-2 text-[12px] font-normal text-muted-foreground">
              {unit === "kg"
                ? `${Math.round(now.value)} lb`
                : `${Math.round((now.value / LB_PER_KG) * 2) / 2} kg`}
            </span>
          )}
        </div>
        <p className="mt-1 text-[14px] leading-snug text-foreground/85" data-strength-sentence>
          {trend.kind === "unclear" ? (
            trend.reason === "held" ? (
              <>
                No hard {liftWord} sets since {now ? fmtDay(now.basis) : "then"}, so this is your last
                known estimate.
              </>
            ) : (
              <>Not enough {liftWord} workouts in this period to show a change yet.</>
            )
          ) : trend.kind === "steady" ? (
            <>
              Your {liftWord} has held steady since {fmtDay(trend.from.day)} (about{" "}
              {r(trend.to.value)} {unit}).
            </>
          ) : (
            <>
              Your {liftWord} went{" "}
              <span className={cn("font-semibold", trend.kind === "up" && "text-success")}>
                {trend.kind} {Math.abs(Math.round(trend.pct * 10) / 10)}%
              </span>{" "}
              since {fmtDay(trend.from.day)} ({r(trend.from.value)} → {r(trend.to.value)} {unit}).
            </>
          )}
        </p>
      </div>
    );
    if (!vals.length) {
      body = (
        <div className="flex h-[150px] flex-col items-center justify-center gap-2 text-center text-[13px] text-muted-foreground">
          No {COMP_LIFT_LABEL[view].toLowerCase()} sessions in this period.
          {onWiden && (
            <button
              type="button"
              onClick={onWiden}
              className="min-h-10 font-medium text-foreground"
            >
              Show all time
            </button>
          )}
        </div>
      );
    } else {
      const minSpan = Math.max(unit === "kg" ? 5 : 10, Math.max(...vals) * 0.06);
      const ax = niceTicks(Math.min(...vals), Math.max(...vals), 4, minSpan);
      const y = (lb: number) =>
        pad.t + (1 - (conv(lb) - ax.lo) / (ax.hi - ax.lo)) * (H - pad.t - pad.b);
      // the line in pieces: solid where measured, dashed where held
      const segs: Array<{ d: string; dashed: boolean }> = [];
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1];
        const b = line[i];
        const dashed = b.state === "held" || b.state === "stale" || b.state === "floor";
        // a step: flat until the next session, then to its value
        const d = `M${x(a.day)} ${y(a.value)} H${x(b.day)} V${y(b.value)}`;
        segs.push({ d, dashed });
      }
      const last = line[line.length - 1];
      if (last && dayMs(last.day) < eMs)
        segs.push({ d: `M${x(last.day)} ${y(last.value)} H${x(end)}`, dashed: true });
      const pts: Pt[] = [
        ...sessions.map((s) => ({ kind: "session" as const, s })),
        ...meets.map((m) => ({ kind: "meet" as const, ...m })),
      ];
      const pick = (clientX: number) => {
        const r = svgRef.current?.getBoundingClientRect();
        if (!r) return;
        const px = clientX - r.left;
        let best: Pt | null = null;
        let bd = Infinity;
        for (const p of pts) {
          const d = Math.abs(x(p.kind === "session" ? p.s.day : p.day) - px);
          if (d < bd) {
            bd = d;
            best = p;
          }
        }
        setHover(bd < 28 ? best : null);
      };
      const months = monthTicks(start, end, width);
      body = (
        <svg
          ref={svgRef}
          width={width}
          height={H}
          role="img"
          aria-label={`${COMP_LIFT_LABEL[view]} estimated strength over time`}
          onPointerMove={(e) => pick(e.clientX)}
          onPointerDown={(e) => pick(e.clientX)}
          onPointerLeave={(e) => e.pointerType === "mouse" && setHover(null)}
          className="touch-pan-y select-none"
          data-strength-svg
        >
          {ax.ticks.map((t) => {
            const yy = pad.t + (1 - (t - ax.lo) / (ax.hi - ax.lo)) * (H - pad.t - pad.b);
            return (
              <g key={t}>
                <line
                  x1={pad.l}
                  x2={width - pad.r}
                  y1={yy}
                  y2={yy}
                  stroke="var(--border)"
                  strokeOpacity={0.55}
                />
                <text
                  x={pad.l - 6}
                  y={yy + 3.5}
                  textAnchor="end"
                  fontSize={10.5}
                  fill="var(--muted-foreground)"
                  className="tabular-nums"
                >
                  {Math.round(t)}
                </text>
              </g>
            );
          })}
          {months.map((m) => (
            <text
              key={m.day}
              x={x(m.day)}
              y={H - 6}
              fontSize={10.5}
              fill="var(--muted-foreground)"
              textAnchor="middle"
            >
              {m.label}
            </text>
          ))}
          {segs.map((s, i) => (
            <path
              key={i}
              d={s.d}
              fill="none"
              stroke={LIFT_SERIES[view]}
              strokeWidth={2.25}
              strokeDasharray={s.dashed ? "4 4" : undefined}
              strokeLinejoin="round"
              opacity={s.dashed ? 0.7 : 1}
            />
          ))}
          {sessions.map((s) => {
            const cx = x(s.day);
            const cy = y(s.e1rm);
            const on = hover?.kind === "session" && hover.s.day === s.day;
            if (s.outlier)
              return (
                <circle
                  key={s.day}
                  cx={cx}
                  cy={Math.max(pad.t, Math.min(H - pad.b, cy))}
                  r={4}
                  fill="none"
                  stroke="var(--muted-foreground)"
                  strokeDasharray="2 2"
                />
              );
            if (s.confidence === "low")
              return (
                <circle
                  key={s.day}
                  cx={cx}
                  cy={cy}
                  r={on ? 5 : 3.5}
                  fill="var(--card)"
                  stroke={LIFT_SERIES[view]}
                  strokeWidth={1.5}
                  opacity={0.8}
                />
              );
            return (
              <circle
                key={s.day}
                cx={cx}
                cy={cy}
                r={on ? 5.5 : 4}
                fill={LIFT_SERIES[view]}
                opacity={s.confidence === "high" ? 1 : 0.4}
                stroke="var(--card)"
                strokeWidth={1.5}
              />
            );
          })}
          {meets.map((m) => {
            const cx = x(m.day);
            const cy = y(m.lb);
            return (
              <path
                key={m.day}
                d={`M${cx} ${cy - 6} L${cx + 6} ${cy} L${cx} ${cy + 6} L${cx - 6} ${cy} Z`}
                fill="var(--card)"
                stroke="var(--foreground)"
                strokeWidth={2}
              />
            );
          })}
          {hover && (
            <line
              x1={x(hover.kind === "session" ? hover.s.day : hover.day)}
              x2={x(hover.kind === "session" ? hover.s.day : hover.day)}
              y1={pad.t}
              y2={H - pad.b}
              stroke="var(--muted-foreground)"
              strokeOpacity={0.35}
            />
          )}
        </svg>
      );
    }
  } else {
    // ── compare: % change from each lift's line at the start ────────────
    const series = COMP_LIFTS.map((l) => {
      const env = strength[l].envelope;
      const base =
        envelopeAt(env, start) ?? env.find((p) => p.day >= start && p.day <= end) ?? null;
      const pts = env.filter((p) => p.day >= start && p.day <= end);
      return {
        lift: l,
        base,
        pts: base
          ? pts.map((p) => ({
              day: p.day,
              v: ((p.value - base.value) / base.value) * 100,
              state: p.state,
            }))
          : [],
      };
    }).filter((s) => s.pts.length >= 2);
    if (!series.length) {
      body = (
        <div className="flex h-[150px] items-center justify-center text-[13px] text-muted-foreground">
          Not enough sessions in this period to compare.
        </div>
      );
    } else {
      const all = series.flatMap((s) => s.pts.map((p) => p.v));
      const ax = niceTicks(Math.min(0, ...all), Math.max(0, ...all), 4, 6);
      const y = (v: number) => pad.t + (1 - (v - ax.lo) / (ax.hi - ax.lo)) * (H - pad.t - pad.b);
      const months = monthTicks(start, end, width);
      body = (
        <svg
          width={width}
          height={H}
          role="img"
          aria-label="The three lifts as % change in estimated strength"
          data-strength-compare
        >
          {ax.ticks.map((t) => (
            <g key={t}>
              <line
                x1={pad.l}
                x2={width - pad.r}
                y1={y(t)}
                y2={y(t)}
                stroke={t === 0 ? "var(--muted-foreground)" : "var(--border)"}
                strokeOpacity={t === 0 ? 0.5 : 0.55}
              />
              <text
                x={pad.l - 6}
                y={y(t) + 3.5}
                textAnchor="end"
                fontSize={10.5}
                fill="var(--muted-foreground)"
              >
                {t > 0 ? "+" : ""}
                {t}%
              </text>
            </g>
          ))}
          {months.map((m) => (
            <text
              key={m.day}
              x={x(m.day)}
              y={H - 6}
              fontSize={10.5}
              fill="var(--muted-foreground)"
              textAnchor="middle"
            >
              {m.label}
            </text>
          ))}
          {series.map((s) => (
            <path
              key={s.lift}
              d={s.pts.map((p, i) => `${i ? "L" : "M"}${x(p.day)} ${y(p.v)}`).join(" ")}
              fill="none"
              stroke={LIFT_SERIES[s.lift]}
              strokeWidth={2.25}
              strokeLinejoin="round"
            />
          ))}
        </svg>
      );
      headline = (
        <div className="grid grid-cols-3 gap-2" data-compare-summary>
          {series.map((s) => {
            const lastV = s.pts[s.pts.length - 1].v;
            return (
              <div key={s.lift} className="min-w-0">
                <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: LIFT_SERIES[s.lift] }}
                  />
                  {COMP_LIFT_LABEL[s.lift]}
                </div>
                <Change pct={lastV} className="text-[17px] font-semibold" />
              </div>
            );
          })}
        </div>
      );
    }
  }

  const hoverText =
    hover?.kind === "session"
      ? `${fmtDay(hover.s.day, "EEE, MMM d")} · best set ${Math.round(conv(hover.s.set.load) * 2) / 2} ${unit} × ${hover.s.set.reps}${hover.s.set.effort ? ` at RPE ${hover.s.set.effort}` : " (no effort rating)"} → estimated max ${Math.round(conv(hover.s.e1rm))} ${unit}${
          hover.s.outlier
            ? ". Far from your other workouts, so it's left out of the line."
            : hover.s.confidence === "high"
              ? ""
              : ". From an easier set, so your real max may be higher."
        }`
      : hover?.kind === "meet"
        ? `${fmtDay(hover.day, "MMM d, yyyy")} · ${hover.name ?? "Meet"}: ${Math.round(conv(hover.lb) * 2) / 2} ${unit} lifted on the platform`
        : null;

  return (
    <div data-strength-trend data-strength-view={view}>
      <Segmented
        value={view}
        onChange={(v) => {
          setPicked(v);
          setHover(null);
        }}
        label="Lift"
        options={[
          ...COMP_LIFTS.map((l) => ({ key: l as View, label: COMP_LIFT_LABEL[l] })),
          { key: "compare" as View, label: "Compare" },
        ]}
        className="mb-3"
      />
      {headline}
      <div ref={wrapRef} className="mt-3 w-full">
        {body}
      </div>
      <div
        className="mt-1 min-h-[34px] text-[12px] leading-snug text-muted-foreground"
        aria-live="polite"
        data-strength-hover
      >
        {hoverText ??
          (view === "compare" ? (
            "How much each lift's estimated max has changed since the start of the period, in %. Tap the chart for a day's numbers."
          ) : (
            <StrengthKey lift={view} />
          ))}
      </div>
    </div>
  );
}

function StrengthKey({ lift }: { lift: CompLift }) {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="inline-flex items-center gap-1">
        <span className="h-2 w-2 rounded-full" style={{ background: LIFT_SERIES[lift] }} /> Hard set
      </span>
      <span className="inline-flex items-center gap-1">
        <span
          className="h-2 w-2 rounded-full opacity-40"
          style={{ background: LIFT_SERIES[lift] }}
        />{" "}
        Easier set
      </span>
      <span className="inline-flex items-center gap-1">
        <span
          className="h-2 w-2 rounded-full border-[1.5px]"
          style={{ borderColor: LIFT_SERIES[lift] }}
        />{" "}
        No effort rating
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="h-2 w-2 rotate-45 border-2 border-foreground" /> Meet lift
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="w-3 border-t-2 border-dashed" style={{ borderColor: LIFT_SERIES[lift] }} />{" "}
        No hard set lately
      </span>
    </span>
  );
}

/** Month labels that fit the width (every month, every other, or quarters). */
function monthTicks(
  start: string,
  end: string,
  width: number,
): Array<{ day: string; label: string }> {
  const s = parseLocalDate(start)!;
  const e = parseLocalDate(end)!;
  const out: Array<{ day: string; label: string }> = [];
  const span = (e.getTime() - s.getTime()) / DAY;
  if (span <= 45) {
    for (let t = s.getTime(); t <= e.getTime(); t += 7 * DAY) {
      const d = new Date(t);
      out.push({ day: format(d, "yyyy-MM-dd"), label: format(d, "MMM d") });
    }
    return out.filter(
      (_, i) => i % Math.max(1, Math.ceil(out.length / Math.max(2, Math.floor(width / 70)))) === 0,
    );
  }
  const d = new Date(s.getFullYear(), s.getMonth() + 1, 1);
  while (d <= e) {
    out.push({
      day: format(d, "yyyy-MM-dd"),
      label: format(d, d.getMonth() === 0 ? "MMM yy" : "MMM"),
    });
    d.setMonth(d.getMonth() + 1);
  }
  const every = Math.max(1, Math.ceil(out.length / Math.max(2, Math.floor(width / 52))));
  return out.filter((_, i) => i % every === 0);
}
