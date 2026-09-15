/**
 * AddSaleDialog — client profile → Sales → Add sale.
 *
 * Two entry paths, ONE pipeline:
 *   Existing Product  → coaching_products row
 *   Custom Sale       → creates a coaching_products row (one-off unless the
 *                       coach ticks "Save as reusable product")
 * Both then hand an offer-shaped object to AssignOfferDialog, which writes the
 * single canonical purchase_records row, Stripe checkout, agreement draft and
 * session entitlement snapshot.
 *
 * The client is fixed by the profile this was opened from — never re-picked.
 */

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Search, Ticket, User, Sparkles, PackageSearch } from "lucide-react";
import { toast } from "sonner";
import { listCoachingProducts, createCoachingProduct } from "@/lib/coaching-products.functions";
import {
  blankCustomSale, customSalePriceCents, customSalePaymentStructure,
  customSaleToProductInput, pickableProducts, productAssignEligibility,
  productToOfferLike, searchProducts, validateCustomSale, type CustomSaleDraft,
} from "@/lib/add-sale";
import { AssignOfferDialog } from "@/components/assign-offer-dialog";

function money(cents: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-CA", {
      style: "currency", currency: (currency || "cad").toUpperCase(), maximumFractionDigits: 2,
    }).format((cents ?? 0) / 100);
  } catch {
    return `${(currency || "cad").toUpperCase()} ${((cents ?? 0) / 100).toFixed(2)}`;
  }
}

export function AddSaleDialog({
  open, onOpenChange, clientId, clientName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientId: string;
  clientName?: string | null;
}) {
  const qc = useQueryClient();
  const listFn = useServerFn(listCoachingProducts);
  const createProductFn = useServerFn(createCoachingProduct);

  const [tab, setTab] = useState<"existing" | "custom">("existing");
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<CustomSaleDraft>(blankCustomSale());
  const [creating, setCreating] = useState(false);
  const [chosenOffer, setChosenOffer] = useState<any | null>(null);

  // Same cache key the Products page uses, so a product created/activated
  // there shows up here without a refresh.
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["coaching-products"],
    queryFn: () => listFn(),
    enabled: open,
    staleTime: 30_000,
  });

  const allProducts = useMemo(() => pickableProducts((data?.items ?? []) as any[]), [data]);
  const results = useMemo(() => {
    const ranked = searchProducts(allProducts, search);
    // Assignable first, ineligible (draft / missing pricing) shown but disabled.
    return [...ranked].sort(
      (a, b) =>
        Number(productAssignEligibility(b).assignable) - Number(productAssignEligibility(a).assignable),
    );
  }, [allProducts, search]);

  const close = () => {
    onOpenChange(false);
    setSearch("");
    setTab("existing");
    setDraft(blankCustomSale());
  };

  const pickExisting = (p: any) => {
    setChosenOffer(productToOfferLike(p));
    onOpenChange(false);
  };

  const buildCustom = async () => {
    const problem = validateCustomSale(draft);
    if (problem) return void toast.error(problem);
    setCreating(true);
    const t = toast.loading("Preparing sale…");
    try {
      const res: any = await createProductFn({
        data: { ...customSaleToProductInput(draft), idempotencyKey: crypto.randomUUID() } as any,
      });
      const product = res?.product;
      if (!product) throw new Error("Could not create the sale.");
      qc.invalidateQueries({ queryKey: ["coaching-products"] });
      const offer = {
        ...productToOfferLike(product),
        number_of_payments:
          draft.paymentType === "recurring" && draft.durationMode === "fixed"
            ? Math.max(1, Math.trunc(Number(draft.numberOfPayments) || 0))
            : null,
      };
      toast.success("Sale ready to send", { id: t });
      setChosenOffer(offer);
      onOpenChange(false);
      setDraft(blankCustomSale());
    } catch (e: any) {
      toast.error(e?.message ?? "Could not create the sale", { id: t });
    } finally {
      setCreating(false);
    }
  };

  const recurring = draft.paymentType === "recurring";
  const sessions = Math.max(0, Math.trunc(Number(draft.sessionsIncluded) || 0));

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
        <DialogContent className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden p-0">
          <DialogHeader className="border-b border-border px-4 py-3 md:px-6">
            <DialogTitle>Add sale</DialogTitle>
            <DialogDescription className="flex items-center gap-1.5">
              <User className="h-3.5 w-3.5" />
              <span className="font-semibold text-foreground">{clientName ?? "This client"}</span>
              <span>is already selected.</span>
            </DialogDescription>
          </DialogHeader>

          <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="flex min-h-0 flex-1 flex-col">
            <div className="px-4 pt-3 md:px-6">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="existing">
                  <PackageSearch className="mr-1.5 h-3.5 w-3.5" />Existing product
                </TabsTrigger>
                <TabsTrigger value="custom">
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" />Custom sale
                </TabsTrigger>
              </TabsList>
            </div>

            {/* ── Existing product ── */}
            <TabsContent value="existing" className="mt-0 min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3 md:px-6">
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search products…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 text-base md:text-sm"
                />
              </div>

              {isLoading && (
                <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />Loading products…
                </p>
              )}
              {isError && (
                <div className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-center">
                  <p className="text-sm text-destructive">Products could not be loaded.</p>
                  <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
                </div>
              )}
              {!isLoading && !isError && results.length === 0 && (
                <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                  {search
                    ? "No products match your search."
                    : "No products yet. Use Custom sale to charge this client directly."}
                </div>
              )}

              <ul className="space-y-2">
                {results.map((p: any) => {
                  const el = productAssignEligibility(p);
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        disabled={!el.assignable}
                        onClick={() => pickExisting(p)}
                        className={[
                          "w-full rounded-lg border p-3 text-left transition-colors",
                          el.assignable
                            ? "border-border bg-secondary/20 hover:border-primary/40 hover:bg-secondary/40"
                            : "cursor-not-allowed border-dashed border-border opacity-60",
                        ].join(" ")}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">{p.name}</span>
                          {p.product_type && (
                            <Badge variant="outline" className="text-[10px]">{p.product_type}</Badge>
                          )}
                          {!el.assignable && (
                            <Badge variant="outline" className="border-amber-500/40 text-[10px] text-amber-500">
                              {el.reason}
                            </Badge>
                          )}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          <span className="font-semibold text-foreground">
                            {money(p.price_cents, p.currency)}
                          </span>
                          {p.payment_structure ? ` · ${p.payment_structure}` : ""}
                          {p.term_length && p.term_unit ? ` · ${p.term_length} ${p.term_unit}` : ""}
                        </div>
                        {Number(p.sessions_included ?? 0) > 0 && (
                          <div className="mt-1 flex items-center gap-1.5 text-xs text-primary">
                            <Ticket className="h-3.5 w-3.5" />
                            {p.sessions_included} sessions included
                          </div>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </TabsContent>

            {/* ── Custom sale ── */}
            <TabsContent value="custom" className="mt-0 min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3 md:px-6">
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Sale name</Label>
                  <Input
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    placeholder="e.g. 16 Sessions (Final Payment)"
                    className="text-base md:text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Description (optional)</Label>
                  <Textarea
                    rows={2}
                    value={draft.description}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Payment type</Label>
                    <Select
                      value={draft.paymentType}
                      onValueChange={(v) => setDraft({ ...draft, paymentType: v as any })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="one_time">One-time</SelectItem>
                        <SelectItem value="recurring">Recurring</SelectItem>
                        <SelectItem value="free">Free / no payment</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {draft.paymentType !== "free" && (
                    <div className="grid grid-cols-[1fr_auto] gap-2">
                      <div className="space-y-1.5">
                        <Label>Price</Label>
                        <Input
                          inputMode="decimal"
                          value={draft.priceText}
                          onChange={(e) => setDraft({ ...draft, priceText: e.target.value })}
                          placeholder="400"
                          className="text-base md:text-sm"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Currency</Label>
                        <Select value={draft.currency} onValueChange={(v) => setDraft({ ...draft, currency: v })}>
                          <SelectTrigger className="w-[92px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="CAD">CAD</SelectItem>
                            <SelectItem value="USD">USD</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}
                </div>

                {recurring && (
                  <div className="grid gap-3 rounded-md border border-border bg-secondary/20 p-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>Billed every</Label>
                      <Select value={draft.interval} onValueChange={(v) => setDraft({ ...draft, interval: v as any })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="weekly">Week</SelectItem>
                          <SelectItem value="biweekly">2 weeks</SelectItem>
                          <SelectItem value="monthly">Month</SelectItem>
                          <SelectItem value="yearly">Year</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Duration</Label>
                      <Select
                        value={draft.durationMode}
                        onValueChange={(v) => setDraft({ ...draft, durationMode: v as any })}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="until_cancelled">Renews until cancelled</SelectItem>
                          <SelectItem value="fixed">Fixed number of payments</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {draft.durationMode === "fixed" && (
                      <div className="space-y-1.5">
                        <Label>Number of payments</Label>
                        <Input
                          inputMode="numeric"
                          value={draft.numberOfPayments}
                          onChange={(e) => setDraft({ ...draft, numberOfPayments: e.target.value })}
                          placeholder="4"
                          className="text-base md:text-sm"
                        />
                      </div>
                    )}
                  </div>
                )}

                <div className="grid gap-3 rounded-md border border-border bg-secondary/20 p-3 sm:grid-cols-2">
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label className="text-xs uppercase tracking-widest text-muted-foreground">
                      Included sessions
                    </Label>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Sessions included</Label>
                    <Input
                      inputMode="numeric"
                      value={draft.sessionsIncluded}
                      onChange={(e) => setDraft({ ...draft, sessionsIncluded: e.target.value })}
                      className="text-base md:text-sm"
                    />
                  </div>
                  {sessions > 0 && (
                    <>
                      <div className="space-y-1.5">
                        <Label>Session type</Label>
                        <Select
                          value={draft.sessionType}
                          onValueChange={(v) => setDraft({ ...draft, sessionType: v })}
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Personal Training">Personal Training</SelectItem>
                            <SelectItem value="Online Coaching">Online Coaching</SelectItem>
                            <SelectItem value="Consultation">Consultation</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5 sm:col-span-2">
                        <Label>Credit delivery</Label>
                        <Select
                          value={draft.sessionDelivery}
                          onValueChange={(v) => setDraft({ ...draft, sessionDelivery: v as any })}
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="first_payment">Once on activation</SelectItem>
                            {recurring && (
                              <SelectItem value="per_installment">After each successful payment</SelectItem>
                            )}
                            <SelectItem value="manual">Manually granted by coach</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </>
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Service duration (optional)</Label>
                    <Input
                      inputMode="numeric"
                      value={draft.termLength}
                      onChange={(e) => setDraft({ ...draft, termLength: e.target.value })}
                      placeholder="12"
                      className="text-base md:text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Unit</Label>
                    <Select value={draft.termUnit} onValueChange={(v) => setDraft({ ...draft, termUnit: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Weeks">Weeks</SelectItem>
                        <SelectItem value="Months">Months</SelectItem>
                        <SelectItem value="Years">Years</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex items-start gap-3 rounded-md border border-border p-3">
                  <Switch
                    checked={draft.saveAsProduct}
                    onCheckedChange={(v) => setDraft({ ...draft, saveAsProduct: v })}
                  />
                  <div>
                    <Label>Save this as a reusable product</Label>
                    <p className="text-xs text-muted-foreground">
                      Off by default — this stays a one-off sale for {clientName ?? "this client"} and
                      does not clutter the products list.
                    </p>
                  </div>
                </div>

                <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Summary
                  </div>
                  <div className="font-semibold">{draft.name || "Untitled sale"}</div>
                  <div className="text-xs text-muted-foreground">
                    {draft.paymentType === "free"
                      ? "No payment"
                      : `${money(customSalePriceCents(draft), draft.currency)} · ${customSalePaymentStructure(draft)}`}
                    {sessions > 0 ? ` · ${sessions} ${draft.sessionType} sessions` : ""}
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter className="border-t border-border px-4 py-3 md:px-6">
            <Button variant="ghost" onClick={close}>Cancel</Button>
            {tab === "custom" && (
              <Button onClick={buildCustom} disabled={creating} className="bg-gradient-primary font-bold uppercase">
                {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Continue
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AssignOfferDialog
        offer={chosenOffer}
        fixedClientId={clientId}
        onClose={() => setChosenOffer(null)}
      />
    </>
  );
}
