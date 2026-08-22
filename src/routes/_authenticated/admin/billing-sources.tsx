import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listClientsWithBillingFn,
  setClientBillingSourceFn,
  inviteLegacyClientFn,
  getBillingDashboardFn,
} from "@/lib/billing-sources.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { CreditCard, ShieldAlert, Plus, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/billing-sources")({
  component: BillingSourcesPage,
  head: () => ({
    meta: [
      { title: "Billing Sources & Legacy Migration · Admin · JF Effect" },
      { name: "description", content: "Manage dual billing sources and legacy Trainerize client migration into the JF Effect app." },
    ],
  }),
});

const SOURCE_LABEL: Record<string, string> = {
  trainerize_legacy: "Legacy — JF Effect Trainerize",
  jfeffect_stripe: "JF Effect Stripe",
  manual_external: "External / Manually Managed",
  complimentary: "Complimentary Access",
  none: "No Billing Connected",
};

const SOURCE_TONE: Record<string, string> = {
  trainerize_legacy: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  jfeffect_stripe: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  manual_external: "bg-sky-500/10 text-sky-700 border-sky-500/30",
  complimentary: "bg-purple-500/10 text-purple-700 border-purple-500/30",
  none: "bg-muted text-muted-foreground",
};

const STATUS_TONE: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  paused: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  past_due: "bg-rose-500/10 text-rose-700 border-rose-500/30",
  ending: "bg-orange-500/10 text-orange-700 border-orange-500/30",
  ended: "bg-muted text-muted-foreground",
};

function fmtMoney(cents?: number | null, currency?: string | null) {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: (currency ?? "usd").toUpperCase(),
  }).format(cents / 100);
}

function BillingSourceBadge({ source }: { source: string }) {
  return (
    <Badge variant="outline" className={SOURCE_TONE[source] ?? ""}>
      {SOURCE_LABEL[source] ?? source}
    </Badge>
  );
}

export function BillingSourcesPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listClientsWithBillingFn);
  const dashFn = useServerFn(getBillingDashboardFn);

  const [billingFilter, setBillingFilter] = useState<string>("all");
  const [accessFilter, setAccessFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editClient, setEditClient] = useState<any | null>(null);

  const dash = useQuery({
    queryKey: ["billing-dashboard"],
    queryFn: () => dashFn(),
  });

  const list = useQuery({
    queryKey: ["clients-billing", billingFilter, accessFilter, search],
    queryFn: () =>
      listFn({
        data: {
          billingSource: billingFilter as any,
          accessStatus: accessFilter as any,
          search,
        },
      }),
  });

  const counts = dash.data?.source_counts ?? {};

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6 max-w-7xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CreditCard className="h-6 w-6" /> Billing Sources &amp; Legacy Migration
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Separate <strong>who collects the money</strong> from <strong>who can use the app</strong>.
            Trainerize Legacy clients keep their existing billing untouched.
          </p>
        </div>
        <Button onClick={() => setInviteOpen(true)}>
          <Plus className="h-4 w-4 mr-2" /> Add Existing Legacy Client
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {(["jfeffect_stripe", "trainerize_legacy", "manual_external", "complimentary", "none"] as const).map(k => (
          <Card key={k} className="p-3">
            <div className="text-xs text-muted-foreground">{SOURCE_LABEL[k]}</div>
            <div className="text-2xl font-bold mt-1">{counts[k] ?? 0}</div>
          </Card>
        ))}
      </div>

      <Card className="p-4 border-amber-500/30 bg-amber-50/40 dark:bg-amber-900/10">
        <div className="flex items-start gap-3">
          <ShieldAlert className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <div className="font-medium">Legacy revenue is estimated, not Stripe-verified</div>
            <div className="text-muted-foreground mt-1">
              Trainerize billing is recorded manually. {dash.data?.legacy?.active_count ?? 0} active legacy
              records · estimated total {fmtMoney(dash.data?.legacy?.total_cents_estimated ?? 0, "usd")} per
              cycle. Never combine with verified JF Effect Stripe revenue without this label.
            </div>
          </div>
        </div>
      </Card>

      {/* Filters */}
      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <Label className="text-xs">Search</Label>
            <Input
              placeholder="Name or email"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs">Billing Source</Label>
            <Select value={billingFilter} onValueChange={setBillingFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Billing Sources</SelectItem>
                <SelectItem value="trainerize_legacy">Trainerize Legacy</SelectItem>
                <SelectItem value="jfeffect_stripe">JF Effect Stripe</SelectItem>
                <SelectItem value="manual_external">External</SelectItem>
                <SelectItem value="complimentary">Complimentary</SelectItem>
                <SelectItem value="none">Missing Billing Source</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Access Status</Label>
            <Select value={accessFilter} onValueChange={setAccessFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Access</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="paused">Paused</SelectItem>
                <SelectItem value="past_due">Past Due</SelectItem>
                <SelectItem value="ending">Ending</SelectItem>
                <SelectItem value="ended">Ended</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button variant="outline" onClick={() => { list.refetch(); dash.refetch(); }}>
              <RefreshCw className="h-4 w-4 mr-2" /> Refresh
            </Button>
          </div>
        </div>
      </Card>

      {/* Table */}
      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="p-3">Client</th>
                <th className="p-3">Billing Source</th>
                <th className="p-3">App Access</th>
                <th className="p-3">Legacy Plan</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {list.isLoading && (
                <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">Loading…</td></tr>
              )}
              {!list.isLoading && (list.data?.clients ?? []).length === 0 && (
                <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No clients match those filters.</td></tr>
              )}
              {(list.data?.clients ?? []).map((c: any) => {
                const activeEnt = c.entitlements.find((e: any) => e.status === "active") ?? c.entitlements[0];
                return (
                  <tr key={c.id} className="border-t">
                    <td className="p-3">
                      <div className="font-medium">{c.full_name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{c.email ?? "—"}</div>
                    </td>
                    <td className="p-3">
                      <BillingSourceBadge source={c.billing_source ?? "none"} />
                      {c.billing_source_locked && (
                        <div className="text-[10px] text-amber-700 mt-1">Locked</div>
                      )}
                    </td>
                    <td className="p-3">
                      {activeEnt ? (
                        <Badge variant="outline" className={STATUS_TONE[activeEnt.status] ?? ""}>
                          {activeEnt.status} · {activeEnt.access_source.replace(/_/g, " ")}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">No entitlement</span>
                      )}
                    </td>
                    <td className="p-3 text-xs">
                      {c.legacy_billing ? (
                        <div>
                          <div>{c.legacy_billing.plan_name ?? "—"}</div>
                          <div className="text-muted-foreground">
                            {fmtMoney(c.legacy_billing.amount_cents, c.legacy_billing.currency)}
                            {c.legacy_billing.billing_interval ? ` / ${c.legacy_billing.billing_interval}` : ""}
                          </div>
                        </div>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="p-3 text-right">
                      <Button size="sm" variant="outline" onClick={() => setEditClient(c)}>
                        Manage
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <InviteLegacyDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["clients-billing"] });
          qc.invalidateQueries({ queryKey: ["billing-dashboard"] });
        }}
      />

      <ManageBillingDialog
        client={editClient}
        onClose={() => setEditClient(null)}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["clients-billing"] });
          qc.invalidateQueries({ queryKey: ["billing-dashboard"] });
        }}
      />
    </div>
  );
}

/* ─────────────────── Invite Legacy Client Dialog ─────────────────── */

function InviteLegacyDialog({
  open, onClose, onSaved,
}: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const inviteFn = useServerFn(inviteLegacyClientFn);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [tier, setTier] = useState("");
  const [planName, setPlanName] = useState("");
  const [amount, setAmount] = useState("");
  const [interval, setInterval] = useState("month");
  const [trainerizeRef, setTrainerizeRef] = useState("");
  const [notes, setNotes] = useState("");

  const m = useMutation({
    mutationFn: () =>
      inviteFn({
        data: {
          full_name: name.trim(),
          email: email.trim(),
          phone: phone || null,
          accessTier: tier || null,
          legacyBilling: planName || amount || trainerizeRef ? {
            plan_name: planName || null,
            amount_cents: amount ? Math.round(parseFloat(amount) * 100) : null,
            currency: "usd",
            billing_interval: interval || null,
            trainerize_customer_ref: trainerizeRef || null,
            status: "active",
            notes: notes || null,
          } : null,
        },
      }),
    onSuccess: () => {
      toast.success("Legacy client added with app access. No new charge created.");
      onSaved();
      onClose();
      setName(""); setEmail(""); setPhone(""); setTier(""); setPlanName(""); setAmount(""); setTrainerizeRef(""); setNotes("");
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Existing Legacy Client</DialogTitle>
          <DialogDescription>
            This client will receive coaching through the JF Effect app while their existing
            payment remains managed through JF Effect Trainerize. <strong>No new subscription
            or charge will be created.</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Full name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <div><Label>Phone</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
            <div><Label>Coaching tier</Label><Input value={tier} onChange={(e) => setTier(e.target.value)} placeholder="e.g. 1:1, Hybrid" /></div>
          </div>

          <div className="border-t pt-4">
            <div className="font-medium text-sm mb-2">Optional legacy billing reference</div>
            <p className="text-xs text-muted-foreground mb-3">
              Never enter card numbers, CVCs, or payment credentials. References only.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Plan name</Label><Input value={planName} onChange={(e) => setPlanName(e.target.value)} /></div>
              <div><Label>Amount (USD)</Label><Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="299.00" /></div>
              <div>
                <Label>Interval</Label>
                <Select value={interval} onValueChange={setInterval}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="week">Weekly</SelectItem>
                    <SelectItem value="biweekly">Bi-weekly (every 2 weeks)</SelectItem>
                    <SelectItem value="month">Monthly</SelectItem>
                    <SelectItem value="quarter">Quarterly</SelectItem>
                    <SelectItem value="year">Yearly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Trainerize customer ref</Label><Input value={trainerizeRef} onChange={(e) => setTrainerizeRef(e.target.value)} /></div>
            </div>
            <div className="mt-3"><Label>Internal billing notes</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => m.mutate()} disabled={!name || !email || m.isPending}>
            {m.isPending ? "Saving…" : "Add Legacy Client"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────────────── Manage Billing Dialog (per-client) ─────────────────── */

function ManageBillingDialog({
  client, onClose, onSaved,
}: { client: any | null; onClose: () => void; onSaved: () => void }) {
  const setSourceFn = useServerFn(setClientBillingSourceFn);
  const [source, setSource] = useState<string>(client?.billing_source ?? "none");
  const [lock, setLock] = useState<boolean>(!!client?.billing_source_locked);

  // Sync when client changes
  if (client && source !== client.billing_source && source === "none") {
    setSource(client.billing_source ?? "none");
    setLock(!!client.billing_source_locked);
  }

  const m = useMutation({
    mutationFn: () =>
      setSourceFn({ data: { clientId: client.id, billingSource: source as any, lock } }),
    onSuccess: () => {
      toast.success("Billing source updated");
      onSaved();
      onClose();
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  if (!client) return null;
  return (
    <Dialog open={!!client} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Billing &amp; Access — {client.full_name ?? client.email}</DialogTitle>
          <DialogDescription>
            Changing a locked Trainerize Legacy client requires a completed migration review.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Billing source</Label>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="trainerize_legacy">Legacy — JF Effect Trainerize</SelectItem>
                <SelectItem value="jfeffect_stripe">JF Effect Stripe</SelectItem>
                <SelectItem value="manual_external">External / Manually Managed</SelectItem>
                <SelectItem value="complimentary">Complimentary Access</SelectItem>
                <SelectItem value="none">No Billing Connected</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} />
            Lock this source (prevents accidental changes; required for legacy clients)
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => m.mutate()} disabled={m.isPending}>
            {m.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
