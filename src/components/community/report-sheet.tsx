import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBlockPerson } from "@/lib/direct-chats";
import { hideReportedLocally, refreshAfterBlock } from "@/lib/crew-safety";
import type { CommunityAuthor } from "@/lib/community";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/** What can be reported. A story is a post to the server (`community_report` kind 'post'). */
export type ReportKind = "post" | "story" | "comment" | "program" | "profile";

export const REPORT_REASONS = [
  { id: "spam", label: "Spam or scam" },
  { id: "harassment", label: "Bullying or harassment" },
  { id: "hate", label: "Hate speech" },
  { id: "nudity", label: "Nudity or sexual content" },
  { id: "violence", label: "Violence or threats" },
  { id: "self_harm", label: "Self-harm or eating disorder" },
  { id: "misinformation", label: "Dangerous or false advice" },
  { id: "other", label: "Something else" },
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number]["id"];

const WHAT: Record<ReportKind, string> = {
  post: "post",
  story: "story",
  comment: "comment",
  program: "program",
  profile: "account",
};

/**
 * Report something in Crew (community_report). Only the JF Effect team sees
 * reports; the person reported is never told who reported them. A reported
 * post, story or comment leaves the reporter's screen at once (and their
 * feed from then on); enough independent reports hide it for everyone until
 * the team decides. The thank-you step offers Block for the person, from the
 * same sheet (`author`: never a coach).
 * `postId`: a comment's post, so the comment can leave its thread at once.
 * `onReported`: e.g. close a story viewer showing what was just reported.
 */
export function ReportSheet({
  kind,
  targetId,
  open,
  onOpenChange,
  author,
  postId,
  onReported,
}: {
  kind: ReportKind;
  targetId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  author?: CommunityAuthor | null;
  postId?: string | null;
  onReported?: () => void;
}) {
  const qc = useQueryClient();
  const block = useBlockPerson();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const serverKind = kind === "story" ? "post" : kind;
  const canBlock = !!author && !author.is_coach && !blocked;

  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      // what was reported leaves the screen as the sheet goes
      if (done && (serverKind === "post" || serverKind === "comment")) {
        hideReportedLocally(qc, serverKind, targetId, postId);
        onReported?.();
      }
      setReason(null);
      setDetails("");
      setDone(false);
      setBlocked(false);
    }
  };

  const blockAuthor = () => {
    if (!author || block.isPending) return;
    block.mutate(
      { userId: author.user_id, blocked: true },
      {
        onSuccess: () => {
          setBlocked(true);
          toast(`Blocked ${author.name}`, { description: "They can't see your posts or message you. They aren't told." });
          refreshAfterBlock(qc);
        },
        onError: (e: any) => toast.error(e?.message ?? "That didn't work. Try again."),
      },
    );
  };

  const send = async () => {
    if (!reason || busy) return;
    setBusy(true);
    const { error } = await (supabase as any).rpc("community_report", {
      _kind: serverKind,
      _target: targetId,
      _reason: reason,
      _details: details.trim() || null,
    });
    setBusy(false);
    if (error) {
      toast.error(
        /yours/i.test(error.message)
          ? "You can't report your own."
          : "Couldn't send the report. Try again.",
      );
      return;
    }
    setDone(true);
    toast.success("Report sent", { description: "The JF Effect team reviews reports within 24 hours." });
    // tell the team (never who reported it); a failed push never fails the report
    void import("@/lib/push/events.functions")
      .then(({ notifyCommunityReport }) => notifyCommunityReport({ data: { kind: serverKind, targetId } }))
      .catch(() => null);
  };

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent
        side="bottom"
        className="max-h-[88dvh] overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        {done ? (
          <div className="py-6 text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-muted">
              <Check className="h-6 w-6 text-success" aria-hidden />
            </div>
            <h2 className="mt-4 text-[18px] font-semibold">Thanks for telling us</h2>
            <p className="mx-auto mt-1 max-w-[300px] text-sm text-muted-foreground">
              {serverKind === "post" || serverKind === "comment" ? "You won't see it anymore. " : ""}
              The JF Effect team will look at it within 24 hours. They won't tell anyone who reported it.
            </p>
            {canBlock && (
              <Button className="mt-6 h-12 w-full text-destructive" variant="secondary" disabled={block.isPending} onClick={blockAuthor} data-report-block>
                {block.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-label="Blocking" /> : `Block ${author!.name}`}
              </Button>
            )}
            {blocked && <p className="mt-4 text-[13px] text-muted-foreground">{author?.name} is blocked.</p>}
            <Button className={canBlock ? "mt-2 w-full" : "mt-6 w-full"} variant={canBlock ? "ghost" : "secondary"} onClick={() => close(false)}>
              Done
            </Button>
          </div>
        ) : (
          <>
            <SheetHeader className="text-left">
              <SheetTitle>Report this {WHAT[kind]}</SheetTitle>
              <SheetDescription>Only the JF Effect team sees reports.</SheetDescription>
            </SheetHeader>
            <div
              className="mt-4 divide-y divide-border overflow-hidden rounded-2xl border border-border"
              role="radiogroup"
            >
              {REPORT_REASONS.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  role="radio"
                  aria-checked={reason === r.id}
                  onClick={() => setReason(r.id)}
                  className={cn(
                    "flex min-h-[48px] w-full items-center justify-between px-4 text-left text-[15px]",
                    reason === r.id && "bg-secondary",
                  )}
                >
                  {r.label}
                  {reason === r.id && <Check className="h-4 w-4" aria-hidden />}
                </button>
              ))}
            </div>
            <Textarea
              value={details}
              onChange={(e) => setDetails(e.target.value.slice(0, 500))}
              placeholder="Anything we should know? (optional)"
              className="mt-3 min-h-[80px] text-base"
            />
            <Button className="mt-4 h-12 w-full" disabled={!reason || busy} onClick={send}>
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-label="Sending" />
              ) : (
                "Send report"
              )}
            </Button>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
