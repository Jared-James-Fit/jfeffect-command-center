import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AssignOfferDialog } from "@/components/assign-offer-dialog";
import { OfferDetailDialog } from "@/components/offer-detail-dialog";
import { Eye, Search, X } from "lucide-react";
import { listCoachingProducts } from "@/lib/coaching-products.functions";

type Product = {
  id: string;
  name: string;
  description: string | null;
  details: string | null;
  price_cents: number;
  currency: string;
  image_signed_url: string | null;
  payment_link_url: string | null;
  stripe_product_id: string | null;
  stripe_price_id?: string | null;
  mode?: string | null;
  status: string;
  active: boolean;
  product_type: string | null;
  payment_structure: string | null;
  term_length: number | null;
  term_unit: string | null;
  included_features: string[] | null;
  agreement_required: boolean;
  agreement_template_id: string | null;
  agreement_before_service: boolean;
};

function productToOfferLike(p: Product) {
  return {
    id: p.id,
    name: p.name,
    offer_type: p.product_type ?? "Custom Offer",
    short_description: p.description,
    description: p.details,
    currency: (p.currency ?? "USD").toUpperCase(),
    price: p.price_cents / 100,
    full_payable_amount: p.price_cents / 100,
    payment_structure: p.payment_structure,
    payment_frequency: p.payment_structure,
    term_duration: p.term_length,
    term_duration_unit: p.term_unit,
    included_features: p.included_features ?? [],
    excluded_features: [],
    stripe_payment_link: p.payment_link_url,
    stripe_price_id: p.stripe_price_id ?? null,
    stripe_product_id: p.stripe_product_id ?? null,
    mode: p.mode ?? null,
    requires_agreement: !!p.agreement_required,
    agreement_before_service: !!p.agreement_before_service,
    default_agreement_template_id: p.agreement_template_id,
    version: 1,
    status: p.status,
  };
}

function formatPrice(cents: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: (currency ?? "USD").toUpperCase() })
      .format(cents / 100);
  } catch {
    return `${(currency ?? "USD").toUpperCase()} ${(cents / 100).toFixed(2)}`;
  }
}

export function PriceCardPickerDialog({ open, onClose, fixedClientId }: { open: boolean; onClose: () => void; fixedClientId?: string }) {
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"Active" | "Draft" | "Archived" | "all">("Active");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [assigning, setAssigning] = useState<any | null>(null);
  const [viewing, setViewing] = useState<any | null>(null);

  const listFn = useServerFn(listCoachingProducts);
  const { data, isLoading } = useQuery({
    queryKey: ["coaching-products"],
    enabled: open,
    queryFn: () => listFn(),
  });
  const products: Product[] = (data as any)?.items ?? [];

  const types = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) if (p.product_type) set.add(p.product_type);
    return Array.from(set).sort();
  }, [products]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return products.filter((p) => {
      const status = p.status ?? (p.active ? "Active" : "Draft");
      if (statusFilter !== "all" && status !== statusFilter) return false;
      if (typeFilter !== "all" && (p.product_type ?? "") !== typeFilter) return false;
      if (!s) return true;
      return (
        p.name?.toLowerCase().includes(s) ||
        (p.product_type ?? "").toLowerCase().includes(s) ||
        (p.description ?? "").toLowerCase().includes(s) ||
        (p.payment_structure ?? "").toLowerCase().includes(s) ||
        (p.included_features ?? []).some((f) => f.toLowerCase().includes(s))
      );
    });
  }, [products, q, statusFilter, typeFilter]);

  const hasFilters = !!q || statusFilter !== "Active" || typeFilter !== "all";

  return (
    <>
      <Dialog open={open && !assigning && !viewing} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Sell a Product</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                placeholder="Search products by name, type, feature, structure…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="pl-9 pr-9"
              />
              {q && (
                <button
                  type="button"
                  onClick={() => setQ("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Status</span>
              {(["Active", "Draft", "Archived", "all"] as const).map((s) => (
                <Badge
                  key={s}
                  variant={statusFilter === s ? "default" : "outline"}
                  className="cursor-pointer"
                  onClick={() => setStatusFilter(s)}
                >
                  {s === "all" ? "All" : s}
                </Badge>
              ))}
            </div>

            {types.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Type</span>
                <Badge
                  variant={typeFilter === "all" ? "default" : "outline"}
                  className="cursor-pointer"
                  onClick={() => setTypeFilter("all")}
                >
                  All
                </Badge>
                {types.map((t) => (
                  <Badge
                    key={t}
                    variant={typeFilter === t ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => setTypeFilter(t)}
                  >
                    {t}
                  </Badge>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {isLoading ? "Loading…" : `${filtered.length} of ${products.length} product${products.length === 1 ? "" : "s"}`}
              </span>
              {hasFilters && (
                <button
                  type="button"
                  className="font-semibold text-primary hover:underline"
                  onClick={() => { setQ(""); setStatusFilter("Active"); setTypeFilter("all"); }}
                >
                  Reset filters
                </button>
              )}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {!isLoading && filtered.length === 0 && (
                <div className="col-span-full rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                  {products.length === 0 ? "No products yet. Create one on the Products & Payments page." : "No products match your search."}
                </div>
              )}
              {filtered.map((p) => {
                const status = p.status ?? (p.active ? "Active" : "Draft");
                const term = p.term_length && p.term_unit ? `${p.term_length} ${p.term_unit}` : p.term_unit;
                return (
                  <Card key={p.id} className="border-border bg-card p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-bold truncate">{p.name}</div>
                        <div className="text-xs text-muted-foreground truncate">{p.product_type ?? "Custom Offer"}</div>
                      </div>
                      <Badge variant={status === "Active" ? "default" : "outline"} className={status === "Active" ? "bg-gradient-primary" : ""}>{status}</Badge>
                    </div>
                    <div className="text-lg font-black">{formatPrice(p.price_cents, p.currency)}</div>
                    <div className="flex flex-wrap gap-1 text-[10px] text-muted-foreground">
                      {p.payment_structure && <span className="rounded border border-border px-1.5 py-0.5">{p.payment_structure}</span>}
                      {term && <span className="rounded border border-border px-1.5 py-0.5">{term}</span>}
                      {p.agreement_required && <span className="rounded border border-border px-1.5 py-0.5">Agreement</span>}
                    </div>
                    <div className="flex gap-2 pt-1">
                      <Button
                        size="sm"
                        className="bg-gradient-primary font-bold uppercase flex-1"
                        disabled={status === "Archived"}
                        onClick={() => setAssigning(productToOfferLike(p))}
                      >
                        Assign
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setViewing(productToOfferLike(p))}>
                        <Eye className="h-3 w-3" />
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <OfferDetailDialog offer={viewing} onClose={() => setViewing(null)} onAssign={(o) => { setViewing(null); setAssigning(o); }} />
      <AssignOfferDialog offer={assigning} fixedClientId={fixedClientId} onClose={() => { setAssigning(null); onClose(); }} />
    </>
  );
}