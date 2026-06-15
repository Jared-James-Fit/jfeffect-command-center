import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  ClipboardList,
  FileText,
  Inbox,
  Search,
  CheckCircle2,
  Clock,
  Save,
} from "lucide-react";

type Source = "fillout" | "native";

type IntakeRow = {
  key: string;
  source: Source;
  id: string;
  title: string;
  type: string | null;
  submittedAt: string | null;
  status: string | null;
  responseJson?: any;
  formId?: string | null;
};

export type IntakeAnswersDialogProps = {
  clientId: string;
  clientName?: string | null;
  trigger: ReactNode;
};

/**
 * One-stop viewer for everything a client filled out: Fillout intake
 * submissions + in-app native form submissions. Designed to be opened from a
 * single big button on both the admin client card and the client's own
 * dashboard so neither side has to hunt for "those questions I answered".
 */
export function IntakeAnswersDialog({
  clientId,
  clientName,
  trigger,
}: IntakeAnswersDialogProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const { data: fillout = [], isLoading: filloutLoading } = useQuery({
    queryKey: ["intake-fillout", clientId],
    enabled: open && !!clientId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("fillout_submissions")
        .select(
          "id, form_name, form_type, response_json, submitted_at, created_at",
        )
        .eq("client_id", clientId)
        .order("submitted_at", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const { data: native = [], isLoading: nativeLoading } = useQuery({
    queryKey: ["intake-native", clientId],
    enabled: open && !!clientId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("nf_submissions")
        .select(
          "id, status, submitted_at, created_at, form_id, form:form_id(id,title,form_type)",
        )
        .eq("client_id", clientId)
        .order("submitted_at", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const rows: IntakeRow[] = useMemo(() => {
    const out: IntakeRow[] = [];
    for (const f of fillout) {
      out.push({
        key: `f-${f.id}`,
        source: "fillout",
        id: f.id,
        title: f.form_name || "Intake form",
        type: f.form_type ?? "Intake",
        submittedAt: f.submitted_at ?? f.created_at,
        status: f.submitted_at ? "submitted" : "received",
        responseJson: f.response_json,
      });
    }
    for (const n of native) {
      out.push({
        key: `n-${n.id}`,
        source: "native",
        id: n.id,
        title: n.form?.title || "In-app form",
        type: n.form?.form_type ?? "In-app",
        submittedAt: n.submitted_at ?? n.created_at,
        status: n.status,
        formId: n.form_id,
      });
    }
    out.sort((a, b) => {
      const da = a.submittedAt ? Date.parse(a.submittedAt) : 0;
      const db = b.submittedAt ? Date.parse(b.submittedAt) : 0;
      return db - da;
    });
    return out;
  }, [fillout, native]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        (r.type ?? "").toLowerCase().includes(q),
    );
  }, [rows, search]);

  const loading = filloutLoading || nativeLoading;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-hidden p-0">
        <DialogHeader className="border-b border-border bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-5">
          <div className="flex items-start gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
              <ClipboardList className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-lg">
                Intake & Form Answers
                {clientName ? (
                  <span className="text-muted-foreground"> · {clientName}</span>
                ) : null}
              </DialogTitle>
              <DialogDescription className="text-xs">
                Every questionnaire response in one place — intake forms from
                sign-up plus any in-app form you’ve completed.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-3 overflow-y-auto p-4 md:p-5" style={{ maxHeight: "calc(88vh - 110px)" }}>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search forms by name or type…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>

          {loading ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              Loading answers…
            </Card>
          ) : filtered.length === 0 ? (
            <Card className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
              <Inbox className="h-8 w-8 opacity-40" />
              <div className="font-medium">No form answers yet</div>
              <div className="max-w-sm text-xs">
                When intake or in-app form submissions are received they’ll
                appear here automatically.
              </div>
            </Card>
          ) : (
            <Accordion type="single" collapsible className="space-y-2">
              {filtered.map((r) => (
                <AccordionItem
                  key={r.key}
                  value={r.key}
                  className="overflow-hidden rounded-lg border border-border bg-card"
                >
                  <AccordionTrigger className="px-3 py-3 hover:no-underline">
                    <div className="flex min-w-0 flex-1 items-center gap-3 text-left">
                      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-secondary/60 text-foreground">
                        <FileText className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-semibold">{r.title}</span>
                          <Badge variant="outline" className="text-[10px]">
                            {r.source === "fillout" ? "Intake" : "In-app"}
                          </Badge>
                          {r.status === "submitted" || r.status === "reviewed" ? (
                            <Badge className="gap-1 text-[10px]">
                              <CheckCircle2 className="h-3 w-3" />
                              {r.status === "reviewed" ? "Reviewed" : "Submitted"}
                            </Badge>
                          ) : r.status === "in_progress" ? (
                            <Badge variant="secondary" className="gap-1 text-[10px]">
                              <Clock className="h-3 w-3" />
                              In progress
                            </Badge>
                          ) : null}
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {r.submittedAt
                            ? new Date(r.submittedAt).toLocaleString()
                            : "Not yet submitted"}
                          {r.type ? <span className="ml-2">· {r.type}</span> : null}
                        </div>
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="border-t border-border bg-secondary/20 px-3 py-3">
                    {r.source === "fillout" ? (
                      <FilloutAnswers responseJson={r.responseJson} />
                    ) : (
                      <NativeAnswers submissionId={r.id} formId={r.formId ?? null} />
                    )}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FilloutAnswers({ responseJson }: { responseJson: any }) {
  const questions: any[] | null = Array.isArray(responseJson?.questions)
    ? responseJson.questions
    : null;
  if (!questions || questions.length === 0) {
    return (
      <pre className="overflow-auto rounded bg-background p-2 text-xs">
        {responseJson ? JSON.stringify(responseJson, null, 2) : "No response data."}
      </pre>
    );
  }
  return (
    <div className="space-y-2">
      {questions.map((q: any, i: number) => (
        <div
          key={q.id ?? i}
          className="rounded-md border border-border bg-card p-2.5"
        >
          <div className="text-xs font-semibold text-muted-foreground">
            {q.name || `Question ${i + 1}`}
          </div>
          <div className="mt-1 whitespace-pre-wrap text-sm">
            {formatValue(q.value)}
          </div>
        </div>
      ))}
    </div>
  );
}

function NativeAnswers({
  submissionId,
  formId,
}: {
  submissionId: string;
  formId: string | null;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["intake-native-detail", submissionId, formId],
    queryFn: async () => {
      const [{ data: answers }, { data: questions }] = await Promise.all([
        (supabase as any)
          .from("nf_answers")
          .select("id, question_id, value_text, value_number, value_json")
          .eq("submission_id", submissionId),
        formId
          ? (supabase as any)
              .from("nf_questions")
              .select("id, label, order_index, question_type")
              .eq("form_id", formId)
              .order("order_index", { ascending: true })
          : Promise.resolve({ data: [] as any[] }),
      ]);
      return {
        answers: (answers ?? []) as any[],
        questions: (questions ?? []) as any[],
      };
    },
  });

  if (isLoading) {
    return <div className="text-xs text-muted-foreground">Loading answers…</div>;
  }
  const answers = data?.answers ?? [];
  const questions = data?.questions ?? [];
  if (answers.length === 0) {
    return (
      <div className="text-xs text-muted-foreground">
        No answers recorded yet for this submission.
      </div>
    );
  }
  const byId = new Map(questions.map((q: any) => [q.id, q]));
  const ordered = [...answers].sort((a, b) => {
    const oa = (byId.get(a.question_id) as any)?.order_index ?? 9999;
    const ob = (byId.get(b.question_id) as any)?.order_index ?? 9999;
    return oa - ob;
  });
  return (
    <div className="space-y-2">
      {ordered.map((a: any) => {
        const q = byId.get(a.question_id) as any;
        const value =
          a.value_text ??
          (a.value_number != null ? String(a.value_number) : null) ??
          (a.value_json != null ? formatValue(a.value_json) : null);
        return (
          <div
            key={a.id}
            className="rounded-md border border-border bg-card p-2.5"
          >
            <div className="text-xs font-semibold text-muted-foreground">
              {q?.label ?? "Question"}
            </div>
            <div className="mt-1 whitespace-pre-wrap text-sm">
              {value ?? <span className="text-muted-foreground">—</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function formatValue(v: any): string {
  if (v == null) return "—";
  if (Array.isArray(v)) return v.map((x) => formatValue(x)).join(", ");
  if (typeof v === "object") return JSON.stringify(v, null, 2);
  return String(v);
}

/**
 * Convenience: the "big, dummy-proof" button that opens the dialog. Used
 * verbatim on both the admin client card and the client dashboard so they
 * look and behave identically.
 */
export function IntakeAnswersBigButton({
  clientId,
  clientName,
  subtitle = "All your intake & questionnaire answers in one place",
  label = "View Intake & Form Answers",
}: {
  clientId: string;
  clientName?: string | null;
  subtitle?: string;
  label?: string;
}) {
  return (
    <IntakeAnswersDialog
      clientId={clientId}
      clientName={clientName}
      trigger={
        <Button
          variant="outline"
          className="group flex h-auto w-full items-center gap-4 rounded-xl border-2 border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-4 text-left hover:border-primary/60 hover:from-primary/15"
        >
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm transition group-hover:scale-105">
            <ClipboardList className="h-6 w-6" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-base font-semibold leading-tight">
              {label}
            </span>
            <span className="text-xs font-normal text-muted-foreground">
              {subtitle}
            </span>
          </span>
          <span className="hidden text-xs font-semibold text-primary sm:inline">
            Open →
          </span>
        </Button>
      }
    />
  );
}