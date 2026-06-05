import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { FORM_TYPES, type FormLink, upsertForm } from "@/lib/form-links";

export function FormLinkDialog({ open, onOpenChange, initial, onSaved }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: Partial<FormLink> | null;
  onSaved?: () => void;
}) {
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({ form_type: "Custom", visible_to_client: false, active: true, ...(initial ?? {}) });
  }, [open, initial]);

  function set(k: string, v: any) { setForm((p: any) => ({ ...p, [k]: v })); }

  async function save() {
    if (!form.title?.trim()) return toast.error("Title required");
    if (!form.url?.trim()) return toast.error("Form URL required");
    try { new URL(form.url); } catch { return toast.error("Enter a valid URL"); }
    setSaving(true);
    try {
      await upsertForm(form);
      toast.success(form.id ? "Updated" : "Created");
      onOpenChange(false);
      onSaved?.();
    } catch (e: any) { toast.error(e?.message ?? "Save failed"); }
    finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{form.id ? "Edit Form" : "New Form"}</DialogTitle></DialogHeader>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <Label>Title *</Label>
            <Input value={form.title ?? ""} onChange={(e) => set("title", e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <Label>Form link *</Label>
            <Input value={form.url ?? ""} onChange={(e) => set("url", e.target.value)} placeholder="https://forms.fillout.com/…" />
          </div>
          <div>
            <Label>Form type</Label>
            <Select value={form.form_type} onValueChange={(v) => set("form_type", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{FORM_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {form.form_type === "Custom" && (
            <div>
              <Label>Custom type</Label>
              <Input value={form.custom_type ?? ""} onChange={(e) => set("custom_type", e.target.value)} />
            </div>
          )}
          <div className="md:col-span-2">
            <Label>Description</Label>
            <Textarea rows={2} value={form.description ?? ""} onChange={(e) => set("description", e.target.value)} />
          </div>
          <div className="flex items-end gap-6 md:col-span-2">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={!!form.visible_to_client} onCheckedChange={(v) => set("visible_to_client", v)} />
              Visible to all clients
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={!!form.active} onCheckedChange={(v) => set("active", v)} />
              Active
            </label>
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