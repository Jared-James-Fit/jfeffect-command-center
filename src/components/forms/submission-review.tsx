/**
 * Reviewing one submitted check-in or form, wherever it's opened from
 * (Forms → Submissions, the dashboard's Check-ins to review): the full
 * answers, "Open in chat" straight to the message it sits on (scrolled to and
 * highlighted, submission-message.ts), and Mark reviewed. One set of actions,
 * so every door does the same thing and every count moves together.
 */
import type { QueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormResponsesSheet } from "@/components/forms/form-responses";
import { CheckinAnswersSheet } from "@/components/messages/messenger-checkin-card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { markCheckinReviewed, refreshReviewQueries } from "@/lib/checkin-review";
import type { FormSubmission } from "@/lib/form-submissions";
import type { SubmissionRef } from "@/lib/submission-message";
import { OpenInChatButton } from "@/components/forms/open-in-chat";

export { OpenInChatButton };

/** Where a submission lives in the chat (check-ins and native forms; anything else has no chat card). */
export function submissionRef(s: Pick<FormSubmission, "source" | "id" | "clientId" | "formId" | "submittedAt">): SubmissionRef | null {
  if (!s.clientId) return null;
  if (s.source === "checkin") return { source: "checkin", id: s.id, clientId: s.clientId };
  if (s.source === "native" && s.formId) return { source: "native", id: s.id, clientId: s.clientId, formId: s.formId, submittedAt: s.submittedAt };
  return null;
}

/** Marks it reviewed in its own table (the same write as the chat card's and the responses viewer's). */
export async function markSubmissionReviewed(s: Pick<FormSubmission, "source" | "id">, userId: string | null): Promise<void> {
  if (s.source === "checkin") {
    await markCheckinReviewed(s.id);
  } else if (s.source === "native") {
    const { error } = await (supabase.from("nf_submissions") as any)
      .update({ status: "reviewed", reviewed_at: new Date().toISOString(), reviewed_by: userId })
      .eq("id", s.id);
    if (error) throw new Error(error.message);
  } else if (s.source === "fillout") {
    const { error } = await (supabase.from("fillout_submissions") as any).update({ unread: false }).eq("id", s.id);
    if (error) throw new Error(error.message);
  }
}

/** Every list that shows review state: the dashboard card, Forms → Submissions, Messages, Clients. */
export function refreshAfterReview(qc: QueryClient, s?: Pick<FormSubmission, "source" | "id">) {
  refreshReviewQueries(qc, s?.source === "checkin" ? s.id : undefined);
  void qc.invalidateQueries({ queryKey: ["form-submissions"] });
  void qc.invalidateQueries({ queryKey: ["chat-form-request-status"] });
  void qc.invalidateQueries({ queryKey: ["form-library-stats"] });
}

/**
 * One submission's answers in full, with Open in chat and Mark reviewed. A
 * native form opens the responses viewer on that response (its own actions
 * say the same); a weekly check-in opens its answers with them pinned under.
 */
export function SubmissionSheet({
  s,
  onClose,
  onReviewed,
}: {
  s: FormSubmission;
  onClose: () => void;
  onReviewed?: (s: FormSubmission) => void;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [marking, setMarking] = useState(false);
  const [reviewed, setReviewed] = useState(s.reviewed === true);
  const ref = submissionRef(s);

  if (s.source === "native" && s.formId) {
    return (
      <FormResponsesSheet
        formId={s.formId}
        title={s.title}
        submissionId={s.id}
        open
        onOpenChange={(o) => {
          if (o) return;
          refreshAfterReview(qc);
          onClose();
        }}
      />
    );
  }
  if (s.source !== "checkin") return null;

  const mark = async () => {
    setMarking(true);
    try {
      await markSubmissionReviewed(s, user?.id ?? null);
      setReviewed(true);
      refreshAfterReview(qc, s);
      onReviewed?.(s);
      toast.success("Marked reviewed");
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't mark it reviewed");
    } finally {
      setMarking(false);
    }
  };

  return (
    <CheckinAnswersSheet
      open
      onOpenChange={(o) => !o && onClose()}
      submissionId={s.id}
      taskType="weekly_checkin"
      role="admin"
      submittedAt={s.submittedAt}
      footer={
        <div className="flex items-center gap-2">
          {ref && <OpenInChatButton subRef={ref} onLeave={onClose} className="flex-1" />}
          {reviewed ? (
            <span className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 text-[15px] font-medium text-success" data-reviewed>
              <Check className="h-4 w-4" /> Reviewed
            </span>
          ) : (
            <Button className="h-11 flex-1" onClick={mark} disabled={marking} data-mark-reviewed>
              {marking ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />} Mark reviewed
            </Button>
          )}
        </div>
      }
    />
  );
}
