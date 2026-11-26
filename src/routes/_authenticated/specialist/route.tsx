import { createFileRoute } from "@tanstack/react-router";
import { SpecialistLayout } from "@/components/specialist/specialist-shell";

/** A specialist's (game day coach, performance specialist) own area: Footage, Training, Performance. */
export const Route = createFileRoute("/_authenticated/specialist")({
  component: SpecialistLayout,
});
