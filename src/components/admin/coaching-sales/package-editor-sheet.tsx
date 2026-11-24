import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowUp, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { PackageCard } from "@/components/sales/coaching-packages";
import { saveCoachingPackage, type AdminPackage } from "@/lib/coaching-packages/packages.functions";
import {
  LIMITS,
  packageProblems,
  priceLabel,
  toPublic,
  type CoachingPackage,
  type PackageKind,
} from "@/lib/coaching-packages/packages";

type Draft = {
  kind: PackageKind;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  best_for: string;
  features: string[];
  price: string;
  cta_label: string;
  included_calls: number;
  call_minutes: number;
  call_cancel_hours: number;
  call_booking_card_id: string | null;
  product_id: string | null;
  admin_note: string;
};

function fromPackage(p: AdminPackage | null): Draft {
  return {
    kind: p?.kind ?? "subscription",
    slug: p?.slug ?? "",
    name: p?.name ?? "",
    tagline: p?.tagline ?? "",
    description: p?.description ?? "",
    best_for: p?.best_for ?? "",
    features: p?.features?.length ? [...p.features] : [""],
    price: p?.price_cents ? String(p.price_cents / 100) : "",
    cta_label: p?.cta_label ?? "",
    included_calls: p?.included_calls ?? 0,
    call_minutes: p?.call_minutes ?? 30,
    call_cancel_hours: p?.call_cancel_hours ?? 24,
    call_booking_card_id: p?.call_booking_card_id ?? null,
    product_id: p?.product_id ?? null,
    admin_note: p?.admin_note ?? "",
  };
}

function cents(price: string): number | null {
  const n = Number(price.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && price.trim() ? Math.round(n * 100) : null;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, LIMITS.slug);
}

/**
 * Edit a package with its card beside it, drawn by the same component the
 * site uses, so the preview is what goes live. A package on the site asks
 * before saving ("This updates jfeffect.com now").
 */
export function PackageEditorSheet({
  pkg,
  open,
  onClose,
  onSaved,
}: {
  pkg: AdminPackage | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const save = useServerFn(saveCoachingPackage);
  const [d, setD] = useState<Draft>(() => fromPackage(pkg));
  const [slugTouched, setSlugTouched] = useState(false);
  const [confirmLive, setConfirmLive] = useState(false);
  useEffect(() => {
    if (open) {
      setD(fromPackage(pkg));
      setSlugTouched(!!pkg);
    }
  }, [open, pkg]);

  const live = !!pkg && pkg.status === "active" && pkg.is_public;
  const products = useQuery({
    queryKey: ["coaching-products-for-packages"],
    enabled: open,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("coaching_products")
        .select("id, name, price_cents, payment_structure, archived")
        .eq("archived", false)
        .order("name");
      return (data ?? []) as { id: string; name: string; price_cents: number; payment_structure: string | null }[];
    },
  });
  const callTypes = useQuery({
    queryKey: ["video-booking-types"],
    enabled: open && d.kind === "subscription",
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("booking_cards")
        .select("id, name, slug, uses_credit")
        .eq("location_mode", "video")
        .order("name");
      return (data ?? []) as { id: string; name: string; slug: string | null; uses_credit: boolean }[];
    },
  });

  const row = useMemo(
    () => ({
      slug: d.slug,
      kind: d.kind,
      name: d.name,
      tagline: d.tagline || null,
      description: d.description || null,
      best_for: d.best_for || null,
      features: d.features.map((f) => f.trim()).filter(Boolean),
      price_cents: d.kind === "free" ? 0 : cents(d.price),
      cta_label: d.cta_label || null,
      included_calls: d.kind === "subscription" ? d.included_calls : 0,
      call_minutes: d.call_minutes,
    }),
    [d],
  );
  const problems = packageProblems(row);
  const preview = toPublic({
    ...(pkg ?? ({} as CoachingPackage)),
    ...row,
    currency: "CAD",
    billing_interval: d.kind === "one_time" ? "once" : d.kind === "free" ? null : "month",
    recommended: pkg?.recommended ?? false,
    status: pkg?.status ?? "draft",
    is_public: pkg?.is_public ?? false,
    sort_order: pkg?.sort_order ?? 0,
    call_booking_card_id: d.call_booking_card_id,
    call_cancel_hours: d.call_cancel_hours,
    product_id: d.product_id,
    admin_note: d.admin_note || null,
    id: pkg?.id ?? "new",
    published_at: null,
    updated_at: "",
  } as CoachingPackage);
  const product = products.data?.find((p) => p.id === d.product_id) ?? null;
  const priceMismatch = product && row.price_cents && product.price_cents !== row.price_cents;

  const m = useMutation({
    mutationFn: () =>
      save({
        data: {
          id: pkg?.id ?? null,
          ...row,
          call_cancel_hours: d.call_cancel_hours,
          call_booking_card_id: d.kind === "subscription" && d.included_calls > 0 ? d.call_booking_card_id : null,
          product_id: d.product_id,
          admin_note: d.admin_note || null,
        },
      }),
    onSuccess: () => {
      toast.success(live ? "Saved. jfeffect.com shows it now." : "Saved");
      onSaved();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const submit = () => {
    if (problems.length) return toast.error(problems[0]);
    if (live) setConfirmLive(true);
    else m.mutate();
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-3xl" data-package-editor>
        <SheetHeader className="border-b border-border py-3 pr-5">
          <SheetTitle>{pkg ? `Edit ${pkg.name}` : "New package"}</SheetTitle>
          <p className="text-[13px] text-muted-foreground">
            {live
              ? "This one is on jfeffect.com. Saving updates the site right away."
              : "Not on the site. Save as often as you like; it goes live only when you put it there."}
          </p>
        </SheetHeader>
        <div className="grid gap-6 p-5 md:grid-cols-[1fr_320px]">
          <div className="space-y-5">
            {!pkg && (
              <div>
                <Label>Kind</Label>
                <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {(
                    [
                      ["subscription", "Monthly coaching"],
                      ["membership", "Membership"],
                      ["one_time", "Single call"],
                      ["free", "Free"],
                    ] as const
                  ).map(([k, l]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => set("kind", k)}
                      className={
                        "h-11 rounded-lg text-[14px] font-medium ring-1 " +
                        (d.kind === k ? "bg-foreground text-background ring-foreground" : "bg-background ring-border")
                      }
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <Field label="Name" hint={`${d.name.length}/${LIMITS.name}`}>
              <Input
                value={d.name}
                maxLength={LIMITS.name}
                onChange={(e) => {
                  set("name", e.target.value);
                  if (!slugTouched) set("slug", slugify(e.target.value));
                }}
              />
            </Field>
            <Field label="Link name" hint={`jfeffect.com/coaching/apply?package=${d.slug || "…"}`}>
              <Input
                value={d.slug}
                disabled={live}
                onChange={(e) => {
                  setSlugTouched(true);
                  set("slug", slugify(e.target.value));
                }}
              />
            </Field>
            <Field label="One-liner" hint={`${d.tagline.length}/${LIMITS.tagline}`}>
              <Input value={d.tagline} maxLength={LIMITS.tagline} onChange={(e) => set("tagline", e.target.value)} />
            </Field>
            {d.kind !== "free" && (
              <Field label={d.kind === "one_time" ? "Price (CAD, before tax)" : "Monthly price (CAD, before tax)"}>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">$</span>
                  <Input inputMode="decimal" value={d.price} onChange={(e) => set("price", e.target.value)} className="max-w-[160px]" />
                  {d.price && cents(d.price) ? <span className="text-[13px] text-muted-foreground">{priceLabel(cents(d.price))} + tax</span> : null}
                </div>
              </Field>
            )}
            <div>
              <Label>What's included</Label>
              <div className="mt-1.5 space-y-2">
                {d.features.map((f, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <Input
                      value={f}
                      maxLength={LIMITS.feature}
                      onChange={(e) => set("features", d.features.map((x, j) => (j === i ? e.target.value : x)))}
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label="Move up"
                      disabled={i === 0}
                      onClick={() => {
                        const next = [...d.features];
                        [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
                        set("features", next);
                      }}
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label="Remove"
                      onClick={() => set("features", d.features.filter((_, j) => j !== i))}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                {d.features.length < LIMITS.features && (
                  <Button type="button" size="sm" variant="ghost" onClick={() => set("features", [...d.features, ""])}>
                    <Plus className="mr-1 h-4 w-4" /> Add a line
                  </Button>
                )}
              </div>
            </div>
            <Field label="Best for" hint="Optional">
              <Input value={d.best_for} maxLength={LIMITS.bestFor} onChange={(e) => set("best_for", e.target.value)} />
            </Field>
            <Field label="Description" hint="Optional, for the coaching page and cards">
              <Textarea rows={3} value={d.description} maxLength={LIMITS.description} onChange={(e) => set("description", e.target.value)} />
            </Field>
            <Field label="Button" hint={d.kind === "free" ? "Default: Join free" : d.kind === "membership" ? "Default: Join free, then upgrade (it's bought in the app)" : "Default: Apply for coaching"}>
              <Input value={d.cta_label} maxLength={LIMITS.cta} onChange={(e) => set("cta_label", e.target.value)} />
            </Field>

            {d.kind === "subscription" && (
              <div className="rounded-xl bg-muted/50 p-4">
                <p className="text-[14px] font-semibold">Included video calls</p>
                <p className="mt-0.5 text-[13px] text-muted-foreground">
                  Clients on this package book them themselves, up to this many per billing period. Unused calls don't carry over;
                  a missed or late-cancelled call counts.
                </p>
                <div className="mt-3 grid grid-cols-3 gap-3">
                  <Field label="Calls a month">
                    <Input
                      inputMode="numeric"
                      value={String(d.included_calls)}
                      onChange={(e) => set("included_calls", Math.max(0, Math.min(LIMITS.includedCalls, Number(e.target.value.replace(/\D/g, "")) || 0)))}
                    />
                  </Field>
                  <Field label="Minutes">
                    <Input
                      inputMode="numeric"
                      value={String(d.call_minutes)}
                      onChange={(e) => set("call_minutes", Number(e.target.value.replace(/\D/g, "")) || 30)}
                    />
                  </Field>
                  <Field label="Cancel by (hours)">
                    <Input
                      inputMode="numeric"
                      value={String(d.call_cancel_hours)}
                      onChange={(e) => set("call_cancel_hours", Math.min(168, Number(e.target.value.replace(/\D/g, "")) || 0))}
                    />
                  </Field>
                </div>
                {d.included_calls > 0 && (
                  <Field label="Booking type for the calls">
                    <select
                      className="h-10 w-full rounded-lg border border-input bg-background px-3 text-[14px]"
                      value={d.call_booking_card_id ?? ""}
                      onChange={(e) => set("call_booking_card_id", e.target.value || null)}
                    >
                      <option value="">Pick a video booking type</option>
                      {(callTypes.data ?? []).map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                          {t.uses_credit ? " (uses a PT credit)" : ""}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
              </div>
            )}

            {d.kind !== "free" && (
              <Field label="Sold with" hint="The Stripe product a sale uses. Read only: nothing here changes it.">
                <select
                  className="h-10 w-full rounded-lg border border-input bg-background px-3 text-[14px]"
                  value={d.product_id ?? ""}
                  onChange={(e) => set("product_id", e.target.value || null)}
                >
                  <option value="">Not linked yet</option>
                  {(products.data ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {priceLabel(p.price_cents)}
                      {p.payment_structure ? ` · ${p.payment_structure}` : ""}
                    </option>
                  ))}
                </select>
                {priceMismatch ? (
                  <p className="mt-1.5 text-[13px] text-warning-foreground dark:text-warning" data-price-mismatch>
                    That product charges {priceLabel(product!.price_cents)}, not {priceLabel(row.price_cents)}. Sales and clients'
                    subscriptions stay as they are; set up a matching product in Products before selling at the new price.
                  </p>
                ) : null}
              </Field>
            )}
            <Field label="Private note" hint="Only you see this">
              <Textarea rows={2} value={d.admin_note} maxLength={LIMITS.adminNote} onChange={(e) => set("admin_note", e.target.value)} />
            </Field>
          </div>

          <div className="md:sticky md:top-4 md:self-start">
            <p className="mb-2 text-[13px] font-medium text-muted-foreground">How it looks on the site</p>
            <PackageCard pkg={preview} preview />
            {problems.length > 0 && <p className="mt-3 text-[13px] text-destructive">{problems[0]}</p>}
          </div>
        </div>
        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-background px-5 py-3">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={m.isPending} data-save-package>
            {m.isPending ? "Saving…" : live ? "Publish changes" : "Save"}
          </Button>
        </div>
        <AlertDialog open={confirmLive} onOpenChange={setConfirmLive}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Update jfeffect.com now?</AlertDialogTitle>
              <AlertDialogDescription>
                The site and new pricing cards show these changes right away. Nobody's sale or subscription changes: clients keep
                what they pay.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep editing</AlertDialogCancel>
              <AlertDialogAction onClick={() => m.mutate()}>Publish changes</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <Label>{label}</Label>
        {hint && <span className="truncate text-[12px] text-muted-foreground">{hint}</span>}
      </div>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
