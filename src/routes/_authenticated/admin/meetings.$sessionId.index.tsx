import { Suspense } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/app-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { lazyWithRetry } from "@/lib/lazy-chunk";

const MeetingCommandCentre = lazyWithRetry(() =>
  import("@/components/coaching-sessions/command-centre").then((m) => ({
    default: m.MeetingCommandCentre,
  })),
);

/** One meeting's command centre (Prepare · Connect · Execute), coach only. */
export const Route = createFileRoute("/_authenticated/admin/meetings/$sessionId/")({
  component: MeetingRoute,
});

function MeetingRoute() {
  const { sessionId } = Route.useParams();
  return (
    <>
      <PageHeader title="Meeting" backTo="/admin" />
      <Suspense
        fallback={
          <div className="mx-auto max-w-3xl space-y-3 px-4 py-6">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-64" />
          </div>
        }
      >
        <MeetingCommandCentre sessionId={sessionId} />
      </Suspense>
    </>
  );
}
