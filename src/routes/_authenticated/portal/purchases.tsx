import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { usePortalUserId } from "@/lib/client-impersonation";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronRight, ShoppingCart, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createCheckoutSession } from "@/lib/stripe-checkout.functions";

export const Route = createFileRoute("/_authenticated/portal/purchases")({
  component: MyPurchases,
  validateSearch: (s: Record<string, unknown>) => ({
    checkout: s.checkout as string | undefined,
  }),
});

function MyPurchases() {
  const portalUserId = usePortalUserId();
  const search = useSearch({ from: "/_authenticated/portal/purchases" });
  const checkoutFn = useServerFn(createCheckoutSession);
  const [checkingOut, setCheckingOut] = useState<string | null>(null);

  // Show success toast when returning from Stripe Checkout
  useEffect(() => {
    if (search.checkout === "success") {
      toast.success("Payment successful! Your access has been updated.", { duration: 6000 });
    }
  }, [search.checkout]);

  const { data: client } = useQuery({
    queryKey: ["my-client", portalUserId],
    enabled: !!portalUserId,
    queryFn: async () =>
      (await supabase.from("clients").select("id").eq("user_id", portalUserId!).maybeSingle()).data,
  });

  const { data: records = [] } = useQuery({
    queryKey: ["my-purchases", client?.id],
    enabled: !!client?.id,
    queryFn: async () =>
      (
        await supabase
          .from("purchase_records")
          .select("*")
          .eq("client_id", client!.id)
          .order("purchased_at", { ascending: false })
      ).data ?? [],
  });

  // Load active coaching products that have a Stripe Price ID (checkout-ready)
  const { data: availableProducts = [] } = useQuery({
    queryKey: ["available-coaching-products"],
    queryFn: async () => {
      const { data } = await supabase
        .from("coaching_products")
        .select("id, name, description, price_cents, currency, payment_structure, stripe_price_id, mode, included_features")
        .eq("active", true)
        .eq("status", "Active")
        .not("stripe_price_id", "is", null)
        .order("created_at", { ascending: false });
      return (data ?? []) as any[];
    },
  });

  const handleCheckout = async (productId: string) => {
    setCheckingOut(productId);
    try {
      const { url } = await checkoutFn({
        data: { productId, origin: window.location.origin },
      });
      toast.info("Redirecting to secure checkout…");
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not start checkout");
    } finally {
      setCheckingOut(null);
    }
  };

  const formatPrice = (cents: number, currency: string) => {
    try {
      return new Intl.NumberFormat("en-CA", {
        style: "currency",
        currency: currency.toUpperCase(),
      }).format(cents / 100);
    } catch {
      return `${currency.toUpperCase()} ${(cents / 100).toFixed(2)}`;
    }
  };

  return (
    <>
      <PageHeader
        title="My Purchases"
        subtitle="Your coaching purchases and available plans."
      />
      <div className="p-6 md:p-8 space-y-8">

        {/* ── Available Plans ─────────────────────────────────────────────── */}
        {availableProducts.length > 0 && (
          <section>
            <h2 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Available Plans</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {availableProducts.map((p: any) => (
                <Card key={p.id} className="border-border bg-card p-5 space-y-3">
                  <div>
                    <div className="font-bold">{p.name}</div>
                    {p.description && (
                      <div className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{p.description}</div>
                    )}
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-black">{formatPrice(p.price_cents, p.currency)}</span>
                    {p.payment_structure && (
                      <span className="text-xs text-muted-foreground">{p.payment_structure}</span>
                    )}
                  </div>
                  {p.included_features && p.included_features.length > 0 && (
                    <ul className="space-y-1">
                      {(p.included_features as string[]).slice(0, 4).map((f, i) => (
                        <li key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                          <CheckCircle2 className="h-3 w-3 text-primary flex-shrink-0" />
                          {f}
                        </li>
                      ))}
                    </ul>
                  )}
                  <Button
                    size="sm"
                    className="w-full bg-gradient-primary uppercase font-bold text-xs"
                    onClick={() => handleCheckout(p.id)}
                    disabled={checkingOut === p.id}
                  >
                    {checkingOut === p.id ? (
                      <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Redirecting…</>
                    ) : (
                      <><ShoppingCart className="h-3.5 w-3.5 mr-1.5" />Buy Now</>
                    )}
                  </Button>
                </Card>
              ))}
            </div>
          </section>
        )}

        {/* ── Purchase History ─────────────────────────────────────────────── */}
        <section>
          <h2 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Purchase History</h2>
          {records.length === 0 ? (
            <Card className="border-border bg-card p-10 text-center text-sm text-muted-foreground">
              No purchases yet.
            </Card>
          ) : (
            <div className="space-y-3">
              {records.map((r: any) => (
                <Link key={r.id} to="/portal/purchases/$id" params={{ id: r.id }}>
                  <Card className="border-border bg-card p-4 hover:bg-secondary/30 transition flex items-center justify-between">
                    <div>
                      <div className="font-bold">{r.offer_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.offer_type} · {new Date(r.purchased_at).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {!r.terms_accepted && <Badge className="bg-gradient-primary">Action needed</Badge>}
                      <Badge variant="outline">{r.payment_status}</Badge>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
