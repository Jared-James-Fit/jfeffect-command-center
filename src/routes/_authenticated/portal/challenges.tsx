import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app-shell";
import { ChallengesHub } from "@/components/challenges/hub";

/** Challenges inside the app: what's live, what's coming, your results. */
export const Route = createFileRoute("/_authenticated/portal/challenges")({
  head: () => ({ meta: [{ title: "Challenges" }] }),
  component: function PortalChallenges() {
    return (
      <div>
        <PageHeader title="Challenges" subtitle="Real events, real judges, a live leaderboard." />
        <div className="mx-auto max-w-3xl px-4 py-5">
          <ChallengesHub inApp />
        </div>
      </div>
    );
  },
});
