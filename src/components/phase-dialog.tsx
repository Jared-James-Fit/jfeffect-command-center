import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { PHASE_TYPES, CUSTOM_PHASE_SUGGESTIONS, type TrainingPhase } from "@/lib/training-phases";
import { differenceInCalendarDays, parseISO, addDays, format } from "date-fns";

const STATUSES = ["Active", "Upcoming", "Completed", "Archived"];
const LENGTH_PRESETS = ["1", "2", "3", "4", "5", "6", "8", "10", "12", "custom"] as const;

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
  const [preset, setPreset] = useState<string>("4");

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
      let w = "4";
      if (init.start_date && init.end_date) {
        const d = differenceInCalendarDays(parseISO(init.end_date), parseISO(init.start_date)) + 1;
        w = String(Math.max(1, Math.round(d / 7)));
      }
      setWeeks(w);
      setPreset((LENGTH_PRESETS as readonly string[]).includes(w) ? w : "custom");
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
    setPreset((LENGTH_PRESETS as readonly string[]).includes(w) ? w : "custom");
  };

  const setPresetAndApply = (p: string) => {
    setPreset(p);
    if (p === "custom") return;
    setWeeksAndEnd(p);
  };

  const setStart = (v: string) => {
    set("start_date", v);
    if (preset !== "custom") {
      const n = parseInt(weeks, 10);
      if (!isNaN(n) && n > 0 && v) {
        const end = addDays(parseISO(v), n * 7 - 1);
        set("end_date", format(end, "yyyy-MM-dd"));
      }
    }
  };

  const setEnd = (v: string) => {
    set("end_date", v);
    if (form.start_date && v) {
      const d = differenceInCalendarDays(parseISO(v), parseISO(form.start_date)) + 1;
      const w = String(Math.max(1, Math.round(d / 7)));
      setWeeks(w);
      setPreset((LENGTH_PRESETS as readonly string[]).includes(w) ? w : "custom");
    }
  };

  const stats = (() => {
    if (!form.start_date || !form.end_date) return null;
    try {
      const s = parseISO(form.start_date);
      const e = parseISO(form.end_date);
      const today = new Date();
      const totalDays = Math.max(1, differenceInCalendarDays(e, s) + 1);
      const totalWeeks = Math.max(1, Math.ceil(totalDays / 7));
      const elapsed = differenceInCalendarDays(today, s) + 1;
      const daysRemaining = differenceInCalendarDays(e, today);
      const currentWeek = Math.min(totalWeeks, Math.max(1, Math.ceil(elapsed / 7)));
      const percent = Math.min(100, Math.max(0, Math.round((elapsed / totalDays) * 100)));
      return { totalDays, totalWeeks, currentWeek, daysRemaining, percent };
    } catch { return null; }
  })();

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
      visible_to_client: form.visible_to_client ?? true,
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
            <Input type="date" value={form.end_date ?? ""} onChange={(e) => setEnd(e.target.value)} />
          </div>
          <div>
            <Label>Quick length</Label>
            <Select value={preset} onValueChange={setPresetAndApply}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {LENGTH_PRESETS.filter((p) => p !== "custom").map((p) => (
                  <SelectItem key={p} value={p}>{p} {p === "1" ? "week" : "weeks"}</SelectItem>
                ))}
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Length (weeks)</Label>
            <Input type="number" min={1} value={weeks} onChange={(e) => setWeeksAndEnd(e.target.value)} />
          </div>
          <p className="md:col-span-2 -mt-1 text-xs text-muted-foreground">
            Dates auto-fill from phase length, but you can manually adjust them anytime.
          </p>
          {stats && (
            <div className="md:col-span-2 grid grid-cols-2 md:grid-cols-5 gap-2 rounded-md border border-border bg-secondary/30 p-3 text-xs">
              <div><div className="text-muted-foreground">Total days</div><div className="font-semibold">{stats.totalDays}</div></div>
              <div><div className="text-muted-foreground">Total weeks</div><div className="font-semibold">{stats.totalWeeks}</div></div>
              <div><div className="text-muted-foreground">Current week</div><div className="font-semibold">{stats.currentWeek}</div></div>
              <div><div className="text-muted-foreground">Days remaining</div><div className="font-semibold">{stats.daysRemaining < 0 ? `${Math.abs(stats.daysRemaining)}d over` : stats.daysRemaining}</div></div>
              <div><div className="text-muted-foreground">Complete</div><div className="font-semibold">{stats.percent}%</div></div>
            </div>
          )}
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
          <div className="md:col-span-2 flex items-center justify-between rounded-md border border-border bg-secondary/30 px-3 py-2">
            <div>
              <Label className="text-xs">Visible to client</Label>
              <p className="text-[11px] text-muted-foreground">When on, this phase appears in the client's dashboard.</p>
            </div>
            <Switch checked={form.visible_to_client ?? true} onCheckedChange={(v) => set("visible_to_client", v)} />
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