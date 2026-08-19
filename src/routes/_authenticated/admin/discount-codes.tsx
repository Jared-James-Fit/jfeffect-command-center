import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listDiscountCodesFn,
  upsertDiscountCodeFn,
  setDiscountCodeStatusFn,
  syncDiscountCodeToStripeFn,
  type DiscountCode,
} from "@/lib/discount-codes.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Ticket, Plus, Copy, Play, Pause, Square, Pencil, Link2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/discount-codes")({
  component: () => <DiscountCodesPage />,
});

const CATEGORY_LABELS: Record<string, string> = {
  promotion: "Promotion",
  ambassador: "Ambassador",
  client_referral: "Client Referral",
  retention: "Retention",
  manual: "Manual",
};

const STATUS_TONE: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  draft: "bg-muted text-muted-foreground",
  scheduled: "bg-sky-500/10 text-sky-600 border-sky-500/30",
  paused: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  expired: "bg-rose-500/10 text-rose-600 border-rose-500/30",
};

function fmtDiscount(c: DiscountCode) {
  const v = c.discount_value;
  const dur =
    c.subscription_duration === "once" ? " · first payment"
    : c.subscription_duration === "repeating" ? ` · ${c.duration_months ?? "?"}mo`
    : " · forever";
  return c.discount_type === "percentage" ? `${v}% off${dur}` : `$${(v / 1).toFixed(2)} off${dur}`;
}

function timeRemaining(iso: string | null): string {
  if (!iso) return "—";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "Expired";
  const days = Math.floor(ms / 86400000);
  if (days >= 1) return `${days}d left`;
  const hours = Math.floor(ms / 3600000);
  return `${hours}h left`;
}

export function DiscountCodesPage({ embedded = false }: { embedded?: boolean } = {}) {
  const qc = useQueryClient();
  const listFn = useServerFn(listDiscountCodesFn);
  const upsertFn = useServerFn(upsertDiscountCodeFn);
  const statusFn = useServerFn(setDiscountCodeStatusFn);
  const syncFn = useServerFn(syncDiscountCodeToStripeFn);

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [page, setPage] = useState(1);
  const filters = useMemo(() => ({ search, category, status, page, size: 25 } as any), [search, category, status, page]);

  const q = useQuery({
    queryKey: ["discount-codes", filters],
    queryFn: () => listFn({ data: filters }),
  });

  const [editing, setEditing] = useState<DiscountCode | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ code: DiscountCode; next: "active" | "paused" | "expired" } | null>(null);

  const refetch = () => qc.invalidateQueries({ queryKey: ["discount-codes"] });

  const setStatusM = useMutation({
    mutationFn: (vars: { id: string; status: any }) => statusFn({ data: vars }),
    onSuccess: (_d, vars) => {
      toast.success(`Code ${vars.status}`);
      refetch();
      setConfirmAction(null);
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  const rows = q.data?.rows ?? [];
  const total = q.data?.total ?? 0;

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).then(
      () => toast.success("Copied to clipboard"),
      () => toast.error("Copy failed"),
    );
  };

  const linkFor = (c: DiscountCode) =>
    c.category === "promotion"
      ? `https://jfeffect.com/join?promo=${encodeURIComponent(c.public_code)}`
      : `https://jfeffect.com/join?ref=${encodeURIComponent(c.public_code)}`;

  return (
    <div className={embedded ? "mx-auto max-w-7xl space-y-4 p-4 md:p-6" : "mx-auto max-w-7xl space-y-4 p-4 md:p-6"}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {!embedded && (
          <h1 className="text-2xl font-black flex items-center gap-2">
            <Ticket className="h-5 w-5" /> Discount Codes
          </h1>
        )}
        <p className="text-sm text-muted-foreground flex-1 min-w-[200px]">
          Promotions, ambassador codes, and client referrals — managed in-app.
          New codes start in draft. Stripe sync is verified in a separate testing step.
        </p>
        <Button onClick={() => setCreating(true)} size="sm">
          <Plus className="h-4 w-4 mr-1" /> Create Discount Code
        </Button>
      </div>

      <Card className="p-3 space-y-3">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
          <Input
            placeholder="Search code, name, description"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
          <Select value={category} onValueChange={(v) => { setCategory(v); setPage(1); }}>
            <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              <SelectItem value="promotion">Promotion</SelectItem>
              <SelectItem value="ambassador">Ambassador</SelectItem>
              <SelectItem value="client_referral">Client Referral</SelectItem>
              <SelectItem value="retention">Retention</SelectItem>
              <SelectItem value="manual">Manual</SelectItem>
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
            <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="scheduled">Scheduled</SelectItem>
              <SelectItem value="paused">Paused</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
              <SelectItem value="expiring_soon">Expiring soon (7d)</SelectItem>
            </SelectContent>
          </Select>
          <div className="text-xs text-muted-foreground self-center">{total} code(s)</div>
        </div>
      </Card>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr className="text-left">
              <th className="p-2">Code</th>
              <th className="p-2">Internal name</th>
              <th className="p-2">Category</th>
              <th className="p-2">Discount</th>
              <th className="p-2">Pairing</th>
              <th className="p-2">Status</th>
              <th className="p-2">Expires</th>
              <th className="p-2">Stripe</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {q.isLoading ? (
              <tr><td className="p-4 text-muted-foreground" colSpan={9}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td className="p-4 text-muted-foreground" colSpan={9}>No codes match these filters.</td></tr>
            ) : rows.map((c) => (
              <tr key={c.id} className="border-t align-top">
                <td className="p-2"><span className="font-mono font-bold">{c.public_code}</span></td>
                <td className="p-2">{c.internal_name}</td>
                <td className="p-2"><Badge variant="outline">{CATEGORY_LABELS[c.category] ?? c.category}</Badge></td>
                <td className="p-2">{fmtDiscount(c)}</td>
                <td className="p-2 text-xs">
                  {c.pairing_allowed
                    ? <span className="text-emerald-600">Pairable{c.pairable_category ? ` w/ ${CATEGORY_LABELS[c.pairable_category]}` : ""}</span>
                    : <span className="text-muted-foreground">Solo only</span>}
                </td>
                <td className="p-2">
                  <Badge variant="outline" className={STATUS_TONE[c.status]}>{c.status}</Badge>
                </td>
                <td className="p-2 text-xs">
                  {c.expires_at ? (
                    <div>
                      <div>{new Date(c.expires_at).toLocaleString()}</div>
                      <div className="text-muted-foreground">{timeRemaining(c.expires_at)}</div>
                    </div>
                  ) : <span className="text-muted-foreground">No expiration</span>}
                </td>
                <td className="p-2 text-xs">
                  <div className={c.stripe_test_mode_synced ? "text-emerald-600" : "text-muted-foreground"}>
                    Test: {c.stripe_test_mode_synced ? "✓ synced" : "—"}
                  </div>
                  <div className={c.stripe_live_mode_synced ? "text-emerald-600" : "text-muted-foreground"}>
                    Live: {c.stripe_live_mode_synced ? "✓ synced" : "—"}
                  </div>
                  {c.stripe_last_sync_error ? (
                    <div className="text-rose-600 truncate max-w-[14rem]" title={c.stripe_last_sync_error}>
                      ⚠ {c.stripe_last_sync_error}
                    </div>
                  ) : null}
                </td>
                <td className="p-2">
                  <div className="flex flex-wrap gap-1">
                    <Button size="sm" variant="ghost" title="Edit" onClick={() => setEditing(c)}>
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button size="sm" variant="ghost" title="Copy code" onClick={() => copy(c.public_code)}>
                      <Copy className="h-3 w-3" />
                    </Button>
                    <Button size="sm" variant="ghost" title="Copy link" onClick={() => copy(linkFor(c))}>
                      <Link2 className="h-3 w-3" />
                    </Button>
                    <Button size="sm" variant="ghost" title="Sync to Stripe (test + live)"
                      onClick={async () => {
                        const t = toast.loading(`Syncing ${c.public_code} to Stripe…`);
                        try {
                          const res: any = await syncFn({ data: { id: c.id, modes: ["test", "live"] } });
                          toast.dismiss(t);
                          if (res?.ok) toast.success(`${c.public_code} synced to Stripe (test + live)`);
                          else {
                            const errs = (res?.results ?? []).filter((r: any) => !r.ok)
                              .map((r: any) => `${r.mode}: ${r.error}`).join(" • ");
                            toast.error(`Sync completed with issues — ${errs || "see code row for details"}`);
                          }
                          qc.invalidateQueries({ queryKey: ["discount-codes"] });
                        } catch (e: any) {
                          toast.dismiss(t);
                          toast.error(e?.message ?? "Sync failed");
                        }
                      }}>
                      <RefreshCw className="h-3 w-3 text-sky-600" />
                    </Button>
                    {c.status !== "active" && (
                      <Button size="sm" variant="ghost" title="Activate"
                        onClick={() => setConfirmAction({ code: c, next: "active" })}>
                        <Play className="h-3 w-3 text-emerald-600" />
                      </Button>
                    )}
                    {c.status === "active" && (
                      <Button size="sm" variant="ghost" title="Pause"
                        onClick={() => setConfirmAction({ code: c, next: "paused" })}>
                        <Pause className="h-3 w-3 text-amber-600" />
                      </Button>
                    )}
                    {c.status !== "expired" && (
                      <Button size="sm" variant="ghost" title="Expire immediately"
                        onClick={() => setConfirmAction({ code: c, next: "expired" })}>
                        <Square className="h-3 w-3 text-rose-600" />
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {total > 25 && (
        <div className="flex justify-between items-center">
          <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Prev</Button>
          <div className="text-xs text-muted-foreground">Page {page} of {Math.ceil(total / 25)}</div>
          <Button variant="outline" size="sm" disabled={page * 25 >= total} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      )}

      {(creating || editing) && (
        <DiscountCodeForm
          initial={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { refetch(); setCreating(false); setEditing(null); }}
          upsertFn={upsertFn as any}
        />
      )}

      <AlertDialog open={!!confirmAction} onOpenChange={(o) => !o && setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction?.next === "active" ? "Activate code?" :
               confirmAction?.next === "paused" ? "Pause code?" : "Expire code immediately?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction?.code.public_code}
              {confirmAction?.next === "active" && !confirmAction.code.expires_at &&
                " — This code has no expiration date."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmAction && setStatusM.mutate({ id: confirmAction.code.id, status: confirmAction.next })}
              disabled={setStatusM.isPending}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function DiscountCodeForm({
  initial, onClose, onSaved, upsertFn,
}: {
  initial: DiscountCode | null;
  onClose: () => void;
  onSaved: () => void;
  upsertFn: (args: { data: any }) => Promise<any>;
}) {
  const [form, setForm] = useState<any>(() => initial ?? {
    internal_name: "",
    public_code: "",
    category: "promotion",
    description: "",
    discount_type: "percentage",
    discount_value: 10,
    subscription_duration: "once",
    duration_months: null,
    eligible_product_ids: [],
    applies_to_all_products: false,
    new_customers_only: false,
    existing_customers_only: false,
    min_purchase_cents: null,
    start_at: null,
    expires_at: null,
    time_zone: "America/Winnipeg",
    status: "draft",
    total_usage_limit: null,
    per_customer_limit: 1,
    pairing_allowed: false,
    pairable_category: null,
    max_promo_codes: 1,
    max_referral_codes: 1,
    max_total_codes: 2,
  });

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: () => {
      const payload: any = { ...form };
      if (initial) payload.id = initial.id;
      // Coerce empties
      ["min_purchase_cents", "total_usage_limit", "per_customer_limit", "duration_months"].forEach((k) => {
        if (payload[k] === "" || payload[k] === undefined) payload[k] = null;
        else if (payload[k] !== null) payload[k] = Number(payload[k]);
      });
      payload.discount_value = Number(payload.discount_value);
      if (!payload.description) payload.description = null;
      if (!payload.start_at) payload.start_at = null;
      if (!payload.expires_at) payload.expires_at = null;
      if (!payload.linked_ambassador_id) payload.linked_ambassador_id = null;
      if (!payload.linked_client_id) payload.linked_client_id = null;
      if (!payload.pairable_category) payload.pairable_category = null;
      return upsertFn({ data: payload });
    },
    onSuccess: () => { toast.success(initial ? "Code updated" : "Code created"); onSaved(); },
    onError: (e: any) => toast.error(e?.message ?? "Save failed"),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit discount code" : "Create discount code"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <section className="space-y-3">
            <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Basic information</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label>Internal name *</Label>
                <Input value={form.internal_name} onChange={(e) => set("internal_name", e.target.value)} />
              </div>
              <div>
                <Label>Public code *</Label>
                <Input value={form.public_code} onChange={(e) => set("public_code", e.target.value.toUpperCase())} className="font-mono" />
              </div>
              <div>
                <Label>Category *</Label>
                <Select value={form.category} onValueChange={(v) => set("category", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="promotion">Promotion</SelectItem>
                    <SelectItem value="ambassador">Ambassador</SelectItem>
                    <SelectItem value="client_referral">Client Referral</SelectItem>
                    <SelectItem value="retention">Retention</SelectItem>
                    <SelectItem value="manual">Manual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => set("status", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="scheduled">Scheduled</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="paused">Paused</SelectItem>
                    <SelectItem value="expired">Expired</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-2">
                <Label>Description</Label>
                <Textarea value={form.description ?? ""} onChange={(e) => set("description", e.target.value)} rows={2} />
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Discount</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <Label>Type</Label>
                <Select value={form.discount_type} onValueChange={(v) => set("discount_type", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percentage">Percentage</SelectItem>
                    <SelectItem value="fixed">Fixed amount</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Value</Label>
                <Input type="number" value={form.discount_value} onChange={(e) => set("discount_value", e.target.value)} />
              </div>
              <div>
                <Label>Subscription duration</Label>
                <Select value={form.subscription_duration} onValueChange={(v) => set("subscription_duration", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="once">First payment only</SelectItem>
                    <SelectItem value="repeating">Specific number of months</SelectItem>
                    <SelectItem value="forever">Entire active subscription</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.subscription_duration === "repeating" && (
                <div>
                  <Label>Months</Label>
                  <Input type="number" min="1" value={form.duration_months ?? ""}
                    onChange={(e) => set("duration_months", e.target.value ? Number(e.target.value) : null)} />
                </div>
              )}
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Eligibility</h3>
            <div className="flex items-center gap-3">
              <Switch checked={form.applies_to_all_products} onCheckedChange={(v) => set("applies_to_all_products", v)} />
              <Label>Applies to all products (otherwise, list product IDs below)</Label>
            </div>
            {!form.applies_to_all_products && (
              <div>
                <Label>Eligible product IDs (comma-separated UUIDs)</Label>
                <Input
                  value={(form.eligible_product_ids ?? []).join(", ")}
                  onChange={(e) => set("eligible_product_ids", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
                  className="font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground mt-1">Leave empty + "Applies to all" off to require admin selection later.</p>
              </div>
            )}
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Switch checked={form.new_customers_only} onCheckedChange={(v) => set("new_customers_only", v)} />
                <Label>New customers only</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={form.existing_customers_only} onCheckedChange={(v) => set("existing_customers_only", v)} />
                <Label>Existing customers only</Label>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <Label>Min purchase (cents)</Label>
                <Input type="number" value={form.min_purchase_cents ?? ""} onChange={(e) => set("min_purchase_cents", e.target.value)} />
              </div>
              <div>
                <Label>Total usage limit</Label>
                <Input type="number" value={form.total_usage_limit ?? ""} onChange={(e) => set("total_usage_limit", e.target.value)} />
              </div>
              <div>
                <Label>Per-customer limit</Label>
                <Input type="number" value={form.per_customer_limit ?? ""} onChange={(e) => set("per_customer_limit", e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <Label>Start at</Label>
                <Input type="datetime-local" value={form.start_at ? form.start_at.slice(0, 16) : ""}
                  onChange={(e) => set("start_at", e.target.value ? new Date(e.target.value).toISOString() : null)} />
              </div>
              <div>
                <Label>Expiration</Label>
                <Input type="datetime-local" value={form.expires_at ? form.expires_at.slice(0, 16) : ""}
                  onChange={(e) => set("expires_at", e.target.value ? new Date(e.target.value).toISOString() : null)} />
                <p className="mt-1 text-xs text-muted-foreground">Optional — leave blank for no expiration.</p>
              </div>
              <div>
                <Label>Time zone</Label>
                <Input value={form.time_zone} onChange={(e) => set("time_zone", e.target.value)} />
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Pairing</h3>
            <div className="flex items-center gap-2">
              <Switch checked={form.pairing_allowed} onCheckedChange={(v) => set("pairing_allowed", v)} />
              <Label>Allow pairing with another code</Label>
            </div>
            {form.pairing_allowed && (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div>
                  <Label>Pairable category</Label>
                  <Select value={form.pairable_category ?? "any"} onValueChange={(v) => set("pairable_category", v === "any" ? null : v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Any</SelectItem>
                      <SelectItem value="promotion">Promotion</SelectItem>
                      <SelectItem value="ambassador">Ambassador</SelectItem>
                      <SelectItem value="client_referral">Client Referral</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Max promo codes</Label>
                  <Input type="number" value={form.max_promo_codes} onChange={(e) => set("max_promo_codes", Number(e.target.value))} />
                </div>
                <div>
                  <Label>Max referral codes</Label>
                  <Input type="number" value={form.max_referral_codes} onChange={(e) => set("max_referral_codes", Number(e.target.value))} />
                </div>
                <div>
                  <Label>Max total codes</Label>
                  <Input type="number" value={form.max_total_codes} onChange={(e) => set("max_total_codes", Number(e.target.value))} />
                </div>
              </div>
            )}
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving…" : initial ? "Save changes" : "Create code"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Re-export for sales tab embedding
export default DiscountCodesPage;