import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { WorkoutDayView } from "@/components/workout-day/WorkoutDayView";
import { createClientAdapter } from "@/lib/workout-context/client-adapter";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

/**
 * A member-built workout. It lives on the pl_* engine under the member's
 * athlete profile, so it uses the same logger, completions and PRs as a
 * coaching client's workout (client adapter), inside the /m shell.
 */
export const Route = createFileRoute("/_authenticated/m/my-workouts/$dayId")({
  validateSearch: (s: Record<string, unknown>): { readonly?: 1; edit?: 1; review?: 1; recap?: 1; instance?: string } => ({
    readonly: s.readonly === 1 || s.readonly === "1" || s.readonly === true ? 1 : undefined,
    edit: s.edit === 1 || s.edit === "1" || s.edit === true ? 1 : undefined,
    review: s.review === 1 || s.review === "1" || s.review === true ? 1 : undefined,
    recap: s.recap === 1 || s.recap === "1" || s.recap === true ? 1 : undefined,
    instance: typeof s.instance === "string" && s.instance.length > 0 ? s.instance : undefined,
  }),
  component: MemberBuiltWorkoutRoute,
});

function MemberBuiltWorkoutRoute() {
  const { dayId } = Route.useParams();
  const search = Route.useSearch();
  const { user } = useAuth();

  const { data: athlete, isLoading } = useQuery({
    queryKey: ["member-athlete", user?.id],
    enabled: !!user?.id,
    queryFn: async () =>
      (await supabase.from("clients").select("id").eq("user_id", user!.id).eq("athlete_kind" as any, "member").maybeSingle()).data,
  });

  const adapter = useMemo(() => {
    if (!user?.id || !athlete?.id) return undefined;
    return createClientAdapter({ kind: "client", userId: user.id, ownerId: athlete.id, scheduledWorkoutId: search.instance ?? null });
  }, [user?.id, athlete?.id, search.instance]);

  if (isLoading || !user?.id) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!adapter) return <div className="p-6 text-sm text-muted-foreground">This workout isn't available.</div>;

  return (
    <WorkoutDayView
      dayId={dayId}
      search={search}
      adapter={adapter}
      navigation={{ backTo: "/m/workouts", listPath: "/m/workouts", messagesPath: "/m/support" }}
    />
  );
}
