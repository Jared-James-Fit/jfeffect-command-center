import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Ban, CheckCircle2, ChevronDown, CircleOff, Pencil, Trash2, Undo2, Wallet,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { bookPtSession, setPtSessionStatus, getClientSessionBalance } from "@/lib/pt-pack.functions";
import {
  getPtSessionCreditEvents, revertPtSessionDeduction,
} from "@/lib/pt-session-manage.functions";
import {
  creditImpact, creditToneClasses, invalidatePtSessionCaches, todayISOLocal, type PtLedgerEvent,
} from "@/lib/pt-session-manage";
import { SESSION_STATUSES, SESSION_TYPES, statusTone, fmtTimeRange } from "@/lib/pt-sessions";
import {
  COMMON_TIMEZONES, defaultSlotTimes, localDateInTz, mergeDateTimeToIso, nowInTz, toDateTimeLocal, toLocalInputParts,
} from "@/lib/pt-timezone";
import { useAuth } from "@/lib/auth";
import { PtSessionHistory } from "@/components/pt-session-history";
import {
  AdjustPtCreditDialog, CancelPtSessionDialog, DeletePtSessionDialog, NoShowPtDialog,
} from "@/components/pt-session-manage-dialogs";

function normalizeDateInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const us = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  return trimmed;
}

export function PtSessionDialog({ open, onOpenChange, clients, initial }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clients: { id: string; full_name: string; timezone?: string; default_session_location?: string; package_tracking_enabled?: boolean; sessions_purchased?: number; sessions_used?: number }[];
  initial?: any;
}) {
  const qc = useQueryClient();
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const isEdit = !!initial;
  const [form, setForm] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [bookingMode, setBookingMode] = useState<"credit" | "no-credit">("credit");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [noShowOpen, setNoShowOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const client = clients.find((c) => c.id === form?.client_id);

  const { data: balance } = useQuery({
    queryKey: ["pt-balance", form?.client_id],
    enabled: open && !isEdit && !!form?.client_id,
    queryFn: async () => (await getClientSessionBalance({ data: { clientId: form.client_id } })) as {
      available: number; packages?: { available: number; remaining_value_minor: number | null }[];
    },
  });

  // Credit history for the session being edited.
  const { data: events = [], isLoading: eventsLoading } = useQuery<PtLedgerEvent[]>({
    queryKey: ["pt-session-events", form?.id],
    enabled: open && isEdit && !!form?.id,
    queryFn: async () => {
      const res = await getPtSessionCreditEvents({ data: { sessionIds: [form.id] } });
      return (res.events ?? []) as PtLedgerEvent[];
    },
  });

  useEffect(() => {
    if (!open) return;
    setShowAdvanced(false);
    setNoShowOpen(false); setCancelOpen(false); setDeleteOpen(false); setAdjustOpen(false);
    if (initial) {
      setForm({
        ...initial,
        start_input: toDateTimeLocal(initial.start_time, initial.timezone),
        end_input: toDateTimeLocal(initial.end_time, initial.timezone),
        uses_credit: initial.uses_credit !== false,
        reminder_enabled: initial.reminder_enabled !== false,
      });
      setBookingMode(initial.uses_credit === false ? "no-credit" : "credit");
    } else {
      const tz = "America/Toronto";
      const parts = defaultSlotTimes(nowInTz(tz), 60);
      setForm({
        client_id: clients[0]?.id ?? "",
        title: "",
        session_type: "1-on-1 Session",
        custom_type: "",
        timezone: tz,
        location: "",
        start_input: parts.startInput,
        end_input: parts.endInput,
        status: "Scheduled",
        uses_credit: true,
        reminder_enabled: true,
        notes: "",
      });
      setBookingMode("credit");
    }
  }, [open, initial, clients]);

  // Reset the time pickers when the client or timezone changes.
  useEffect(() => {
    if (!open || isEdit || !form?.client_id || !form?.timezone) return;
    if (client?.default_session_location && !form.location) set("location", client.default_session_location);
    const parts = defaultSlotTimes(nowInTz(form.timezone), 60);
    setForm((f: any) => ({ ...f, start_input: parts.startInput, end_input: parts.endInput }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form?.client_id, form?.timezone, open]);

  if (!form) return null;

  const errors = {
    client: form.client_id ? "" : "Select a client.",
    title: form.title?.trim() ? "" : "Session title is required.",
    timezone: form.timezone ? "" : "Select a timezone.",
    start: form.start_input ? "" : "Start date/time is required.",
    end: form.end_input ? "" : "End date/time is required.",
    order: form.start_input && form.end_input && form.end_input > form.start_input ? "" : "End must be after start.",
  };
  const hasErrors = Object.values(errors).some(Boolean);

  const localStart = form.start_input ? toLocalInputParts(form.start_input) : { date: "", time: "" };
  const localEnd = form.end_input ? toLocalInputParts(form.end_input) : { date: "", time: "" };
  const localDay = localStart.date ? localDateInTz(new Date(`${localStart.date}T${localStart.time || "00:00"}:00`), form.timezone) : "";

  const save = async () => {
    if (hasErrors) return toast.error("Fix the highlighted fields first");
    setSaving(true);
    try {
      const startIso = mergeDateTimeToIso(localStart.date, localStart.time, form.timezone);
      const endIso = mergeDateTimeToIso(localEnd.date, localEnd.time, form.timezone);
      const typeLabel = form.session_type === "Custom Session" ? form.custom_type?.trim() || form.session_type : form.session_type;
      if (isEdit) {
        const { error } = await supabase
          .from("pt_sessions")
          .update({
            title: form.title.trim(),
            session_type: form.session_type,
            custom_type: form.custom_type || null,
            start_time: startIso,
            end_time: endIso,
            session_date: localDay,
            timezone: form.timezone,
            location: form.location || null,
            status: form.status,
            uses_credit: form.uses_credit,
            reminder_enabled: form.reminder_enabled,
            notes: form.notes || null,
          })
          .eq("id", form.id);
        if (error) throw error;
        toast.success("Session updated");
      } else {
        const { id } = await bookPtSession({
          data: {
            clientId: form.client_id,
            title: form.title.trim() || typeLabel,
            sessionType: form.session_type,
            customType: form.custom_type || null,
            startTime: startIso,
            endTime: endIso,
            timezone: form.timezone,
            location: form.location || null,
            notes: form.notes || null,
            useCredit: bookingMode === "credit",
          },
        });
        toast.success(
          bookingMode === "credit" ? "Session booked — 1 credit reserved" : "Session booked (no credit)",
          { action: { label: "Undo", onClick: () => supabase.from("pt_sessions").delete().eq("id", id) } },
        );
      }
      invalidatePtSessionCaches(qc, form.client_id);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const applyStatus = async (status: string, okMsg: string) => {
    try {
      await setPtSessionStatus({ data: { sessionId: form.id, status: status as any } });
      toast.success(okMsg);
      set("status", status);
      invalidatePtSessionCaches(qc, form.client_id);
    } catch (e: any) {
      toast.error(e?.message ?? "Update failed");
    }
  };

  const undoNoShow = async () => {
    try {
      const impact = creditImpact("Missed", events);
      if (impact.tone === "destructive") {
        await revertPtSessionDeduction({ data: { sessionId: form.id } });
      }
      await setPtSessionStatus({ data: { sessionId: form.id, status: "Scheduled" } });
      toast.success("No-show undone — session is scheduled again");
      set("status", "Scheduled");
      invalidatePtSessionCaches(qc, form.client_id);
    } catch (e: any) {
      toast.error(e?.message ?? "Undo failed");
    }
  };

  const impact = isEdit ? creditImpact(form.status, events) : null;
  const clientName = client?.full_name ?? (initial?.clients?.full_name ?? "");

  const dateLabel = isEdit
    ? new Date(form.session_date + "T00:00:00").toLocaleDateString(undefined, {
        weekday: "short", month: "short", day: "numeric",
      })
    : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Manage Session" : "Book PT Session"}</DialogTitle>
        </DialogHeader>

        {/* Status-based summary header (edit mode) */}
        {isEdit && (
          <div className="space-y-2 rounded-lg border border-border bg-secondary/20 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={statusTone(form.status)}>
                {form.status === "Missed" ? "No-show" : form.status}
              </Badge>
              <span className="text-sm font-bold">{form.title}</span>
              {impact && (
                <Badge variant="outline" className={creditToneClasses(impact.tone)}>
                  Credit: {impact.label}
                </Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              {clientName} · {dateLabel} · {fmtTimeRange(form.start_time, form.end_time)}
              {form.location ? ` · ${form.location}` : ""}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <Label>Client *</Label>
            <Select value={form.client_id} onValueChange={(v) => set("client_id", v)}>
              <SelectTrigger className={!form.client_id ? "border-destructive/50" : ""}><SelectValue placeholder="Select client" /></SelectTrigger>
              <SelectContent>{clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>)}</SelectContent>
            </Select>
            {errors.client && <p className="mt-1 text-xs text-destructive">{errors.client}</p>}
          </div>

          {/* Credit mode — booking only. Existing sessions manage credits via actions below. */}
          {!isEdit && (
            <div className="sm:col-span-2 space-y-2 rounded-lg border border-border bg-secondary/20 p-3">
              <Label>Session credit</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                <Button
                  type="button"
                  variant={bookingMode === "credit" ? "default" : "outline"}
                  className="justify-start h-auto py-2 whitespace-normal text-left"
                  onClick={() => setBookingMode("credit")}
                >
                  <div>
                    <div className="font-bold">Reserve 1 session credit</div>
                    <div className="text-[11px] opacity-80">Available: {balance ? balance.available : "…"}</div>
                  </div>
                </Button>
                <Button
                  type="button"
                  variant={bookingMode === "no-credit" ? "default" : "outline"}
                  className="justify-start h-auto py-2 whitespace-normal text-left"
                  onClick={() => setBookingMode("no-credit")}
                >
                  <div>
                    <div className="font-bold">Book without credit</div>
                    <div className="text-[11px] opacity-80">Freebie, trial, or paid another way</div>
                  </div>
                </Button>
              </div>
              {bookingMode === "credit" && balance && balance.available <= 0 && (
                <p className="text-xs text-warning">No credits available — booking will fail. Sell a session pack first or book without credit.</p>
              )}
              {balance?.packages?.some((p) => (p.available ?? 0) > 0 && (p.remaining_value_minor ?? 0) > 0) && (
                <p className="text-[11px] text-muted-foreground">
                  Remaining dollar credit: {"$"}
                  {((balance.packages.reduce((sum, p) => sum + (p.available > 0 ? p.remaining_value_minor ?? 0 : 0), 0)) / 100).toFixed(2)}
                </p>
              )}
            </div>
          )}

          <div className="sm:col-span-2">
            <Label>Session title *</Label>
            <Input value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Lower Body Strength" />
            {errors.title && <p className="mt-1 text-xs text-destructive">{errors.title}</p>}
          </div>
          <div>
            <Label>Session type</Label>
            <Select value={form.session_type} onValueChange={(v) => set("session_type", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{SESSION_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {form.session_type === "Custom Session" && (
            <div>
              <Label>Custom type</Label>
              <Input value={form.custom_type} onChange={(e) => set("custom_type", e.target.value)} placeholder="Type name" />
            </div>
          )}
          <div>
            <Label>Date *</Label>
            <Input
              type="date"
              value={localStart.date}
              onChange={(e) => {
                const date = normalizeDateInput(e.target.value);
                const endDate = localEnd.date && localEnd.date < date ? date : localEnd.date || date;
                setForm((f: any) => ({ ...f, start_input: `${date}T${localStart.time || "09:00"}`, end_input: `${endDate}T${localEnd.time || "10:00"}` }));
              }}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Start *</Label>
              <Input type="time" value={localStart.time} onChange={(e) => set("start_input", `${localStart.date || todayISOLocal()}T${e.target.value}`)} />
            </div>
            <div>
              <Label>End *</Label>
              <Input type="time" value={localEnd.time} onChange={(e) => set("end_input", `${localEnd.date || localStart.date || todayISOLocal()}T${e.target.value}`)} />
            </div>
          </div>
          {(errors.start || errors.end || errors.order) && (
            <p className="sm:col-span-2 text-xs text-destructive">{errors.start || errors.end || errors.order}</p>
          )}
          <div>
            <Label>Timezone *</Label>
            <Select value={form.timezone} onValueChange={(v) => set("timezone", v)}>
              <SelectTrigger><SelectValue placeholder="Select timezone" /></SelectTrigger>
              <SelectContent>{COMMON_TIMEZONES.map((tz) => <SelectItem key={tz} value={tz}>{tz}</SelectItem>)}</SelectContent>
            </Select>
            {errors.timezone && <p className="mt-1 text-xs text-destructive">{errors.timezone}</p>}
          </div>
          <div>
            <Label>Location</Label>
            <Input value={form.location ?? ""} onChange={(e) => set("location", e.target.value)} placeholder="Gym, address, link…" />
          </div>
          <div className="sm:col-span-2">
            <Label>Notes</Label>
            <Textarea rows={2} value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
          </div>
        </div>

        {/* Advanced options */}
        <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="w-full justify-between text-muted-foreground">
              Advanced options
              <ChevronDown className={`h-4 w-4 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 rounded-lg border border-border bg-secondary/20 p-3">
            {isEdit && (
              <div>
                <Label>Status (manual override)</Label>
                <Select value={form.status} onValueChange={(v) => set("status", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{SESSION_STATUSES.map((s) => <SelectItem key={s} value={s}>{s === "Missed" ? "No-show" : s}</SelectItem>)}</SelectContent>
                </Select>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Prefer the action buttons below — manual status changes skip the credit prompts.
                </p>
              </div>
            )}
            <div className="flex items-center justify-between">
              <Label>Uses session credit</Label>
              <Switch checked={form.uses_credit} onCheckedChange={(v) => set("uses_credit", v)} />
            </div>
            <div className="flex items-center justify-between">
              <Label>Reminders</Label>
              <Switch checked={form.reminder_enabled} onCheckedChange={(v) => set("reminder_enabled", v)} />
            </div>
            {client?.timezone && (
              <p className="text-[11px] text-muted-foreground">Client timezone: {client.timezone}</p>
            )}
          </CollapsibleContent>
        </Collapsible>

        {/* Status actions + history (edit mode) */}
        {isEdit && (
          <>
            <Separator />
            <div className="flex flex-wrap gap-2">
              {form.status === "Scheduled" && (
                <>
                  <Button
                    size="sm" variant="outline"
                    className="border-success/40 text-success hover:bg-success/10"
                    onClick={() => applyStatus("Completed", "Marked completed — reserved credit converted to used")}
                  >
                    <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Complete
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setNoShowOpen(true)}>
                    <Ban className="mr-1.5 h-3.5 w-3.5" /> No-show
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setCancelOpen(true)}>
                    <CircleOff className="mr-1.5 h-3.5 w-3.5" /> Cancel
                  </Button>
                </>
              )}
              {form.status === "Completed" && (
                <Button size="sm" variant="outline" onClick={() => applyStatus("Scheduled", "Completion undone — credit restored and reserved again")}>
                  <Undo2 className="mr-1.5 h-3.5 w-3.5" /> Undo Completion
                </Button>
              )}
              {form.status === "Missed" && (
                <Button size="sm" variant="outline" onClick={undoNoShow}>
                  <Undo2 className="mr-1.5 h-3.5 w-3.5" /> Undo No-show
                </Button>
              )}
              {form.status === "Cancelled" && (
                <Button size="sm" variant="outline" onClick={() => applyStatus("Scheduled", "Session restored — 1 credit reserved")}>
                  <Undo2 className="mr-1.5 h-3.5 w-3.5" /> Restore Session
                </Button>
              )}
              {isAdmin && (
                <Button size="sm" variant="outline" onClick={() => setAdjustOpen(true)}>
                  <Wallet className="mr-1.5 h-3.5 w-3.5" /> Adjust Credit
                </Button>
              )}
              <Button
                size="sm" variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete
              </Button>
            </div>
            <PtSessionHistory events={events} loading={eventsLoading} />
          </>
        )}

        <DialogFooter className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button disabled={saving || hasErrors} onClick={save}>
            {saving ? "Saving…" : isEdit ? "Save Changes" : bookingMode === "credit" ? "Book & Reserve Credit" : "Book Session"}
          </Button>
        </DialogFooter>
      </DialogContent>

      {isEdit && (
        <>
          <NoShowPtDialog open={noShowOpen} onOpenChange={setNoShowOpen} session={form} onDone={() => set("status", "Missed")} />
          <CancelPtSessionDialog
            open={cancelOpen}
            onOpenChange={setCancelOpen}
            session={form}
            hasReservation={impact?.tone === "primary"}
            onDone={() => set("status", "Cancelled")}
          />
          <DeletePtSessionDialog
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            session={form}
            impactLabel={impact?.label}
            onDone={() => onOpenChange(false)}
          />
          {isAdmin && (
            <AdjustPtCreditDialog open={adjustOpen} onOpenChange={setAdjustOpen} clientId={form.client_id} session={form} />
          )}
        </>
      )}
    </Dialog>
  );
}