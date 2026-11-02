import { createFileRoute } from "@tanstack/react-router";
import { NextProgramWorkstation } from "@/components/program-intel/generator/workstation";

export const Route = createFileRoute("/_authenticated/admin/client-programs/$clientId/next-program")({
  component: NextProgramRoute,
});

function NextProgramRoute() {
  const { clientId } = Route.useParams();
  return <NextProgramWorkstation clientId={clientId} />;
}
