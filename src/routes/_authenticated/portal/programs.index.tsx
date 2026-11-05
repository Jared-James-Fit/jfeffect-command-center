import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ProgramsHub } from "@/components/athlete-programs/programs-hub";

export const Route = createFileRoute("/_authenticated/portal/programs/")({
  validateSearch: z.object({ tab: z.enum(["crew", "mine"]).optional() }),
  component: function ProgramsPage() {
    const { tab } = Route.useSearch();
    return <ProgramsHub initialTab={tab ?? "crew"} />;
  },
});
