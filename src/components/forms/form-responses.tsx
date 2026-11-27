/**
 * A form's responses, Google Forms' way: Summary (each question once, counted
 * and charted), Individual (one person's full response, large and readable,
 * with Mark reviewed, Message and Profile) and Table (everyone at once,
 * filtered and sorted). One viewer for the Forms library, the form editor's
 * Responses tab, the chat's "View full response" and the Submissions inbox,
 * so a response reads the same wherever it's opened.
 *
 * Who it's out with and where each person stands is form-response-status.ts
 * (the same rule as nf_form_library_stats), read with the coach's own login
 * (RLS decides whose responses they see).
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Loader2, MessageCircle, MoreHorizontal, Pencil, User } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { answeredQuestions, formAnswerText, type FormAnswerRow, type FormQuestionRow } from "@/lib/form-answer-text";
import {
  countsLine,
  formPeople,
  responseCounts,
  sortPeople,
  STATE_LABEL,
  type AssignmentRow,
  type FormPerson,
  type PersonState,
  type SubmissionRow,
} from "@/lib/form-response-status";
import { pctLabel, summarizeForm, type QuestionSummary, type SummaryQuestion, type SummaryResponse } from "@/lib/form-response-summary";
import { readinessLine } from "@/lib/form-checklist";
import { ChecklistAnswers, ReadinessSummary, relativeTime, useFormReadiness, verdictTone } from "@/components/forms/readiness-view";
import { CompetitionPlanSummary } from "@/components/forms/competition-plan-summary";
import { NativeAnswers } from "@/components/clients/intake-answers-dialog";
import { OpenInChatButton } from "@/components/forms/open-in-chat";
import { refreshReviewQueries } from "@/lib/checkin-review";

const db = supabase as any;

export const formResponsesKey = (formId: string) => ["form-responses", formId] as const;

type FormMeta = { id: string; title: string; form_type: string | null; allow_updates: boolean | null; kind: string | null };
type QuestionRow = SummaryQuestion & { archived_at?: string | null };

export type FormResponsesData = {
  form: FormMeta | null;
  questions: QuestionRow[];
  people: FormPerson[];
  answersBySubmission: Map<string, FormAnswerRow[]>;
};

/** Every row of a read, 1,000 at a time (a capped request would silently drop the rest). */
async function readAll<T>(build: (from: number, to: number) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return out;
  }
}

async function loadFormResponses(formId: string): Promise<FormResponsesData> {
  const [{ data: form }, questions, assignments, submissions] = await Promise.all([
    db.from("nf_forms").select("id, title, form_type, allow_updates, kind").eq("id", formId).maybeSingle(),
    readAll<QuestionRow>((a, b) =>
      db.from("nf_questions").select("id, label, order_index, question_type, options, validation, archived_at").eq("form_id", formId).order("order_index").range(a, b),
    ),
    readAll<AssignmentRow>((a, b) =>
      db.from("nf_assignments").select("client_id, created_at, updated_at, last_sent_at, settings, client:client_id(full_name, archived)").eq("form_id", formId).range(a, b),
    ),
    readAll<SubmissionRow>((a, b) =>
      db
        .from("nf_submissions")
        .select("id, client_id, status, submitted_at, reviewed_at, answers_updated_at, created_at, updated_at, client:client_id(full_name, archived)")
        .eq("form_id", formId)
        .order("created_at", { ascending: false })
        .range(a, b),
    ),
  ]);
  const sentIds = submissions.filter((s) => s.status !== "in_progress").map((s) => s.id);
  const answers: Array<FormAnswerRow & { submission_id: string }> = [];
  for (let i = 0; i < sentIds.length; i += 150) {
    const ids = sentIds.slice(i, i + 150);
    answers.push(
      ...(await readAll<FormAnswerRow & { submission_id: string }>((a, b) =>
        db.from("nf_answers").select("submission_id, question_id, value_text, value_number, value_json").in("submission_id", ids).range(a, b),
      )),
    );
  }
  const answersBySubmission = new Map<string, FormAnswerRow[]>();
  for (const a of answers) answersBySubmission.set(a.submission_id, [...(answersBySubmission.get(a.submission_id) ?? []), a]);
  // A draft is touched when an answer on it changes (saving one never moves the submission's row).
  const draftIds = submissions.filter((s) => s.status === "in_progress").map((s) => s.id);
  const touched = new Map<string, string>();
  for (let i = 0; i < draftIds.length; i += 150) {
    const ids = draftIds.slice(i, i + 150);
    const rows = await readAll<{ submission_id: string; created_at: string | null; updated_at: string | null }>((a, b) =>
      db.from("nf_answers").select("submission_id, created_at, updated_at").in("submission_id", ids).range(a, b),
    );
    for (const r of rows) {
      const at = [r.updated_at, r.created_at].filter(Boolean).sort().pop();
      if (at && (!touched.has(r.submission_id) || at > touched.get(r.submission_id)!)) touched.set(r.submission_id, at);
    }
  }
  for (const s of submissions) if (touched.has(s.id)) s.answers_touched_at = touched.get(s.id)!;
  return {
    form: (form ?? null) as FormMeta | null,
    questions,
    // archived clients only once they answered: the same people the counts are about
    people: sortPeople(formPeople(assignments, submissions, { keepsUpdating: !!form?.allow_updates })).filter((p) => p.counted || p.responses.length > 0),
    answersBySubmission,
  };
}

export function useFormResponses(formId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: formResponsesKey(formId ?? ""),
    enabled: !!formId && enabled,
    staleTime: 30_000,
    queryFn: () => loadFormResponses(formId!),
  });
}

type View = "summary" | "individual" | "table";

const fmtDay = (iso: string | null | undefined, withTime = false) => {
  if (!iso) return "";
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString("en-CA", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  });
};

const STATE_TONE: Record<PersonState, string> = {
  answered: "text-success",
  in_progress: "text-warning",
  waiting: "text-muted-foreground",
};

/** One line about a person: "Answered Nov 8 · To review", "Asked again Oct 28", "Waiting since Oct 26". */
export function personLine(p: FormPerson): string {
  if (p.state === "answered") {
    const r = p.responses[0];
    return `Answered ${fmtDay(r?.at)}${r && !r.reviewed ? " · To review" : ""}`;
  }
  if (p.state === "in_progress") return `Filling it in · ${relativeTime(p.draft?.at ?? null) ?? "started"}`;
  if (p.askedAgain) return `Asked again ${fmtDay(p.askedAt)} · last answered ${fmtDay(p.responses[0]?.at)}`;
  return `Waiting since ${fmtDay(p.askedAt)}`;
}

/**
 * The viewer itself. `submissionId` opens Individual on that response; with
 * none it opens on Summary when there's more than one person, else Individual.
 */
export function FormResponsesView({
  formId,
  submissionId,
  clientId,
  initialView,
  onLeave,
}: {
  formId: string;
  submissionId?: string | null;
  /** Open on this person (a client's profile), whether or not they've sent it. */
  clientId?: string | null;
  initialView?: View;
  /** Called as "Open in chat" leaves for the chat (the sheet closes itself). */
  onLeave?: () => void;
}) {
  const { data, isLoading, isError, refetch } = useFormResponses(formId);
  const [view, setView] = useState<View | null>(initialView ?? (submissionId || clientId ? "individual" : null));
  const [focus, setFocus] = useState<{ clientId: string; submissionId: string | null } | null>(null);

  const people = data?.people ?? [];
  const counts = useMemo(() => responseCounts(people), [people]);

  // Where it opens: the response asked for, else the first one waiting on the coach.
  useEffect(() => {
    if (!data || focus) return;
    const bySub = submissionId ? people.find((p) => p.responses.some((r) => r.id === submissionId)) : null;
    const target = bySub ?? (clientId ? people.find((p) => p.clientId === clientId) : null);
    if (!target && (submissionId || clientId)) {
      // asked for someone who isn't here: Individual says so rather than opening another athlete
      setFocus({ clientId: clientId ?? "", submissionId: null });
    } else {
      const first = target ?? people.find((p) => p.responses.length) ?? people[0];
      if (first) setFocus({ clientId: first.clientId, submissionId: bySub ? submissionId! : first.responses[0]?.id ?? null });
    }
    if (!view) setView(people.filter((p) => p.responses.length).length > 1 ? "summary" : "individual");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (isLoading) {
    return (
      <p className="flex items-center gap-2 p-4 text-[15px] text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading responses…
      </p>
    );
  }
  if (isError) {
    return (
      <div className="m-4 rounded-xl border border-destructive/30 p-4 text-[15px]">
        Couldn't load the responses. <button className="font-semibold underline" onClick={() => refetch()}>Try again</button>
      </div>
    );
  }
  if (!people.length) {
    return <p className="p-4 text-[15px] text-muted-foreground" data-form-responses-empty>Nobody's been sent this form yet. Send it from a client's chat.</p>;
  }

  const open = (clientId: string, sid: string | null) => {
    setFocus({ clientId, submissionId: sid });
    setView("individual");
  };

  return (
    <div className="space-y-4" data-form-responses>
      <div className="space-y-3">
        <p className="text-[15px]" data-form-response-counts>
          <span className="font-semibold">{counts.people} {counts.people === 1 ? "person" : "people"}</span>
          <span className="text-muted-foreground"> · {countsLine(counts)}</span>
          {counts.toReview > 0 && <span className="font-medium text-sky-700 dark:text-sky-400"> · {counts.toReview} to review</span>}
          {counts.archived > 0 && <span className="text-muted-foreground"> · {counts.archived} archived</span>}
        </p>
        <div className="grid grid-cols-3 rounded-lg bg-muted p-1" role="tablist" aria-label="Responses view">
          {(["summary", "individual", "table"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={cn(
                "h-10 rounded-md text-[15px] font-medium transition-colors",
                view === v ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
              data-responses-view={v}
            >
              {v === "summary" ? "Summary" : v === "individual" ? "Individual" : "Table"}
            </button>
          ))}
        </div>
      </div>

      {view === "summary" && data && <SummaryView data={data} onOpen={open} />}
      {view === "individual" && data && focus && (
        <IndividualView data={data} focus={focus} onFocus={setFocus} onLeave={onLeave} />
      )}
      {view === "table" && data && <TableView data={data} onOpen={open} />}
    </div>
  );
}

/* ───────────────────────────── Summary ───────────────────────────── */

function latestResponses(data: FormResponsesData): SummaryResponse[] {
  return data.people
    .filter((p) => p.responses.length)
    .map((p) => ({
      submissionId: p.responses[0].id,
      clientId: p.clientId,
      name: p.name,
      at: p.responses[0].at,
      answers: data.answersBySubmission.get(p.responses[0].id) ?? [],
    }));
}

function SummaryView({ data, onOpen }: { data: FormResponsesData; onOpen: (clientId: string, sid: string | null) => void }) {
  const latest = useMemo(() => latestResponses(data), [data]);
  const summaries = useMemo(() => summarizeForm(data.questions.filter((q) => !q.archived_at), latest), [data, latest]);
  const waiting = data.people.filter((p) => p.counted && p.state !== "answered");
  return (
    <div className="space-y-5" data-responses-summary>
      {waiting.length > 0 && (
        <section className="rounded-xl border border-border p-3">
          <h3 className="text-[15px] font-semibold">Not answered yet · {waiting.length}</h3>
          <ul className="mt-1 divide-y divide-border">
            {waiting.map((p) => (
              <li key={p.clientId}>
                <button type="button" onClick={() => onOpen(p.clientId, p.responses[0]?.id ?? null)} className="flex min-h-[44px] w-full items-center justify-between gap-3 py-1.5 text-left">
                  <span className="truncate text-[15px]">{p.name}</span>
                  <span className={cn("shrink-0 text-[13px]", STATE_TONE[p.state])}>{p.state === "in_progress" ? "In progress" : p.askedAgain ? "Asked again" : `Since ${fmtDay(p.askedAt)}`}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {latest.length === 0 ? (
        <p className="text-[15px] text-muted-foreground">No answers yet.</p>
      ) : (
        <>
          <p className="text-[13px] text-muted-foreground">
            {latest.length === 1 ? "From the 1 response" : `From the latest response of each of ${latest.length} people`}
          </p>
          <div className="divide-y divide-border rounded-xl border border-border">
            {summaries.map((s) => (
              <QuestionSummaryBlock key={s.id} s={s} total={latest.length} onOpenPerson={(clientId, submissionId) => onOpen(clientId, submissionId)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const TEXT_PREVIEW = 3;

function QuestionSummaryBlock({ s, total, onOpenPerson }: { s: QuestionSummary; total: number; onOpenPerson: (clientId: string, submissionId: string) => void }) {
  const [all, setAll] = useState(false);
  return (
    <section className="space-y-2 p-3.5" data-summary-question={s.kind}>
      <div>
        <h4 className="text-[15px] font-semibold leading-snug">{s.label}</h4>
        <p className="text-[13px] text-muted-foreground">{s.answered} of {total} answered</p>
      </div>
      {s.kind === "choices" && <Bars rows={s.counts} />}
      {s.kind === "numbers" && (
        <div className="space-y-2">
          <p className="text-[15px]">
            Average <span className="font-semibold tabular-nums">{s.average}{s.unit ? ` ${s.unit}` : ""}</span>
            {s.min !== s.max && <span className="text-muted-foreground"> · {s.min}–{s.max}</span>}
          </p>
          {s.scale && <Bars rows={s.scale.filter((r) => r.count > 0)} />}
        </div>
      )}
      {s.kind === "checklist" && (
        <ul className="space-y-1">
          {s.items.map((it) => (
            <li key={it.label} className="flex items-baseline justify-between gap-3 text-[14px]">
              <span className="min-w-0 truncate">{it.label}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {it.need > 0 && <span className="font-medium text-warning">{it.need} still need · </span>}
                {it.ready} ready{it.na ? ` · ${it.na} N/A` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
      {s.kind === "text" && (
        <>
          <ul className="space-y-2">
            {(all ? s.entries : s.entries.slice(0, TEXT_PREVIEW)).map((e, i) => (
              <li key={i} className="rounded-lg bg-muted/60 px-3 py-2">
                <button type="button" onClick={() => onOpenPerson(e.clientId, e.submissionId)} className="text-[13px] font-medium text-muted-foreground hover:text-foreground">
                  {e.name} · {fmtDay(e.at)}
                </button>
                <p className="whitespace-pre-wrap break-words text-[15px] leading-snug">{e.text}</p>
              </li>
            ))}
          </ul>
          {s.entries.length > TEXT_PREVIEW && (
            <button type="button" onClick={() => setAll((v) => !v)} className="text-[14px] font-medium text-muted-foreground hover:text-foreground">
              {all ? "Show less" : `Show all ${s.entries.length}`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function Bars({ rows }: { rows: Array<{ label: string; count: number; share: number }> }) {
  return (
    <ul className="space-y-2" data-summary-bars>
      {rows.map((r) => (
        <li key={r.label}>
          <div className="flex items-baseline justify-between gap-3 text-[14px]">
            <span className="min-w-0 break-words">{r.label}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {r.count} · {pctLabel(r.share)}
            </span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div className="h-full rounded-full bg-foreground/70" style={{ width: `${Math.max(r.count ? 3 : 0, Math.round(r.share * 100))}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ──────────────────────────── Individual ──────────────────────────── */

function IndividualView({
  data,
  focus,
  onFocus,
  onLeave,
}: {
  data: FormResponsesData;
  focus: { clientId: string; submissionId: string | null };
  onFocus: (f: { clientId: string; submissionId: string | null }) => void;
  onLeave?: () => void;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [editing, setEditing] = useState(false);
  const [marking, setMarking] = useState(false);
  const people = data.people;
  const found = people.findIndex((p) => p.clientId === focus.clientId);
  const idx = Math.max(0, found);
  const person = found >= 0 ? people[found] : null;
  const response = person?.responses.find((r) => r.id === focus.submissionId) ?? person?.responses[0] ?? null;
  const keepsUpdating = !!data.form?.allow_updates;
  const { data: ready } = useFormReadiness(response?.id, data.form?.id ?? "", { enabled: keepsUpdating && !!response });
  useEffect(() => setEditing(false), [response?.id]);

  const go = (d: -1 | 1) => {
    const from = found < 0 ? (d > 0 ? -1 : 0) : found;
    const next = people[(from + d + people.length) % people.length];
    onFocus({ clientId: next.clientId, submissionId: next.responses[0]?.id ?? null });
  };

  const rows = useMemo(() => {
    if (!response) return [];
    return answeredQuestions(data.questions as FormQuestionRow[], data.answersBySubmission.get(response.id) ?? []);
  }, [data, response]);

  if (!person) {
    // asked to open someone who isn't in this form's list: say so, never show another athlete
    return (
      <div className="space-y-3" data-responses-individual>
        <p className="rounded-xl bg-muted/60 p-4 text-[15px] text-muted-foreground" data-individual-missing>
          Nothing from them on this form. Pick someone to read theirs.
        </p>
        <select
          value=""
          onChange={(e) => {
            const p = people.find((x) => x.clientId === e.target.value);
            if (p) onFocus({ clientId: p.clientId, submissionId: p.responses[0]?.id ?? null });
          }}
          className="h-11 w-full rounded-lg border border-border bg-background px-3 text-[16px]"
        >
          <option value="" disabled>Pick a person</option>
          {people.map((p) => <option key={p.clientId} value={p.clientId}>{p.name}</option>)}
        </select>
      </div>
    );
  }

  const markReviewed = async () => {
    if (!response) return;
    setMarking(true);
    try {
      const { error } = await db
        .from("nf_submissions")
        .update({ status: "reviewed", reviewed_at: new Date().toISOString(), reviewed_by: user?.id ?? null })
        .eq("id", response.id);
      if (error) throw error;
      toast.success("Marked reviewed");
      void qc.invalidateQueries({ queryKey: formResponsesKey(data.form?.id ?? "") });
      void qc.invalidateQueries({ queryKey: ["form-library-stats"] });
      void qc.invalidateQueries({ queryKey: ["form-submissions"] });
      void qc.invalidateQueries({ queryKey: ["chat-form-request-status"] });
      // the dashboard's Check-ins to review, the Messages inbox and the Clients list too
      refreshReviewQueries(qc);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't mark it reviewed");
    } finally {
      setMarking(false);
    }
  };

  return (
    <div className="space-y-4" data-responses-individual>
      {/* Who: step through everyone, or pick one */}
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" className="h-11 w-11 shrink-0" onClick={() => go(-1)} aria-label="Previous person" disabled={people.length < 2}>
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Person</span>
          <select
            value={person.clientId}
            onChange={(e) => {
              const p = people.find((x) => x.clientId === e.target.value)!;
              onFocus({ clientId: p.clientId, submissionId: p.responses[0]?.id ?? null });
            }}
            className="h-11 w-full appearance-none truncate rounded-lg border border-border bg-background px-3 pr-14 text-[16px] font-semibold"
            data-individual-person
          >
            {people.map((p) => (
              <option key={p.clientId} value={p.clientId}>
                {p.name}{!p.counted ? " · Archived" : p.state !== "answered" ? ` · ${STATE_LABEL[p.state]}` : ""}
              </option>
            ))}
          </select>
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] tabular-nums text-muted-foreground">
            {idx + 1}/{people.length}
          </span>
        </label>
        <Button variant="outline" size="icon" className="h-11 w-11 shrink-0" onClick={() => go(1)} aria-label="Next person" disabled={people.length < 2}>
          <ChevronRight className="h-5 w-5" />
        </Button>
      </div>

      {/* Their earlier responses, when there are any */}
      {person.responses.length > 1 && (
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]" role="tablist" aria-label="Their responses">
          {person.responses.map((r) => (
            <button
              key={r.id}
              type="button"
              role="tab"
              aria-selected={r.id === response?.id}
              onClick={() => onFocus({ clientId: person.clientId, submissionId: r.id })}
              className={cn(
                "h-9 shrink-0 rounded-full px-3.5 text-[14px] font-medium",
                r.id === response?.id ? "bg-foreground text-background" : "bg-muted text-foreground",
              )}
            >
              {fmtDay(r.at)}
            </button>
          ))}
        </div>
      )}

      {/* Where it stands, and what to do */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[14px]" data-individual-status>
          {response ? (
            <>
              <span className="text-muted-foreground">Sent {fmtDay(response.at, true)}</span>
              {response.answersUpdatedAt && <span className="text-muted-foreground"> · updated {relativeTime(response.answersUpdatedAt)}</span>}
              <span className={cn("font-medium", response.reviewed ? "text-success" : "text-sky-700 dark:text-sky-400")}> · {response.reviewed ? "Reviewed" : "To review"}</span>
            </>
          ) : (
            <span className={STATE_TONE[person.state]}>{personLine(person)}</span>
          )}
        </p>
        <div className="flex items-center gap-1.5">
          {response && !response.reviewed && (
            <Button size="sm" className="h-10" onClick={markReviewed} disabled={marking} data-mark-reviewed>
              <Check className="mr-1.5 h-4 w-4" /> Mark reviewed
            </Button>
          )}
          {response ? (
            // the chat, on the card this response sits on (scrolled to and highlighted)
            <OpenInChatButton
              subRef={{ source: "native", id: response.id, clientId: person.clientId, formId: data.form?.id ?? "", submittedAt: response.at }}
              onLeave={onLeave}
              size="sm"
              className="h-10"
            />
          ) : (
            <Button asChild size="sm" variant="outline" className="h-10">
              <Link to="/admin/messages" search={{ client: person.clientId } as any} onClick={() => onLeave?.()} aria-label={`Message ${person.name}`}>
                <MessageCircle className="mr-1.5 h-4 w-4" /> Message
              </Link>
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="h-10 w-10 px-0" aria-label="More">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link to="/admin/clients/$id" params={{ id: person.clientId }}>
                  <User className="mr-2 h-4 w-4" /> Open profile
                </Link>
              </DropdownMenuItem>
              {response && (
                <DropdownMenuItem onClick={() => setEditing((v) => !v)}>
                  <Pencil className="mr-2 h-4 w-4" /> {editing ? "Done editing" : "Fix an answer"}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* answered before, asked again since: what's on screen is the older one */}
      {person.askedAgain && response?.id === person.responses[0]?.id && (
        <p className="-mt-2 text-[13px] text-muted-foreground" data-individual-asked-again>
          Asked again {fmtDay(person.askedAt)} · nothing since, so this is their last one.
        </p>
      )}

      {response && data.form?.form_type === "competition_strategy" && (
        <CompetitionPlanSummary submissionId={response.id} formId={data.form.id} />
      )}

      {!response ? (
        <p className="rounded-xl bg-muted/60 p-4 text-[15px] text-muted-foreground">
          {person.state === "in_progress" ? "They've started it and haven't sent it yet." : "Nothing from them yet."}
        </p>
      ) : editing ? (
        <NativeAnswers submissionId={response.id} formId={data.form?.id ?? null} />
      ) : ready ? (
        <div className="space-y-3">
          <p className={cn("text-[15px] font-medium", verdictTone(ready.readiness))}>{readinessLine(ready.readiness)}</p>
          <ReadinessSummary data={ready} />
          <ChecklistAnswers data={ready} />
        </div>
      ) : rows.length === 0 ? (
        <p className="text-[15px] text-muted-foreground">No answers were filled in.</p>
      ) : (
        <dl className="divide-y divide-border rounded-xl border border-border" data-individual-answers>
          {rows.map((r) => (
            <div key={r.id} className="px-4 py-3">
              <dt className="text-[14px] font-medium leading-snug text-muted-foreground">{r.label}</dt>
              <dd className="mt-1 whitespace-pre-wrap break-words text-[16px] leading-relaxed">{r.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/* ─────────────────────────────── Table ─────────────────────────────── */

type TableFilter = "all" | PersonState | "archived";
/** What a row says: an archived client shown for their past answers is "Archived", out of the state counts. */
const shownState = (p: FormPerson): PersonState | "archived" => (p.counted ? p.state : "archived");
type TableSort = "newest" | "name" | "status";

function TableView({ data, onOpen }: { data: FormResponsesData; onOpen: (clientId: string, sid: string | null) => void }) {
  const [filter, setFilter] = useState<TableFilter>("all");
  const [sort, setSort] = useState<TableSort>("newest");
  const questions = useMemo(
    () => data.questions.filter((q) => !q.archived_at && !["file", "video", "info"].includes(q.question_type)).sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0)),
    [data],
  );
  const people = data.people;
  const countOf = (s: TableFilter) => (s === "all" ? people.length : people.filter((p) => shownState(p) === s).length);
  const rows = useMemo(() => {
    const list = people.filter((p) => filter === "all" || shownState(p) === filter);
    const when = (p: FormPerson) => p.responses[0]?.at ?? p.draft?.at ?? p.askedAt ?? "";
    const rank: Record<PersonState | "archived", number> = { answered: 0, in_progress: 1, waiting: 2, archived: 3 };
    return [...list].sort((a, b) =>
      sort === "name" ? a.name.localeCompare(b.name) : sort === "status" ? rank[shownState(a)] - rank[shownState(b)] || when(b).localeCompare(when(a)) : when(b).localeCompare(when(a)),
    );
  }, [people, filter, sort]);
  const textOf = (p: FormPerson, qid: string) => {
    const sid = p.responses[0]?.id;
    if (!sid) return "";
    return formAnswerText((data.answersBySubmission.get(sid) ?? []).find((x) => x.question_id === qid)).trim();
  };

  return (
    <div className="space-y-3" data-responses-table>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 [scrollbar-width:none]">
          {(["all", "answered", "in_progress", "waiting", "archived"] as const)
            .filter((s) => s === "all" || countOf(s) > 0 || filter === s)
            .map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setFilter(s)}
                aria-pressed={filter === s}
                className={cn("h-9 shrink-0 rounded-full px-3.5 text-[14px] font-medium", filter === s ? "bg-foreground text-background" : "bg-muted text-foreground")}
              >
                {s === "all" ? "Everyone" : s === "archived" ? "Archived" : STATE_LABEL[s]} · {countOf(s)}
              </button>
            ))}
        </div>
        <label className="flex items-center gap-1.5 text-[14px] text-muted-foreground">
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as TableSort)} className="h-9 rounded-lg border border-border bg-background px-2 text-[14px] text-foreground">
            <option value="newest">Newest</option>
            <option value="name">Name</option>
            <option value="status">Status</option>
          </select>
        </label>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-max min-w-full border-collapse text-left text-[14px]">
          <thead>
            <tr className="border-b border-border bg-muted text-[13px] text-muted-foreground">
              <th className="sticky left-0 z-10 bg-muted px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Status</th>
              {questions.map((q) => (
                <th key={q.id} className="min-w-[160px] max-w-[220px] px-3 py-2 align-top font-medium">
                  <span className="line-clamp-2">{q.label}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.clientId} onClick={() => onOpen(p.clientId, p.responses[0]?.id ?? null)} className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/40" data-table-row>
                <td className="sticky left-0 z-10 bg-background px-3 py-2.5 font-medium dark:bg-card">
                  <span className="block max-w-[150px] truncate">{p.name}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5">
                  <span className={p.counted ? STATE_TONE[p.state] : "text-muted-foreground"}>{!p.counted ? "Archived" : p.askedAgain ? "Asked again" : STATE_LABEL[p.state]}</span>
                  <span className="block text-[12px] text-muted-foreground">
                    {p.state === "answered" || !p.counted
                      ? `${fmtDay(p.responses[0]?.at)}${p.responses[0] && !p.responses[0].reviewed ? " · to review" : ""}`
                      : p.state === "in_progress"
                        ? fmtDay(p.draft?.at)
                        : `Since ${fmtDay(p.askedAt)}`}
                  </span>
                </td>
                {questions.map((q) => (
                  <td key={q.id} className="min-w-[160px] max-w-[220px] px-3 py-2.5 align-top">
                    <span className="line-clamp-2 break-words">{textOf(p, q.id) || <span className="text-muted-foreground">—</span>}</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[12px] text-muted-foreground">Each row shows the person's latest response (someone asked again shows the one before). Tap a row to read it in full.</p>
    </div>
  );
}

/* ─────────────────────────────── Sheet ─────────────────────────────── */

/**
 * The viewer as its own full screen (a phone) or a wide sheet (a computer),
 * opened from the library, a chat card or the Submissions inbox.
 */
export function FormResponsesSheet({
  formId,
  title,
  submissionId,
  clientId,
  initialView,
  open,
  onOpenChange,
}: {
  formId: string;
  title?: string | null;
  submissionId?: string | null;
  clientId?: string | null;
  initialView?: View;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data } = useFormResponses(formId, open);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showBackButton={false}
        className="fixed inset-0 left-0 top-0 flex h-[100dvh] max-h-none w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:left-1/2 sm:top-1/2 sm:h-[min(92dvh,960px)] sm:max-w-[900px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border"
        data-form-responses-sheet
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-border px-2 pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] sm:pt-2">
          <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" onClick={() => onOpenChange(false)} aria-label="Back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-[17px] font-semibold">{title || data?.form?.title || "Responses"}</DialogTitle>
            <p className="text-[13px] text-muted-foreground">Responses</p>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-4">
          <FormResponsesView key={`${formId}:${submissionId ?? ""}:${clientId ?? ""}`} formId={formId} submissionId={submissionId} clientId={clientId} initialView={initialView} onLeave={() => onOpenChange(false)} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** A sent form's answers in the form's order (files left out): the client profile's Forms card. */
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

/** The editor's Responses tab: the viewer inline. */
export function FormResponses({ formId }: { formId: string }) {
  return <FormResponsesView formId={formId} />;
}
