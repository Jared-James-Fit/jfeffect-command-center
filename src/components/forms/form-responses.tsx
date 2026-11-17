import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { answeredQuestions, type FormAnswerRow, type FormQuestionRow } from "@/lib/form-answer-text";
import { readinessLine } from "@/lib/form-checklist";
import { ChecklistAnswers, ReadinessSummary, relativeTime, useFormReadiness, verdictTone } from "@/components/forms/readiness-view";

const db = supabase as any;

type Row = {
  clientId: string;
  name: string;
  sentAt: string | null;
  sub: { id: string; status: string; submitted_at: string | null; answers_updated_at: string | null; created_at: string } | null;
};

/**
 * Who a form went to and what came back, one row per client (their latest
 * copy): waiting, filling it in, or sent with its answers a tap away. The same
 * assignments and submissions the chat card and the client's profile read.
 */
export function FormResponses({ formId }: { formId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["form-responses", formId],
    staleTime: 30_000,
    queryFn: async () => {
      const [{ data: asg, error: ae }, { data: subs, error: se }, { data: form }] = await Promise.all([
        db.from("nf_assignments").select("client_id, last_sent_at, updated_at, created_at, client:client_id(full_name)").eq("form_id", formId),
        db
          .from("nf_submissions")
          .select("id, client_id, status, submitted_at, answers_updated_at, created_at, client:client_id(full_name)")
          .eq("form_id", formId)
          .order("created_at", { ascending: false })
          .limit(500),
        db.from("nf_forms").select("allow_updates").eq("id", formId).maybeSingle(),
      ]);
      if (ae) throw ae;
      if (se) throw se;
      const rows = new Map<string, Row>();
      for (const s of (subs ?? []) as any[]) {
        if (rows.has(s.client_id)) continue;
        rows.set(s.client_id, { clientId: s.client_id, name: s.client?.full_name ?? "Client", sentAt: null, sub: s });
      }
      for (const a of (asg ?? []) as any[]) {
        const r = rows.get(a.client_id) ?? { clientId: a.client_id, name: a.client?.full_name ?? "Client", sentAt: null, sub: null };
        r.sentAt = a.last_sent_at ?? a.updated_at ?? a.created_at;
        rows.set(a.client_id, r);
      }
      return {
        rows: [...rows.values()].sort((a, b) => String(b.sub?.submitted_at ?? b.sentAt ?? "").localeCompare(String(a.sub?.submitted_at ?? a.sentAt ?? ""))),
        keepsUpdating: !!form?.allow_updates,
      };
    },
  });

  if (isLoading) return <p className="flex items-center gap-2 p-3 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>;
  const rows = data?.rows ?? [];
  if (!rows.length) return <p className="p-3 text-sm text-muted-foreground">Nobody's been sent this form yet. Send it from a client's chat.</p>;
  const done = rows.filter((r) => r.sub && r.sub.status !== "in_progress").length;
  return (
    <div className="space-y-2" data-form-responses>
      <p className="text-[13px] text-muted-foreground">
        Sent to {rows.length} · {done} answered · {rows.length - done} waiting
      </p>
      <ul className="divide-y divide-border rounded-xl border border-border">
        {rows.map((r) => (
          <ResponseRow key={r.clientId} row={r} formId={formId} keepsUpdating={!!data?.keepsUpdating} />
        ))}
      </ul>
    </div>
  );
}

function ResponseRow({ row, formId, keepsUpdating }: { row: Row; formId: string; keepsUpdating: boolean }) {
  const [open, setOpen] = useState(false);
  const sent = !!row.sub && row.sub.status !== "in_progress";
  const { data: ready } = useFormReadiness(row.sub?.id, formId, { enabled: keepsUpdating && !!row.sub });
  const status = !row.sub
    ? "Not started"
    : ready
      ? readinessLine(ready.readiness)
      : sent
        ? `Sent ${new Date(row.sub.submitted_at ?? row.sub.created_at).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}`
        : "Filling it in";
  return (
    <li>
      <button type="button" disabled={!row.sub} onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-h-[52px] w-full items-center gap-3 px-3 py-2 text-left disabled:opacity-100">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold">{row.name}</p>
          <p className={cn("truncate text-[13px]", ready ? verdictTone(ready.readiness) : "text-muted-foreground")}>
            {status}
            {row.sub?.answers_updated_at ? ` · updated ${relativeTime(row.sub.answers_updated_at)}` : ""}
          </p>
        </div>
        {row.sub && <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />}
      </button>
      {open && row.sub && (
        <div className="px-3 pb-3">
          {ready ? (
            <div className="space-y-2">
              <ReadinessSummary data={ready} />
              <ChecklistAnswers data={ready} />
            </div>
          ) : (
            <FormAnswersList submissionId={row.sub.id} formId={formId} />
          )}
        </div>
      )}
    </li>
  );
}

/** A sent form's answers in the form's order (files left out). */
export function FormAnswersList({ submissionId, formId }: { submissionId: string; formId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["form-response-answers", submissionId],
    queryFn: async () => {
      const [q, a] = await Promise.all([
        db.from("nf_questions").select("id, label, order_index, question_type").eq("form_id", formId),
        db.from("nf_answers").select("question_id, value_text, value_number, value_json").eq("submission_id", submissionId),
      ]);
      if (q.error) throw q.error;
      if (a.error) throw a.error;
      return answeredQuestions((q.data ?? []) as FormQuestionRow[], (a.data ?? []) as FormAnswerRow[]);
    },
  });
  if (isLoading) return <p className="text-[13px] text-muted-foreground">Loading answers…</p>;
  if (!data?.length) return <p className="text-[13px] text-muted-foreground">No answers yet.</p>;
  return (
    <dl className="space-y-1.5">
      {data.map((r) => (
        <div key={r.id}>
          <dt className="text-[12px] text-muted-foreground">{r.label}</dt>
          <dd className="whitespace-pre-wrap break-words text-[14px]">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}
