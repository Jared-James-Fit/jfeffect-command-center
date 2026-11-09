import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { todayLocalISO } from "@/lib/today";
import { logBodyweight, updateBodyweight } from "@/lib/progress";
import type { ClientBodyweightEntry } from "@/lib/client-bodyweight";
import type { WeightUnit } from "@/lib/bodyweight";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientId: string;
  /** The client's login: a new weigh-in goes where they log their own, so they see it too. */
  userId: string | null;
  defaultUnit: WeightUnit;
  entry?: ClientBodyweightEntry | null;
  onSaved: () => void;
}

/**
 * A coach adds or fixes one of a client's weigh-ins. With a login it's saved
 * through `save_progress_bodyweight` (one per day: a second one that day
 * replaces it), the same as the client's own; an older coach-entered metric is
 * edited where it lives; a client without a login keeps coach-entered metrics.
 */
export function BodyweightEntryDialog({ open, onOpenChange, clientId, userId, defaultUnit, entry, onSaved }: Props) {
  const { user } = useAuth();
  const [date, setDate] = useState(todayLocalISO());
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState<WeightUnit>(defaultUnit);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDate(entry?.date ?? todayLocalISO());
    setValue(entry ? String(Math.round(entry.value * 100) / 100) : "");
    setUnit(entry?.unit ?? defaultUnit);
    setNote(entry?.note ?? "");
  }, [open, entry, defaultUnit]);

  const save = async () => {
    const n = Number(value);
    if (!value.trim() || !Number.isFinite(n) || n <= 0) { toast.error("Enter a bodyweight."); return; }
    if (n > (unit === "kg" ? 400 : 900)) { toast.error(`${n} ${unit} doesn't look right. Check the unit.`); return; }
    if (!date) { toast.error("Choose a date."); return; }
    setSaving(true);
    try {
      const noteValue = note.trim() || null;
      if (entry?.source === "progress_metrics" || (!entry && !userId)) {
        const payload = { entry_date: date, bodyweight: n, bodyweight_unit: unit, notes: noteValue };
        const { error } = entry
          ? await supabase.from("progress_metrics").update(payload).eq("id", entry.id)
          : await supabase.from("progress_metrics").insert({ ...payload, client_id: clientId, source: "manual", created_by: user?.id ?? null });
        if (error) throw error;
      } else if (entry) {
        await updateBodyweight(userId!, entry.id, { weight_value: n, weight_unit: unit, logged_date: date, note: noteValue });
      } else {
        await logBodyweight({ user_id: userId!, weight_value: n, weight_unit: unit, logged_date: date, note: noteValue });
      }
      toast.success(entry ? "Weigh-in updated." : "Weigh-in saved.");
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? "Couldn't save the weigh-in.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{entry ? "Edit weigh-in" : "Add weigh-in"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="bw-entry-value">Bodyweight</Label>
            <div className="flex gap-2">
              <Input
                id="bw-entry-value"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={value}
                onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1"))}
                placeholder="0.0"
                className="h-11 text-base"
              />
              <div className="flex shrink-0 rounded-lg border border-border p-0.5" role="group" aria-label="Unit">
                {(["lb", "kg"] as const).map((u) => (
                  <button
                    key={u}
                    type="button"
                    aria-pressed={unit === u}
                    onClick={() => setUnit(u)}
                    className={`min-w-[44px] rounded-md px-3 text-sm font-medium ${unit === u ? "bg-secondary text-foreground" : "text-muted-foreground"}`}
                  >
                    {u}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Date</Label>
            <DateField value={date} onChange={setDate} max={todayLocalISO()} aria-label="Weigh-in date" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="bw-entry-note">Note</Label>
            <Textarea id="bw-entry-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || !value.trim()}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
