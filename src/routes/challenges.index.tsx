import { createFileRoute } from "@tanstack/react-router";
import { ChallengesHub } from "@/components/challenges/hub";
import { PublicBar, PublicFooter } from "@/components/challenges/ui";
import { getHubFn } from "@/lib/challenges/public.functions";
import { shareMeta } from "@/lib/share-meta";

// /challenges: every public challenge, live first, then upcoming, then past winners.
export const Route = createFileRoute("/challenges/")({
  loader: () => getHubFn(),
  head: () => ({
    meta: [
      { title: "Fitness Challenges in Winnipeg | JF Effect" },
      { name: "description", content: "Live strength and fitness challenges with real judges and a live leaderboard. Enter, put up a number and share your result." },
      ...shareMeta({ title: "JF Effect Challenges", description: "Live challenges, real judges, a live leaderboard.", path: "/challenges" }),
    ],
    links: [{ rel: "canonical", href: "https://jfeffect.com/challenges" }],
  }),
  component: function ChallengesRoute() {
    const initial = Route.useLoaderData();
    return (
      <div className="min-h-screen bg-background">
        <PublicBar />
        <main className="mx-auto max-w-3xl px-4 pb-6 pt-6">
          <ChallengesHub initial={initial} />
        </main>
        <PublicFooter />
      </div>
    );
  },
});
