import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { SESSION_TYPES } from "@/lib/pt-sessions";
import { CARD_ACCENTS, type BookingCard } from "@/lib/booking-cards";

type CardForm = {
  name: string;
  session_type: string;
  custom_type: string;
  duration_minutes: number;
  location: string;
  default_notes: string;
  visible_to_client: boolean;
  client_visible_notes: boolean;
  reminders_enabled: boolean;
  send_confirmation_email: boolean;
  uses_credit: boolean;
  color: string;
  is_active: boolean;
};

const EMPTY: CardForm = {
  name: "",
  session_type: "Personal Training Session",
  custom_type: "",
  duration_minutes: 60,
  location: "",
  default_notes: "",
  visible_to_client: true,
  client_visible_notes: true,
  reminders_enabled: true,
  send_confirmation_email: true,
  uses_credit: true,
  color: "gold",
  is_active: true,
};

/** Merge a prefill over EMPTY, coalescing any null/undefined field back to the
 * EMPTY default so controlled inputs and .trim() never see null. */
const fromPrefill = (prefill?: Partial<CardForm> | null): CardForm => {
  const merged = { ...EMPTY, ...(prefill ?? {}) } as CardForm;
  (Object.keys(EMPTY) as Array<keyof CardForm>).forEach((k) => {
    if (merged[k] == null) (merged as Record<string, unknown>)[k] = EMPTY[k];
  });
  return merged;
};

export function BookingCardDialog({
  open, onOpenChange, initial, prefill, nextSortOrder,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Existing card to edit (undefined = create). */
  initial?: BookingCard | null;
  /** Optional prefill for create mode (suggested cards, duplicates). */
  prefill?: Partial<CardForm> | null;
  nextSortOrder?: number;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<CardForm>(EMPTY);
  const [saving, setSaving] = useState(false);
  const isEdit = !!initial;

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setForm({
        name: initial.name,
        session_type: initial.session_type,
        custom_type: initial.custom_type ?? "",
        duration_minutes: initial.duration_minutes,
        location: initial.location ?? "",
        default_notes: initial.default_notes ?? "",
        visible_to_client: initial.visible_to_client,
        client_visible_notes: initial.client_visible_notes,
        reminders_enabled: initial.reminders_enabled,
        send_confirmation_email: initial.send_confirmation_email,
        uses_credit: initial.uses_credit,
        color: initial.color ?? "gold",
        is_active: initial.is_active,
      });
    } else {
      setForm(fromPrefill(prefill));
    }
  }, [open, initial, prefill]);

  const set = (k: keyof CardForm, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.name.trim()) return toast.error("Card name is required");
    if (!form.duration_minutes || form.duration_minutes < 5 || form.duration_minutes > 480) {
      return toast.error("Duration must be between 5 and 480 minutes");
    }
    setSaving(true);
    try {
      const payload = {
        name: (form.name ?? "").trim(),
        session_type: form.session_type,
        custom_type: form.session_type === "Custom Session" ? (form.custom_type ?? "").trim() || null : null,
        duration_minutes: form.duration_minutes,
        location: (form.location ?? "").trim() || null,
        default_notes: (form.default_notes ?? "").trim() || null,
        visible_to_client: form.visible_to_client,
        client_visible_notes: form.client_visible_notes,
        reminders_enabled: form.reminders_enabled,
        send_confirmation_email: form.send_confirmation_email,
        uses_credit: form.uses_credit,
        color: form.color,
        is_active: form.is_active,
      };
      if (isEdit) {
        const { error } = await (supabase as any).from("booking_cards").update(payload).eq("id", initial.id);
        if (error) throw error;
        toast.success("Booking card updated");
      } else {
        const { error } = await (supabase as any).from("booking_cards").insert({
          ...payload,
          sort_order: nextSortOrder ?? 0,
        });
        if (error) throw error;
        toast.success("Booking card created");
      }
      qc.invalidateQueries({ queryKey: ["booking-cards"] });
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Booking Card" : "Create Booking Card"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label>Card name *</Label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. In-Person PT Session" />
          </div>
          <div>
            <Label>Session type</Label>
            <Select value={form.session_type} onValueChange={(v) => set("session_type", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{SESSION_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Default duration (minutes) *</Label>
            <Input
              type="number" min={5} max={480} step={5}
              value={form.duration_minutes}
              onChange={(e) => set("duration_minutes", Math.max(5, Math.min(480, parseInt(e.target.value || "60", 10) || 60)))}
            />
          </div>
          {form.session_type === "Custom Session" && (
            <div className="sm:col-span-2">
              <Label>Custom type</Label>
              <Input value={form.custom_type} onChange={(e) => set("custom_type", e.target.value)} />
            </div>
          )}
          <div className="sm:col-span-2">
            <Label>Default location</Label>
            <Input value={form.location} onChange={(e) => set("location", e.target.value)} placeholder="e.g. Iron Image Gym, Phone / Video" />
          </div>
          <div className="sm:col-span-2">
            <Label>Default notes (optional)</Label>
            <Textarea rows={2} value={form.default_notes} onChange={(e) => set("default_notes", e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label>Color</Label>
            <div className="flex flex-wrap gap-2 pt-1">
              {CARD_ACCENTS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  title={c.label}
                  onClick={() => set("color", c.id)}
                  className={`h-8 w-8 rounded-full ${c.swatch} transition-all ${
                    form.color === c.id ? "ring-2 ring-foreground ring-offset-2 ring-offset-background" : "opacity-50 hover:opacity-100"
                  }`}
                />
              ))}
            </div>
          </div>
          <ToggleRow
            label="Uses 1 PT session credit"
            hint={form.uses_credit ? "Booking reserves a credit; completing uses it; cancelling releases it." : "Booking does not affect the client’s PT credit balance."}
            checked={form.uses_credit}
            onChange={(v) => set("uses_credit", v)}
          />
          <ToggleRow label="Show session in client calendar" checked={form.visible_to_client} onChange={(v) => set("visible_to_client", v)} />
          <ToggleRow label="Show notes to client" checked={form.client_visible_notes} onChange={(v) => set("client_visible_notes", v)} />
          <ToggleRow label="Send 24h + 1h reminder emails" checked={form.reminders_enabled} onChange={(v) => set("reminders_enabled", v)} />
          <ToggleRow label="Send booking confirmation email" checked={form.send_confirmation_email} onChange={(v) => set("send_confirmation_email", v)} />
          <ToggleRow label="Active (available when booking)" checked={form.is_active} onChange={(v) => set("is_active", v)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : isEdit ? "Save Card" : "Create Card"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ToggleRow({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="sm:col-span-2 flex items-center justify-between gap-3 rounded-md border border-border bg-secondary/30 px-3 py-2">
      <div className="min-w-0">
        <Label className="text-xs">{label}</Label>
        {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}