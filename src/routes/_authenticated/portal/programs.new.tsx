import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ProgramBuilder } from "@/components/athlete-programs/program-builder";

// New program, or ?edit=<id> for one of your own.
export const Route = createFileRoute("/_authenticated/portal/programs/new")({
  validateSearch: z.object({ edit: z.string().uuid().optional() }),
  component: function NewProgramPage() {
    const { edit } = Route.useSearch();
    return <ProgramBuilder key={edit ?? "new"} editId={edit ?? null} />;
  },
});
