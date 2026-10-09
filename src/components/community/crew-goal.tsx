import { useEffect, useState } from "react";
import { Check, Users } from "lucide-react";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import { crewGoalStatus, type CrewGoal } from "@/lib/community";
import { useCrewGoal, useMyCommunityId } from "@/lib/community.queries";

const FILL = "bg-[linear-gradient(90deg,#ffb054,#ef3340)]";
const GOLD = "bg-[linear-gradient(90deg,#fde68a,#f59e0b)]";

/** The bar: grows in from empty the first time it shows, gold once the goal's hit. */
function GoalBar({ pct, hit, className }: { pct: number; hit: boolean; className?: string }) {
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className={cn("overflow-hidden rounded-full bg-muted", className)} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <div data-goal-fill className={cn("h-full rounded-full transition-[width] duration-1000 ease-out", hit ? GOLD : FILL)} style={{ width: grown ? `${Math.max(pct, pct > 0 ? 3 : 0)}%` : "0%" }} />
    </div>
  );
}

/**
 * Top of the feed: the crew's goal for the week. Every finished workout,
 * anyone's, moves it, so the crew pulls together instead of only competing.
 * Who's trained shows as faces (no counts: nobody's ranked here), plus your
 * own sessions. Nobody is ever shown as missing.
 */
export function CrewGoalCard({ className }: { className?: string }) {
  const { data: g } = useCrewGoal(true);
  const me = useMyCommunityId();
  if (!g) return null;
  const s = crewGoalStatus(g, { me });
  const faces = g.contributors.slice(0, 5);
  const more = g.contributors.length - faces.length;
  return (
    <section data-crew-goal className={cn("rounded-3xl border bg-card px-4 pb-3.5 pt-3.5", s.hit ? "border-amber-400/60" : "border-border/80", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className={cn("text-[10px] font-black uppercase tracking-[0.16em]", s.hit ? "text-amber-500" : "text-primary")}>Crew goal · this week</span>
        {g.last_week.done > 0 && (
          <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-muted-foreground">
            Last week {g.last_week.hit && <Check className="h-3 w-3 text-emerald-500" strokeWidth={3} />}
            {g.last_week.done}/{g.last_week.target}
          </span>
        )}
      </div>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span className="text-[28px] font-black leading-none tabular-nums">{g.done}</span>
        <span className="text-[15px] font-bold text-muted-foreground">/ {g.target} sessions</span>
      </div>
      <GoalBar pct={s.pct} hit={s.hit} className="mt-2.5 h-2.5" />
      <p className="mt-2 text-[13px] font-semibold">{s.line}</p>
      {faces.length > 0 && (
        <div className="mt-2.5 flex items-center gap-2">
          <div className="flex -space-x-1.5">
            {faces.map((a) => (
              <span key={a.user_id} className="rounded-full ring-2 ring-card">
                <UserAvatar src={a.avatar_url} name={a.name} size={26} expandable={false} />
              </span>
            ))}
            {more > 0 && <span className="z-10 grid h-[26px] min-w-[26px] place-items-center rounded-full bg-muted px-1 text-[10px] font-black ring-2 ring-card">+{more}</span>}
          </div>
          <span className="min-w-0 truncate text-[12px] text-muted-foreground">
            {g.people} trained{g.mine > 0 ? ` · you: ${g.mine}` : ""}
          </span>
        </div>
      )}
      {g.mine === 0 && !s.hit && <p className="mt-1.5 text-[12px] text-muted-foreground">Your next session counts toward it.</p>}
    </section>
  );
}

/** One line for tight spots (Home's community card): label, bar, numbers. */
export function CrewGoalStrip({ className }: { className?: string }) {
  const { data: g } = useCrewGoal(true);
  if (!g) return null;
  const s = crewGoalStatus(g);
  return (
    <div data-crew-goal-strip className={cn("flex items-center gap-2.5", className)}>
      <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-black text-muted-foreground">
        <Users className="h-3.5 w-3.5" /> Crew goal
      </span>
      <GoalBar pct={s.pct} hit={s.hit} className="h-1.5 flex-1" />
      <span className={cn("shrink-0 text-[11px] font-black tabular-nums", s.hit && "text-amber-500")}>
        {g.done}/{g.target}
        {s.hit && " 🎉"}
      </span>
    </div>
  );
}

/** Right after a workout: what it just did for the crew. Fresh numbers (this session included). */
export function CrewGoalAfterWorkout({ className }: { className?: string }) {
  const { data: g } = useCrewGoal(true, { fresh: true });
  const me = useMyCommunityId();
  if (!g) return null;
  const s = crewGoalStatus(g, { me });
  const text = s.hit
    ? g.hit_by && g.hit_by.user_id === me
      ? `You closed out the crew goal: ${g.done}/${g.target} 🎉`
      : `Crew goal: ${g.done}/${g.target} this week 🎉`
    : `Crew goal: ${g.done}/${g.target} this week · ${s.left} to go`;
  return (
    <div data-crew-goal-recap className={cn("w-full", className)}>
      <div className="flex items-center justify-between gap-2 text-[12px] font-bold">
        <span className="min-w-0 truncate">{text}</span>
      </div>
      <GoalBar pct={s.pct} hit={s.hit} className="mt-1.5 h-1.5" />
    </div>
  );
}
