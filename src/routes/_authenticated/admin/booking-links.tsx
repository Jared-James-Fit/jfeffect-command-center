import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/admin/booking-links")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/calendar", search: { tab: "booking-links" } as any });
  },
});
