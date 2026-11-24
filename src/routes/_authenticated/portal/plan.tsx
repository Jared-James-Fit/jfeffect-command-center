import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PlanManager, type PlanApi } from "@/components/plans/plan-manager";
import { UpdateCardButton } from "@/components/billing/my-purchases-view";
import { usePovArgs } from "@/lib/client-pov-args";
import { isNative } from "@/platform";
import { lazyWithRetry } from "@/lib/lazy-chunk";
import {
  acceptMyOffer,
  applyForCoaching,
  declineMyOffer,
  confirmMyPlanChange,
  getMyPlan,
  getMyPlanChange,
  keepMyPlan,
  previewMyPlanChange,
  undoMyPlanChange,
} from "@/lib/plans/plans.functions";

export const Route = createFileRoute("/_authenticated/portal/plan")({
  component: PlanPage,
  validateSearch: (s: Record<string, unknown>): { checkout?: string; change?: string } => ({
    checkout: typeof s.checkout === "string" ? s.checkout : undefined,
    change: typeof s.change === "string" ? s.change : undefined,
  }),
});

const myPlanKey = (who: string | null) => ["my-plan", who] as const;

const AgreementSignFlow = lazyWithRetry(() =>
  import("@/components/coaching-agreement/agreement-sign-flow").then((m) => ({ default: m.AgreementSignFlow })),
);

/**
 * Your plan: Free, a membership or a coaching package, on one account. What
 * you're on, what else there is, and what a change would mean (today, going
 * forward, when) before you make it. Changes that charge happen on the web
 * (App Store / Play rules); a downgrade, a move to free, an undo or a request
 * works anywhere.
 */
function PlanPage() {
  const search = useSearch({ from: "/_authenticated/portal/plan" });
  const navigate = useNavigate();
  const qc = useQueryClient();
  const pov = usePovArgs();
  const native = isNative();
  const who = pov.viewAsClientId ?? "me";

  const getFn = useServerFn(getMyPlan);
  const previewFn = useServerFn(previewMyPlanChange);
  const confirmFn = useServerFn(confirmMyPlanChange);
  const undoFn = useServerFn(undoMyPlanChange);
  const keepFn = useServerFn(keepMyPlan);
  const changeFn = useServerFn(getMyPlanChange);
  const applyFn = useServerFn(applyForCoaching);
  const acceptFn = useServerFn(acceptMyOffer);
  const declineFn = useServerFn(declineMyOffer);

  const q = useQuery({
    queryKey: myPlanKey(who),
    queryFn: () => getFn({ data: { ...pov, native } }),
    staleTime: 30_000,
  });

  // Back from Stripe: the webhook applies the plan in a few seconds. Look until it has (or 40s).
  const [finishing, setFinishing] = useState<string | null>(null);
  useEffect(() => {
    if (search.checkout === "cancelled") {
      toast.info("Checkout closed. Nothing was charged.");
      void navigate({ to: "/portal/plan", search: {}, replace: true });
      return;
    }
    if (search.checkout !== "done" || !search.change) return;
    const changeId = search.change;
    setFinishing(changeId);
    let stop = false;
    const started = Date.now();
    const look = async () => {
      if (stop) return;
      try {
        const row = await changeFn({ data: { changeId } });
        if (row?.status === "applied") {
          toast.success(`You're on ${row.toLabel ?? "your new plan"}`, { description: "Everything you logged comes with you." });
          setFinishing(null);
          void qc.invalidateQueries({ queryKey: myPlanKey(who) });
          void qc.invalidateQueries({ queryKey: ["service-tier"] });
          void navigate({ to: "/portal/plan", search: {}, replace: true });
          return;
        }
        if (row?.status === "failed" || Date.now() - started > 40_000) {
          setFinishing(null);
          void qc.invalidateQueries({ queryKey: myPlanKey(who) });
          if (row?.status === "failed") toast.error(row.error ?? "Your plan didn't change.");
          else toast.info("Payment received. Your plan updates here in a minute.");
          void navigate({ to: "/portal/plan", search: {}, replace: true });
          return;
        }
      } catch {
        /* keep looking */
      }
      setTimeout(look, 2500);
    };
    void look();
    return () => {
      stop = true;
    };
  }, [search.checkout, search.change, changeFn, navigate, qc, who]);

  const api: PlanApi = useMemo(
    () => ({
      preview: (toSlug) => previewFn({ data: { ...pov, toSlug, native } }),
      confirm: (toSlug, extra) =>
        confirmFn({
          data: {
            ...pov,
            toSlug,
            native,
            origin: window.location.origin,
            prorationDate: extra.prorationDate ?? null,
            note: extra.note ?? null,
            acknowledgeForfeit: !!extra.acknowledgeForfeit,
          },
        }),
      undo: (changeId) => undoFn({ data: { ...pov, changeId } }),
      keep: () => keepFn({ data: { ...pov } }),
      updateCard: <UpdateCardButton returnPath="/portal/plan" />,
      billingDetails: <UpdateCardButton label="Open" variant="outline" returnPath="/portal/plan" />,
      apply: (input) => applyFn({ data: { ...pov, ...input } }),
      acceptOffer: (changeId, consentText) => acceptFn({ data: { ...pov, changeId, consentText, origin: window.location.origin } }),
      declineOffer: (changeId) => declineFn({ data: { ...pov, changeId } }),
      agreementFlow: ({ open, onOpenChange, onSigned }) =>
        open ? (
          <Suspense fallback={null}>
            <AgreementSignFlow
              open={open}
              onOpenChange={onOpenChange}
              onSigned={() => {
                void qc.invalidateQueries({ queryKey: myPlanKey(who) });
                onSigned();
              }}
            />
          </Suspense>
        ) : null,
    }),
    [previewFn, confirmFn, undoFn, keepFn, applyFn, acceptFn, declineFn, pov, native, qc, who],
  );

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: myPlanKey(who) });
    void qc.invalidateQueries({ queryKey: ["service-tier"] });
  };

  return (
    <>
      <PageHeader title="Your plan" backTo="/portal/account" />
      <div className="mx-auto w-full max-w-2xl space-y-4 px-4 pb-[max(6rem,env(safe-area-inset-bottom))] pt-4 md:px-6">
        {finishing && (
          <Card className="flex items-center gap-3 p-4" data-plan-finishing>
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="text-[14px]">Payment received. Setting up your plan…</span>
          </Card>
        )}
        {q.isLoading ? (
          <div className="space-y-3" aria-busy="true">
            <div className="h-40 animate-pulse rounded-2xl bg-muted" />
            <div className="h-32 animate-pulse rounded-2xl bg-muted" />
            <div className="h-32 animate-pulse rounded-2xl bg-muted" />
          </div>
        ) : q.isError ? (
          <Card className="space-y-2 p-5 text-center">
            <p className="text-[14px] text-muted-foreground">Your plan couldn't be loaded.</p>
            <Button size="sm" variant="outline" className="h-10" disabled={q.isFetching} onClick={() => q.refetch()}>
              Try again
            </Button>
          </Card>
        ) : !q.data ? (
          <Card className="p-5 text-[14px] text-muted-foreground">Your account isn't set up yet.</Card>
        ) : (
          <>
            <PlanManager view={q.data} api={api} who="client" onChanged={refresh} />
            {native && (
              <p className="px-1 text-center text-[13px] text-muted-foreground" data-plan-native-note>
                Upgrades are made on the web at jfeffect.com. Switching down, moving to the free app or keeping your plan works here.
              </p>
            )}
          </>
        )}
      </div>
    </>
  );
}
