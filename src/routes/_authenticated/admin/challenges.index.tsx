import { createFileRoute } from "@tanstack/react-router";
import { AdminChallengesPage } from "@/components/challenges/admin/admin-list";

/** Live challenges: every event, templates, and New challenge. */
export const Route = createFileRoute("/_authenticated/admin/challenges/")({
  head: () => ({ meta: [{ title: "Challenges" }] }),
  component: AdminChallengesPage,
});
