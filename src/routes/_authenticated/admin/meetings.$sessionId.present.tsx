import { createFileRoute } from "@tanstack/react-router";
import { lazyWithRetry } from "@/lib/lazy-chunk";
import { Suspense } from "react";

/**
 * A coaching meeting on a shared screen (Nov 25 2026): full screen and
 * athlete-safe, opened from the meeting's Present button in its own window so
 * the coach's workspace stays private in the other (coaching-sessions).
 */
const PresentationScreen = lazyWithRetry(() =>
  import("@/components/coaching-sessions/presentation-screen").then((m) => ({ default: m.PresentationScreen })),
);

export const Route = createFileRoute("/_authenticated/admin/meetings/$sessionId/present")({
  component: PresentRoute,
});

function PresentRoute() {
  const { sessionId } = Route.useParams();
  return (
    <Suspense fallback={<div className="fixed inset-0 z-50 bg-background" />}>
      <PresentationScreen sessionId={sessionId} />
    </Suspense>
  );
}
