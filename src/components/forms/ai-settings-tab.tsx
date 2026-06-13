import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Save, Sparkles, FlaskConical } from "lucide-react";
import {
  getGlobalAiConfig, updateGlobalAiConfig, getFormAiConfig, upsertFormAiConfig, runAiPlayground,
} from "@/lib/ai-config.functions";
import { listForms } from "@/lib/native-forms";

const MODEL_OPTIONS = [
  { value: "google/gemini-3-flash-preview", label: "Gemini 3 Flash (default)" },
  { value: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { value: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { value: "openai/gpt-5-mini", label: "GPT-5 Mini" },
  { value: "openai/gpt-5", label: "GPT-5" },
];

export function AiSettingsTab() {
  const [view, setView] = useState<"global" | "form" | "playground">("global");

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Button variant={view === "global" ? "default" : "outline"} size="sm" onClick={() => setView("global")}>
          Global instructions
        </Button>
        <Button variant={view === "form" ? "default" : "outline"} size="sm" onClick={() => setView("form")}>
          Per-form instructions
        </Button>
        <Button variant={view === "playground" ? "default" : "outline"} size="sm" onClick={() => setView("playground")}>
          <FlaskConical className="h-3.5 w-3.5 mr-1" /> Playground
        </Button>
      </div>
      {view === "global" && <GlobalConfigPanel />}
      {view === "form" && <FormConfigPanel />}
      {view === "playground" && <PlaygroundPanel />}
    </div>
  );
}

function GlobalConfigPanel() {
  const qc = useQueryClient();
  const get = useServerFn(getGlobalAiConfig);
  const update = useServerFn(updateGlobalAiConfig);

  const { data, isLoading } = useQuery({
    queryKey: ["global-ai-config"],
    queryFn: () => get({ data: {} as any }),
  });
  const [form, setForm] = useState<any>(null);
  useEffect(() => { if (data) setForm({ ...data }); }, [data]);

  const save = useMutation({
    mutationFn: () =>
      update({
        data: {
          brand_voice: form.brand_voice ?? null,
          tone: form.tone ?? null,
          safety_rules: form.safety_rules ?? null,
          prohibited_phrases: form.prohibited_phrases ?? [],
          escalation_rules: form.escalation_rules ?? null,
          default_analysis_structure: form.default_analysis_structure ?? null,
          default_response_structure: form.default_response_structure ?? null,
          default_model: form.default_model ?? "google/gemini-3-flash-preview",
        },
      }),
    onSuccess: () => { toast.success("Global AI config saved"); qc.invalidateQueries({ queryKey: ["global-ai-config"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Save failed"),
  });

  if (isLoading || !form) return <div className="text-sm text-muted-foreground">Loading…</div>;
  return (
    <Card className="p-5 space-y-4 max-w-3xl">
      <h3 className="text-base font-bold flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-primary" /> Global brand voice</h3>
      <Field label="Brand voice">
        <Textarea value={form.brand_voice ?? ""} onChange={(e) => setForm({ ...form, brand_voice: e.target.value })} className="min-h-[80px]" />
      </Field>
      <Field label="Tone">
        <Textarea value={form.tone ?? ""} onChange={(e) => setForm({ ...form, tone: e.target.value })} className="min-h-[60px]" />
      </Field>
      <Field label="Safety rules">
        <Textarea value={form.safety_rules ?? ""} onChange={(e) => setForm({ ...form, safety_rules: e.target.value })} className="min-h-[80px]" />
      </Field>
      <Field label="Escalation rules">
        <Textarea value={form.escalation_rules ?? ""} onChange={(e) => setForm({ ...form, escalation_rules: e.target.value })} className="min-h-[60px]" />
      </Field>
      <Field label="Default analysis structure">
        <Input value={form.default_analysis_structure ?? ""} onChange={(e) => setForm({ ...form, default_analysis_structure: e.target.value })} />
      </Field>
      <Field label="Default client-response structure">
        <Input value={form.default_response_structure ?? ""} onChange={(e) => setForm({ ...form, default_response_structure: e.target.value })} />
      </Field>
      <Field label="Default AI model">
        <Select value={form.default_model ?? "google/gemini-3-flash-preview"} onValueChange={(v) => setForm({ ...form, default_model: v })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {MODEL_OPTIONS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Prohibited phrases (comma separated)">
        <Input
          value={(form.prohibited_phrases ?? []).join(", ")}
          onChange={(e) => setForm({ ...form, prohibited_phrases: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
        />
      </Field>
      <div>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
          Save global config
        </Button>
      </div>
    </Card>
  );
}

function FormConfigPanel() {
  const qc = useQueryClient();
  const getCfg = useServerFn(getFormAiConfig);
  const upsertCfg = useServerFn(upsertFormAiConfig);

  const { data: forms = [] } = useQuery({
    queryKey: ["nf-forms-for-ai-config"],
    queryFn: () => listForms({ includeArchived: false }),
  });

  const [formId, setFormId] = useState<string>("");
  useEffect(() => { if (!formId && (forms as any[]).length > 0) setFormId((forms as any[])[0].id); }, [forms, formId]);

  const { data: cfg } = useQuery({
    queryKey: ["form-ai-config", formId],
    queryFn: () => formId ? getCfg({ data: { formId } }) : null,
    enabled: !!formId,
  });

  const [draft, setDraft] = useState<any>(null);
  useEffect(() => {
    setDraft(cfg ?? {
      enabled: false,
      instructions: "",
      response_tone: "",
      response_length: "medium",
      allow_recommend_programming: false,
      allow_recommend_nutrition: false,
      require_coach_approval: true,
      escalation_rules: "",
      priority_rules: "",
      model: null,
      review_sla_hours: null,
    });
  }, [cfg, formId]);

  const save = useMutation({
    mutationFn: () =>
      upsertCfg({
        data: {
          formId,
          enabled: !!draft.enabled,
          instructions: draft.instructions ?? null,
          response_tone: draft.response_tone ?? null,
          response_length: (draft.response_length ?? "medium"),
          escalation_rules: draft.escalation_rules ?? null,
          priority_rules: draft.priority_rules ?? null,
          allow_recommend_programming: !!draft.allow_recommend_programming,
          allow_recommend_nutrition: !!draft.allow_recommend_nutrition,
          require_coach_approval: draft.require_coach_approval ?? true,
          model: draft.model ?? null,
          review_sla_hours: draft.review_sla_hours ?? null,
        },
      }),
    onSuccess: () => { toast.success("Form AI config saved"); qc.invalidateQueries({ queryKey: ["form-ai-config", formId] }); },
    onError: (e: any) => toast.error(e?.message ?? "Save failed"),
  });

  if (!forms || (forms as any[]).length === 0) {
    return <div className="text-sm text-muted-foreground">No native forms yet. Create one in the Builder tab first.</div>;
  }

  return (
    <Card className="p-5 space-y-4 max-w-3xl">
      <Field label="Form">
        <Select value={formId} onValueChange={setFormId}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {(forms as any[]).map((f) => (
              <SelectItem key={f.id} value={f.id}>{f.title}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {draft && (
        <>
          <div className="flex items-center justify-between">
            <Label>AI enabled for this form</Label>
            <Switch checked={!!draft.enabled} onCheckedChange={(v) => setDraft({ ...draft, enabled: v })} />
          </div>
          <Field label="Form-specific instructions">
            <Textarea value={draft.instructions ?? ""} onChange={(e) => setDraft({ ...draft, instructions: e.target.value })} className="min-h-[120px]" />
          </Field>
          <Field label="Response tone (override)">
            <Input value={draft.response_tone ?? ""} onChange={(e) => setDraft({ ...draft, response_tone: e.target.value })} />
          </Field>
          <Field label="Response length">
            <Select value={draft.response_length ?? "medium"} onValueChange={(v) => setDraft({ ...draft, response_length: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="short">Short</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="long">Long</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Escalation rules">
            <Textarea value={draft.escalation_rules ?? ""} onChange={(e) => setDraft({ ...draft, escalation_rules: e.target.value })} className="min-h-[60px]" />
          </Field>
          <Field label="Priority rules">
            <Textarea value={draft.priority_rules ?? ""} onChange={(e) => setDraft({ ...draft, priority_rules: e.target.value })} className="min-h-[60px]" />
          </Field>
          <div className="flex items-center justify-between">
            <Label>Allow programming recommendations</Label>
            <Switch checked={!!draft.allow_recommend_programming} onCheckedChange={(v) => setDraft({ ...draft, allow_recommend_programming: v })} />
          </div>
          <div className="flex items-center justify-between">
            <Label>Allow nutrition recommendations</Label>
            <Switch checked={!!draft.allow_recommend_nutrition} onCheckedChange={(v) => setDraft({ ...draft, allow_recommend_nutrition: v })} />
          </div>
          <div className="flex items-center justify-between">
            <Label>Require coach approval before sending</Label>
            <Switch checked={!!draft.require_coach_approval} onCheckedChange={(v) => setDraft({ ...draft, require_coach_approval: v })} />
          </div>
          <Field label="Model override">
            <Select value={draft.model ?? "__inherit"} onValueChange={(v) => setDraft({ ...draft, model: v === "__inherit" ? null : v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__inherit">Use global default</SelectItem>
                {MODEL_OPTIONS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Review SLA (hours)">
            <Input
              type="number"
              value={draft.review_sla_hours ?? ""}
              onChange={(e) => setDraft({ ...draft, review_sla_hours: e.target.value ? parseInt(e.target.value, 10) : null })}
            />
          </Field>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
            Save form config
          </Button>
        </>
      )}
    </Card>
  );
}

function PlaygroundPanel() {
  const run = useServerFn(runAiPlayground);
  const { data: forms = [] } = useQuery({
    queryKey: ["nf-forms-for-ai-playground"],
    queryFn: () => listForms({ includeArchived: false }),
  });
  const [formId, setFormId] = useState<string>("");
  const [instr, setInstr] = useState("");
  const [sample, setSample] = useState("Q: How did training go this week?\nA: Hit all sessions. Bench felt heavy on Friday.\n\nQ: Sleep average?\nA: 6.5 hours.\n\nQ: Anything else?\nA: Right shoulder a bit tight.");
  const [output, setOutput] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setBusy(true);
    setOutput(null);
    try {
      const r = await run({
        data: {
          formId: formId || null,
          submissionInstruction: instr || null,
          sampleAnswers: sample,
        },
      });
      setOutput(r);
    } catch (e: any) {
      toast.error(e?.message ?? "Playground failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5 space-y-3 max-w-4xl">
      <div className="text-xs uppercase tracking-wider font-semibold text-amber-400">
        Test mode — no messages, reviews, or notifications are created.
      </div>
      <Field label="Form (optional, applies form-specific config)">
        <Select value={formId || "__none"} onValueChange={(v) => setFormId(v === "__none" ? "" : v)}>
          <SelectTrigger><SelectValue placeholder="Use global only" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">Use global only</SelectItem>
            {(forms as any[]).map((f) => <SelectItem key={f.id} value={f.id}>{f.title}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Submission-level instruction (optional)">
        <Input value={instr} onChange={(e) => setInstr(e.target.value)} />
      </Field>
      <Field label="Sample answers">
        <Textarea value={sample} onChange={(e) => setSample(e.target.value)} className="min-h-[180px] font-mono text-xs" />
      </Field>
      <Button onClick={go} disabled={busy}>
        {busy ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />} Run test
      </Button>
      {output && (
        <div className="space-y-3 pt-2 border-t border-border">
          <div className="text-xs text-muted-foreground">Model: <span className="font-mono">{output.model}</span></div>
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">View assembled system prompt</summary>
            <pre className="whitespace-pre-wrap break-words mt-2 bg-muted/40 rounded p-2 max-h-80 overflow-auto">{output.systemPrompt}</pre>
          </details>
          {output.output ? (
            <pre className="whitespace-pre-wrap break-words mt-2 bg-muted/40 rounded p-2 text-xs max-h-[500px] overflow-auto">
              {JSON.stringify(output.output, null, 2)}
            </pre>
          ) : (
            <div className="text-sm text-muted-foreground">No structured output returned.</div>
          )}
        </div>
      )}
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}