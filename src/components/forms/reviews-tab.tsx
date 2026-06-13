import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sparkles, Send, Save, Clock, AlertTriangle, RefreshCw, Inbox,
  Loader2, CheckCircle2, XCircle, ChevronRight, Archive, FileText,
  CheckCheck, RotateCcw, UserCog, Ban, FileIcon, History, Eye,
  Download, FileImage, FileVideo, FileAudio, X as XIcon,
} from "lucide-react";
import {
  listSubmissionReviews, getSubmissionReviewDetail, generateSubmissionDraft,
  saveCoachDraft, approveAndSendNow, scheduleSendResponse, cancelScheduledSend,
  archiveReview, setReviewPriority, syncSubmissionReviews,
  approveReviewDraft, resetReviewApproval, markNoResponseRequired, reopenReview,
  reassignReviewCoach, listAssignableCoaches, saveInternalNotes,
  restoreDraftFromGeneration, listSubmissionFiles,
} from "@/lib/submission-reviews.functions";
import {
  REVIEW_STATUS_LABELS, REVIEW_STATUS_TONE, AI_STATUS_LABELS, SOURCE_LABELS,
  type ReviewStatus, type ReviewPriority,
} from "@/lib/submission-reviews";
import { cn } from "@/lib/utils";
import { formatDistanceToNow, format } from "date-fns";
import { AiAssistanceLabel, deriveAiAssistance } from "@/components/legal/ai-assistance-label";

const STATUS_FILTERS: Array<{ value: "" | ReviewStatus; label: string }> = [
  { value: "", label: "All" },
  { value: "submitted", label: "New" },
  { value: "draft_ready", label: "Draft ready" },
  { value: "coach_editing", label: "Coach editing" },
  { value: "approved", label: "Approved" },
  { value: "scheduled", label: "Scheduled" },
  { value: "sent", label: "Sent" },
  { value: "delivery_failed", label: "Failed" },
  { value: "no_response", label: "No response" },
  { value: "archived", label: "Archived" },
];

function genIdemKey(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

// ---------------------------------------------------------------------------
// URL-synced filter state. Survives refresh; "Clear Filters" wipes them all.
// ---------------------------------------------------------------------------
type FilterState = {
  status: "" | ReviewStatus;
  source: "" | "native" | "fillout" | "application";
  priority: "" | ReviewPriority;
  coach: string; // user uuid, "unassigned", or ""
  formId: string;
  dateFrom: string; // yyyy-MM-dd
  dateTo: string;
  search: string;
  selectedId: string;
};

const DEFAULT_FILTERS: FilterState = {
  status: "", source: "", priority: "", coach: "", formId: "",
  dateFrom: "", dateTo: "", search: "", selectedId: "",
};

const URL_KEYS: Record<keyof FilterState, string> = {
  status: "rstatus", source: "rsource", priority: "rprio", coach: "rcoach",
  formId: "rform", dateFrom: "rfrom", dateTo: "rto", search: "rq", selectedId: "rid",
};

function readFiltersFromUrl(): FilterState {
  if (typeof window === "undefined") return DEFAULT_FILTERS;
  const sp = new URLSearchParams(window.location.search);
  const get = (k: keyof FilterState) => sp.get(URL_KEYS[k]) ?? "";
  return {
    status: (get("status") as any) || "",
    source: (get("source") as any) || "",
    priority: (get("priority") as any) || "",
    coach: get("coach"),
    formId: get("formId"),
    dateFrom: get("dateFrom"),
    dateTo: get("dateTo"),
    search: get("search"),
    selectedId: get("selectedId"),
  };
}

function writeFiltersToUrl(f: FilterState) {
  if (typeof window === "undefined") return;
  const sp = new URLSearchParams(window.location.search);
  (Object.keys(URL_KEYS) as (keyof FilterState)[]).forEach((k) => {
    const v = f[k];
    if (v) sp.set(URL_KEYS[k], v);
    else sp.delete(URL_KEYS[k]);
  });
  const next = `${window.location.pathname}?${sp.toString()}${window.location.hash}`;
  window.history.replaceState(null, "", next);
}

export function ReviewsTab() {
  const qc = useQueryClient();
  const [filters, setFilters] = useState<FilterState>(() => readFiltersFromUrl());
  const set = <K extends keyof FilterState>(k: K, v: FilterState[K]) =>
    setFilters((prev) => ({ ...prev, [k]: v }));

  // Persist filter changes to the URL so refresh restores state.
  useEffect(() => { writeFiltersToUrl(filters); }, [filters]);

  const sync = useServerFn(syncSubmissionReviews);
  const list = useServerFn(listSubmissionReviews);
  const listCoaches = useServerFn(listAssignableCoaches);

  // Lazy intake on mount
  useQuery({
    queryKey: ["review-intake-sync"],
    queryFn: () => sync({ data: {} as any }),
    staleTime: 60_000,
  });

  const { data: coaches = [] } = useQuery({
    queryKey: ["review-assignable-coaches"],
    queryFn: () => listCoaches({ data: undefined as any }),
    staleTime: 60_000,
  });

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["submission-reviews-list", filters.status, filters.source, filters.priority, filters.coach, filters.formId, filters.dateFrom, filters.dateTo],
    queryFn: () =>
      list({
        data: {
          status: filters.status || undefined,
          source: filters.source || undefined,
          priority: (filters.priority || undefined) as any,
          assignedCoachUserId:
            filters.coach === "unassigned" ? null : (filters.coach || undefined),
          formId: filters.formId || undefined,
          dateFrom: filters.dateFrom ? new Date(filters.dateFrom).toISOString() : undefined,
          dateTo: filters.dateTo ? new Date(filters.dateTo + "T23:59:59").toISOString() : undefined,
        },
      }),
    refetchInterval: 30_000,
  });

  // Form options derived from server-returned rows (authorized data only).
  const formOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows ?? []) {
      if (r.form_id && r.form?.title) map.set(r.form_id, r.form.title);
    }
    return Array.from(map.entries()).map(([id, title]) => ({ id, title }));
  }, [rows]);

  const filtered = useMemo(() => {
    if (!filters.search.trim()) return rows ?? [];
    const q = filters.search.trim().toLowerCase();
    return (rows ?? []).filter((r: any) => {
      const hay = [
        r?.client?.full_name, r?.form?.title, r?.source_type, r?.review_status,
      ].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [rows, filters.search]);

  const hasActiveFilters =
    filters.status || filters.source || filters.priority || filters.coach
    || filters.formId || filters.dateFrom || filters.dateTo || filters.search;

  return (
    <div className="flex flex-col md:flex-row md:h-[calc(100vh-220px)]">
      {/* Left list */}
      <div className="w-full md:w-[380px] md:border-r border-border flex flex-col">
        <div className="border-b border-border bg-background p-3 space-y-2">
          <Input
            value={filters.search}
            onChange={(e) => set("search", e.target.value)}
            placeholder="Search client, form, status…"
            className="h-8 text-sm"
          />
          <div className="flex gap-2">
            <Select value={filters.status || "all"} onValueChange={(v) => set("status", v === "all" ? "" : (v as any))}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                {STATUS_FILTERS.map((f) => (
                  <SelectItem key={f.value || "all"} value={f.value || "all"}>{f.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filters.source || "all"} onValueChange={(v) => set("source", v === "all" ? "" : (v as any))}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Source" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                <SelectItem value="native">Native</SelectItem>
                <SelectItem value="fillout">Fillout</SelectItem>
                <SelectItem value="application">Application</SelectItem>
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" size="sm" className="h-8 px-2"
              onClick={() => qc.invalidateQueries({ queryKey: ["submission-reviews-list"] })}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="flex gap-2">
            <Select value={filters.priority || "all"} onValueChange={(v) => set("priority", v === "all" ? "" : (v as any))}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Priority" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any priority</SelectItem>
                <SelectItem value="low">low</SelectItem>
                <SelectItem value="normal">normal</SelectItem>
                <SelectItem value="high">high</SelectItem>
                <SelectItem value="urgent">urgent</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filters.coach || "all"} onValueChange={(v) => set("coach", v === "all" ? "" : v)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Coach" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All coaches</SelectItem>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {(coaches ?? []).map((c: any) => (
                  <SelectItem key={c.user_id} value={c.user_id}>{c.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2 items-center">
            <Select value={filters.formId || "all"} onValueChange={(v) => set("formId", v === "all" ? "" : v)}>
              <SelectTrigger className="h-8 text-xs flex-1"><SelectValue placeholder="Form" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All forms</SelectItem>
                {formOptions.map((o) => (
                  <SelectItem key={o.id} value={o.id}>{o.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2 items-center">
            <Input type="date" value={filters.dateFrom} onChange={(e) => set("dateFrom", e.target.value)} className="h-8 text-xs" aria-label="From" />
            <Input type="date" value={filters.dateTo} onChange={(e) => set("dateTo", e.target.value)} className="h-8 text-xs" aria-label="To" />
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" className="h-8 px-2 text-xs"
                onClick={() => setFilters({ ...DEFAULT_FILTERS, selectedId: filters.selectedId })}>
                <XIcon className="h-3 w-3 mr-1" /> Clear
              </Button>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="p-6 text-center text-sm text-muted-foreground">Loading reviews…</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              <Inbox className="mx-auto mb-2 h-6 w-6 opacity-60" />
              No reviews match these filters.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {filtered.map((r: any) => {
                const active = r.id === filters.selectedId;
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => set("selectedId", r.id)}
                      className={cn(
                        "w-full text-left px-3 py-3 hover:bg-muted/50",
                        active && "bg-primary/10 border-l-2 border-primary",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold truncate">
                            {r.client?.full_name ?? (r.source_type === "application" ? "Applicant" : "Unmapped client")}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            {r.form?.title ?? SOURCE_LABELS[r.source_type as keyof typeof SOURCE_LABELS]}
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                      </div>
                      <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                        <Badge variant="outline" className={cn("text-[10px] py-0", REVIEW_STATUS_TONE[r.review_status as ReviewStatus])}>
                          {REVIEW_STATUS_LABELS[r.review_status as ReviewStatus] ?? r.review_status}
                        </Badge>
                        {r.ai_status && r.ai_status !== "pending" && (
                          <Badge variant="outline" className="text-[10px] py-0">
                            AI: {AI_STATUS_LABELS[r.ai_status as keyof typeof AI_STATUS_LABELS] ?? r.ai_status}
                          </Badge>
                        )}
                        {r.priority && r.priority !== "normal" && (
                          <Badge variant="outline" className={cn("text-[10px] py-0",
                            r.priority === "urgent" || r.priority === "high"
                              ? "border-destructive/40 bg-destructive/10 text-destructive" : "")}>
                            {r.priority}
                          </Badge>
                        )}
                      </div>
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        {r.submitted_at ? formatDistanceToNow(new Date(r.submitted_at), { addSuffix: true }) : ""}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
      {/* Right detail */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        {filters.selectedId ? (
          <ReviewDetail reviewId={filters.selectedId} coaches={coaches} onDeleted={() => set("selectedId", "")} />
        ) : (
          <div className="grid h-full place-items-center p-8 text-center text-sm text-muted-foreground">
            <div>
              <Sparkles className="mx-auto h-8 w-8 opacity-60" />
              <div className="mt-2 font-medium">Select a submission to review.</div>
              <p className="mt-1 text-xs">AI will draft a coach-editable response you can approve or schedule.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ===========================================================================
// ReviewDetail
// ===========================================================================

function ReviewDetail({ reviewId, coaches, onDeleted }: { reviewId: string; coaches: any[]; onDeleted: () => void }) {
  const qc = useQueryClient();
  const fetchDetail = useServerFn(getSubmissionReviewDetail);
  const generate = useServerFn(generateSubmissionDraft);
  const saveDraft = useServerFn(saveCoachDraft);
  const sendNow = useServerFn(approveAndSendNow);
  const schedule = useServerFn(scheduleSendResponse);
  const cancelSchedule = useServerFn(cancelScheduledSend);
  const archive = useServerFn(archiveReview);
  const setPriority = useServerFn(setReviewPriority);
  const approveDraft = useServerFn(approveReviewDraft);
  const resetApproval = useServerFn(resetReviewApproval);
  const markNoResp = useServerFn(markNoResponseRequired);
  const reopen = useServerFn(reopenReview);
  const reassign = useServerFn(reassignReviewCoach);
  const saveNotes = useServerFn(saveInternalNotes);
  const restoreDraft = useServerFn(restoreDraftFromGeneration);
  const listFiles = useServerFn(listSubmissionFiles);

  const { data, isLoading } = useQuery({
    queryKey: ["submission-review-detail", reviewId],
    queryFn: () => fetchDetail({ data: { id: reviewId } }),
    refetchInterval: (q) => {
      const r: any = (q.state.data as any)?.review;
      return r?.ai_status === "processing" || r?.review_status === "processing" ? 3000 : false;
    },
  });

  const { data: files = [] } = useQuery({
    queryKey: ["submission-review-files", reviewId],
    queryFn: () => listFiles({ data: { reviewId } }),
    staleTime: 50 * 60 * 1000,
  });

  const [draftLocal, setDraftLocal] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [notesLocal, setNotesLocal] = useState<string | null>(null);
  const [notesSavedAt, setNotesSavedAt] = useState<Date | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [compareWithGenId, setCompareWithGenId] = useState<string | null>(null);

  // Reset locals when the review switches
  useEffect(() => {
    setDraftLocal(null); setInstruction(""); setScheduledAt("");
    setNotesLocal(null); setNotesSavedAt(null);
    setShowHistory(false); setCompareWithGenId(null);
  }, [reviewId]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["submission-review-detail", reviewId] });
    qc.invalidateQueries({ queryKey: ["submission-reviews-list"] });
  };

  // Internal-notes autosave (debounced)
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (notesLocal == null) return;
    if (notesTimer.current) clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(async () => {
      try {
        await saveNotes({ data: { reviewId, notes: notesLocal } });
        setNotesSavedAt(new Date());
      } catch (e: any) {
        toast.error(e?.message ?? "Notes save failed");
      }
    }, 800);
    return () => { if (notesTimer.current) clearTimeout(notesTimer.current); };
  }, [notesLocal, reviewId, saveNotes]);

  const generateMutation = useMutation({
    mutationFn: () => generate({ data: { reviewId, submissionInstruction: instruction || undefined } }),
    onSuccess: () => { toast.success("AI draft generated"); setInstruction(""); setDraftLocal(null); invalidate(); },
    onError: (e: any) => toast.error(e?.message ?? "Generation failed"),
  });

  const saveDraftMutation = useMutation({
    mutationFn: () => saveDraft({ data: { reviewId, coachDraft: currentDraft } }),
    onSuccess: () => { toast.success("Draft saved"); invalidate(); },
    onError: (e: any) => toast.error(e?.message ?? "Save failed"),
  });

  const approveMutation = useMutation({
    mutationFn: () => approveDraft({ data: { reviewId, body: currentDraft } }),
    onSuccess: () => { toast.success("Draft approved"); invalidate(); },
    onError: (e: any) => toast.error(e?.message ?? "Approve failed"),
  });

  const resetApprovalMutation = useMutation({
    mutationFn: () => resetApproval({ data: { reviewId } }),
    onSuccess: () => { toast.success("Approval reset"); invalidate(); },
    onError: (e: any) => toast.error(e?.message ?? "Reset failed"),
  });

  const sendMutation = useMutation({
    mutationFn: () => sendNow({ data: { reviewId, body: currentDraft, idempotencyKey: genIdemKey(`send-${reviewId.slice(0, 8)}`) } }),
    onSuccess: (r: any) => { toast.success(r?.deduped ? "Already sent" : "Sent to client"); invalidate(); },
    onError: (e: any) => toast.error(e?.message ?? "Send failed"),
  });

  const scheduleMutation = useMutation({
    mutationFn: () => schedule({
      data: { reviewId, scheduledAt: new Date(scheduledAt).toISOString(), body: currentDraft, idempotencyKey: genIdemKey(`sched-${reviewId.slice(0, 8)}`) },
    }),
    onSuccess: () => { toast.success("Scheduled"); invalidate(); },
    onError: (e: any) => toast.error(e?.message ?? "Schedule failed"),
  });

  const cancelSchedMutation = useMutation({
    mutationFn: () => cancelSchedule({ data: { reviewId } }),
    onSuccess: () => { toast.success("Schedule cancelled"); invalidate(); },
  });

  const archiveMutation = useMutation({
    mutationFn: () => archive({ data: { reviewId } }),
    onSuccess: () => { toast.success("Archived"); onDeleted(); invalidate(); },
  });

  const noResponseMutation = useMutation({
    mutationFn: () => markNoResp({ data: { reviewId } }),
    onSuccess: () => { toast.success("Marked as no-response"); invalidate(); },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  const reopenMutation = useMutation({
    mutationFn: () => reopen({ data: { reviewId } }),
    onSuccess: () => { toast.success("Reopened"); invalidate(); },
  });

  const reassignMutation = useMutation({
    mutationFn: (uid: string | null) => reassign({ data: { reviewId, assignedCoachUserId: uid } }),
    onSuccess: () => { toast.success("Coach updated"); invalidate(); },
    onError: (e: any) => toast.error(e?.message ?? "Reassign failed"),
  });

  const restoreMutation = useMutation({
    mutationFn: (genId: string) => restoreDraft({ data: { reviewId, generationId: genId } }),
    onSuccess: () => { toast.success("Draft restored"); setDraftLocal(null); invalidate(); },
    onError: (e: any) => toast.error(e?.message ?? "Restore failed"),
  });

  if (isLoading || !data) {
    return <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>;
  }
  const { review, submission, questions, answers, form, client, application, generations, audits } = data as any;

  const latestGen = generations?.[0];
  const currentDraft =
    draftLocal != null
      ? draftLocal
      : review.coach_draft ?? review.approved_response ?? latestGen?.client_response ?? "";

  const currentNotes = notesLocal != null ? notesLocal : (review.internal_notes ?? "");
  const isProcessing = review.ai_status === "processing";
  const isNoResponse = review.review_status === "no_response";
  const isSent = review.review_status === "sent";
  const isApproved =
    !!review.approved_at &&
    (review.approved_response ?? "").trim() === (currentDraft ?? "").trim();
  const sendDisabled =
    !review.client_id || !currentDraft.trim() || sendMutation.isPending
    || isNoResponse || isSent;

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-lg font-bold truncate">
            {client?.full_name ?? (review.source_type === "application" ? application?.full_name : "Unmapped")}
          </h2>
          <div className="text-xs text-muted-foreground">
            {form?.title ?? SOURCE_LABELS[review.source_type as keyof typeof SOURCE_LABELS]} ·{" "}
            {SOURCE_LABELS[review.source_type as keyof typeof SOURCE_LABELS]}
          </div>
          <div className="mt-2 flex items-center gap-1.5 flex-wrap">
            <Badge variant="outline" className={cn("text-[10px]", REVIEW_STATUS_TONE[review.review_status as ReviewStatus])}>
              {REVIEW_STATUS_LABELS[review.review_status as ReviewStatus] ?? review.review_status}
            </Badge>
            <Badge variant="outline" className="text-[10px]">AI: {AI_STATUS_LABELS[review.ai_status as keyof typeof AI_STATUS_LABELS]}</Badge>
            <AiAssistanceLabel
              state={deriveAiAssistance({
                ai_used: ["draft_ready","approved","sent","scheduled","processing"].includes(review.ai_status),
                coach_edited: !!review.approved_response && review.approved_response !== review.ai_response,
                approved_by: review.approved_by ?? null,
                approved_at: review.approved_at ?? null,
              })}
            />
            <Select value={review.priority}
              onValueChange={(v) => setPriority({ data: { reviewId, priority: v as ReviewPriority } }).then(invalidate)}>
              <SelectTrigger className="h-6 w-auto text-[10px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="low">low</SelectItem>
                <SelectItem value="normal">normal</SelectItem>
                <SelectItem value="high">high</SelectItem>
                <SelectItem value="urgent">urgent</SelectItem>
              </SelectContent>
            </Select>
            {/* Assigned coach */}
            <Select
              value={review.assigned_coach_user_id ?? "unassigned"}
              onValueChange={(v) => reassignMutation.mutate(v === "unassigned" ? null : v)}
            >
              <SelectTrigger className="h-6 w-auto text-[10px]"><UserCog className="h-3 w-3 mr-1" /><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {(coaches ?? []).map((c: any) => (
                  <SelectItem key={c.user_id} value={c.user_id}>{c.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {!isNoResponse && !isSent && (
            <Button variant="ghost" size="sm" onClick={() => noResponseMutation.mutate()}>
              <Ban className="h-3.5 w-3.5 mr-1" /> No response
            </Button>
          )}
          {isNoResponse && (
            <Button variant="ghost" size="sm" onClick={() => reopenMutation.mutate()}>
              <RotateCcw className="h-3.5 w-3.5 mr-1" /> Reopen
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => archiveMutation.mutate()}>
            <Archive className="h-3.5 w-3.5 mr-1" /> Archive
          </Button>
        </div>
      </div>

      {/* Submission */}
      <Card className="p-4">
        <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
          <FileText className="inline h-3.5 w-3.5 mr-1" /> Submission
        </div>
        {review.source_type === "native" ? (
          <div className="space-y-3 text-sm">
            {questions.length === 0 && <div className="text-muted-foreground">No questions found.</div>}
            {questions.map((q: any) => {
              const a = answers.find((x: any) => x.question_id === q.id);
              const val = a?.value_text ?? a?.value_json ?? a?.value_number ?? a?.value_boolean ?? null;
              return (
                <div key={q.id}>
                  <div className="text-xs font-semibold text-muted-foreground">{q.label}</div>
                  <div className="whitespace-pre-wrap break-words">
                    {val == null || val === "" ? <span className="text-muted-foreground italic">No answer</span> :
                      typeof val === "object" ? JSON.stringify(val) : String(val)}
                  </div>
                </div>
              );
            })}
          </div>
        ) : review.source_type === "fillout" ? (
          <FilloutPayloadView submission={submission} />
        ) : (
          <ApplicationPayloadView app={application ?? submission} />
        )}
      </Card>

      {/* Attached files */}
      {files && files.length > 0 && (
        <Card className="p-4">
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
            Attached files
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {(files as any[]).map((f) => <FileTile key={f.id} file={f} />)}
          </div>
        </Card>
      )}

      {/* AI Analysis */}
      <Card className="p-4 border-primary/30">
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            <Sparkles className="inline h-3.5 w-3.5 mr-1" /> AI Analysis (internal)
          </div>
          <div className="flex items-center gap-2">
            <Input value={instruction} onChange={(e) => setInstruction(e.target.value)}
              placeholder="e.g. shorter, focus on nutrition…" className="h-8 w-56 text-xs" />
            <Button size="sm" onClick={() => generateMutation.mutate()} disabled={isProcessing || generateMutation.isPending}>
              {isProcessing || generateMutation.isPending
                ? (<><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Generating…</>)
                : (<><Sparkles className="h-3.5 w-3.5 mr-1" /> {latestGen ? "Regenerate" : "Generate"}</>)}
            </Button>
          </div>
        </div>
        {latestGen?.status === "failed" && (
          <div className="mb-3 rounded border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            <XCircle className="inline h-3.5 w-3.5 mr-1" />
            {latestGen.error ?? "Generation failed"}
          </div>
        )}
        {latestGen?.structured_output ? (
          <AnalysisView output={latestGen.structured_output} />
        ) : (
          <div className="text-sm text-muted-foreground italic">
            {isProcessing ? "AI is analysing this submission…" : "No AI analysis yet. Click Generate to produce a draft."}
          </div>
        )}
      </Card>

      {/* Draft history */}
      {generations && generations.length > 0 && (
        <Card className="p-4">
          <button type="button" onClick={() => setShowHistory((v) => !v)}
            className="w-full flex items-center justify-between text-xs font-bold uppercase tracking-wider text-muted-foreground">
            <span><History className="inline h-3.5 w-3.5 mr-1" /> Draft history ({generations.length})</span>
            <ChevronRight className={cn("h-4 w-4 transition-transform", showHistory && "rotate-90")} />
          </button>
          {showHistory && (
            <div className="mt-3 space-y-3">
              {generations.map((g: any, idx: number) => {
                const isCurrent = review.draft_origin_generation_id
                  ? g.id === review.draft_origin_generation_id
                  : idx === 0;
                const isCompare = compareWithGenId === g.id;
                return (
                  <div key={g.id} className="border border-border rounded p-3">
                    <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                      <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                        <span className="font-mono">{format(new Date(g.created_at), "yyyy-MM-dd HH:mm")}</span>
                        {g.model && <Badge variant="outline" className="text-[10px]">{g.model}</Badge>}
                        {g.global_config_version != null && (
                          <Badge variant="outline" className="text-[10px]">g-v{g.global_config_version}</Badge>
                        )}
                        {g.form_config_version != null && (
                          <Badge variant="outline" className="text-[10px]">f-v{g.form_config_version}</Badge>
                        )}
                        {isCurrent
                          ? <Badge className="text-[10px] bg-primary text-primary-foreground">Current draft</Badge>
                          : <Badge variant="outline" className="text-[10px]">Previous</Badge>}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" className="h-7 text-xs"
                          onClick={() => setCompareWithGenId(isCompare ? null : g.id)}>
                          <Eye className="h-3 w-3 mr-1" /> {isCompare ? "Hide diff" : "Compare"}
                        </Button>
                        {!isCurrent && (
                          <Button variant="outline" size="sm" className="h-7 text-xs"
                            onClick={() => restoreMutation.mutate(g.id)} disabled={restoreMutation.isPending}>
                            <RotateCcw className="h-3 w-3 mr-1" /> Restore
                          </Button>
                        )}
                      </div>
                    </div>
                    {isCompare ? (
                      <DiffView
                        from={g.client_response ?? ""}
                        to={currentDraft}
                        fromLabel="this version"
                        toLabel="current draft"
                      />
                    ) : (
                      <div className="text-sm whitespace-pre-wrap break-words max-h-56 overflow-y-auto">
                        {g.client_response ?? <span className="text-muted-foreground italic">No client response in this generation.</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {/* Internal notes (staff only) */}
      <Card className="p-4">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Internal notes (staff only — never sent to client or AI)
          </div>
          <div className="text-[10px] text-muted-foreground">
            {notesSavedAt
              ? `Saved ${formatDistanceToNow(notesSavedAt, { addSuffix: true })}`
              : notesLocal != null
                ? "Saving…"
                : review.internal_notes_updated_at
                  ? `Saved ${formatDistanceToNow(new Date(review.internal_notes_updated_at), { addSuffix: true })}`
                  : ""}
          </div>
        </div>
        <Textarea
          value={currentNotes}
          onChange={(e) => setNotesLocal(e.target.value)}
          placeholder="Anything the team should know about this submission. Not visible to the client."
          className="min-h-[100px] text-sm"
        />
      </Card>

      {/* Client response */}
      <Card className={cn("p-4", isNoResponse && "opacity-60")}>
        <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center justify-between flex-wrap gap-2">
          <span>Client response (visible to client when sent)</span>
          {isApproved && (
            <Badge variant="outline" className="text-[10px] border-emerald-500/40 bg-emerald-500/10 text-emerald-400">
              <CheckCheck className="inline h-3 w-3 mr-1" /> Approved
              {review.approved_at && ` ${formatDistanceToNow(new Date(review.approved_at), { addSuffix: true })}`}
            </Badge>
          )}
        </div>
        <Textarea
          value={currentDraft}
          onChange={(e) => setDraftLocal(e.target.value)}
          placeholder="The AI draft will appear here. Edit as needed before sending."
          className="min-h-[180px] text-sm"
          disabled={isNoResponse || isSent}
        />
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => saveDraftMutation.mutate()}
            disabled={saveDraftMutation.isPending || isNoResponse || isSent}>
            <Save className="h-3.5 w-3.5 mr-1" /> Save Draft
          </Button>
          {!isApproved ? (
            <Button variant="outline" size="sm" onClick={() => approveMutation.mutate()}
              disabled={!currentDraft.trim() || approveMutation.isPending || isNoResponse || isSent}>
              <CheckCheck className="h-3.5 w-3.5 mr-1" /> Approve
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => resetApprovalMutation.mutate()}
              disabled={resetApprovalMutation.isPending}>
              <RotateCcw className="h-3.5 w-3.5 mr-1" /> Reset approval
            </Button>
          )}
          <Button size="sm" onClick={() => sendMutation.mutate()} disabled={sendDisabled}>
            {sendMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1" />}
            Send Now
          </Button>
          <div className="flex items-center gap-1">
            <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className="h-8 w-44 text-xs" />
            <Button variant="outline" size="sm"
              disabled={!scheduledAt || !review.client_id || !currentDraft.trim() || scheduleMutation.isPending || isNoResponse || isSent}
              onClick={() => scheduleMutation.mutate()}>
              <Clock className="h-3.5 w-3.5 mr-1" /> Schedule
            </Button>
            {review.scheduled_at && review.review_status === "scheduled" && (
              <Button variant="ghost" size="sm" onClick={() => cancelSchedMutation.mutate()}>
                Cancel schedule
              </Button>
            )}
          </div>
        </div>
        {!review.client_id && (
          <div className="mt-2 text-xs text-amber-500">
            <AlertTriangle className="inline h-3.5 w-3.5 mr-1" />
            Map this submission to a client before sending.
          </div>
        )}
        {isNoResponse && (
          <div className="mt-2 text-xs text-muted-foreground">
            <Ban className="inline h-3.5 w-3.5 mr-1" />
            Marked as no response required. Reopen to enable sending.
          </div>
        )}
        {review.last_delivery_error && (
          <div className="mt-2 text-xs text-destructive">Last error: {review.last_delivery_error}</div>
        )}
        {review.sent_at && (
          <div className="mt-2 text-xs text-muted-foreground">
            <CheckCircle2 className="inline h-3.5 w-3.5 mr-1 text-emerald-500" />
            Sent {formatDistanceToNow(new Date(review.sent_at), { addSuffix: true })}
          </div>
        )}
      </Card>

      {/* Audit */}
      <Card className="p-4">
        <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Activity</div>
        <ul className="space-y-1 text-xs">
          {(audits ?? []).slice(0, 20).map((a: any) => (
            <li key={a.id} className="text-muted-foreground">
              <span className="text-foreground font-medium">{a.event_type.replace(/_/g, " ")}</span>
              {" — "}
              {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
            </li>
          ))}
          {(audits ?? []).length === 0 && <li className="text-muted-foreground italic">No activity yet.</li>}
        </ul>
      </Card>
    </div>
  );
}

// ===========================================================================
// Subcomponents
// ===========================================================================

function FileTile({ file }: { file: { id: string; name: string | null; mime: string | null; size: number | null; url: string | null } }) {
  const [imgError, setImgError] = useState(false);
  const mime = file.mime ?? "";
  const isImage = mime.startsWith("image/");
  const isVideo = mime.startsWith("video/");
  const isAudio = mime.startsWith("audio/");
  const isPdf = mime === "application/pdf";
  const sizeKb = file.size != null ? `${Math.max(1, Math.round(file.size / 1024))} KB` : "";

  if (!file.url) {
    return (
      <div className="border border-border rounded p-3 text-xs text-muted-foreground">
        <FileIcon className="inline h-3.5 w-3.5 mr-1" />
        {file.name ?? "File"} — link expired, please refresh.
      </div>
    );
  }

  if (isImage && !imgError) {
    return (
      <a href={file.url} target="_blank" rel="noreferrer" className="block group">
        <div className="border border-border rounded overflow-hidden bg-muted/40 aspect-video">
          <img src={file.url} alt={file.name ?? "Attachment"} className="w-full h-full object-cover group-hover:opacity-80"
            onError={() => setImgError(true)} />
        </div>
        <div className="mt-1 text-[11px] truncate text-muted-foreground">{file.name ?? "Image"} · {sizeKb}</div>
      </a>
    );
  }
  if (isVideo) {
    return (
      <div className="border border-border rounded overflow-hidden">
        <video src={file.url} controls className="w-full aspect-video bg-black" preload="metadata" />
        <div className="px-2 py-1 text-[11px] truncate text-muted-foreground"><FileVideo className="inline h-3 w-3 mr-1" />{file.name ?? "Video"} · {sizeKb}</div>
      </div>
    );
  }
  if (isAudio) {
    return (
      <div className="border border-border rounded p-2">
        <div className="text-[11px] truncate text-muted-foreground mb-1"><FileAudio className="inline h-3 w-3 mr-1" />{file.name ?? "Audio"} · {sizeKb}</div>
        <audio src={file.url} controls className="w-full" preload="metadata" />
      </div>
    );
  }
  // PDFs / docs / unknown
  return (
    <div className="border border-border rounded p-3 flex items-center justify-between gap-2">
      <div className="min-w-0 text-xs">
        {isPdf ? <FileText className="inline h-3.5 w-3.5 mr-1" /> : isImage ? <FileImage className="inline h-3.5 w-3.5 mr-1" /> : <FileIcon className="inline h-3.5 w-3.5 mr-1" />}
        <span className="font-medium truncate">{file.name ?? "File"}</span>
        <div className="text-[10px] text-muted-foreground">{mime || "unknown"} · {sizeKb}</div>
      </div>
      <a href={file.url} target="_blank" rel="noreferrer" className="text-xs">
        <Button size="sm" variant="outline" className="h-7"><Download className="h-3 w-3 mr-1" /> Open</Button>
      </a>
    </div>
  );
}

function DiffView({ from, to, fromLabel, toLabel }: { from: string; to: string; fromLabel: string; toLabel: string }) {
  // Cheap line-by-line set diff — no third-party dep. Lines unique to `from`
  // render red, unique to `to` render green; shared lines are dim.
  const fromLines = from.split(/\r?\n/);
  const toLines = to.split(/\r?\n/);
  const toSet = new Set(toLines);
  const fromSet = new Set(fromLines);
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs font-mono">
      <div className="border border-border rounded p-2 bg-rose-500/5">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{fromLabel}</div>
        {fromLines.map((l, i) => (
          <div key={i} className={cn("whitespace-pre-wrap break-words", !toSet.has(l) && l.trim() && "text-rose-300")}>{l || "\u00A0"}</div>
        ))}
      </div>
      <div className="border border-border rounded p-2 bg-emerald-500/5">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{toLabel}</div>
        {toLines.map((l, i) => (
          <div key={i} className={cn("whitespace-pre-wrap break-words", !fromSet.has(l) && l.trim() && "text-emerald-300")}>{l || "\u00A0"}</div>
        ))}
      </div>
    </div>
  );
}

function AnalysisView({ output }: { output: any }) {
  return (
    <div className="space-y-3 text-sm">
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Summary</div>
        <div className="mt-0.5 whitespace-pre-wrap">{output.summary}</div>
      </div>
      <List label="Wins" items={output.wins} tone="emerald" />
      <List label="Concerns" items={output.concerns} tone="amber" />
      <List label="Risks" items={output.risks} tone="rose" />
      <List label="Recommendations" items={output.recommendations} />
      <List label="Follow-up questions" items={output.follow_up_questions} />
      <List label="Suggested actions" items={output.suggested_actions} />
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        Urgency: <span className="font-bold text-foreground">{output.urgency}</span>
      </div>
    </div>
  );
}

function List({ label, items, tone }: { label: string; items: string[]; tone?: "emerald" | "amber" | "rose" }) {
  if (!items?.length) return null;
  const toneClass =
    tone === "emerald" ? "text-emerald-300"
    : tone === "amber" ? "text-amber-300"
    : tone === "rose" ? "text-rose-300"
    : "text-foreground";
  return (
    <div>
      <div className={cn("text-[10px] font-semibold uppercase tracking-wider", toneClass)}>{label}</div>
      <ul className="mt-0.5 list-disc pl-4 space-y-0.5">
        {items.map((s, i) => <li key={i}>{s}</li>)}
      </ul>
    </div>
  );
}

function FilloutPayloadView({ submission }: { submission: any }) {
  if (!submission) return <div className="text-sm text-muted-foreground">No payload.</div>;
  const qs = submission?.response_json?.questions ?? submission?.raw_payload?.submission?.questions ?? [];
  if (Array.isArray(qs) && qs.length) {
    return (
      <div className="space-y-3 text-sm">
        {qs.map((q: any, i: number) => (
          <div key={i}>
            <div className="text-xs font-semibold text-muted-foreground">{q.name || q.title || q.id}</div>
            <div className="whitespace-pre-wrap break-words">{q.value ?? <span className="italic text-muted-foreground">No answer</span>}</div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <pre className="text-[11px] font-mono whitespace-pre-wrap break-words bg-muted/40 rounded p-2 max-h-[400px] overflow-auto">
      {JSON.stringify(submission.response_json ?? submission.raw_payload ?? {}, null, 2)}
    </pre>
  );
}

function ApplicationPayloadView({ app }: { app: any }) {
  if (!app) return <div className="text-sm text-muted-foreground">No application.</div>;
  const interesting = [
    "full_name", "email", "phone", "instagram", "location_timezone",
    "main_goal", "target_outcome", "win_90_days", "timeline", "why_now",
    "training_history", "tried_before", "biggest_struggle",
    "days_per_week", "gym_access", "schedule", "current_weight",
    "injuries", "can_follow_plan", "budget_range", "monthly_investment",
    "ready_to_invest", "seriousness", "lead_temperature", "recommended_offer", "source",
  ];
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
      {interesting.filter((k) => app[k] != null && app[k] !== "").map((k) => (
        <div key={k}>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{k.replace(/_/g, " ")}</div>
          <div className="whitespace-pre-wrap break-words">{typeof app[k] === "object" ? JSON.stringify(app[k]) : String(app[k])}</div>
        </div>
      ))}
    </div>
  );
}
