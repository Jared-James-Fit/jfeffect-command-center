import { createFileRoute, redirect } from "@tanstack/react-router";

// Removed page: Training Intel was the Coaching Hub's first tab (gone Nov 19 2026,
// see admin/coaching.tsx). Its address lands on Clients, sorted by what needs attention.
export const Route = createFileRoute("/_authenticated/admin/training-intelligence")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/clients", search: { sort: "attention" }, replace: true });
  },
});
