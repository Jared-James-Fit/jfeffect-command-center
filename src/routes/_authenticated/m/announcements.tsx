import { createFileRoute } from "@tanstack/react-router";
export { Route as default } from "@/routes/_authenticated/portal/announcements";
import { Route as PortalAnnouncementsRoute } from "@/routes/_authenticated/portal/announcements";

export const Route = createFileRoute("/_authenticated/m/announcements")({
  component: (PortalAnnouncementsRoute.options as any).component,
});