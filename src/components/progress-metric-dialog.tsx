import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import type { ProgressMetric, WeightUnit } from "@/lib/progress-metrics";
import { useAuth } from "@/lib/auth";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientId: string;
  defaultUnit: WeightUnit;
  entry?: ProgressMetric | null;
}

const empty = (defaultUnit: WeightUnit) => ({
  entry_date: new Date().toISOString().slice(0, 10),
  bodyweight: "" as string | number,
  bodyweight_unit: defaultUnit,
  steps: "" as string | number,
  sleep_hours: "" as string | number,
  resting_heart_rate: "" as string | number,
  calories_burned: "" as string | number,
  active_minutes: "" as string | number,
  notes: "",
});

export function ProgressMetricDialog({ open, onOpenChange, clientId, defaultUnit, entry }: Props) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [form, setForm] = useState(empty(defaultUnit));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (entry) {
      setForm({
        entry_date: entry.entry_date,
        bodyweight: entry.bodyweight ?? "",
        bodyweight_unit: (entry.bodyweight_unit as WeightUnit) ?? defaultUnit,
        steps: entry.steps ?? "",
        sleep_hours: entry.sleep_hours ?? "",
        resting_heart_rate: entry.resting_heart_rate ?? "",
        calories_burned: entry.calories_burned ?? "",
        active_minutes: entry.active_minutes ?? "",
        notes: entry.notes ?? "",
      });
    } else {
      setForm(empty(defaultUnit));
    }
  }, [open, entry, defaultUnit]);

  const num = (v: string | number) => (v === "" || v == null ? null : Number(v));

  const save = async () => {
    setSaving(true);
    const payload: any = {
      client_id: clientId,
      entry_date: form.entry_date,
      bodyweight: num(form.bodyweight),
      bodyweight_unit: form.bodyweight_unit,
      steps: num(form.steps),
      sleep_hours: num(form.sleep_hours),
      resting_heart_rate: num(form.resting_heart_rate),
      calories_burned: num(form.calories_burned),
      active_minutes: num(form.active_minutes),
      notes: form.notes?.trim() ? form.notes.trim() : null,
      source: "manual",
    };
    if (!entry) payload.created_by = user?.id ?? null;
    const q = entry
      ? supabase.from("progress_metrics").update(payload).eq("id", entry.id)
      : supabase.from("progress_metrics").insert(payload);
    const { error } = await q;
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(entry ? "Entry updated." : "Entry saved.");
    qc.invalidateQueries({ queryKey: ["progress-metrics", clientId] });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{entry ? "Edit entry" : "Add progress entry"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Date</Label>
              <Input type="date" value={form.entry_date} onChange={(e) => setForm({ ...form, entry_date: e.target.value })} />
            </div>
            <div>
              <Label>Unit</Label>
              <Select value={form.bodyweight_unit} onValueChange={(v) => setForm({ ...form, bodyweight_unit: v as WeightUnit })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="lb">lb</SelectItem>
                  <SelectItem value="kg">kg</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Bodyweight</Label>
            <Input type="number" step="0.1" inputMode="decimal" value={form.bodyweight} onChange={(e) => setForm({ ...form, bodyweight: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Steps</Label><Input type="number" value={form.steps} onChange={(e) => setForm({ ...form, steps: e.target.value })} /></div>
            <div><Label>Sleep (hrs)</Label><Input type="number" step="0.1" value={form.sleep_hours} onChange={(e) => setForm({ ...form, sleep_hours: e.target.value })} /></div>
            <div><Label>Resting HR</Label><Input type="number" value={form.resting_heart_rate} onChange={(e) => setForm({ ...form, resting_heart_rate: e.target.value })} /></div>
            <div><Label>Calories burned</Label><Input type="number" value={form.calories_burned} onChange={(e) => setForm({ ...form, calories_burned: e.target.value })} /></div>
            <div className="col-span-2"><Label>Active minutes</Label><Input type="number" value={form.active_minutes} onChange={(e) => setForm({ ...form, active_minutes: e.target.value })} /></div>
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Optional" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving} className="bg-gradient-primary font-bold uppercase">{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}