import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useEffect } from "react";
import { Link, useRouter, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AlertTriangle } from "lucide-react";
import { WorkoutDayView } from "@/components/workout-day/WorkoutDayView";
import { createClientAdapter } from "@/lib/workout-context/client-adapter";
import { usePortalUserId, useClientImpersonation } from "@/lib/client-impersonation";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ClientCardioSection } from "@/components/cardio/ClientCardioSection";
import { parseLocalDate } from "@/lib/today";

export const Route = createFileRoute("/_authenticated/portal/workouts/$dayId")({
  validateSearch: (s: Record<string, unknown>): { readonly?: 1; edit?: 1; review?: 1; recap?: 1; instance?: string } => ({
    readonly: s.readonly === 1 || s.readonly === "1" || s.readonly === true ? 1 : undefined,
    // Coach- or client-initiated "open in edit mode" — auto-unlocks past workouts
    // and auto-opens the feedback sheet when the user wants to edit a review.
    edit: s.edit === 1 || s.edit === "1" || s.edit === true ? 1 : undefined,
    review: s.review === 1 || s.review === "1" || s.review === true ? 1 : undefined,
    recap: s.recap === 1 || s.recap === "1" || s.recap === true ? 1 : undefined,
    // Slice 2b: pl_scheduled_workouts.id of the specific calendar
    // instance this URL is opening. When present, the client adapter
    // scopes completion reads/writes by scheduled_workout_id so two
    // instances of the same source day keep independent state.
    instance: typeof s.instance === "string" && s.instance.length > 0 ? s.instance : undefined,
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
  const navigate = useNavigate();
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

  // Slice 2b legacy URL disambiguation: when the URL has no ?instance= but
  // the client has one or more scheduled instances for this day_id, try to
  // resolve automatically.
  // Slice 2c — clarified rules:
  //   0 matches                → legacy path (scheduled_workout_id IS NULL)
  //   exactly 1 match          → auto-redirect to include ?instance=<id>
  //                              (completed or not — opening the only real
  //                              instance is never ambiguous)
  //   2+ matches               → show picker; never guess between valid
  //                              instances even when only one is incomplete
  const shouldResolveLegacy = !!clientId && !search.instance;
  const { data: legacyCandidates } = useQuery({
    queryKey: ["portal-workout-instance-candidates", clientId, dayId],
    enabled: shouldResolveLegacy,
    queryFn: async () => {
      const { data } = await supabase
        .from("pl_scheduled_workouts")
        .select("id, scheduled_date, scheduled_time, order_index")
        .eq("client_id", clientId!)
        .eq("source_day_id", dayId)
        .order("scheduled_date", { ascending: true })
        .order("order_index", { ascending: true });
      const rows = (data ?? []) as any[];
      if (!rows.length) return { rows, completedById: {} as Record<string, boolean> };
      const ids = rows.map((r) => r.id);
      const { data: comps } = await supabase
        .from("pl_day_completions")
        .select("scheduled_workout_id, completed_at")
        .in("scheduled_workout_id", ids as any);
      const completedById: Record<string, boolean> = {};
      for (const c of (comps ?? []) as any[]) {
        if (c.scheduled_workout_id && c.completed_at) completedById[c.scheduled_workout_id] = true;
      }
      return { rows, completedById };
    },
  });

  // Auto-redirect only when there is exactly one candidate — never guess
  // between multiple valid instances.
  useEffect(() => {
    if (!shouldResolveLegacy || !legacyCandidates) return;
    const rows = legacyCandidates.rows;
    if (!rows.length) return; // legacy path
    if (rows.length === 1) {
      navigate({
        to: "/portal/workouts/$dayId",
        params: { dayId },
        search: { ...search, instance: rows[0].id } as any,
        replace: true,
      });
    }
  }, [shouldResolveLegacy, legacyCandidates, dayId, navigate, search]);

  const { data: dayRow } = useQuery({
    queryKey: ["portal-workout-day-cardio-date", dayId],
    enabled: !!dayId,
    queryFn: async () =>
      (await supabase.from("pl_days").select("scheduled_date").eq("id", dayId).maybeSingle()).data,
  });

  const adapter = useMemo(() => {
    if (!clientId || !clientUserId) return undefined;
    return createClientAdapter({
      kind: "client",
      userId: clientUserId,
      ownerId: clientId,
      scheduledWorkoutId: search.instance ?? null,
    });
  }, [clientId, clientUserId, search.instance]);

  // Show picker only when 2+ candidates exist.
  if (shouldResolveLegacy && legacyCandidates && legacyCandidates.rows.length > 1) {
    const rows = legacyCandidates.rows;
    {
      return (
        <div className="p-6">
          <Card className="space-y-3 p-6">
            <div className="text-base font-bold">Choose which scheduled workout to open</div>
            <div className="text-sm text-muted-foreground">
              This workout is scheduled on more than one date. Pick the instance you want to open.
            </div>
            <div className="space-y-2">
              {rows.map((r: any) => {
                const done = !!legacyCandidates.completedById[r.id];
                return (
                  <Button
                    key={r.id}
                    variant="outline"
                    className="w-full justify-between"
                    onClick={() =>
                      navigate({
                        to: "/portal/workouts/$dayId",
                        params: { dayId },
                        search: { ...search, instance: r.id } as any,
                        replace: true,
                      })
                    }
                  >
                    <span>
                      {r.scheduled_date}
                      {r.scheduled_time ? ` · ${String(r.scheduled_time).slice(0, 5)}` : ""}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {done ? "Completed" : "Incomplete"}
                    </span>
                  </Button>
                );
              })}
            </div>
          </Card>
        </div>
      );
    }
  }

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
    >
      {clientId && (
        <ClientCardioSection
          clientId={clientId}
          dayContext="unknown"
          date={parseLocalDate((dayRow as any)?.scheduled_date) ?? new Date()}
          hideWhenEmpty
          readonly={search.readonly === 1}
        />
      )}
    </WorkoutDayView>
  );
}