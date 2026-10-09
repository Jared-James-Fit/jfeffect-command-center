import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePortalUserId } from "@/lib/client-impersonation";
import { Skeleton } from "@/components/ui/skeleton";
import { AthleteLevelCard } from "@/components/portal/athlete-level-card";
import { StrengthBoardSlide } from "@/components/portal/strength-board";
import { CrewGoalCard } from "@/components/community/crew-goal";

/**
 * The League tab: the crew's shared goal first (everyone pulls it), then you:
 * this month's League with its whole Top 10, your Logging Level, the Hall of
 * Strength. Every card opens its full view, as on Home before.
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
  return (
    <div data-league-hub className="space-y-3">
      <CrewGoalCard />
      {client?.id ? (
        <AthleteLevelCard clientId={client.id} boards={[{ key: "strength", node: <StrengthBoardSlide /> }]} />
      ) : isPending && userId ? (
        <Skeleton className="h-64 w-full rounded-2xl" />
      ) : (
        <section className="overflow-hidden rounded-2xl border bg-card">
          <StrengthBoardSlide />
        </section>
      )}
    </div>
  );
}
