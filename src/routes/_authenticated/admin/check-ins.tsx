import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/admin/check-ins")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/native-forms" });
  },
  component: () => null,
});