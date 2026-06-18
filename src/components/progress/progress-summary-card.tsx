import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Camera, Scale, Ruler, History } from "lucide-react";

/**
 * Dummy-proof Progress Tracking card for client + member home dashboards.
 * Four large action buttons that navigate to the Progress page with a
 * `?action=` search param so the right dialog/tab opens automatically.
 * Latest-entry rows are intentionally NOT shown here — the Progress page
 * is the archive/history; Home stays focused on quick actions.
 */
export type ProgressSummaryAction = "photo" | "weight" | "measure" | "history";

export function ProgressSummaryCard({
  userId,
  currentUserId,
  viewerRole,
  progressHref,
  title = "Progress Tracking",
}: {
  userId: string;
  currentUserId: string;
  viewerRole: "owner" | "admin" | "coach";
  progressHref:
    | { kind: "portal" }
    | { kind: "member" }
    | { kind: "admin-client"; clientId: string };
  title?: string;
}) {
  void userId; void currentUserId; void viewerRole;

  function ActionLink({
    action, icon: Icon, label, primary,
  }: { action: ProgressSummaryAction; icon: any; label: string; primary?: boolean }) {
    const search = action === "history" ? undefined : ({ action } as { action: ProgressSummaryAction });
    const className = `flex min-h-[104px] flex-col items-center justify-center gap-2 rounded-lg border-2 p-4 text-center transition active:scale-[0.98] ${
      primary ? "border-primary bg-primary/10 hover:bg-primary/15" : "border-border bg-card hover:bg-accent"
    }`;
    const inner = (
      <>
        <Icon className={`h-7 w-7 ${primary ? "text-primary" : ""}`} />
        <span className="text-sm font-bold leading-tight">{label}</span>
      </>
    );
    if (progressHref.kind === "portal") {
      return <Link to="/portal/progress" search={search as any} className={className}>{inner}</Link>;
    }
    if (progressHref.kind === "member") {
      return <Link to="/m/progress" search={search as any} className={className}>{inner}</Link>;
    }
    return (
      <Link
        to="/admin/clients/$id/progress"
        params={{ id: progressHref.clientId }}
        search={search as any}
        className={className}
      >
        {inner}
      </Link>
    );
  }

  return (
    <div className="space-y-3">
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between gap-2 border-b border-border bg-secondary/40 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Camera className="h-4 w-4 text-primary" />
            <span className="text-xs font-bold uppercase tracking-widest">{title}</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 p-3">
          <ActionLink action="photo" icon={Camera} label="Upload Photos" primary />
          <ActionLink action="weight" icon={Scale} label="Log Weight" />
          <ActionLink action="measure" icon={Ruler} label="Add Measurements" />
          <ActionLink action="history" icon={History} label="View Progress" />
        </div>
      </Card>

    </div>
  );
}

