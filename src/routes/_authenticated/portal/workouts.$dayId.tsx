import { createFileRoute } from "@tanstack/react-router";
import { WorkoutDayView } from "@/components/workout-day/WorkoutDayView";

export const Route = createFileRoute("/_authenticated/portal/workouts/$dayId")({
  validateSearch: (s: Record<string, unknown>) => ({
    readonly: s.readonly === 1 || s.readonly === "1" || s.readonly === true ? 1 : undefined,
    // Coach- or client-initiated "open in edit mode" — auto-unlocks past workouts
    // and auto-opens the feedback sheet when the user wants to edit a review.
    edit: s.edit === 1 || s.edit === "1" || s.edit === true ? 1 : undefined,
    review: s.review === 1 || s.review === "1" || s.review === true ? 1 : undefined,
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { dayId } = Route.useParams();
  const search = Route.useSearch();
  return <WorkoutDayView dayId={dayId} search={search} />;
}