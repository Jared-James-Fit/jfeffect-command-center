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
import { Send, MessageCircle, Loader2 } from "lucide-react";
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

export const Route = createFileRoute("/_authenticated/admin/check-in-reviews")({
  component: AdminCheckInReviews,
});

function AdminCheckInReviews() {
  const [tab, setTab] = useState<NfSubmissionStatus>("pending_review");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["nf-review-inbox", tab],
    queryFn: () => listAllSubmissionsForReview({ status: tab }),
  });

  return (
    <>
      <PageHeader title="Check-In Reviews" subtitle="Review submitted check-ins and reply directly into messenger." />
      <div className="grid gap-4 p-4 md:grid-cols-[360px_1fr] md:p-6">
        <div>
          <Tabs value={tab} onValueChange={(v) => { setTab(v as any); setSelectedId(null); }}>
            <TabsList className="w-full">
              <TabsTrigger value="pending_review" className="flex-1">Pending</TabsTrigger>
              <TabsTrigger value="reviewed" className="flex-1">Reviewed</TabsTrigger>
            </TabsList>
            <TabsContent value={tab} className="mt-3">
              {isLoading ? (
                <Loader2 className="mx-auto mt-4 h-5 w-5 animate-spin text-muted-foreground" />
              ) : items.length === 0 ? (
                <Card className="p-4 text-sm text-muted-foreground">Nothing here.</Card>
              ) : (
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
              )}
            </TabsContent>
          </Tabs>
        </div>

        <div>
          {selectedId ? <SubmissionDetail submissionId={selectedId} /> : (
            <Card className="p-6 text-sm text-muted-foreground">Select a submission to review.</Card>
          )}
        </div>
      </div>
    </>
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