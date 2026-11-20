/**
 * Home's "Check-ins to review": the weekly check-ins and forms clients sent
 * that are waiting on the coach (review-queue.ts, the same rule as Forms →
 * Submissions' "To review" and the Messages inbox), each one tap from its
 * answers, from the exact message it sits on in their chat (scrolled to and
 * highlighted), and from Mark reviewed. Longest waiting first. Hidden when
 * nothing is waiting.
 */
import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, ClipboardCheck, Loader2, MessageCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { UserAvatar } from "@/components/user-avatar";
import { chatAge } from "@/components/messages/chat-list-row";
import { SubmissionSheet, markSubmissionReviewed, refreshAfterReview, submissionRef } from "@/components/forms/submission-review";
import { useAuth } from "@/lib/auth";
import { listFormSubmissionsFn } from "@/lib/form-submissions.functions";
import { toReviewKeys, type FormSubmission } from "@/lib/form-submissions";
import { chatSearch, findSubmissionMessage } from "@/lib/submission-message";

export const REVIEW_QUEUE_KEY = ["form-submissions", "review"] as const;
/** Rows shown before "Show N more". */
const FIRST_ROWS = 4;

/** What it is, in a few words: "Weekly check-in", "Nutrition Update", the form's title. */
export function reviewLabel(s: Pick<FormSubmission, "kind" | "title">): string {
  if (s.kind === "weekly_checkin") return "Weekly check-in";
  if (s.kind === "nutrition_update") return "Nutrition Update";
  return s.title;
}

/** Waiting on the coach, longest waiting first (pure: the card and its test read it). */
export function reviewQueue(rows: FormSubmission[], now = Date.now()): FormSubmission[] {
  const keys = toReviewKeys(rows, now);
  return rows.filter((r) => keys.has(r.key)).sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
}

export function useReviewQueue() {
  const list = useServerFn(listFormSubmissionsFn);
  const q = useQuery({
    queryKey: REVIEW_QUEUE_KEY,
    queryFn: () => list({ data: { scope: "review" } }),
    staleTime: 15_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    refetchOnMount: "always",
  });
  const waiting = useMemo(() => reviewQueue(q.data ?? []), [q.data]);
  return { ...q, waiting };
}

export function CheckinsToReviewCard() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { waiting } = useReviewQueue();
  const [expanded, setExpanded] = useState(false);
  const [open, setOpen] = useState<FormSubmission | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (waiting.length === 0 && !open) return null;
  const shown = expanded ? waiting : waiting.slice(0, FIRST_ROWS);
  const more = waiting.length - shown.length;

  // Done here: out of the list at once, every other count follows.
  const drop = (s: FormSubmission) =>
    qc.setQueryData<FormSubmission[]>(REVIEW_QUEUE_KEY as any, (old) => old?.map((r) => (r.key === s.key ? { ...r, reviewed: true } : r)));

  const markReviewed = async (s: FormSubmission) => {
    setBusy(`mark:${s.key}`);
    try {
      await markSubmissionReviewed(s, user?.id ?? null);
      drop(s);
      refreshAfterReview(qc, s);
      toast.success(`${s.clientName.split(" ")[0]}'s ${reviewLabel(s).toLowerCase()} marked reviewed`);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't mark it reviewed");
    } finally {
      setBusy(null);
    }
  };

  // The chat, on the message it sits on (found now if the sheet hasn't already).
  const openChat = async (s: FormSubmission) => {
    const ref = submissionRef(s);
    if (!ref) return;
    setBusy(`chat:${s.key}`);
    let msg: string | null = null;
    try {
      msg = await qc.fetchQuery({ queryKey: ["submission-message", ref.source, ref.id], queryFn: () => findSubmissionMessage(ref), staleTime: 5 * 60_000 });
    } catch {
      // open the chat at its latest message instead
    }
    setBusy(null);
    void navigate({ to: "/admin/messages", search: chatSearch(ref.clientId, msg) as any });
  };

  return (
    <>
      {waiting.length > 0 && (
        <Card className="p-4" data-checkins-to-review>
          <div className="mb-1 flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-[16px] font-semibold">
              <ClipboardCheck className="h-4 w-4 text-muted-foreground" aria-hidden />
              {waiting.length === 1 ? "1 check-in to review" : `${waiting.length} check-ins to review`}
            </h2>
            <Link
              to="/admin/forms"
              search={{ tab: "submissions", status: "to_review" } as any}
              className="shrink-0 text-[13px] font-semibold text-muted-foreground hover:text-foreground"
            >
              All →
            </Link>
          </div>
          <ul className="divide-y divide-border">
            {shown.map((s) => {
              const name = s.clientName?.trim() || "Client";
              return (
                <li key={s.key} className="flex items-center gap-2 py-2" data-review-row={s.kind}>
                  <button
                    type="button"
                    onClick={() => setOpen(s)}
                    className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left"
                    aria-label={`Read ${name}'s ${reviewLabel(s).toLowerCase()}`}
                  >
                    <UserAvatar src={s.photo} name={name} size={36} expandable={false} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold">{name}</span>
                      <span className="block truncate text-[13px] text-muted-foreground">
                        {reviewLabel(s)} · {chatAge(s.submittedAt)}
                      </span>
                    </span>
                  </button>
                  {submissionRef(s) && (
                    <button
                      type="button"
                      onClick={() => void openChat(s)}
                      disabled={busy === `chat:${s.key}`}
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                      aria-label={`Open ${name}'s ${reviewLabel(s).toLowerCase()} in your chat`}
                      title="Open in chat"
                      data-review-chat
                    >
                      {busy === `chat:${s.key}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void markReviewed(s)}
                    disabled={busy === `mark:${s.key}`}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                    aria-label={`Mark ${name}'s ${reviewLabel(s).toLowerCase()} reviewed`}
                    title="Mark reviewed"
                    data-review-mark
                  >
                    {busy === `mark:${s.key}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  </button>
                </li>
              );
            })}
          </ul>
          {more > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="mt-1 min-h-10 w-full rounded-lg text-[14px] font-semibold text-muted-foreground hover:text-foreground"
            >
              Show {more} more
            </button>
          )}
        </Card>
      )}
      {/* outside the card: it stays open after its row leaves the list */}
      {open && <SubmissionSheet s={open} onClose={() => setOpen(null)} onReviewed={drop} />}
    </>
  );
}
