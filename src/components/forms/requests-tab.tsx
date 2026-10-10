/**
 * Admin → Forms → Requests. Every form / check-in I've sent and where it
 * ended up: submitted, still waiting (overdue after 48h) or missed (a newer
 * one replaced it). Opens on the most recent week; the week strip shows each
 * week's filled / sent at a glance and "Not filled" gathers everything still
 * outstanding from any week. Tap a submitted one to read the answers; chase,
 * re-send or delete the open ones.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CheckCircle2, ExternalLink, Eye, FileText, Loader2, MessageCircle, RefreshCw, Search, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NativeFormPreviewDialog } from "@/components/forms/native-form-preview";
import { NativeAnswers } from "@/components/clients/intake-answers-dialog";
import { CheckinAnswersSheet, WEEKLY_CHECKIN_QUESTIONS } from "@/components/messages/messenger-checkin-card";
import { cn } from "@/lib/utils";
import { getForm, listQuestions, type NfForm, type NfQuestion } from "@/lib/native-forms";
import {
  KIND_LABEL,
  ageLabel,
  sortTracked,
  summarize,
  summarizeWeeks,
  toActionItem,
  trackedStatus,
  weekLabel,
  weekOf,
  type OutstandingRequest,
  type RequestKind,
  type TrackedRequest,
  type TrackedStatus,
} from "@/lib/form-requests";
import {
  deleteFormRequestsFn,
  listFormTrackerFn,
  resendFormRequestsFn,
  type RequestActionResult,
} from "@/lib/form-requests.functions";

const KIND_TABS: Array<{ value: RequestKind | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "weekly_checkin", label: "Weekly check-ins" },
  { value: "nutrition_update", label: "Nutrition updates" },
  { value: "form", label: "Other forms" },
];

/** A week (YYYY-MM-DD Monday) or everything still not filled, from any week. */
type Scope = string | "open";
type StatusFilter = "all" | "open" | "submitted" | "missed";

const STATUS_BADGE: Record<TrackedStatus, { label: string; cls: string }> = {
  submitted: { label: "Submitted", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  waiting: { label: "Waiting", cls: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  overdue: { label: "Overdue", cls: "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300" },
  missed: { label: "Missed", cls: "border-border bg-muted text-muted-foreground" },
};

const shortDate = (iso: string) => new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold transition",
        active ? "border-primary bg-primary/10 text-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Tile({ label, value, sub, tone, active, onClick }: {
  label: string; value: number; sub?: string; tone?: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-xl border p-2.5 text-left transition",
        active ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-accent/40",
      )}
    >
      <div className={cn("text-xl font-bold leading-none tabular-nums", tone)}>{value}</div>
      <div className="mt-1 text-[11px] font-semibold text-muted-foreground">{label}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </button>
  );
}

export function RequestsTab() {
  const qc = useQueryClient();
  const list = useServerFn(listFormTrackerFn);
  const del = useServerFn(deleteFormRequestsFn);
  const resend = useServerFn(resendFormRequestsFn);

  const { data: rows = [], isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["form-requests"],
    staleTime: 15_000,
    queryFn: () => list(),
  });

  const now = Date.now();
  const weeks = useMemo(() => summarizeWeeks(rows, now), [rows, now]);
  const openRows = useMemo(() => rows.filter((r) => r.state === "open"), [rows]);
  const overdueOpen = useMemo(() => openRows.filter((r) => trackedStatus(r, now) === "overdue").length, [openRows, now]);

  // Default: the most recent week anything was sent.
  const [scope, setScope] = useState<Scope | null>(null);
  useEffect(() => {
    if (scope === null && weeks.length) setScope(weeks[0].week);
  }, [scope, weeks]);
  const activeScope: Scope = scope ?? weeks[0]?.week ?? "open";

  const [kind, setKind] = useState<RequestKind | "all">("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<TrackedRequest | null>(null);
  const [answers, setAnswers] = useState<TrackedRequest | null>(null);
  const [confirm, setConfirm] = useState<{ action: "delete" | "resend"; items: TrackedRequest[] } | null>(null);

  const inScope = useMemo(
    () => (activeScope === "open" ? openRows : rows.filter((r) => weekOf(r.sentAt) === activeScope)),
    [rows, openRows, activeScope],
  );
  const scopeKinds = useMemo(() => {
    const c: Record<RequestKind | "all", number> = { all: inScope.length, weekly_checkin: 0, nutrition_update: 0, form: 0 };
    for (const r of inScope) c[r.kind]++;
    return c;
  }, [inScope]);
  const ofKind = useMemo(() => (kind === "all" ? inScope : inScope.filter((r) => r.kind === kind)), [inScope, kind]);
  const totals = useMemo(() => summarize(ofKind, now), [ofKind, now]);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sortTracked(
      ofKind.filter((r) => {
        if (status !== "all" && r.state !== status) return false;
        if (q && !r.clientName.toLowerCase().includes(q) && !r.title.toLowerCase().includes(q)) return false;
        return true;
      }),
      now,
    );
  }, [ofKind, status, search, now]);

  const selectable = visible.filter((r) => r.state === "open");
  const selectedRows = selectable.filter((r) => selected.has(r.key));
  const allSelected = selectable.length > 0 && selectedRows.length === selectable.length;
  // Older weeks' unfilled requests shouldn't hide behind the week picker.
  const olderOpen = activeScope === "open" ? 0 : openRows.filter((r) => weekOf(r.sentAt) < activeScope).length;

  const reset = () => setSelected(new Set());
  const pickScope = (s: Scope) => {
    setScope(s);
    setStatus("all");
    reset();
  };

  const act = useMutation({
    mutationFn: async ({ action, items }: { action: "delete" | "resend"; items: TrackedRequest[] }): Promise<RequestActionResult> => {
      const payload = { data: { items: items.map(toActionItem) } };
      return action === "delete" ? del(payload) : resend(payload);
    },
    onSuccess: (res, { action }) => {
      const verb = action === "delete" ? "Deleted" : "Re-sent";
      if (res.done) toast.success(`${verb} ${res.done} request${res.done === 1 ? "" : "s"}`);
      if (res.failed.length) toast.error(`${res.failed.length} failed: ${res.failed[0].reason}`);
      reset();
      setConfirm(null);
      for (const k of ["form-requests", "message-form-checkin-inbox", "last-messages", "messages"]) {
        qc.invalidateQueries({ queryKey: [k] });
      }
    },
    onError: (e: any) => {
      toast.error(e?.message ?? "Something went wrong");
      setConfirm(null);
    },
  });

  const toggle = (key: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const scopeTitle = activeScope === "open" ? "Not filled, any week" : `Week of ${weekLabel(activeScope)}`;

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-3 md:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-bold">
            {openRows.length} not filled
            {overdueOpen > 0 && <span className="ml-2 text-orange-600 dark:text-orange-400">· {overdueOpen} overdue</span>}
          </div>
          <div className="text-xs text-muted-foreground">Every form and check-in you've sent, by week. Overdue = 48h+.</div>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", isFetching && "animate-spin")} /> Refresh
        </Button>
      </div>

      {/* Week strip: filled / sent per week, newest first. */}
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        <button
          type="button"
          onClick={() => pickScope("open")}
          aria-pressed={activeScope === "open"}
          className={cn(
            "w-[92px] shrink-0 rounded-xl border p-2 text-left transition",
            activeScope === "open" ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-accent/40",
          )}
        >
          <div className="text-[11px] font-semibold text-muted-foreground">Not filled</div>
          <div className={cn("text-sm font-bold tabular-nums", openRows.length > 0 && "text-orange-600 dark:text-orange-400")}>
            {openRows.length}
          </div>
          <div className="text-[10px] text-muted-foreground">any week</div>
        </button>
        {weeks.map((w) => {
          const pct = w.sent ? Math.round((w.submitted / w.sent) * 100) : 0;
          return (
            <button
              key={w.week}
              type="button"
              onClick={() => pickScope(w.week)}
              aria-pressed={activeScope === w.week}
              className={cn(
                "w-[92px] shrink-0 rounded-xl border p-2 text-left transition",
                activeScope === w.week ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-accent/40",
              )}
            >
              <div className="text-[11px] font-semibold text-muted-foreground">{weekLabel(w.week)}</div>
              <div className="text-sm font-bold tabular-nums">
                {w.submitted}/{w.sent}
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
              </div>
            </button>
          );
        })}
      </div>

      <div className="space-y-2">
        <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{scopeTitle}</div>
        {activeScope !== "open" && (
          <div className="grid grid-cols-4 gap-1.5">
            <Tile label="Sent" value={totals.sent} active={status === "all"} onClick={() => { setStatus("all"); reset(); }} />
            <Tile
              label="Submitted"
              value={totals.submitted}
              sub={totals.sent ? `${Math.round((totals.submitted / totals.sent) * 100)}%` : undefined}
              tone="text-emerald-600 dark:text-emerald-400"
              active={status === "submitted"}
              onClick={() => { setStatus("submitted"); reset(); }}
            />
            <Tile
              label="Waiting"
              value={totals.open}
              sub={totals.overdue ? `${totals.overdue} overdue` : undefined}
              tone={totals.overdue ? "text-orange-600 dark:text-orange-400" : undefined}
              active={status === "open"}
              onClick={() => { setStatus("open"); reset(); }}
            />
            <Tile label="Missed" value={totals.missed} active={status === "missed"} onClick={() => { setStatus("missed"); reset(); }} />
          </div>
        )}
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
          {KIND_TABS.filter((t) => t.value === "all" || scopeKinds[t.value] > 0).map((t) => (
            <Chip key={t.value} active={kind === t.value} onClick={() => { setKind(t.value); reset(); }}>
              {t.label} · {scopeKinds[t.value]}
            </Chip>
          ))}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => { setSearch(e.target.value); reset(); }} placeholder="Search client or form…" className="h-10 pl-9" />
        </div>
        {olderOpen > 0 && (
          <button
            type="button"
            onClick={() => pickScope("open")}
            className="w-full rounded-xl border border-orange-500/30 bg-orange-500/5 px-3 py-2 text-left text-xs font-semibold text-orange-700 dark:text-orange-300"
          >
            {olderOpen} from earlier weeks still not filled · Show
          </button>
        )}
      </div>

      {selectable.length > 0 && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-background/95 px-3 py-2 backdrop-blur">
          <label className="flex items-center gap-2 text-xs font-semibold">
            <Checkbox checked={allSelected} onCheckedChange={() => setSelected(allSelected ? new Set() : new Set(selectable.map((r) => r.key)))} />
            {selectedRows.length ? `${selectedRows.length} selected` : "Select all waiting"}
          </label>
          {selectedRows.length > 0 && (
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setConfirm({ action: "resend", items: selectedRows })}>
                <Send className="mr-1.5 h-3.5 w-3.5" /> Re-send ({selectedRows.length})
              </Button>
              <Button size="sm" variant="outline" className="text-destructive" onClick={() => setConfirm({ action: "delete", items: selectedRows })}>
                <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete ({selectedRows.length})
              </Button>
            </div>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full rounded-2xl" />)}
        </div>
      ) : error ? (
        <Card className="p-4 text-sm text-destructive">Couldn't load requests: {(error as Error).message}</Card>
      ) : visible.length === 0 ? (
        <Card className="grid place-items-center gap-2 border-dashed p-8 text-center">
          <CheckCircle2 className="h-6 w-6 text-emerald-500" />
          <div className="text-sm font-semibold">
            {activeScope === "open" && !search && kind === "all" ? "Nothing outstanding" : rows.length ? "Nothing here" : "No forms sent yet"}
          </div>
          <div className="text-xs text-muted-foreground">
            {activeScope === "open" && !search && kind === "all"
              ? "Every form and check-in you've sent has been filled in."
              : "Try another week or clear a filter."}
          </div>
        </Card>
      ) : (
        <ul className="space-y-1.5">
          {visible.map((r) => {
            const st = trackedStatus(r, now);
            const badge = STATUS_BADGE[st];
            const open = r.state === "open";
            const meta =
              r.state === "submitted" && r.submittedAt
                ? `submitted ${shortDate(r.submittedAt)}`
                : r.state === "missed"
                  ? "replaced by a newer one"
                  : r.readAt ? `opened ${shortDate(r.readAt)}` : "not opened";
            return (
              <li key={r.key}>
                <Card className={cn("p-3", selected.has(r.key) && "border-primary/50 bg-primary/5", r.state === "missed" && "opacity-75")}>
                  <div className="flex items-start gap-3">
                    {open ? (
                      <Checkbox className="mt-1" checked={selected.has(r.key)} onCheckedChange={() => toggle(r.key)} aria-label={`Select ${r.clientName}`} />
                    ) : (
                      <span className="w-4 shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <Link
                          to="/admin/communication"
                          search={{ tab: "messages", client: r.clientId } as any}
                          className="truncate text-sm font-bold hover:underline"
                        >
                          {r.clientName}
                        </Link>
                        <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-bold", badge.cls)}>
                          {badge.label}
                          {open && ` · ${ageLabel(r.sentAt, now)}`}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate text-[12px] text-muted-foreground">
                        {r.title} · sent {shortDate(r.sentAt)} · {meta}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {r.state === "submitted" && r.submissionId ? (
                          <Button size="sm" variant="outline" className="h-8" onClick={() => setAnswers(r)}>
                            <FileText className="mr-1.5 h-3.5 w-3.5" /> View answers
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline" className="h-8" onClick={() => setPreview(r)}>
                            <Eye className="mr-1.5 h-3.5 w-3.5" /> Open form
                          </Button>
                        )}
                        {open && (
                          <>
                            <Button size="sm" variant="outline" className="h-8" onClick={() => setConfirm({ action: "resend", items: [r] })}>
                              <Send className="mr-1.5 h-3.5 w-3.5" /> Re-send
                            </Button>
                            <Button size="sm" variant="outline" className="h-8 text-destructive" onClick={() => setConfirm({ action: "delete", items: [r] })}>
                              <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <RequestPreview request={preview} onClose={() => setPreview(null)} />
      <SubmissionAnswers request={answers} onClose={() => setAnswers(null)} />

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && !act.isPending && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.action === "delete" ? "Delete" : "Re-send"} {confirm?.items.length} request{confirm?.items.length === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.action === "delete"
                ? "The request disappears from the client's chat and from this list. Anything they had half filled in is discarded. A copy stays in the deleted-messages log. You can send a fresh one any time."
                : "Each old request is replaced by a fresh one at the bottom of the chat and the client is notified. Nothing they've already submitted is touched."}
              {confirm && confirm.items.length > 1 && (
                <span className="mt-2 block text-foreground">
                  {confirm.items.slice(0, 6).map((r) => r.clientName).join(", ")}
                  {confirm.items.length > 6 ? ` +${confirm.items.length - 6} more` : ""}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={act.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={act.isPending}
              className={confirm?.action === "delete" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined}
              onClick={(e) => {
                e.preventDefault();
                if (confirm) act.mutate(confirm);
              }}
            >
              {act.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : confirm?.action === "delete" ? "Delete" : "Re-send"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** What the client answered: the check-in recap sheet, or the native form's answers. */
function SubmissionAnswers({ request, onClose }: { request: TrackedRequest | null; onClose: () => void }) {
  if (!request?.submissionId) return null;
  if (request.source === "checkin") {
    return (
      <CheckinAnswersSheet
        open
        onOpenChange={(o) => !o && onClose()}
        submissionId={request.submissionId}
        taskType="weekly_checkin"
        role="admin"
        submittedAt={request.submittedAt}
      />
    );
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{request.title}</DialogTitle>
          <DialogDescription>
            {request.clientName}
            {request.submittedAt ? ` · submitted ${new Date(request.submittedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}
          </DialogDescription>
        </DialogHeader>
        <NativeAnswers submissionId={request.submissionId} formId={request.formId} />
        <Button asChild variant="secondary" size="sm" className="self-start">
          <Link to="/admin/communication" search={{ tab: "messages", client: request.clientId } as any} onClick={onClose}>
            <MessageCircle className="mr-1.5 h-4 w-4" /> Open chat
          </Link>
        </Button>
      </DialogContent>
    </Dialog>
  );
}

/** The exact form the client was sent: native forms render their real questions, weekly check-ins list theirs. */
function RequestPreview({ request, onClose }: { request: OutstandingRequest | null; onClose: () => void }) {
  const isNative = !!request && request.source === "form" && request.formKind === "native" && !!request.formId;
  const { data } = useQuery({
    queryKey: ["request-preview", request?.formId],
    enabled: isNative,
    queryFn: async (): Promise<{ form: NfForm | null; questions: NfQuestion[] }> => {
      const [form, questions] = await Promise.all([getForm(request!.formId!), listQuestions(request!.formId!)]);
      return { form, questions };
    },
  });

  if (!request) return null;

  if (isNative && data?.form) {
    return <NativeFormPreviewDialog open onClose={onClose} form={data.form} questions={data.questions} />;
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{request.title}</DialogTitle>
          <DialogDescription>
            What {request.clientName} was sent. {request.source === "checkin" ? "Questions appear one at a time in their chat." : ""}
          </DialogDescription>
        </DialogHeader>

        {request.source === "checkin" && (
          <ol className="space-y-3">
            {WEEKLY_CHECKIN_QUESTIONS.map((q, i) => (
              <li key={q.key} className="rounded-xl border border-border bg-card p-3">
                <div className="text-sm font-semibold">
                  {i + 1}. {q.prompt}
                  {q.optional && <span className="ml-1 text-[11px] font-normal text-muted-foreground">(optional)</span>}
                </div>
                {q.helper && <div className="mt-0.5 text-xs text-muted-foreground">{q.helper}</div>}
                <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                  {q.type === "rating" &&
                    (q.scale ?? ["1", "2", "3", "4", "5"]).map((s, n) => (
                      <span key={s} className="rounded-full border border-border px-2 py-0.5">{n + 1} · {s}</span>
                    ))}
                  {(q.type === "multi" || q.type === "single") &&
                    (q.options ?? []).map((o) => <span key={o} className="rounded-full border border-border px-2 py-0.5">{o}</span>)}
                  {q.type === "text" && <span className="text-muted-foreground">Free text answer</span>}
                  {q.showWhen && <span className="text-muted-foreground">Only asked if “Pain / injury” is ticked</span>}
                </div>
              </li>
            ))}
          </ol>
        )}

        {request.source === "form" && request.formKind === "external" && request.externalUrl && (
          <Button asChild variant="outline">
            <a href={request.externalUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="mr-2 h-4 w-4" /> Open the form
            </a>
          </Button>
        )}
        {request.source === "form" && !(request.formKind === "external" && request.externalUrl) && !data?.form && (
          <div className="text-sm text-muted-foreground">
            {isNative ? "Loading the form…" : "This form can't be previewed here. Open the chat to see exactly what the client received."}
          </div>
        )}

        <Button asChild variant="secondary" size="sm" className="self-start">
          <Link to="/admin/communication" search={{ tab: "messages", client: request.clientId } as any} onClick={onClose}>
            <MessageCircle className="mr-1.5 h-4 w-4" /> Open chat
          </Link>
        </Button>
      </DialogContent>
    </Dialog>
  );
}
