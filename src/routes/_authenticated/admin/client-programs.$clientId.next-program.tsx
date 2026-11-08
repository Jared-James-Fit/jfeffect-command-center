import { createFileRoute } from "@tanstack/react-router";
import { NextProgramWorkstation } from "@/components/program-intel/generator/workstation";

type Prefill = { notes?: string; weeks?: number; days?: number };

export const Route = createFileRoute("/_authenticated/admin/client-programs/$clientId/next-program")({
  component: NextProgramRoute,
  // Edit with AI hands a rebuild over with the coach's words (and the weeks / days it read from them)
  validateSearch: (s: Record<string, unknown>): Prefill => {
    const num = (v: unknown) => {
      const n = Number(v);
      return Number.isInteger(n) && n > 0 ? n : undefined;
    };
    return {
      notes: typeof s.notes === "string" && s.notes.trim() ? s.notes.slice(0, 2000) : undefined,
      weeks: num(s.weeks),
      days: num(s.days),
    };
  },
});

function NextProgramRoute() {
  const { clientId } = Route.useParams();
  const prefill = Route.useSearch();
  return <NextProgramWorkstation clientId={clientId} prefill={prefill.notes || prefill.weeks || prefill.days ? prefill : undefined} />;
}
