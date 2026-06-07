import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePortalUserId } from "@/lib/client-impersonation";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Send, MessageCircle, Upload } from "lucide-react";
import {
  getForm,
  listQuestions,
  getOrCreateCurrentSubmission,
  listAnswers,
  upsertAnswer,
  submitSubmission,
  uploadFormFile,
  listFiles,
  getReview,
  shouldShowQuestion,
  statusLabel,
  statusTone,
  type NfAnswer,
  type NfQuestion,
} from "@/lib/native-forms";

export const Route = createFileRoute("/_authenticated/portal/check-ins/$formId")({
  component: ClientFormRenderer,
});

function ClientFormRenderer() {
  const { formId } = Route.useParams();
  const portalUserId = usePortalUserId();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: client } = useQuery({
    queryKey: ["my-client", portalUserId],
    enabled: !!portalUserId,
    queryFn: async () => {
      const { data } = await supabase.from("clients").select("id, full_name").eq("user_id", portalUserId!).maybeSingle();
      return data;
    },
  });

  const { data: form } = useQuery({
    queryKey: ["nf-form", formId],
    queryFn: () => getForm(formId),
  });

  const { data: questions = [] } = useQuery({
    queryKey: ["nf-questions", formId],
    queryFn: () => listQuestions(formId),
  });

  const { data: submission } = useQuery({
    queryKey: ["nf-current-submission", formId, client?.id],
    enabled: !!form && !!client?.id,
    queryFn: () => getOrCreateCurrentSubmission(form!, client!.id),
  });

  const { data: answersRaw = [] } = useQuery({
    queryKey: ["nf-answers", submission?.id],
    enabled: !!submission?.id,
    queryFn: () => listAnswers(submission!.id),
  });

  const { data: files = [] } = useQuery({
    queryKey: ["nf-files", submission?.id],
    enabled: !!submission?.id,
    queryFn: () => listFiles(submission!.id),
  });

  const { data: review } = useQuery({
    queryKey: ["nf-review", submission?.id],
    enabled: !!submission?.id && (submission?.status === "reviewed"),
    queryFn: () => getReview(submission!.id),
  });

  const answersMap = useMemo(() => {
    const m: Record<string, NfAnswer | undefined> = {};
    for (const a of answersRaw) m[a.question_id] = a;
    return m;
  }, [answersRaw]);

  const [local, setLocal] = useState<Record<string, any>>({});
  useEffect(() => {
    const base: Record<string, any> = {};
    for (const a of answersRaw) {
      base[a.question_id] = a.value_json ?? a.value_text ?? a.value_number ?? "";
    }
    setLocal(base);
  }, [answersRaw]);

  const readOnly = submission && submission.status !== "in_progress";

  async function saveAnswer(q: NfQuestion, raw: any) {
    if (!submission) return;
    setLocal((s) => ({ ...s, [q.id]: raw }));
    if (readOnly) return;
    let payload: any = { submission_id: submission.id, question_id: q.id };
    if (q.question_type === "number" || q.question_type === "rating") {
      payload.value_number = raw === "" || raw == null ? null : Number(raw);
    } else if (q.question_type === "multi_choice") {
      payload.value_json = raw ?? [];
    } else {
      payload.value_text = raw == null ? null : String(raw);
    }
    try {
      await upsertAnswer(payload);
    } catch (e: any) {
      toast.error("Couldn't save: " + e.message);
    }
  }

  async function handleFileUpload(q: NfQuestion, file: File) {
    if (!submission || !client) return;
    try {
      await uploadFormFile({ clientId: client.id, submissionId: submission.id, questionId: q.id, file });
      toast.success("Uploaded");
      qc.invalidateQueries({ queryKey: ["nf-files", submission.id] });
    } catch (e: any) {
      toast.error("Upload failed: " + e.message);
    }
  }

  async function handleSubmit() {
    if (!submission) return;
    // Validate required
    const missing = questions
      .filter((q) => q.required && shouldShowQuestion(q, answersMap))
      .filter((q) => {
        const v = local[q.id];
        if (q.question_type === "file" || q.question_type === "video") {
          return files.filter((f) => f.question_id === q.id).length === 0;
        }
        if (Array.isArray(v)) return v.length === 0;
        return v === undefined || v === null || v === "";
      });
    if (missing.length > 0) {
      toast.error(`Please answer required: ${missing.map((m) => m.label).join(", ")}`);
      return;
    }
    try {
      await submitSubmission(submission.id);
      toast.success("Submitted! Coach Jared will reply in messenger.");
      qc.invalidateQueries({ queryKey: ["nf-current-submission", formId, client?.id] });
      qc.invalidateQueries({ queryKey: ["nf-submissions-for-client", client?.id] });
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  if (!form || !submission) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title={form.title}
        subtitle={submission.period_start ? `Week of ${submission.period_start}` : undefined}
        actions={<Badge className={statusTone(submission.status) + " border"}>{statusLabel(submission.status)}</Badge>}
      />

      <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-8">
        {review && (
          <Card className="border-emerald-500/30 bg-emerald-500/5 p-4">
            <div className="mb-2 text-xs font-bold uppercase tracking-wider text-emerald-600">
              Coach Reply
            </div>
            <p className="whitespace-pre-wrap text-sm">{review.reply_text}</p>
            <div className="mt-3">
              <Link to="/portal/messages">
                <Button variant="outline" size="sm">
                  <MessageCircle className="mr-2 h-4 w-4" /> Continue in Messenger
                </Button>
              </Link>
            </div>
          </Card>
        )}

        {questions
          .filter((q) => shouldShowQuestion(q, answersMap))
          .map((q, idx) => (
            <Card key={q.id} className="border-border bg-card p-5">
              <Label className="text-base font-bold">
                {idx + 1}. {q.label}
                {q.required && <span className="ml-1 text-destructive">*</span>}
              </Label>
              {q.help_text && <p className="mt-1 text-xs text-muted-foreground">{q.help_text}</p>}

              <div className="mt-3">
                <QuestionInput
                  q={q}
                  value={local[q.id]}
                  files={files.filter((f) => f.question_id === q.id)}
                  readOnly={!!readOnly}
                  onChange={(v) => saveAnswer(q, v)}
                  onUpload={(file) => handleFileUpload(q, file)}
                />
              </div>
            </Card>
          ))}

        {!readOnly && (
          <div className="sticky bottom-4 z-10">
            <Card className="border-primary/30 bg-card/95 p-4 backdrop-blur">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-muted-foreground">Auto-saving as you type.</div>
                <Button onClick={handleSubmit} className="bg-gradient-primary font-bold">
                  <Send className="mr-2 h-4 w-4" /> Submit Check-In
                </Button>
              </div>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}

function QuestionInput({
  q,
  value,
  files,
  readOnly,
  onChange,
  onUpload,
}: {
  q: NfQuestion;
  value: any;
  files: any[];
  readOnly: boolean;
  onChange: (v: any) => void;
  onUpload: (f: File) => void;
}) {
  const opts = (q.options ?? []) as string[];
  if (q.question_type === "short_text") {
    return <Input value={value ?? ""} disabled={readOnly} onChange={(e) => onChange(e.target.value)} />;
  }
  if (q.question_type === "long_text") {
    return <Textarea rows={4} value={value ?? ""} disabled={readOnly} onChange={(e) => onChange(e.target.value)} />;
  }
  if (q.question_type === "number") {
    return <Input type="number" value={value ?? ""} disabled={readOnly} onChange={(e) => onChange(e.target.value)} />;
  }
  if (q.question_type === "date") {
    return <Input type="date" value={value ?? ""} disabled={readOnly} onChange={(e) => onChange(e.target.value)} />;
  }
  if (q.question_type === "rating") {
    const n = Number(value) || 0;
    return (
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((i) => (
          <button
            key={i}
            type="button"
            disabled={readOnly}
            onClick={() => onChange(i)}
            className={`h-10 w-10 rounded-md border text-sm font-bold transition ${
              n === i
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-muted/30 hover:bg-muted"
            }`}
          >
            {i}
          </button>
        ))}
      </div>
    );
  }
  if (q.question_type === "single_choice") {
    return (
      <RadioGroup value={value ?? ""} onValueChange={onChange} disabled={readOnly}>
        {opts.map((o) => (
          <div key={o} className="flex items-center gap-2">
            <RadioGroupItem value={o} id={`${q.id}-${o}`} />
            <Label htmlFor={`${q.id}-${o}`} className="font-normal">{o}</Label>
          </div>
        ))}
      </RadioGroup>
    );
  }
  if (q.question_type === "dropdown") {
    return (
      <Select value={value ?? ""} onValueChange={onChange} disabled={readOnly}>
        <SelectTrigger><SelectValue placeholder="Choose…" /></SelectTrigger>
        <SelectContent>
          {opts.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
        </SelectContent>
      </Select>
    );
  }
  if (q.question_type === "multi_choice") {
    const arr: string[] = Array.isArray(value) ? value : [];
    const toggle = (o: string) => {
      const next = arr.includes(o) ? arr.filter((x) => x !== o) : [...arr, o];
      onChange(next);
    };
    return (
      <div className="space-y-2">
        {opts.map((o) => (
          <label key={o} className="flex items-center gap-2 text-sm">
            <Checkbox checked={arr.includes(o)} disabled={readOnly} onCheckedChange={() => toggle(o)} />
            {o}
          </label>
        ))}
      </div>
    );
  }
  if (q.question_type === "file" || q.question_type === "video") {
    const accept = q.question_type === "video" ? "video/*" : "*/*";
    return (
      <div className="space-y-3">
        {files.length > 0 && (
          <ul className="space-y-1 text-sm">
            {files.map((f) => (
              <li key={f.id} className="rounded bg-muted/30 px-2 py-1">{f.original_name}</li>
            ))}
          </ul>
        )}
        {!readOnly && (
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border bg-muted/20 px-3 py-2 text-sm hover:bg-muted/40">
            <Upload className="h-4 w-4" />
            <span>Upload {q.question_type === "video" ? "video" : "file"}</span>
            <input
              type="file"
              accept={accept}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onUpload(f);
                e.target.value = "";
              }}
            />
          </label>
        )}
      </div>
    );
  }
  return null;
}