import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listMemberOffers, createMemberCheckoutSession } from "@/lib/member-checkout.functions";
import { getMyJfBilling, openBillingPortal, restartMembership } from "@/lib/jf-billing.functions";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useState } from "react";
import { Check, ArrowLeft, Info, CreditCard, RefreshCw, Mail } from "lucide-react";
import { isNative } from "@/platform";
import { useMutation, useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/_authenticated/m/upgrade")({ component: UpgradePage });

function NoOffersSection({ native }: { native: boolean }) {
  const qc = useQueryClient();
  const billingFn = useServerFn(getMyJfBilling);
  const portalFn = useServerFn(openBillingPortal);
  const restartFn = useServerFn(restartMembership);

  const { data: billingData } = useQuery({ queryKey: ["my-jf-billing"], queryFn: () => billingFn() });
  const lc = (billingData as any)?.lifecycle;
  const isCancelled = lc?.subscription_ended || lc?.status === "Cancelled" || lc?.status === "Expired";
  const showRestart = lc?.action === "restart_membership" || isCancelled;

  const portal = useMutation({
    mutationFn: () => portalFn({ data: { return_url: window.location.href } }),
    onSuccess: (r: any) => window.location.assign(r.url),
    onError: (e: any) => toast.error(e?.message ?? "Could not open billing portal"),
  });
  const restart = useMutation({
    mutationFn: () => restartFn({ data: { origin: window.location.origin } }),
    onSuccess: (r: any) => { if (r?.url) window.location.assign(r.url); else { toast.success("Membership restarted"); qc.invalidateQueries({ queryKey: ["my-jf-billing"] }); } },
    onError: (e: any) => toast.error(e?.message ?? "Could not restart membership"),
  });

  return (
    <div className="space-y-4">
      <Card className="p-6 space-y-4">
        <div className="flex items-start gap-3">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div>
            <div className="font-semibold text-sm">No active plans are available right now</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Your coach will set up available plans shortly. In the meantime, use the options below to manage your membership.
            </div>
          </div>
        </div>

        {!native && (
          <div className="flex flex-col gap-2 pt-2 border-t border-border">
            {showRestart && (
              <Button className="w-full" onClick={() => restart.mutate()} disabled={restart.isPending}>
                <RefreshCw className="mr-2 h-4 w-4" />
                {restart.isPending ? "Processing…" : "Reactivate Membership"}
              </Button>
            )}
            <Button variant="outline" className="w-full" onClick={() => portal.mutate()} disabled={portal.isPending}>
              <CreditCard className="mr-2 h-4 w-4" />
              {portal.isPending ? "Opening…" : "Update Payment Method"}
            </Button>
            <Button variant="outline" className="w-full" asChild>
              <a href="mailto:jared@jfeffect.com">
                <Mail className="mr-2 h-4 w-4" /> Contact Coach / Support
              </a>
            </Button>
          </div>
        )}
        {native && (
          <div className="pt-2 border-t border-border text-sm text-muted-foreground">
            To manage your membership, visit <span className="font-semibold">jfeffect.com</span> in your browser.
          </div>
        )}
      </Card>
    </div>
  );
}

function formatPrice(cents: number, currency: string) {
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100); }
  catch { return `${currency.toUpperCase()} ${(cents/100).toFixed(2)}`; }
}

function UpgradePage() {
  const fetchOffers = useServerFn(listMemberOffers);
  const checkout = useServerFn(createMemberCheckoutSession);
  const { data } = useQuery({ queryKey: ["m-upgrade-offers"], queryFn: () => fetchOffers() });
  const offers: any[] = data?.offers ?? [];
  const [busy, setBusy] = useState<string | null>(null);
  const native = isNative();

  const buy = async (productId: string) => {
    if (busy) return;
    setBusy(productId);
    try {
      const { url } = await checkout({ data: { productId, origin: window.location.origin } });
      window.location.href = url;
    } catch (e: any) { toast.error(e?.message ?? "Checkout failed"); setBusy(null); }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Upgrade your membership"
        subtitle="Pick the plan that fits — unlocks new content and tools immediately."
        actions={<Link to="/m"><Button variant="outline" size="sm"><ArrowLeft className="mr-1 h-3.5 w-3.5" />Back</Button></Link>}
      />
      {native && (
        <Card className="flex items-start gap-3 border-amber-500/30 bg-amber-500/10 p-4 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <div>
            <div className="font-semibold">Manage your membership on the web</div>
            <div className="text-muted-foreground">
              Purchases and plan changes are handled at jfeffect.com. Sign in there to upgrade — your access updates automatically in the app.
            </div>
          </div>
        </Card>
      )}
      {offers.length === 0 ? (
        <NoOffersSection native={native} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {offers.map((o) => (
            <Card key={o.id} className="flex flex-col p-6">
              {o.member_tier_label && <Badge className="mb-2 w-fit">{o.member_tier_label}</Badge>}
              <div className="text-lg font-bold">{o.name}</div>
              <div className="mt-1 text-2xl font-extrabold">{formatPrice(o.price_cents, o.currency)}</div>
              {o.payment_structure && <div className="text-xs text-muted-foreground">{o.payment_structure}</div>}
              {o.description && <p className="mt-3 text-sm text-muted-foreground">{o.description}</p>}
              {Array.isArray(o.included_features) && o.included_features.length > 0 && (
                <ul className="mt-4 space-y-1.5 text-sm">
                  {o.included_features.slice(0, 8).map((f: string) => (
                    <li key={f} className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><span>{f}</span></li>
                  ))}
                </ul>
              )}
              <div className="mt-auto pt-5">
                <Button className="w-full" disabled={native || busy === o.id} onClick={() => buy(o.id)}>
                  {native ? "Available on web" : busy === o.id ? "Redirecting…" : "Get access"}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}