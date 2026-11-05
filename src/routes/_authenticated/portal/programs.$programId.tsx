import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ProgramDetailPage } from "@/components/athlete-programs/program-detail";

export const Route = createFileRoute("/_authenticated/portal/programs/$programId")({
  validateSearch: z.object({ start: z.coerce.number().optional() }),
  component: function ProgramPage() {
    const { programId } = Route.useParams();
    const { start } = Route.useSearch();
    return <ProgramDetailPage key={programId} programId={programId} autoStart={start === 1} />;
  },
});
