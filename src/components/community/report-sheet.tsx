import { useState } from "react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { REPORT_REASONS, useReport, type ReportReason } from "@/lib/community.queries";

/** Report a post or comment: pick a reason, optional note. Coaches review every report. */
export function ReportSheet({ target, onClose }: { target: { postId?: string; commentId?: string } | null; onClose: () => void }) {
  const report = useReport();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");

  const close = () => { setReason(null); setDetails(""); onClose(); };
  const submit = () => {
    if (!target || !reason) return;
    report.mutate(
      { ...target, reason, details: details.trim() || undefined },
      {
        onSuccess: () => {
          toast.success("Thanks. A coach will review it.", { description: target.postId ? "You won't see this post again." : undefined });
          close();
        },
        onError: (e: any) => toast.error(e?.message ?? "Couldn't send the report"),
      },
    );
  };

  return (
    <Sheet open={!!target} onOpenChange={(o) => !o && close()}>
      <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Report {target?.commentId ? "comment" : "post"}</SheetTitle>
          <SheetDescription>Why are you reporting it? The person won't know it was you.</SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-2">
          {REPORT_REASONS.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => setReason(r.key)}
              className={cn(
                "w-full rounded-lg border px-3 py-2.5 text-left text-sm",
                reason === r.key ? "border-primary bg-primary/10 font-semibold" : "border-border hover:bg-muted",
              )}
            >
              {r.label}
            </button>
          ))}
          <Textarea placeholder="Anything else we should know? (optional)" value={details} maxLength={1000} onChange={(e) => setDetails(e.target.value)} />
          <Button className="w-full" disabled={!reason || report.isPending} onClick={submit}>
            {report.isPending ? "Sending…" : "Send report"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
