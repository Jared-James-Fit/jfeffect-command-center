import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Camera, Scale, ChevronRight, Droplet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { format, parseISO } from "date-fns";
import { ensureWaterTarget, formatWater, listWaterForDate, summarizeToday, todayLocalISO } from "@/lib/water";
import { getCombinedBodyweightSeries } from "@/lib/bodyweight";
import { WaterTrackerCard } from "./water-tracker-card";

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
        to="/_authenticated/admin/clients/$id/progress"
        params={{ id: progressHref.clientId }}
      >
        Open <ChevronRight className="ml-0.5 h-3.5 w-3.5" />
      </Link>
    );

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
              label={`Latest ${sub.submission_type} check-in`}
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
      </Card>

      {/* Water tracker (always visible — default 3.0 L target) */}
      <WaterTrackerCard
        userId={userId}
        currentUserId={currentUserId}
        viewerRole={viewerRole}
        compact={false}
      />
      <p className="px-1 text-[10px] text-muted-foreground">
        Today: {formatWater(summary.total, "L")} of {formatWater(target?.active_ml ?? 3000, "L")} ({summary.pct}%)
      </p>
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