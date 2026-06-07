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
import { Plus, Trash2, Copy, GripVertical, Users, FileEdit, ChevronUp, ChevronDown, Archive } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  listForms, upsertForm, duplicateForm, archiveForm, deleteForm,
  listQuestions, upsertQuestion, deleteQuestion, reorderQuestions,
  listAssignments, assignFormToClient, unassignForm,
  NF_QUESTION_TYPES, NF_QUESTION_TYPE_LABEL,
  type NfForm, type NfQuestion, type NfQuestionType, type NfRecurrence,
} from "@/lib/native-forms";

export const Route = createFileRoute("/_authenticated/admin/native-forms")({
  component: AdminNativeForms,
});

function AdminNativeForms() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<NfForm | null>(null);

  const { data: forms = [] } = useQuery({ queryKey: ["nf-forms"], queryFn: () => listForms({ includeArchived: true }) });

  async function handleCreate() {
    const id = await upsertForm({ title: "Untitled Form", form_type: "custom", recurrence: "none", active: false });
    qc.invalidateQueries({ queryKey: ["nf-forms"] });
    const created = await listForms({ includeArchived: true });
    setEditing(created.find((f) => f.id === id) ?? null);
  }

  return (
    <>
      <PageHeader title="Native Forms" subtitle="Build, edit, and assign your in-app forms." actions={
        <Button onClick={handleCreate} className="bg-gradient-primary font-bold"><Plus className="mr-2 h-4 w-4" /> New Form</Button>
      } />
      <div className="space-y-3 p-4 md:p-6">
        {forms.map((f) => {
          return <FormRow key={f.id} form={f} onEdit={() => setEditing(f)} />;
        })}
      </div>

      {editing && (
        <FormEditorDialog form={editing} open onClose={() => setEditing(null)} />
      )}
    </>
  );
}

function FormRow({ form, onEdit }: { form: NfForm; onEdit: () => void }) {
  const qc = useQueryClient();
  const { data: questions = [] } = useQuery({ queryKey: ["nf-questions", form.id], queryFn: () => listQuestions(form.id) });
  const { data: assignments = [] } = useQuery({ queryKey: ["nf-assignments", form.id], queryFn: () => listAssignments(form.id) });

  const isActive = form.active && !form.archived && questions.length > 0 && assignments.length > 0;

  return (
    <Card className="border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <div className="text-base font-black">{form.title}</div>
            {isActive ? (
              <Badge className="border-emerald-500/40 bg-emerald-500/10 text-emerald-600">● Active</Badge>
            ) : form.archived ? (
              <Badge variant="outline">Archived</Badge>
            ) : (
              <Badge variant="outline">Draft</Badge>
            )}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {questions.length} questions · {assignments.length} assigned · {form.recurrence}
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

  const { data: questions = [] } = useQuery({ queryKey: ["nf-questions", form.id], queryFn: () => listQuestions(form.id) });

  async function saveSettings() {
    await upsertForm({ id: form.id, ...local });
    qc.invalidateQueries({ queryKey: ["nf-forms"] });
    toast.success("Saved");
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>Edit Form</DialogTitle></DialogHeader>

        <Tabs defaultValue="settings">
          <TabsList>
            <TabsTrigger value="settings">Settings</TabsTrigger>
            <TabsTrigger value="questions">Questions ({questions.length})</TabsTrigger>
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

          <TabsContent value="questions">
            <QuestionsEditor formId={form.id} questions={questions} />
          </TabsContent>

          <TabsContent value="assign">
            <AssignmentsEditor formId={form.id} />
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