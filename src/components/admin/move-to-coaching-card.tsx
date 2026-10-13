import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowUpRight, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getMemberCoachingState, moveMemberToCoaching } from "@/lib/members.functions";

/**
 * Member → coaching in one step: same account, a coach assigned, and every
 * workout, PR and photo they logged comes with them (the coach starts with
 * real data). Coaching billing is set up separately, as for any client.
 */
export function MoveToCoachingCard({ memberId }: { memberId: string }) {
  const qc = useQueryClient();
  const fetchState = useServerFn(getMemberCoachingState);
  const move = useServerFn(moveMemberToCoaching);
  const { data, refetch } = useQuery({ queryKey: ["member-coaching-state", memberId], queryFn: () => fetchState({ data: { memberId } }) });
  const [coachId, setCoachId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  if (!data) return null;

  if (data.tier === "coaching" && data.clientId) {
    return (
      <Card data-move-to-coaching="done" className="flex flex-wrap items-center justify-between gap-3 p-5">
        <div className="flex items-start gap-3">
          <UserCheck className="mt-0.5 h-5 w-5 text-emerald-500" />
          <div>
            <div className="font-semibold">Coaching client</div>
            <div className="text-sm text-muted-foreground">Their training history is in the client profile.</div>
          </div>
        </div>
        <Link to="/admin/clients/$id" params={{ id: data.clientId }}>
          <Button variant="outline" size="sm">Open client <ArrowUpRight className="ml-1 h-3.5 w-3.5" /></Button>
        </Link>
      </Card>
    );
  }

  const submit = async () => {
    if (!coachId || busy) return;
    setBusy(true);
    try {
      await move({ data: { memberId, coachId } });
      toast.success("Moved to coaching", { description: "Their history came with them. Set up coaching billing from the client profile." });
      await refetch();
      void qc.invalidateQueries({ queryKey: ["admin-clients-directory"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't move them to coaching");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card data-move-to-coaching="offer" className="space-y-3 p-5">
      <div>
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Move to coaching</div>
        <p className="mt-1 text-sm text-muted-foreground">
          Same account, a coach assigned. Every workout, PR and photo they've logged comes with them, so their coach starts with real data. Coaching billing is set up separately.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={coachId} onValueChange={setCoachId}>
          <SelectTrigger className="h-9 w-[220px]"><SelectValue placeholder="Choose a coach" /></SelectTrigger>
          <SelectContent>
            {data.coaches.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" disabled={!coachId || busy} onClick={submit}>{busy ? "Moving…" : "Move to coaching"}</Button>
      </div>
    </Card>
  );
}
