/**
 * The cardio week at a glance: Monday to Sunday, a dot on lifting days, each
 * day's sessions and minutes. The same week in the overview and the builder:
 * seven columns where there's room, a day per line on a phone (seven columns
 * of a phone's width can't hold a session's name).
 */
import { cn } from "@/lib/utils";
import { weekSchedule, TIMING_SHORT, type CardioPlan, type PlanContext } from "@/lib/cardio/plan";

export function CardioWeek({ plan, ctx, className }: { plan: CardioPlan; ctx: PlanContext; className?: string }) {
  const week = weekSchedule(plan, ctx);
  const label = (d: (typeof week)[number]) => `${d.day}${d.training ? " (lifting)" : ""}: ${d.sessions.length ? d.sessions.map((s) => `${s.title} ${s.minutes} min`).join(", ") : "no cardio"}`;
  return (
    <div className={className} data-cardio-week>
      {/* phone: a day per line */}
      <ul className="divide-y divide-border rounded-xl border border-border sm:hidden" aria-label="This week's cardio">
        {week.map((d) => (
          <li key={d.day} aria-label={label(d)} className="flex min-h-[40px] items-center gap-3 px-3 py-1.5 text-[13px]">
            <span className="flex w-11 shrink-0 items-center gap-1.5 font-semibold">
              {d.short}
              {d.training && <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" aria-hidden />}
            </span>
            {d.sessions.length ? (
              <span className="min-w-0 flex-1">
                {d.sessions.map((s) => (
                  <span key={s.key} className="block">
                    {s.title} <span className="tabular-nums text-muted-foreground">· {s.minutes} min · {TIMING_SHORT[s.timing]}</span>
                  </span>
                ))}
              </span>
            ) : (
              <span className="text-muted-foreground">Rest</span>
            )}
          </li>
        ))}
      </ul>
      {/* room for a week: seven columns */}
      <div className="hidden grid-cols-7 gap-1 sm:grid" role="list" aria-label="This week's cardio">
        {week.map((d) => (
          <div key={d.day} role="listitem" aria-label={label(d)} className={cn("min-h-[84px] min-w-0 rounded-xl border p-1.5", d.sessions.length ? "border-border bg-muted/40" : "border-dashed border-border")}>
            <div className="flex items-center justify-between gap-1">
              <span className="text-[11px] font-semibold">{d.short}</span>
              {d.training && <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" title="Lifting day" aria-hidden />}
            </div>
            <div className="mt-1 space-y-1">
              {d.sessions.map((s) => (
                <div key={s.key} className="rounded-md bg-background px-1 py-0.5 text-[10px] leading-tight lg:text-[11px]" title={`${s.title} · ${s.minutes} min · ${TIMING_SHORT[s.timing]}`}>
                  <span className="line-clamp-2 break-words font-medium">{s.title}</span>
                  <span className="block tabular-nums text-muted-foreground">{s.minutes}′</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" aria-hidden /> Lifting day
      </p>
    </div>
  );
}
