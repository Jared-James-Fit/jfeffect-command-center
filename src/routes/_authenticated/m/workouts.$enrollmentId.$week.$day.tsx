// Thin route shim: mounts the shared <WorkoutDayView> with the member
// adapter so member workouts run the same UI / write paths as the coach
// portal. The previous 657-line monolith duplicated read shapes (DTO
// queries) and write paths (`m_log_set` / `m_complete_workout` offline
// handlers) that the adapter now subsumes — every member write reshapes
// from a pl_*-row payload to the member_* tables inside the adapter.
//
// dayId convention: the member adapter encodes (week, day) tuples as the
// string `"week:day"` (see encodeDayId / decodeDayId in member-adapter.ts).
// The shared view treats it as an opaque id.
import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { WorkoutDayView } from "@/components/workout-day/WorkoutDayView";
import { ClientCardioSection } from "@/components/cardio/ClientCardioSection";
import { buildWorkoutAdapter } from "@/lib/workout-context";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/m/workouts/$enrollmentId/$week/$day")({
  // Mirror the portal route's search contract so deep links into the
  // member workout (readonly preview, "edit past workout", "leave a
  // review") behave identically across both surfaces.
  validateSearch: (s: Record<string, unknown>): { readonly?: 1; edit?: 1; review?: 1; recap?: 1 } => ({
    readonly: s.readonly === 1 || s.readonly === "1" || s.readonly === true ? 1 : undefined,
    edit: s.edit === 1 || s.edit === "1" || s.edit === true ? 1 : undefined,
    review: s.review === 1 || s.review === "1" || s.review === true ? 1 : undefined,
    recap: s.recap === 1 || s.recap === "1" || s.recap === true ? 1 : undefined,
  }),
  component: MemberWorkoutRoute,
});

function MemberWorkoutRoute() {
  const { enrollmentId, week, day } = Route.useParams();
  const search = Route.useSearch();
  const { user } = useAuth();

  // Member adapter: ownerId == userId because there's no `clients` row
  // (members live in `member_*` tables). The adapter rewrites all
  // pl_*-shaped reads/writes against member_* on the way through.
  const adapter = useMemo(
    () =>
      user?.id
        ? buildWorkoutAdapter({
            kind: "member",
            userId: user.id,
            ownerId: user.id,
            enrollmentId,
          })
        : undefined,
    [user?.id, enrollmentId],
  );

  // The protected layout already redirects unauthenticated visitors, but
  // guard against the transient render where `user` resolves after the
  // first paint so we never mount WorkoutDayView with a null adapter
  // (its queries assume one is present when `adapter.kind === "member"`).
  if (!adapter) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <WorkoutDayView
      dayId={`${week}:${day}`}
      search={search}
      adapter={adapter}
      navigation={{
        backTo: `/m/my-plans/${enrollmentId}`,
        listPath: `/m/my-plans/${enrollmentId}`,
        // Members don't have a dedicated messages inbox — `/m/support`
        // is the single coach-contact surface, so all "Contact coach"
        // CTAs from the shared workout view route there.
        messagesPath: "/m/support",
      }}
    >
      {user?.id && (
        <ClientCardioSection
          clientId={user.id}
          dayContext="training"
          date={new Date()}
          hideWhenEmpty
        />
      )}
    </WorkoutDayView>
  );
}
