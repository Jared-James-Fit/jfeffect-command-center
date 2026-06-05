import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/portal/media")({
  component: () => <Navigate to="/portal/check-in" replace />,
});