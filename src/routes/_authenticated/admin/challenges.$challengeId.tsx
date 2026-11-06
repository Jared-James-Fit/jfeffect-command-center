import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { AdminChallengePage, type EditorTab } from "@/components/challenges/admin/editor";

const TABS = ["setup", "prizes", "updates", "people", "results", "insights", "team"] as const;

/** One challenge: setup, prizes, results and winners, people, insights, staff. */
export const Route = createFileRoute("/_authenticated/admin/challenges/$challengeId")({
  validateSearch: z.object({ tab: z.enum(TABS).optional() }),
  head: () => ({ meta: [{ title: "Challenge" }] }),
  component: function AdminChallengeRoute() {
    const { challengeId } = Route.useParams();
    const { tab } = Route.useSearch();
    const navigate = Route.useNavigate();
    return (
      <AdminChallengePage
        challengeId={challengeId}
        tab={(tab ?? "setup") as EditorTab}
        onTab={(t) => navigate({ search: { tab: t === "setup" ? undefined : t }, replace: true })}
      />
    );
  },
});
