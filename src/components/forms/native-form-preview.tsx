import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Eye, Monitor, Smartphone, Upload } from "lucide-react";
import {
  shouldShowQuestion,
  type NfForm,
  type NfQuestion,
  type NfAnswer,
} from "@/lib/native-forms";

type PreviewSubmission = { id: string; status: "in_progress" };

export function NativeFormPreviewDialog({
  open,
  onClose,
  form,
  questions,
}: {
  open: boolean;
  onClose: () => void;
  form: NfForm;
  questions: NfQuestion[];
}) {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [values, setValues] = useState<Record<string, any>>({});
  const [fakeFiles, setFakeFiles] = useState<Record<string, string[]>>({});
  const [missing, setMissing] = useState<string[]>([]);

  const visible = questions.filter((q) => !q.archived_at);

  const answersMap = useMemo<Record<string, NfAnswer | undefined>>(() => {
    const m: Record<string, NfAnswer | undefined> = {};
    for (const q of visible) {
      const raw = values[q.id];
      m[q.id] = {
        id: `preview-${q.id}`,
        submission_id: "preview",
        question_id: q.id,
        value_text: typeof raw === "string" ? raw : raw == null ? null : String(raw),
        value_number: q.question_type === "number" || q.question_type === "rating"
          ? raw === "" || raw == null ? null : Number(raw)
          : null,
        value_json: Array.isArray(raw) ? raw : null,
      };
    }
    return m;
  }, [values, visible]);

  function setVal(qid: string, v: any) {
    setValues((s) => ({ ...s, [qid]: v }));
  }

  function trySubmit() {
    const m: string[] = [];
    for (const q of visible) {
      if (!q.required) continue;
      if (!shouldShowQuestion(q, answersMap)) continue;
      const v = values[q.id];
      if (q.question_type === "file" || q.question_type === "video") {
        if (!(fakeFiles[q.id]?.length)) m.push(q.label);
      } else if (Array.isArray(v) ? v.length === 0 : v === undefined || v === null || v === "") {
        m.push(q.label);
      }
    }
    setMissing(m);
  }

  const innerWidth = device === "mobile" ? "max-w-[420px]" : "max-w-3xl";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="h-4 w-4" /> Preview: {form.title}
            <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-600">
              Preview Mode — nothing is saved
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="mb-3 flex items-center justify-between">
          <div className="flex gap-1 rounded-md border border-border bg-muted p-1">
            <Button size="sm" variant={device === "desktop" ? "default" : "ghost"} onClick={() => setDevice("desktop")}>
              <Monitor className="mr-1 h-4 w-4" /> Desktop
            </Button>
            <Button size="sm" variant={device === "mobile" ? "default" : "ghost"} onClick={() => setDevice("mobile")}>
              <Smartphone className="mr-1 h-4 w-4" /> Mobile
            </Button>
          </div>
          <Button variant="outline" size="sm" onClick={() => { setValues({}); setFakeFiles({}); setMissing([]); }}>
            Reset preview
          </Button>
        </div>

        <div className="rounded-lg border border-dashed border-border bg-muted/20 p-3">
          <div className={`mx-auto space-y-3 ${innerWidth}`}>
            {form.description && (
              <Card className="border-border bg-card p-3 text-sm text-muted-foreground">{form.description}</Card>
            )}
            {visible
              .filter((q) => shouldShowQuestion(q, answersMap))
              .map((q, idx) => (
                <Card key={q.id} className="border-border bg-card p-4">
                  <Label className="text-base font-bold">
                    {idx + 1}. {q.label}
                    {q.required && <span className="ml-1 text-destructive">*</span>}
                  </Label>
                  {q.help_text && <p className="mt-1 text-xs text-muted-foreground">{q.help_text}</p>}
                  <div className="mt-3">
                    <PreviewInput
                      q={q}
                      value={values[q.id]}
                      onChange={(v) => setVal(q.id, v)}
                      onFakeFile={(name) =>
                        setFakeFiles((s) => ({ ...s, [q.id]: [...(s[q.id] ?? []), name] }))
                      }
                      files={fakeFiles[q.id] ?? []}
                    />
                  </div>
                </Card>
              ))}
            {visible.length === 0 && (
              <Card className="border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
                No questions yet — add some, then preview again.
              </Card>
            )}
            <Card className="border-primary/30 bg-card/95 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-muted-foreground">
                  Submit is simulated. No record is created.
                </div>
                <Button onClick={trySubmit} className="bg-gradient-primary font-bold">
                  Try Submit
                </Button>
              </div>
              {missing.length > 0 && (
                <div className="mt-3 rounded border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                  Missing required: {missing.join(", ")}
                </div>
              )}
              {missing.length === 0 && Object.keys(values).length > 0 && (
                <div className="mt-3 rounded border border-emerald-500/40 bg-emerald-500/5 p-2 text-xs text-emerald-700">
                  Validation OK — in production this would submit.
                </div>
              )}
            </Card>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PreviewInput({
  q,
  value,
  onChange,
  onFakeFile,
  files,
}: {
  q: NfQuestion;
  value: any;
  onChange: (v: any) => void;
  onFakeFile: (name: string) => void;
  files: string[];
}) {
  const opts = (q.options ?? []) as string[];
  if (q.question_type === "short_text") return <Input value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
  if (q.question_type === "long_text") return <Textarea rows={4} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
  if (q.question_type === "number") return <Input type="number" value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
  if (q.question_type === "date") return <Input type="date" value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
  if (q.question_type === "rating") {
    const n = Number(value) || 0;
    return (
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((i) => (
          <button
            key={i}
            type="button"
            onClick={() => onChange(i)}
            className={`h-10 w-10 rounded-md border text-sm font-bold ${
              n === i ? "border-primary bg-primary text-primary-foreground" : "border-border bg-muted/30"
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
      <RadioGroup value={value ?? ""} onValueChange={onChange}>
        {opts.map((o) => (
          <div key={o} className="flex items-center gap-2">
            <RadioGroupItem value={o} id={`prev-${q.id}-${o}`} />
            <Label htmlFor={`prev-${q.id}-${o}`} className="font-normal">{o}</Label>
          </div>
        ))}
      </RadioGroup>
    );
  }
  if (q.question_type === "dropdown") {
    return (
      <Select value={value ?? ""} onValueChange={onChange}>
        <SelectTrigger><SelectValue placeholder="Choose…" /></SelectTrigger>
        <SelectContent>
          {opts.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
        </SelectContent>
      </Select>
    );
  }
  if (q.question_type === "multi_choice") {
    const arr: string[] = Array.isArray(value) ? value : [];
    const toggle = (o: string) => onChange(arr.includes(o) ? arr.filter((x) => x !== o) : [...arr, o]);
    return (
      <div className="space-y-2">
        {opts.map((o) => (
          <label key={o} className="flex items-center gap-2 text-sm">
            <Checkbox checked={arr.includes(o)} onCheckedChange={() => toggle(o)} />{o}
          </label>
        ))}
      </div>
    );
  }
  if (q.question_type === "file" || q.question_type === "video") {
    return (
      <div className="space-y-2">
        {files.length > 0 && (
          <ul className="space-y-1 text-xs">
            {files.map((f, i) => (
              <li key={i} className="rounded bg-muted/30 px-2 py-1">{f} (preview — not uploaded)</li>
            ))}
          </ul>
        )}
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border bg-muted/20 px-3 py-2 text-sm">
          <Upload className="h-4 w-4" />
          <span>Choose {q.question_type === "video" ? "video" : "file"} (preview)</span>
          <input
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFakeFile(f.name);
              e.target.value = "";
            }}
          />
        </label>
      </div>
    );
  }
  return null;
}