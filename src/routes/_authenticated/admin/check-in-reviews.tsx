import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Send, MessageCircle, Loader2, Plus, ExternalLink, Trash2, RotateCcw } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  listAllSubmissionsForReview,
  getSubmission,
  listAnswers,
  listFiles,
  listQuestions,
  createReview,
  markReviewed,
  markReviewMessenged,
  getFileSignedUrl,
  statusLabel,
  statusTone,
  type NfSubmissionStatus,
} from "@/lib/native-forms";
import { sendMessage } from "@/lib/messages";
import { ManualCheckInReviewComposer } from "@/components/manual-check-in-review-composer";
import { listAllManualReviews, deleteManualReview, reviewStatus, sourceLabel, resendManualReview } from "@/lib/manual-check-in-reviews";

export const Route = createFileRoute("/_authenticated/admin/check-in-reviews")({
  component: AdminCheckInReviews,
});

function AdminCheckInReviews() {
  const [tab, setTab] = useState<string>("manual");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const qc = useQueryClient();

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["nf-review-inbox", tab],
    enabled: tab === "pending_review" || tab === "reviewed",
    queryFn: () => listAllSubmissionsForReview({ status: tab as NfSubmissionStatus }),
  });

  const { data: manualReviews = [], isLoading: loadingManual } = useQuery({
    queryKey: ["manual-check-in-reviews", "all"],
    enabled: tab === "manual",
    queryFn: () => listAllManualReviews(),
  });

  return (
    <>
      <PageHeader
        title="Check-In Reviews"
        subtitle="Review submitted check-ins and send manual reviews for external (Fillout) check-ins."
        actions={
          <Button onClick={() => setComposerOpen(true)} className="bg-gradient-primary font-bold">
            <Plus className="mr-1 h-4 w-4" /> New Manual Review
          </Button>
        }
      />
      <div className="grid gap-4 p-4 md:grid-cols-[360px_1fr] md:p-6">
        <div>
          <Tabs value={tab} onValueChange={(v) => { setTab(v); setSelectedId(null); }}>
            <TabsList className="w-full">
              <TabsTrigger value="manual" className="flex-1">Manual</TabsTrigger>
              <TabsTrigger value="pending_review" className="flex-1">Pending</TabsTrigger>
              <TabsTrigger value="reviewed" className="flex-1">Reviewed</TabsTrigger>
            </TabsList>

            <TabsContent value="manual" className="mt-3">
              {loadingManual ? (
                <Loader2 className="mx-auto mt-4 h-5 w-5 animate-spin text-muted-foreground" />
              ) : manualReviews.length === 0 ? (
                <Card className="p-4 text-sm text-muted-foreground">No manual reviews yet. Click "New Manual Review" above.</Card>
              ) : (
                <ul className="space-y-2">
                  {manualReviews.map((r) => {
                    const st = reviewStatus(r);
                    return (
                      <li key={r.id}>
                        <button
                          onClick={() => setSelectedId(r.id)}
                          className={`w-full rounded-md border p-3 text-left transition ${
                            selectedId === r.id ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted/30"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="truncate text-sm font-bold">{r.client?.full_name ?? "Client"}</div>
                            <Badge className={st.tone + " border text-[10px]"}>{st.label}</Badge>
                          </div>
                          <div className="mt-1 truncate text-xs text-muted-foreground">{r.title} · {sourceLabel(r.source)}</div>
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            Sent {new Date(r.created_at).toLocaleString()}
                            {r.read_at && <> · Read {new Date(r.read_at).toLocaleString()}</>}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </TabsContent>
            <TabsContent value="pending_review" className="mt-3">
              <SubmissionList items={items} loading={isLoading} selectedId={selectedId} setSelectedId={setSelectedId} />
            </TabsContent>
            <TabsContent value="reviewed" className="mt-3">
              <SubmissionList items={items} loading={isLoading} selectedId={selectedId} setSelectedId={setSelectedId} />
            </TabsContent>
          </Tabs>
        </div>

        <div>
          {!selectedId ? (
            <Card className="p-6 text-sm text-muted-foreground">Select an item to review.</Card>
          ) : tab === "manual" ? (
            <ManualReviewDetail
              review={manualReviews.find((m: any) => m.id === selectedId) ?? null}
              onDeleted={() => { setSelectedId(null); qc.invalidateQueries({ queryKey: ["manual-check-in-reviews"] }); }}
            />
          ) : (
            <SubmissionDetail submissionId={selectedId} />
          )}
        </div>
      </div>

      <ManualCheckInReviewComposer open={composerOpen} onOpenChange={setComposerOpen} />
    </>
  );
}

function SubmissionList({ items, loading, selectedId, setSelectedId }: { items: any[]; loading: boolean; selectedId: string | null; setSelectedId: (v: string) => void }) {
  if (loading) return <Loader2 className="mx-auto mt-4 h-5 w-5 animate-spin text-muted-foreground" />;
  if (items.length === 0) return <Card className="p-4 text-sm text-muted-foreground">Nothing here.</Card>;
  return (
    <ul className="space-y-2">
      {items.map((s: any) => (
        <li key={s.id}>
          <button
            onClick={() => setSelectedId(s.id)}
            className={`w-full rounded-md border p-3 text-left transition ${
              selectedId === s.id ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted/30"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="truncate text-sm font-bold">{s.client?.full_name ?? "Client"}</div>
              <Badge className={statusTone(s.status) + " border text-[10px]"}>{statusLabel(s.status)}</Badge>
            </div>
            <div className="mt-1 truncate text-xs text-muted-foreground">{s.form?.title}</div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {s.submitted_at ? new Date(s.submitted_at).toLocaleString() : new Date(s.updated_at).toLocaleString()}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function ManualReviewDetail({ review, onDeleted }: { review: any; onDeleted: () => void }) {
  if (!review) return <Card className="p-6 text-sm text-muted-foreground">Loading…</Card>;
  const st = reviewStatus(review);
  const qc = useQueryClient();
  const [resending, setResending] = useState(false);
  return (
    <div className="space-y-4">
      <Card className="border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-bold">{review.client?.full_name ?? "Client"} — {review.title}</div>
            <div className="text-xs text-muted-foreground">
              {sourceLabel(review.source)} · {review.check_in_date ?? "no date"} · Sent {new Date(review.created_at).toLocaleString()}
            </div>
          </div>
          <Badge className={st.tone + " border"}>{st.label}</Badge>
        </div>
      </Card>

      <Card className="border-border bg-card p-4">
        <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Coach Feedback</div>
        <div className="mt-2 whitespace-pre-wrap text-sm">{review.message}</div>
        {review.action_items && (
          <>
            <div className="mt-4 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Action Items</div>
            <div className="mt-1 whitespace-pre-wrap text-sm">{review.action_items}</div>
          </>
        )}
        {review.priority && (
          <div className="mt-3 text-xs text-muted-foreground">Priority: <span className="font-bold uppercase">{review.priority}</span></div>
        )}
      </Card>

      {(review.internal_notes || review.external_link) && (
        <Card className="border-amber-500/20 bg-amber-500/5 p-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-amber-300">Admin-only</div>
          {review.external_link && (
            <a href={review.external_link} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm text-primary underline">
              External response link <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {review.internal_notes && <div className="mt-2 whitespace-pre-wrap text-sm">{review.internal_notes}</div>}
        </Card>
      )}

      <div className="flex justify-end gap-2">
        <Link to="/admin/messages" search={{ clientId: review.client_id } as any}>
          <Button variant="outline" size="sm"><MessageCircle className="mr-1 h-4 w-4" /> Open Messenger</Button>
        </Link>
        <Button
          variant="outline"
          size="sm"
          disabled={resending}
          onClick={async () => {
            setResending(true);
            try {
              await resendManualReview(review.id);
              toast.success("Resent — status reset to Unread");
              qc.invalidateQueries({ queryKey: ["manual-check-in-reviews"] });
              qc.invalidateQueries({ queryKey: ["manual-reviews-unread", review.client_id] });
              qc.invalidateQueries({ queryKey: ["manual-reviews-for-client", review.client_id] });
            } catch (e: any) {
              toast.error(e.message ?? "Could not resend");
            } finally {
              setResending(false);
            }
          }}
        >
          {resending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-1 h-4 w-4" />}
          Resend
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={async () => {
            if (!confirm("Delete this review?")) return;
            try { await deleteManualReview(review.id); toast.success("Deleted"); onDeleted(); }
            catch (e: any) { toast.error(e.message); }
          }}
        >
          <Trash2 className="mr-1 h-4 w-4" /> Delete
        </Button>
      </div>
    </div>
  );
}

function SubmissionDetail({ submissionId }: { submissionId: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);

  const { data: sub } = useQuery({ queryKey: ["nf-sub", submissionId], queryFn: () => getSubmission(submissionId) });
  const { data: answers = [] } = useQuery({ queryKey: ["nf-sub-answers", submissionId], queryFn: () => listAnswers(submissionId) });
  const { data: files = [] } = useQuery({ queryKey: ["nf-sub-files", submissionId], queryFn: () => listFiles(submissionId) });
  const { data: questions = [] } = useQuery({
    queryKey: ["nf-questions", sub?.form_id],
    enabled: !!sub?.form_id,
    queryFn: () => listQuestions(sub!.form_id),
  });

  const ansMap = useMemo(() => {
    const m: Record<string, any> = {};
    for (const a of answers) m[a.question_id] = a;
    return m;
  }, [answers]);

  async function handleReply() {
    if (!user || !sub || !reply.trim()) return;
    setSending(true);
    try {
      const review = await createReview({ submissionId: sub.id, reviewerUserId: user.id, replyText: reply.trim() });
      const header = `📋 ${sub.form?.title ?? "Check-In"}${sub.period_start ? ` — ${sub.period_start}` : ""}\n\n`;
      const msg = await sendMessage({
        clientId: sub.client_id,
        senderId: user.id,
        senderRole: "admin",
        body: header + reply.trim(),
        messageType: "Check-In",
      });
      await markReviewMessenged(review.id, msg.id);
      await markReviewed(sub.id, user.id);
      toast.success("Reply sent to messenger");
      setReply("");
      qc.invalidateQueries({ queryKey: ["nf-review-inbox"] });
      qc.invalidateQueries({ queryKey: ["nf-sub", submissionId] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSending(false);
    }
  }

  if (!sub) return <Loader2 className="mx-auto mt-4 h-5 w-5 animate-spin text-muted-foreground" />;

  return (
    <div className="space-y-4">
      <Card className="border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-bold">{sub.client?.full_name}</div>
            <div className="text-xs text-muted-foreground">{sub.form?.title}{sub.period_start ? ` · Week of ${sub.period_start}` : ""}</div>
          </div>
          <Badge className={statusTone(sub.status) + " border"}>{statusLabel(sub.status)}</Badge>
        </div>
      </Card>

      <Card className="border-border bg-card p-4">
        <div className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">Quick Reply → Messenger</div>
        <Textarea
          rows={4}
          placeholder="Type your reply… (will appear in this client's messenger thread)"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
        />
        <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
          <Link to="/admin/messages" search={{ clientId: sub.client_id } as any}>
            <Button variant="outline" size="sm"><MessageCircle className="mr-1 h-4 w-4" /> Open Messenger</Button>
          </Link>
          <Button onClick={handleReply} disabled={!reply.trim() || sending} className="bg-gradient-primary font-bold">
            {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            Send Reply
          </Button>
        </div>
      </Card>

      <Card className="border-border bg-card p-4">
        <div className="mb-3 text-sm font-black">Answers</div>
        <ol className="space-y-3 text-sm">
          {questions.map((q, idx) => {
            const a = ansMap[q.id];
            const qFiles = files.filter((f) => f.question_id === q.id);
            const val =
              a?.value_text ??
              (a?.value_number != null ? String(a.value_number) : null) ??
              (a?.value_json ? JSON.stringify(a.value_json) : null);
            return (
              <li key={q.id} className="border-b border-border pb-3 last:border-0">
                <div className="text-xs font-bold text-muted-foreground">{idx + 1}. {q.label}</div>
                <div className="mt-1 whitespace-pre-wrap">{val || (qFiles.length ? "" : <span className="text-muted-foreground">—</span>)}</div>
                {qFiles.map((f) => <FileLink key={f.id} path={f.storage_path} name={f.original_name} />)}
              </li>
            );
          })}
        </ol>
      </Card>
    </div>
  );
}

function FileLink({ path, name }: { path: string; name: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  return (
    <div className="mt-2">
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="text-xs text-primary underline">{name ?? "Download"}</a>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={async () => setUrl(await getFileSignedUrl(path))}
        >
          View {name ?? "file"}
        </Button>
      )}
    </div>
  );
}