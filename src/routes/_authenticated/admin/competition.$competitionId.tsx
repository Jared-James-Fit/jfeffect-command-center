import { createFileRoute } from "@tanstack/react-router";
import { lazyWithRetry } from "@/lib/lazy-chunk";
import { Suspense } from "react";

/**
 * The meet-day command centre for one competition (Nov 24 2026): full screen,
 * one-handed, attempts logged even with no signal (competition/meet-day.tsx).
 * Opened from the client's Competition tab and the dashboard's competitions.
 */
const MeetDay = lazyWithRetry(() =>
  import("@/components/competition/meet-day").then((m) => ({ default: m.MeetDayCommandCentre })),
);

export const Route = createFileRoute("/_authenticated/admin/competition/$competitionId")({
  component: MeetDayRoute,
});

function MeetDayRoute() {
  const { competitionId } = Route.useParams();
  return (
    <Suspense fallback={<div className="fixed inset-0 z-50 bg-background" />}>
      <MeetDay competitionId={competitionId} />
    </Suspense>
  );
}
