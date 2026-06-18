import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Camera, Scale, Ruler, History, Droplet, Plus } from "lucide-react";
import {
  addWaterEntry, ensureWaterTarget, formatWater, listWaterForDate,
  summarizeToday, todayLocalISO,
} from "@/lib/water";
import { toast } from "sonner";

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
  const today = todayLocalISO();
  const qc = useQueryClient();

  const waterTargetQ = useQuery({
    queryKey: ["water-target", userId],
    enabled: !!userId,
    queryFn: () => ensureWaterTarget(userId),
    staleTime: 30_000,
  });
  const waterTodayQ = useQuery({
    queryKey: ["water-today", userId, today],
    enabled: !!userId,
    queryFn: () => listWaterForDate(userId, today),
    staleTime: 5_000,
  });

  const target = waterTargetQ.data;
  const summary = summarizeToday(waterTodayQ.data ?? [], target?.active_ml ?? 3000);

  async function quickAddWater() {
    if (viewerRole !== "owner") return;
    try {
      await addWaterEntry({ userId, amountMl: 250, source: "quick_add", createdByUserId: currentUserId });
      qc.invalidateQueries({ queryKey: ["water-today", userId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't log water");
    }
  }

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

      {/* Compact water summary — full tracker lives in Progress */}
      <Card className="flex items-center gap-3 px-4 py-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-sky-500/10 text-sky-600 dark:text-sky-400">
          <Droplet className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Water today</div>
          <div className="truncate text-sm font-bold tabular-nums">
            {formatWater(summary.total, "L")} / {formatWater(target?.active_ml ?? 3000, "L")}
            <span className="ml-2 text-xs font-normal text-muted-foreground">{summary.pct}%</span>
          </div>
        </div>
        {viewerRole === "owner" && (
          <Button size="sm" variant="secondary" className="h-9 shrink-0" onClick={quickAddWater}>
            <Plus className="mr-1 h-3.5 w-3.5" /> 250ml
          </Button>
        )}
      </Card>
    </div>
  );
}

export { Droplet };
