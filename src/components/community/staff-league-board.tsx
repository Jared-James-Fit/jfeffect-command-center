import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ChevronDown, ChevronRight, Medal, Trophy, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatLeaguePoints, leaguePointsFromEncoded } from "@/lib/league-points";
import { isFinalWeek } from "@/lib/league-boost";
import { CoachTag } from "@/components/portal/coach-tag";
import { StrengthBoardCoachTools, StrengthBoardSlide } from "@/components/portal/strength-board";
import { LeagueBoostAdmin } from "@/components/admin/league-boost-admin";
import { CrewGoalCard } from "@/components/community/crew-goal";

type LeagueRow = {
  client_id: string; display_name: string; avatar_url: string | null; monthly_xp: number;
  rank: number | null; qualified: boolean; is_coach?: boolean;
};

const SHOWN = 10;

/**
 * This month's Performance League as the coach sees it: everyone ranked, no
 * "you" (the same board clients see, from get_monthly_athlete_rankings).
 */
export function StaffLeagueBoard() {
  const [all, setAll] = useState(false);
  const { data: rows = [], isPending } = useQuery({
    queryKey: ["athlete-rankings-monthly-raw", "staff"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_monthly_athlete_rankings", { _limit: 50 });
      if (error) throw error;
      return (data ?? []) as LeagueRow[];
    },
  });
  const ranked = rows.filter((r) => r.qualified && r.rank != null).sort((a, b) => Number(a.rank) - Number(b.rank));
  const unranked = rows.length - ranked.length;
  const shown = all ? ranked : ranked.slice(0, SHOWN);

  return (
    <section className="overflow-hidden rounded-2xl border bg-card">
      <div className="flex items-start gap-3 px-4 pt-3">
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{format(new Date(), "MMMM")} Performance League</span>
          <span className="mt-0.5 block text-lg font-bold tracking-tight">Standings</span>
          <span className="block text-[11px] text-muted-foreground">
            {ranked.length} ranked{unranked > 0 ? ` · ${unranked} still need a bodyweight` : ""}
          </span>
        </span>
        {isFinalWeek() && (
          <span className="mt-1 inline-flex shrink-0 items-center gap-1 rounded-full bg-orange-500 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-white">
            <Zap className="h-3 w-3" /> Final week
          </span>
        )}
      </div>
      {isPending ? (
        <div className="space-y-2 p-3"><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /></div>
      ) : ranked.length === 0 ? (
        <p className="px-4 pb-4 pt-2 text-sm text-muted-foreground">Nobody's ranked yet this month.</p>
      ) : (
        <ol className="mx-3 mb-3 mt-2.5 divide-y divide-border/60 overflow-hidden rounded-xl bg-muted/25">
          {shown.map((r) => {
            const place = Number(r.rank);
            return (
              <li key={r.client_id} className="flex items-center gap-2.5 px-3 py-2 text-[13px]">
                <span className="w-7 shrink-0 text-center text-[12px] font-black tabular-nums text-muted-foreground">
                  {place === 1 ? "🥇" : place === 2 ? "🥈" : place === 3 ? "🥉" : place}
                </span>
                <span className="min-w-0 flex-1 truncate font-semibold">{r.display_name}</span>
                {r.is_coach && <CoachTag />}
                <span className="shrink-0 text-[12px] font-bold tabular-nums text-primary">{formatLeaguePoints(leaguePointsFromEncoded(r.monthly_xp))} pts</span>
              </li>
            );
          })}
        </ol>
      )}
      {ranked.length > SHOWN && (
        <button type="button" onClick={() => setAll((v) => !v)} className="flex min-h-11 w-full items-center justify-center gap-1 border-t text-sm font-bold text-primary active:bg-muted">
          {all ? "Show top 10" : `Everyone · ${ranked.length}`} <ChevronDown className={cn("h-4 w-4 transition-transform", all && "rotate-180")} />
        </button>
      )}
    </section>
  );
}

function Tool({ icon, title, sub, children }: { icon: React.ReactNode; title: string; sub: string; children: React.ReactNode }) {
  return (
    <details className="group overflow-hidden rounded-2xl border bg-card">
      <summary className="flex min-h-[56px] cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-foreground">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold">{title}</span>
          <span className="block truncate text-xs text-muted-foreground">{sub}</span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t p-3">{children}</div>
    </details>
  );
}

/**
 * The coach's League tab: what clients see (crew goal, this month's
 * standings, the Hall of Strength), then the tools to run it, folded away
 * until needed.
 */
export function StaffLeagueTab() {
  return (
    <div data-staff-league className="space-y-3">
      <CrewGoalCard />
      <StaffLeagueBoard />
      <section className="overflow-hidden rounded-2xl border bg-card">
        <StrengthBoardSlide />
      </section>

      <h2 className="px-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Run the league</h2>
      <Tool icon={<Zap className="h-4 w-4" />} title="Final-week boost" sub="Who's boosted, and excuse a session">
        <LeagueBoostAdmin />
      </Tool>
      <Tool icon={<Trophy className="h-4 w-4" />} title="Hall of Strength review" sub="Fix typos, remove a lift, who can't rank yet">
        <StrengthBoardCoachTools />
      </Tool>
      <Link to="/admin/athlete-records" className="flex min-h-[56px] items-center gap-3 rounded-2xl border bg-card px-4 py-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted"><Medal className="h-4 w-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold">Meet results & athlete profiles</span>
          <span className="block truncate text-xs text-muted-foreground">Add a meet, edit records</span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </Link>
    </div>
  );
}
