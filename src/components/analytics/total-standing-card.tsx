import { useMemo } from "react";
import { format } from "date-fns";
import { Card } from "@/components/ui/card";
import { fmtNum } from "@/lib/analytics-format";
import {
  COMP_LIFTS,
  COMP_LIFT_LABEL,
  CURRENT_DAYS,
  totalStanding,
  type CompLift,
  type MeetResult,
  type StrengthPoint,
} from "@/lib/analytics/competition-strength";
import type { MaxOnFile } from "@/lib/analytics/analytics-areas";
import type { CompetitionData } from "@/lib/analytics/competition-strength.queries";
import { LIFT_SERIES } from "@/components/analytics/competition-strength-chart";
import { parseLocalDate } from "@/lib/today";
import { cn } from "@/lib/utils";

const day = (iso: string | null, f = "MMM d") => {
  const d = iso ? parseLocalDate(iso) : null;
  return d ? format(d, f) : "";
};

/**
 * Where the athlete stands on the competition lifts, as one table where every
 * column is a different kind of number and says so:
 *  - Est. now: the best estimate from a hard set in the last 6 weeks (an
 *    estimate, with its day);
 *  - Last meet: what was lifted on the platform;
 *  - 1RM on file: a max on the client's file, marked tested (with its day)
 *    or entered by the coach;
 *  - Training max: the coach's number the program reads % loads from, never
 *    a measurement.
 * A total only where all three lifts have one. Where there's no current
 * estimate, the line under says exactly what's needed. No "typical split":
 * a share of a total can't say which lift to train (Nov 22 2026).
 */
export function TotalStandingCard({
  points,
  data,
  unit,
  conv,
  today,
  coach = false,
}: {
  clientId?: string;
  points: StrengthPoint[];
  data: CompetitionData;
  unit: "lb" | "kg";
  conv: (lb: number) => number;
  today: string;
  coach?: boolean;
}) {
  const st = useMemo(
    () => totalStanding({ points, meets: data.meets, trainingMaxes: data.trainingMaxes, today }),
    [points, data, today],
  );
  const meet = st.lastMeet;
  const maxOf = (lift: CompLift, kinds: MaxOnFile["kind"][]) =>
    (data.maxes ?? []).find((m) => m.lift === lift && kinds.includes(m.kind)) ?? null;
  const oneRm = (lift: CompLift) => maxOf(lift, ["tested"]) ?? maxOf(lift, ["on_file"]);
  const hasOneRm = COMP_LIFTS.some((l) => oneRm(l));
  const hasTm = COMP_LIFTS.some((l) => st.lifts[l].trainingMax);
  const n = (lb: number) => Math.round(conv(lb)).toLocaleString();

  if (!meet && !COMP_LIFTS.some((l) => st.lifts[l].latest) && !hasOneRm && !hasTm) return null;

  const stale = COMP_LIFTS.filter((l) => !st.lifts[l].current);
  return (
    <Card className="p-3 sm:p-4" data-testid="total-standing">
      <table className="w-full table-fixed text-[13px]" data-standing-table>
        <colgroup>
          <col className="w-[27%]" />
          <col />
          {meet && <col />}
          {hasOneRm && <col />}
          {hasTm && <col />}
        </colgroup>
        <thead>
          <tr className="align-bottom text-[11px] leading-tight text-muted-foreground">
            <th className="pb-1.5 text-left font-normal" />
            <th className="pb-1.5 pl-1 text-right font-normal">
              Est.
              <br />
              now
            </th>
            {meet && (
              <th className="pb-1.5 pl-1 text-right font-normal">
                Last
                <br />
                meet
              </th>
            )}
            {hasOneRm && (
              <th className="pb-1.5 pl-1 text-right font-normal">
                1RM on
                <br />
                file
              </th>
            )}
            {hasTm && (
              <th className="pb-1.5 pl-1 text-right font-normal">
                Training
                <br />
                max
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {COMP_LIFTS.map((l) => {
            const s = st.lifts[l];
            const r = oneRm(l);
            return (
              <tr key={l} className="align-top" data-standing-lift={l}>
                <td className="py-2">
                  <span className="inline-flex min-w-0 items-center gap-1.5 font-medium text-foreground">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: LIFT_SERIES[l] }}
                      aria-hidden
                    />
                    <span className="truncate">{COMP_LIFT_LABEL[l]}</span>
                  </span>
                </td>
                <td className="py-2 text-right tabular-nums">
                  {s.current ? (
                    <>
                      <div className="font-semibold text-foreground">{n(s.current.lb)}</div>
                      <div className="text-[11px] text-muted-foreground">{day(s.current.day)}</div>
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                {meet && (
                  <td className="py-2 text-right tabular-nums">
                    {unit === "lb" ? n(meet.lifts[l]) : fmtNum(conv(meet.lifts[l]))}
                  </td>
                )}
                {hasOneRm && (
                  <td className="py-2 text-right tabular-nums">
                    {r ? (
                      <>
                        <div>{n(r.lb)}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {r.kind === "tested" ? "tested" : "entered"}
                        </div>
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                )}
                {hasTm && (
                  <td className="py-2 text-right tabular-nums text-muted-foreground">
                    {s.trainingMax ? n(s.trainingMax.lb) : "—"}
                  </td>
                )}
              </tr>
            );
          })}
          <tr className="align-top" data-standing-total>
            <td className="py-2 font-medium text-foreground">Total</td>
            <td className="py-2 text-right font-semibold tabular-nums">
              {st.currentTotal != null ? (
                n(st.currentTotal)
              ) : (
                <span className="font-normal text-muted-foreground">—</span>
              )}
            </td>
            {meet && (
              <td className="py-2 text-right font-semibold tabular-nums">{n(meet.total)}</td>
            )}
            {hasOneRm && (
              <td className="py-2 text-right tabular-nums text-muted-foreground">
                {COMP_LIFTS.every((l) => oneRm(l))
                  ? n(COMP_LIFTS.reduce((a, l) => a + oneRm(l)!.lb, 0))
                  : "—"}
              </td>
            )}
            {hasTm && <td className="py-2" />}
          </tr>
        </tbody>
      </table>

      <div className="mt-2 space-y-1 text-[12px] leading-snug text-muted-foreground">
        {meet && (
          <p data-standing-meet>
            Last meet: {meet.name ?? "Competition"}, {day(meet.date, "MMM d, yyyy")} ({unit})
          </p>
        )}
        {(() => {
          const tested = COMP_LIFTS.map((l) => oneRm(l)).filter(
            (r): r is MaxOnFile => !!r && r.kind === "tested" && !!r.date,
          );
          const days = [...new Set(tested.map((r) => r.date!))];
          return days.length ? (
            <p data-standing-tested>Tested {days.map((d) => day(d, "MMM d, yyyy")).join(", ")}.</p>
          ) : null;
        })()}
        {stale.length > 0 && (
          <p data-total-missing>
            {stale
              .map((l) => {
                const last = st.lifts[l].latest;
                return `${COMP_LIFT_LABEL[l]}: no hard set (RPE 7+, 10 reps or fewer) in the last ${CURRENT_DAYS / 7} weeks${
                  last ? ` (last ${n(last.lb)} on ${day(last.day)})` : ""
                }`;
              })
              .join(". ")}
            . An estimated total needs all three.
          </p>
        )}
      </div>

      {coach &&
        COMP_LIFTS.some(
          (l) =>
            st.lifts[l].trainingMax &&
            st.lifts[l].latest &&
            st.lifts[l].trainingMax!.lb > st.lifts[l].latest!.lb * 1.5,
        ) && (
          <p className={cn("mt-2 text-[12px] text-muted-foreground")}>
            A training max is over 1.5× the athlete's best logged estimate. Check its unit in the
            client's maxes: it sets their % loads.
          </p>
        )}
    </Card>
  );
}

/** For other readers: the meets in a period (newest first). */
export function meetsInPeriod(meets: MeetResult[], start: Date, end: Date): MeetResult[] {
  return meets.filter((m) => {
    const d = parseLocalDate(m.date);
    return d && d >= start && d <= end;
  });
}
