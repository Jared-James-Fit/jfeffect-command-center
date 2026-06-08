import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listMemberOffers, createMemberCheckoutSession } from "@/lib/member-checkout.functions";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useState } from "react";
import { Check, ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/_authenticated/m/upgrade")({ component: UpgradePage });

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
      {offers.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">No upgrade options available right now. Check back soon.</Card>
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
                <Button className="w-full" disabled={busy === o.id} onClick={() => buy(o.id)}>
                  {busy === o.id ? "Redirecting…" : "Get access"}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}