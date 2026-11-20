import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { LeadsPage } from "@/components/leads/leads-page";

// Applications: free membership (`app`) and coaching leads (`id`), one page.
export const Route = createFileRoute("/_authenticated/admin/leads")({
  validateSearch: (s) =>
    z
      .object({
        id: z.string().uuid().optional(),
        app: z.string().uuid().optional(),
        tab: z.enum(["members", "coaching"]).optional(),
      })
      .catch({})
      .parse(s),
  component: LeadsRoute,
});

function LeadsRoute() {
  const { id, app, tab } = Route.useSearch();
  return <LeadsPage focusId={id} appId={app} tab={tab} />;
}
