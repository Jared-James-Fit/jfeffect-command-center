/**
 * Cleo's action cards: what she offered to do, under the reply that offered
 * it, and (for the owner) the requests waiting on their OK. Nothing runs
 * until someone taps here.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, Clock, Loader2, ShieldQuestion, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { decideCleoAction, getCleoActions } from "@/lib/business-books.functions";
import { statusLabel, type CleoActionView } from "@/lib/cleo-actions";

type CleoActionsData = { actions: CleoActionView[]; approvals: CleoActionView[]; ownerName: string };

const KEY = ["cleo-actions"];

export function useCleoActions(open: boolean) {
  const load = useServerFn(getCleoActions);
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: KEY,
    queryFn: () => load() as Promise<CleoActionsData>,
    enabled: open,
    staleTime: 15_000,
    // Someone waiting on the owner (or an owner with requests) sees changes without reopening.
    refetchInterval: (q) => {
      const d = q.state.data as CleoActionsData | undefined;
      return open && d && (d.approvals.length || d.actions.some((a) => a.status === "awaiting_approval" || a.status === "running")) ? 30_000 : false;
    },
  });
  return {
    data: query.data,
    refresh: () => qc.invalidateQueries({ queryKey: KEY }),
    forMessage: (id: string) => (query.data?.actions ?? []).filter((a) => a.messageId === id).reverse(),
  };
}

const TONE: Record<CleoActionView["status"], string> = {
  proposed: "text-primary",
  awaiting_approval: "text-amber-600 dark:text-amber-400",
  running: "text-muted-foreground",
  done: "text-emerald-600 dark:text-emerald-400",
  failed: "text-destructive",
  declined: "text-destructive",
  cancelled: "text-muted-foreground",
};

export function CleoActionCard({ action, ownerName, mode = "mine" }: { action: CleoActionView; ownerName: string; mode?: "mine" | "approval" }) {
  const decide = useServerFn(decideCleoAction);
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (decision: "confirm" | "cancel" | "approve" | "decline") => {
    setBusy(decision);
    try {
      const r: any = await decide({ data: { id: action.id, decision } });
      if (r?.status === "done") toast.success(r.result ?? "Done");
      else if (r?.status === "failed") toast.error(r.error ?? "That didn't work");
      else if (r?.status === "awaiting_approval") toast.success(`Sent to ${ownerName} for approval`);
      else if (r?.status === "declined") toast.success("Declined");
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't do that");
    } finally {
      setBusy(null);
      await qc.invalidateQueries({ queryKey: KEY });
    }
  };

  const open = action.status === "proposed";
  const asking = open && action.route === "ask_owner";
  return (
    <div className="w-full rounded-2xl border bg-card p-3 text-left shadow-sm">
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold">
          {mode === "approval" ? `${action.requesterName ?? "Someone"} asks: ${action.title.toLowerCase()}` : action.title}
        </p>
        {mode === "mine" && <span className={cn("shrink-0 text-[11px] font-medium", TONE[action.status])}>{statusLabel(action.status, ownerName)}</span>}
      </div>
      <p className="whitespace-pre-wrap text-sm text-foreground/90">{action.summary}</p>
      {action.status === "done" && action.result && <p className="mt-1.5 flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400"><Check className="h-3.5 w-3.5" /> {action.result}</p>}
      {action.status === "failed" && action.error && <p className="mt-1.5 text-xs text-destructive">{action.error}</p>}
      {asking && (
        <p className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
          <ShieldQuestion className="h-3.5 w-3.5" /> Not in your role, so {ownerName} has to approve it.
        </p>
      )}
      {mode === "mine" && action.status === "awaiting_approval" && (
        <p className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground"><Clock className="h-3.5 w-3.5" /> Sent to {ownerName}. You'll get a notification when they decide.</p>
      )}
      {(open || (mode === "mine" && action.status === "awaiting_approval") || (mode === "approval" && action.status === "awaiting_approval")) && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {mode === "approval" ? (
            <>
              <Button size="sm" className="h-8" disabled={!!busy} onClick={() => void act("approve")}>
                {busy === "approve" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />} Approve
              </Button>
              <Button size="sm" variant="outline" className="h-8" disabled={!!busy} onClick={() => void act("decline")}>
                {busy === "decline" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <X className="mr-1 h-3.5 w-3.5" />} Decline
              </Button>
            </>
          ) : (
            <>
              {open && (
                <Button size="sm" className="h-8" disabled={!!busy} onClick={() => void act("confirm")}>
                  {busy === "confirm" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : asking ? <ShieldQuestion className="mr-1 h-3.5 w-3.5" /> : <Check className="mr-1 h-3.5 w-3.5" />}
                  {asking ? `Ask ${ownerName}` : "Confirm"}
                </Button>
              )}
              <Button size="sm" variant="ghost" className="h-8 text-muted-foreground" disabled={!!busy} onClick={() => void act("cancel")}>
                {busy === "cancel" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null} {open ? "Cancel" : "Cancel request"}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** The owner's "waiting for your OK" list, pinned above the chat. */
export function CleoApprovals({ approvals, ownerName }: { approvals: CleoActionView[]; ownerName: string }) {
  if (!approvals.length) return null;
  return (
    <div className="space-y-2 rounded-2xl border border-amber-500/40 bg-amber-500/5 p-3">
      <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">Waiting for your OK ({approvals.length})</p>
      {approvals.map((a) => (
        <CleoActionCard key={a.id} action={a} ownerName={ownerName} mode="approval" />
      ))}
    </div>
  );
}
