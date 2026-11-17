import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronDown, Minus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  checklistItems,
  checklistStates,
  readiness,
  readinessLine,
  stateWords,
  visibleItems,
  type Readiness,
} from "@/lib/form-checklist";
import { conditionsPass, type AnswerLike } from "@/lib/form-logic";
import { daysOutLabel, daysUntil, meetFacts, meetIssues, weightCheck, MEET_CHECKLIST_FORM_TYPE, type MeetFacts } from "@/lib/meet-checklist";

const db = supabase as any;
export const todayLocal = () => new Date().toLocaleDateString("en-CA");

type QRow = {
  id: string;
  label: string;
  question_type: string;
  required: boolean;
  options: unknown;
  validation: Record<string, unknown> | null;
  conditional_logic: unknown;
  order_index: number;
};

export type FormReadinessData = {
  readiness: Readiness;
  facts: MeetFacts | null;
  questions: QRow[];
  answers: Record<string, AnswerLike | undefined>;
  updatedAt: string | null;
  submittedAt: string | null;
  isMeet: boolean;
};

/** Readiness of one submission, worked out from its answers (never stored, so it can't drift). */
export function computeFormReadiness(
  form: { form_type?: string | null; settings?: unknown },
  questions: QRow[],
  answerRows: Array<{ question_id: string; value_text: string | null; value_number: number | null; value_json: unknown }>,
  today = todayLocal(),
): Pick<FormReadinessData, "readiness" | "facts" | "answers" | "isMeet"> {
  const answers: Record<string, AnswerLike | undefined> = {};
  for (const a of answerRows) answers[a.question_id] = a;
  const isMeet = form.form_type === MEET_CHECKLIST_FORM_TYPE;
  const facts = isMeet ? meetFacts(questions, answers) : null;
  const r = readiness({
    questions,
    answers,
    settings: form.settings,
    visible: (q) => conditionsPass(q.conditional_logic as any, answers),
    extra: facts ? meetIssues(facts, today) : [],
  });
  return { readiness: r, facts, answers, isMeet };
}

export function useFormReadiness(submissionId: string | null | undefined, formId: string, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ["form-readiness", submissionId, formId],
    enabled: !!submissionId && opts.enabled !== false,
    staleTime: 15_000,
    queryFn: async (): Promise<FormReadinessData> => {
      const [f, q, a, s] = await Promise.all([
        db.from("nf_forms").select("form_type, settings").eq("id", formId).maybeSingle(),
        db.from("nf_questions").select("id, label, question_type, required, options, validation, conditional_logic, order_index").eq("form_id", formId).is("archived_at", null).order("order_index"),
        db.from("nf_answers").select("question_id, value_text, value_number, value_json").eq("submission_id", submissionId),
        db.from("nf_submissions").select("submitted_at, answers_updated_at, updated_at").eq("id", submissionId).maybeSingle(),
      ]);
      if (q.error) throw q.error;
      if (a.error) throw a.error;
      const questions = (q.data ?? []) as QRow[];
      const out = computeFormReadiness(f.data ?? {}, questions, a.data ?? []);
      return {
        ...out,
        questions,
        updatedAt: s.data?.answers_updated_at ?? null,
        submittedAt: s.data?.submitted_at ?? null,
      };
    },
  });
}

export function verdictTone(r: Readiness) {
  return r.verdict === "ready" ? "text-success" : r.verdict === "attention" ? "text-warning" : "text-muted-foreground";
}

export function relativeTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return null;
  const m = Math.round(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

/** "MPA Provincials · Sat, Dec 5 · 9 days out" */
export function meetSummary(f: MeetFacts | null, today = todayLocal()): string | null {
  if (!f || (!f.meetName && !f.meetDate)) return null;
  const date = f.meetDate ? new Date(`${f.meetDate}T00:00:00`).toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" }) : null;
  const days = daysUntil(f.meetDate, today);
  return [f.meetName, date, days != null && days >= 0 ? daysOutLabel(days) : null].filter(Boolean).join(" · ");
}

/**
 * The coach's read of a checklist: the verdict, the meet, weight and handler
 * in a line each, every area with its word, then what's open, critical
 * first. Worked out from the answers each time (form-checklist.ts).
 */
export function ReadinessSummary({ data, compact = false }: { data: FormReadinessData; compact?: boolean }) {
  const { readiness: r, facts } = data;
  const today = todayLocal();
  const days = daysUntil(facts?.meetDate, today);
  const check = facts ? weightCheck(facts, days) : null;
  const open = r.issues.filter((i) => i.kind !== "unconfirmed");
  const unconfirmed = r.issues.filter((i) => i.kind === "unconfirmed" && i.severity !== "optional");
  return (
    <div className="space-y-3" data-readiness-summary data-verdict={r.verdict}>
      <div className="flex items-start gap-2">
        {r.verdict === "attention" ? (
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        ) : r.verdict === "ready" ? (
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" strokeWidth={3} />
        ) : (
          <Minus className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0">
          <p className={cn("text-[15px] font-semibold", verdictTone(r))}>{readinessLine(r)}</p>
          {facts && meetSummary(facts, today) && <p className="text-[13px] text-muted-foreground">{meetSummary(facts, today)}</p>}
          {data.updatedAt && <p className="text-[12px] text-muted-foreground">Updated {relativeTime(data.updatedAt)}</p>}
        </div>
      </div>

      {facts && (
        <dl className="grid gap-1 text-[13px]">
          {(facts.bodyweight || facts.weightClass) && (
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-muted-foreground">Weight</dt>
              <dd className="min-w-0">
                {[facts.bodyweight ? `${facts.bodyweight.value} ${facts.bodyweight.unit}` : null, facts.weightClass].filter(Boolean).join(" · ")}
                {check && <span className={cn("block font-semibold", check.severity === "critical" ? "text-destructive" : "text-warning")}>{check.line}</span>}
                {facts.weightConcern && facts.weightConcern !== "No concerns" && <span className="block text-warning">{facts.weightConcern}{facts.weightDetails ? `: ${facts.weightDetails}` : ""}</span>}
              </dd>
            </div>
          )}
          {facts.handler && (
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-muted-foreground">Handler</dt>
              <dd className="min-w-0">
                {facts.handler}
                {(facts.handlerContact.name || facts.handlerContact.phone || facts.handlerContact.email) && (
                  <span className="block text-muted-foreground">
                    {[facts.handlerContact.name, facts.handlerContact.phone, facts.handlerContact.email].filter(Boolean).join(" · ")}
                  </span>
                )}
              </dd>
            </div>
          )}
        </dl>
      )}

      {!compact && r.areas.length > 0 && (
        <ul className="grid grid-cols-1 gap-1 text-[13px] sm:grid-cols-2" data-readiness-areas>
          {r.areas.map((a) => (
            <li key={a.key} className="flex items-center justify-between gap-2 rounded-lg bg-muted px-2.5 py-1.5">
              <span className="text-muted-foreground">{a.label}</span>
              <span className={cn("font-semibold", a.status === "attention" ? "text-warning" : a.status === "complete" ? "text-success" : "text-muted-foreground")}>{a.word}</span>
            </li>
          ))}
        </ul>
      )}

      {open.length > 0 && (
        <ul className="space-y-1 text-[13px]" data-readiness-issues>
          {open.map((i, n) => (
            <li key={`${i.questionId}-${i.itemKey ?? n}`} className="flex items-start gap-2">
              <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", i.severity === "critical" ? "bg-destructive" : i.severity === "important" ? "bg-warning" : "bg-muted-foreground")} aria-hidden />
              <span className="min-w-0">
                <span className="font-medium">{i.label}</span>
                <span className="text-muted-foreground">
                  {" · "}
                  {i.kind === "need" ? "Still need" : i.detail}
                  {i.severity === "critical" ? " · critical" : i.severity === "optional" ? " · optional" : ""}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {unconfirmed.length > 0 && r.verdict !== "not_started" && (
        <p className="text-[12px] text-muted-foreground">
          Not confirmed yet: {unconfirmed.slice(0, 4).map((i) => i.label).join(", ")}
          {unconfirmed.length > 4 ? ` and ${unconfirmed.length - 4} more` : ""}
        </p>
      )}
    </div>
  );
}

/** Every checklist item as the athlete marked it, a section at a time (folded). */
export function ChecklistAnswers({ data }: { data: FormReadinessData }) {
  const [open, setOpen] = useState(false);
  const sections = useMemo(
    () =>
      data.questions
        .filter((q) => q.question_type === "checklist" && conditionsPass(q.conditional_logic as any, data.answers))
        .map((q) => {
          const states = checklistStates(data.answers[q.id]?.value_json);
          const words = stateWords(q);
          return {
            id: q.id,
            label: q.label,
            rows: visibleItems(checklistItems(q), data.answers).map((i) => ({ label: i.label, state: states.get(i.key) ?? null, word: states.get(i.key) ? words[states.get(i.key)!] : "Not marked" })),
          };
        }),
    [data],
  );
  if (!sections.length) return null;
  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-h-10 w-full items-center justify-between text-[13px] font-semibold">
        Every item
        <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-3 pt-1">
          {sections.map((s) => (
            <div key={s.id}>
              <p className="text-[12px] font-semibold text-muted-foreground">{s.label}</p>
              <ul className="mt-1 space-y-0.5 text-[13px]">
                {s.rows.map((r) => (
                  <li key={r.label} className="flex items-center justify-between gap-2">
                    <span className={cn(r.state === "na" && "text-muted-foreground line-through")}>{r.label}</span>
                    <span className={cn("shrink-0", r.state === "ready" ? "text-success" : r.state === "need" ? "font-semibold text-warning" : "text-muted-foreground")}>{r.word}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
