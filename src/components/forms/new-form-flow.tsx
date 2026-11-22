import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { FileEdit, Loader2, PenLine, Copy } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { CATEGORY_SUGGESTIONS } from "@/lib/form-library";
import { useLibraryForms } from "@/lib/form-library.queries";
import { draftFormWithAiFn } from "@/lib/native-forms.functions";
import { duplicateForm, getForm, upsertForm, type NfForm } from "@/lib/native-forms";

type Start = "blank" | "ai" | "template";

/**
 * Make a form: blank, drafted with AI from a sentence, or a copy of a
 * template. Always a draft that's the coach's own, opened in the builder next;
 * nothing reaches a client until it's sent.
 */
export function NewFormFlow({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (form: NfForm) => void }) {
  const [start, setStart] = useState<Start>("blank");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [prompt, setPrompt] = useState("");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const draft = useServerFn(draftFormWithAiFn);
  const { data: forms = [] } = useLibraryForms(open && start === "template");
  const templates = forms.filter((f) => !f.archived && (f.is_template || !f.owner_id));

  async function create() {
    setBusy(true);
    try {
      let id: string;
      if (start === "ai") {
        const r = await draft({ data: { prompt: prompt.trim(), category: category.trim() || undefined } });
        id = r.formId;
      } else if (start === "template") {
        if (!templateId) throw new Error("Pick a form to start from");
        const src = forms.find((f) => f.id === templateId);
        id = await duplicateForm(templateId);
        await upsertForm({ id, title: title.trim() || `${src?.title ?? "Form"} (copy)`, category: category.trim() || src?.category || undefined });
      } else {
        id = await upsertForm({
          title: title.trim() || "Untitled form",
          category: category.trim() || undefined,
          form_type: "check_in",
          recurrence: "none",
          active: false,
          kind: "native",
          open_style: "embed",
          visibility: "selected",
        });
      }
      const form = await getForm(id);
      if (!form) throw new Error("The form was made but couldn't be opened. Find it in your library.");
      onCreated(form);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't make that form");
    } finally {
      setBusy(false);
    }
  }

  const ready = start === "ai" ? prompt.trim().length >= 8 : start === "template" ? !!templateId : true;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="max-h-[90svh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New form</DialogTitle>
          <DialogDescription>It's yours and a draft until you send it.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Start from">
          {([
            ["blank", "Blank", FileEdit],
            ["ai", "Draft from a description", PenLine],
            ["template", "From a form", Copy],
          ] as const).map(([k, label, Icon]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={start === k}
              onClick={() => setStart(k)}
              className={cn("flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-xl border text-[13px] font-semibold", start === k ? "border-foreground bg-muted" : "border-border")}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>

        {start === "ai" ? (
          <div className="space-y-1.5">
            <label className="text-[13px] font-semibold" htmlFor="nf-ai-prompt">What's the form for?</label>
            <Textarea
              id="nf-ai-prompt"
              rows={4}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="A powerlifting meet-day checklist that collects bodyweight, handler info and equipment readiness."
              className="text-[16px]"
            />
            <p className="text-[12px] text-muted-foreground">You'll see every question in the builder before anyone gets it.</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            <label className="text-[13px] font-semibold" htmlFor="nf-title">Name</label>
            <Input id="nf-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={start === "template" ? "Same name, with (copy)" : "Untitled form"} className="h-11 text-[16px]" />
          </div>
        )}

        {start === "template" && (
          <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-border p-1">
            {templates.length === 0 && <p className="p-3 text-[14px] text-muted-foreground">No templates yet.</p>}
            {templates.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setTemplateId(f.id)}
                aria-pressed={templateId === f.id}
                className={cn("flex min-h-[44px] w-full flex-col justify-center rounded-lg px-3 text-left", templateId === f.id ? "bg-muted" : "")}
              >
                <span className="text-[14px] font-semibold">{f.title}</span>
                {f.category && <span className="text-[12px] text-muted-foreground">{f.category}</span>}
              </button>
            ))}
          </div>
        )}

        <div className="space-y-1.5">
          <p className="text-[13px] font-semibold">Category</p>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORY_SUGGESTIONS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(category === c ? "" : c)}
                className={cn("min-h-[36px] rounded-full px-3 text-[13px]", category === c ? "bg-foreground text-background" : "bg-muted")}
              >
                {c}
              </button>
            ))}
          </div>
          <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Or type your own" className="h-10 text-[16px]" maxLength={60} />
        </div>

        <Button className="h-12 w-full text-[16px] font-semibold" onClick={create} disabled={busy || !ready}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {start === "ai" ? (busy ? "Drafting…" : "Draft it") : "Make the form"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
