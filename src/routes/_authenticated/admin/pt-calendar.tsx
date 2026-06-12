import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/admin/pt-calendar")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/calendar", search: { tab: "pt-calendar" } as any });
  },
});