import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useEffect } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AlertTriangle } from "lucide-react";
import { WorkoutDayView } from "@/components/workout-day/WorkoutDayView";
import { createClientAdapter } from "@/lib/workout-context/client-adapter";
import { usePortalUserId, useClientImpersonation } from "@/lib/client-impersonation";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/portal/workouts/$dayId")({
  validateSearch: (s: Record<string, unknown>) => ({
    readonly: s.readonly === 1 || s.readonly === "1" || s.readonly === true ? 1 : undefined,
    // Coach- or client-initiated "open in edit mode" — auto-unlocks past workouts
    // and auto-opens the feedback sheet when the user wants to edit a review.
    edit: s.edit === 1 || s.edit === "1" || s.edit === true ? 1 : undefined,
    review: s.review === 1 || s.review === "1" || s.review === true ? 1 : undefined,
  }),
  component: RouteComponent,
  // Capture render/load errors on this route so the page degrades gracefully
  // on mobile instead of showing a hard crash screen, and surface the stack
  // to the console so we can diagnose the cause from the next session.
  errorComponent: WorkoutDayErrorFallback,
});

function WorkoutDayErrorFallback({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("[workouts/$dayId] route error:", error, error?.stack);
  }, [error]);
  return (
    <div className="p-6">
      <Card className="space-y-3 p-6">
        <div className="flex items-center gap-2 text-base font-bold">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
          Something went wrong opening this workout
        </div>
        <div className="text-sm text-muted-foreground">
          {error?.message || "Unexpected error."} You can retry, or go back to the schedule.
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => {
              router.invalidate();
              reset();
            }}
          >
            Retry
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to="/portal/workouts">Back to workouts</Link>
          </Button>
        </div>
      </Card>
    </div>
  );
}

function RouteComponent() {
  const { dayId } = Route.useParams();
  const search = Route.useSearch();
  // Resolve the trainee identity for the client adapter. Mirrors the
  // lookup that WorkoutDayView still performs internally (via
  // usePortalUserId + the my-client query) — both will converge onto the
  // adapter once Phase B (query swap) lands.
  const portalUserId = usePortalUserId();
  const { client: povClient } = useClientImpersonation();
  const { data: ownClient } = useQuery({
    queryKey: ["portal-route-my-client", portalUserId],
    enabled: !!portalUserId && !povClient?.id,
    queryFn: async () =>
      (await supabase.from("clients").select("id, user_id").eq("user_id", portalUserId!).maybeSingle()).data,
  });
  const clientId = povClient?.id ?? ownClient?.id ?? null;
  const clientUserId = povClient?.user_id ?? portalUserId ?? null;

  const adapter = useMemo(() => {
    if (!clientId || !clientUserId) return undefined;
    return createClientAdapter({
      kind: "client",
      userId: clientUserId,
      ownerId: clientId,
    });
  }, [clientId, clientUserId]);

  return (
    <WorkoutDayView
      dayId={dayId}
      search={search}
      adapter={adapter}
      navigation={{
        backTo: "/portal/workouts",
        listPath: "/portal/workouts",
        messagesPath: "/portal/messages",
      }}
    />
  );
}