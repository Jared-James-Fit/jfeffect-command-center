import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Camera, Scale, ChevronRight, Droplet, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { format, parseISO } from "date-fns";
import { addWaterEntry, ensureWaterTarget, formatWater, listWaterForDate, summarizeToday, todayLocalISO } from "@/lib/water";
import { getCombinedBodyweightSeries } from "@/lib/bodyweight";
import { toast } from "sonner";

/**
 * Compact Progress + Water summary, used on portal/member dashboards and
 * admin profile overview tiles. Rows with no data are hidden.
 */
export function ProgressSummaryCard({
  userId,
  currentUserId,
  viewerRole,
  progressHref,
  title = "Progress",
}: {
  userId: string;
  currentUserId: string;
  viewerRole: "owner" | "admin" | "coach";
  /** Where the "Open" button navigates. */
  progressHref:
    | { kind: "portal" }
    | { kind: "member" }
    | { kind: "admin-client"; clientId: string };
  title?: string;
}) {
  const today = todayLocalISO();
  const qc = useQueryClient();

  const subQ = useQuery({
    queryKey: ["progress-summary-sub", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase
        .from("progress_submissions")
        .select("id, submission_type, submission_date, check_in_label, review_status, submitted_at")
        .eq("user_id", userId)
        .order("submission_date", { ascending: false })
        .limit(1);
      return data?.[0] ?? null;
    },
    staleTime: 30_000,
  });

  const bwQ = useQuery({
    queryKey: ["progress-summary-bw", userId],
    enabled: !!userId,
    queryFn: () => getCombinedBodyweightSeries(userId, 1),
    staleTime: 30_000,
  });

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

  const latestBw = bwQ.data?.[bwQ.data.length - 1];
  const sub = subQ.data;
  const target = waterTargetQ.data;
  const summary = summarizeToday(waterTodayQ.data ?? [], target?.active_ml ?? 3000);

  const reviewBadge =
    sub?.review_status === "awaiting_review" ? "Awaiting review"
    : sub?.review_status === "needs_update" ? "Needs update"
    : sub?.review_status === "reviewed" ? "Reviewed"
    : null;

  const openLink =
    progressHref.kind === "portal" ? (
      <Link to="/portal/progress">Open <ChevronRight className="ml-0.5 h-3.5 w-3.5" /></Link>
    ) : progressHref.kind === "member" ? (
      <Link to="/m/progress">Open <ChevronRight className="ml-0.5 h-3.5 w-3.5" /></Link>
    ) : (
      <Link
        to="/admin/clients/$id/progress"
        params={{ id: progressHref.clientId }}
      >
        Open <ChevronRight className="ml-0.5 h-3.5 w-3.5" />
      </Link>
    );

  const startCheckInLink =
    progressHref.kind === "portal" ? (
      <Link to="/portal/progress">Start Check-In</Link>
    ) : progressHref.kind === "member" ? (
      <Link to="/m/progress">Start Check-In</Link>
    ) : (
      <Link to="/admin/clients/$id/progress" params={{ id: progressHref.clientId }}>
        Start Check-In
      </Link>
    );

  async function quickAddWater() {
    if (viewerRole !== "owner") return;
    try {
      await addWaterEntry({ userId, amountMl: 250, source: "quick_add", createdByUserId: currentUserId });
      qc.invalidateQueries({ queryKey: ["water-today", userId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't log water");
    }
  }

  return (
    <div className="space-y-3">
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between gap-2 border-b border-border bg-secondary/40 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Camera className="h-4 w-4 text-primary" />
            <span className="text-xs font-bold uppercase tracking-widest">{title}</span>
          </div>
          <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
            {openLink}
          </Button>
        </div>

        <div className="divide-y divide-border">
          {sub && (
            <Row
              icon={<Camera className="h-4 w-4" />}
              label={`Latest ${sub.submission_type === "photo" ? "photo" : "video"} check-in`}
              value={fmt(sub.submission_date)}
              right={reviewBadge ? <Badge variant="outline" className="text-[10px]">{reviewBadge}</Badge> : null}
            />
          )}
          {latestBw && (
            <Row
              icon={<Scale className="h-4 w-4" />}
              label="Latest bodyweight"
              value={`${latestBw.value.toFixed(1)} ${latestBw.unit}`}
              right={<span className="text-[11px] text-muted-foreground">{fmt(latestBw.date)}</span>}
            />
          )}
          {!sub && !latestBw && (
            <div className="px-4 py-3 text-xs text-muted-foreground">
              No progress entries yet. Open Progress to start your first check-in.
            </div>
          )}
        </div>

        <div className="flex gap-2 border-t border-border bg-secondary/20 px-3 py-2.5">
          <Button asChild size="sm" className="flex-1 font-bold uppercase">
            {startCheckInLink}
          </Button>
          <Button asChild size="sm" variant="outline" className="flex-1">
            {openLink}
          </Button>
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
        <Button asChild size="sm" variant="ghost" className="h-9 shrink-0 px-2 text-xs">
          {openLink}
        </Button>
      </Card>
    </div>
  );
}

function Row({ icon, label, value, right }: {
  icon: React.ReactNode; label: string; value: string; right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-muted-foreground">{icon}</span>
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground">{label}</div>
          <div className="truncate text-sm font-semibold">{value}</div>
        </div>
      </div>
      {right}
    </div>
  );
}

function fmt(d: string | null | undefined): string {
  if (!d) return "—";
  try { return format(parseISO(d), "MMM d, yyyy"); } catch { return d; }
}

export { Droplet };