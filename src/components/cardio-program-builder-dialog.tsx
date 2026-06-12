import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ActionButton } from "@/components/action-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Plus, Copy, Trash2, Calculator, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { CARDIO_TYPES, CARDIO_INTENSITIES, estimateCalorieRange, formatCalorieTarget } from "@/lib/nutrition-cardio";
import { CARDIO_DAY_TYPES, formatDays } from "@/lib/training-schedule";

type Row = {
  day_type: string;
  custom_day_type: string;
  cardio_type: string;
  custom_type: string;
  frequency_per_week: string;
  duration_minutes: string;
  intensity: string;
  step_target: string;
  calorie_target_min: string;
  calorie_target_max: string;
  show_calories_to_client: boolean;
  client_notes: string;
};

const blankRow = (day_type = "Training Day"): Row => ({
  day_type, custom_day_type: "", cardio_type: "Incline Walking", custom_type: "",
  frequency_per_week: "3", duration_minutes: "30", intensity: "Zone 2",
  step_target: "", calorie_target_min: "", calorie_target_max: "",
  show_calories_to_client: true, client_notes: "",
});

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clientId: string;
  client?: { preferred_training_days?: string[] | null; preferred_rest_days?: string[] | null; preferred_high_days?: string[] | null } | null;
  initialTemplate?: { name?: string; notes?: string; rows?: Row[] } | null;
};

export function CardioProgramBuilderDialog({ open, onOpenChange, clientId, client, initialTemplate }: Props) {
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const [programName, setProgramName] = useState("");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState("");
  const [visibleToClient, setVisibleToClient] = useState(true);
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<Row[]>([blankRow()]);
  const [saving, setSaving] = useState(false);
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);

  useEffect(() => {
    if (!open) return;
    setProgramName(initialTemplate?.name ?? "");
    setNotes(initialTemplate?.notes ?? "");
    setStartDate(today);
    setEndDate("");
    setVisibleToClient(true);
    setSaveAsTemplate(false);
    setRows(initialTemplate?.rows && initialTemplate.rows.length ? initialTemplate.rows.map((r) => ({ ...blankRow(), ...r })) : [blankRow()]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const updateRow = (i: number, patch: Partial<Row>) => {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };
  const addRow = (day_type?: string) => setRows((rs) => [...rs, blankRow(day_type)]);
  const duplicateRow = (i: number) => setRows((rs) => [...rs.slice(0, i + 1), { ...rs[i] }, ...rs.slice(i + 1)]);
  const deleteRow = (i: number) => setRows((rs) => rs.filter((_, idx) => idx !== i));
  const estimateRow = (i: number) => {
    const r = rows[i];
    const est = estimateCalorieRange(Number(r.duration_minutes), r.intensity);
    if (!est) return toast.error("Add duration + intensity first");
    updateRow(i, { calorie_target_min: String(est.min), calorie_target_max: String(est.max), show_calories_to_client: true });
  };
  const clearCalories = (i: number) => updateRow(i, { calorie_target_min: "", calorie_target_max: "", show_calories_to_client: false });

  const save = async () => {
    if (!clientId) return toast.error("No client selected");
    if (rows.length === 0) return toast.error("Add at least one cardio row");
    setSaving(true);
    const inserts = rows.map((r) => ({
      client_id: clientId,
      program_name: programName || null,
      day_type: r.day_type,
      custom_day_type: r.day_type === "Custom" ? (r.custom_day_type || null) : null,
      cardio_type: r.cardio_type,
      custom_type: r.cardio_type === "Custom" ? (r.custom_type || null) : null,
      frequency_per_week: r.frequency_per_week ? Number(r.frequency_per_week) : null,
      duration_minutes: r.duration_minutes ? Number(r.duration_minutes) : null,
      intensity: r.intensity || null,
      step_target: r.step_target ? Number(r.step_target) : null,
      calorie_target_min: r.calorie_target_min ? Number(r.calorie_target_min) : null,
      calorie_target_max: r.calorie_target_max ? Number(r.calorie_target_max) : null,
      show_calories_to_client: r.show_calories_to_client,
      client_notes: r.client_notes || null,
      admin_notes: notes || null,
      start_date: startDate,
      end_date: endDate || null,
      status: "Active",
      visible_to_client: visibleToClient,
      enabled: true,
    }));
    const { error } = await supabase.from("cardio_targets").insert(inserts);
    if (error) { setSaving(false); return toast.error(error.message); }

    if (saveAsTemplate) {
      if (!programName) {
        toast.message("Program saved. Add a name to save as template.");
      } else {
        const { error: tErr } = await supabase.from("cardio_program_templates").insert({
          name: programName, notes: notes || null, rows: rows as any,
        });
        if (tErr) toast.error(`Template not saved: ${tErr.message}`);
      }
    }
    setSaving(false);
    toast.success(`Created ${rows.length} cardio target${rows.length > 1 ? "s" : ""}`);
    qc.invalidateQueries({ queryKey: ["cardio-targets"] });
    qc.invalidateQueries({ queryKey: ["cardio-targets", clientId] });
    qc.invalidateQueries({ queryKey: ["cardio-program-templates"] });
    onOpenChange(false);
  };

  const scheduleHints = [
    client?.preferred_training_days?.length ? `Training: ${formatDays(client.preferred_training_days)}` : null,
    client?.preferred_rest_days?.length ? `Rest: ${formatDays(client.preferred_rest_days)}` : null,
    client?.preferred_high_days?.length ? `High: ${formatDays(client.preferred_high_days)}` : null,
  ].filter(Boolean);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Create Cardio Program</DialogTitle></DialogHeader>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="md:col-span-2"><Label>Program name</Label>
            <Input value={programName} onChange={(e) => setProgramName(e.target.value)} placeholder="e.g. Fat Loss Cardio Setup" />
          </div>
          <div><Label>Start date</Label><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></div>
          <div><Label>End date (optional)</Label><Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div>
          <div className="md:col-span-2 flex items-center justify-between rounded-md border border-border bg-secondary/30 px-3 py-2">
            <Label className="text-xs">Visible to client</Label>
            <Switch checked={visibleToClient} onCheckedChange={setVisibleToClient} />
          </div>
        </div>

        {scheduleHints.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2 rounded-md border border-dashed border-border bg-secondary/20 p-2 text-xs text-muted-foreground">
            <span className="font-semibold uppercase tracking-wider">Client schedule:</span>
            {scheduleHints.map((h, i) => <Badge key={i} variant="outline">{h}</Badge>)}
          </div>
        )}

        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Cardio Rows</h4>
            <ActionButton size="sm" variant="outline" onClick={() => addRow()}><Plus className="mr-1 h-4 w-4" /> Add row</ActionButton>
          </div>

          {rows.map((r, i) => {
            const calLabel = formatCalorieTarget(
              r.calorie_target_min ? Number(r.calorie_target_min) : null,
              r.calorie_target_max ? Number(r.calorie_target_max) : null,
            );
            return (
              <div key={i} className="rounded-md border border-border bg-secondary/20 p-3 space-y-2">
                <div className="grid gap-2 md:grid-cols-5">
                  <div>
                    <Label className="text-xs">Day type</Label>
                    <Select value={r.day_type} onValueChange={(v) => updateRow(i, { day_type: v })}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>{CARDIO_DAY_TYPES.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Cardio type</Label>
                    <Select value={r.cardio_type} onValueChange={(v) => updateRow(i, { cardio_type: v })}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>{CARDIO_TYPES.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Freq/wk</Label>
                    <Input className="h-9" type="number" value={r.frequency_per_week} onChange={(e) => updateRow(i, { frequency_per_week: e.target.value })} />
                  </div>
                  <div>
                    <Label className="text-xs">Duration (min)</Label>
                    <Input className="h-9" type="number" value={r.duration_minutes} onChange={(e) => updateRow(i, { duration_minutes: e.target.value })} />
                  </div>
                  <div>
                    <Label className="text-xs">Intensity</Label>
                    <Select value={r.intensity} onValueChange={(v) => updateRow(i, { intensity: v })}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>{CARDIO_INTENSITIES.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>

                {r.day_type === "Custom" && (
                  <Input className="h-9" placeholder="Custom day type" value={r.custom_day_type} onChange={(e) => updateRow(i, { custom_day_type: e.target.value })} />
                )}
                {r.cardio_type === "Custom" && (
                  <Input className="h-9" placeholder="Custom cardio type" value={r.custom_type} onChange={(e) => updateRow(i, { custom_type: e.target.value })} />
                )}

                <div className="grid gap-2 md:grid-cols-4 items-end">
                  <div>
                    <Label className="text-xs">Step target (optional)</Label>
                    <Input className="h-9" type="number" value={r.step_target} onChange={(e) => updateRow(i, { step_target: e.target.value })} />
                  </div>
                  <div>
                    <Label className="text-xs">Calories min</Label>
                    <Input className="h-9" type="number" value={r.calorie_target_min} onChange={(e) => updateRow(i, { calorie_target_min: e.target.value })} />
                  </div>
                  <div>
                    <Label className="text-xs">Calories max</Label>
                    <Input className="h-9" type="number" value={r.calorie_target_max} onChange={(e) => updateRow(i, { calorie_target_max: e.target.value })} />
                  </div>
                  <div className="flex gap-1">
                    <ActionButton type="button" size="sm" variant="outline" onClick={() => estimateRow(i)} title="Estimate from duration + intensity">
                      <Calculator className="mr-1 h-4 w-4" /> Estimate
                    </ActionButton>
                    {(r.calorie_target_min || r.calorie_target_max) && (
                      <ActionButton type="button" size="sm" variant="ghost" onClick={() => clearCalories(i)}><X className="h-4 w-4" /></ActionButton>
                    )}
                  </div>
                </div>

                {calLabel && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-dashed border-border bg-background/40 px-2 py-1.5">
                    <span className="text-xs text-muted-foreground">Estimated target: <span className="font-semibold text-foreground">{calLabel}</span></span>
                    <div className="flex items-center gap-2">
                      <Label className="text-xs">Show to client</Label>
                      <Switch checked={r.show_calories_to_client} onCheckedChange={(v) => updateRow(i, { show_calories_to_client: v })} />
                    </div>
                  </div>
                )}

                <Textarea rows={1} placeholder="Notes for client (optional)" value={r.client_notes} onChange={(e) => updateRow(i, { client_notes: e.target.value })} />

                <div className="flex justify-end gap-1">
                  <ActionButton size="sm" variant="ghost" onClick={() => duplicateRow(i)}><Copy className="h-4 w-4" /></ActionButton>
                  <ActionButton size="sm" variant="ghost" className="text-destructive" onClick={() => deleteRow(i)} disabled={rows.length === 1}><Trash2 className="h-4 w-4" /></ActionButton>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-3"><Label>Program notes (admin only)</Label>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <div className="mt-3 flex items-center justify-between rounded-md border border-border bg-secondary/30 px-3 py-2">
          <Label className="text-xs">Save as reusable template</Label>
          <Switch checked={saveAsTemplate} onCheckedChange={setSaveAsTemplate} />
        </div>

        <DialogFooter className="mt-4">
          <ActionButton variant="outline" onClick={() => onOpenChange(false)}>Cancel</ActionButton>
          <ActionButton onClick={save} jobLabel="Saving cardio program" className="bg-gradient-primary font-bold uppercase">
            Save & Assign ({rows.length})
          </ActionButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}