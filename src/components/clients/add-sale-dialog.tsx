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
 * The header is a single grid (Back / title / close) so nothing floats over
 * the title at any width — see @/lib/sale-dialog-layout.
 */

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
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
import {
  ChevronLeft, Loader2, Search, Ticket, User, Sparkles, PackageSearch, X, CalendarClock,
} from "lucide-react";
import { toast } from "sonner";
import { listCoachingProducts, createCoachingProduct } from "@/lib/coaching-products.functions";
import {
  blankCustomSale, customSalePriceCents, customSalePaymentStructure, customSaleScheduleSnapshot,
  customSaleToProductInput, pickableProducts, productAssignEligibility,
  productToOfferLike, searchProducts, validateCustomSale, type CustomSaleDraft,
} from "@/lib/add-sale";
import { businessToday, scheduleSummary, type BillingScheduleDraft } from "@/lib/billing-schedule";
import {
  SALE_DIALOG_BACK_CLASS, SALE_DIALOG_BODY_CLASS, SALE_DIALOG_CLOSE_CLASS,
  SALE_DIALOG_CONTENT_CLASS, SALE_DIALOG_FOOTER_CLASS, SALE_DIALOG_HEADER_CLASS,
  SALE_DIALOG_TITLE_CLASS,
} from "@/lib/sale-dialog-layout";
import { AssignOfferDialog } from "@/components/assign-offer-dialog";
import { DateField } from "@/components/ui/date-field";

function money(cents: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-CA", {
      style: "currency", currency: (currency || "cad").toUpperCase(), maximumFractionDigits: 2,
    }).format((cents ?? 0) / 100);
  } catch {
    return `${(currency || "cad").toUpperCase()} ${((cents ?? 0) / 100).toFixed(2)}`;
  }
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
      {children}
    </div>
  );
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

  const setSchedule = (patch: Partial<BillingScheduleDraft>) =>
    setDraft((d) => ({ ...d, schedule: { ...d.schedule, ...patch } }));

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
        // Agreed payment dates travel with the sale, not with the product.
        billing_schedule: customSaleScheduleSnapshot(draft),
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
  const paid = draft.paymentType !== "free";
  const sessions = Math.max(0, Math.trunc(Number(draft.sessionsIncluded) || 0));
  const today = businessToday();
  const summary = scheduleSummary({
    draft: draft.schedule,
    paymentType: draft.paymentType,
    frequency: recurring ? draft.interval : null,
    numberOfPayments:
      recurring && draft.durationMode === "fixed" ? Number(draft.numberOfPayments) || 0 : 0,
  });

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
        <DialogContent showBackButton={false} className={SALE_DIALOG_CONTENT_CLASS}>
          <div className={SALE_DIALOG_HEADER_CLASS}>
            <button type="button" onClick={close} className={SALE_DIALOG_BACK_CLASS}>
              <ChevronLeft className="h-4 w-4" />
              <span className="hidden sm:inline">Back</span>
            </button>
            <div className="min-w-0">
              <DialogTitle className={SALE_DIALOG_TITLE_CLASS}>
                {tab === "custom" ? "Custom sale" : "Add sale"}
              </DialogTitle>
              <DialogDescription className="flex items-center justify-center gap-1.5 truncate text-xs">
                <User className="h-3 w-3 shrink-0" />
                <span className="truncate">
                  <span className="font-semibold text-foreground">{clientName ?? "This client"}</span>{" "}
                  is already selected.
                </span>
              </DialogDescription>
            </div>
            <DialogPrimitive.Close aria-label="Close" className={SALE_DIALOG_CLOSE_CLASS}>
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>

          <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="flex min-h-0 flex-1 flex-col">
            <div className="px-3 pt-3 sm:px-6">
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
            <TabsContent value="existing" className={`mt-0 ${SALE_DIALOG_BODY_CLASS}`}>
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
              <p className="mt-3 text-xs text-muted-foreground">
                You can set the first payment date for this client on the next screen.
              </p>
            </TabsContent>

            {/* ── Custom sale ── */}
            <TabsContent value="custom" className={`mt-0 ${SALE_DIALOG_BODY_CLASS}`}>
              <div className="space-y-5">
                <div className="space-y-3">
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
                </div>

                {/* PAYMENT */}
                <div className="space-y-3">
                  <SectionLabel>Payment</SectionLabel>
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
                    {paid && (
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
                </div>

                {/* BILLING — recurring only */}
                {recurring && (
                  <div className="space-y-3">
                    <SectionLabel>Billing</SectionLabel>
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
                  </div>
                )}

                {/* PAYMENT DATES */}
                {paid && (
                  <div className="space-y-3">
                    <SectionLabel>Payment dates</SectionLabel>
                    <div className="space-y-3 rounded-md border border-border bg-secondary/20 p-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label>First payment</Label>
                          <Select
                            value={draft.schedule.firstPaymentMode}
                            onValueChange={(v) => setSchedule({ firstPaymentMode: v as any })}
                          >
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="immediate">When checkout is completed</SelectItem>
                              <SelectItem value="on_date">On a specific date</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        {draft.schedule.firstPaymentMode === "on_date" && (
                          <div className="space-y-1.5">
                            <Label>First payment date</Label>
                            <DateField
                              aria-label="First payment date"
                              min={today}
                              value={draft.schedule.firstPaymentDate}
                              onChange={(v) => setSchedule({ firstPaymentDate: v })}
                            />
                          </div>
                        )}
                        {recurring &&
                          draft.schedule.firstPaymentMode === "immediate" &&
                          (draft.interval === "monthly" || draft.interval === "yearly") && (
                            <div className="space-y-1.5">
                              <Label>Billing day (optional)</Label>
                              <Select
                                value={draft.schedule.billingDay || "none"}
                                onValueChange={(v) => setSchedule({ billingDay: v === "none" ? "" : v })}
                              >
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent className="max-h-64">
                                  <SelectItem value="none">Same day they check out</SelectItem>
                                  {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                                    <SelectItem key={d} value={String(d)}>
                                      {d} of every month
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                      </div>
                      {draft.schedule.firstPaymentMode === "on_date" && (
                        <p className="text-xs text-muted-foreground">
                          The client enters their card at checkout but is <strong>not charged</strong> until
                          this date. Future payments then land on the same date each cycle.
                        </p>
                      )}
                      {!recurring && (
                        <p className="text-xs text-muted-foreground">
                          One-time sales are collected when the client completes checkout.
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* INCLUDED SESSIONS */}
                <div className="space-y-3">
                  <SectionLabel>Included sessions</SectionLabel>
                  <div className="grid gap-3 rounded-md border border-border bg-secondary/20 p-3 sm:grid-cols-2">
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
                          <p className="text-xs text-muted-foreground">
                            Credit delivery is independent of the payment schedule.
                          </p>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* SERVICE ACCESS */}
                <div className="space-y-3">
                  <SectionLabel>Service access</SectionLabel>
                  <div className="grid gap-3 rounded-md border border-border bg-secondary/20 p-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>Coaching starts</Label>
                      <Select
                        value={draft.schedule.serviceStartMode}
                        onValueChange={(v) => setSchedule({ serviceStartMode: v as any })}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="immediate">Immediately after purchase</SelectItem>
                          <SelectItem value="with_first_payment">Same date as first payment</SelectItem>
                          <SelectItem value="on_date">On a specific date</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {draft.schedule.serviceStartMode === "on_date" && (
                      <div className="space-y-1.5">
                        <Label htmlFor="custom-sale-service-start">Start date</Label>
                        <DateField
                          id="custom-sale-service-start"
                          aria-label="Coaching start date"
                          placeholder="Pick the coaching start date"
                          value={draft.schedule.serviceStartDate}
                          onChange={(v) => setSchedule({ serviceStartDate: v })}
                        />
                        <p className="text-xs text-muted-foreground">
                          Access begins on this date. It does not change when Stripe charges.
                        </p>
                      </div>
                    )}
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
                </div>

                {/* OPTIONS */}
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

                {/* LIVE SUMMARY */}
                <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
                  <div className="flex items-center gap-1.5">
                    <CalendarClock className="h-3.5 w-3.5 text-primary" />
                    <SectionLabel>Summary</SectionLabel>
                  </div>
                  <div className="mt-1 font-semibold">{draft.name || "Untitled sale"}</div>
                  <div className="text-xs text-muted-foreground">
                    {draft.paymentType === "free"
                      ? "No payment"
                      : `${money(customSalePriceCents(draft), draft.currency)} · ${customSalePaymentStructure(draft)}`}
                    {sessions > 0 ? ` · ${sessions} ${draft.sessionType} sessions` : ""}
                  </div>
                  {paid && (
                    <dl className="mt-2 grid gap-x-4 gap-y-1 border-t border-primary/20 pt-2 text-xs sm:grid-cols-2">
                      <div>
                        <dt className="text-muted-foreground">First payment</dt>
                        <dd className="font-semibold">{summary.firstPayment}</dd>
                      </div>
                      {summary.anchor && (
                        <div>
                          <dt className="text-muted-foreground">Then</dt>
                          <dd className="font-semibold">{summary.anchor}</dd>
                        </div>
                      )}
                      {summary.duration && (
                        <div>
                          <dt className="text-muted-foreground">Duration</dt>
                          <dd className="font-semibold">{summary.duration}</dd>
                        </div>
                      )}
                      {summary.finalPayment && (
                        <div>
                          <dt className="text-muted-foreground">Final payment</dt>
                          <dd className="font-semibold">{summary.finalPayment}</dd>
                        </div>
                      )}
                      <div>
                        <dt className="text-muted-foreground">Access</dt>
                        <dd className="font-semibold">{summary.serviceStart}</dd>
                      </div>
                    </dl>
                  )}
                </div>
              </div>
            </TabsContent>
          </Tabs>

          <div className={`flex items-center justify-end gap-2 ${SALE_DIALOG_FOOTER_CLASS}`}>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            {tab === "custom" && (
              <Button onClick={buildCustom} disabled={creating} className="bg-gradient-primary font-bold uppercase">
                {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Continue
              </Button>
            )}
          </div>
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
