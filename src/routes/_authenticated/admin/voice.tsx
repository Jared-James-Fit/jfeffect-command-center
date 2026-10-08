import { createFileRoute } from "@tanstack/react-router";
import { CoachVoicePage } from "@/route-pages/_authenticated/admin/voice";

export const Route = createFileRoute("/_authenticated/admin/voice")({
  component: CoachVoicePage,
});
