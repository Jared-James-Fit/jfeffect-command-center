import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Gift } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import {
  listSessionCreditPackages,
  createSessionCreditPackage,
  updateSessionCreditPackage,
  deleteSessionCreditPackage,
  grantSessionCreditPackage,
  getClientSessionCredits,
  adjustSessionCredits,
  addClientSessionCredits,
  updateSessionLedgerEvent,
  deleteSessionLedgerEvent,
} from "@/lib/session-credit-packages.functions";

function fmt(amountMinor: number | null | undefined, currency = "CAD") {
  if (amountMinor === null || amountMinor === undefined) return "—";
  return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(
    Number(amountMinor) / 100,
  );
}

export function SessionCreditsPanel({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listSessionCreditPackages);
  const summaryFn = useServerFn(getClientSessionCredits);

  const packagesQ = useQuery({
    queryKey: ["session-credit-packages"],
    queryFn: () => listFn(),
  });
  const summaryQ = useQuery({
    queryKey: ["client-session-credits", clientId],
    queryFn: () => summaryFn({ data: { client_id: clientId } }),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["client-session-credits", clientId] });
    qc.invalidateQueries({ queryKey: ["client-billing", clientId] });
  };
  const invalidatePackages = () =>
    qc.invalidateQueries({ queryKey: ["session-credit-packages"] });

  // Realtime sync across admin/coach devices
  useEffect(() => {
    const ch = supabase
      .channel(`session-credits-${clientId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "session_ledger_events", filter: `client_id=eq.${clientId}` },
        () => invalidate(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "session_credit_packages" },
        () => invalidatePackages(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const balance = (summaryQ.data?.balance ?? []) as any[];
  const totalRemaining = balance.reduce(
    (s, b) => s + Number(b.remaining ?? b.balance ?? 0),
    0,
  );
  const totalScheduled = balance.reduce((s, b) => s + Number(b.reserved ?? 0), 0);
  const events = (summaryQ.data?.events ?? []) as any[];
  const appointments = (summaryQ.data?.appointments ?? {}) as Record<string, any>;
  const granted = events
    .filter((e) => e.event_type === "granted")
    .reduce((s, e) => s + Number(e.session_count ?? 0), 0);
  const used = events
    .filter((e) => e.event_type === "used" || e.event_type === "consumed")
    .reduce((s, e) => s + Math.abs(Number(e.session_count ?? 0)), 0);

  const packages = (packagesQ.data?.packages ?? []) as any[];
  const activePackages = packages.filter((p) => p.active);

  // Build per-grant package rows with FIFO attribution of usage/expiry/adjustments.
  const grants = events
    .filter((e) => e.event_type === "granted" && Number(e.session_count) > 0)
    .slice()
    .sort((a, b) => {
      const da = (a.effective_date ?? "") + (a.created_at ?? "");
      const db = (b.effective_date ?? "") + (b.created_at ?? "");
      return da.localeCompare(db); // oldest first for FIFO
    })
    .map((g) => ({
      id: g.id,
      effective_date: g.effective_date,
      expires_at: g.expires_at,
      currency: g.currency ?? "CAD",
      unit_value_minor: Number(g.unit_value_minor ?? 0),
      total_sessions: Number(g.session_count ?? 0),
      used: 0,
      adjusted: 0,
      note: g.note ?? "",
      service_type:
        (g.note ?? "").replace(/^Granted package:\s*/i, "").trim() || "Session package",
      source: g.source ?? "",
    }));

  // FIFO allocate any negative (used/consumed/adjusted) events across grants.
  const consumptions = events
    .filter(
      (e) =>
        e.event_type === "used" ||
        e.event_type === "consumed" ||
        (e.event_type === "adjusted" && Number(e.session_count) < 0),
    )
    .map((e) => Math.abs(Number(e.session_count ?? 0)));
  let pool = consumptions.reduce((s, n) => s + n, 0);
  for (const g of grants) {
    if (pool <= 0) break;
    const take = Math.min(pool, g.total_sessions);
    g.used = take;
    pool -= take;
  }

  const today = new Date().toISOString().slice(0, 10);
  const grantRows = grants.map((g) => {
    const remaining = Math.max(0, g.total_sessions - g.used);
    const expired = !!g.expires_at && g.expires_at < today;
    const status: "Active" | "Expired" | "Depleted" = expired
      ? "Expired"
      : remaining === 0
        ? "Depleted"
        : "Active";
    return { ...g, remaining, value_remaining_minor: remaining * g.unit_value_minor, status };
  });
  // newest first for display
  grantRows.reverse();

  return (
    <Card className="border-border bg-card p-6 md:col-span-3 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground">
            Session Credits
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Grant reusable session bundles and track this client's remaining balance.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <AddCreditsDialog clientId={clientId} onDone={invalidate} />
          <GrantPackageDialog
            clientId={clientId}
            packages={activePackages}
            onDone={invalidate}
          />
          <AdjustDialog clientId={clientId} onDone={invalidate} />
          <ManagePackagesDialog
            packages={packages}
            onChanged={invalidatePackages}
          />
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid gap-3 md:grid-cols-4">
        <Tile label="Available" value={String(totalRemaining)} highlight={totalRemaining > 0} />
        <Tile label="Scheduled / Reserved" value={String(totalScheduled)} />
        <Tile label="Granted (lifetime)" value={String(granted)} />
        <Tile label="Used (lifetime)" value={String(used)} />
      </div>

      {/* Balance breakdown */}
      {balance.length > 0 && (
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
            Balance by currency
          </div>
          <div className="overflow-x-auto rounded border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase">
                <tr>
                  <th className="p-2 text-left">Currency</th>
                  <th className="p-2 text-right">Remaining</th>
                  <th className="p-2 text-right">Granted</th>
                  <th className="p-2 text-right">Used</th>
                  <th className="p-2 text-right">Expired</th>
                </tr>
              </thead>
              <tbody>
                {balance.map((b: any, i: number) => (
                  <tr key={i} className="border-t border-border">
                    <td className="p-2">{b.currency ?? "—"}</td>
                    <td className="p-2 text-right font-mono">{b.remaining ?? b.balance ?? 0}</td>
                    <td className="p-2 text-right font-mono">{b.granted ?? "—"}</td>
                    <td className="p-2 text-right font-mono">{b.used ?? b.consumed ?? "—"}</td>
                    <td className="p-2 text-right font-mono">{b.expired ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Active package grants */}
      <div>
        <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
          Packages granted
        </div>
        {grantRows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            No session packages granted yet. Use "Grant package" to add one.
          </p>
        ) : (
          <div className="overflow-x-auto rounded border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase">
                <tr>
                  <th className="p-2 text-left">Service</th>
                  <th className="p-2 text-left">Granted</th>
                  <th className="p-2 text-left">Expires</th>
                  <th className="p-2 text-right">Total</th>
                  <th className="p-2 text-right">Used</th>
                  <th className="p-2 text-right">Remaining</th>
                  <th className="p-2 text-right">Cost / session</th>
                  <th className="p-2 text-right">Value remaining</th>
                  <th className="p-2 text-left">Payment note</th>
                  <th className="p-2 text-left">Status</th>
                  <th className="p-2 text-right" />
                </tr>
              </thead>
              <tbody>
                {grantRows.map((g) => (
                  <GrantRow key={g.id} g={g} onChanged={invalidate} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Event history */}
      <LedgerHistory events={events} appointments={appointments} onChanged={invalidate} />
    </Card>
  );
}

function GrantRow({ g, onChanged }: { g: any; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const delFn = useServerFn(deleteSessionLedgerEvent);
  const delM = useMutation({
    mutationFn: async () => delFn({ data: { id: g.id } }),
    onSuccess: () => {
      toast.success("Package removed");
      onChanged();
    },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <>
      <tr className="border-t border-border align-top">
                    <td className="p-2 font-medium">{g.service_type}</td>
                    <td className="p-2 text-xs">{g.effective_date ?? "—"}</td>
                    <td className="p-2 text-xs">{g.expires_at ?? "—"}</td>
                    <td className="p-2 text-right font-mono">{g.total_sessions}</td>
                    <td className="p-2 text-right font-mono">{g.used}</td>
                    <td className="p-2 text-right font-mono">{g.remaining}</td>
                    <td className="p-2 text-right font-mono">
                      {fmt(g.unit_value_minor, g.currency)}
                    </td>
                    <td className="p-2 text-right font-mono">
                      {fmt(g.value_remaining_minor, g.currency)}
                    </td>
                    <td className="p-2 text-xs text-muted-foreground max-w-[16rem] truncate">
                      {g.note}
                    </td>
                    <td className="p-2">
                      <Badge
                        variant={
                          g.status === "Active"
                            ? "default"
                            : g.status === "Expired"
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        {g.status}
                      </Badge>
                    </td>
        <td className="p-2 text-right whitespace-nowrap">
          <Button size="icon" variant="ghost" onClick={() => setEditing(true)} title="Edit">
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="text-destructive"
            onClick={() => {
              if (confirm(`Remove this granted package (${g.total_sessions} sessions)?`)) {
                delM.mutate();
              }
            }}
            title="Delete grant"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </td>
      </tr>
      <EditLedgerEventDialog
        event={editing ? { ...g, session_count: g.total_sessions } : null}
        onClose={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          onChanged();
        }}
      />
    </>
  );
}

function LedgerHistory({
  events,
  appointments,
  onChanged,
}: {
  events: any[];
  appointments: Record<string, any>;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const delFn = useServerFn(deleteSessionLedgerEvent);
  const delM = useMutation({
    mutationFn: async (id: string) => delFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Ledger entry deleted");
      onChanged();
    },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between rounded border border-border bg-muted/30 px-3 py-2 text-left hover:bg-muted/50"
        >
          <span className="text-xs uppercase tracking-widest text-muted-foreground">
            Ledger history ({events.length})
          </span>
          <ChevronDown
            className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-3">
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            No session credit activity yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase">
                <tr>
                  <th className="p-2 text-left">Date</th>
                  <th className="p-2 text-left">Change type</th>
                  <th className="p-2 text-right">Sessions Δ</th>
                  <th className="p-2 text-right">Value Δ</th>
                  <th className="p-2 text-left">Appointment</th>
                  <th className="p-2 text-left">Note</th>
                  <th className="p-2 text-right" />
                </tr>
              </thead>
              <tbody>
                {events.map((e) => {
                  const sessions = Number(e.session_count ?? 0);
                  const unit = Number(e.unit_value_minor ?? 0);
                  const valueDelta = sessions * unit;
                  const appt = e.appointment_id ? appointments[e.appointment_id] : null;
                  return (
                    <tr key={e.id} className="border-t border-border align-top">
                      <td className="p-2 text-xs whitespace-nowrap">
                        {e.effective_date ?? "—"}
                      </td>
                      <td className="p-2 text-xs">
                        <Badge variant="outline" className="font-normal">
                          {ledgerEventLabel(e.event_type)}
                        </Badge>
                        {e.source ? (
                          <div className="text-[10px] text-muted-foreground mt-0.5">
                            {e.source}
                          </div>
                        ) : null}
                      </td>
                      <td
                        className={`p-2 text-right font-mono ${sessions < 0 ? "text-destructive" : sessions > 0 ? "text-primary" : ""}`}
                      >
                        {sessions > 0 ? `+${sessions}` : sessions}
                      </td>
                      <td
                        className={`p-2 text-right font-mono ${valueDelta < 0 ? "text-destructive" : ""}`}
                      >
                        {unit > 0 ? fmt(valueDelta, e.currency ?? "CAD") : "—"}
                      </td>
                      <td className="p-2 text-xs">
                        {appt ? (
                          <a
                            href={`/admin/appointments/${appt.id}`}
                            className="underline hover:no-underline"
                          >
                            {appt.title ?? "Appointment"}
                            {appt.scheduled_at ? (
                              <span className="block text-[10px] text-muted-foreground">
                                {new Date(appt.scheduled_at).toLocaleString()}
                              </span>
                            ) : null}
                          </a>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-2 text-xs text-muted-foreground max-w-[20rem]">
                        {e.note ?? ""}
                      </td>
                      <td className="p-2 text-right whitespace-nowrap">
                        <Button size="icon" variant="ghost" onClick={() => setEditing(e)} title="Edit">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() => {
                            if (confirm("Delete this ledger entry? This will change the client's balance.")) {
                              delM.mutate(e.id);
                            }
                          }}
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CollapsibleContent>
      <EditLedgerEventDialog
        event={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          onChanged();
        }}
      />
    </Collapsible>
  );
}

function EditLedgerEventDialog({
  event,
  onClose,
  onSaved,
}: {
  event: any | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const fn = useServerFn(updateSessionLedgerEvent);
  const [sessions, setSessions] = useState("");
  const [unit, setUnit] = useState("");
  const [eff, setEff] = useState("");
  const [exp, setExp] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => {
    if (!event) return;
    setSessions(String(event.session_count ?? ""));
    setUnit(
      event.unit_value_minor != null ? String(Number(event.unit_value_minor) / 100) : "",
    );
    setEff(event.effective_date ?? "");
    setExp(event.expires_at ?? "");
    setNote(event.note ?? "");
  }, [event]);
  const m = useMutation({
    mutationFn: async () => {
      const patch: any = { id: event.id };
      const sc = parseInt(sessions, 10);
      if (Number.isFinite(sc)) patch.session_count = sc;
      if (unit === "") patch.unit_value_minor = null;
      else if (Number.isFinite(parseFloat(unit)))
        patch.unit_value_minor = Math.round(parseFloat(unit) * 100);
      if (eff) patch.effective_date = eff;
      patch.expires_at = exp || null;
      patch.note = note || null;
      return fn({ data: patch });
    },
    onSuccess: () => {
      toast.success("Ledger entry updated");
      onSaved();
    },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <Dialog open={!!event} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit ledger entry</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Sessions Δ</Label>
              <Input type="number" value={sessions} onChange={(e) => setSessions(e.target.value)} />
            </div>
            <div>
              <Label>Unit value</Label>
              <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <Label>Effective date</Label>
              <Input type="date" value={eff} onChange={(e) => setEff(e.target.value)} />
            </div>
            <div>
              <Label>Expires</Label>
              <Input type="date" value={exp} onChange={(e) => setExp(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Note</Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={m.isPending}>Cancel</Button>
          <Button onClick={() => m.mutate()} disabled={m.isPending}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Tile({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <Card
      className={`p-4 ${highlight ? "border-primary/40 bg-primary/5" : ""}`}
    >
      <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </Card>
  );
}

const SERVICE_TYPES = [
  "In-Person Training",
  "Online Coaching",
  "Hybrid",
  "Nutrition",
  "Custom",
] as const;

function AddCreditsDialog({ clientId, onDone }: { clientId: string; onDone: () => void }) {
  const fn = useServerFn(addClientSessionCredits);
  const [open, setOpen] = useState(false);
  const [serviceType, setServiceType] = useState<string>("In-Person Training");
  const [customType, setCustomType] = useState("");
  const [sessions, setSessions] = useState("");
  const [cost, setCost] = useState("");
  const [currency, setCurrency] = useState("CAD");
  const [validity, setValidity] = useState("");
  const [note, setNote] = useState("");

  const sessionsNum = parseInt(sessions, 10);
  const costNum = parseFloat(cost);
  const totalValue =
    Number.isFinite(sessionsNum) && Number.isFinite(costNum)
      ? sessionsNum * costNum
      : 0;

  const effectiveType =
    serviceType === "Custom" ? customType.trim() : serviceType;

  const m = useMutation({
    mutationFn: async () =>
      fn({
        data: {
          client_id: clientId,
          service_type: effectiveType,
          session_count: sessionsNum,
          cost_per_session_minor: Math.round(costNum * 100),
          currency,
          validity_days: validity ? parseInt(validity, 10) : null,
          payment_note: note || null,
        },
      }),
    onSuccess: () => {
      toast.success("Credits added");
      setOpen(false);
      setSessions("");
      setCost("");
      setNote("");
      setCustomType("");
      setServiceType("In-Person Training");
      setValidity("");
      onDone();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const valid =
    !!effectiveType &&
    Number.isFinite(sessionsNum) &&
    sessionsNum > 0 &&
    Number.isFinite(costNum) &&
    costNum >= 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-2 h-4 w-4" />
          Add credits
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add session credits</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="mb-2 block">Service type</Label>
            <div className="flex flex-wrap gap-2">
              {SERVICE_TYPES.map((t) => (
                <Button
                  key={t}
                  type="button"
                  size="sm"
                  variant={serviceType === t ? "default" : "outline"}
                  onClick={() => setServiceType(t)}
                >
                  {t}
                </Button>
              ))}
            </div>
            {serviceType === "Custom" && (
              <Input
                className="mt-2"
                placeholder="Custom service name"
                value={customType}
                onChange={(e) => setCustomType(e.target.value)}
                maxLength={100}
              />
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Total sessions</Label>
              <Input
                type="number"
                min={1}
                step={1}
                value={sessions}
                onChange={(e) => setSessions(e.target.value)}
                placeholder="10"
              />
            </div>
            <div>
              <Label>Cost per session</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                placeholder="85.00"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["CAD", "USD", "EUR", "GBP", "AUD"].map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Validity (days, optional)</Label>
              <Input
                type="number"
                min={1}
                value={validity}
                onChange={(e) => setValidity(e.target.value)}
                placeholder="e.g. 90"
              />
            </div>
          </div>

          <div className="rounded border border-border bg-muted/30 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Total value: </span>
            <span className="font-mono font-semibold">
              {fmt(Math.round(totalValue * 100), currency)}
            </span>
          </div>

          <div>
            <Label>Payment note (optional)</Label>
            <Textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Paid by e-transfer, invoice #1234"
              maxLength={2000}
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => m.mutate()} disabled={!valid || m.isPending}>
            Add credits
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GrantPackageDialog({
  clientId,
  packages,
  onDone,
}: {
  clientId: string;
  packages: any[];
  onDone: () => void;
}) {
  const fn = useServerFn(grantSessionCreditPackage);
  const [open, setOpen] = useState(false);
  const [packageId, setPackageId] = useState<string>("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const m = useMutation({
    mutationFn: async () =>
      fn({
        data: {
          client_id: clientId,
          package_id: packageId,
          effective_date: date,
          note: note || undefined,
        },
      }),
    onSuccess: () => {
      toast.success("Sessions granted");
      setOpen(false);
      setPackageId("");
      setNote("");
      onDone();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={packages.length === 0}>
          <Gift className="mr-2 h-4 w-4" />
          Grant package
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Grant session credit package</DialogTitle>
        </DialogHeader>
        {packages.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No active packages. Create one with "Manage packages".
          </p>
        ) : (
          <div className="space-y-3">
            <div>
              <Label>Package</Label>
              <Select value={packageId} onValueChange={setPackageId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a package" />
                </SelectTrigger>
                <SelectContent>
                  {packages.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} · {p.session_count} sessions · {fmt(p.total_price_minor, p.currency)}
                      {p.validity_days ? ` · ${p.validity_days}d` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Effective date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <Label>Note (optional)</Label>
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button onClick={() => m.mutate()} disabled={!packageId || m.isPending}>
            Grant
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AdjustDialog({ clientId, onDone }: { clientId: string; onDone: () => void }) {
  const fn = useServerFn(adjustSessionCredits);
  const [open, setOpen] = useState(false);
  const [delta, setDelta] = useState("");
  const [note, setNote] = useState("");
  const m = useMutation({
    mutationFn: async () =>
      fn({
        data: { client_id: clientId, delta: parseInt(delta, 10), note },
      }),
    onSuccess: () => {
      toast.success("Balance adjusted");
      setOpen(false);
      setDelta("");
      setNote("");
      onDone();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Adjust
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Manual session credit adjustment</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Change (e.g. +1, -2)</Label>
            <Input
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
              placeholder="-1"
            />
          </div>
          <div>
            <Label>Reason</Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() => m.mutate()}
            disabled={!delta || !note || m.isPending || Number.isNaN(parseInt(delta, 10))}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ManagePackagesDialog({
  packages,
  onChanged,
}: {
  packages: any[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [showForm, setShowForm] = useState(false);
  const delFn = useServerFn(deleteSessionCreditPackage);
  const delM = useMutation({
    mutationFn: async (id: string) => delFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Package deleted");
      onChanged();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Manage packages
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Session credit packages</DialogTitle>
        </DialogHeader>
        {showForm || editing ? (
          <PackageForm
            initial={editing}
            onCancel={() => {
              setShowForm(false);
              setEditing(null);
            }}
            onSaved={() => {
              setShowForm(false);
              setEditing(null);
              onChanged();
            }}
          />
        ) : (
          <div className="space-y-3">
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setShowForm(true)}>
                <Plus className="mr-2 h-4 w-4" /> New package
              </Button>
            </div>
            {packages.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No packages yet.</p>
            ) : (
              <div className="overflow-x-auto rounded border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs uppercase">
                    <tr>
                      <th className="p-2 text-left">Name</th>
                      <th className="p-2 text-right">Sessions</th>
                      <th className="p-2 text-right">Price</th>
                      <th className="p-2 text-right">Validity</th>
                      <th className="p-2 text-left">Active</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {packages.map((p) => (
                      <tr key={p.id} className="border-t border-border">
                        <td className="p-2 font-medium">{p.name}</td>
                        <td className="p-2 text-right font-mono">{p.session_count}</td>
                        <td className="p-2 text-right font-mono">
                          {fmt(p.total_price_minor, p.currency)}
                        </td>
                        <td className="p-2 text-right">
                          {p.validity_days ? `${p.validity_days}d` : "—"}
                        </td>
                        <td className="p-2">{p.active ? "Yes" : "No"}</td>
                        <td className="p-2 text-right space-x-1">
                          <Button size="icon" variant="ghost" onClick={() => setEditing(p)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => {
                              if (confirm(`Delete "${p.name}"?`)) delM.mutate(p.id);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PackageForm({
  initial,
  onCancel,
  onSaved,
}: {
  initial: any | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const createFn = useServerFn(createSessionCreditPackage);
  const updateFn = useServerFn(updateSessionCreditPackage);
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [sessionCount, setSessionCount] = useState<string>(
    String(initial?.session_count ?? ""),
  );
  const [totalPrice, setTotalPrice] = useState<string>(
    initial ? String(Number(initial.total_price_minor) / 100) : "",
  );
  const [currency, setCurrency] = useState(initial?.currency ?? "CAD");
  const [validity, setValidity] = useState<string>(
    initial?.validity_days ? String(initial.validity_days) : "",
  );
  const [active, setActive] = useState<boolean>(initial?.active ?? true);
  const [sortOrder, setSortOrder] = useState<string>(String(initial?.sort_order ?? 0));

  const m = useMutation({
    mutationFn: async () => {
      const sc = parseInt(sessionCount, 10);
      const tp = Math.round(parseFloat(totalPrice) * 100);
      const payload = {
        name: name.trim(),
        description: description || null,
        session_count: sc,
        unit_price_minor: sc > 0 ? Math.round(tp / sc) : 0,
        total_price_minor: tp,
        currency,
        validity_days: validity ? parseInt(validity, 10) : null,
        active,
        sort_order: parseInt(sortOrder, 10) || 0,
      };
      if (initial) {
        return updateFn({ data: { id: initial.id, ...payload } });
      }
      return createFn({ data: payload });
    },
    onSuccess: () => {
      toast.success(initial ? "Package updated" : "Package created");
      onSaved();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const disabled =
    !name.trim() ||
    !sessionCount ||
    !totalPrice ||
    Number.isNaN(parseInt(sessionCount, 10)) ||
    Number.isNaN(parseFloat(totalPrice));

  return (
    <div className="space-y-3">
      <div>
        <Label>Name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="10-pack PT" />
      </div>
      <div>
        <Label>Description</Label>
        <Textarea
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Sessions</Label>
          <Input
            type="number"
            value={sessionCount}
            onChange={(e) => setSessionCount(e.target.value)}
          />
        </div>
        <div>
          <Label>Total price</Label>
          <Input
            value={totalPrice}
            onChange={(e) => setTotalPrice(e.target.value)}
            placeholder="750.00"
          />
        </div>
        <div>
          <Label>Currency</Label>
          <Select value={currency} onValueChange={setCurrency}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["CAD", "USD", "EUR", "GBP", "AUD"].map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Validity (days, optional)</Label>
          <Input
            type="number"
            value={validity}
            onChange={(e) => setValidity(e.target.value)}
            placeholder="90"
          />
        </div>
        <div>
          <Label>Sort order</Label>
          <Input
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
          />
        </div>
        <div className="flex items-end justify-between rounded-md border border-border px-3 py-2">
          <Label className="text-xs">Active</Label>
          <Switch checked={active} onCheckedChange={setActive} />
        </div>
      </div>
      <DialogFooter className="gap-2">
        <Button variant="outline" onClick={onCancel} disabled={m.isPending}>
          Cancel
        </Button>
        <Button onClick={() => m.mutate()} disabled={disabled || m.isPending}>
          {initial ? "Update" : "Create"}
        </Button>
      </DialogFooter>
    </div>
  );
}