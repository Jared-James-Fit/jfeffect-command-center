import { Flag } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { postTimeLabel } from "@/lib/community";
import { REPORT_REASONS, useOpenReports, useResolveReport } from "@/lib/community.queries";

const reasonLabel = (k: string) => REPORT_REASONS.find((r) => r.key === k)?.label ?? k;

/** Staff: reported posts and comments. Keep it (dismiss) or remove it for everyone. */
export function ReportsQueue() {
  const { data: reports = [] } = useOpenReports(true);
  const resolve = useResolveReport();
  if (!reports.length) return null;
  const act = (reportId: string, action: "dismiss" | "remove") =>
    resolve.mutate(
      { reportId, action },
      {
        onSuccess: () => toast.success(action === "remove" ? "Removed for everyone" : "Kept. Report closed."),
        onError: (e: any) => toast.error(e?.message ?? "Couldn't do that"),
      },
    );
  return (
    <Card className="mx-4 my-3 space-y-3 border-amber-500/40 p-4">
      <div className="flex items-center gap-2 text-sm font-bold">
        <Flag className="h-4 w-4 text-amber-500" /> Reported ({reports.length})
      </div>
      {reports.map((r) => (
        <div key={r.id} className="space-y-1 border-t border-border pt-2 text-sm">
          <div className="text-xs text-muted-foreground">
            {reasonLabel(r.reason)} · {r.comment_id ? "comment" : "post"} by {r.author?.name ?? "someone"} · reported by {r.reporter?.name ?? "someone"}
            {r.reports > 1 ? ` (+${r.reports - 1} more)` : ""} · {postTimeLabel(r.created_at)}
          </div>
          <div className="line-clamp-3 whitespace-pre-line">{r.comment_body ?? r.post_caption ?? "(photo or workout with no caption)"}</div>
          {r.details && <div className="text-xs italic text-muted-foreground">“{r.details}”</div>}
          <div className="flex gap-2 pt-1">
            <Button size="sm" variant="outline" disabled={resolve.isPending} onClick={() => act(r.id, "dismiss")}>Keep</Button>
            <Button size="sm" variant="destructive" disabled={resolve.isPending} onClick={() => act(r.id, "remove")}>Remove</Button>
          </div>
        </div>
      ))}
    </Card>
  );
}
