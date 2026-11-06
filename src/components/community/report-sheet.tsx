import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
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

export type ReportKind = "post" | "comment" | "program" | "profile";

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
  comment: "comment",
  program: "program",
  profile: "account",
};

/**
 * Report something in Crew (community_report). Only the JF Effect team sees
 * reports; the person reported is never told who reported them.
 */
export function ReportSheet({
  kind,
  targetId,
  open,
  onOpenChange,
}: {
  kind: ReportKind;
  targetId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      setReason(null);
      setDetails("");
      setDone(false);
    }
  };

  const send = async () => {
    if (!reason || busy) return;
    setBusy(true);
    const { error } = await (supabase as any).rpc("community_report", {
      _kind: kind,
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
    // tell the team (never who reported it); a failed push never fails the report
    void import("@/lib/push/events.functions")
      .then(({ notifyCommunityReport }) => notifyCommunityReport({ data: { kind, targetId } }))
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
              The JF Effect team will look at it. They won't tell anyone who reported it.
            </p>
            <Button className="mt-6 w-full" variant="secondary" onClick={() => close(false)}>
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
