import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Plus, Trash2, Copy, GripVertical, FileEdit, ChevronUp, ChevronDown, Archive, ExternalLink, Search, Eye } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  listForms, upsertForm, duplicateForm, archiveForm,
  listQuestions, upsertQuestion, deleteQuestion, reorderQuestions,
  listAssignments,
  NF_QUESTION_TYPES, NF_QUESTION_TYPE_LABEL,
  type NfForm, type NfQuestion, type NfQuestionType, type NfRecurrence, type NfKind, type NfOpenStyle,
} from "@/lib/native-forms";
import { deleteNativeForms, replaceNativeFormAssignments, updateNativeFormAccess } from "@/lib/native-forms.functions";
import { useBulkSelection } from "@/hooks/use-bulk-selection";

export const Route = createFileRoute("/_authenticated/admin/native-forms")({
  component: AdminNativeForms,
});

function AdminNativeForms() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<NfForm | null>(null);
  const [creating, setCreating] = useState<NfKind | null>(null);
  const deleteFormsFn = useServerFn(deleteNativeForms);

  const { data: forms = [] } = useQuery({ queryKey: ["nf-forms"], queryFn: () => listForms({ includeArchived: true }) });
  const formSelection = useBulkSelection(useMemo(() => forms.map((form) => form.id), [forms]));

  async function deleteSelectedForms() {
    if (formSelection.count === 0) return;
    if (!confirm(`Delete ${formSelection.count} selected form${formSelection.count === 1 ? "" : "s"}? This cannot be undone.`)) return;
    try {
      const result = await deleteFormsFn({ data: { formIds: formSelection.selectedIds } });
      if (!result.ok) {
        toast.error(result.error ?? "Forms could not be deleted");
        return;
      }
      formSelection.clear();
      await qc.invalidateQueries({ queryKey: ["nf-forms"] });
      toast.success(`Deleted ${result.count} form${result.count === 1 ? "" : "s"}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Forms could not be deleted");
    }
  }

  async function handleCreate(kind: NfKind) {
    const id = await upsertForm({
      title: kind === "external" ? "Untitled External Form" : "Untitled Form",
      form_type: "check_in",
      recurrence: "none",
      active: false,
      kind,
      open_style: "embed",
      visibility: "selected",
    });
    qc.invalidateQueries({ queryKey: ["nf-forms"] });
    const created = await listForms({ includeArchived: true });
    setEditing(created.find((f) => f.id === id) ?? null);
    setCreating(null);
  }

  return (
    <>
      <PageHeader title="Check-Ins & Form Builder" subtitle="Build native forms or embed external check-ins, then assign them to clients." actions={
        <Button onClick={() => setCreating("native")} className="bg-gradient-primary font-bold"><Plus className="mr-2 h-4 w-4" /> New Form</Button>
      } />
      <div className="space-y-3 p-4 md:p-6">
        {forms.length > 0 && (
          <Card className="border-border bg-card p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
                <Checkbox
                  checked={formSelection.allSelected || (formSelection.someSelected ? "indeterminate" : false)}
                  onCheckedChange={formSelection.toggleAll}
                />
                {formSelection.count > 0 ? `${formSelection.count} selected` : "Select forms"}
              </label>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={formSelection.toggleAll}>
                  {formSelection.allSelected ? "Unselect all" : "Select all"}
                </Button>
                <Button variant="ghost" size="sm" onClick={formSelection.clear} disabled={formSelection.count === 0}>Clear</Button>
                <Button variant="destructive" size="sm" onClick={deleteSelectedForms} disabled={formSelection.count === 0}>
                  <Trash2 className="mr-1 h-4 w-4" /> Delete selected
                </Button>
              </div>
            </div>
          </Card>
        )}
        {forms.length === 0 && (
          <Card className="border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
            No forms yet. Create a Native form (built in-app) or an External form (Fillout, Typeform, Google Forms link).
          </Card>
        )}
        {forms.map((f) => {
          return <FormRow key={f.id} form={f} selected={formSelection.isSelected(f.id)} onSelect={(checked) => formSelection.setOne(f.id, checked)} onEdit={() => setEditing(f)} />;
        })}
      </div>

      {editing && (
        <FormEditorDialog form={editing} open onClose={() => setEditing(null)} />
      )}

      <NewFormDialog open={!!creating} onPick={handleCreate} onClose={() => setCreating(null)} />
    </>
  );
}

function NewFormDialog({ open, onPick, onClose }: { open: boolean; onPick: (k: NfKind) => void; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Create a form</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <button onClick={() => onPick("native")} className="rounded-lg border border-border bg-card p-4 text-left hover:border-primary hover:bg-secondary/30">
            <FileEdit className="mb-2 h-5 w-5 text-primary" />
            <div className="font-bold">Native Form</div>
            <div className="mt-1 text-xs text-muted-foreground">Build questions inside the app. Answers tracked in-app.</div>
          </button>
          <button onClick={() => onPick("external")} className="rounded-lg border border-border bg-card p-4 text-left hover:border-primary hover:bg-secondary/30">
            <ExternalLink className="mb-2 h-5 w-5 text-primary" />
            <div className="font-bold">External / Embedded</div>
            <div className="mt-1 text-xs text-muted-foreground">Paste a Fillout, Typeform, Google Forms link. Opens inside the app.</div>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FormRow({
  form,
  selected,
  onSelect,
  onEdit,
}: {
  form: NfForm;
  selected: boolean;
  onSelect: (checked: boolean) => void;
  onEdit: () => void;
}) {
  const qc = useQueryClient();
  const { data: questions = [] } = useQuery({
    queryKey: ["nf-questions", form.id],
    queryFn: () => listQuestions(form.id),
    enabled: form.kind === "native",
  });
  const { data: assignments = [] } = useQuery({ queryKey: ["nf-assignments", form.id], queryFn: () => listAssignments(form.id) });

  const hasAudience = form.visibility === "all_active_clients" || assignments.length > 0;
  const hasContent = form.kind === "external" ? !!form.external_url : questions.length > 0;
  const isActive = form.active && !form.archived && hasContent && hasAudience;
  const assignedCount = form.visibility === "all_active_clients" ? "All active" : `${assignments.length} assigned`;
  const kindLabel = form.kind === "external" ? "External" : "Native";

  return (
    <Card className="border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Checkbox checked={selected} onCheckedChange={(checked) => onSelect(checked === true)} aria-label={`Select ${form.title}`} />
          <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="text-base font-black">{form.title}</div>
            <Badge variant="outline" className="text-[10px]">{kindLabel}</Badge>
            {isActive ? (
              <Badge className="border-emerald-500/40 bg-emerald-500/10 text-emerald-600">● Active</Badge>
            ) : form.archived ? (
              <Badge variant="outline">Archived</Badge>
            ) : (
              <Badge variant="outline">Draft</Badge>
            )}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {form.kind === "native" ? `${questions.length} questions` : (form.external_url ? "External link set" : "No URL yet")}
            {" · "}{assignedCount}{" · "}{form.recurrence}
          </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onEdit}><FileEdit className="mr-1 h-4 w-4" /> Edit</Button>
          <Button variant="outline" size="sm" onClick={async () => {
            await duplicateForm(form.id);
            qc.invalidateQueries({ queryKey: ["nf-forms"] });
            toast.success("Duplicated");
          }}><Copy className="mr-1 h-4 w-4" /> Duplicate</Button>
          <Button variant="outline" size="sm" onClick={async () => {
            await archiveForm(form.id, !form.archived);
            qc.invalidateQueries({ queryKey: ["nf-forms"] });
          }}><Archive className="mr-1 h-4 w-4" /> {form.archived ? "Unarchive" : "Archive"}</Button>
        </div>
      </div>
    </Card>
  );
}

function FormEditorDialog({ form, open, onClose }: { form: NfForm; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [local, setLocal] = useState<NfForm>(form);
  const [activeTab, setActiveTab] = useState<"settings" | "questions" | "assign">("settings");

  const { data: questions = [] } = useQuery({
    queryKey: ["nf-questions", form.id],
    queryFn: () => listQuestions(form.id),
    enabled: form.kind === "native",
  });

  async function saveSettings() {
    const patch = {
      title: local.title,
      description: local.description,
      form_type: local.form_type,
      recurrence: local.recurrence,
      recurrence_day: local.recurrence_day,
      active: local.active,
      archived: local.archived,
      kind: local.kind,
      external_url: local.external_url,
      button_label: local.button_label,
      open_style: local.open_style,
      visibility: local.visibility,
      auto_assign_new_clients: local.auto_assign_new_clients,
    };
    try {
      await upsertForm({ id: form.id, ...patch });
      qc.invalidateQueries({ queryKey: ["nf-forms"] });
      toast.success("Saved");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Edit Form
            <Badge variant="outline" className="text-[10px]">{form.kind === "external" ? "External" : "Native"}</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap gap-2 rounded-lg bg-muted p-1">
          <Button type="button" size="sm" variant={activeTab === "settings" ? "default" : "ghost"} onClick={() => setActiveTab("settings")}>Settings</Button>
          {form.kind === "native" && (
            <Button type="button" size="sm" variant={activeTab === "questions" ? "default" : "ghost"} onClick={() => setActiveTab("questions")}>Questions ({questions.length})</Button>
          )}
          <Button type="button" size="sm" variant={activeTab === "assign" ? "default" : "ghost"} onClick={() => setActiveTab("assign")}>Assign</Button>
        </div>

          {activeTab === "settings" && <div className="space-y-3">
            <div>
              <Label>Title</Label>
              <Input value={local.title} onChange={(e) => setLocal({ ...local, title: e.target.value })} />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea rows={2} value={local.description ?? ""} onChange={(e) => setLocal({ ...local, description: e.target.value })} />
            </div>

            {local.kind === "external" && (
              <div className="space-y-3 rounded-lg border border-border bg-secondary/10 p-3">
                <div>
                  <Label>Form URL</Label>
                  <Input
                    placeholder="https://forms.fillout.com/... or https://forms.gle/..."
                    value={local.external_url ?? ""}
                    onChange={(e) => setLocal({ ...local, external_url: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Button label</Label>
                    <Input
                      placeholder="Submit Weekly Check-In"
                      value={local.button_label ?? ""}
                      onChange={(e) => setLocal({ ...local, button_label: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Open style</Label>
                    <Select value={local.open_style} onValueChange={(v) => setLocal({ ...local, open_style: v as NfOpenStyle })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="embed">Embed in app (iframe)</SelectItem>
                        <SelectItem value="modal">Open in app browser modal</SelectItem>
                        <SelectItem value="new_tab">Open in a new tab</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {local.external_url && (
                  <a href={local.external_url} target="_blank" rel="noreferrer" className="inline-flex items-center text-xs text-primary hover:underline">
                    <Eye className="mr-1 h-3 w-3" /> Preview external form
                  </a>
                )}
                <p className="text-[11px] text-muted-foreground">
                  Note: some providers (Google Forms, certain Typeform/Fillout settings) block embedding. If embed fails the app will fall back to opening the link.
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Recurrence</Label>
                <Select value={local.recurrence} onValueChange={(v) => setLocal({ ...local, recurrence: v as NfRecurrence })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">One-time</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="biweekly">Bi-weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Due day</Label>
                <Select value={local.recurrence_day ?? ""} onValueChange={(v) => setLocal({ ...local, recurrence_day: v })}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"].map((d) => (
                      <SelectItem key={d} value={d}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={local.active} onCheckedChange={(v) => setLocal({ ...local, active: v })} />
              <Label>Active (clients can submit)</Label>
            </div>
            <div className="flex justify-end">
              <Button onClick={saveSettings}>Save</Button>
            </div>
          </div>}

          {activeTab === "questions" && form.kind === "native" && (
            <div>
              <QuestionsEditor formId={form.id} questions={questions} />
            </div>
          )}

          {activeTab === "assign" && <div>
            <AssignmentsEditor formId={form.id} form={local} onFormChange={setLocal} />
          </div>}
      </DialogContent>
    </Dialog>
  );
}

function QuestionsEditor({ formId, questions }: { formId: string; questions: NfQuestion[] }) {
  const qc = useQueryClient();

  async function addQuestion() {
    await upsertQuestion({
      form_id: formId,
      order_index: (questions[questions.length - 1]?.order_index ?? 0) + 1,
      question_type: "short_text",
      label: "New question",
      required: false,
      options: [],
    } as any);
    qc.invalidateQueries({ queryKey: ["nf-questions", formId] });
  }

  async function move(idx: number, dir: -1 | 1) {
    const next = idx + dir;
    if (next < 0 || next >= questions.length) return;
    const updates = [
      { id: questions[idx].id, order_index: questions[next].order_index },
      { id: questions[next].id, order_index: questions[idx].order_index },
    ];
    await reorderQuestions(updates);
    qc.invalidateQueries({ queryKey: ["nf-questions", formId] });
  }

  return (
    <div className="space-y-2">
      {questions.map((q, idx) => (
        <QuestionRow key={q.id} q={q} formId={formId} onMoveUp={() => move(idx, -1)} onMoveDown={() => move(idx, 1)} />
      ))}
      <Button variant="outline" onClick={addQuestion}><Plus className="mr-1 h-4 w-4" /> Add Question</Button>
    </div>
  );
}

function QuestionRow({ q, formId, onMoveUp, onMoveDown }: { q: NfQuestion; formId: string; onMoveUp: () => void; onMoveDown: () => void }) {
  const qc = useQueryClient();
  const [local, setLocal] = useState<NfQuestion>(q);

  async function save(patch: Partial<NfQuestion>) {
    const next = { ...local, ...patch };
    setLocal(next);
    await upsertQuestion({ id: q.id, form_id: formId, ...patch } as any);
    qc.invalidateQueries({ queryKey: ["nf-questions", formId] });
  }

  const needsOptions = ["single_choice", "multi_choice", "dropdown"].includes(local.question_type);

  return (
    <Card className="border-border bg-card p-3">
      <div className="flex items-start gap-2">
        <div className="flex flex-col">
          <button onClick={onMoveUp} className="text-muted-foreground hover:text-foreground"><ChevronUp className="h-4 w-4" /></button>
          <GripVertical className="h-4 w-4 text-muted-foreground" />
          <button onClick={onMoveDown} className="text-muted-foreground hover:text-foreground"><ChevronDown className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 space-y-2">
          <div className="flex gap-2">
            <Input value={local.label} onChange={(e) => setLocal({ ...local, label: e.target.value })} onBlur={() => save({ label: local.label })} />
            <Select value={local.question_type} onValueChange={(v) => save({ question_type: v as NfQuestionType })}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                {NF_QUESTION_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{NF_QUESTION_TYPE_LABEL[t]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {needsOptions && (
            <Input
              placeholder="Options (comma-separated)"
              value={(local.options ?? []).join(", ")}
              onChange={(e) => setLocal({ ...local, options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
              onBlur={() => save({ options: local.options })}
            />
          )}
          <div className="flex items-center gap-3 text-xs">
            <label className="flex items-center gap-1">
              <Checkbox checked={local.required} onCheckedChange={(v) => save({ required: !!v })} /> Required
            </label>
            <Button variant="ghost" size="sm" onClick={async () => {
              await deleteQuestion(q.id);
              qc.invalidateQueries({ queryKey: ["nf-questions", formId] });
            }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function AssignmentsEditor({ formId, form, onFormChange }: { formId: string; form: NfForm; onFormChange: (f: NfForm) => void }) {
  const qc = useQueryClient();
  const saveAssignmentsFn = useServerFn(replaceNativeFormAssignments);
  const updateAccessFn = useServerFn(updateNativeFormAccess);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const { data: assignments = [] } = useQuery({ queryKey: ["nf-assignments", formId], queryFn: () => listAssignments(formId) });
  const { data: clients = [] } = useQuery({
    queryKey: ["all-clients-min"],
    queryFn: async () => {
      const { data } = await supabase
        .from("clients")
        .select("id, full_name, email, status, archived")
        .eq("archived", false)
        .order("full_name");
      return data ?? [];
    },
  });

  useEffect(() => {
    if (dirty || saving) return;
    setSelectedIds(new Set(assignments.map((a: any) => a.client_id)));
  }, [assignments, dirty, saving]);

  const broadcastOn = form.visibility === "all_active_clients";
  const filtered = clients.filter((c: any) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (c.full_name ?? "").toLowerCase().includes(q) || (c.email ?? "").toLowerCase().includes(q);
  });
  const visibleIds = filtered.map((client: any) => client.id as string);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));

  function setClientSelected(clientId: string, checked: boolean) {
    if (broadcastOn || saving) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(clientId);
      else next.delete(clientId);
      return next;
    });
    setDirty(true);
  }

  function toggle(clientId: string) {
    setClientSelected(clientId, !selectedIds.has(clientId));
  }

  function selectAllVisible() {
    if (broadcastOn || saving || visibleIds.length === 0) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of visibleIds) next.add(id);
      return next;
    });
    setDirty(true);
  }

  function clearAll() {
    if (broadcastOn || saving) return;
    setSelectedIds(new Set());
    setDirty(true);
  }

  async function saveAssignmentChanges() {
    setSaving(true);
    try {
      const result = await saveAssignmentsFn({ data: { formId, clientIds: Array.from(selectedIds) } });
      if (!result.ok) {
        toast.error(result.error ?? "Assignments could not be saved");
        return;
      }
      setDirty(false);
      await qc.invalidateQueries({ queryKey: ["nf-assignments", formId] });
      await qc.invalidateQueries({ queryKey: ["nf-forms"] });
      toast.success(`Saved ${result.count} assignment${result.count === 1 ? "" : "s"}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Assignments could not be saved");
    } finally {
      setSaving(false);
    }
  }

  async function setBroadcast(on: boolean) {
    const previousVisibility = form.visibility;
    const visibility = on ? "all_active_clients" : "selected";
    onFormChange({ ...form, visibility });
    setSaving(true);
    try {
      const result = await updateAccessFn({ data: { formId, visibility } });
      if (!result.ok) {
        onFormChange({ ...form, visibility: previousVisibility });
        toast.error(result.error ?? "Failed");
        return;
      }
      await qc.invalidateQueries({ queryKey: ["nf-forms"] });
      await qc.invalidateQueries({ queryKey: ["nf-assignments", formId] });
      toast.success(on ? "Now visible to all active clients" : "Switched to selected clients");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    } finally {
      setSaving(false);
    }
  }

  async function setAutoAssign(on: boolean) {
    const previousAutoAssign = form.auto_assign_new_clients;
    onFormChange({ ...form, auto_assign_new_clients: on });
    setSaving(true);
    try {
      const result = await updateAccessFn({ data: { formId, autoAssignNewClients: on } });
      if (!result.ok) {
        onFormChange({ ...form, auto_assign_new_clients: previousAutoAssign });
        toast.error(result.error ?? "Failed");
        return;
      }
      qc.invalidateQueries({ queryKey: ["nf-forms"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border bg-secondary/10 p-3 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label className="text-sm font-bold">Assign to all active coaching clients</Label>
            <p className="text-xs text-muted-foreground">Every Active / New Client sees this form. No need to tick individually.</p>
          </div>
          <Switch checked={broadcastOn} disabled={saving} onCheckedChange={setBroadcast} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label className="text-sm font-bold">Auto-assign to new coaching clients</Label>
            <p className="text-xs text-muted-foreground">Future active clients get this form added automatically.</p>
          </div>
          <Switch checked={form.auto_assign_new_clients} disabled={saving} onCheckedChange={setAutoAssign} />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">
          {broadcastOn
            ? `Visible to all active coaching clients`
            : `${selectedIds.size} client${selectedIds.size === 1 ? "" : "s"} selected${dirty ? " · unsaved" : ""}`}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={selectAllVisible} disabled={broadcastOn || saving}>{allVisibleSelected ? "All visible selected" : "Select all visible"}</Button>
          <Button variant="ghost" size="sm" onClick={clearAll} disabled={broadcastOn || saving}>Clear all</Button>
          <Button size="sm" onClick={saveAssignmentChanges} disabled={broadcastOn || saving || !dirty}>{saving ? "Saving…" : "Save assignments"}</Button>
        </div>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-8" placeholder="Search clients…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="max-h-[40vh] space-y-1 overflow-y-auto rounded border border-border p-2">
        {filtered.length === 0 ? (
          <div className="p-3 text-xs text-muted-foreground">No matching clients.</div>
        ) : filtered.map((c: any) => {
          const isChecked = broadcastOn ? true : selectedIds.has(c.id);
          const disabled = broadcastOn || saving;
          return (
            <div
              key={c.id}
              onClick={(e) => {
                if (disabled) return;
                // Ignore clicks that originated from the checkbox itself —
                // it has its own onCheckedChange and we don't want to double-toggle.
                const target = e.target as HTMLElement;
                if (target.closest('[data-nf-checkbox="true"]')) return;
                toggle(c.id);
              }}
              className={`flex min-h-[44px] items-center gap-3 rounded p-2 hover:bg-muted/40 ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
            >
              <span data-nf-checkbox="true" className="inline-flex">
                <Checkbox
                  checked={isChecked}
                  disabled={disabled}
                  onCheckedChange={(checked) => setClientSelected(c.id, checked === true)}
                  aria-label={`Assign ${c.full_name}`}
                />
              </span>
              <span className="text-sm">{c.full_name}</span>
              <span className="ml-auto truncate text-xs text-muted-foreground">{c.email}</span>
              {broadcastOn && (
                <span className="ml-2 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600">
                  inherited
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}