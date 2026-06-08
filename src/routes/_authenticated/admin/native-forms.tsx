import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Plus, Trash2, Copy, GripVertical, FileEdit, ChevronUp, ChevronDown, Archive, ExternalLink, Search, Eye } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  listForms, upsertForm, duplicateForm, archiveForm, deleteForm,
  listQuestions, upsertQuestion, deleteQuestion, reorderQuestions,
  listAssignments, assignFormToClient, unassignForm,
  bulkAssignFormToClients, clearAllAssignments, listActiveCoachingClientIds,
  NF_QUESTION_TYPES, NF_QUESTION_TYPE_LABEL,
  type NfForm, type NfQuestion, type NfQuestionType, type NfRecurrence, type NfKind, type NfOpenStyle,
} from "@/lib/native-forms";

export const Route = createFileRoute("/_authenticated/admin/native-forms")({
  component: AdminNativeForms,
});

function AdminNativeForms() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<NfForm | null>(null);
  const [creating, setCreating] = useState<NfKind | null>(null);

  const { data: forms = [] } = useQuery({ queryKey: ["nf-forms"], queryFn: () => listForms({ includeArchived: true }) });

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
      <PageHeader title="Form Builder" subtitle="Build native forms or embed external check-ins, then assign them to clients." actions={
        <Button onClick={() => setCreating("native")} className="bg-gradient-primary font-bold"><Plus className="mr-2 h-4 w-4" /> New Form</Button>
      } />
      <div className="space-y-3 p-4 md:p-6">
        {forms.length === 0 && (
          <Card className="border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
            No forms yet. Create a Native form (built in-app) or an External form (Fillout, Typeform, Google Forms link).
          </Card>
        )}
        {forms.map((f) => {
          return <FormRow key={f.id} form={f} onEdit={() => setEditing(f)} />;
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

function FormRow({ form, onEdit }: { form: NfForm; onEdit: () => void }) {
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
        <div>
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

  const { data: questions = [] } = useQuery({
    queryKey: ["nf-questions", form.id],
    queryFn: () => listQuestions(form.id),
    enabled: form.kind === "native",
  });

  async function saveSettings() {
    const { id: _ignore, created_at, updated_at, version, ...patch } = local as any;
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

        <Tabs defaultValue="settings">
          <TabsList>
            <TabsTrigger value="settings">Settings</TabsTrigger>
            {form.kind === "native" && <TabsTrigger value="questions">Questions ({questions.length})</TabsTrigger>}
            <TabsTrigger value="assign">Assign</TabsTrigger>
          </TabsList>

          <TabsContent value="settings" className="space-y-3">
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
          </TabsContent>

          {form.kind === "native" && (
            <TabsContent value="questions">
              <QuestionsEditor formId={form.id} questions={questions} />
            </TabsContent>
          )}

          <TabsContent value="assign">
            <AssignmentsEditor formId={form.id} form={local} onFormChange={setLocal} />
          </TabsContent>
        </Tabs>
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

function AssignmentsEditor({ formId }: { formId: string }) {
  const qc = useQueryClient();
  const { data: assignments = [] } = useQuery({ queryKey: ["nf-assignments", formId], queryFn: () => listAssignments(formId) });
  const { data: clients = [] } = useQuery({
    queryKey: ["all-clients-min"],
    queryFn: async () => {
      const { data } = await supabase.from("clients").select("id, full_name, email").eq("archived", false).order("full_name");
      return data ?? [];
    },
  });

  const assigned = new Set(assignments.map((a: any) => a.client_id));

  async function toggle(clientId: string) {
    if (assigned.has(clientId)) await unassignForm(formId, clientId);
    else await assignFormToClient(formId, clientId);
    qc.invalidateQueries({ queryKey: ["nf-assignments", formId] });
  }

  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground">Tick clients who should see this form in their portal.</div>
      <div className="max-h-[50vh] space-y-1 overflow-y-auto rounded border border-border p-2">
        {clients.map((c: any) => (
          <label key={c.id} className="flex items-center gap-2 rounded p-2 hover:bg-muted/30">
            <Checkbox checked={assigned.has(c.id)} onCheckedChange={() => toggle(c.id)} />
            <span className="text-sm">{c.full_name}</span>
            <span className="ml-auto text-xs text-muted-foreground">{c.email}</span>
          </label>
        ))}
      </div>
    </div>
  );
}