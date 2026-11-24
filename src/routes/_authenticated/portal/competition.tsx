/**
 * The athlete's competition (Nov 24 2026): their meet, the game plan their coach
 * approved and every preparation update released to them
 * (components/competition/athlete-competition.tsx). Opened from the update's
 * card in their coach chat and its push (`?update=`).
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { PageHeader } from "@/components/app-shell";
import { AthleteCompetition } from "@/components/competition/athlete-competition";

export const Route = createFileRoute("/_authenticated/portal/competition")({
  validateSearch: (s) => z.object({ update: z.string().uuid().optional() }).catch({}).parse(s),
  component: CompetitionPage,
});

function CompetitionPage() {
  const { update } = Route.useSearch();
  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 pb-8">
      <PageHeader title="Competition" backTo="/portal" />
      <AthleteCompetition focusUpdate={update ?? null} />
    </div>
  );
}
