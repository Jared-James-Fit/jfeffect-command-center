/**
 * The gameplan as everyone reads it (coach, athlete, the meet-day screen):
 * attempts, each lift's warm-ups as its own small table, rack heights and gear,
 * the day's food and fluids, and who does what. Every block says what it is
 * (confirmed, from their records, a suggestion, not known yet). kg first with
 * lb beside it, in the same order on every screen and in the PDF.
 */
import { cn } from "@/lib/utils";
import { LIFTS, rackText, SOURCE_WORD, type GameplanDoc, type PlanStatus } from "@/lib/competition/gameplan";
import { toLb } from "@/lib/competition/rules";
import type { Lift } from "@/lib/competition/types";
import { StatusWord } from "./prep-ui";

const WORD: Record<Lift, string> = { squat: "Squat", bench: "Bench", deadlift: "Deadlift" };
const asTiming = (s: PlanStatus) => (s === "recommended" ? "recommended" : s);

export function Weight({ kg, className }: { kg: number | null | undefined; className?: string }) {
  if (kg == null) return <span className={cn("text-muted-foreground", className)}>–</span>;
  return (
    <span className={cn("tabular-nums", className)}>
      <span className="font-semibold">{kg} kg</span>
      <span className="ml-1 text-[0.8em] text-muted-foreground">{toLb(kg)} lb</span>
    </span>
  );
}

export function GameplanView({ plan, compact = false }: { plan: GameplanDoc; compact?: boolean }) {
  const lifts = LIFTS.filter((l) => plan.attempts[l] || plan.warmups[l]);
  return (
    <div className="space-y-3" data-gameplan-view>
      <section className="rounded-2xl border border-border bg-card p-4" data-gameplan-attempts>
        <h3 className="text-[15px] font-semibold">Attempts</h3>
        <table className="mt-2 w-full text-[15px]">
          <thead>
            <tr className="text-left text-[12px] text-muted-foreground">
              <th className="py-1 font-medium">Lift</th>
              <th className="py-1 font-medium">Opener</th>
              <th className="py-1 font-medium">Second</th>
              <th className="py-1 font-medium">Third</th>
            </tr>
          </thead>
          <tbody>
            {LIFTS.map((l) => {
              const a = plan.attempts[l];
              return (
                <tr key={l} className="border-t border-border align-top" data-attempt-row={l}>
                  <td className="py-2 pr-2">
                    <span className="font-medium">{WORD[l]}</span>
                    {a ? (
                      <span className="block">
                        <StatusWord status={asTiming(a.status)} />
                        <span className="text-[11px] text-muted-foreground"> · {SOURCE_WORD[a.source]}</span>
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2 pr-2"><Weight kg={a?.opener} /></td>
                  <td className="py-2 pr-2">
                    <Weight kg={a?.second} />
                    {a?.secondRange && !compact ? (
                      <span className="block text-[11px] text-muted-foreground">{a.secondRange[0]}–{a.secondRange[1]}</span>
                    ) : null}
                  </td>
                  <td className="py-2">
                    <Weight kg={a?.third} />
                    {a?.thirdRange && !compact ? (
                      <span className="block text-[11px] text-muted-foreground">{a.thirdRange[0]}–{a.thirdRange[1]}</span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-1 text-[12px] text-muted-foreground">Seconds and thirds are decided on the day from how each attempt moves.</p>
      </section>

      {lifts.some((l) => plan.warmups[l]?.rows.length) ? (
        <section className="grid gap-3 sm:grid-cols-3" data-gameplan-warmups>
          {LIFTS.map((l) => {
            const w = plan.warmups[l];
            if (!w?.rows.length) return null;
            return (
              <div key={l} className="rounded-2xl border border-border bg-card p-4" data-warmup-lift={l}>
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-[15px] font-semibold">{WORD[l]} warm-ups</h3>
                  <StatusWord status={asTiming(w.status)} />
                </div>
                <table className="mt-1 w-full text-[15px] tabular-nums">
                  <tbody>
                    {w.rows.map((r, i) => (
                      <tr key={i} className="border-t border-border first:border-0">
                        <td className="py-1.5"><Weight kg={r.kg} /></td>
                        <td className="py-1.5 text-right font-semibold">×{r.reps}</td>
                        {!compact ? (
                          <td className="w-20 py-1.5 text-right text-[12px] text-muted-foreground">
                            {r.minutesBefore != null ? `${r.minutesBefore} min out` : ""}
                          </td>
                        ) : null}
                      </tr>
                    ))}
                    {plan.attempts[l]?.opener != null ? (
                      <tr className="border-t border-border">
                        <td className="py-1.5 text-[13px] text-muted-foreground">Opener</td>
                        <td className="py-1.5 text-right"><Weight kg={plan.attempts[l]!.opener} /></td>
                        {!compact ? <td /> : null}
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            );
          })}
        </section>
      ) : null}

      <section className="rounded-2xl border border-border bg-card p-4" data-gameplan-equipment>
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-[15px] font-semibold">Racks and equipment</h3>
          <StatusWord status={asTiming(plan.equipment.status)} />
        </div>
        <dl className="mt-1 grid grid-cols-[5.5rem_1fr] gap-y-1 text-[14.5px]">
          <dt className="text-muted-foreground">Squat</dt>
          <dd>{rackText(plan.equipment.racks.squat) || <span className="text-muted-foreground">Not set yet</span>}</dd>
          <dt className="text-muted-foreground">Bench</dt>
          <dd>{rackText(plan.equipment.racks.bench) || <span className="text-muted-foreground">Not set yet</span>}</dd>
          {plan.equipment.gear.length ? (
            <>
              <dt className="text-muted-foreground">Gear</dt>
              <dd>{plan.equipment.gear.join(", ")}</dd>
            </>
          ) : null}
        </dl>
      </section>

      {(["squat", "bench", "deadlift"] as const).some((l) => plan.cues?.[l]?.length) || plan.instructions?.length ? (
        <section className="rounded-2xl border border-border bg-card p-4" data-gameplan-cues>
          <h3 className="text-[15px] font-semibold">Cues and their coach's notes</h3>
          <dl className="mt-1 grid grid-cols-[5.5rem_1fr] gap-y-1 text-[14.5px]">
            {(["squat", "bench", "deadlift"] as const)
              .filter((l) => plan.cues?.[l]?.length)
              .map((l) => (
                <div key={l} className="contents">
                  <dt className="capitalize text-muted-foreground">{l}</dt>
                  <dd>{plan.cues![l]!.join(" · ")}</dd>
                </div>
              ))}
          </dl>
          {plan.instructions?.length ? (
            <ul className="mt-2 space-y-1 text-[14px]">
              {plan.instructions.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <section className="rounded-2xl border border-border bg-card p-4" data-gameplan-day>
        <h3 className="text-[15px] font-semibold">Food, fluids and the day</h3>
        <ul className="mt-1 space-y-1 text-[14.5px]">
          {[...plan.day.afterWeighIn, ...plan.day.during].map((t, i) => (
            <li key={i}>{t}</li>
          ))}
          {plan.day.caffeine ? <li>Caffeine: {plan.day.caffeine}</li> : null}
          {plan.day.notes.map((t, i) => (
            <li key={`n${i}`} className="text-muted-foreground">{t}</li>
          ))}
        </ul>
        <p className="mt-1 text-[12px] text-muted-foreground">Never water or sodium tricks, saunas or a crash cut.</p>
      </section>

      {plan.contacts.length ? (
        <section className="rounded-2xl border border-border bg-card p-4" data-gameplan-contacts>
          <h3 className="text-[15px] font-semibold">Who does what</h3>
          <ul className="mt-1 space-y-1.5 text-[14.5px]">
            {plan.contacts.map((c, i) => (
              <li key={i}>
                <span className="font-medium">{c.name}</span> <span className="text-muted-foreground">· {c.role}</span>
                {c.phone ? (
                  <a className="ml-1 underline-offset-2 hover:underline" href={`tel:${c.phone.replace(/[^\d+]/g, "")}`}>
                    {c.phone}
                  </a>
                ) : null}
                {c.responsibility ? <span className="block text-[12.5px] text-muted-foreground">{c.responsibility}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {plan.why.length && !compact ? (
        <details className="rounded-2xl border border-border px-4 py-3 text-[13px]">
          <summary className="cursor-pointer text-muted-foreground">Why these numbers</summary>
          <ul className="mt-2 space-y-1 text-muted-foreground">
            {plan.why.map((w, i) => (
              <li key={i}>· {w}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
