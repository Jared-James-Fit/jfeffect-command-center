import { Suspense } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { lazyWithRetry } from "@/lib/lazy-chunk";

const ScriptWindow = lazyWithRetry(() =>
  import("@/components/coaching-sessions/script-window").then((m) => ({ default: m.ScriptWindow })),
);

/** The coach's private script in its own window, so only the slides window is shared. */
export const Route = createFileRoute("/_authenticated/admin/meetings/$sessionId/script")({
  component: ScriptRoute,
});

function ScriptRoute() {
  const { sessionId } = Route.useParams();
  return (
    <Suspense fallback={<div className="fixed inset-0 z-50 bg-background" />}>
      <ScriptWindow sessionId={sessionId} />
    </Suspense>
  );
}
