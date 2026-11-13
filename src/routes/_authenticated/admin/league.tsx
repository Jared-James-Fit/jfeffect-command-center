import { createFileRoute } from "@tanstack/react-router";
import { AdminLeaguePage } from "@/components/community/admin-league-page";

/** The coach's League (the trophy bubble in Crew's stories, and More): standings, crew goal, Hall of Strength and its tools. */
export const Route = createFileRoute("/_authenticated/admin/league")({
  head: () => ({ meta: [{ title: "League" }] }),
  component: AdminLeaguePage,
});
