import { cn } from "@/lib/utils";
import { formatLeaguePoints, LEAGUE_RECORDS_START } from "@/lib/league-points";
import {
  BOOST_ONE_LINER,
  adherenceTarget,
  boostTag,
  canStillMove,
  heroState,
  projectedRank,
  threatCount,
  type LeagueRow,
} from "@/lib/league-boost";

/** Before the final week: one line so everyone knows the last week matters. */
export function BoostTeaser({ me }: { me?: LeagueRow }) {
  const eligible = me?.eligible_workouts ?? 0;
  const done = me?.completed_eligible ?? 0;
  return (
    <div className="rounded-2xl border border-orange-300/60 bg-gradient-to-br from-orange-50 to-amber-50 p-3 text-orange-950 dark:border-orange-400/30 dark:from-orange-950/40 dark:to-amber-950/30 dark:text-orange-50">
      <div className="text-[11px] font-black uppercase tracking-[0.14em]">🔥 Final Week Boost</div>
      <div className="mt-1 text-sm font-bold leading-snug">Hit 90%+ of your workouts this month → Match the highest Workout Points</div>
      {me && eligible > 0 && me.boost_status !== "none" && (
        <div className="mt-1 text-xs opacity-80">You so far: {done} / {eligible} workouts</div>
      )}
    </div>
  );
}

/** Progress dots for small months, a bar for long ones. */
function AdherenceProgress({ done, eligible }: { done: number; eligible: number }) {
  const target = adherenceTarget(eligible);
  if (eligible <= 24) {
    return (
      <div className="flex flex-wrap gap-1.5" aria-label={`${done} of ${eligible} workouts done, ${target} needed`}>
        {Array.from({ length: eligible }, (_, i) => (
          <span
            key={i}
            className={cn(
              "h-3 w-3 rounded-full border",
              i < done ? "border-orange-500 bg-orange-500" : i < target ? "border-orange-400 bg-transparent" : "border-current opacity-30",
            )}
          />
        ))}
      </div>
    );
  }
  return (
    <div className="relative h-2.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/15">
      <div className="h-full rounded-full bg-orange-500" style={{ width: `${Math.min(100, (done / eligible) * 100)}%` }} />
      <div className="absolute inset-y-0 w-0.5 bg-current opacity-60" style={{ left: `${(target / eligible) * 100}%` }} />
    </div>
  );
}

/** The final-week race card for the signed-in athlete. */
export function BoostHero({ me, rows }: { me: LeagueRow; rows: LeagueRow[] }) {
  const state = heroState(me);
  const eligible = me.eligible_workouts ?? 0;
  const done = me.completed_eligible ?? 0;
  const pct = Math.round(me.adherence_pct ?? 0);
  const unlock = me.projected_match ?? 0;
  const movesTo = projectedRank(rows, me);
  const showProgress = state.tone !== "neutral" && eligible > 0;

  return (
    <div
      className={cn(
        "rounded-2xl border p-4",
        state.tone === "hype" && "border-orange-400 bg-gradient-to-br from-orange-500 to-red-600 text-white shadow-lg shadow-orange-500/20",
        state.tone === "win" && "border-emerald-400 bg-gradient-to-br from-emerald-500 to-emerald-700 text-white shadow-lg shadow-emerald-500/20",
        state.tone === "neutral" && "bg-muted/30",
      )}
    >
      <div className={cn("text-[11px] font-black uppercase tracking-[0.14em]", state.tone === "neutral" ? "text-muted-foreground" : "text-white/85")}>
        {state.eyebrow}
      </div>
      <div className={cn("mt-1 font-black leading-tight", state.tone === "neutral" ? "text-sm" : "text-2xl")}>{state.headline}</div>
      {state.sub && <div className="mt-0.5 text-sm font-semibold text-white/90">{state.sub}</div>}

      {showProgress && (
        <div className="mt-3 space-y-1.5 rounded-xl bg-black/15 p-3">
          <div className="flex items-baseline justify-between text-xs font-bold">
            <span>{done} / {eligible} workouts</span>
            <span>{me.boost_status === "ready" ? `${pct}% ✓` : `${pct}% → 90%+ needed`}</span>
          </div>
          <AdherenceProgress done={done} eligible={eligible} />
        </div>
      )}

      {state.tone !== "neutral" && (unlock > 0 || movesTo != null) && (
        <div className="mt-3 grid grid-cols-2 gap-2 text-center">
          <div className="rounded-xl bg-white/15 px-2 py-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-white/80">{me.boost_status === "ready" ? "Match" : "Unlocks"}</div>
            <div className="text-lg font-black">+{formatLeaguePoints(unlock)}</div>
          </div>
          <div className="rounded-xl bg-white/15 px-2 py-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-white/80">Projected</div>
            <div className="text-lg font-black">
              {formatLeaguePoints(me.projected_total ?? me.total_points)}
              {movesTo != null && <span className="ml-1 text-xs font-bold text-white/85">#{movesTo}</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** "⚠️ 2 athletes can still catch you" — only when mathematically true. */
export function ThreatBanner({ rows, me }: { rows: LeagueRow[]; me?: LeagueRow }) {
  const n = threatCount(rows, me);
  if (n === 0) return null;
  return (
    <div className="flex items-center gap-2 rounded-xl border border-amber-400/60 bg-amber-50 px-3 py-2 text-sm font-black text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
      ⚠️ {n} {n === 1 ? "athlete" : "athletes"} can still catch you
    </div>
  );
}

/** Small row label + projected total, final week only. */
export function RowBoost({ row }: { row: LeagueRow }) {
  if (!row.is_final_week) return null;
  const tag = boostTag(row);
  if (!tag) return null;
  const moving = canStillMove(row);
  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] font-black uppercase tracking-wide">
      <span className={row.boost_status === "ready" ? "text-emerald-600" : "text-orange-600"}>{tag}</span>
      {moving && <span className="normal-case text-muted-foreground">Projected: {formatLeaguePoints(row.projected_total)} pts</span>}
    </div>
  );
}

function recordLabel(me: LeagueRow) {
  const parts = [
    [me.atpr_lifts ?? 0, "ATPR"],
    [me.program_pr_lifts ?? 0, "PROGRAM PR"],
    [me.block_pr_lifts ?? 0, "BLOCK PR"],
  ].filter(([n]) => (n as number) > 0).map(([n, l]) => `${n} ${l}`);
  return parts.length ? `Records · ${parts.join(" · ")}` : "Records";
}

/** Points breakdown — the athlete's point history for the month. */
export function MonthBreakdown({ me }: { me: LeagueRow }) {
  const lines: Array<[string, number, string?]> = [
    [`Workouts · ${me.workouts_completed}`, me.workout_points],
    [`Fully logged · ${me.fully_logged}`, me.logging_points],
    ["Bodyweight logs", me.bodyweight_points],
    me.month_start < LEAGUE_RECORDS_START
      ? ["Beat your best", me.improvement_points]
      : [recordLabel(me), me.improvement_points],
    ...(me.month_start >= LEAGUE_RECORDS_START
      ? [[`Community posts · ${me.community_posts ?? 0}`, me.community_points ?? 0] as [string, number]]
      : []),
  ];
  return (
    <ul className="mt-2 space-y-1 text-xs">
      {lines.map(([label, pts]) => (
        <li key={label} className="flex justify-between gap-3">
          <span className="text-muted-foreground">{label}</span>
          <span className="font-bold">+{formatLeaguePoints(pts)}</span>
        </li>
      ))}
      {me.match_points > 0 && (
        <li className="flex justify-between gap-3 rounded-lg bg-orange-500/10 px-2 py-1 font-black text-orange-700 dark:text-orange-300">
          <span>🔥 Workout Points Match <span className="font-semibold opacity-80">· Final Week Boost</span></span>
          <span>+{formatLeaguePoints(me.match_points)}</span>
        </li>
      )}
    </ul>
  );
}

export { BOOST_ONE_LINER };
