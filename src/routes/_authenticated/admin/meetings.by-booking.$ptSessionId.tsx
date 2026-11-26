import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ErrorState } from "@/components/loading";
import { Skeleton } from "@/components/ui/skeleton";
import { meetingForBookingFn } from "@/lib/coaching-sessions/sessions.functions";

/**
 * A booked call's meeting (the coach's reminder push and calendar link here):
 * the meeting is prepared if it isn't yet, then its command centre opens in
 * this entry's place, so Back never lands on this hop.
 */
export const Route = createFileRoute("/_authenticated/admin/meetings/by-booking/$ptSessionId")({
  component: ByBooking,
});

function ByBooking() {
  const { ptSessionId } = Route.useParams();
  const find = useServerFn(meetingForBookingFn);
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ["meeting-for-booking", ptSessionId],
    queryFn: () => find({ data: { ptSessionId } }),
    retry: 1,
  });
  useEffect(() => {
    if (q.data?.id)
      navigate({
        to: "/admin/meetings/$sessionId",
        params: { sessionId: q.data.id },
        replace: true,
      });
  }, [q.data?.id, navigate]);
  if (q.error)
    return (
      <div className="mx-auto max-w-3xl px-4 py-6">
        <ErrorState
          error={q.error}
          what="this meeting"
          onRetry={() => q.refetch()}
          retrying={q.isFetching}
        />
      </div>
    );
  return (
    <div className="mx-auto max-w-3xl space-y-3 px-4 py-6">
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-48" />
    </div>
  );
}
