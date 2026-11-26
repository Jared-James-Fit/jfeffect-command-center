import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MeetOnboarding } from "@/components/competition/prep/meet-onboarding";
import { getMyMeetFn } from "@/lib/competition/handling.functions";

/** Resume the existing, authenticated competition intake; never create a second form or copy answers. */
export function HandlingSetupDialog({ clientId, meetId, onClose }: {
  clientId: string; meetId: string; onClose: () => void;
}) {
  const read = useServerFn(getMyMeetFn);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["home-handling-intake", clientId, meetId],
    queryFn: () => read({ data: { competitionId: meetId, clientId } }),
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const close = () => {
    void qc.invalidateQueries({ queryKey: ["goals-service-scope", clientId] });
    void qc.invalidateQueries({ queryKey: ["my-meet", meetId] });
    void qc.invalidateQueries({ queryKey: ["my-competitions"] });
    onClose();
  };
  const m = q.data;
  const available = m?.self && m.handling && !["cancelled", "completed"].includes(m.handling.status) && m.competition.status === "upcoming";
  return (
    <Dialog open onOpenChange={open => { if (!open) close(); }}>
      <DialogContent className="max-h-[90dvh] w-[calc(100%-1.5rem)] max-w-2xl overflow-y-auto rounded-2xl p-4 sm:p-6">
        <DialogHeader className="text-left">
          <DialogTitle>Complete your competition setup</DialogTitle>
          <DialogDescription>Answer the questions your handler needs. Each completed step is saved, so you can finish later.</DialogDescription>
        </DialogHeader>
        {q.isFetching ? <Skeleton className="h-40 rounded-xl" /> : q.isError ? (
          <div className="space-y-2"><p className="text-sm text-muted-foreground">We couldn't load your competition questions.</p><Button variant="outline" onClick={() => void q.refetch()}>Try again</Button></div>
        ) : available && m && (!m.infoComplete || !m.handling?.termsAcceptedAt) ? (
          <MeetOnboarding meet={m} previewing={false} onDone={close} />
        ) : (
          <div className="space-y-2"><p className="text-sm text-muted-foreground">{available ? "Your competition setup is complete." : "This competition is no longer available for setup."}</p><Button onClick={close}>Done</Button></div>
        )}
      </DialogContent>
    </Dialog>
  );
}
