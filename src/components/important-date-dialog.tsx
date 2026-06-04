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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DATE_TYPES, type ImportantDate } from "@/lib/important-dates";
import type { TrainingPhase } from "@/lib/training-phases";
import { differenceInCalendarDays, parseISO } from "date-fns";

const STATUSES = ["Active", "Completed", "Archived"];

type Editing = Partial<ImportantDate> & { client_id: string };

export function ImportantDateDialog({
  open,
  onOpenChange,
  clientId,
  date,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientId: string;
  date?: ImportantDate | null;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Editing>({ client_id: clientId });

  const { data: phases = [] } = useQuery({
    queryKey: ["client-phases", clientId],
    queryFn: async () => {
      const { data } = await supabase
        .from("training_phases").select("id, title, phase_type, custom_phase_name")
        .eq("client_id", clientId).order("start_date", { ascending: false });
      return (data ?? []) as Pick<TrainingPhase, "id" | "title" | "phase_type" | "custom_phase_name">[];
    },
    enabled: open,
  });

  useEffect(() => {
    if (open) {
      setForm(date ? { ...date } : {
        client_id: clientId,
        title: "",
        date_type: "Competition",
        target_date: "",
        status: "Active",
        visible_to_client: true,
        approaching_soon_days: 14,
      });
    }
  }, [open, date, clientId]);

  const set = (k: keyof Editing, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const stats = (() => {
    if (!form.target_date) return null;
    try {
      const t = parseISO(form.target_date);
      const today = new Date();
      const daysRemaining = differenceInCalendarDays(t, today);
      let totalDays: number | null = null;
      let currentWeek: number | null = null;
      let totalWeeks: number | null = null;
      if (form.start_date) {
        const s = parseISO(form.start_date);
        totalDays = Math.max(1, differenceInCalendarDays(t, s) + 1);
        totalWeeks = Math.max(1, Math.ceil(totalDays / 7));
        const elapsed = differenceInCalendarDays(today, s) + 1;
        currentWeek = Math.min(totalWeeks, Math.max(1, Math.ceil(elapsed / 7)));
      }
      return { daysRemaining, totalDays, totalWeeks, currentWeek };
    } catch { return null; }
  })();

  const save = async () => {
    if (!form.title) return toast.error("Title is required");
    if (!form.target_date) return toast.error("Target date is required");
    const payload = {
      client_id: clientId,
      title: form.title!,
      date_type: form.date_type ?? "Competition",
      custom_type: form.date_type === "Custom" ? form.custom_type ?? null : null,
      target_date: form.target_date!,
      start_date: form.start_date || null,
      countdown_label: form.countdown_label ?? null,
      notes: form.notes ?? null,
      phase_id: form.phase_id || null,
      program_link: form.program_link ?? null,
      status: form.status ?? "Active",
      visible_to_client: form.visible_to_client ?? true,
      approaching_soon_days: form.approaching_soon_days ?? 14,
    };
    const { error } = form.id
      ? await (supabase.from("important_dates") as any).update(payload).eq("id", form.id)
      : await (supabase.from("important_dates") as any).insert(payload);
    if (error) return toast.error(error.message);
    toast.success(form.id ? "Important date updated" : "Important date added");
    qc.invalidateQueries({ queryKey: ["important-dates"] });
    qc.invalidateQueries({ queryKey: ["client-important-dates", clientId] });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{form.id ? "Edit important date" : "New important date"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <Label>Title</Label>
            <Input value={form.title ?? ""} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Nationals Prep" />
          </div>
          <div>
            <Label>Date type</Label>
            <Select value={form.date_type} onValueChange={(v) => set("date_type", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {DATE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
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
          {form.date_type === "Custom" && (
            <div className="md:col-span-2">
              <Label>Custom type</Label>
              <Input value={form.custom_type ?? ""} onChange={(e) => set("custom_type", e.target.value)} />
            </div>
          )}
          <div>
            <Label>Target date</Label>
            <Input type="date" value={form.target_date ?? ""} onChange={(e) => set("target_date", e.target.value)} />
          </div>
          <div>
            <Label>Prep start date (optional)</Label>
            <Input type="date" value={form.start_date ?? ""} onChange={(e) => set("start_date", e.target.value)} />
          </div>
          <div>
            <Label>Countdown label</Label>
            <Input value={form.countdown_label ?? ""} onChange={(e) => set("countdown_label", e.target.value)} placeholder="e.g. days until meet" />
          </div>
          <div>
            <Label>"Approaching soon" threshold (days)</Label>
            <Input type="number" min={1} value={form.approaching_soon_days ?? 14} onChange={(e) => set("approaching_soon_days", parseInt(e.target.value, 10) || 14)} />
          </div>
          <div>
            <Label>Related training phase</Label>
            <Select value={form.phase_id ?? "none"} onValueChange={(v) => set("phase_id", v === "none" ? null : v)}>
              <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {phases.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.title || p.custom_phase_name || p.phase_type}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Program link</Label>
            <Input value={form.program_link ?? ""} onChange={(e) => set("program_link", e.target.value)} placeholder="https://…" />
          </div>
          {stats && (
            <div className="md:col-span-2 grid grid-cols-2 md:grid-cols-4 gap-2 rounded-md border border-border bg-secondary/30 p-3 text-xs">
              <div><div className="text-muted-foreground">Days until</div><div className="font-semibold">{stats.daysRemaining < 0 ? `${Math.abs(stats.daysRemaining)}d past` : `${stats.daysRemaining}d`}</div></div>
              {stats.totalDays != null && <div><div className="text-muted-foreground">Total days</div><div className="font-semibold">{stats.totalDays}</div></div>}
              {stats.totalWeeks != null && <div><div className="text-muted-foreground">Total weeks</div><div className="font-semibold">{stats.totalWeeks}</div></div>}
              {stats.currentWeek != null && stats.totalWeeks != null && <div><div className="text-muted-foreground">Current week</div><div className="font-semibold">{stats.currentWeek} / {stats.totalWeeks}</div></div>}
            </div>
          )}
          <div className="md:col-span-2 flex items-center justify-between rounded-md border border-border bg-secondary/30 px-3 py-2">
            <div>
              <Label className="text-xs">Visible to client</Label>
              <p className="text-[11px] text-muted-foreground">When on, this date appears on the client's dashboard.</p>
            </div>
            <Switch checked={form.visible_to_client ?? true} onCheckedChange={(v) => set("visible_to_client", v)} />
          </div>
          <div className="md:col-span-2">
            <Label>Notes</Label>
            <Textarea rows={3} value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="bg-gradient-primary font-bold uppercase" onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}