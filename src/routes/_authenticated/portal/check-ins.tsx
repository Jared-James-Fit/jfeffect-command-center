import { createFileRoute } from "@tanstack/react-router";
import { ClientCheckInsList } from "@/route-pages/_authenticated/portal/check-ins";

export const Route = createFileRoute("/_authenticated/portal/check-ins")({
  component: ClientCheckInsList,
});
