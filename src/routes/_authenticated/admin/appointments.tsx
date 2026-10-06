import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/admin/appointments")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/calendar", search: { tab: "upcoming" } as any });
  },
});
