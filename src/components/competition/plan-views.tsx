/**
 * The competition plan's pieces as the coach, the athlete and the meet-day
 * screen read them (one rendering, so they never disagree): the forecast's
 * three scenarios, the attempts with their pathways and conditions, the
 * warm-ups, and the day in order. kg first with lb beside it, never cramped.
 */
import { LIFT_LABEL, type Lift, type Range } from "@/lib/competition/types";
import { toLb } from "@/lib/competition/rules";
import { cn } from "@/lib/utils";

const LIFTS: Lift[] = ["squat", "bench", "deadlift"];

export function Kg({
  kg,
  lb = true,
  className,
}: {
  kg: number | null | undefined;
  lb?: boolean;
  className?: string;
}) {
  if (kg == null || !Number.isFinite(kg)) return <span className={className}>—</span>;
  const k = Math.round(kg * 10) / 10;
  return (
    <span className={cn("tabular-nums", className)}>
      {k} kg
      {lb ? (
        <span className="ml-1 text-[0.85em] font-normal text-muted-foreground">{toLb(kg)} lb</span>
      ) : null}
    </span>
  );
}

export function RangeText({ r, lb = false }: { r: Range | null | undefined; lb?: boolean }) {
  if (!r) return <span className="text-muted-foreground">Not enough data</span>;
  return (
    <span className="tabular-nums">
      <span className="text-muted-foreground">{r.conservative}</span>
      <span className="mx-1 font-semibold text-foreground">{r.expected}</span>
      <span className="text-muted-foreground">{r.high}</span>
      <span className="ml-1 text-muted-foreground">kg{lb ? ` · ${toLb(r.expected)} lb` : ""}</span>
    </span>
  );
}

type ForecastLike = {
  lifts: Partial<Record<Lift, { range: Range; confidence: string; basis?: string[] } | null>>;
  total: Range | null;
  confidence?: string;
  limitations?: string[];
};

/** Conservative · expected · high per lift and the total. */
export function ForecastTable({
  forecast,
  showBasis = false,
}: {
  forecast: ForecastLike | null | undefined;
  showBasis?: boolean;
}) {
  if (!forecast)
    return (
      <p className="text-[14px] text-muted-foreground">
        No forecast yet: not enough training or meet data.
      </p>
    );
  return (
    <div className="overflow-x-auto" data-forecast-table>
      <table className="w-full min-w-[320px] text-[14px]">
        <thead>
          <tr className="border-b border-border text-left text-[12px] text-muted-foreground">
            <th className="py-2 pr-2 font-medium">Lift</th>
            <th className="px-2 py-2 text-right font-medium">Conservative</th>
            <th className="px-2 py-2 text-right font-medium">Expected</th>
            <th className="py-2 pl-2 text-right font-medium">High</th>
          </tr>
        </thead>
        <tbody>
          {LIFTS.map((l) => {
            const f = forecast.lifts[l];
            return (
              <tr key={l} className="border-b border-border/60 align-top">
                <td className="py-2 pr-2">
                  <div className="font-medium">{LIFT_LABEL[l]}</div>
                  {f ? (
                    <div className="text-[12px] text-muted-foreground">
                      {f.confidence} confidence
                    </div>
                  ) : null}
                  {showBasis && f?.basis?.length ? (
                    <ul className="mt-1 space-y-0.5 text-[12px] text-muted-foreground">
                      {f.basis.map((b, i) => (
                        <li key={i}>{b}</li>
                      ))}
                    </ul>
                  ) : null}
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
                  {f?.range.conservative ?? "—"}
                </td>
                <td className="px-2 py-2 text-right font-semibold tabular-nums">
                  {f?.range.expected ?? "—"}
                </td>
                <td className="py-2 pl-2 text-right tabular-nums text-muted-foreground">
                  {f?.range.high ?? "—"}
                </td>
              </tr>
            );
          })}
          <tr className="align-top">
            <td className="py-2 pr-2 font-semibold">Total</td>
            <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
              {forecast.total?.conservative ?? "—"}
            </td>
            <td className="px-2 py-2 text-right text-[16px] font-semibold tabular-nums">
              {forecast.total?.expected ?? "—"}
            </td>
            <td className="py-2 pl-2 text-right tabular-nums text-muted-foreground">
              {forecast.total?.high ?? "—"}
            </td>
          </tr>
        </tbody>
      </table>
      <p className="mt-1 text-[12px] text-muted-foreground">
        kg. Three scenarios from training and past meets, never a probability.
      </p>
      {forecast.limitations?.length ? (
        <ul className="mt-2 space-y-1 text-[12px] text-muted-foreground">
          {forecast.limitations.map((x, i) => (
            <li key={i}>· {x}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

type LiftAttemptsLike = {
  opener: number;
  openerConservative?: number;
  second: { low: number; high: number };
  third: { low: number; high: number };
  pathways?: { conservative: number[]; balanced: number[]; aggressive: number[] };
  conditional?: Array<{ when: string; then: string }>;
  contingencies?: Array<{ when: string; then: string }>;
  why?: string[];
};

export function AttemptsView({
  attempts,
  detail = true,
}: {
  attempts: Partial<Record<Lift, LiftAttemptsLike | null>> | null | undefined;
  detail?: boolean;
}) {
  if (!attempts) return <p className="text-[14px] text-muted-foreground">No attempts yet.</p>;
  return (
    <div className="space-y-4" data-attempts-view>
      {LIFTS.map((l) => {
        const a = attempts[l];
        if (!a)
          return (
            <div
              key={l}
              className="rounded-xl border border-border p-3 text-[14px] text-muted-foreground"
            >
              {LIFT_LABEL[l]}: no estimate yet
            </div>
          );
        return (
          <div key={l} className="rounded-xl border border-border p-3" data-attempt-lift={l}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h4 className="text-[15px] font-semibold">{LIFT_LABEL[l]}</h4>
              <div className="text-[13px] text-muted-foreground">
                Opener <Kg kg={a.opener} className="font-semibold text-foreground" />
              </div>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-center">
              <Cell
                label="1st"
                value={`${a.opener}`}
                sub={a.openerConservative ? `safer ${a.openerConservative}` : undefined}
              />
              <Cell label="2nd" value={`${a.second.low}–${a.second.high}`} />
              <Cell label="3rd" value={`${a.third.low}–${a.third.high}`} />
            </div>
            {detail && a.pathways ? (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[280px] text-[13px]">
                  <tbody>
                    {(["conservative", "balanced", "aggressive"] as const).map((k) => (
                      <tr key={k} className="border-t border-border/60">
                        <td className="py-1.5 pr-2 capitalize text-muted-foreground">{k}</td>
                        {a.pathways![k].map((x, i) => (
                          <td key={i} className="px-2 py-1.5 text-right tabular-nums">
                            {x}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {a.conditional?.length ? (
              <ul className="mt-3 space-y-1 text-[13px]">
                {a.conditional.map((c, i) => (
                  <li key={i}>
                    <span className="text-muted-foreground">{c.when}: </span>
                    {c.then}
                  </li>
                ))}
              </ul>
            ) : null}
            {detail && a.contingencies?.length ? (
              <details className="mt-2 text-[13px]">
                <summary className="cursor-pointer text-muted-foreground">
                  If something goes wrong
                </summary>
                <ul className="mt-1 space-y-1">
                  {a.contingencies.map((c, i) => (
                    <li key={i}>
                      <span className="text-muted-foreground">{c.when}: </span>
                      {c.then}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {detail && a.why?.length ? (
              <p className="mt-2 text-[12px] text-muted-foreground">{a.why.join(" · ")}</p>
            ) : null}
          </div>
        );
      })}
      <p className="text-[12px] text-muted-foreground">
        kg. The official attempts are always the coach's call on the day.
      </p>
    </div>
  );
}

function Cell({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-muted/60 px-2 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-[15px] font-semibold tabular-nums">{value}</div>
      {sub ? <div className="text-[11px] text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

type WarmupLike = {
  sets: Array<{ kg: number; lb?: number; reps: number; minutesBefore?: number }>;
  general?: string[];
  equipment?: string[];
  timing?: string[];
  delays?: string[];
  why?: string[];
};

export function WarmupsView({
  warmups,
  compact = false,
}: {
  warmups: Partial<Record<Lift, WarmupLike | null>> | null | undefined;
  compact?: boolean;
}) {
  if (!warmups) return <p className="text-[14px] text-muted-foreground">No warm-ups yet.</p>;
  return (
    <div className="grid gap-3 lg:grid-cols-3" data-warmups-view>
      {LIFTS.map((l) => {
        const w = warmups[l];
        if (!w) return null;
        return (
          <div key={l} className="rounded-xl border border-border p-3">
            <h4 className="text-[15px] font-semibold">{LIFT_LABEL[l]}</h4>
            <ol className="mt-2 space-y-1 text-[14px]">
              {w.sets.map((s, i) => (
                <li key={i} className="flex items-baseline justify-between gap-2 tabular-nums">
                  <span>
                    <span className="font-medium">{s.kg} kg</span> × {s.reps}
                    <span className="ml-1 text-[12px] text-muted-foreground">
                      {s.lb ?? toLb(s.kg)} lb
                    </span>
                  </span>
                  {s.minutesBefore != null ? (
                    <span className="text-[12px] text-muted-foreground">
                      {s.minutesBefore} min before
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
            {!compact ? (
              <div className="mt-2 space-y-1 text-[12px] text-muted-foreground">
                {(w.timing ?? []).map((t, i) => (
                  <p key={`t${i}`}>{t}</p>
                ))}
                {(w.equipment ?? []).length ? <p>{w.equipment!.join(" · ")}</p> : null}
                {(w.why ?? []).map((t, i) => (
                  <p key={`w${i}`}>{t}</p>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

type DayStepLike = { at: string | null; relative: string; title: string; detail: string[] };

export function GameDayView({ steps }: { steps: DayStepLike[] | null | undefined }) {
  if (!steps?.length) return <p className="text-[14px] text-muted-foreground">No day plan yet.</p>;
  return (
    <ol className="relative space-y-3 border-l border-border pl-4" data-game-day>
      {steps.map((s, i) => (
        <li key={i}>
          <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full border border-border bg-background" />
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[14px] font-semibold">{s.title}</span>
            <span className="text-[12px] text-muted-foreground">
              {s.at ? `${s.at} · ` : ""}
              {s.relative}
            </span>
          </div>
          <ul className="mt-0.5 space-y-0.5 text-[13px] text-muted-foreground">
            {s.detail.map((d, j) => (
              <li key={j}>{d}</li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}
