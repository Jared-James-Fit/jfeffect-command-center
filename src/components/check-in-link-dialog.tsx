import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { CHECK_IN_TYPES, CHECK_IN_FREQUENCIES, type CheckInLink, upsertCheckInLink } from "@/lib/check-ins";

const DAY_OPTIONS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday","Custom"];

export function CheckInLinkDialog({ open, onOpenChange, initial, onSaved }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: Partial<CheckInLink> | null;
  onSaved?: () => void;
}) {
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({
      check_in_type: "Weekly Check-In",
      frequency: "Weekly",
      visible_to_client: true,
      active: true,
      require_video: true,
      require_photos: false,
      ...(initial ?? {}),
    });
  }, [open, initial]);

  function set(k: string, v: any) { setForm((p: any) => ({ ...p, [k]: v })); }

  async function save() {
    if (!form.title?.trim()) return toast.error("Title required");
    if (!form.url?.trim()) return toast.error("Link URL required");
    try { new URL(form.url); } catch { return toast.error("Enter a valid URL"); }
    setSaving(true);
    try {
      await upsertCheckInLink(form);
      toast.success(form.id ? "Updated" : "Created");
      onOpenChange(false);
      onSaved?.();
    } catch (e: any) { toast.error(e?.message ?? "Save failed"); }
    finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{form.id ? "Edit Check-In Link" : "New Check-In Link"}</DialogTitle></DialogHeader>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <Label>Title *</Label>
            <Input value={form.title ?? ""} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Weekly Check-In — Powerlifting" />
          </div>
          <div className="md:col-span-2">
            <Label>Fillout / form link *</Label>
            <Input value={form.url ?? ""} onChange={(e) => set("url", e.target.value)} placeholder="https://forms.fillout.com/…" />
          </div>
          <div>
            <Label>Check-in type</Label>
            <Select value={form.check_in_type} onValueChange={(v) => set("check_in_type", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CHECK_IN_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Frequency</Label>
            <Select value={form.frequency} onValueChange={(v) => set("frequency", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CHECK_IN_FREQUENCIES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {form.check_in_type === "Custom" && (
            <div className="md:col-span-2">
              <Label>Custom type</Label>
              <Input value={form.custom_type ?? ""} onChange={(e) => set("custom_type", e.target.value)} />
            </div>
          )}
          <div>
            <Label>Due day</Label>
            <Select value={form.due_day ?? ""} onValueChange={(v) => set("due_day", v)}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>{DAY_OPTIONS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex items-end gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={!!form.require_video} onCheckedChange={(v) => set("require_video", v)} />
              Check-in video required
            </label>
          </div>
          <div className="flex items-end gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={!!form.require_photos} onCheckedChange={(v) => set("require_photos", v)} />
              Progress photos required
            </label>
          </div>
          <div className="flex items-end gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={!!form.visible_to_client} onCheckedChange={(v) => set("visible_to_client", v)} />
              Visible to client
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={!!form.active} onCheckedChange={(v) => set("active", v)} />
              Active
            </label>
          </div>
          <div className="md:col-span-2">
            <Label>Description</Label>
            <Textarea rows={2} value={form.description ?? ""} onChange={(e) => set("description", e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <Label>Notes for client</Label>
            <Textarea rows={2} value={form.notes_client ?? ""} onChange={(e) => set("notes_client", e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <Label>Private admin notes</Label>
            <Textarea rows={2} value={form.notes_admin ?? ""} onChange={(e) => set("notes_admin", e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}