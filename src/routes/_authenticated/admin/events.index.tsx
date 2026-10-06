import { createFileRoute } from "@tanstack/react-router";
import { EventsRedirect } from "@/route-pages/_authenticated/admin/events.index";

export const Route = createFileRoute("/_authenticated/admin/events/")({
  component: EventsRedirect,
});
