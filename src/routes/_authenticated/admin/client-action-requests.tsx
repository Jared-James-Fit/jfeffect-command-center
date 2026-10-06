import { createFileRoute } from "@tanstack/react-router";
import { ClientActionRequestsRedirect } from "@/route-pages/_authenticated/admin/client-action-requests";

export const Route = createFileRoute("/_authenticated/admin/client-action-requests")({
  component: ClientActionRequestsRedirect,
});
