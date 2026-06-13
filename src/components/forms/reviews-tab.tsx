import { useMemo, useState } from "react";
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
} from "lucide-react";
import {
  listSubmissionReviews, getSubmissionReviewDetail, generateSubmissionDraft,
  saveCoachDraft, approveAndSendNow, scheduleSendResponse, cancelScheduledSend,
  archiveReview, setReviewPriority, syncSubmissionReviews,
} from "@/lib/submission-reviews.functions";
import {
  REVIEW_STATUS_LABELS, REVIEW_STATUS_TONE, AI_STATUS_LABELS, SOURCE_LABELS,
  type ReviewStatus, type ReviewPriority,
} from "@/lib/submission-reviews";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

const STATUS_FILTERS: Array<{ value: "" | ReviewStatus; label: string }> = [
  { value: "", label: "All" },
  { value: "submitted", label: "New" },
  { value: "draft_ready", label: "Draft ready" },
  { value: "coach_editing", label: "Coach editing" },
  { value: "scheduled", label: "Scheduled" },
  { value: "sent", label: "Sent" },
  { value: "delivery_failed", label: "Failed" },
];

function genIdemKey(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function ReviewsTab() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<"" | ReviewStatus>("");
  const [sourceFilter, setSourceFilter] = useState<"" | "native" | "fillout" | "application">("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const sync = useServerFn(syncSubmissionReviews);
  const list = useServerFn(listSubmissionReviews);

  // Lazy intake on mount — pulls any existing submissions into the queue
  useQuery({
    queryKey: ["review-intake-sync"],
    queryFn: () => sync({ data: {} as any }),
    staleTime: 60_000,
  });

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["submission-reviews-list", statusFilter, sourceFilter],
    queryFn: () =>
      list({
        data: {
          status: statusFilter || undefined,
          source: sourceFilter || undefined,
        },
      }),
    refetchInterval: 30_000,
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return rows ?? [];
    const q = search.trim().toLowerCase();
    return (rows ?? []).filter((r: any) => {
      const hay = [
        r?.client?.full_name,
        r?.form?.title,
        r?.source_type,
        r?.review_status,
      ].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [rows, search]);

  return (
    <div className="flex flex-col md:flex-row md:h-[calc(100vh-220px)]">
      {/* Left list */}
      <div className="w-full md:w-[380px] md:border-r border-border flex flex-col">
        <div className="border-b border-border bg-background p-3 space-y-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search client, form, status…"
            className="h-8 text-sm"
          />
          <div className="flex gap-2">
            <Select value={statusFilter || "all"} onValueChange={(v) => setStatusFilter(v === "all" ? "" : (v as any))}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                {STATUS_FILTERS.map((f) => (
                  <SelectItem key={f.value || "all"} value={f.value || "all"}>{f.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sourceFilter || "all"} onValueChange={(v) => setSourceFilter(v === "all" ? "" : (v as any))}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Source" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                <SelectItem value="native">Native</SelectItem>
                <SelectItem value="fillout">Fillout</SelectItem>
                <SelectItem value="application">Application</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 px-2"
              onClick={() => qc.invalidateQueries({ queryKey: ["submission-reviews-list"] })}
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
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
                const active = r.id === selectedId;
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(r.id)}
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
                              ? "border-destructive/40 bg-destructive/10 text-destructive"
                              : "")}>
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
        {selectedId ? (
          <ReviewDetail reviewId={selectedId} onDeleted={() => setSelectedId(null)} />
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

function ReviewDetail({ reviewId, onDeleted }: { reviewId: string; onDeleted: () => void }) {
  const qc = useQueryClient();
  const fetchDetail = useServerFn(getSubmissionReviewDetail);
  const generate = useServerFn(generateSubmissionDraft);
  const saveDraft = useServerFn(saveCoachDraft);
  const sendNow = useServerFn(approveAndSendNow);
  const schedule = useServerFn(scheduleSendResponse);
  const cancelSchedule = useServerFn(cancelScheduledSend);
  const archive = useServerFn(archiveReview);
  const setPriority = useServerFn(setReviewPriority);

  const { data, isLoading } = useQuery({
    queryKey: ["submission-review-detail", reviewId],
    queryFn: () => fetchDetail({ data: { id: reviewId } }),
    refetchInterval: (q) => {
      const r: any = (q.state.data as any)?.review;
      return r?.ai_status === "processing" || r?.review_status === "processing" ? 3000 : false;
    },
  });

  const [draftLocal, setDraftLocal] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["submission-review-detail", reviewId] });
    qc.invalidateQueries({ queryKey: ["submission-reviews-list"] });
  };

  const generateMutation = useMutation({
    mutationFn: () =>
      generate({ data: { reviewId, submissionInstruction: instruction || undefined } }),
    onSuccess: () => { toast.success("AI draft generated"); setInstruction(""); invalidate(); },
    onError: (e: any) => toast.error(e?.message ?? "Generation failed"),
  });

  const saveDraftMutation = useMutation({
    mutationFn: () => saveDraft({ data: { reviewId, coachDraft: currentDraft } }),
    onSuccess: () => { toast.success("Draft saved"); invalidate(); },
    onError: (e: any) => toast.error(e?.message ?? "Save failed"),
  });

  const sendMutation = useMutation({
    mutationFn: () =>
      sendNow({
        data: { reviewId, body: currentDraft, idempotencyKey: genIdemKey(`send-${reviewId.slice(0, 8)}`) },
      }),
    onSuccess: (r: any) => {
      toast.success(r?.deduped ? "Already sent" : "Sent to client");
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Send failed"),
  });

  const scheduleMutation = useMutation({
    mutationFn: () =>
      schedule({
        data: {
          reviewId,
          scheduledAt: new Date(scheduledAt).toISOString(),
          body: currentDraft,
          idempotencyKey: genIdemKey(`sched-${reviewId.slice(0, 8)}`),
        },
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

  if (isLoading || !data) {
    return <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>;
  }
  const { review, submission, questions, answers, form, client, application, generations, audits } = data as any;

  const latestGen = generations?.[0];
  const currentDraft =
    draftLocal != null
      ? draftLocal
      : review.coach_draft ??
        review.approved_response ??
        latestGen?.client_response ??
        "";

  const canSend = review.client_id && currentDraft.trim().length > 0 && !sendMutation.isPending;
  const isProcessing = review.ai_status === "processing";

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
            <Select
              value={review.priority}
              onValueChange={(v) => setPriority({ data: { reviewId, priority: v as ReviewPriority } }).then(invalidate)}
            >
              <SelectTrigger className="h-6 w-auto text-[10px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="low">low</SelectItem>
                <SelectItem value="normal">normal</SelectItem>
                <SelectItem value="high">high</SelectItem>
                <SelectItem value="urgent">urgent</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex items-center gap-2">
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

      {/* AI Analysis */}
      <Card className="p-4 border-primary/30">
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            <Sparkles className="inline h-3.5 w-3.5 mr-1" /> AI Analysis (internal)
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="e.g. shorter, focus on nutrition…"
              className="h-8 w-56 text-xs"
            />
            <Button size="sm" onClick={() => generateMutation.mutate()} disabled={isProcessing || generateMutation.isPending}>
              {isProcessing || generateMutation.isPending ? (
                <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Generating…</>
              ) : (
                <><Sparkles className="h-3.5 w-3.5 mr-1" /> {latestGen ? "Regenerate" : "Generate"}</>
              )}
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

      {/* Client response */}
      <Card className="p-4">
        <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
          Client response (visible to client when sent)
        </div>
        <Textarea
          value={currentDraft}
          onChange={(e) => setDraftLocal(e.target.value)}
          placeholder="The AI draft will appear here. Edit as needed before sending."
          className="min-h-[180px] text-sm"
        />
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => saveDraftMutation.mutate()} disabled={saveDraftMutation.isPending}>
            <Save className="h-3.5 w-3.5 mr-1" /> Save Draft
          </Button>
          <Button size="sm" onClick={() => sendMutation.mutate()} disabled={!canSend}>
            {sendMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1" />}
            Send Now
          </Button>
          <div className="flex items-center gap-1">
            <Input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="h-8 w-44 text-xs"
            />
            <Button
              variant="outline"
              size="sm"
              disabled={!scheduledAt || !review.client_id || !currentDraft.trim() || scheduleMutation.isPending}
              onClick={() => scheduleMutation.mutate()}
            >
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
        {review.last_delivery_error && (
          <div className="mt-2 text-xs text-destructive">
            Last error: {review.last_delivery_error}
          </div>
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
          {(audits ?? []).slice(0, 12).map((a: any) => (
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