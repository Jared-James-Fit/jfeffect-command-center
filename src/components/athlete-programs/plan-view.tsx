import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  exerciseUnits,
  flatWeeks,
  prescriptionText,
  setGroupName,
  programWeek,
  refOfWeek,
  sameWeek,
  weekAt,
  type ProgramPlan,
} from "@/lib/program-plan";

/**
 * A program read on its page: a week at a time (its tabs grouped by block,
 * like the builder's), each training day with its exercises written the way
 * a coach writes them ("4 × 5 · RPE 8 · 225 lb · 3:00 rest").
 */
export function PlanView({ plan }: { plan: ProgramPlan }) {
  const [g, setG] = useState(1);
  const strip = useRef<HTMLDivElement>(null);
  const ref = refOfWeek(plan, g);
  const week = weekAt(plan, ref);
  const weeks = flatWeeks(plan);
  const multi = plan.blocks.length > 1;
  const allSame = weeks.every((x) => sameWeek(x.week, weeks[0].week));
  const prev = g > 1 ? weeks[g - 2]?.week : null;
  const sameAsLast = !!prev && !!week && sameWeek(prev, week);

  useEffect(() => {
    strip.current?.querySelector<HTMLElement>(`[data-plan-week="${g}"]`)?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
      behavior: "smooth",
    });
  }, [g]);

  if (!week) return null;
  return (
    <section className="space-y-3" aria-label="The program" data-plan-view>
      {weeks.length > 1 && !allSame && (
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-3 px-1">
            <h2 className="text-[16px] font-semibold">Week {g}</h2>
            <span className="truncate text-[12px] text-muted-foreground">
              {multi ? `${plan.blocks[ref.b].name} · ` : ""}
              {sameAsLast ? "Same as last week" : `${weeks.length} weeks`}
            </span>
          </div>
          <div ref={strip} className="flex items-center gap-1 overflow-x-auto pb-1 no-scrollbar" role="tablist" aria-label="Weeks">
            {plan.blocks.map((block, b) => (
              <div key={block.key} className="flex shrink-0 items-center gap-1">
                {b > 0 && <span aria-hidden className="mx-1 h-6 w-px bg-border" />}
                {multi && <span className="mr-0.5 max-w-[6rem] truncate text-[11px] font-medium text-muted-foreground">{block.name}</span>}
                {block.weeks.map((wk, w) => {
                  const n = programWeek(plan, { b, w });
                  return (
                    <button
                      key={wk.key}
                      type="button"
                      role="tab"
                      aria-selected={n === g}
                      aria-label={`Week ${n}`}
                      onClick={() => setG(n)}
                      className={cn(
                        "grid h-10 min-w-10 place-items-center rounded-lg px-2 text-[14px] font-semibold tabular-nums",
                        n === g ? "bg-foreground text-background" : "text-muted-foreground hover:bg-secondary",
                      )}
                      data-plan-week={n}
                    >
                      {n}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
      {week.days.map((d, i) => (
        <section key={d.key} className="rounded-2xl border border-border bg-card">
          <div className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-3">
            <h3 className="truncate text-[16px] font-semibold">{d.title || `Day ${i + 1}`}</h3>
            <span className="shrink-0 text-[12px] text-muted-foreground">{d.focus || `Day ${i + 1}`}</span>
          </div>
          <ol className="divide-y divide-border">
            {exerciseUnits(d).map((u) => {
              const e = u.entries[0];
              // an exercise in set groups: its name once, then each group's line (Top set, Back-off…)
              if (u.entries.length > 1) {
                return (
                  <li key={e.key} className="px-4 py-3" data-plan-groups>
                    <div className="text-[15px] font-medium">{e.name ?? "Exercise"}</div>
                    {(e.notes || e.tempo) && (
                      <div className="mt-0.5 text-[13px] text-muted-foreground">
                        {[e.tempo ? `Tempo ${e.tempo}` : null, e.notes].filter(Boolean).join(" · ")}
                      </div>
                    )}
                    <div className="mt-1.5 space-y-1">
                      {u.entries.map((g) => (
                        <div key={g.key} className="flex items-baseline justify-between gap-3 text-[13px]">
                          <span className={g.role === "warmup" ? "text-muted-foreground" : "font-medium"}>{setGroupName(g)}</span>
                          <span className="max-w-[60%] text-right tabular-nums">{prescriptionText(g)}</span>
                        </div>
                      ))}
                    </div>
                  </li>
                );
              }
              return (
                <li key={e.key} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="text-[15px] font-medium">{e.name ?? "Exercise"}</div>
                    {(e.notes || e.tempo) && (
                      <div className="mt-0.5 text-[13px] text-muted-foreground">
                        {[e.tempo ? `Tempo ${e.tempo}` : null, e.notes].filter(Boolean).join(" · ")}
                      </div>
                    )}
                  </div>
                  <div className="max-w-[55%] shrink-0 text-right text-[13px] tabular-nums">{prescriptionText(e)}</div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
      {allSame && weeks.length > 1 && (
        <p className="text-center text-[13px] text-muted-foreground">
          Every one of its {weeks.length} weeks is the same. Add weight or reps as you go.
        </p>
      )}
    </section>
  );
}
