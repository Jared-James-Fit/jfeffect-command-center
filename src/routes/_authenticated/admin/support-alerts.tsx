import { createFileRoute } from "@tanstack/react-router";
import { SupportAlertsRedirect } from "@/route-pages/_authenticated/admin/support-alerts";

export const Route = createFileRoute("/_authenticated/admin/support-alerts")({
  component: SupportAlertsRedirect,
});
