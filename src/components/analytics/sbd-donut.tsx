/**
 * What the total is made of: a donut of squat, bench and deadlift with the
 * total in the middle (sbd-composition.ts). Switch between the estimated
 * total now, the last meet and each earlier meet; never a mix of them. Tap a
 * lift for its own numbers: its share against the athlete's own earlier
 * total, and every number on file for it, each said for what it is.
 */
import { useMemo, useState } from "react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { parseLocalDate } from "@/lib/today";
import { COMP_LIFTS, COMP_LIFT_LABEL, type CompLift } from "@/lib/analytics/competition-strength";
import { donutArcs, shareContext, type Composition } from "@/lib/analytics/sbd-composition";
import type { MaxOnFile } from "@/lib/analytics/analytics-areas";
import { arcPath, LB_PER_KG, LIFT_SERIES } from "@/components/analytics/viz";

const fmtDay = (d: string) => {
  const x = parseLocalDate(d);
  return x ? format(x, x.getFullYear() === new Date().getFullYear() ? "MMM d" : "MMM d, yyyy") : d;
};

export function SbdDonut({
  compositions,
  missing,
  unit,
  maxes = [],
}: {
  /** the estimate first (when there is one), then meets newest first */
  compositions: Composition[];
  /** the lifts with no current estimate (why there's no estimated total) */
  missing: CompLift[];
  unit: "lb" | "kg";
  maxes?: MaxOnFile[];
}) {
  const [id, setId] = useState<string | null>(null);
  const [lift, setLift] = useState<CompLift | null>(null);
  const c = compositions.find((x) => x.id === id) ?? compositions[0] ?? null;
  const ctx = useMemo(() => (c ? shareContext(c, compositions) : null), [c, compositions]);
  if (!c) return null;
  const conv = (lb: number) => (unit === "kg" ? lb / LB_PER_KG : lb);
  const round = (v: number) => (unit === "kg" ? Math.round(v * 2) / 2 : Math.round(v));
  const other = (lb: number) =>
    unit === "kg" ? `${Math.round(lb)} lb` : `${Math.round((lb / LB_PER_KG) * 2) / 2} kg`;
  const size = 200;
  const R = 84;
  const arcs = donutArcs(c);
  const options = compositions.slice(0, 8);

  return (
    <div className="@container" data-sbd-donut data-sbd-kind={c.kind}>
      {/* which total: the estimate, the last meet, earlier meets */}
      <div
        className="-mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]"
        role="group"
        aria-label="Which total"
      >
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            aria-pressed={o.id === c.id}
            onClick={() => {
              setId(o.id);
              setLift(null);
            }}
            className={cn(
              "h-9 shrink-0 rounded-full border px-3 text-[13px] font-medium transition",
              o.id === c.id
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {o.kind === "estimate"
              ? "Estimated today"
              : o === compositions.find((x) => x.kind === "meet")
                ? `Last meet · ${fmtDay(o.day)}`
                : fmtDay(o.day)}
          </button>
        ))}
      </div>

      <div className="flex flex-col items-center gap-4 @[520px]:flex-row @[520px]:gap-6">
        <div className="relative shrink-0" style={{ width: size, height: size }}>
          <svg
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
            role="img"
            aria-label={`Total ${Math.round(conv(c.totalLb))} ${unit}: ${COMP_LIFTS.map((l) => `${COMP_LIFT_LABEL[l]} ${c.lifts[l].share}%`).join(", ")}`}
          >
            <circle
              cx={size / 2}
              cy={size / 2}
              r={R}
              fill="none"
              stroke="var(--muted)"
              strokeWidth={22}
            />
            {arcs.map((a) => {
              const on = lift == null || lift === a.lift;
              return (
                <path
                  key={a.lift}
                  d={arcPath(size / 2, size / 2, R, a.start, a.end)}
                  fill="none"
                  stroke={LIFT_SERIES[a.lift]}
                  strokeWidth={lift === a.lift ? 28 : 22}
                  strokeLinecap="butt"
                  opacity={on ? 1 : 0.28}
                  className="cursor-pointer transition-all duration-300 motion-reduce:transition-none"
                  onClick={() => setLift(lift === a.lift ? null : a.lift)}
                  data-donut-seg={a.lift}
                />
              );
            })}
          </svg>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-[11px] font-medium text-muted-foreground">
              {c.kind === "estimate" ? "Estimated total" : "Meet total"}
            </span>
            <span className="text-[30px] font-semibold leading-tight tabular-nums tracking-tight text-foreground">
              {round(conv(c.totalLb)).toLocaleString()}
              <span className="ml-0.5 text-[13px] font-medium text-muted-foreground">{unit}</span>
            </span>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {other(c.totalLb)}
            </span>
          </div>
        </div>

        <ul className="w-full min-w-0 space-y-1" aria-label="Lifts">
          {COMP_LIFTS.map((l) => (
            <li key={l}>
              <button
                type="button"
                onClick={() => setLift(lift === l ? null : l)}
                aria-expanded={lift === l}
                className={cn(
                  "flex min-h-11 w-full items-center gap-3 rounded-lg px-2 text-left transition hover:bg-muted/50",
                  lift === l && "bg-muted/60",
                )}
                data-donut-lift={l}
              >
                <span
                  className="h-3 w-3 shrink-0 rounded-[3px]"
                  style={{ background: LIFT_SERIES[l] }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-foreground">
                  {COMP_LIFT_LABEL[l]}
                </span>
                <span className="shrink-0 whitespace-nowrap text-right tabular-nums">
                  <span className="text-[15px] font-semibold text-foreground">
                    {round(conv(c.lifts[l].lb))} {unit}
                  </span>
                  <span className="ml-2 inline-block w-11 text-[13px] text-muted-foreground">
                    {c.lifts[l].share}%
                  </span>
                </span>
              </button>
              {lift === l && ctx && (
                <LiftDetail
                  lift={l}
                  c={c}
                  words={ctx[l].words}
                  unit={unit}
                  conv={conv}
                  round={round}
                  maxes={maxes.filter((m) => m.lift === l)}
                />
              )}
            </li>
          ))}
        </ul>
      </div>

      <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
        {c.kind === "estimate"
          ? "An estimate from your last six weeks of training, not a tested total."
          : `Lifted at ${c.label}${c.bodyweightLb ? `, weighing ${round(conv(c.bodyweightLb))} ${unit}` : ""}.`}
        {missing.length > 0 && c.kind !== "estimate"
          ? ` No estimated total today: no recent hard ${missing.map((m) => COMP_LIFT_LABEL[m].toLowerCase()).join(" or ")} sets to go on.`
          : ""}{" "}
        A smaller share doesn't mean a lift is weak.
      </p>
    </div>
  );
}

function LiftDetail({
  lift,
  c,
  words,
  unit,
  conv,
  round,
  maxes,
}: {
  lift: CompLift;
  c: Composition;
  words: string;
  unit: string;
  conv: (lb: number) => number;
  round: (v: number) => number;
  maxes: MaxOnFile[];
}) {
  const kind: Record<MaxOnFile["kind"], string> = {
    tested: "Tested max (1 rep)",
    on_file: "Max (1 rep) entered by your coach",
    training_max: "Training max (what your program's % use)",
  };
  return (
    <div
      className="mb-1 ml-8 mt-0.5 space-y-1 text-[12px] text-muted-foreground"
      data-donut-detail={lift}
    >
      <p className="text-foreground/85">{words}</p>
      {c.kind === "estimate" && <p>Worked out from your {fmtDay(c.lifts[lift].basisDay)} workout.</p>}
      {maxes.map((m) => (
        <p key={`${m.kind}-${m.lb}`} className="tabular-nums">
          {kind[m.kind]}: {round(conv(m.lb))} {unit}
          {m.date ? ` · ${fmtDay(m.date)}` : ""}
        </p>
      ))}
    </div>
  );
}
