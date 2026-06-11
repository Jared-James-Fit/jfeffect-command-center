import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Copy, Archive, Trash2, Pencil, Flame, Star, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { listWarmupProtocols, WARMUP_CATEGORIES, type WarmupProtocol, type WarmupSection } from "@/lib/warmups";

export const Route = createFileRoute("/_authenticated/admin/warmup-protocols")({ component: WarmupProtocolsAdmin });

const sb = supabase as any;

function WarmupProtocolsAdmin() {
  const qc = useQueryClient();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [editing, setEditing] = useState<WarmupProtocol | null>(null);
  const [creating, setCreating] = useState(false);

  const { data: protocols = [], isLoading } = useQuery({
    queryKey: ["warmup-protocols", includeArchived],
    queryFn: () => listWarmupProtocols({ includeArchived }),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["warmup-protocols"] });

  const duplicate = async (p: WarmupProtocol) => {
    const { error } = await sb.from("warmup_protocols").insert({
      name: `${p.name} (Copy)`,
      category: p.category,
      target_lift: p.target_lift,
      estimated_minutes: p.estimated_minutes,
      sections: p.sections,
      notes: p.notes,
      internal_notes: p.internal_notes,
      visible_to_client: p.visible_to_client,
    });
    if (error) toast.error(error.message);
    else {
      toast.success("Duplicated");
      invalidate();
    }
  };

  const toggleArchive = async (p: WarmupProtocol) => {
    const { error } = await sb.from("warmup_protocols").update({ archived: !p.archived }).eq("id", p.id);
    if (error) toast.error(error.message);
    else {
      toast.success(p.archived ? "Restored" : "Archived");
      invalidate();
    }
  };

  const hardDelete = async (p: WarmupProtocol) => {
    if (!confirm(`Delete "${p.name}"? This cannot be undone.`)) return;
    const { error } = await sb.from("warmup_protocols").delete().eq("id", p.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Deleted");
      invalidate();
    }
  };

  const setDefault = async (p: WarmupProtocol, kind: "general" | "pl") => {
    const col = kind === "pl" ? "is_default_powerlifting" : "is_default_general";
    // Clear other defaults first
    await sb.from("warmup_protocols").update({ [col]: false }).neq("id", p.id);
    const { error } = await sb.from("warmup_protocols").update({ [col]: true }).eq("id", p.id);
    if (error) toast.error(error.message);
    else {
      toast.success(`Set as default ${kind === "pl" ? "powerlifting" : "general"} warm-up`);
      invalidate();
    }
  };

  return (
    <>
      <PageHeader
        title="Warm-Up Protocols"
        subtitle="Build warm-up templates. Auto-detect applies powerlifting warm-up when squat/bench/deadlift variations are programmed."
      />
      <div className="p-4 md:p-8 space-y-4 pb-32">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New Protocol</Button>
          <div className="ml-auto flex items-center gap-2 text-xs">
            <Switch checked={includeArchived} onCheckedChange={setIncludeArchived} id="archived-toggle" />
            <Label htmlFor="archived-toggle">Show archived</Label>
          </div>
        </div>

        {isLoading ? (
          <Card className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </Card>
        ) : protocols.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground">No protocols yet. Create one to get started.</Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {protocols.map((p) => (
              <Card key={p.id} className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Flame className="h-4 w-4 text-orange-500" />
                      <span className="font-bold">{p.name}</span>
                      {p.archived && <Badge variant="outline" className="text-[10px]">Archived</Badge>}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <Badge variant="outline" className="text-[10px]">{categoryLabel(p.category)}</Badge>
                      {p.estimated_minutes != null && <Badge variant="outline" className="text-[10px]">~{p.estimated_minutes} min</Badge>}
                      {p.is_default_general && <Badge className="text-[10px] bg-blue-500/15 text-blue-500">Default General</Badge>}
                      {p.is_default_powerlifting && <Badge className="text-[10px] bg-orange-500/15 text-orange-500">Default Powerlifting</Badge>}
                      {!p.visible_to_client && <Badge variant="outline" className="text-[10px]">Hidden from client</Badge>}
                    </div>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  {p.sections.length} section{p.sections.length === 1 ? "" : "s"} ·{" "}
                  {p.sections.reduce((acc, s) => acc + (s.items?.length ?? 0), 0)} movements
                </div>
                <div className="flex flex-wrap gap-1 pt-1">
                  <Button size="sm" variant="outline" onClick={() => setEditing(p)}><Pencil className="h-3 w-3" /> Edit</Button>
                  <Button size="sm" variant="outline" onClick={() => duplicate(p)}><Copy className="h-3 w-3" /> Duplicate</Button>
                  <Button size="sm" variant="outline" onClick={() => toggleArchive(p)}><Archive className="h-3 w-3" /> {p.archived ? "Restore" : "Archive"}</Button>
                  {!p.is_default_general && (
                    <Button size="sm" variant="ghost" onClick={() => setDefault(p, "general")}><Star className="h-3 w-3" /> Set Default General</Button>
                  )}
                  {!p.is_default_powerlifting && (
                    <Button size="sm" variant="ghost" onClick={() => setDefault(p, "pl")}><Star className="h-3 w-3" /> Set Default Powerlifting</Button>
                  )}
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => hardDelete(p)}><Trash2 className="h-3 w-3" /></Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {(editing || creating) && (
        <ProtocolEditor
          protocol={editing}
          open
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSaved={invalidate}
        />
      )}
    </>
  );
}

function categoryLabel(v: string) {
  return WARMUP_CATEGORIES.find((c) => c.value === v)?.label ?? v;
}

function ProtocolEditor({
  protocol,
  open,
  onClose,
  onSaved,
}: {
  protocol: WarmupProtocol | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = !protocol;
  const [name, setName] = useState(protocol?.name ?? "");
  const [category, setCategory] = useState(protocol?.category ?? "general");
  const [targetLift, setTargetLift] = useState(protocol?.target_lift ?? "");
  const [estMin, setEstMin] = useState<string>(protocol?.estimated_minutes != null ? String(protocol.estimated_minutes) : "");
  const [notes, setNotes] = useState(protocol?.notes ?? "");
  const [internalNotes, setInternalNotes] = useState(protocol?.internal_notes ?? "");
  const [visible, setVisible] = useState(protocol?.visible_to_client ?? true);
  const [sections, setSections] = useState<WarmupSection[]>(protocol?.sections ?? [{ title: "Movement Prep", items: [{ name: "", sets: "", reps: "" }] }]);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSaving(true);
    const payload = {
      name: name.trim(),
      category,
      target_lift: targetLift.trim() || null,
      estimated_minutes: estMin ? parseInt(estMin) : null,
      notes: notes.trim() || null,
      internal_notes: internalNotes.trim() || null,
      visible_to_client: visible,
      sections,
    };
    const { error } = isNew
      ? await sb.from("warmup_protocols").insert(payload)
      : await sb.from("warmup_protocols").update(payload).eq("id", protocol!.id);
    setSaving(false);
    if (error) toast.error(error.message);
    else {
      toast.success(isNew ? "Created" : "Saved");
      onSaved();
      onClose();
    }
  };

  const addSection = () => setSections([...sections, { title: "New Section", items: [] }]);
  const removeSection = (i: number) => setSections(sections.filter((_, idx) => idx !== i));
  const updateSection = (i: number, patch: Partial<WarmupSection>) =>
    setSections(sections.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const addItem = (sIdx: number) =>
    updateSection(sIdx, { items: [...(sections[sIdx].items ?? []), { name: "", sets: "", reps: "" }] });
  const updateItem = (sIdx: number, iIdx: number, patch: any) =>
    updateSection(sIdx, { items: sections[sIdx].items.map((it, i) => (i === iIdx ? { ...it, ...patch } : it)) });
  const removeItem = (sIdx: number, iIdx: number) =>
    updateSection(sIdx, { items: sections[sIdx].items.filter((_, i) => i !== iIdx) });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{isNew ? "New Warm-Up Protocol" : "Edit Warm-Up Protocol"}</DialogTitle>
          <DialogDescription>Sections render in order. Use sections like "Pre-Squat / Legs" so SBD auto-filtering works.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Default Powerlifting Warm-Up" />
            </div>
            <div>
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {WARMUP_CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Target Lift (optional)</Label>
              <Input value={targetLift ?? ""} onChange={(e) => setTargetLift(e.target.value)} placeholder="Squat / Bench / Deadlift" />
            </div>
            <div>
              <Label>Estimated Minutes</Label>
              <Input type="number" value={estMin} onChange={(e) => setEstMin(e.target.value)} />
            </div>
          </div>

          <div>
            <Label>Client Notes</Label>
            <Textarea value={notes ?? ""} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
          <div>
            <Label>Internal Coach Notes</Label>
            <Textarea value={internalNotes ?? ""} onChange={(e) => setInternalNotes(e.target.value)} rows={2} />
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={visible} onCheckedChange={setVisible} id="visible-toggle" />
            <Label htmlFor="visible-toggle">Visible to client</Label>
          </div>

          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <div className="text-sm font-bold">Sections</div>
              <Button size="sm" variant="outline" onClick={addSection}><Plus className="h-3 w-3" /> Section</Button>
            </div>
            {sections.map((s, sIdx) => (
              <Card key={sIdx} className="p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Input
                    value={s.title}
                    onChange={(e) => updateSection(sIdx, { title: e.target.value })}
                    placeholder="Section title (e.g. Pre-Squat / Legs)"
                    className="font-bold"
                  />
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => removeSection(sIdx)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
                <div className="space-y-2">
                  {(s.items ?? []).map((it, iIdx) => (
                    <div key={iIdx} className="grid gap-2 md:grid-cols-[2fr_1fr_1fr_2fr_auto]">
                      <Input value={it.name} onChange={(e) => updateItem(sIdx, iIdx, { name: e.target.value })} placeholder="Movement" />
                      <Input value={it.sets ?? ""} onChange={(e) => updateItem(sIdx, iIdx, { sets: e.target.value })} placeholder="Sets" />
                      <Input value={it.reps ?? ""} onChange={(e) => updateItem(sIdx, iIdx, { reps: e.target.value })} placeholder="Reps / time" />
                      <Input value={it.notes ?? ""} onChange={(e) => updateItem(sIdx, iIdx, { notes: e.target.value })} placeholder="Notes / cues" />
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => removeItem(sIdx, iIdx)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                  <Button size="sm" variant="outline" onClick={() => addItem(sIdx)}><Plus className="h-3 w-3" /> Movement</Button>
                </div>
              </Card>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}