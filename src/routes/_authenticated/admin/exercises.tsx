import { createFileRoute } from "@tanstack/react-router";
import { ExercisesRedirect } from "@/route-pages/_authenticated/admin/exercises";

export const Route = createFileRoute("/_authenticated/admin/exercises")({
  component: ExercisesRedirect,
});
