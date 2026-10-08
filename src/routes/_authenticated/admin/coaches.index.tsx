import { createFileRoute } from "@tanstack/react-router";
import { CoachesRedirect } from "@/route-pages/_authenticated/admin/coaches.index";

export const Route = createFileRoute("/_authenticated/admin/coaches/")({
  component: CoachesRedirect,
});
