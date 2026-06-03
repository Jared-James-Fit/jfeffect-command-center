import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { PHASE_TYPES, CUSTOM_PHASE_SUGGESTIONS, type TrainingPhase } from "@/lib/training-phases";
import { differenceInCalendarDays, parseISO, addDays, format } from "date-fns";

const STATUSES = ["Active", "Upcoming", "Completed", "Archived"];

type Editing = Partial<TrainingPhase> & { client_id: string };

export function PhaseDialog({
  open,
  onOpenChange,
  clientId,
  phase,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientId: string;
  phase?: TrainingPhase | null;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Editing>({ client_id: clientId });
  const [weeks, setWeeks] = useState<string>("");

  useEffect(() => {
    if (open) {
      const init: Editing = phase
        ? { ...phase }
        : {
            client_id: clientId,
            title: "",
            phase_type: "Load Build",
            start_date: format(new Date(), "yyyy-MM-dd"),
            end_date: format(addDays(new Date(), 28), "yyyy-MM-dd"),
            status: "Active",
            ending_soon_days: 7,
          };
      setForm(init);
      if (init.start_date && init.end_date) {
        const d = differenceInCalendarDays(parseISO(init.end_date), parseISO(init.start_date)) + 1;
        setWeeks(String(Math.max(1, Math.round(d / 7))));
      } else setWeeks("4");
    }
  }, [open, phase, clientId]);

  const set = (k: keyof Editing, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const setWeeksAndEnd = (w: string) => {
    setWeeks(w);
    const n = parseInt(w, 10);
    if (!isNaN(n) && n > 0 && form.start_date) {
      const end = addDays(parseISO(form.start_date), n * 7 - 1);
      set("end_date", format(end, "yyyy-MM-dd"));
    }
  };

  const setStart = (v: string) => {
    set("start_date", v);
    const n = parseInt(weeks, 10);
    if (!isNaN(n) && n > 0 && v) {
      const end = addDays(parseISO(v), n * 7 - 1);
      set("end_date", format(end, "yyyy-MM-dd"));
    }
  };

  const save = async () => {
    if (!form.phase_type || !form.start_date || !form.end_date) {
      return toast.error("Phase type, start, and end date are required");
    }
    const title =
      form.title ||
      (form.phase_type === "Custom Phase" ? form.custom_phase_name ?? "Custom Phase" : form.phase_type!);
    const payload = {
      client_id: clientId,
      title,
      phase_type: form.phase_type!,
      custom_phase_name: form.phase_type === "Custom Phase" ? form.custom_phase_name ?? null : null,
      start_date: form.start_date!,
      end_date: form.end_date!,
      current_week: form.current_week ?? null,
      training_goal: form.training_goal ?? null,
      program_link: form.program_link ?? null,
      notes: form.notes ?? null,
      status: form.status ?? "Active",
      ending_soon_days: form.ending_soon_days ?? 7,
    };
    const { error } = form.id
      ? await supabase.from("training_phases").update(payload).eq("id", form.id)
      : await supabase.from("training_phases").insert(payload);
    if (error) return toast.error(error.message);
    toast.success(form.id ? "Phase updated" : "Phase added");
    qc.invalidateQueries({ queryKey: ["training-phases"] });
    qc.invalidateQueries({ queryKey: ["client-phases", clientId] });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{form.id ? "Edit training phase" : "New training phase"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <Label>Phase title</Label>
            <Input value={form.title ?? ""} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Spring Strength Block" />
          </div>
          <div>
            <Label>Phase type</Label>
            <Select value={form.phase_type} onValueChange={(v) => set("phase_type", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PHASE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Status</Label>
            <Select value={form.status ?? "Active"} onValueChange={(v) => set("status", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {form.phase_type === "Custom Phase" && (
            <div className="md:col-span-2">
              <Label>Custom phase name</Label>
              <Input
                list="custom-phase-suggestions"
                value={form.custom_phase_name ?? ""}
                onChange={(e) => set("custom_phase_name", e.target.value)}
                placeholder="Type a custom phase name"
              />
              <datalist id="custom-phase-suggestions">
                {CUSTOM_PHASE_SUGGESTIONS.map((s) => <option key={s} value={s} />)}
              </datalist>
            </div>
          )}
          <div>
            <Label>Start date</Label>
            <Input type="date" value={form.start_date ?? ""} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div>
            <Label>End date</Label>
            <Input type="date" value={form.end_date ?? ""} onChange={(e) => set("end_date", e.target.value)} />
          </div>
          <div>
            <Label>Length (weeks)</Label>
            <Input type="number" min={1} value={weeks} onChange={(e) => setWeeksAndEnd(e.target.value)} />
          </div>
          <div>
            <Label>Current week</Label>
            <Input type="number" min={1} value={form.current_week ?? ""} onChange={(e) => set("current_week", e.target.value ? parseInt(e.target.value, 10) : null)} />
          </div>
          <div>
            <Label>"Ending soon" threshold (days)</Label>
            <Input type="number" min={1} value={form.ending_soon_days ?? 7} onChange={(e) => set("ending_soon_days", parseInt(e.target.value, 10) || 7)} />
          </div>
          <div>
            <Label>Program link</Label>
            <Input value={form.program_link ?? ""} onChange={(e) => set("program_link", e.target.value)} placeholder="https://…" />
          </div>
          <div className="md:col-span-2">
            <Label>Training goal</Label>
            <Textarea rows={2} value={form.training_goal ?? ""} onChange={(e) => set("training_goal", e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <Label>Notes</Label>
            <Textarea rows={3} value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="bg-gradient-primary font-bold uppercase" onClick={save}>Save phase</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}