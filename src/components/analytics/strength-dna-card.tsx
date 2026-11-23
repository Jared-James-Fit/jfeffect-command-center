/**
 * Strength DNA: what a squat-bench-deadlift total is made of, as one tall
 * segmented bar (each lift's share printed in its block), the weights in
 * both units, and how the split compares with a typical raw lifter and with
 * the athlete's own history. Every number from strength-dna.ts.
 *
 * Three totals, chosen with one switch and never mixed: a meet (stepped
 * meet by meet), best lifts (each lift's heaviest single, from whatever day
 * it was), and the estimate now (hard sets in the last 6 weeks).
 */
import { useMemo, useState } from "react";
import { format } from "date-fns";
import { ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { parseLocalDate } from "@/lib/today";
import { InfoTip } from "@/components/analytics/info-tip";
import { DualWeight, LabHeader, Seg, Stepper } from "@/components/analytics/lab-ui";
import { LIFT_SERIES } from "@/components/analytics/competition-strength-chart";
import {
  COMP_LIFTS,
  COMP_LIFT_LABEL,
  type CompLift,
  type MeetResult,
  type StrengthPoint,
} from "@/lib/analytics/competition-strength";
import type { MaxOnFile } from "@/lib/analytics/analytics-areas";
import {
  bestLiftsTotal,
  defaultDnaKind,
  estimateTotalAt,
  meetTotals,
  monthlyEstimateTotals,
  readDna,
  trainingSingles,
  type DnaKind,
  type DnaSex,
  type DnaTotal,
} from "@/lib/analytics/strength-dna";
import { loadDelta, loadText, type Unit } from "@/lib/analytics/units";
import { TYPICAL_SPLIT } from "@/lib/strength-split";

const fmtDay = (d: string | null, f = "MMM d, yyyy") => {
  const x = d ? parseLocalDate(d) : null;
  return x ? format(x, f) : "";
};
const pct = (share: number) => `${(Math.round(share * 1000) / 10).toFixed(1)}%`;
const signedPts = (p: number) => `${p > 0 ? "+" : p < 0 ? "−" : "±"}${Math.abs(p).toFixed(1)} pts`;

export type StrengthDnaInput = {
  points: StrengthPoint[];
  meets: MeetResult[];
  maxes: MaxOnFile[];
  results: any[];
  weighIns: Array<{ day: string; lb: number }>;
  sex: DnaSex | null;
  today: string;
};

/** Every total the card can show, worked out once. */
export function useStrengthDna(input: StrengthDnaInput) {
  const { points, meets, maxes, results, weighIns, sex, today } = input;
  return useMemo(() => {
    const meetsT = meetTotals(
      meets.filter((m) => m.date <= today),
      sex,
    );
    const best = bestLiftsTotal({ meets, maxes, singles: trainingSingles(results), today });
    const estimate = estimateTotalAt({ points, day: today, weighIns, sex });
    const months = monthlyEstimateTotals({ points, today, weighIns, sex });
    return {
      meets: meetsT,
      best,
      estimate,
      months,
      has: { meet: meetsT.length > 0, best: !!best, estimate: !!estimate },
    };
  }, [points, meets, maxes, results, weighIns, sex, today]);
}

type Dna = ReturnType<typeof useStrengthDna>;

/** The tall bar: one block per lift, its share printed inside, a tap picks the lift. */
function DnaBar({
  total,
  picked,
  onPick,
}: {
  total: DnaTotal;
  picked: CompLift | null;
  onPick?: (l: CompLift) => void;
}) {
  return (
    <div
      className="flex h-9 w-full gap-[2px]"
      role="group"
      aria-label={`Split: ${COMP_LIFTS.map((l) => `${COMP_LIFT_LABEL[l]} ${pct(total.parts[l].share)}`).join(", ")}`}
      data-dna-bar
    >
      {COMP_LIFTS.map((l) => {
        const share = total.parts[l].share;
        const on = picked === l;
        return (
          <button
            key={l}
            type="button"
            onClick={() => onPick?.(l)}
            aria-pressed={on}
            aria-label={`${COMP_LIFT_LABEL[l]}: ${pct(share)} of the total`}
            data-dna-part={l}
            className={cn(
              "relative h-full min-w-0 overflow-hidden rounded-[5px] text-left transition-[flex-grow,opacity,box-shadow] duration-500 ease-out",
              picked && !on && "opacity-55",
              on && "shadow-[0_0_0_2px_var(--card),0_0_0_4px_var(--foreground)]",
            )}
            style={{ flexGrow: share, flexBasis: 0, background: LIFT_SERIES[l] }}
          >
            {share >= 0.12 && (
              <span className="absolute inset-y-0 left-2 flex items-center text-[12px] font-semibold tabular-nums text-white">
                {pct(share)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** A thin bar for a comparison split (typical lifter, their own average), the same order and colours, quieter. */
function ThinSplit({
  shares,
  label,
  testId,
}: {
  shares: Record<CompLift, number>;
  label: string;
  testId?: string;
}) {
  return (
    <div className="flex items-center gap-2" data-testid={testId}>
      <span className="w-[42%] shrink-0 truncate text-[11px] text-muted-foreground sm:w-40">
        {label}
      </span>
      <div
        className="flex h-2 min-w-0 flex-1 gap-[2px]"
        aria-label={`${label}: ${COMP_LIFTS.map((l) => `${COMP_LIFT_LABEL[l]} ${pct(shares[l])}`).join(", ")}`}
        role="img"
      >
        {COMP_LIFTS.map((l) => (
          <span
            key={l}
            className="h-full rounded-full opacity-60"
            style={{ flexGrow: shares[l], flexBasis: 0, background: LIFT_SERIES[l] }}
          />
        ))}
      </div>
    </div>
  );
}

function sourceLine(t: DnaTotal): string {
  if (t.kind === "meet") return fmtDay(t.day);
  if (t.kind === "best")
    return t.sameDay
      ? `All three on ${fmtDay(t.day)}`
      : "Each lift's heaviest single, from different days";
  return "Best hard set of each lift in the last 6 weeks";
}

export function StrengthDnaCard({
  dna,
  unit,
  sex,
  compact = false,
  onOpen,
}: {
  dna: Dna;
  unit: Unit;
  sex: DnaSex | null;
  /** the Overview's version: the bar, the total and one line; a tap opens Strength */
  compact?: boolean;
  onOpen?: () => void;
}) {
  const initial = defaultDnaKind(dna.has);
  const [kindPick, setKind] = useState<DnaKind | null>(null);
  const kind: DnaKind | null = kindPick && dna.has[kindPick] ? kindPick : initial;
  const [meetIdx, setMeetIdx] = useState(0);
  const [picked, setPicked] = useState<CompLift | null>(null);
  const total: DnaTotal | null =
    kind === "estimate"
      ? dna.estimate
      : kind === "best"
        ? dna.best
        : kind === "meet"
          ? (dna.meets[Math.min(meetIdx, dna.meets.length - 1)] ?? null)
          : null;
  // the history it's read against: every other meet, or the months before this one
  const read = useMemo(() => {
    if (!total) return null;
    const thisMonth = format(new Date(), "yyyy-MM");
    const history =
      kind === "meet"
        ? dna.meets
        : kind === "estimate"
          ? dna.months.filter((m) => m.label < thisMonth)
          : [];
    return readDna(total, sex, history, { delta: (lb) => loadDelta(lb, unit) });
  }, [total, kind, dna.meets, dna.months, sex, unit]);
  if (!total || !kind || !read) return null;

  const options = (["estimate", "meet", "best"] as DnaKind[])
    .filter((k) => dna.has[k])
    .map(
      (k) =>
        [k, k === "estimate" ? "Estimated now" : k === "meet" ? "Meet" : "Best lifts"] as [
          DnaKind,
          string,
        ],
    );

  if (compact) {
    return (
      <Card className="p-0" data-strength-dna="compact">
        <button
          type="button"
          onClick={onOpen}
          className="block w-full rounded-2xl p-4 text-left transition active:bg-muted/40"
          aria-label="Open Strength"
        >
          <div className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
            <span className="min-w-0 flex-1 truncate">
              Strength DNA ·{" "}
              {kind === "meet" ? total.label : options.find(([k]) => k === kind)?.[1]}
            </span>
            <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
          </div>
          <div className="mt-1.5">
            <DualWeight lb={total.totalLb} unit={unit} size="lg" />
          </div>
          <div className="mt-3">
            <DnaBar total={total} picked={null} />
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {COMP_LIFTS.map((l) => (
              <div key={l} className="min-w-0">
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: LIFT_SERIES[l] }}
                    aria-hidden
                  />
                  {COMP_LIFT_LABEL[l]}
                </div>
                <div className="truncate text-[13px] font-semibold tabular-nums text-foreground">
                  {loadText(total.parts[l].lb, unit)}
                </div>
              </div>
            ))}
          </div>
          {read.notes[0] && (
            <p className="mt-2.5 text-[12px] leading-snug text-muted-foreground">{read.notes[0]}</p>
          )}
        </button>
      </Card>
    );
  }

  const meet = kind === "meet" ? total : null;
  const typical = sex ? TYPICAL_SPLIT[sex] : null;
  const prev = read.previous;
  const series = kind === "meet" ? [...dna.meets].reverse() : kind === "estimate" ? dna.months : [];
  const recentSeries = series.slice(-8);

  return (
    <Card className="space-y-4 p-4" data-strength-dna="full" data-dna-kind={kind}>
      <LabHeader
        title="Strength DNA"
        sub="What your squat-bench-deadlift total is made of"
        tip={
          <InfoTip label="About Strength DNA" title="Strength DNA" align="start">
            Each lift as a share of a total. Meet: what you lifted on the platform that day. Best
            lifts: each lift's heaviest single (a meet, a tested 1RM or a single in training), from
            whatever day it was. Estimated now: each lift's best estimate from a hard set (RPE 7+,
            10 reps or fewer) in the last 6 weeks. They're never mixed. The typical split is the
            average of raw meet results (men 35 / 24 / 41, women 35.5 / 20.5 / 44); a share "leans"
            2+ points away from it. It describes your total; it can't say which lift to train.
          </InfoTip>
        }
      />
      {options.length > 1 && (
        <Seg
          label="Which total"
          value={kind}
          options={options}
          onChange={(k) => {
            setKind(k);
            setPicked(null);
          }}
          stretch
          testId="dna-source"
        />
      )}
      {meet && dna.meets.length > 1 && (
        <Stepper
          label={<span title={meet.label}>{meet.label}</span>}
          onPrev={meetIdx < dna.meets.length - 1 ? () => setMeetIdx((i) => i + 1) : null}
          onNext={meetIdx > 0 ? () => setMeetIdx((i) => i - 1) : null}
        />
      )}

      <div key={total.key} className="jf-lab-in">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <div>
            <DualWeight lb={total.totalLb} unit={unit} size="xl" stacked={false} />
            <div className="mt-1 text-[12px] text-muted-foreground" data-dna-source>
              {kind === "meet" ? fmtDay(total.day) : sourceLine(total)}
            </div>
          </div>
          {(read.timesBodyweight || total.gl) && (
            <div className="flex gap-3 text-right" data-dna-relative>
              {read.timesBodyweight != null && (
                <div>
                  <div className="text-[18px] font-semibold tabular-nums text-foreground">
                    {read.timesBodyweight.toFixed(2)}×
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    bodyweight ({loadText(total.bodyweightLb!, unit)})
                  </div>
                </div>
              )}
              {total.gl && (
                <div>
                  <div className="text-[18px] font-semibold tabular-nums text-foreground">
                    {total.gl.value.toFixed(1)}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    GL points{total.gl.estimate ? " (estimate)" : ""}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-4 space-y-2">
          <DnaBar
            total={total}
            picked={picked}
            onPick={(l) => setPicked((p) => (p === l ? null : l))}
          />
          {typical && (
            <ThinSplit
              shares={typical}
              label={`Typical raw ${sex === "male" ? "men's" : "women's"} total`}
              testId="dna-typical"
            />
          )}
          {read.own && read.own.count >= 2 && (
            <ThinSplit
              shares={read.own.mean}
              label={kind === "meet" ? "Your meet average" : "Your earlier months"}
              testId="dna-own"
            />
          )}
        </div>

        {/* the table view: every number the bar draws, and how it compares */}
        <table className="mt-4 w-full text-[13px]" data-dna-table>
          <thead>
            <tr className="text-[11px] text-muted-foreground">
              <th className="pb-1.5 text-left font-normal">Lift</th>
              <th className="pb-1.5 text-right font-normal">Weight</th>
              <th className="pb-1.5 text-right font-normal">Share</th>
              {read.typical && <th className="pb-1.5 text-right font-normal">vs typical</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {COMP_LIFTS.map((l) => {
              const part = total.parts[l];
              const tl = read.typical?.lines.find((x) => x.lift === l);
              const on = picked === l;
              return (
                <tr
                  key={l}
                  className={cn("cursor-pointer align-top transition-colors", on && "bg-muted/60")}
                  onClick={() => setPicked((p) => (p === l ? null : l))}
                  data-dna-row={l}
                >
                  <td className="py-2 pr-2">
                    <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                        style={{ background: LIFT_SERIES[l] }}
                        aria-hidden
                      />
                      {COMP_LIFT_LABEL[l]}
                    </span>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {part.source === "estimate" && part.set
                        ? `${loadText(part.set.load, unit)} × ${part.set.reps}${part.set.effort ? ` @ ${part.set.effort}` : ""} · ${fmtDay(part.day, "MMM d")}`
                        : kind === "best"
                          ? `${part.from} · ${fmtDay(part.day, "MMM d, yyyy")}`
                          : null}
                    </div>
                  </td>
                  <td className="py-2 text-right">
                    <DualWeight lb={part.lb} unit={unit} size="sm" stacked className="items-end" />
                  </td>
                  <td className="py-2 pl-2 text-right font-semibold tabular-nums text-foreground">
                    {pct(part.share)}
                  </td>
                  {read.typical && (
                    <td
                      className={cn(
                        "py-2 pl-2 text-right tabular-nums",
                        tl?.leans ? "font-semibold text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {tl ? signedPts(tl.points) : "—"}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>

        {picked && (
          <LiftDetail
            lift={picked}
            total={total}
            read={read}
            unit={unit}
            series={series}
            sex={sex}
          />
        )}

        {read.notes.length > 0 && (
          <ul className="mt-3 space-y-1.5" data-dna-notes>
            {read.notes.map((n) => (
              <li key={n} className="flex gap-2 text-[13px] leading-snug text-foreground">
                <span
                  className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-muted-foreground"
                  aria-hidden
                />
                <span>{n}</span>
              </li>
            ))}
          </ul>
        )}
        {!sex && (
          <p className="mt-2 text-[12px] text-muted-foreground">
            Add sex in Account to compare with typical raw totals (they differ for men and women).
          </p>
        )}

        {prev && (
          <div className="mt-4 rounded-xl bg-muted/50 p-3" data-dna-previous>
            <div className="text-[12px] text-muted-foreground">
              Since{" "}
              {prev.total.kind === "meet"
                ? `${prev.total.label} (${fmtDay(prev.total.day, "MMM yyyy")})`
                : `the end of ${monthName(prev.total.label)}`}
            </div>
            <div className="mt-1 grid grid-cols-4 gap-2">
              <Change label="Total" lb={prev.totalLb} unit={unit} />
              {COMP_LIFTS.map((l) => (
                <Change key={l} label={COMP_LIFT_LABEL[l]} lb={prev.lifts[l]} unit={unit} />
              ))}
            </div>
          </div>
        )}
      </div>

      {recentSeries.length >= 2 && (
        <div data-dna-history>
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h4 className="text-[13px] font-semibold text-foreground">
              {kind === "meet" ? "Split meet by meet" : "Split month by month"}
            </h4>
            <span className="text-[11px] text-muted-foreground">
              {recentSeries.length === series.length ? "" : `last ${recentSeries.length}`}
            </span>
          </div>
          <div className="space-y-1.5">
            {recentSeries.map((t) => (
              <button
                key={t.key}
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 rounded-md text-left",
                  t.key === total.key && "font-semibold",
                )}
                onClick={() => {
                  if (kind === "meet") setMeetIdx(dna.meets.findIndex((m) => m.key === t.key));
                }}
                aria-label={`${t.kind === "meet" ? `${t.label}, ${fmtDay(t.day)}` : monthName(t.label)}: ${COMP_LIFTS.map((l) => `${COMP_LIFT_LABEL[l]} ${pct(t.parts[l].share)}`).join(", ")}; total ${loadText(t.totalLb, unit)}`}
              >
                <span className="w-[4.5rem] shrink-0 truncate text-[11px] tabular-nums text-muted-foreground">
                  {t.kind === "meet" ? fmtDay(t.day, "MMM yyyy") : monthName(t.label, true)}
                </span>
                <span className="flex h-3 min-w-0 flex-1 gap-[2px]">
                  {COMP_LIFTS.map((l) => (
                    <span
                      key={l}
                      className={cn(
                        "h-full rounded-[3px] transition-opacity",
                        picked && picked !== l && "opacity-30",
                      )}
                      style={{
                        flexGrow: t.parts[l].share,
                        flexBasis: 0,
                        background: LIFT_SERIES[l],
                      }}
                    />
                  ))}
                </span>
                <span className="w-16 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                  {loadText(t.totalLb, unit)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function monthName(key: string, short = false): string {
  const d = parseLocalDate(`${key}-01`);
  return d ? format(d, short ? "MMM yyyy" : "MMMM yyyy") : key;
}

function Change({ label, lb, unit }: { label: string; lb: number; unit: Unit }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[11px] text-muted-foreground">{label}</div>
      <div className="truncate text-[13px] font-semibold tabular-nums text-foreground">
        {loadDelta(lb, unit)}
      </div>
    </div>
  );
}

function LiftDetail({
  lift,
  total,
  read,
  unit,
  series,
  sex,
}: {
  lift: CompLift;
  total: DnaTotal;
  read: ReturnType<typeof readDna>;
  unit: Unit;
  series: DnaTotal[];
  sex: DnaSex | null;
}) {
  const part = total.parts[lift];
  const typ = sex ? TYPICAL_SPLIT[sex][lift] : null;
  const own = read.own?.mean[lift] ?? null;
  const shares = series.filter((s) => s.day).map((s) => s.parts[lift].share);
  const lo = Math.min(...shares, part.share) - 0.01;
  const hi = Math.max(...shares, part.share) + 0.01;
  return (
    <div className="jf-lab-in mt-3 rounded-xl border border-border p-3" data-dna-lift-detail={lift}>
      <div className="flex items-center gap-2">
        <span
          className="h-3 w-3 rounded-[3px]"
          style={{ background: LIFT_SERIES[lift] }}
          aria-hidden
        />
        <span className="text-[14px] font-semibold text-foreground">{COMP_LIFT_LABEL[lift]}</span>
        <span className="ml-auto text-[13px] tabular-nums text-muted-foreground">
          {pct(part.share)} of the total
        </span>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-[12px]">
        <div>
          <dt className="text-muted-foreground">Weight</dt>
          <dd>
            <DualWeight lb={part.lb} unit={unit} size="sm" />
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">From</dt>
          <dd className="text-foreground">
            {part.source === "estimate" ? "Estimate" : part.from}
            {part.day ? `, ${fmtDay(part.day, "MMM d, yyyy")}` : ""}
          </dd>
        </div>
        {typ != null && (
          <div>
            <dt className="text-muted-foreground">
              Typical raw {sex === "male" ? "men's" : "women's"} share
            </dt>
            <dd className="tabular-nums text-foreground">{pct(typ)}</dd>
          </div>
        )}
        {own != null && (
          <div>
            <dt className="text-muted-foreground">
              {total.kind === "meet" ? "Your other meets" : "Your earlier months"}
            </dt>
            <dd className="tabular-nums text-foreground">{pct(own)}</dd>
          </div>
        )}
      </dl>
      {shares.length >= 2 && (
        <div className="mt-3">
          <div className="mb-1 text-[11px] text-muted-foreground">Its share over time</div>
          <svg
            viewBox={`0 0 ${Math.max(1, shares.length - 1) * 20} 40`}
            preserveAspectRatio="none"
            className="h-10 w-full"
            role="img"
            aria-label={`${COMP_LIFT_LABEL[lift]} share over time: ${shares.map(pct).join(", ")}`}
          >
            <polyline
              fill="none"
              stroke={LIFT_SERIES[lift]}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
              points={shares
                .map((s, i) => `${i * 20},${40 - ((s - lo) / (hi - lo)) * 36 - 2}`)
                .join(" ")}
            />
          </svg>
          <div className="flex justify-between text-[11px] tabular-nums text-muted-foreground">
            <span>{pct(shares[0])}</span>
            <span>{pct(shares[shares.length - 1])}</span>
          </div>
        </div>
      )}
      <div className="mt-2 text-[12px] text-muted-foreground">
        {read.ratios.map((r) => (
          <span key={r.key} className="mr-3 inline-block tabular-nums">
            {r.label} {r.value.toFixed(2)}
            {r.typical != null ? ` (typical ${r.typical.toFixed(2)})` : ""}
          </span>
        ))}
      </div>
    </div>
  );
}
