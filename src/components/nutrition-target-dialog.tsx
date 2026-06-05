import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { NUTRITION_PHASES, NUTRITION_GOALS, NUTRITION_STRUCTURES, dayLabelsForStructure, TARGET_STATUSES } from "@/lib/nutrition-cardio";
import { FileText, Upload, X } from "lucide-react";

type Day = {
  id?: string;
  day_label: string;
  calories?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fats?: number | null;
  fibre?: number | null;
  water?: number | null;
  steps?: number | null;
  notes?: string | null;
  sort_order: number;
};

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clientId?: string;
  clients?: Array<{ id: string; full_name: string }>;
  initial?: any;
};

export function NutritionTargetDialog({ open, onOpenChange, clientId, clients = [], initial }: Props) {
  const qc = useQueryClient();
  const [form, setForm] = useState<any>(null);
  const [days, setDays] = useState<Day[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const today = new Date().toISOString().slice(0, 10);
    if (initial) {
      setForm({ ...initial });
      supabase.from("nutrition_target_days").select("*").eq("target_id", initial.id).order("sort_order").then(({ data }) => {
        setDays((data ?? []) as Day[]);
      });
    } else {
      const f = {
        client_id: clientId ?? "",
        phase: "Maintenance",
        custom_phase: "",
        goal: "Maintain bodyweight",
        custom_goal: "",
        structure: "Same Every Day",
        start_date: today,
        end_date: "",
        status: "Active",
        ending_soon_days: 7,
        client_notes: "",
        admin_notes: "",
        visible_to_client: true,
        pdf_url: "",
        pdf_name: "",
      };
      setForm(f);
      setDays(dayLabelsForStructure(f.structure).map((label, i) => ({ day_label: label, sort_order: i })));
    }
  }, [open, initial, clientId]);

  if (!form) return null;
  const set = (k: string, v: any) => setForm({ ...form, [k]: v });

  const uploadPdf = async (file: File) => {
    if (!form.client_id) return toast.error("Pick a client first");
    if (file.type !== "application/pdf") return toast.error("PDF files only");
    if (file.size > 25 * 1024 * 1024) return toast.error("Max 25MB");
    const path = `${form.client_id}/${Date.now()}-${file.name.replace(/[^a-z0-9.\-_]/gi, "_")}`;
    const { error } = await supabase.storage.from("nutrition-plans").upload(path, file, { upsert: true, contentType: "application/pdf" });
    if (error) return toast.error(error.message);
    setForm({ ...form, pdf_url: path, pdf_name: file.name });
    toast.success("PDF uploaded");
  };

  const removePdf = async () => {
    if (form.pdf_url) await supabase.storage.from("nutrition-plans").remove([form.pdf_url]);
    setForm({ ...form, pdf_url: "", pdf_name: "" });
  };

  const updateStructure = (v: string) => {
    setForm({ ...form, structure: v });
    if (!initial) setDays(dayLabelsForStructure(v).map((label, i) => ({ day_label: label, sort_order: i })));
  };

  const updateDay = (i: number, k: keyof Day, v: any) => {
    const next = [...days];
    (next[i] as any)[k] = v === "" ? null : k === "day_label" || k === "notes" ? v : Number(v);
    setDays(next);
  };

  const addDay = () => setDays([...days, { day_label: `Day ${days.length + 1}`, sort_order: days.length }]);
  const removeDay = (i: number) => setDays(days.filter((_, idx) => idx !== i));

  const save = async () => {
    if (!form.client_id) return toast.error("Pick a client first");
    setSaving(true);
    const payload: any = {
      client_id: form.client_id,
      phase: form.phase,
      custom_phase: form.phase === "Custom" ? form.custom_phase : null,
      goal: form.goal,
      custom_goal: form.goal === "Custom" ? form.custom_goal : null,
      structure: form.structure,
      start_date: form.start_date,
      end_date: form.end_date || null,
      status: form.status,
      ending_soon_days: Number(form.ending_soon_days) || 7,
      client_notes: form.client_notes,
      admin_notes: form.admin_notes,
      visible_to_client: form.visible_to_client,
      pdf_url: form.pdf_url || null,
      pdf_name: form.pdf_name || null,
      last_updated_at: new Date().toISOString(),
    };
    let targetId = form.id;
    if (targetId) {
      const { error } = await supabase.from("nutrition_targets").update(payload).eq("id", targetId);
      if (error) { setSaving(false); return toast.error(error.message); }
      await supabase.from("nutrition_target_days").delete().eq("target_id", targetId);
    } else {
      const { data, error } = await supabase.from("nutrition_targets").insert(payload).select("id").single();
      if (error || !data) { setSaving(false); return toast.error(error?.message ?? "Failed"); }
      targetId = data.id;
    }
    if (days.length) {
      const rows = days.map((d, i) => ({ ...d, id: undefined, target_id: targetId, sort_order: i }));
      const { error } = await supabase.from("nutrition_target_days").insert(rows);
      if (error) { setSaving(false); return toast.error(error.message); }
    }
    setSaving(false);
    toast.success(form.id ? "Updated" : "Created");
    qc.invalidateQueries({ queryKey: ["nutrition-targets"] });
    qc.invalidateQueries({ queryKey: ["nutrition-targets", form.client_id] });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{form.id ? "Edit Nutrition Targets" : "Create Nutrition Targets"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 md:grid-cols-2">
          {!clientId && (
            <div className="md:col-span-2">
              <Label>Client</Label>
              <Select value={form.client_id} onValueChange={(v) => set("client_id", v)}>
                <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
                <SelectContent>{clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label>Phase</Label>
            <Select value={form.phase} onValueChange={(v) => set("phase", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{NUTRITION_PHASES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Goal</Label>
            <Select value={form.goal} onValueChange={(v) => set("goal", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{NUTRITION_GOALS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {form.phase === "Custom" && <div><Label>Custom phase</Label><Input value={form.custom_phase ?? ""} onChange={(e) => set("custom_phase", e.target.value)} /></div>}
          {form.goal === "Custom" && <div><Label>Custom goal</Label><Input value={form.custom_goal ?? ""} onChange={(e) => set("custom_goal", e.target.value)} /></div>}
          <div>
            <Label>Structure</Label>
            <Select value={form.structure} onValueChange={updateStructure}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{NUTRITION_STRUCTURES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Status</Label>
            <Select value={form.status} onValueChange={(v) => set("status", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{TARGET_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Start date</Label><Input type="date" value={form.start_date} onChange={(e) => set("start_date", e.target.value)} /></div>
          <div><Label>End date</Label><Input type="date" value={form.end_date} onChange={(e) => set("end_date", e.target.value)} /></div>
          <div><Label>Ending soon (days)</Label><Input type="number" value={form.ending_soon_days} onChange={(e) => set("ending_soon_days", e.target.value)} /></div>
          <div className="flex items-center justify-between rounded-md border border-border bg-secondary/30 px-3 py-2">
            <Label className="text-xs">Visible to client</Label>
            <Switch checked={form.visible_to_client} onCheckedChange={(v) => set("visible_to_client", v)} />
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs uppercase tracking-widest text-muted-foreground">Day Targets</h4>
            <Button size="sm" variant="outline" onClick={addDay}>+ Add day</Button>
          </div>
          {days.map((d, i) => (
            <div key={i} className="rounded-md border border-border bg-secondary/20 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Input value={d.day_label} onChange={(e) => updateDay(i, "day_label", e.target.value)} className="max-w-xs font-semibold" />
                {days.length > 1 && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => removeDay(i)}>Remove</Button>}
              </div>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-7">
                {(["calories","protein","carbs","fats","fibre","water","steps"] as const).map((k) => (
                  <div key={k}><Label className="text-[10px] uppercase">{k}</Label><Input type="number" value={d[k] ?? ""} onChange={(e) => updateDay(i, k, e.target.value)} /></div>
                ))}
              </div>
              <Textarea rows={2} placeholder="Notes for this day" value={d.notes ?? ""} onChange={(e) => updateDay(i, "notes", e.target.value)} />
            </div>
          ))}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div><Label>Coach notes (visible to client)</Label><Textarea rows={3} value={form.client_notes ?? ""} onChange={(e) => set("client_notes", e.target.value)} /></div>
          <div><Label>Private admin notes</Label><Textarea rows={3} value={form.admin_notes ?? ""} onChange={(e) => set("admin_notes", e.target.value)} /></div>
        </div>

        <div className="rounded-md border border-border bg-secondary/20 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs uppercase tracking-widest text-muted-foreground">Nutrition Plan PDF (visible to client)</Label>
            {form.pdf_url && (
              <Button size="sm" variant="ghost" className="text-destructive" onClick={removePdf}><X className="mr-1 h-3 w-3" /> Remove</Button>
            )}
          </div>
          {form.pdf_url ? (
            <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm">
              <FileText className="h-4 w-4 text-primary" />
              <span className="font-semibold truncate">{form.pdf_name || "nutrition-plan.pdf"}</span>
            </div>
          ) : (
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border bg-card px-3 py-6 text-sm text-muted-foreground hover:bg-secondary/30">
              <Upload className="h-4 w-4" /> Click to upload PDF
              <input type="file" accept="application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && uploadPdf(e.target.files[0])} />
            </label>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving} className="bg-gradient-primary font-bold uppercase">{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}