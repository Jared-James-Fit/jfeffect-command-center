import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { ATHLETE_SEX_KEYS, SexChoice } from "@/components/athlete-sex";
import type { AthleteSex } from "@/lib/athlete-sex";
import { fmtNum } from "@/lib/analytics-format";
import {
  COMP_LIFTS,
  COMP_LIFT_LABEL,
  CURRENT_DAYS,
  totalStanding,
  type MeetResult,
  type StrengthPoint,
} from "@/lib/analytics/competition-strength";
import { sbdSplit } from "@/lib/analytics/sbd-split";
import type { CompetitionData } from "@/lib/analytics/competition-strength.queries";
import { LIFT_SERIES } from "@/components/analytics/competition-strength-chart";
import { parseLocalDate } from "@/lib/today";
import { cn } from "@/lib/utils";

const day = (iso: string, f = "MMM d") => {
  const d = parseLocalDate(iso);
  return d ? format(d, f) : iso;
};

/**
 * Where the athlete stands on the competition lifts, with each number said
 * for what it is: the last meet (tested), the current estimate per lift (hard
 * sets from the last 6 weeks, with the set behind it), an older estimate with
 * its date, and the coach's training max apart. A current total only when all
 * three lifts have a current estimate; the split is descriptive and never a
 * prescription (a lift's share of a total alone can't say where the next
 * pounds are).
 */
export function TotalStandingCard({
  clientId,
  points,
  data,
  unit,
  conv,
  today,
  coach = false,
}: {
  clientId: string;
  points: StrengthPoint[];
  data: CompetitionData;
  unit: "lb" | "kg";
  conv: (lb: number) => number;
  today: string;
  coach?: boolean;
}) {
  const qc = useQueryClient();
  const [savingSex, setSavingSex] = useState<AthleteSex | null>(null);
  const st = useMemo(
    () => totalStanding({ points, meets: data.meets, trainingMaxes: data.trainingMaxes, today }),
    [points, data, today],
  );
  const meet = st.lastMeet;
  const splitFrom: { label: string; lifts: Record<"squat" | "bench" | "deadlift", number> } | null =
    st.currentTotal != null
      ? {
          label: "Your current estimates",
          lifts: {
            squat: st.lifts.squat.current!.lb,
            bench: st.lifts.bench.current!.lb,
            deadlift: st.lifts.deadlift.current!.lb,
          },
        }
      : meet
        ? { label: `Your ${day(meet.date, "MMM yyyy")} meet`, lifts: meet.lifts }
        : null;
  const split = splitFrom ? sbdSplit(splitFrom.lifts, data.sex) : null;
  const total = (lb: number) => Math.round(conv(lb)).toLocaleString();
  const askSex = !!split && !data.sex && !data.profileSex;

  if (!meet && !COMP_LIFTS.some((l) => st.lifts[l].latest)) return null;

  const saveSex = async (sex: AthleteSex) => {
    setSavingSex(sex);
    const { error } = await supabase.from("clients").update({ sex }).eq("id", clientId);
    setSavingSex(null);
    if (error) return toast.error("Couldn't save", { description: error.message });
    await Promise.all([
      ...ATHLETE_SEX_KEYS.map((queryKey) => qc.invalidateQueries({ queryKey: [...queryKey] })),
      qc.invalidateQueries({ queryKey: ["competition-data", clientId] }),
    ]);
  };

  return (
    <Card className="space-y-4 p-4" data-testid="total-standing">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-[12px] text-muted-foreground">Last meet total</div>
          {meet ? (
            <>
              <div className="mt-0.5 text-2xl font-semibold tabular-nums">
                {total(meet.total)}{" "}
                <span className="text-sm font-normal text-muted-foreground">{unit}</span>
              </div>
              <div className="truncate text-[12px] text-muted-foreground">
                {day(meet.date, "MMM d, yyyy")}
                {meet.name ? ` · ${meet.name}` : ""}
              </div>
            </>
          ) : (
            <div className="mt-0.5 text-sm text-muted-foreground">No meet on file</div>
          )}
        </div>
        <div>
          <div className="text-[12px] text-muted-foreground">Estimated today</div>
          {st.currentTotal != null ? (
            <>
              <div className="mt-0.5 text-2xl font-semibold tabular-nums">
                {total(st.currentTotal)}{" "}
                <span className="text-sm font-normal text-muted-foreground">{unit}</span>
              </div>
              {st.vsMeet != null && Math.abs(conv(st.vsMeet)) >= 1 && (
                <div className="text-[12px] text-muted-foreground">
                  {st.vsMeet > 0 ? "+" : "−"}
                  {total(Math.abs(st.vsMeet))} vs that meet (estimate)
                </div>
              )}
            </>
          ) : (
            <>
              <div className="mt-0.5 text-2xl font-semibold text-muted-foreground">—</div>
              <div className="text-[12px] leading-snug text-muted-foreground" data-total-missing>
                Needs a hard {st.missing.map((l) => COMP_LIFT_LABEL[l].toLowerCase()).join(" and ")}{" "}
                set in the last {CURRENT_DAYS / 7} weeks
              </div>
            </>
          )}
        </div>
      </div>

      {/* Each lift: meet · estimate (and the set behind it) · training max, each labelled. */}
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[12px] text-muted-foreground">
              <th className="py-1 pr-2 font-normal">Lift</th>
              {meet && <th className="py-1 pr-2 text-right font-normal">Meet</th>}
              <th className="py-1 pr-2 text-right font-normal">Estimate</th>
              {COMP_LIFTS.some((l) => st.lifts[l].trainingMax) && (
                <th className="py-1 text-right font-normal">Training max</th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {COMP_LIFTS.map((l) => {
              const s = st.lifts[l];
              const est = s.current ?? s.latest;
              const old = !s.current && !!s.latest;
              return (
                <tr key={l} className="align-top">
                  <td className="py-2 pr-2">
                    <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ background: LIFT_SERIES[l] }}
                        aria-hidden
                      />
                      {COMP_LIFT_LABEL[l]}
                    </span>
                  </td>
                  {meet && (
                    <td className="py-2 pr-2 text-right tabular-nums">
                      {fmtNum(conv(meet.lifts[l]))}
                    </td>
                  )}
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {est ? (
                      <>
                        <span className={cn(old && "text-muted-foreground")}>
                          {Math.round(conv(est.lb))}
                        </span>
                        <div className="text-[11px] text-muted-foreground">
                          {fmtNum(conv(est.set.load))}×{est.set.reps} @{est.set.effort} ·{" "}
                          {day(est.day)}
                          {old ? " · older" : ""}
                        </div>
                      </>
                    ) : (
                      <span className="text-muted-foreground">No hard sets</span>
                    )}
                  </td>
                  {COMP_LIFTS.some((x) => st.lifts[x].trainingMax) && (
                    <td className="py-2 text-right tabular-nums text-muted-foreground">
                      {s.trainingMax ? fmtNum(conv(s.trainingMax.lb)) : "—"}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {split && (
        <div data-total-split>
          <div className="flex items-baseline justify-between gap-2 text-[12px] text-muted-foreground">
            <span>Share of total · {splitFrom!.label}</span>
          </div>
          <div
            className="mt-1.5 flex h-2.5 gap-[2px] overflow-hidden rounded-full"
            role="img"
            aria-label="Share of total by lift"
          >
            {split.lifts.map((x) => (
              <div
                key={x.lift}
                style={{ width: `${x.share * 100}%`, background: LIFT_SERIES[x.lift] }}
              />
            ))}
          </div>
          <div className="mt-1.5 grid grid-cols-3 gap-2 text-[12px]">
            {split.lifts.map((x) => (
              <div key={x.lift}>
                <span className="font-medium text-foreground">
                  {COMP_LIFT_LABEL[x.lift]} {fmtNum(x.share * 100)}%
                </span>
                <div className="text-muted-foreground">
                  typical {Math.round(x.range[0] * 100)}–{Math.round(x.range[1] * 100)}%
                </div>
              </div>
            ))}
          </div>
          <p
            className="mt-2 text-[12px] leading-relaxed text-muted-foreground"
            data-total-split-read
          >
            {(() => {
              const out = split.lifts.filter((x) => x.status !== "within");
              if (!out.length) return "Every lift sits inside the typical range for raw lifters. ";
              return `${out.map((x) => `${COMP_LIFT_LABEL[x.lift]} is a ${x.status === "above" ? "bigger" : "smaller"} share than typical`).join("; ")}. `;
            })()}
            Leverages, weight class and training history move these, so a share alone never says
            which lift to train more.
          </p>
          {askSex && (
            <div className="mt-3 rounded-xl border border-border p-3" data-testid="sbd-ask-sex">
              <p className="mb-2 text-xs text-muted-foreground">
                Typical splits differ for men and women. Set it to compare against the right range.
              </p>
              <SexChoice
                value={null}
                onChange={(v) => void saveSex(v)}
                disabled={!!savingSex}
                pending={savingSex}
              />
            </div>
          )}
        </div>
      )}

      {coach &&
        COMP_LIFTS.some(
          (l) =>
            st.lifts[l].trainingMax &&
            st.lifts[l].latest &&
            st.lifts[l].trainingMax!.lb > st.lifts[l].latest!.lb * 1.5,
        ) && (
          <p className="text-[12px] text-muted-foreground">
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
