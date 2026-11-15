import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ProgramGapsPage } from "@/components/program-gaps/program-gaps-page";

export const Route = createFileRoute("/_authenticated/admin/program-gaps")({
  validateSearch: (s) => z.object({ client: z.string().uuid().optional() }).catch({}).parse(s),
  component: ProgramGapsRoute,
});

function ProgramGapsRoute() {
  const { client } = Route.useSearch();
  return <ProgramGapsPage focusClient={client} />;
}
