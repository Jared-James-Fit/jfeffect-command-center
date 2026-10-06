import { createFileRoute } from "@tanstack/react-router";
import { CoachingApplicationsRedirect } from "@/route-pages/_authenticated/admin/sales.coaching-applications";

export const Route = createFileRoute("/_authenticated/admin/sales/coaching-applications")({
  component: CoachingApplicationsRedirect,
});
