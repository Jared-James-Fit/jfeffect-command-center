import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { LeadsPage } from "@/components/leads/leads-page";

export const Route = createFileRoute("/_authenticated/admin/leads")({
  validateSearch: (s) => z.object({ id: z.string().uuid().optional() }).catch({}).parse(s),
  component: LeadsRoute,
});

function LeadsRoute() {
  const { id } = Route.useSearch();
  return <LeadsPage focusId={id} />;
}
