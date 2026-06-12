import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DoubleConfirmDeleteDialog } from "@/components/double-confirm-delete-dialog";
import { AssignOfferDialog } from "@/components/assign-offer-dialog";
import { OfferDetailDialog } from "@/components/offer-detail-dialog";
import { toast } from "sonner";
import { runJob } from "@/lib/progress-jobs";
import { Copy, ExternalLink, Loader2, Plus, Trash2, ImagePlus, Pencil, Archive, ArchiveRestore, FileSignature, AlertTriangle, CheckCircle2, Search, X, ListChecks, Sparkles, Eye, CreditCard, Link2, Share2, Wand2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import {
  listCoachingProducts,
  createCoachingProduct,
  updateCoachingProduct,
  duplicateCoachingProduct,
  deleteCoachingProduct,
  generatePaymentLinkForProduct,
} from "@/lib/coaching-products.functions";
import { createPreviewCheckoutSession } from "@/lib/stripe-checkout.functions";
import { ProductAccessGrantDialog } from "@/components/product-access-grant-dialog";
import { Lock as LockIcon } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/payment-links")({
  component: PaymentLinksPage,
});

const PRODUCT_TYPES = [
  "Online Coaching", "In-Person Personal Training", "In-Person Session Package",
  "Hybrid Coaching", "Powerlifting Coaching", "Program Review",
  "Custom Training Program", "Nutrition Targets Setup", "Consultation",
  "Digital Product", "Add-On Service", "Custom",
];
const PAYMENT_STRUCTURES = [
  "One-time payment", "Monthly recurring", "Weekly recurring",
  "Payment plan", "Paid in full", "Deposit + remaining balance", "Custom",
];
const TERM_UNITS = ["Days", "Weeks", "Months", "Years", "Session package", "One-time", "Ongoing", "Custom"];
const STATUSES = ["Active", "Draft", "Archived"] as const;

type Product = {
  id: string;
  name: string;
  description: string | null;
  details: string | null;
  price_cents: number;
  currency: string;
  image_url: string | null;
  image_signed_url: string | null;
  payment_link_url: string | null;
  stripe_product_id: string | null;
  active: boolean;
  status: string;
  product_type: string | null;
  payment_structure: string | null;
  term_length: number | null;
  term_unit: string | null;
  included_features: string[] | null;
  agreement_required: boolean;
  agreement_template_id: string | null;
  agreement_before_service: boolean;
  notes: string | null;
  created_at: string;
};

function formatPrice(cents: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() })
      .format(cents / 100);
  } catch {
    return `${currency.toUpperCase()} ${(cents / 100).toFixed(2)}`;
  }
}

function termLabel(p: Product) {
  if (p.term_length && p.term_unit) return `${p.term_length} ${p.term_unit}`;
  if (p.term_unit) return p.term_unit;
  return null;
}

function productToOfferLike(p: Product) {
  // Shape for AssignOfferDialog + snapshotOfferForPurchase
  return {
    id: p.id,
    name: p.name,
    offer_type: p.product_type ?? "Custom Offer",
    short_description: p.description,
    description: p.details,
    currency: p.currency.toUpperCase(),
    price: p.price_cents / 100,
    full_payable_amount: p.price_cents / 100,
    payment_structure: p.payment_structure,
    payment_frequency: p.payment_structure,
    term_duration: p.term_length,
    term_duration_unit: p.term_unit,
    included_features: p.included_features ?? [],
    excluded_features: [],
    stripe_payment_link: p.payment_link_url,
    stripe_price_id: (p as any).stripe_price_id ?? null,
    stripe_product_id: p.stripe_product_id ?? null,
    mode: (p as any).mode ?? null,
    requires_agreement: !!p.agreement_required,
    agreement_before_service: !!p.agreement_before_service,
    default_agreement_template_id: p.agreement_template_id,
    version: 1,
  };
}

type FormState = {
  name: string;
  productType: string;
  description: string;
  details: string;
  priceText: string;
  currency: string;
  paymentStructure: string;
  termLength: string;
  termUnit: string;
  includedFeaturesText: string;
  agreementRequired: boolean;
  agreementTemplateId: string | null;
  agreementBeforeService: boolean;
  status: "Active" | "Draft" | "Archived";
  notes: string;
  imageFile: File | null;
  imagePreview: string | null;
  stripePriceId: string;
  checkoutMode: "payment" | "subscription" | "";
  generateStripeProduct: boolean;
  billingInterval: "month" | "year" | "week" | "day" | "";
  accessLevel: string;
};

function emptyForm(): FormState {
  return {
    name: "", productType: "Online Coaching", description: "", details: "",
    priceText: "", currency: "CAD", paymentStructure: "One-time payment",
    termLength: "", termUnit: "Months",
    includedFeaturesText: "", agreementRequired: false, agreementTemplateId: null,
    agreementBeforeService: false, status: "Active", notes: "",
    imageFile: null, imagePreview: null,
    stripePriceId: "", checkoutMode: "",
    generateStripeProduct: false, billingInterval: "", accessLevel: "",
  };
}

function productToForm(p: Product): FormState {
  return {
    name: p.name ?? "",
    productType: p.product_type ?? "Online Coaching",
    description: p.description ?? "",
    details: p.details ?? "",
    priceText: (p.price_cents / 100).toString(),
    currency: (p.currency ?? "cad").toUpperCase(),
    paymentStructure: p.payment_structure ?? "One-time payment",
    termLength: p.term_length ? String(p.term_length) : "",
    termUnit: p.term_unit ?? "Months",
    includedFeaturesText: (p.included_features ?? []).join("\n"),
    agreementRequired: !!p.agreement_required,
    agreementTemplateId: p.agreement_template_id ?? null,
    agreementBeforeService: !!p.agreement_before_service,
    status: (STATUSES.includes((p.status as any)) ? (p.status as any) : "Active") as FormState["status"],
    notes: p.notes ?? "",
    imageFile: null,
    imagePreview: p.image_signed_url ?? null,
    stripePriceId: (p as any).stripe_price_id ?? "",
    checkoutMode: ((p as any).mode === "subscription" || (p as any).mode === "payment" ? (p as any).mode : "") as "payment" | "subscription" | "",
    generateStripeProduct: false,
    billingInterval: "",
    accessLevel: "",
  };
}

function PaymentLinksPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listCoachingProducts);
  const createFn = useServerFn(createCoachingProduct);
  const updateFn = useServerFn(updateCoachingProduct);
  const duplicateFn = useServerFn(duplicateCoachingProduct);
  const deleteFn = useServerFn(deleteCoachingProduct);
  const previewCheckoutFn = useServerFn(createPreviewCheckoutSession);
  const generateLinkFn = useServerFn(generatePaymentLinkForProduct);
  const [previewingCheckout, setPreviewingCheckout] = useState<string | null>(null);
  const [generatingLink, setGeneratingLink] = useState<string | null>(null);
  const [sharing, setSharing] = useState<Product | null>(null);

  const handleGenerateLink = async (p: Product) => {
    if (!(p as any).stripe_price_id) {
      toast.error("Add a Stripe Price ID first.");
      setEditing({ open: true, product: p });
      return;
    }
    setGeneratingLink(p.id);
    let linkUrl = "";
    try {
      await runJob<{ url: string }>(
        {
          title: "Creating Stripe checkout link",
          description: p.name,
          steps: ["Validate product", "Create Stripe checkout session", "Save purchase record", "Generate checkout link", "Finalize"],
          successToast: "Payment link ready — copied to clipboard",
        },
        async (job) => {
          job.completeStep(0);
          const res = await generateLinkFn({ data: { id: p.id } });
          linkUrl = res.url;
          job.completeStep(1); job.completeStep(2); job.completeStep(3);
          qc.invalidateQueries({ queryKey: ["coaching-products"] });
          try { await navigator.clipboard.writeText(res.url); } catch {}
          job.completeStep(4);
          return res;
        },
      );
      // After success: attach success CTAs (Open / Copy) to the just-completed job.
      const { jobStore } = await import("@/lib/progress-jobs");
      const latest = jobStore.getSnapshot().find((j) => j.title === "Creating Stripe checkout link" && j.status === "success");
      if (latest && linkUrl) {
        jobStore.succeed(latest.id, {
          statusText: "Link ready",
          successAction: { label: "Open checkout link", onClick: () => window.open(linkUrl, "_blank", "noopener,noreferrer") },
        });
      }
    } catch {
      // runJob handled the toast
    } finally {
      setGeneratingLink(null);
    }
  };

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Payment link copied — paste into text, DM, or email.");
    } catch {
      toast.error("Could not copy. Long-press the link to copy manually.");
    }
  };

  const handleStripePreview = async (p: Product) => {
    const r = readiness(p);
    if (!(p as any).stripe_price_id) {
      toast.error("Add a Stripe Price ID to this product before previewing checkout.");
      return;
    }
    setPreviewingCheckout(p.id);
    try {
      await runJob(
        {
          title: "Creating Stripe checkout preview",
          description: p.name,
          steps: ["Validate product", "Create Stripe checkout session", "Open preview"],
          successToast: "Stripe checkout preview opened",
        },
        async (job) => {
          job.completeStep(0);
          const res = await previewCheckoutFn({ data: { productId: p.id, origin: window.location.origin } });
          job.completeStep(1);
          window.open(res.url, "_blank", "noopener,noreferrer");
          job.completeStep(2);
        },
      );
    } catch {
      // runJob handled the toast
    } finally {
      setPreviewingCheckout(null);
    }
  };

  const { data, isLoading } = useQuery({
    queryKey: ["coaching-products"],
    queryFn: () => listFn(),
  });

  const [editing, setEditing] = useState<{ open: boolean; product: Product | null }>({ open: false, product: null });
  const [assigning, setAssigning] = useState<any | null>(null);
  const [previewing, setPreviewing] = useState<Product | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Product | null>(null);
  const [grantFor, setGrantFor] = useState<Product | null>(null);
  const [manageMode, setManageMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  const { data: agreementTemplates = [] } = useQuery({
    queryKey: ["agreement-templates-active-for-products"],
    queryFn: async () => (await supabase
      .from("agreement_templates")
      .select("id, name")
      .eq("archived", false).eq("is_active", true)
      .order("name")).data ?? [],
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Product removed.");
      setPendingDelete(null);
      qc.invalidateQueries({ queryKey: ["coaching-products"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to remove"),
  });

  const duplicateMutation = useMutation({
    mutationFn: (id: string) => duplicateFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Duplicated");
      qc.invalidateQueries({ queryKey: ["coaching-products"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to duplicate"),
  });

  const setStatusMutation = useMutation({
    mutationFn: (vars: { id: string; status: "Active" | "Draft" | "Archived" }) =>
      updateFn({ data: { id: vars.id, status: vars.status } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["coaching-products"] }),
    onError: (e: any) => toast.error(e?.message ?? "Failed to update"),
  });

  const items = (data?.items ?? []) as Product[];

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "Active" | "Draft" | "Archived">("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [structureFilter, setStructureFilter] = useState<string>("all");

  const filteredItems = useMemo(() => {
    return items.filter((p) => {
      const s = (p.status ?? (p.active ? "Active" : "Draft"));
      const q = searchQuery.trim().toLowerCase();
      const matchesSearch = !q ||
        p.name.toLowerCase().includes(q) ||
        (p.description ?? "").toLowerCase().includes(q) ||
        (p.product_type ?? "").toLowerCase().includes(q) ||
        (p.payment_structure ?? "").toLowerCase().includes(q);
      const matchesStatus = statusFilter === "all" || s === statusFilter;
      const matchesType = typeFilter === "all" || (p.product_type ?? "") === typeFilter;
      const matchesStructure = structureFilter === "all" || (p.payment_structure ?? "") === structureFilter;
      return matchesSearch && matchesStatus && matchesType && matchesStructure;
    });
  }, [items, searchQuery, statusFilter, typeFilter, structureFilter]);

  const visible = filteredItems;

  const hasFilters = searchQuery || statusFilter !== "all" || typeFilter !== "all" || structureFilter !== "all";

  const toggleSelected = (id: string) =>
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allSelected = visible.length > 0 && visible.every((p) => selected.has(p.id));
  const toggleSelectAll = () => setSelected(allSelected ? new Set() : new Set(visible.map((p) => p.id)));
  const exitManage = () => { setManageMode(false); setSelected(new Set()); };

  const bulkArchive = async () => {
    const ids = [...selected];
    try {
      await Promise.all(ids.map((id) => updateFn({ data: { id, status: "Archived" as const } })));
      toast.success(`Archived ${ids.length} product${ids.length !== 1 ? "s" : ""}`);
      exitManage();
      qc.invalidateQueries({ queryKey: ["coaching-products"] });
    } catch (e: any) { toast.error(e?.message ?? "Failed to archive"); }
  };
  const bulkDelete = async () => {
    const ids = [...selected];
    try {
      await Promise.all(ids.map((id) => deleteFn({ data: { id } })));
      toast.success(`Deleted ${ids.length} product${ids.length !== 1 ? "s" : ""}`);
      exitManage();
      qc.invalidateQueries({ queryKey: ["coaching-products"] });
    } catch (e: any) { toast.error(e?.message ?? "Failed to delete"); }
  };

  function readiness(p: Product): { ready: boolean; missing: string[] } {
    const missing: string[] = [];
    if ((p.status ?? (p.active ? "Active" : "Draft")) !== "Active") missing.push("Not Active");
    if (!p.price_cents || p.price_cents <= 0) missing.push("Missing Price");
    if (!(p as any).stripe_price_id) missing.push("Missing Stripe Price ID");
    const mode = (p as any).mode;
    if (mode !== "payment" && mode !== "subscription") missing.push("Missing Checkout Mode");
    if (!p.name?.trim()) missing.push("Missing Name");
    return { ready: missing.length === 0, missing };
  }

  return (
    <>
      <PageHeader
        title="Products & Payments"
        subtitle="Create coaching products, connect Stripe checkout, assign products to clients, and track purchases."
        actions={
          <div className="flex gap-2">
            {!manageMode ? (
              <>
                <Button variant="outline" onClick={() => setManageMode(true)}>
                  <ListChecks className="mr-2 h-4 w-4" /> Manage products
                </Button>
                <Button className="bg-gradient-primary font-bold uppercase tracking-wide" onClick={() => setEditing({ open: true, product: null })}>
                  <Plus className="mr-2 h-4 w-4" /> New product
                </Button>
              </>
            ) : (
              <Button variant="outline" onClick={exitManage}>Cancel</Button>
            )}
          </div>
        }
      />
      <div className="p-6 md:p-8 space-y-6">
        {manageMode && (
          <Card className="border-primary/30 bg-primary/5 p-3 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Checkbox checked={allSelected} onCheckedChange={toggleSelectAll} />
              <span className="text-sm font-semibold">{selected.size} selected</span>
            </div>
            <div className="ml-auto flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={selected.size === 0} onClick={bulkArchive}>
                <Archive className="mr-1 h-3.5 w-3.5" /> Archive selected
              </Button>
              <Button size="sm" variant="destructive" disabled={selected.size === 0} onClick={() => setBulkDeleteOpen(true)}>
                <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete selected
              </Button>
            </div>
          </Card>
        )}
        <div className="flex flex-col gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search products by name, description, type…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={statusFilter === "all" ? "default" : "outline"} className="cursor-pointer" onClick={() => setStatusFilter("all")}>All statuses</Badge>
            <Badge variant={statusFilter === "Active" ? "default" : "outline"} className="cursor-pointer" onClick={() => setStatusFilter("Active")}>Active</Badge>
            <Badge variant={statusFilter === "Draft" ? "default" : "outline"} className="cursor-pointer" onClick={() => setStatusFilter("Draft")}>Draft</Badge>
            <Badge variant={statusFilter === "Archived" ? "default" : "outline"} className="cursor-pointer" onClick={() => setStatusFilter("Archived")}>Archived</Badge>
            {hasFilters && (
              <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => { setSearchQuery(""); setStatusFilter("all"); setTypeFilter("all"); setStructureFilter("all"); }}>
                <X className="h-3 w-3 mr-1" /> Clear filters
              </Button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-auto min-w-[160px] h-8 text-xs"><SelectValue placeholder="Product type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {PRODUCT_TYPES.map((t) => (<SelectItem key={t} value={t}>{t}</SelectItem>))}
              </SelectContent>
            </Select>
            <Select value={structureFilter} onValueChange={setStructureFilter}>
              <SelectTrigger className="w-auto min-w-[180px] h-8 text-xs"><SelectValue placeholder="Payment structure" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All structures</SelectItem>
                {PAYMENT_STRUCTURES.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground ml-auto">{visible.length} product{visible.length !== 1 ? "s" : ""}</span>
          </div>
        </div>
        {isLoading ? (
          <Card className="border-border bg-card p-8 text-center text-muted-foreground"><Loader2 className="inline h-4 w-4 animate-spin mr-2" />Loading…</Card>
        ) : visible.length === 0 ? (
          <Card className="border-border bg-card p-10 text-center text-sm text-muted-foreground">
            {hasFilters ? "No products match your filters. Try clearing some filters." : "No products yet. Create your first product."}
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {visible.map((p) => (
              <Card key={p.id} className={`border-border bg-card p-4 flex gap-4 ${selected.has(p.id) ? "ring-2 ring-primary" : ""}`}>
                {manageMode && (
                  <div className="pt-1">
                    <Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggleSelected(p.id)} />
                  </div>
                )}
                <div className="h-24 w-24 shrink-0 rounded-md bg-muted overflow-hidden">
                  {p.image_signed_url ? (
                    <img src={p.image_signed_url} alt={p.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="h-full w-full grid place-items-center text-muted-foreground text-xs">No image</div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-bold truncate">{p.name}</h3>
                        <Badge variant={p.status === "Active" ? "default" : "outline"} className={p.status === "Active" ? "bg-gradient-primary" : ""}>{p.status ?? (p.active ? "Active" : "Draft")}</Badge>
                        {readiness(p).ready && (
                          <Badge className="bg-green-600 hover:bg-green-600 text-white border-0">
                            <Sparkles className="h-3 w-3 mr-1" /> Ready
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {p.product_type ?? "Product"}{p.payment_structure ? ` · ${p.payment_structure}` : ""}{termLabel(p) ? ` · ${termLabel(p)}` : ""}
                      </div>
                      <div className="text-lg font-black mt-1">{p.currency.toUpperCase()} {formatPrice(p.price_cents, p.currency)}</div>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(() => {
                      const r = readiness(p);
                      if (r.ready) {
                        return (
                          <>
                            <Badge variant="outline" className="text-xs border-primary/40 text-primary">
                              <CheckCircle2 className="h-3 w-3 mr-1" />Checkout Ready
                            </Badge>
                            {p.payment_link_url && (
                              <Badge variant="outline" className="text-xs border-green-600/40 text-green-600">
                                <Link2 className="h-3 w-3 mr-1" />Payment Link Ready
                              </Badge>
                            )}
                          </>
                        );
                      }
                      return r.missing.map((m) => (
                        <Badge key={m} variant="outline" className="text-xs text-destructive border-destructive/40">
                          <AlertTriangle className="h-3 w-3 mr-1" />{m}
                        </Badge>
                      ));
                    })()}
                    {p.agreement_required && <Badge variant="outline" className="text-xs"><FileSignature className="h-3 w-3 mr-1" />Agreement Required</Badge>}
                  </div>
                  {p.description && <p className="text-sm mt-2 line-clamp-2 text-muted-foreground">{p.description}</p>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(() => {
                      const r = readiness(p);
                      const archived = p.status === "Archived";
                      const hasPriceId = !!(p as any).stripe_price_id;
                      const hasLink = !!p.payment_link_url;
                      if (archived) {
                        return (
                          <>
                            <Button size="sm" variant="outline" onClick={() => setStatusMutation.mutate({ id: p.id, status: "Draft" })}>
                              <ArchiveRestore className="h-3.5 w-3.5 mr-1" /> Restore
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setEditing({ open: true, product: p })}>
                              <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                            </Button>
                          </>
                        );
                      }
                      return (
                        <>
                          <Button size="sm" className="bg-gradient-primary font-bold uppercase" onClick={() => setAssigning(productToOfferLike(p))}>
                            Assign to client
                          </Button>
                          {hasLink && (
                            <>
                              <Button size="sm" variant="outline" onClick={() => copyLink(p.payment_link_url!)} title="Copy the Stripe payment link to share manually">
                                <Copy className="h-3.5 w-3.5 mr-1" /> Copy payment link
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => setSharing(p)} title="Open share panel with message templates">
                                <Share2 className="h-3.5 w-3.5 mr-1" /> Share
                              </Button>
                              <a href={p.payment_link_url!} target="_blank" rel="noreferrer">
                                <Button size="sm" variant="outline" title="Open the live payment link in a new tab">
                                  <ExternalLink className="h-3.5 w-3.5 mr-1" /> Open checkout
                                </Button>
                              </a>
                            </>
                          )}
                          {!hasLink && hasPriceId && r.ready && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleGenerateLink(p)}
                              disabled={generatingLink === p.id}
                              title="Create a reusable Stripe payment link you can copy and send anywhere"
                            >
                              {generatingLink === p.id
                                ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                                : <Wand2 className="h-3.5 w-3.5 mr-1" />}
                              Generate payment link
                            </Button>
                          )}
                          {!hasPriceId && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-amber-500/40 text-amber-500 hover:bg-amber-500/10"
                              onClick={() => setEditing({ open: true, product: p })}
                              title="This product needs a Stripe Price ID and checkout mode before clients can pay."
                            >
                              <AlertTriangle className="h-3.5 w-3.5 mr-1" /> Complete Stripe setup
                            </Button>
                          )}
                          <Button size="sm" variant="outline" onClick={() => setPreviewing(p)} title="Preview the client-facing product card">
                            <Eye className="h-3.5 w-3.5 mr-1" /> Preview
                          </Button>
                          {hasPriceId && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleStripePreview(p)}
                              disabled={previewingCheckout === p.id}
                              title="Open the live Stripe-hosted checkout page in a new tab"
                            >
                              {previewingCheckout === p.id
                                ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                                : <CreditCard className="h-3.5 w-3.5 mr-1" />}
                              Open Stripe checkout
                            </Button>
                          )}
                          <Button size="sm" variant="outline" onClick={() => setEditing({ open: true, product: p })} title="Edit product">
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setGrantFor(p)} title="Membership access granted by this product">
                            <LockIcon className="h-3.5 w-3.5 mr-1" /> Access
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => duplicateMutation.mutate(p.id)} title="Duplicate">
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      );
                    })()}
                    {p.status === "Archived" ? (
                      null
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => setStatusMutation.mutate({ id: p.id, status: "Archived" })} title="Archive"><Archive className="h-3.5 w-3.5" /></Button>
                    )}
                    <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10" onClick={() => setPendingDelete(p)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <ProductFormDialog
        open={editing.open}
        product={editing.product}
        templates={agreementTemplates as any[]}
        onClose={() => setEditing({ open: false, product: null })}
        onSaved={() => { qc.invalidateQueries({ queryKey: ["coaching-products"] }); setEditing({ open: false, product: null }); }}
      />

      <AssignOfferDialog offer={assigning} onClose={() => setAssigning(null)} />

      <ProductAccessGrantDialog
        productId={grantFor?.id ?? null}
        productName={grantFor?.name}
        initialIsMemberFacing={(grantFor as any)?.is_member_facing ?? false}
        initialMemberTierLabel={(grantFor as any)?.member_tier_label ?? null}
        onClose={() => setGrantFor(null)}
      />

      <OfferDetailDialog
        offer={previewing ? productToOfferLike(previewing) : null}
        onClose={() => setPreviewing(null)}
        onAssign={(o) => { setPreviewing(null); setAssigning(o); }}
        onEdit={() => {
          const p = previewing;
          setPreviewing(null);
          if (p) setEditing({ open: true, product: p });
        }}
      />

      <DoubleConfirmDeleteDialog
        open={!!pendingDelete}
        onOpenChange={(o) => { if (!o) setPendingDelete(null); }}
        title={`Delete "${pendingDelete?.name}"?`}
        message="This removes the product and deactivates its Stripe link. Past Stripe payments are untouched. Existing client purchase records are preserved."
        confirmLabel="Delete Product"
        onConfirm={() => { if (pendingDelete) deleteMutation.mutate(pendingDelete.id); }}
      />

      <DoubleConfirmDeleteDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        count={selected.size}
        title={`Delete ${selected.size} selected product${selected.size !== 1 ? "s" : ""}?`}
        message={`You selected ${selected.size} product${selected.size !== 1 ? "s" : ""}. This removes them from your product library. Past purchase records are preserved.`}
        confirmLabel="Delete Selected Products"
        onConfirm={bulkDelete}
      />

      <SharePaymentLinkDialog
        product={sharing}
        onClose={() => setSharing(null)}
        onCopy={copyLink}
      />
    </>
  );
}

function ProductFormDialog({
  open, product, templates, onClose, onSaved,
}: {
  open: boolean;
  product: Product | null;
  templates: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const createFn = useServerFn(createCoachingProduct);
  const updateFn = useServerFn(updateCoachingProduct);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(product ? productToForm(product) : emptyForm());
  }, [open, product]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const onPickImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    set("imageFile", f);
    if (f) set("imagePreview", URL.createObjectURL(f));
  };

  const handleSave = async () => {
    try {
      if (!form.name.trim()) { toast.error("Product name is required"); return; }
      const priceNum = parseFloat(form.priceText || "0");
      const cents = Math.round((Number.isFinite(priceNum) ? priceNum : 0) * 100);
      setSubmitting(true);

      let imagePath: string | null | undefined = undefined;
      if (form.imageFile) {
        const ext = form.imageFile.name.split(".").pop() || "jpg";
        const path = `${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("product-images")
          .upload(path, form.imageFile, { contentType: form.imageFile.type, upsert: false });
        if (upErr) { toast.error(`Image upload failed: ${upErr.message}`); setSubmitting(false); return; }
        imagePath = path;
      }

      const includedFeatures = form.includedFeaturesText
        .split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 40);

      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        details: form.details.trim() || null,
        priceCents: cents,
        currency: form.currency.toLowerCase(),
        productType: form.productType || null,
        paymentStructure: form.paymentStructure || null,
        termLength: form.termLength ? parseInt(form.termLength, 10) : null,
        termUnit: form.termUnit || null,
        includedFeatures,
        agreementRequired: form.agreementRequired,
        agreementTemplateId: form.agreementRequired ? form.agreementTemplateId : null,
        agreementBeforeService: form.agreementRequired ? form.agreementBeforeService : false,
        status: form.status,
        notes: form.notes.trim() || null,
        stripePriceId: form.stripePriceId.trim() || null,
        checkoutMode: form.checkoutMode || "auto",
        billingInterval: (form.billingInterval as any) || null,
        accessLevel: form.accessLevel ? parseInt(form.accessLevel, 10) : null,
      };

      if (product) {
        await updateFn({ data: { id: product.id, ...payload, ...(imagePath !== undefined ? { imagePath } : {}) } as any });
        toast.success("Product updated");
      } else {
        await createFn({ data: { ...payload, imagePath: imagePath ?? null, generateStripeLink: form.generateStripeProduct } as any });
        toast.success("Product saved");
      }
      onSaved();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{product ? "Edit Product" : "New Product"}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => { e.preventDefault(); handleSave(); }}
          className="grid gap-4 md:grid-cols-2"
        >
          <div className="md:col-span-2 grid md:grid-cols-[160px_1fr] gap-4 items-start">
            <div>
              <Label>Product image</Label>
              <label className="mt-1 flex h-32 w-32 cursor-pointer items-center justify-center rounded-md border border-dashed bg-muted/30 overflow-hidden">
                {form.imagePreview ? (
                  <img src={form.imagePreview} alt="" className="h-full w-full object-cover" />
                ) : (
                  <ImagePlus className="h-6 w-6 text-muted-foreground" />
                )}
                <input type="file" accept="image/*" className="hidden" onChange={onPickImage} />
              </label>
            </div>
            <div className="grid gap-3">
              <div>
                <Label>Product name *</Label>
                <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="12 Month Online Coaching" required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Product type</Label>
                  <Select value={form.productType} onValueChange={(v) => set("productType", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{PRODUCT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Status</Label>
                  <Select value={form.status} onValueChange={(v) => set("status", v as any)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-[1fr_120px] gap-3">
            <div>
              <Label>Price</Label>
              <Input type="number" min="0" step="0.01" value={form.priceText} onChange={(e) => set("priceText", e.target.value)} placeholder="499.00" />
            </div>
            <div>
              <Label>Currency</Label>
              <Select value={form.currency} onValueChange={(v) => set("currency", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="CAD">CAD</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                  <SelectItem value="GBP">GBP</SelectItem>
                  <SelectItem value="AUD">AUD</SelectItem>
                </SelectContent>
              </Select>
              {product && form.currency.toLowerCase() !== (product.currency ?? "").toLowerCase() && (
                <p className="mt-1 text-[11px] text-amber-600">
                  Changing currency will create a new Stripe price in {form.currency} and archive the old one on save.
                </p>
              )}
            </div>
          </div>

          <div>
            <Label>Payment structure</Label>
            <Select value={form.paymentStructure} onValueChange={(v) => set("paymentStructure", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PAYMENT_STRUCTURES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-[1fr_160px] gap-3">
            <div>
              <Label>Term length</Label>
              <Input type="number" min="0" step="1" value={form.termLength} onChange={(e) => set("termLength", e.target.value)} placeholder="12" />
            </div>
            <div>
              <Label>Term unit</Label>
              <Select value={form.termUnit} onValueChange={(v) => set("termUnit", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{TERM_UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          {/* ── Stripe Checkout Session fields ─────────────────────────── */}
          <div className="md:col-span-2 rounded-md border border-primary/20 bg-primary/5 p-3 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-widest text-primary">Stripe Checkout Session</div>

            {/* Auto-create toggle */}
            {!product && (
              <div className="rounded-md border border-border bg-secondary/30 p-3 space-y-2">
                <div className="flex items-center gap-3">
                  <Switch checked={form.generateStripeProduct} onCheckedChange={(v) => set("generateStripeProduct", v)} />
                  <div>
                    <Label className="text-sm">Auto-create Stripe Product &amp; Price</Label>
                    <p className="text-xs text-muted-foreground">Creates a Stripe Product and Price automatically using the name, price, currency, and billing interval below. The Stripe Price ID is saved to this product.</p>
                  </div>
                </div>
                {form.generateStripeProduct && (
                  <div>
                    <Label className="text-xs">Billing interval (leave blank for one-time)</Label>
                    <Select value={form.billingInterval || "__none"} onValueChange={(v) => set("billingInterval", (v === "__none" ? "" : v) as any)}>
                      <SelectTrigger><SelectValue placeholder="One-time (no interval)" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">One-time payment</SelectItem>
                        <SelectItem value="month">Monthly</SelectItem>
                        <SelectItem value="year">Annual</SelectItem>
                        <SelectItem value="week">Weekly</SelectItem>
                        <SelectItem value="day">Daily</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-1">For subscriptions, choose the billing interval. For paid-in-full packages, leave blank.</p>
                  </div>
                )}
              </div>
            )}

            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <Label>Stripe Price ID</Label>
                <Input
                  value={form.stripePriceId}
                  onChange={(e) => set("stripePriceId", e.target.value)}
                  placeholder={form.generateStripeProduct ? "Will be filled automatically" : "price_1ABC..."}
                  className="font-mono text-xs"
                  disabled={form.generateStripeProduct && !product}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {form.generateStripeProduct && !product
                    ? "Auto-created from Stripe when you save."
                    : "From Stripe Dashboard → Products → Prices. Required for in-app checkout."}
                </p>
              </div>
              <div>
                <Label>Checkout Mode</Label>
                <Select value={form.checkoutMode || "__none"} onValueChange={(v) => set("checkoutMode", (v === "__none" ? "" : v) as any)}>
                  <SelectTrigger><SelectValue placeholder="Select checkout mode" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">— Select —</SelectItem>
                    <SelectItem value="payment">One-time payment</SelectItem>
                    <SelectItem value="subscription">Subscription</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">Controls whether Stripe Checkout creates a subscription or a one-time charge.</p>
              </div>
            </div>

            {/* Access level */}
            <div>
              <Label>Access level (0–5)</Label>
              <Select value={form.accessLevel || "__none"} onValueChange={(v) => set("accessLevel", v === "__none" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Select access level" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Not set</SelectItem>
                  <SelectItem value="0">0 — App access only</SelectItem>
                  <SelectItem value="1">1 — Self-led program</SelectItem>
                  <SelectItem value="2">2 — Basic coaching</SelectItem>
                  <SelectItem value="3">3 — Full coaching</SelectItem>
                  <SelectItem value="4">4 — Coaching Plus</SelectItem>
                  <SelectItem value="5">5 — Private coaching</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">Used to control what content and features the client can access after payment.</p>
            </div>
          </div>

          <div className="md:col-span-2">
            <Label>Short description</Label>
            <Input value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="One-line summary shown on Stripe checkout" />
          </div>

          <div className="md:col-span-2">
            <Label>Full details</Label>
            <Textarea rows={4} value={form.details} onChange={(e) => set("details", e.target.value)} placeholder="Delivery, scheduling notes, service terms, client expectations…" />
          </div>

          <div className="md:col-span-2">
            <Label>What's included (one per line)</Label>
            <Textarea rows={5} value={form.includedFeaturesText} onChange={(e) => set("includedFeaturesText", e.target.value)} placeholder={"Custom training program\nNutrition targets\nWeekly check-ins"} />
          </div>

          <div className="md:col-span-2 rounded-md border border-border bg-secondary/20 p-3 space-y-3">
            <div className="flex items-center gap-3">
              <Switch checked={form.agreementRequired} onCheckedChange={(v) => set("agreementRequired", v)} />
              <Label>Agreement required</Label>
            </div>
            {form.agreementRequired && (
              <>
                <div>
                  <Label className="text-xs">Required agreement template</Label>
                  <Select value={form.agreementTemplateId ?? ""} onValueChange={(v) => set("agreementTemplateId", v || null)}>
                    <SelectTrigger><SelectValue placeholder="Pick a template" /></SelectTrigger>
                    <SelectContent>
                      {templates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-3">
                  <Switch checked={form.agreementBeforeService} onCheckedChange={(v) => set("agreementBeforeService", v)} />
                  <Label>Must be signed before service starts</Label>
                </div>
              </>
            )}
          </div>

          <div className="md:col-span-2">
            <Label>Internal notes</Label>
            <Textarea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Admin-only notes" />
          </div>

          <div className="md:col-span-2 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={submitting} className="bg-gradient-primary font-bold uppercase tracking-wide">
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Save Product / Link
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SharePaymentLinkDialog({
  product, onClose, onCopy,
}: {
  product: Product | null;
  onClose: () => void;
  onCopy: (url: string) => void;
}) {
  const url = product?.payment_link_url ?? "";
  const template = product
    ? `Hey! Here's your secure payment link for ${product.name}:\n\n${url}\n\nLet me know once you've completed checkout and I'll get you set up.`
    : "";
  return (
    <Dialog open={!!product} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Share payment link</DialogTitle>
        </DialogHeader>
        {product && (
          <div className="space-y-4">
            <div>
              <div className="text-sm font-semibold">{product.name}</div>
              <div className="text-xs text-muted-foreground">
                {product.currency.toUpperCase()} {formatPrice(product.price_cents, product.currency)}
                {product.payment_structure ? ` · ${product.payment_structure}` : ""}
              </div>
            </div>
            <div>
              <Label className="text-xs">Payment link URL</Label>
              <div className="mt-1 flex gap-2">
                <Input readOnly value={url} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
                <Button size="sm" variant="outline" onClick={() => onCopy(url)}>
                  <Copy className="h-3.5 w-3.5 mr-1" /> Copy
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                This is a real, reusable Stripe payment link. Anyone with this URL can pay.
              </p>
            </div>
            <div>
              <Label className="text-xs">Quick message (optional)</Label>
              <Textarea
                rows={5}
                readOnly
                value={template}
                onFocus={(e) => e.currentTarget.select()}
                className="text-sm"
              />
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="outline" onClick={async () => {
                  try { await navigator.clipboard.writeText(template); toast.success("Message copied."); } catch { toast.error("Could not copy."); }
                }}>
                  <Copy className="h-3.5 w-3.5 mr-1" /> Copy message
                </Button>
                <a href={url} target="_blank" rel="noreferrer">
                  <Button size="sm" variant="outline">
                    <ExternalLink className="h-3.5 w-3.5 mr-1" /> Open checkout
                  </Button>
                </a>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}