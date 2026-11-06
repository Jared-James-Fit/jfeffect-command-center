import { createFileRoute } from "@tanstack/react-router";
import { AdminChallengesList } from "@/components/challenges/admin/challenges-list";

/** Admin → Challenges: live events with registration, judging and a public leaderboard. */
export const Route = createFileRoute("/_authenticated/admin/challenges/")({
  head: () => ({ meta: [{ title: "Challenges" }] }),
  component: AdminChallengesList,
});
