import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePortalUserId } from "@/lib/client-impersonation";
import { Skeleton } from "@/components/ui/skeleton";
import { AthleteLevelCard } from "@/components/portal/athlete-level-card";
import { StrengthBoardSlide } from "@/components/portal/strength-board";
import { CrewGoalCard } from "@/components/community/crew-goal";
import { useCrewGoal } from "@/lib/community.queries";

/**
 * The League tab: one swipe with the crew's shared goal (always first, everyone
 * pulls it) and your Logging Level, then this month's League (Top 5) and the
 * Hall of Strength. Every card opens its full view.
 */
export function LeagueHub() {
  // the person whose portal this is (the client in coach "View as")
  const userId = usePortalUserId();
  const { data: client, isPending } = useQuery({
    queryKey: ["my-client", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from("clients").select("*").eq("user_id", userId!).maybeSingle();
      return data;
    },
  });
  const { data: goal } = useCrewGoal(true);
  // No goal this week: the level stays a card of its own, under the boards.
  const crew = goal ? { key: "crew", label: "Crew goal", node: <CrewGoalCard /> } : undefined;
  return (
    <div data-league-hub className="space-y-3">
      {client?.id ? (
        <AthleteLevelCard clientId={client.id} levelSwipe={crew} boards={[{ key: "strength", node: <StrengthBoardSlide /> }]} />
      ) : isPending && userId ? (
        <>
          <CrewGoalCard />
          <Skeleton className="h-64 w-full rounded-2xl" />
        </>
      ) : (
        <>
        <CrewGoalCard />
        <section className="overflow-hidden rounded-2xl border bg-card">
          <StrengthBoardSlide />
        </section>
        </>
      )}
    </div>
  );
}
