import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/admin/offers")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/payment-links" });
  },
});