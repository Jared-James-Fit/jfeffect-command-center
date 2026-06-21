/**
 * QuickSellSheet — dummy-proof quick sell/payment link sender from the client card.
 *
 * Opens a bottom sheet showing all active coaching products.
 * Admin can:
 * 1. Pick a product
 * 2. Copy the payment link to clipboard
 * 3. Open the checkout link in a new tab
 * 4. Send the link to the client via the app's messaging system
 *
 * This is intentionally simple — no new Stripe calls, no new products.
 * It just surfaces the existing payment links from coaching_products.
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Copy, ExternalLink, Search, CheckCircle2, Loader2, CreditCard,
  ShoppingCart, ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import { listCoachingProducts } from "@/lib/coaching-products.functions";
import { createCheckoutSessionForAssignment } from "@/lib/stripe-checkout.functions";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  clientName: string | null;
}

function formatPrice(cents: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency: currency.toUpperCase(),
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `${currency.toUpperCase()} ${(cents / 100).toFixed(2)}`;
  }
}

export function QuickSellSheet({ open, onOpenChange, clientId, clientName }: Props) {
  const listFn = useServerFn(listCoachingProducts);
  const checkoutFn = useServerFn(createCheckoutSessionForAssignment);
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sendingCheckout, setSendingCheckout] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["coaching-products"],
    queryFn: () => listFn(),
    staleTime: 5 * 60_000,
  });

  const products = ((data?.items ?? []) as any[])
    .filter((p) => p.status === "Active" && p.active && p.payment_link_url)
    .filter((p) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        (p.description ?? "").toLowerCase().includes(q) ||
        (p.product_type ?? "").toLowerCase().includes(q)
      );
    });

  // Group by product type
  const grouped = products.reduce((acc: Record<string, any[]>, p) => {
    const key = p.product_type ?? "Other";
    if (!acc[key]) acc[key] = [];
    acc[key].push(p);
    return acc;
  }, {});

  const copyLink = async (url: string, productId: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(productId);
      toast.success("Payment link copied — paste into text, DM, or email.");
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      toast.error("Could not copy. Long-press the link to copy manually.");
    }
  };

  const sendCheckout = async (product: any) => {
    setSendingCheckout(product.id);
    try {
      // Create a purchase record and generate a client-specific checkout session
      // First, create a purchase record for this client
      const { data: purchase, error: pErr } = await supabase
        .from("purchase_records")
        .insert({
          client_id: clientId,
          offer_id: product.id,
          offer_name: product.name,
          payment_structure: product.payment_structure ?? null,
          full_payable_amount: product.price_cents / 100,
          currency: product.currency?.toUpperCase() ?? "CAD",
          stripe_price_id: product.stripe_price_id ?? null,
          stripe_product_id: product.stripe_product_id ?? null,
          payment_status: "Pending",
          service_status: "Pending",
          last_payment_update_source: "admin_quick_sell",
          last_payment_update_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (pErr) throw new Error(pErr.message);

      const origin = typeof window !== "undefined" ? window.location.origin : "https://jfeffect.com";
      const res = await checkoutFn({ data: { purchaseRecordId: purchase.id, origin } });

      qc.invalidateQueries({ queryKey: ["coaching-products"] });
      qc.invalidateQueries({ queryKey: ["client-purchases", clientId] });

      // Copy the checkout URL
      try { await navigator.clipboard.writeText(res.url); } catch {}

      toast.success(
        `Checkout link created for ${clientName ?? "client"} — copied to clipboard`,
        {
          description: "Send this link to the client to complete payment.",
          action: {
            label: "Open",
            onClick: () => window.open(res.url, "_blank", "noopener,noreferrer"),
          },
        }
      );
    } catch (e: any) {
      toast.error(e?.message ?? "Could not create checkout link");
    } finally {
      setSendingCheckout(null);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-lg overflow-y-auto">
        <SheetHeader className="pb-4">
          <SheetTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-primary" />
            Quick Sell
          </SheetTitle>
          <SheetDescription>
            Send a payment link to{" "}
            <span className="font-semibold text-foreground">{clientName ?? "client"}</span>.
            Pick a product below.
          </SheetDescription>
        </SheetHeader>

        {/* Search */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search products…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading products…
          </div>
        ) : products.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            {search ? "No products match your search." : "No active products with payment links found. Add products in Admin → Sales → Products & Payments."}
          </div>
        ) : (
          <div className="space-y-5">
            {Object.entries(grouped).map(([type, items]) => (
              <div key={type} className="space-y-2">
                <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  {type}
                </div>
                <div className="space-y-2">
                  {(items as any[]).map((p) => {
                    const isSelected = selectedId === p.id;
                    const isSending = sendingCheckout === p.id;
                    const isCopied = copiedId === p.id;

                    return (
                      <Card
                        key={p.id}
                        className={[
                          "cursor-pointer p-3 transition-all",
                          isSelected ? "border-primary bg-primary/5" : "hover:border-primary/30",
                        ].join(" ")}
                        onClick={() => setSelectedId(isSelected ? null : p.id)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-semibold">{p.name}</span>
                              {isSelected && <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />}
                            </div>
                            <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                              <span className="font-bold text-foreground">
                                {formatPrice(p.price_cents, p.currency ?? "cad")}
                              </span>
                              {p.payment_structure && (
                                <span>· {p.payment_structure}</span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Actions when selected */}
                        {isSelected && (
                          <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
                            {/* Option 1: Copy the generic payment link */}
                            <Button
                              size="sm"
                              variant="outline"
                              className="w-full justify-start"
                              onClick={(e) => {
                                e.stopPropagation();
                                copyLink(p.payment_link_url, p.id);
                              }}
                            >
                              {isCopied ? (
                                <CheckCircle2 className="mr-2 h-4 w-4 text-emerald-500" />
                              ) : (
                                <Copy className="mr-2 h-4 w-4" />
                              )}
                              {isCopied ? "Copied!" : "Copy Payment Link"}
                            </Button>

                            {/* Option 2: Open the generic payment link */}
                            <Button
                              size="sm"
                              variant="outline"
                              className="w-full justify-start"
                              onClick={(e) => {
                                e.stopPropagation();
                                window.open(p.payment_link_url, "_blank", "noopener,noreferrer");
                              }}
                            >
                              <ExternalLink className="mr-2 h-4 w-4" />
                              Open Checkout Page
                            </Button>

                            {/* Option 3: Create a client-specific checkout (if has Stripe price) */}
                            {p.stripe_price_id && (
                              <Button
                                size="sm"
                                className="w-full justify-start"
                                disabled={isSending}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  sendCheckout(p);
                                }}
                              >
                                {isSending ? (
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                  <CreditCard className="mr-2 h-4 w-4" />
                                )}
                                {isSending ? "Creating…" : `Create Link for ${clientName?.split(" ")[0] ?? "Client"}`}
                              </Button>
                            )}

                            <p className="text-[11px] text-muted-foreground">
                              <strong>Copy Payment Link</strong> — generic link anyone can use.<br />
                              <strong>Create Link for {clientName?.split(" ")[0] ?? "Client"}</strong> — client-specific link tied to their account.
                            </p>
                          </div>
                        )}
                      </Card>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="mt-6 border-t border-border pt-4">
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              onOpenChange(false);
              window.location.href = "/admin/sales?tab=products-payments";
            }}
          >
            <ArrowRight className="mr-2 h-4 w-4" />
            Manage All Products
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
