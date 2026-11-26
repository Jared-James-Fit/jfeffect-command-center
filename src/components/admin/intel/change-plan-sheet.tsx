/**
 * Change plan: move someone between the free membership and coaching on the same record. Shows
 * what it means for them first (membership-model.ts planChangeLines) and anything that stops it
 * (a subscription that would keep charging, no login, a deactivated account), then one button.
 * The server reads it all again before changing anything (changePlanFn).
 */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowRight, Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { MEMBERS_KEY } from "@/components/members/members-directory";
import { changePlanFn, getPlanChangeReviewFn } from "@/lib/admin-intel/membership.functions";
import { planChangeLines, type PlanChangeReview, type PlanTier } from "@/lib/admin-intel/membership-model";

const TIER_LABEL: Record<PlanTier, string> = { membership: "Free membership", coaching: "Coaching" };

export function ChangePlanSheet({
  clientId,
  open,
  onOpenChange,
  onDone,
}: {
  clientId: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone?: (to: PlanTier) => void;
}) {
  const qc = useQueryClient();
  const fetchReview = useServerFn(getPlanChangeReviewFn);
  const change = useServerFn(changePlanFn);
  const q = useQuery({
    queryKey: ["plan-change-review", clientId],
    queryFn: () => fetchReview({ data: { clientId: clientId! } }) as Promise<PlanChangeReview>,
    enabled: open && !!clientId,
    staleTime: 0,
  });
  const r = q.data;
  const to: PlanTier | null = r ? (r.tier === "coaching" ? "membership" : "coaching") : null;
  const [coachId, setCoachId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const chosenCoach = coachId || r?.assignedCoachId || (r?.coaches.length === 1 ? r.coaches[0].id : "");

  const run = async () => {
    if (!r || !to) return;
    if (to === "coaching" && !chosenCoach) return toast.error("Pick the coach they'll work with");
    setBusy(true);
    try {
      await change({ data: { clientId: r.clientId, to, coachId: to === "coaching" ? chosenCoach : null } });
      toast.success(to === "coaching" ? `${r.name} is now a coaching client` : `${r.name} is now a free member`);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["admin-membership-overview"] }),
        qc.invalidateQueries({ queryKey: ["clients-directory"] }),
        qc.invalidateQueries({ queryKey: MEMBERS_KEY }),
        qc.invalidateQueries({ queryKey: ["plan-change-review"] }),
        qc.invalidateQueries({ queryKey: ["competition-handling-list"] }),
        qc.invalidateQueries({ queryKey: ["goals-service-scope"] }),
      ]);
      onDone?.(to);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't change the plan");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" swipeToClose className="max-h-[88dvh] overflow-y-auto rounded-t-[24px] sm:mx-auto sm:max-w-[520px]">
        <SheetHeader className="text-left">
          <SheetTitle>Change plan</SheetTitle>
          <SheetDescription>{r ? r.name : "Reading their account…"}</SheetDescription>
        </SheetHeader>
        {q.isLoading || !r || !to ? (
          q.error ? (
            <p className="py-6 text-[13px] text-destructive">{String((q.error as any)?.message ?? q.error)}</p>
          ) : (
            <div className="grid place-items-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          )
        ) : (
          <div className="space-y-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-3">
            <div className="flex items-center gap-2 text-[15px] font-semibold">
              <span className="rounded-lg bg-muted px-2.5 py-1">{TIER_LABEL[r.tier]}</span>
              <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden />
              <span className="rounded-lg bg-foreground px-2.5 py-1 text-background">{TIER_LABEL[to]}</span>
            </div>
            {r.problems.length > 0 ? (
              <div className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 text-[13px]">
                {r.problems.map((p) => (
                  <p key={p}>{p}</p>
                ))}
                {r.liveCharges.length > 0 && (
                  <Button asChild size="sm" variant="outline" className="h-9">
                    <Link to="/admin/clients/$id" params={{ id: r.clientId }} search={{ tab: "billing" } as any}>Open their Billing</Link>
                  </Button>
                )}
              </div>
            ) : (
              <ul className="space-y-1.5 text-[13px] text-muted-foreground">
                {planChangeLines(r, to).map((l) => (
                  <li key={l} className="flex gap-2">
                    <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/60" aria-hidden />
                    {l}
                  </li>
                ))}
              </ul>
            )}
            {to === "coaching" && r.problems.length === 0 && (
              <label className="block text-[13px]">
                <span className="font-medium">Their coach</span>
                <select
                  className="mt-1 h-10 w-full rounded-lg border bg-background px-3 text-[14px]"
                  value={chosenCoach}
                  onChange={(e) => setCoachId(e.target.value)}
                >
                  <option value="">Pick a coach</option>
                  {r.coaches.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </label>
            )}
            <div className="flex gap-2">
              <Button variant="outline" className="h-11 flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button className="h-11 flex-1" onClick={run} disabled={busy || r.problems.length > 0}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : to === "coaching" ? "Move to coaching" : "Move to free membership"}
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
