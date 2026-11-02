import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { fallback, zodValidator } from "@tanstack/zod-adapter";
import { ProgramIntelligencePage } from "@/components/program-intel/ProgramIntelligencePage";

const searchSchema = z.object({
  scope: fallback(z.enum(["program", "dates", "history"]), "program").default("program"),
  from: fallback(z.string(), "").default(""),
  to: fallback(z.string(), "").default(""),
  tab: fallback(z.string(), "summary").default("summary"),
});

export const Route = createFileRoute("/_authenticated/admin/client-programs/$clientId/intelligence")({
  validateSearch: zodValidator(searchSchema),
  component: IntelligenceRoute,
});

function IntelligenceRoute() {
  const { clientId } = Route.useParams();
  const search = Route.useSearch();
  return <ProgramIntelligencePage clientId={clientId} search={search} />;
}
