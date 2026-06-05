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
import { toast } from "sonner";
import { Copy, ExternalLink, Loader2, Plus, Trash2, ImagePlus, Pencil, Archive, ArchiveRestore, FileSignature, AlertTriangle, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  listCoachingProducts,
  createCoachingProduct,
  updateCoachingProduct,
  duplicateCoachingProduct,
  deleteCoachingProduct,
} from "@/lib/coaching-products.functions";

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
  paymentLinkUrl: string;
  includedFeaturesText: string;
  agreementRequired: boolean;
  agreementTemplateId: string | null;
  agreementBeforeService: boolean;
  status: "Active" | "Draft" | "Archived";
  notes: string;
  imageFile: File | null;
  imagePreview: string | null;
};

function emptyForm(): FormState {
  return {
    name: "", productType: "Online Coaching", description: "", details: "",
    priceText: "", currency: "CAD", paymentStructure: "One-time payment",
    termLength: "", termUnit: "Months", paymentLinkUrl: "",
    includedFeaturesText: "", agreementRequired: false, agreementTemplateId: null,
    agreementBeforeService: false, status: "Active", notes: "",
    imageFile: null, imagePreview: null,
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
    paymentLinkUrl: p.payment_link_url ?? "",
    includedFeaturesText: (p.included_features ?? []).join("\n"),
    agreementRequired: !!p.agreement_required,
    agreementTemplateId: p.agreement_template_id ?? null,
    agreementBeforeService: !!p.agreement_before_service,
    status: (STATUSES.includes((p.status as any)) ? (p.status as any) : "Active") as FormState["status"],
    notes: p.notes ?? "",
    imageFile: null,
    imagePreview: p.image_signed_url ?? null,
  };
}

function PaymentLinksPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listCoachingProducts);
  const createFn = useServerFn(createCoachingProduct);
  const updateFn = useServerFn(updateCoachingProduct);
  const duplicateFn = useServerFn(duplicateCoachingProduct);
  const deleteFn = useServerFn(deleteCoachingProduct);

  const { data, isLoading } = useQuery({
    queryKey: ["coaching-products"],
    queryFn: () => listFn(),
  });

  const [editing, setEditing] = useState<{ open: boolean; product: Product | null }>({ open: false, product: null });
  const [assigning, setAssigning] = useState<any | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Product | null>(null);

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

  const activeItems = useMemo(() => items.filter((p) => (p.status ?? (p.active ? "Active" : "Draft")) !== "Archived"), [items]);
  const archivedItems = useMemo(() => items.filter((p) => (p.status ?? "") === "Archived"), [items]);
  const [showArchived, setShowArchived] = useState(false);
  const visible = showArchived ? archivedItems : activeItems;

  async function copyLink(url: string | null) {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    toast.success("Payment link copied");
  }

  return (
    <>
      <PageHeader
        title="Stripe Payment Links / Products"
        subtitle="Create products, attach Stripe links, assign them to clients, and track purchases."
        actions={
          <Button className="bg-gradient-primary font-bold uppercase tracking-wide" onClick={() => setEditing({ open: true, product: null })}>
            <Plus className="mr-2 h-4 w-4" /> New product
          </Button>
        }
      />
      <div className="p-6 md:p-8 space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-xs uppercase tracking-widest text-muted-foreground">
            {showArchived ? "Archived products" : "Your products"}
          </h2>
          <Button size="sm" variant="outline" onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? "Show active" : "Show archived"}
          </Button>
        </div>
        {isLoading ? (
          <Card className="border-border bg-card p-8 text-center text-muted-foreground"><Loader2 className="inline h-4 w-4 animate-spin mr-2" />Loading…</Card>
        ) : visible.length === 0 ? (
          <Card className="border-border bg-card p-10 text-center text-sm text-muted-foreground">
            {showArchived ? "No archived products." : "No products yet. Create your first product."}
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {visible.map((p) => (
              <Card key={p.id} className="border-border bg-card p-4 flex gap-4">
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
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {p.product_type ?? "Product"}{p.payment_structure ? ` · ${p.payment_structure}` : ""}{termLabel(p) ? ` · ${termLabel(p)}` : ""}
                      </div>
                      <div className="text-lg font-black mt-1">{p.currency.toUpperCase()} {formatPrice(p.price_cents, p.currency)}</div>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {p.payment_link_url ? (
                      <Badge variant="outline" className="text-xs"><CheckCircle2 className="h-3 w-3 mr-1 text-primary" />Stripe Link Connected</Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs text-destructive border-destructive/40"><AlertTriangle className="h-3 w-3 mr-1" />Missing Stripe Link</Badge>
                    )}
                    {p.agreement_required && <Badge variant="outline" className="text-xs"><FileSignature className="h-3 w-3 mr-1" />Agreement Required</Badge>}
                  </div>
                  {p.description && <p className="text-sm mt-2 line-clamp-2 text-muted-foreground">{p.description}</p>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" className="bg-gradient-primary font-bold uppercase" onClick={() => setAssigning(productToOfferLike(p))}>Assign to client</Button>
                    {p.payment_link_url && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => copyLink(p.payment_link_url)} title="Copy link"><Copy className="h-3.5 w-3.5" /></Button>
                        <a href={p.payment_link_url} target="_blank" rel="noreferrer"><Button size="sm" variant="outline"><ExternalLink className="h-3.5 w-3.5" /></Button></a>
                      </>
                    )}
                    <Button size="sm" variant="outline" onClick={() => setEditing({ open: true, product: p })}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => duplicateMutation.mutate(p.id)}><Copy className="h-3.5 w-3.5" /></Button>
                    {p.status === "Archived" ? (
                      <Button size="sm" variant="ghost" onClick={() => setStatusMutation.mutate({ id: p.id, status: "Draft" })} title="Restore"><ArchiveRestore className="h-3.5 w-3.5" /></Button>
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

      <DoubleConfirmDeleteDialog
        open={!!pendingDelete}
        onOpenChange={(o) => { if (!o) setPendingDelete(null); }}
        title={`Delete "${pendingDelete?.name}"?`}
        message="This removes the product and deactivates its Stripe link. Past Stripe payments are untouched. Existing client purchase records are preserved."
        confirmLabel="Delete Product"
        onConfirm={() => pendingDelete && deleteMutation.mutate(pendingDelete.id)}
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
        pastedPaymentLinkUrl: form.paymentLinkUrl.trim() || null,
      };

      if (product) {
        await updateFn({ data: { id: product.id, ...payload, ...(imagePath !== undefined ? { imagePath } : {}) } as any });
        toast.success("Product updated");
      } else {
        await createFn({ data: { ...payload, imagePath: imagePath ?? null, generateStripeLink: false } as any });
        toast.success("Product saved");
      }
      onSaved();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save");
    } finally {
      setSubmitting(false);
    }
  };

  const linkConnected = !!form.paymentLinkUrl.trim();

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{product ? "Edit Product / Payment Link" : "Create Product / Payment Link"}</DialogTitle>
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
                </SelectContent>
              </Select>
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

          <div className="md:col-span-2 rounded-md border border-border bg-secondary/20 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>Stripe payment link</Label>
              {linkConnected ? (
                <Badge variant="outline" className="text-xs"><CheckCircle2 className="h-3 w-3 mr-1 text-primary" />Stripe Link Connected</Badge>
              ) : (
                <Badge variant="outline" className="text-xs text-destructive border-destructive/40"><AlertTriangle className="h-3 w-3 mr-1" />Missing Stripe Link</Badge>
              )}
            </div>
            <Input
              value={form.paymentLinkUrl}
              onChange={(e) => set("paymentLinkUrl", e.target.value)}
              placeholder="https://buy.stripe.com/..."
              type="url"
            />
            <div className="flex flex-wrap items-center gap-2">
              {linkConnected && (
                <>
                  <Button type="button" size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(form.paymentLinkUrl); toast.success("Copied"); }}><Copy className="h-3.5 w-3.5 mr-1" />Copy</Button>
                  <a href={form.paymentLinkUrl} target="_blank" rel="noreferrer"><Button type="button" size="sm" variant="outline"><ExternalLink className="h-3.5 w-3.5 mr-1" />Open</Button></a>
                  <Button type="button" size="sm" variant="ghost" onClick={() => set("paymentLinkUrl", "")}>Replace Link</Button>
                </>
              )}
            </div>
            {!linkConnected && (
              <p className="text-xs text-muted-foreground">You can save without a link — paste it later. Stripe collects the money; this app organizes it.</p>
            )}
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