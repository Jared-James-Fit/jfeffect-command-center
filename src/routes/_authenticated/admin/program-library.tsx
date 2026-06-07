import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, BookOpen, UserPlus, Archive as ArchiveIcon } from "lucide-react";
import { toast } from "sonner";
import { listTemplates, createTemplate, applyTemplateToClient, type TemplateType, type TrainingStyle } from "@/lib/pl-programs";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/admin/program-library")({ component: ProgramLibrary });

const TEMPLATE_TYPES: { v: TemplateType | "all"; label: string }[] = [
  { v: "all", label: "All Types" },
  { v: "full_prep", label: "Full Prep" },
  { v: "block", label: "Block" },
  { v: "week", label: "Week" },
  { v: "day", label: "Day" },
  { v: "exercise_row", label: "Exercise Row" },
];
const STYLES: { v: TrainingStyle | "all"; label: string }[] = [
  { v: "all", label: "All Styles" },
  { v: "powerlifting", label: "Powerlifting" },
  { v: "bodybuilding", label: "Bodybuilding / Hypertrophy" },
  { v: "strength", label: "Strength" },
  { v: "lifestyle", label: "Lifestyle" },
  { v: "hybrid", label: "Hybrid" },
  { v: "rehab", label: "Rehab / Pivot" },
  { v: "conditioning", label: "Conditioning" },
  { v: "custom", label: "Custom" },
];

function ProgramLibrary() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [type, setType] = useState<TemplateType | "all">("all");
  const [style, setStyle] = useState<TrainingStyle | "all">("all");
  const [open, setOpen] = useState(false);
  const [assign, setAssign] = useState<any | null>(null);

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["pl-templates", q, type, style],
    queryFn: () => listTemplates({ q, type, style }),
  });

  return (
    <>
      <PageHeader title="Program Library" subtitle="Reusable preps, blocks, weeks, days, and exercise rows" />
      <div className="p-6 md:p-8 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Input placeholder="Search by name…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
          <Select value={type} onValueChange={(v) => setType(v as any)}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>{TEMPLATE_TYPES.map((t) => <SelectItem key={t.v} value={t.v}>{t.label}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={style} onValueChange={(v) => setStyle(v as any)}>
            <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
            <SelectContent>{STYLES.map((s) => <SelectItem key={s.v} value={s.v}>{s.label}</SelectItem>)}</SelectContent>
          </Select>
          <div className="ml-auto">
            <Button onClick={() => setOpen(true)}><Plus className="mr-2 h-4 w-4" /> New Template</Button>
          </div>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : templates.length === 0 ? (
          <Card className="p-12 text-center">
            <BookOpen className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">No templates yet. Create your first reusable program.</p>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {templates.map((t: any) => (
              <Card key={t.id} className="p-4 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-bold">{t.name}</div>
                  <Badge variant="outline" className="text-[10px]">{t.template_type}</Badge>
                </div>
                <div className="flex flex-wrap gap-1 text-[10px]">
                  <Badge variant="secondary">{t.training_style}</Badge>
                  {t.training_focus && <Badge variant="outline">{t.training_focus}</Badge>}
                  {t.weeks && <Badge variant="outline">{t.weeks}w</Badge>}
                </div>
                {t.notes && <p className="text-xs text-muted-foreground line-clamp-2">{t.notes}</p>}
                <div className="mt-auto flex gap-2 pt-2">
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => setAssign(t)}>
                    <UserPlus className="mr-1 h-3 w-3" /> Assign
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <NewTemplateDialog open={open} onOpenChange={setOpen} onCreated={() => qc.invalidateQueries({ queryKey: ["pl-templates"] })} />
      <AssignTemplateDialog template={assign} onClose={() => setAssign(null)} />
    </>
  );
}

function NewTemplateDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: () => void }) {
  const [form, setForm] = useState({ name: "", template_type: "block" as TemplateType, training_style: "powerlifting" as TrainingStyle, training_focus: "", weeks: 4, notes: "" });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>New Program Template</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. 4 Week Volume Block" /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Type</Label>
              <Select value={form.template_type} onValueChange={(v) => setForm({ ...form, template_type: v as TemplateType })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{TEMPLATE_TYPES.filter(t => t.v !== "all").map((t) => <SelectItem key={t.v} value={t.v}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Style</Label>
              <Select value={form.training_style} onValueChange={(v) => setForm({ ...form, training_style: v as TrainingStyle })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{STYLES.filter(s => s.v !== "all").map((s) => <SelectItem key={s.v} value={s.v}>{s.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Focus</Label><Input value={form.training_focus} onChange={(e) => setForm({ ...form, training_focus: e.target.value })} placeholder="Volume / Strength…" /></div>
            <div><Label>Weeks</Label><Input type="number" value={form.weeks} onChange={(e) => setForm({ ...form, weeks: parseInt(e.target.value) || 0 })} /></div>
          </div>
          <div><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={async () => {
            if (!form.name) return toast.error("Name required");
            try {
              await createTemplate({ name: form.name, template_type: form.template_type, training_style: form.training_style, training_focus: form.training_focus || undefined, weeks: form.weeks || undefined, notes: form.notes || undefined, payload: { weeks_data: [] } });
              toast.success("Template created");
              onCreated();
              onOpenChange(false);
            } catch (e: any) { toast.error(e.message); }
          }}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssignTemplateDialog({ template, onClose }: { template: any; onClose: () => void }) {
  const [clientId, setClientId] = useState<string>("");
  const { data: clients = [] } = useQuery({
    queryKey: ["clients-min"],
    queryFn: async () => {
      const { data } = await supabase.from("clients").select("id, full_name").eq("archived", false).order("full_name");
      return data ?? [];
    },
    enabled: !!template,
  });
  if (!template) return null;
  return (
    <Dialog open={!!template} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Assign “{template.name}” to a client</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Client</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger><SelectValue placeholder="Choose…" /></SelectTrigger>
              <SelectContent>{(clients as any[]).map((c) => <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">This creates a fresh copy of the template as a new block for the client. You can edit it without affecting the library.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={async () => {
            if (!clientId) return toast.error("Pick a client");
            try {
              await applyTemplateToClient({ templateId: template.id, clientId });
              toast.success("Template assigned");
              onClose();
            } catch (e: any) { toast.error(e.message); }
          }}>Assign</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}