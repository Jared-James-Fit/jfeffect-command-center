import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatLeaguePoints, LEAGUE_RECORDS_START } from "@/lib/league-points";
import {
  BOOST_ONE_LINER,
  adherenceTarget,
  boostTag,
  heroState,
  projectedRank,
  threatCount,
  type LeagueRow,
} from "@/lib/league-boost";

/** How far along the 90% is: one thin bar with a tick at the target, green once it's reached. */
function AdherenceProgress({ done, eligible }: { done: number; eligible: number }) {
  const target = adherenceTarget(eligible);
  const reached = done >= target;
  return (
    <div className="relative mt-2 h-1.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${done} of ${eligible} workouts done, ${target} needed`}>
      <div className={cn("h-full rounded-full", reached ? "bg-emerald-500" : "bg-foreground/70")} style={{ width: `${Math.min(100, (done / Math.max(1, eligible)) * 100)}%` }} />
      <div className="absolute inset-y-0 w-0.5 bg-foreground/40" style={{ left: `${(target / Math.max(1, eligible)) * 100}%` }} />
    </div>
  );
}

/** The final week, for the signed-in athlete: what's left to unlock the boost and what it's worth. */
export function BoostHero({ me, rows }: { me: LeagueRow; rows: LeagueRow[] }) {
  const state = heroState(me);
  const eligible = me.eligible_workouts ?? 0;
  const done = me.completed_eligible ?? 0;
  const unlock = me.projected_match ?? 0;
  const movesTo = projectedRank(rows, me);
  const showProgress = state.tone !== "neutral" && eligible > 0;

  return (
    <div data-boost-hero className="rounded-xl border p-3">
      <div className="flex items-baseline justify-between gap-2 text-[12px] font-medium text-muted-foreground">
        <span>{state.eyebrow}</span>
        {showProgress && <span className="tabular-nums">{done} / {eligible} workouts</span>}
      </div>
      <div className={cn("mt-0.5 text-base font-semibold leading-tight", state.tone === "win" && "text-emerald-600 dark:text-emerald-400")}>{state.headline}</div>
      {state.sub && <div className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{state.sub}</div>}
      {showProgress && <AdherenceProgress done={done} eligible={eligible} />}

      {state.tone !== "neutral" && (unlock > 0 || movesTo != null) && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-muted/60 px-2.5 py-2">
            <div className="text-[11px] font-medium text-muted-foreground">{me.boost_status === "ready" ? "Boost" : "Unlocks"}</div>
            <div className="text-base font-semibold tabular-nums">+{formatLeaguePoints(unlock)} pts</div>
          </div>
          <div className="rounded-lg bg-muted/60 px-2.5 py-2">
            <div className="text-[11px] font-medium text-muted-foreground">With the boost</div>
            <div className="text-base font-semibold tabular-nums">
              {formatLeaguePoints(me.projected_total ?? me.total_points)} pts
              {movesTo != null && <span className="ml-1 text-[12px] font-medium text-muted-foreground">#{movesTo}</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** "2 athletes can still catch you" — only when mathematically true. */
export function ThreatBanner({ rows, me }: { rows: LeagueRow[]; me?: LeagueRow }) {
  const n = threatCount(rows, me);
  if (n === 0) return null;
  return (
    <div className="flex items-center gap-1.5 px-1 text-[12px] font-medium text-amber-600 dark:text-amber-400">
      <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {n} {n === 1 ? "athlete" : "athletes"} can still catch you
    </div>
  );
}

/** Final week only, under a name: who's unlocked the boost, and who's one or two workouts away. */
export function RowBoost({ row }: { row: LeagueRow }) {
  if (!row.is_final_week) return null;
  const tag = boostTag(row);
  if (!tag) return null;
  return (
    <div className={cn("mt-0.5 text-[11px] font-medium", row.boost_status === "ready" ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
      {tag}
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
          <span className="font-semibold tabular-nums">+{formatLeaguePoints(pts)}</span>
        </li>
      ))}
      {me.match_points > 0 && (
        <li className="flex justify-between gap-3 font-medium text-emerald-600 dark:text-emerald-400">
          <span>Final Week Boost</span>
          <span className="font-semibold">+{formatLeaguePoints(me.match_points)}</span>
        </li>
      )}
    </ul>
  );
}

export { BOOST_ONE_LINER };
