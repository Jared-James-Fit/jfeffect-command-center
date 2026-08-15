import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { ExternalLink, Plus, Trash2, Settings as SettingsIcon, Eye } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/apps")({
  component: AppsHub,
});

const EXTERNAL_TOOLS: { name: string; url: string }[] = [
  { name: "Stripe", url: "https://dashboard.stripe.com" },
  { name: "Google Drive", url: "https://drive.google.com" },
  { name: "Google Sheets", url: "https://sheets.google.com" },
  { name: "Google Calendar", url: "https://calendar.google.com" },
  { name: "Fillout", url: "https://fillout.com" },
  { name: "SignNow", url: "https://signnow.com" },
];

function AppsHub() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: shortcuts = [] } = useQuery({
    queryKey: ["shortcuts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("app_shortcuts").select("*").order("sort_order");
      if (error) throw error;
      return data;
    },
  });

  const del = async (id: string) => {
    await supabase.from("app_shortcuts").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["shortcuts"] });
  };

  return (
    <>
      <SettingsTabs />
      <PageHeader
        title="Apps & Tools"
        subtitle="One-click access to every tool in your coaching stack."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="bg-gradient-primary font-bold uppercase"><Plus className="mr-2 h-4 w-4" />Add</Button>
            </DialogTrigger>
            <NewShortcut onClose={() => setOpen(false)} onCreated={() => qc.invalidateQueries({ queryKey: ["shortcuts"] })} />
          </Dialog>
        }
      />
      <div className="space-y-3 px-6 pt-4 md:px-8">
        <h2 className="text-[13px] font-bold tracking-tight">Built-in tools</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {EXTERNAL_TOOLS.map((t) => (
            <a
              key={t.name}
              href={t.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between gap-2 rounded-md border border-border bg-secondary/40 px-2.5 py-2 text-xs font-semibold transition hover:border-primary hover:bg-secondary"
            >
              <span className="truncate">{t.name}</span>
              <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
            </a>
          ))}
          <Link to="/admin/floating-bar" className="flex items-center gap-2 rounded-md border border-border bg-secondary/40 px-2.5 py-2 text-xs font-semibold transition hover:border-primary hover:bg-secondary">
            <SettingsIcon className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Customize navigation</span>
          </Link>
          <Link to="/admin/client-pov" className="flex items-center gap-2 rounded-md border border-border bg-secondary/40 px-2.5 py-2 text-xs font-semibold transition hover:border-primary hover:bg-secondary">
            <Eye className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">View as client</span>
          </Link>
        </div>
      </div>
      <div className="grid gap-4 p-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 md:p-8">
        {shortcuts.map((s) => (
          <Card key={s.id} className="group border-border bg-card p-5 transition hover:border-primary hover:shadow-glow">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-bold">{s.name}</div>
                {s.description && <div className="text-xs text-muted-foreground">{s.description}</div>}
              </div>
              <Button variant="ghost" size="sm" onClick={() => del(s.id)} className="opacity-0 group-hover:opacity-100"><Trash2 className="h-3 w-3" /></Button>
            </div>
            <a href={s.url} target="_blank" rel="noreferrer">
              <Button className="mt-4 w-full" variant="outline" size="sm"><ExternalLink className="mr-2 h-3 w-3" />Open</Button>
            </a>
            {s.notes && <p className="mt-3 text-xs text-muted-foreground">{s.notes}</p>}
          </Card>
        ))}
      </div>
    </>
  );
}

function NewShortcut({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ name: "", url: "", description: "", notes: "" });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from("app_shortcuts").insert(form);
    if (error) return toast.error(error.message);
    toast.success("Added");
    onCreated();
    onClose();
  };
  return (
    <DialogContent>
      <DialogHeader><DialogTitle>Add shortcut</DialogTitle></DialogHeader>
      <form onSubmit={submit} className="space-y-3">
        <div><Label>Name *</Label><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div><Label>URL *</Label><Input required value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} /></div>
        <div><Label>Description</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
        <div><Label>Private notes</Label><Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" className="bg-gradient-primary font-bold uppercase">Add</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}