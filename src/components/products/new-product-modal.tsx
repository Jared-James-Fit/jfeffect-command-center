import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Plus,
  X,
  ImagePlus,
  Loader2,
  ChevronDown,
  ChevronRight,
  GripVertical,
  Trash2,
  Sparkles,
  Info,
} from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { createCoachingProduct } from "@/lib/coaching-products.functions";

/* ─────────────────────────────────────────────────────────────
   Field labels for validation surfacing
   ───────────────────────────────────────────────────────────── */
const FIELD_LABELS: Record<string, string> = {
  name: "Product name",
  price: "Price",
  fixedPaymentCount: "Number of payments",
  serviceDuration: "Access duration",
  sessionsIncluded: "Sessions included",
  agreementTemplateId: "Agreement template",
};

/* ─────────────────────────────────────────────────────────────
   Config
   ───────────────────────────────────────────────────────────── */

type Category =
  | "Online Coaching"
  | "In-Person Training"
  | "Hybrid Coaching"
  | "Membership"
  | "Program"
  | "Session Package"
  | "Consultation"
  | "Digital Product"
  | "Other";

const CATEGORIES: Category[] = [
  "Online Coaching",
  "In-Person Training",
  "Hybrid Coaching",
  "Membership",
  "Program",
  "Session Package",
  "Consultation",
  "Digital Product",
  "Other",
];

/**
 * Which categories imply timed access (Duration & Start section visible).
 * Membership / Program / Coaching all imply timed access; digital / other do not.
 */
const CATEGORIES_WITH_ACCESS: Record<Category, boolean> = {
  "Online Coaching": true,
  "In-Person Training": true,
  "Hybrid Coaching": true,
  Membership: true,
  Program: true,
  "Session Package": true,
  Consultation: false,
  "Digital Product": false,
  Other: false,
};

const CATEGORIES_WITH_SESSIONS: Record<Category, boolean> = {
  "Online Coaching": false,
  "In-Person Training": true,
  "Hybrid Coaching": true,
  Membership: false,
  Program: false,
  "Session Package": true,
  Consultation: true,
  "Digital Product": false,
  Other: false,
};

type PaymentType = "one_time" | "recurring" | "free";
// NOTE: "payment_plan" is intentionally deferred — the underlying Stripe sync
// path does not yet support fixed-instalment schedules natively. Follow-up.

type BillingInterval = "week" | "month" | "year";

type SubscriptionDuration = "until_cancelled" | "fixed_payments";

type DurationUnit = "days" | "weeks" | "months" | "ongoing";

type StartRule =
  | "immediately"
  | "after_current"
  | "next_monday"
  | "manual";

type AccessPreset =
  | "none"
  | "basic_member"
  | "full_member"
  | "online_coaching"
  | "in_person_coaching"
  | "custom";

const ACCESS_PRESET_LABELS: Record<AccessPreset, string> = {
  none: "No app access",
  basic_member: "Basic member access",
  full_member: "Full membership access",
  online_coaching: "Online coaching client",
  in_person_coaching: "In-person coaching client",
  custom: "Custom access",
};

/** Map friendly presets to the numeric 0–5 access level the DB stores. */
function accessPresetToLevel(p: AccessPreset): number | null {
  switch (p) {
    case "none":
      return 0;
    case "basic_member":
      return 1;
    case "full_member":
      return 2;
    case "online_coaching":
      return 3;
    case "in_person_coaching":
      return 4;
    case "custom":
      return 5;
  }
}

/** Sensible default preset per category. */
function defaultAccessPreset(cat: Category): AccessPreset {
  switch (cat) {
    case "Online Coaching":
      return "online_coaching";
    case "In-Person Training":
    case "Hybrid Coaching":
      return "in_person_coaching";
    case "Membership":
      return "full_member";
    case "Program":
      return "basic_member";
    default:
      return "none";
  }
}

/* ─────────────────────────────────────────────────────────────
   Form state
   ───────────────────────────────────────────────────────────── */

type FormState = {
  // basics
  category: Category;
  name: string;
  description: string;
  detailsShown: boolean;
  details: string;
  imageFile: File | null;
  imagePreview: string | null;

  // pricing
  paymentType: PaymentType;
  priceText: string;
  currency: string;
  billingInterval: BillingInterval;
  subscriptionDuration: SubscriptionDuration;
  fixedPaymentCount: string;

  // duration & start
  serviceDurationValue: string;
  serviceDurationUnit: DurationUnit;
  startRule: StartRule;

  // included
  includedItems: string[];

  // sessions / access
  sessionsIncluded: string;
  sessionLengthMin: string;
  sessionExpiryDays: string;
  accessPreset: AccessPreset;

  // agreement
  agreementRequired: boolean;
  agreementTemplateId: string | null;
  agreementBeforeService: boolean;

  // selling
  selfPurchase: boolean;
  allowPromotionCodes: boolean;
  allowSelfCancellation: boolean;
  newCustomersOnly: boolean;
  visibleOnSalesPage: boolean;

  // workspace
  workspace: "coaching" | "membership" | "both";

  // advanced / status
  status: "Draft" | "Active";
  notes: string;
};

function initialForm(defaultWorkspace: "coaching" | "membership"): FormState {
  const category: Category =
    defaultWorkspace === "membership" ? "Membership" : "Online Coaching";
  return {
    category,
    name: "",
    description: "",
    detailsShown: false,
    details: "",
    imageFile: null,
    imagePreview: null,
    paymentType: "recurring",
    priceText: "",
    currency: "CAD",
    billingInterval: "month",
    subscriptionDuration: "until_cancelled",
    fixedPaymentCount: "12",
    serviceDurationValue: "12",
    serviceDurationUnit: "months",
    startRule: "immediately",
    includedItems: [],
    sessionsIncluded: "",
    sessionLengthMin: "60",
    sessionExpiryDays: "",
    accessPreset: defaultAccessPreset(category),
    agreementRequired: false,
    agreementTemplateId: null,
    agreementBeforeService: false,
    selfPurchase: true,
    allowPromotionCodes: true,
    allowSelfCancellation: true,
    newCustomersOnly: false,
    visibleOnSalesPage: true,
    workspace: defaultWorkspace === "membership" ? "membership" : "coaching",
    status: "Draft",
    notes: "",
  };
}

/* ─────────────────────────────────────────────────────────────
   Helpers
   ───────────────────────────────────────────────────────────── */

function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amount);
  } catch {
    return `${currency.toUpperCase()} ${amount.toFixed(2)}`;
  }
}

function intervalWord(iv: BillingInterval) {
  switch (iv) {
    case "week":
      return "week";
    case "month":
      return "month";
    case "year":
      return "year";
  }
}

function priceLine(f: FormState): string {
  const price = parseFloat(f.priceText || "0") || 0;
  if (f.paymentType === "free") return "Free";
  if (!price) return "—";
  const money = formatMoney(price, f.currency);
  if (f.paymentType === "one_time") return `${money} one-time`;
  const every = `every ${intervalWord(f.billingInterval)}`;
  if (f.subscriptionDuration === "fixed_payments") {
    const n = parseInt(f.fixedPaymentCount || "0", 10);
    if (n > 0) return `${money} ${every} for ${n} payment${n === 1 ? "" : "s"}`;
  }
  return `${money} ${every}, renews until cancelled`;
}

function durationLine(f: FormState): string | null {
  if (!CATEGORIES_WITH_ACCESS[f.category]) return null;
  if (f.serviceDurationUnit === "ongoing") return "Ongoing access";
  const v = parseInt(f.serviceDurationValue || "0", 10);
  if (!v) return null;
  return `${v} ${f.serviceDurationUnit} of access`;
}

function startLine(f: FormState): string | null {
  if (!CATEGORIES_WITH_ACCESS[f.category]) return null;
  switch (f.startRule) {
    case "immediately":
      return "Starts immediately after purchase";
    case "after_current":
      return "Starts after current product ends";
    case "next_monday":
      return "Starts next Monday";
    case "manual":
      return "Manually activated by admin";
  }
}

/* ─────────────────────────────────────────────────────────────
   Validation
   ───────────────────────────────────────────────────────────── */

type FieldErrors = Partial<Record<string, string>>;

function validate(f: FormState): FieldErrors {
  const errs: FieldErrors = {};
  if (!f.name.trim()) errs.name = "Product name is required";

  if (f.paymentType !== "free") {
    const price = parseFloat(f.priceText || "0");
    if (!Number.isFinite(price) || price <= 0)
      errs.price = "Price must be greater than zero";
    if (price > 100_000) errs.price = "Price is too high";
  }
  if (f.paymentType === "recurring" && f.subscriptionDuration === "fixed_payments") {
    const n = parseInt(f.fixedPaymentCount || "0", 10);
    if (!Number.isFinite(n) || n < 1) errs.fixedPaymentCount = "Enter a payment count of 1 or more";
  }
  if (CATEGORIES_WITH_ACCESS[f.category] && f.serviceDurationUnit !== "ongoing") {
    const d = parseInt(f.serviceDurationValue || "0", 10);
    if (!Number.isFinite(d) || d < 1) errs.serviceDuration = "Access duration must be at least 1";
  }
  if (CATEGORIES_WITH_SESSIONS[f.category]) {
    const s = parseInt(f.sessionsIncluded || "0", 10);
    if (!Number.isFinite(s) || s < 1)
      errs.sessionsIncluded = "Session packages must include at least one session";
  }
  if (f.agreementRequired && !f.agreementTemplateId)
    errs.agreementTemplateId = "Pick an agreement template";
  return errs;
}

/* ─────────────────────────────────────────────────────────────
   Component
   ───────────────────────────────────────────────────────────── */

export type NewProductModalProps = {
  open: boolean;
  defaultWorkspace?: "coaching" | "membership";
  agreementTemplates?: { id: string; name: string }[];
  onClose: () => void;
  onCreated?: (result: { id?: string; paymentLinkUrl?: string | null }) => void;
};

export default function NewProductModal({
  open,
  defaultWorkspace = "coaching",
  agreementTemplates = [],
  onClose,
  onCreated,
}: NewProductModalProps) {
  const qc = useQueryClient();
  const createFn = useServerFn(createCoachingProduct);

  const [form, setForm] = useState<FormState>(() => initialForm(defaultWorkspace));
  const [submitting, setSubmitting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const submittedOnce = useRef(false);
  const fieldRefs = useRef<Record<string, HTMLElement | null>>({});
  const registerField = (key: string) => (el: HTMLElement | null) => {
    fieldRefs.current[key] = el;
  };
  // Stable per-open idempotency key. A retried Save re-uses the same UUID so
  // Stripe returns the original product/price/payment_link instead of
  // duplicating them.
  const idempotencyKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(initialForm(defaultWorkspace));
      setShowAdvanced(false);
      setTouched({});
      submittedOnce.current = false;
      idempotencyKeyRef.current =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
  }, [open, defaultWorkspace]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const setCategory = (c: Category) =>
    setForm((prev) => ({
      ...prev,
      category: c,
      accessPreset: defaultAccessPreset(c),
    }));

  const errors = useMemo(() => validate(form), [form]);
  const hasErrors = Object.keys(errors).length > 0;
  const showErr = (k: string) => (touched[k] || submittedOnce.current) && errors[k];

  /* ── image ─────────────────────────────────────────────── */
  const onPickImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (!file) return;
    set("imageFile", file);
    set("imagePreview", URL.createObjectURL(file));
  };

  /* ── included items ────────────────────────────────────── */
  const addIncluded = () => set("includedItems", [...form.includedItems, ""]);
  const removeIncluded = (idx: number) =>
    set(
      "includedItems",
      form.includedItems.filter((_, i) => i !== idx),
    );
  const updateIncluded = (idx: number, v: string) => {
    const next = form.includedItems.slice();
    next[idx] = v;
    set("includedItems", next);
  };
  const onIncludedPaste = (
    e: React.ClipboardEvent<HTMLInputElement>,
    idx: number,
  ) => {
    const text = e.clipboardData.getData("text");
    if (!text.includes("\n")) return;
    e.preventDefault();
    const lines = text.split("\n").map((s) => s.trim()).filter(Boolean);
    const next = form.includedItems.slice();
    next.splice(idx, 1, ...lines);
    set("includedItems", next);
  };

  /* ── save ──────────────────────────────────────────────── */
  const handleSave = async () => {
    submittedOnce.current = true;
    if (hasErrors) {
      const firstKey = Object.keys(errors)[0];
      const missing = Object.keys(errors)
        .map((k) => FIELD_LABELS[k] ?? k)
        .join(", ");
      toast.error(`Missing required fields: ${missing}`);
      // force re-render for error visibility
      setTouched((t) => ({ ...t }));
      // scroll/focus first invalid field
      const el = fieldRefs.current[firstKey];
      if (el) {
        try {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          (el as HTMLInputElement).focus?.();
        } catch {}
      }
      return;
    }
    setSubmitting(true);
    try {
      // Image upload
      let imagePath: string | null = null;
      if (form.imageFile) {
        const ext = form.imageFile.name.split(".").pop() || "jpg";
        const path = `${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage
          .from("product-images")
          .upload(path, form.imageFile, {
            contentType: form.imageFile.type,
            upsert: false,
          });
        if (error) {
          toast.error(`Image upload failed: ${error.message}`);
          setSubmitting(false);
          return;
        }
        imagePath = path;
      }

      // Payment structure label + Stripe mapping
      const priceNum = parseFloat(form.priceText || "0") || 0;
      const cents = Math.round(priceNum * 100);

      let paymentStructure: string | null = null;
      let checkoutMode: "payment" | "subscription" | "auto" = "auto";
      let billingInterval: "week" | "month" | "year" | null = null;
      let generateStripe = false;

      if (form.paymentType === "free") {
        paymentStructure = "Free";
        checkoutMode = "auto";
        generateStripe = false;
      } else if (form.paymentType === "one_time") {
        paymentStructure = "One-time payment";
        checkoutMode = "payment";
        generateStripe = true;
      } else {
        // recurring
        billingInterval = form.billingInterval;
        checkoutMode = "subscription";
        generateStripe = true;
        if (form.subscriptionDuration === "fixed_payments") {
          const n = parseInt(form.fixedPaymentCount || "0", 10);
          paymentStructure = `${intervalWord(form.billingInterval).replace(/^./, (c) => c.toUpperCase())}ly subscription — ${n} payments`;
        } else {
          paymentStructure = `${intervalWord(form.billingInterval).replace(/^./, (c) => c.toUpperCase())}ly subscription`;
        }
      }

      const termLength =
        !CATEGORIES_WITH_ACCESS[form.category] || form.serviceDurationUnit === "ongoing"
          ? null
          : parseInt(form.serviceDurationValue || "0", 10) || null;
      const termUnit = !CATEGORIES_WITH_ACCESS[form.category]
        ? null
        : form.serviceDurationUnit === "ongoing"
          ? "Ongoing"
          : form.serviceDurationUnit.replace(/^./, (c) => c.toUpperCase());

      const included = form.includedItems
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 40);

      // Roll workspace/start/session/selling flags into internal notes so we
      // don't require a schema migration. Persistent notes remain human-readable.
      const noteLines: string[] = [];
      if (form.notes.trim()) noteLines.push(form.notes.trim());
      noteLines.push(`[workspace] ${form.workspace}`);
      if (CATEGORIES_WITH_ACCESS[form.category])
        noteLines.push(`[start] ${form.startRule}`);
      if (CATEGORIES_WITH_SESSIONS[form.category]) {
        noteLines.push(
          `[sessions] ${form.sessionsIncluded} × ${form.sessionLengthMin}min` +
            (form.sessionExpiryDays ? ` (expires ${form.sessionExpiryDays}d)` : ""),
        );
      }
      noteLines.push(
        `[selling] self=${form.selfPurchase} promo=${form.allowPromotionCodes} self_cancel=${form.allowSelfCancellation} new_only=${form.newCustomersOnly} sales_page=${form.visibleOnSalesPage}`,
      );
      const notesFinal = noteLines.join("\n");

      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        details: form.detailsShown ? form.details.trim() || null : null,
        priceCents: cents,
        currency: form.currency.toLowerCase(),
        productType: form.category,
        paymentStructure,
        termLength,
        termUnit,
        includedFeatures: included,
        agreementRequired: form.agreementRequired,
        agreementTemplateId: form.agreementRequired
          ? form.agreementTemplateId
          : null,
        agreementBeforeService: form.agreementRequired,
        status: form.status,
        notes: notesFinal,
        imagePath: imagePath ?? null,
        stripePriceId: null,
        checkoutMode,
        billingInterval,
        accessLevel: accessPresetToLevel(form.accessPreset),
        generateStripeLink: generateStripe,
        isMemberFacing: form.workspace !== "coaching",
        idempotencyKey: idempotencyKeyRef.current,
      };

      const res: any = await createFn({ data: payload as any });
      toast.success(
        generateStripe
          ? "Product created and Stripe checkout link ready."
          : "Product created.",
      );
      qc.invalidateQueries({ queryKey: ["coaching-products"] });
      onCreated?.({
        id: res?.product?.id,
        paymentLinkUrl: res?.product?.payment_link_url ?? null,
      });
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to create product");
    } finally {
      setSubmitting(false);
    }
  };

  const primaryLabel = form.selfPurchase && form.paymentType !== "free"
    ? "Create Product & Checkout Link"
    : "Create Product";

  const missingFieldList = Object.keys(errors).map((k) => FIELD_LABELS[k] ?? k);

  /* ── render ────────────────────────────────────────────── */
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !submitting && onClose()}>
      <DialogContent
        className="max-w-[1080px] w-[95vw] p-0 gap-0 max-h-[95vh] flex flex-col overflow-hidden"
      >
        {/* Sticky header */}
        {/* Left space (pl-24) reserved for the Dialog's auto "Back" pill */}
        <div className="flex items-center gap-3 border-b border-border pl-24 pr-4 py-3 sm:pr-5 min-h-[3.5rem] sticky top-0 bg-background z-10">
          <div className="min-w-0 flex-1">
            <h2 className="text-base sm:text-lg font-bold leading-tight">Add Product</h2>
            <p className="text-[11px] sm:text-xs text-muted-foreground truncate">
              Create the offer, pricing, and checkout in one step.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={() => !submitting && onClose()}
            className="shrink-0 rounded-md p-2 hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid md:grid-cols-[minmax(0,1fr)_300px] flex-1 overflow-hidden">
          {/* Scrolling form column */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSave();
            }}
            className="overflow-y-auto p-4 sm:p-5 space-y-5"
          >
            {/* 1. Product */}
            <Section title="Product">
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_112px]">
                <div className="grid gap-3 min-w-0">
                <div>
                  <Label>Category <Req /></Label>
                  <Select value={form.category} onValueChange={(v) => setCategory(v as Category)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Product name <Req /></Label>
                  <Input
                    ref={registerField("name") as any}
                    value={form.name}
                    onChange={(e) => set("name", e.target.value)}
                    onBlur={() => setTouched((t) => ({ ...t, name: true }))}
                    placeholder="12-Month Online Coaching"
                    aria-invalid={!!showErr("name")}
                    className={showErr("name") ? "border-destructive" : ""}
                  />
                  {showErr("name") && <FieldError msg={errors.name!} />}
                </div>
                <div>
                  <Label>Description</Label>
                  <Textarea
                    rows={2}
                    value={form.description}
                    onChange={(e) => set("description", e.target.value)}
                    placeholder="Describe what the client receives, how coaching is delivered, and the main outcome."
                  />
                  {!form.detailsShown ? (
                    <button
                      type="button"
                      onClick={() => set("detailsShown", true)}
                      className="mt-1 text-xs text-primary hover:underline"
                    >
                      + Add more details
                    </button>
                  ) : (
                    <div className="mt-2">
                      <Label className="text-xs">Full details</Label>
                      <Textarea
                        rows={3}
                        value={form.details}
                        onChange={(e) => set("details", e.target.value)}
                        placeholder="Delivery, scheduling notes, service terms, client expectations…"
                      />
                    </div>
                  )}
                </div>
                </div>
                {/* Compact image uploader (right column on desktop, under fields on mobile) */}
                <div className="min-w-0">
                  <Label className="text-xs">Product image</Label>
                  <label className="mt-1 flex h-20 w-20 cursor-pointer items-center justify-center rounded-md border border-dashed bg-muted/30 overflow-hidden hover:bg-muted/50">
                    {form.imagePreview ? (
                      <img
                        loading="lazy"
                        src={form.imagePreview}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <ImagePlus className="h-5 w-5 text-muted-foreground" />
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={onPickImage}
                    />
                  </label>
                  <p className="mt-1 text-[10px] text-muted-foreground leading-tight">
                    Optional. Shown on checkout & sales pages.
                  </p>
                  {form.imagePreview && (
                    <button
                      type="button"
                      onClick={() => {
                        set("imageFile", null);
                        set("imagePreview", null);
                      }}
                      className="mt-1 text-[11px] text-muted-foreground hover:text-destructive"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            </Section>

            {/* 2. Pricing */}
            <Section title="Pricing">
              <div className="rounded-lg border border-border bg-card/40 p-3 sm:p-4 space-y-3">
                <SegmentedPayment value={form.paymentType} onChange={(v) => set("paymentType", v)} />

                {form.paymentType !== "free" && (
                  <div className="grid grid-cols-[minmax(0,1fr)_110px] gap-3">
                    <div>
                      <Label>Price <Req /></Label>
                      <Input
                        ref={registerField("price") as any}
                        type="number"
                        min="0"
                        step="0.01"
                        value={form.priceText}
                        onChange={(e) => set("priceText", e.target.value)}
                        onBlur={() => setTouched((t) => ({ ...t, price: true }))}
                        placeholder="499.00"
                        aria-invalid={!!showErr("price")}
                        className={showErr("price") ? "border-destructive" : ""}
                      />
                      {showErr("price") && <FieldError msg={errors.price!} />}
                    </div>
                    <div>
                      <Label>Currency</Label>
                      <Select value={form.currency} onValueChange={(v) => set("currency", v)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="CAD">CAD</SelectItem>
                          <SelectItem value="USD">USD</SelectItem>
                          <SelectItem value="EUR">EUR</SelectItem>
                          <SelectItem value="GBP">GBP</SelectItem>
                          <SelectItem value="AUD">AUD</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                {form.paymentType === "recurring" && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Billing frequency</Label>
                      <Select
                        value={form.billingInterval}
                        onValueChange={(v) => set("billingInterval", v as BillingInterval)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="week">Weekly</SelectItem>
                          <SelectItem value="month">Monthly</SelectItem>
                          <SelectItem value="year">Yearly</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Subscription length</Label>
                      <Select
                        value={form.subscriptionDuration}
                        onValueChange={(v) =>
                          set("subscriptionDuration", v as SubscriptionDuration)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="until_cancelled">
                            Renews until cancelled
                          </SelectItem>
                          <SelectItem value="fixed_payments">
                            Fixed number of payments
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {form.subscriptionDuration === "fixed_payments" && (
                      <div className="col-span-2">
                        <Label>Number of payments <Req /></Label>
                        <Input
                          ref={registerField("fixedPaymentCount") as any}
                          type="number"
                          min="1"
                          step="1"
                          value={form.fixedPaymentCount}
                          onChange={(e) => set("fixedPaymentCount", e.target.value)}
                          onBlur={() => setTouched((t) => ({ ...t, fixedPaymentCount: true }))}
                          aria-invalid={!!showErr("fixedPaymentCount")}
                          className={showErr("fixedPaymentCount") ? "border-destructive" : ""}
                        />
                        {showErr("fixedPaymentCount") && (
                          <FieldError msg={errors.fixedPaymentCount!} />
                        )}
                      </div>
                    )}
                  </div>
                )}

                <p className="text-sm font-medium text-foreground">
                  {priceLine(form)}
                </p>

                {form.paymentType !== "free" && (
                  <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                    <Info className="h-3 w-3 mt-0.5 shrink-0" />
                    Taxes calculated automatically at checkout.
                  </p>
                )}
              </div>
            </Section>

            {/* 3. Access */}
            {CATEGORIES_WITH_ACCESS[form.category] && (
              <Section title="Access">
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label>Service duration</Label>
                      <div className="flex gap-2">
                        {form.serviceDurationUnit !== "ongoing" && (
                          <Input
                            ref={registerField("serviceDuration") as any}
                            type="number"
                            min="1"
                            step="1"
                            value={form.serviceDurationValue}
                            onChange={(e) => set("serviceDurationValue", e.target.value)}
                            className={"w-24 " + (showErr("serviceDuration") ? "border-destructive" : "")}
                          />
                        )}
                        <Select
                          value={form.serviceDurationUnit}
                          onValueChange={(v) => set("serviceDurationUnit", v as DurationUnit)}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="days">Days</SelectItem>
                            <SelectItem value="weeks">Weeks</SelectItem>
                            <SelectItem value="months">Months</SelectItem>
                            <SelectItem value="ongoing">Ongoing</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {showErr("serviceDuration") && (
                        <FieldError msg={errors.serviceDuration!} />
                      )}
                    </div>
                    <div>
                      <Label>Product starts</Label>
                      <Select
                        value={form.startRule}
                        onValueChange={(v) => set("startRule", v as StartRule)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="immediately">Immediately after purchase</SelectItem>
                          <SelectItem value="after_current">After current product ends</SelectItem>
                          <SelectItem value="next_monday">Next Monday</SelectItem>
                          <SelectItem value="manual">Manually activated by admin</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div>
                    <Label>App access</Label>
                    <Select
                      value={form.accessPreset}
                      onValueChange={(v) => set("accessPreset", v as AccessPreset)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(ACCESS_PRESET_LABELS) as AccessPreset[]).map((k) => (
                          <SelectItem key={k} value={k}>
                            {ACCESS_PRESET_LABELS[k]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Controls what the client can access after purchase.
                    </p>
                  </div>

                  <div className="rounded-md border border-border px-3 py-2">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <Switch
                        checked={form.agreementRequired}
                        onCheckedChange={(v) => set("agreementRequired", v)}
                      />
                      <span className="text-sm">Require agreement before access</span>
                    </label>
                    {form.agreementRequired && (
                      <div className="mt-3 space-y-2">
                        <div>
                          <Label className="text-xs">Agreement template <Req /></Label>
                          <Select
                            value={form.agreementTemplateId ?? ""}
                            onValueChange={(v) => set("agreementTemplateId", v || null)}
                          >
                            <SelectTrigger
                              ref={registerField("agreementTemplateId") as any}
                              className={showErr("agreementTemplateId") ? "border-destructive" : ""}
                            >
                              <SelectValue placeholder="Pick a template" />
                            </SelectTrigger>
                            <SelectContent>
                              {agreementTemplates.map((t) => (
                                <SelectItem key={t.id} value={t.id}>
                                  {t.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {showErr("agreementTemplateId") && (
                            <FieldError msg={errors.agreementTemplateId!} />
                          )}
                        </div>
                        <label className="flex items-center gap-3 cursor-pointer">
                          <Switch
                            checked={form.agreementBeforeService}
                            onCheckedChange={(v) => set("agreementBeforeService", v)}
                          />
                          <span className="text-xs">Must be signed before service starts</span>
                        </label>
                      </div>
                    )}
                  </div>
                </div>
              </Section>
            )}

            {/* 4. Selling Options */}
            <Section title="Selling options">
              <div className="grid gap-2">
                <ToggleRow
                  label="Available for self-purchase"
                  checked={form.selfPurchase}
                  onChange={(v) => set("selfPurchase", v)}
                />
                <ToggleRow
                  label="Allow promotion codes"
                  checked={form.allowPromotionCodes}
                  onChange={(v) => set("allowPromotionCodes", v)}
                />
                <ToggleRow
                  label="Allow client self-cancellation"
                  checked={form.allowSelfCancellation}
                  onChange={(v) => set("allowSelfCancellation", v)}
                />
                <ToggleRow
                  label="Limit to new customers"
                  checked={form.newCustomersOnly}
                  onChange={(v) => set("newCustomersOnly", v)}
                />
                {form.selfPurchase && (
                  <ToggleRow
                    label="Visible on sales page"
                    checked={form.visibleOnSalesPage}
                    onChange={(v) => set("visibleOnSalesPage", v)}
                  />
                )}
                <div className="mt-2">
                  <Label className="text-xs">Product workspace</Label>
                  <Select
                    value={form.workspace}
                    onValueChange={(v) => set("workspace", v as FormState["workspace"])}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="coaching">Coaching</SelectItem>
                      <SelectItem value="membership">Membership</SelectItem>
                      <SelectItem value="both">Both</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </Section>

            {/* What's included — compact, low priority */}
            <Section title="What's included">
              <div className="space-y-2">
                {form.includedItems.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Optional. Add bullets for what the client receives.
                  </p>
                )}
                {form.includedItems.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                    <Input
                      value={item}
                      onChange={(e) => updateIncluded(idx, e.target.value)}
                      onPaste={(e) => onIncludedPaste(e, idx)}
                      placeholder="e.g. Weekly check-ins"
                    />
                    <button
                      type="button"
                      onClick={() => removeIncluded(idx)}
                      className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                      aria-label="Remove item"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addIncluded}
                  className="mt-1"
                >
                  <Plus className="mr-1 h-3.5 w-3.5" /> Add item
                </Button>
              </div>
            </Section>

            {/* 5. Advanced options (collapsed by default) */}
            <div className="rounded-md border border-border">
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="flex w-full items-center justify-between px-3 py-2 text-sm font-semibold hover:bg-muted/50"
              >
                <span className="flex items-center gap-2">
                  {showAdvanced ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  Advanced options
                </span>
                <span className="text-xs font-normal text-muted-foreground">
                  Sessions, status, internal notes
                </span>
              </button>
              {showAdvanced && (
                <div className="border-t border-border p-3 space-y-3">
                  {CATEGORIES_WITH_SESSIONS[form.category] && (
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <Label className="text-xs">Sessions included <Req /></Label>
                        <Input
                          ref={registerField("sessionsIncluded") as any}
                          type="number"
                          min="1"
                          value={form.sessionsIncluded}
                          onChange={(e) => set("sessionsIncluded", e.target.value)}
                          onBlur={() => setTouched((t) => ({ ...t, sessionsIncluded: true }))}
                          placeholder="10"
                          className={showErr("sessionsIncluded") ? "border-destructive" : ""}
                        />
                        {showErr("sessionsIncluded") && (
                          <FieldError msg={errors.sessionsIncluded!} />
                        )}
                      </div>
                      <div>
                        <Label className="text-xs">Session length (min)</Label>
                        <Input
                          type="number"
                          min="15"
                          value={form.sessionLengthMin}
                          onChange={(e) => set("sessionLengthMin", e.target.value)}
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Expires (days)</Label>
                        <Input
                          type="number"
                          min="0"
                          value={form.sessionExpiryDays}
                          onChange={(e) => set("sessionExpiryDays", e.target.value)}
                          placeholder="Optional"
                        />
                      </div>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Stripe IDs are generated automatically on save. Edit existing
                    products from the product list.
                  </p>
                  <div>
                    <Label className="text-xs">Status</Label>
                    <Select
                      value={form.status}
                      onValueChange={(v) => set("status", v as "Draft" | "Active")}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Draft">Draft</SelectItem>
                        <SelectItem value="Active">Active</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Internal notes</Label>
                    <Textarea
                      rows={3}
                      value={form.notes}
                      onChange={(e) => set("notes", e.target.value)}
                      placeholder="Admin-only notes"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Mobile summary */}
            <div className="md:hidden rounded-lg border border-border bg-muted/20 p-3">
              <SummaryContent
                form={form}
                hasErrors={hasErrors}
                missingFields={missingFieldList}
              />
            </div>
          </form>

          {/* Summary panel */}
          <aside className="hidden md:block border-l border-border bg-muted/20 overflow-y-auto">
            <div className="sticky top-0 p-4">
              <SummaryContent
                form={form}
                hasErrors={hasErrors}
                missingFields={missingFieldList}
              />
            </div>
          </aside>
        </div>

        {/* Sticky footer */}
        <div
          className="flex items-center justify-end gap-2 border-t border-border bg-background px-5 py-3 sticky bottom-0"
          style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
        >
          <Button
            type="button"
            variant="ghost"
            onClick={() => !submitting && onClose()}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={submitting}
            className="bg-gradient-primary font-bold uppercase tracking-wide"
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating…
              </>
            ) : (
              <>
                <Plus className="mr-2 h-4 w-4" />
                {primaryLabel}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────────────────────────────────────────────────────────
   Small helpers
   ───────────────────────────────────────────────────────────── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

function FieldError({ msg }: { msg: string }) {
  return <p className="mt-1 text-xs text-destructive">{msg}</p>;
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 rounded-md border border-border px-3 py-2 cursor-pointer hover:bg-muted/40">
      <Switch checked={checked} onCheckedChange={onChange} />
      <span className="text-sm">{label}</span>
    </label>
  );
}

function SegmentedPayment({
  value,
  onChange,
}: {
  value: PaymentType;
  onChange: (v: PaymentType) => void;
}) {
  const opts: { key: PaymentType; label: string }[] = [
    { key: "one_time", label: "One-time" },
    { key: "recurring", label: "Recurring" },
    { key: "free", label: "Free" },
  ];
  return (
    <div>
      <Label>Payment type</Label>
      <div className="mt-1 inline-flex rounded-md border border-border p-0.5 bg-muted/30">
        {opts.map((o) => (
          <button
            type="button"
            key={o.key}
            onClick={() => onChange(o.key)}
            className={
              "px-3 py-1.5 text-xs font-medium rounded transition-colors " +
              (value === o.key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground")
            }
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Req() {
  return (
    <span aria-label="required" className="ml-0.5 text-destructive">
      *
    </span>
  );
}

function SummaryContent({
  form,
  hasErrors,
  missingFields,
}: {
  form: FormState;
  hasErrors: boolean;
  missingFields: string[];
}) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        Live summary
      </div>
      <h3 className="mt-1.5 text-base font-bold break-words">
        {form.name || "Untitled product"}
      </h3>
      <p className="mt-1 text-sm">{priceLine(form)}</p>
      {durationLine(form) && (
        <p className="mt-1 text-xs text-muted-foreground">{durationLine(form)}</p>
      )}
      {startLine(form) && (
        <p className="mt-0.5 text-xs text-muted-foreground">{startLine(form)}.</p>
      )}
      {form.includedItems.filter(Boolean).length > 0 && (
        <div className="mt-3">
          <div className="text-[10px] font-semibold uppercase text-muted-foreground">
            Includes
          </div>
          <ul className="mt-1 space-y-0.5 text-xs">
            {form.includedItems.filter(Boolean).map((i, idx) => (
              <li key={idx}>• {i}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-3 space-y-1 text-[11px] text-muted-foreground border-t border-border pt-3">
        <div>
          <span className="font-semibold text-foreground">Checkout:</span>{" "}
          {form.paymentType === "free"
            ? "No paid checkout"
            : form.paymentType === "one_time"
              ? "Stripe one-time payment"
              : "Stripe subscription"}
        </div>
        {form.paymentType !== "free" && <div>Taxes added at checkout</div>}
        {form.paymentType !== "free" && form.allowPromotionCodes && (
          <div>Promotion codes enabled</div>
        )}
        {form.agreementRequired && <div>Agreement required</div>}
        <div>
          Workspace:{" "}
          <span className="capitalize text-foreground">{form.workspace}</span>
        </div>
      </div>
      {hasErrors ? (
        <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-[11px] text-destructive">
          <div className="font-semibold">Missing required fields:</div>
          <div className="mt-0.5">{missingFields.join(", ")}</div>
        </div>
      ) : (
        form.name && (
          <div className="mt-3 flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2 text-[11px] text-emerald-700">
            <Sparkles className="h-3 w-3" /> Ready to create.
          </div>
        )
      )}
    </div>
  );
}