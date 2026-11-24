/**
 * A client's plan, on the coach's side (client → Billing): what they're on,
 * anything scheduled, their plan history, and packages that can't be sold
 * yet. The admin can change it for them (the same preview and rules as the
 * client, plus "switch now, no charge" for a goodwill upgrade), undo a
 * scheduled change, and end coaching after a subscription ended in Stripe.
 * A coach reads it; money stays the admin's.
 */
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, Layers, Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PlanManager, type PlanApi } from "@/components/plans/plan-manager";
import {
  adminChangeClientPlan,
  adminEndCoaching,
  adminGetClientPlan,
  adminPreviewClientPlanChange,
  adminUndoClientPlanChange,
} from "@/lib/plans/plans.functions";
import { cn } from "@/lib/utils";

export function ClientPlanCard({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const getFn = useServerFn(adminGetClientPlan);
  const previewFn = useServerFn(adminPreviewClientPlanChange);
  const changeFn = useServerFn(adminChangeClientPlan);
  const undoFn = useServerFn(adminUndoClientPlanChange);
  const endFn = useServerFn(adminEndCoaching);
  const [open, setOpen] = useState(false);
  const [ending, setEnding] = useState(false);
  const key = ["client-plan", clientId] as const;
  const q = useQuery({ queryKey: key, queryFn: () => getFn({ data: { clientId } }), staleTime: 30_000 });

  const api: PlanApi = useMemo(
    () => ({
      preview: (toSlug) => previewFn({ data: { clientId, toSlug } }),
      confirm: (toSlug, extra) =>
        changeFn({ data: { clientId, toSlug, noCharge: !!extra.noCharge, prorationDate: extra.prorationDate ?? null, note: extra.note ?? null, origin: window.location.origin } }),
      undo: (changeId) => undoFn({ data: { clientId, changeId } }),
      keep: async () => {
        throw new Error("Only the client keeps a plan that's ending, or undo the scheduled change.");
      },
    }),
    [clientId, previewFn, changeFn, undoFn],
  );

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ["client-billing", clientId] });
    void qc.invalidateQueries({ queryKey: ["client-purchases", clientId] });
  };

  const v = q.data;
  const summary = v
    ? v.open
      ? v.open.status === "scheduled"
        ? `${v.current.name} → ${v.open.toLabel ?? "Free"}`
        : `${v.current.name} · change in progress`
      : v.current.name
    : null;

  const endCoaching = async () => {
    if (ending) return;
    setEnding(true);
    try {
      await endFn({ data: { clientId } });
      toast.success("Moved to the free app", { description: "Everything they logged stays. Coaching screens and check-ins stop." });
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't end coaching");
    } finally {
      setEnding(false);
    }
  };

  return (
    <Card className="p-0" data-client-plan-card>
      <button type="button" className="flex min-h-14 w-full items-center gap-3 px-4 text-left" onClick={() => setOpen((x) => !x)} aria-expanded={open}>
        <Layers className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold">Plan</span>
          <span className="block truncate text-[13px] text-muted-foreground">
            {q.isLoading ? "Loading…" : q.isError ? "Couldn't load" : summary}
          </span>
        </span>
        {v?.configIssues.length ? <TriangleAlert className="h-4 w-4 shrink-0 text-warning" aria-label="A package needs setting up" /> : null}
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-4 border-t border-border p-3 md:p-4">
          {q.isError && (
            <div className="space-y-2 text-center">
              <p className="text-[14px] text-muted-foreground">Their plan couldn't be loaded.</p>
              <Button size="sm" variant="outline" className="h-10" onClick={() => q.refetch()}>Try again</Button>
            </div>
          )}
          {v && v.configIssues.length > 0 && (
            <div className="space-y-1 rounded-xl border border-warning/40 p-3" data-plan-config-issues>
              <p className="text-[14px] font-medium">Not for sale until it's set up</p>
              {v.configIssues.map((c) => (
                <p key={c.slug} className="text-[13px] text-muted-foreground">
                  {c.name}: {c.problem}. Fix it in Sales → Coaching packages.
                </p>
              ))}
            </div>
          )}
          {v?.endedInStripe && (
            <div className="space-y-2 rounded-xl border border-warning/40 p-3" data-plan-ended-in-stripe>
              <p className="text-[14px]">Their subscription ended in Stripe. They still have coaching access until you decide.</p>
              {v.canChange && (
                <Button size="sm" variant="outline" className="h-10" disabled={ending} onClick={endCoaching}>
                  {ending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}End coaching (move to the free app)
                </Button>
              )}
            </div>
          )}
          {v && <PlanManager view={v} api={api} who="admin" onChanged={refresh} />}
          {v && !v.canChange && <p className="text-center text-[13px] text-muted-foreground">Only the admin changes a client's plan.</p>}
        </div>
      )}
    </Card>
  );
}
