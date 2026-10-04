/**
 * "Points earned" card for the post-workout recap: what this workout added
 * to the Performance League (this month) and to the Logging Level. Numbers
 * come from workout_points_summary — the same rules as the leaderboard.
 */
import { useEffect, useState } from "react";
import { Trophy, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { SCOPE_LABEL, type WorkoutPoints } from "@/lib/training-records";

function useCountUp(target: number, ms = 900) {
  const [v, setV] = useState(0);
  useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !target) { setV(target); return; }
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      setV(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

const LEVEL_LABEL: Record<string, string> = {
  workout_completed: "Completed",
  workout_fully_logged: "Fully logged",
  workout_review: "Workout review",
};

export function WorkoutPointsCard({ points }: { points: WorkoutPoints }) {
  const league = points.league;
  const level = points.level;
  const leagueTotal = useCountUp(league.total);
  const levelTotal = useCountUp(level.total);
  if (league.total <= 0 && level.total <= 0) return null;

  // Lines always add up to the total: records show the points that actually
  // counted; the lifts that earned them are listed underneath.
  const leagueLines = [
    { label: "Completed workout", n: league.completed },
    { label: "Fully logged", n: league.fully_logged },
    { label: "PRs & ATPRs", n: league.records },
  ].filter((l) => l.n > 0);
  const recordsShown = league.record_lifts.reduce((s, r) => s + r.points, 0);
  const capped = league.record_cap_hit && recordsShown > league.records;

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm animate-in fade-in slide-in-from-bottom-2 duration-700">
      <div className="px-3.5 pt-3 text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">Points earned</div>
      <div className="grid grid-cols-2 divide-x divide-border/70">
        {/* League */}
        <div className="p-3.5">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground">
            <Trophy className="h-3.5 w-3.5 text-primary" /> League
          </div>
          <div className="mt-0.5 text-3xl font-black tabular-nums text-primary">+{leagueTotal}</div>
          <ul className="mt-1.5 space-y-0.5 text-[11px] leading-snug">
            {leagueLines.map(({ label, n }) => (
              <li key={label} className="flex justify-between gap-2">
                <span className="min-w-0 truncate text-muted-foreground">{label}</span>
                <span className="shrink-0 font-bold tabular-nums">+{n}</span>
              </li>
            ))}
          </ul>
          {league.record_lifts.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {league.record_lifts.map((r) => (
                <span
                  key={r.exercise_name}
                  className={cn(
                    "max-w-full truncate rounded-full px-1.5 py-0.5 text-[9.5px] font-bold",
                    r.scope === "atpr" ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                      : r.scope === "program_pr" ? "bg-violet-500/15 text-violet-700 dark:text-violet-300"
                      : "bg-sky-500/15 text-sky-700 dark:text-sky-300",
                  )}
                  title={`${r.exercise_name} · ${SCOPE_LABEL[r.scope]}`}
                >
                  <span className="font-black">{SCOPE_LABEL[r.scope]}</span> · {r.exercise_name}
                </span>
              ))}
            </div>
          )}
          {capped && (
            <div className="mt-1.5 rounded-md bg-amber-500/10 px-1.5 py-1 text-[10px] font-semibold leading-snug text-amber-700 dark:text-amber-300">
              Monthly PR cap hit (40 pts) — {recordsShown} earned, +{league.records} counted
            </div>
          )}
        </div>
        {/* Logging Level */}
        <div className="p-3.5">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground">
            <TrendingUp className="h-3.5 w-3.5 text-emerald-500" /> Logging Level
          </div>
          <div className={cn("mt-0.5 text-3xl font-black tabular-nums", level.total > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
            +{levelTotal}
          </div>
          <ul className="mt-1.5 space-y-0.5 text-[11px] leading-snug">
            {level.events.map((e, i) => (
              <li key={`${e.event_type}-${i}`} className="flex justify-between gap-2">
                <span className="truncate text-muted-foreground">{LEVEL_LABEL[e.event_type] ?? e.label}</span>
                <span className="shrink-0 font-bold tabular-nums">+{e.xp}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
