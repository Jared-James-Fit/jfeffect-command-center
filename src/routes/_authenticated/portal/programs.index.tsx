import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ProgramsHub } from "@/components/athlete-programs/programs-hub";

export const Route = createFileRoute("/_authenticated/portal/programs/")({
  // mine: what's on your calendar and everything you built or saved;
  // jf: JF Effect's coach-written plans; crew: what the crew shares
  validateSearch: z.object({ tab: z.enum(["mine", "jf", "crew"]).optional() }),
  component: function ProgramsPage() {
    const { tab } = Route.useSearch();
    return <ProgramsHub initialTab={tab} />;
  },
});
