import { useAuth } from "@/lib/auth";
import { StaffLeagueTab } from "@/components/community/staff-league-board";

/**
 * The coach's League, its own page behind the trophy on Crew's button: the
 * crew goal, this month's standings, the Hall of Strength and the tools to run
 * them (a view-only login sees the boards without the tools). Crew keeps the
 * feed, the posts and their insights.
 */
export function AdminLeaguePage() {
  const { viewOnly } = useAuth();
  return (
    <div className="mx-auto w-full max-w-[560px] space-y-3 px-3 pb-12 pt-3 sm:px-4" data-admin-league>
      <div className="px-1">
        <h1 className="text-[22px] font-black tracking-tight">League</h1>
        <p className="text-[13px] text-muted-foreground">Standings, crew goal and the Hall of Strength</p>
      </div>
      <StaffLeagueTab tools={!viewOnly} />
    </div>
  );
}
