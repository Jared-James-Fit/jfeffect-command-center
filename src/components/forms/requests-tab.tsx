/**
 * Admin → Forms → Requests. Every form / check-in I've sent that the client
 * hasn't filled in yet: filter it, open the exact form the client sees, and
 * delete (unsend) or re-send one or many. This is the "what's missing and who
 * do I chase" list; filled forms never appear here.
 */
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CheckCircle2, ExternalLink, Eye, Loader2, MessageCircle, RefreshCw, Search, Send, Trash2 } from "lucide-react";
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
import { WEEKLY_CHECKIN_QUESTIONS } from "@/components/messages/messenger-checkin-card";
import { cn } from "@/lib/utils";
import { getForm, listQuestions, type NfForm, type NfQuestion } from "@/lib/native-forms";
import {
  DEFAULT_FILTERS,
  KIND_LABEL,
  ageLabel,
  countByKind,
  filterRequests,
  requestStatus,
  toActionItem,
  type OutstandingRequest,
  type RequestFilters,
  type RequestKind,
} from "@/lib/form-requests";
import {
  deleteFormRequestsFn,
  listOutstandingFormRequestsFn,
  resendFormRequestsFn,
  type RequestActionResult,
} from "@/lib/form-requests.functions";

const KIND_TABS: Array<{ value: RequestKind | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "weekly_checkin", label: "Weekly check-ins" },
  { value: "nutrition_update", label: "Nutrition updates" },
  { value: "form", label: "Other forms" },
];

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

export function RequestsTab() {
  const qc = useQueryClient();
  const list = useServerFn(listOutstandingFormRequestsFn);
  const del = useServerFn(deleteFormRequestsFn);
  const resend = useServerFn(resendFormRequestsFn);

  const { data: rows = [], isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["form-requests"],
    staleTime: 15_000,
    queryFn: () => list(),
  });

  const [filters, setFilters] = useState<RequestFilters>(DEFAULT_FILTERS);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<OutstandingRequest | null>(null);
  const [confirm, setConfirm] = useState<{ action: "delete" | "resend"; items: OutstandingRequest[] } | null>(null);

  const now = Date.now();
  const visible = useMemo(() => filterRequests(rows, filters, now), [rows, filters, now]);
  const counts = useMemo(() => countByKind(rows), [rows]);
  const overdueCount = useMemo(() => rows.filter((r) => requestStatus(r, now) === "overdue").length, [rows, now]);
  const selectedRows = visible.filter((r) => selected.has(r.key));
  const allSelected = visible.length > 0 && selectedRows.length === visible.length;

  const set = (patch: Partial<RequestFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setSelected(new Set());
  };

  const act = useMutation({
    mutationFn: async ({ action, items }: { action: "delete" | "resend"; items: OutstandingRequest[] }): Promise<RequestActionResult> => {
      const payload = { data: { items: items.map(toActionItem) } };
      return action === "delete" ? del(payload) : resend(payload);
    },
    onSuccess: (res, { action }) => {
      const verb = action === "delete" ? "Deleted" : "Re-sent";
      if (res.done) toast.success(`${verb} ${res.done} request${res.done === 1 ? "" : "s"}`);
      if (res.failed.length) toast.error(`${res.failed.length} failed: ${res.failed[0].reason}`);
      setSelected(new Set());
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

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-3 md:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-bold">
            {rows.length} not filled in
            {overdueCount > 0 && <span className="ml-2 text-orange-600 dark:text-orange-400">· {overdueCount} overdue</span>}
          </div>
          <div className="text-xs text-muted-foreground">
            Sent requests the client hasn't completed. Overdue = 48h+. Filled forms never show here.
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", isFetching && "animate-spin")} /> Refresh
        </Button>
      </div>

      <div className="space-y-2">
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
          {KIND_TABS.map((t) => (
            <Chip key={t.value} active={filters.kind === t.value} onClick={() => set({ kind: t.value })}>
              {t.label} · {counts[t.value]}
            </Chip>
          ))}
        </div>
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
          <Chip active={filters.status === "all"} onClick={() => set({ status: "all" })}>Any status</Chip>
          <Chip active={filters.status === "overdue"} onClick={() => set({ status: "overdue" })}>Overdue</Chip>
          <Chip active={filters.status === "waiting"} onClick={() => set({ status: "waiting" })}>Waiting</Chip>
          <Chip active={filters.unopenedOnly} onClick={() => set({ unopenedOnly: !filters.unopenedOnly })}>Not opened</Chip>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filters.search}
            onChange={(e) => set({ search: e.target.value })}
            placeholder="Search client or form…"
            className="h-10 pl-9"
          />
        </div>
      </div>

      {visible.length > 0 && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-background/95 px-3 py-2 backdrop-blur">
          <label className="flex items-center gap-2 text-xs font-semibold">
            <Checkbox
              checked={allSelected}
              onCheckedChange={() => setSelected(allSelected ? new Set() : new Set(visible.map((r) => r.key)))}
            />
            {selectedRows.length ? `${selectedRows.length} selected` : "Select all"}
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
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)}
        </div>
      ) : error ? (
        <Card className="p-4 text-sm text-destructive">Couldn't load requests: {(error as Error).message}</Card>
      ) : visible.length === 0 ? (
        <Card className="grid place-items-center gap-2 border-dashed p-8 text-center">
          <CheckCircle2 className="h-6 w-6 text-emerald-500" />
          <div className="text-sm font-semibold">{rows.length ? "Nothing matches these filters" : "Nothing outstanding"}</div>
          <div className="text-xs text-muted-foreground">
            {rows.length ? "Clear a filter to see the rest." : "Every form and check-in you've sent has been filled in."}
          </div>
        </Card>
      ) : (
        <ul className="space-y-2">
          {visible.map((r) => {
            const overdue = requestStatus(r, now) === "overdue";
            return (
              <li key={r.key}>
                <Card className={cn("p-3", selected.has(r.key) && "border-primary/50 bg-primary/5")}>
                  <div className="flex items-start gap-3">
                    <Checkbox className="mt-1" checked={selected.has(r.key)} onCheckedChange={() => toggle(r.key)} aria-label={`Select ${r.clientName}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <Link
                          to="/admin/communication"
                          search={{ tab: "messages", client: r.clientId } as any}
                          className="truncate text-sm font-bold hover:underline"
                        >
                          {r.clientName}
                        </Link>
                        <span
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-[10px] font-bold",
                            overdue
                              ? "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300"
                              : "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
                          )}
                        >
                          {overdue ? "Overdue" : "Waiting"} · {ageLabel(r.sentAt, now)}
                        </span>
                      </div>
                      <div className="mt-0.5 text-sm">{r.title}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {KIND_LABEL[r.kind]} · sent {new Date(r.sentAt).toLocaleDateString([], { month: "short", day: "numeric" })} ·{" "}
                        {r.readAt ? `opened ${new Date(r.readAt).toLocaleDateString([], { month: "short", day: "numeric" })}` : "not opened"}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Button size="sm" variant="outline" className="h-8" onClick={() => setPreview(r)}>
                          <Eye className="mr-1.5 h-3.5 w-3.5" /> Open form
                        </Button>
                        <Button size="sm" variant="outline" className="h-8" onClick={() => setConfirm({ action: "resend", items: [r] })}>
                          <Send className="mr-1.5 h-3.5 w-3.5" /> Re-send
                        </Button>
                        <Button size="sm" variant="outline" className="h-8 text-destructive" onClick={() => setConfirm({ action: "delete", items: [r] })}>
                          <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete
                        </Button>
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
