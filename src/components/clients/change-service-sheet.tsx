import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ChangePlanSheet } from "@/components/admin/intel/change-plan-sheet";
import { HandlingInviteSheet } from "@/components/competition/prep/handling-sheets";
import { getPlanChangeReviewFn } from "@/lib/admin-intel/membership.functions";
import { listCoachingPackages, listEnrollments, switchClientServicePackageFn } from "@/lib/coaching-packages/packages.functions";

/** One entry point for changing a client's assigned service without creating another account.
 * Package changes move the client between coaching/nutrition panels automatically.
 * A meet is a separate engagement and is managed on the existing Competition workspace. */
export function ChangeServiceSheet({ clientId, clientName, open, onOpenChange }: {
  clientId: string; clientName: string | null; open: boolean; onOpenChange: (value: boolean) => void;
}) {
  const qc = useQueryClient();
  const getReview = useServerFn(getPlanChangeReviewFn);
  const listPackages = useServerFn(listCoachingPackages);
  const listClientEnrollments = useServerFn(listEnrollments);
  const switchPackage = useServerFn(switchClientServicePackageFn);
  const review = useQuery({ queryKey: ["plan-change-review", clientId], enabled: open,
    queryFn: () => getReview({ data: { clientId } }), staleTime: 0 });
  const enrollments = useQuery({ queryKey: ["coaching-package-enrollments", null, clientId], enabled: open,
    queryFn: () => listClientEnrollments({ data: { clientId } }), staleTime: 0 });
  const packages = useQuery({ queryKey: ["coaching-packages-admin"], enabled: open, queryFn: () => listPackages() });
  const current = enrollments.data?.find(e => e.status === "active");
  const choices = (packages.data?.packages ?? []).filter(p => p.status === "active" && p.kind === "subscription");
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [tierOpen, setTierOpen] = useState(false);
  const [handlingOpen, setHandlingOpen] = useState(false);
  const target = choices.find(p => p.id === selected);
  const canSwitch = review.data?.tier === "coaching" && !review.data.inactive && !!target && target.id !== current?.package_id;
  const change = async () => {
    if (!canSwitch || busy || !enrollments.isSuccess) return;
    setBusy(true);
    try {
      await switchPackage({ data: { clientId, packageId: selected, expectedEnrollmentId: current?.id ?? null } });
      await Promise.all([["clients-directory"], ["coaching-package-enrollments"], ["coaching-packages-admin"], ["goals-service-scope"], ["plan-change-review"], ["competition-handling-list"]].map(queryKey => qc.invalidateQueries({ queryKey })));
      toast.success("Service changed. No payment was charged.");
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't change the service.");
      void enrollments.refetch();
    } finally { setBusy(false); }
  };
  if (tierOpen) return <ChangePlanSheet clientId={clientId} open={tierOpen} onOpenChange={setTierOpen}
    onDone={() => { setTierOpen(false); setSelected(""); }} />;
  if (handlingOpen) return <HandlingInviteSheet open={handlingOpen} onClose={() => setHandlingOpen(false)}
    defaults={{ clientId, first: clientName ?? undefined }}
    onCreated={() => {
      void qc.invalidateQueries({ queryKey: ["competition-handling-list"] });
      void qc.invalidateQueries({ queryKey: ["clients-directory"] });
    }} />;
  const error = review.error || enrollments.error || packages.error;
  return <Sheet open={open} onOpenChange={value => { if (!busy) onOpenChange(value); }}>
    <SheetContent side="bottom" swipeToClose className="max-h-[88dvh] overflow-y-auto rounded-t-[24px] sm:mx-auto sm:max-w-[520px]">
      <SheetHeader className="text-left"><SheetTitle>Change service</SheetTitle>
        <SheetDescription>{clientName ?? "Client"} · Same profile and history</SheetDescription>
      </SheetHeader>
      {error ? <p className="py-5 text-sm text-destructive">Couldn't load services. <button type="button" className="underline" onClick={() => { void review.refetch(); void enrollments.refetch(); void packages.refetch(); }}>Retry</button></p>
      : !review.data || !enrollments.isSuccess || !packages.isSuccess ? <div className="grid place-items-center py-10"><Loader2 className="h-5 w-5 animate-spin" /></div>
      : <div className="space-y-4 pt-4 pb-[max(env(safe-area-inset-bottom),1rem)]" data-change-service>
        <div className="rounded-xl border p-3">
          <div className="text-xs text-muted-foreground">Current coaching service</div>
          <div className="mt-1 text-sm font-semibold">{review.data.tier === "coaching" ? current?.package_name ?? "Coaching · no package assigned" : "Self-serve account"}</div>
        </div>
        {review.data.tier === "coaching" && <div className="space-y-2">
          <label htmlFor="next-service" className="text-sm font-medium">Move to</label>
          <select id="next-service" className="w-full h-11 rounded-lg border bg-background px-3 text-sm" value={selected} onChange={e => setSelected(e.target.value)} disabled={busy}>
            <option value="">Choose a coaching service</option>
            {choices.map(p => <option key={p.id} value={p.id} disabled={p.id === current?.package_id}>{p.name}</option>)}
          </select>
          {target && <p className="text-xs text-muted-foreground">{target.slug === "nutrition" ? "Moves into Nutrition coaching." : "Moves into the regular coaching list."} Previous service history stays. Existing billing does not change.</p>}
          <Button className="w-full" disabled={!canSwitch || busy} onClick={change}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><ArrowRight className="h-4 w-4" /> Change service</>}</Button>
        </div>}
        <div className="space-y-2 border-t pt-3">
          <Button variant="outline" className="w-full justify-between" onClick={() => setHandlingOpen(true)} disabled={busy || review.data.inactive}>
            Add competition handling <ArrowRight className="h-4 w-4" />
          </Button>
          <Button asChild variant="ghost" className="w-full justify-between">
            <Link to="/admin/clients/$id" params={{ id: clientId }} search={{ tab: "competition" } as any} onClick={() => onOpenChange(false)}>Manage existing handling <ArrowRight className="h-4 w-4" /></Link>
          </Button>
          <p className="text-xs text-muted-foreground">Handling follows the actual meet service. Existing meet records stay on this account.</p>
          <Button variant="outline" className="w-full justify-between" onClick={() => setTierOpen(true)} disabled={busy}>
            {review.data.tier === "coaching" ? "Move to self-serve / handling only" : "Move to coaching"} <ArrowRight className="h-4 w-4" />
          </Button>
          <p className="text-xs text-muted-foreground">Account access changes are reviewed separately. Billing and active meet services are not cancelled automatically.</p>
        </div>
      </div>}
    </SheetContent>
  </Sheet>;
}
