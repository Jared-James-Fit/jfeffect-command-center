import { type ReactNode, type ComponentType } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Camera, Scale, Ruler, ArrowRight, Video, MessageSquare } from "lucide-react";
import { CoachCheckinReplies } from "./coach-checkin-replies";

/**
 * Progress Snapshot card for client + member home dashboards.
 * Quick-add measurement and photo with one CTA to the Progress page.
 */
export type ProgressSummaryAction = "photo" | "weight" | "measure" | "history";

export function ProgressSummaryCard({
  userId,
  currentUserId,
  viewerRole,
  progressHref,
  title = "Progress Snapshot",
  extraActions,
}: {
  userId: string;
  currentUserId: string;
  viewerRole: "owner" | "admin" | "coach";
  progressHref:
    | { kind: "portal" }
    | { kind: "member" }
    | { kind: "admin-client"; clientId: string };
  title?: string;
  /**
   * Optional secondary action tiles rendered below the primary 4-up grid.
   * Used by the client + member home dashboards to surface flow-specific
   * shortcuts (e.g. Submit Weekly Check-In) that need data only the host
   * route has.
   */
  extraActions?: ReactNode;
}) {
  void currentUserId; void viewerRole;

  // ---------- Recent status (latest entry per category only — fast) ----------
  const { data: latestBw } = useQuery({
    queryKey: ["progress-latest-bw", userId],
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("progress_bodyweight")
        .select("logged_date, weight_value, weight_unit")
        .eq("user_id", userId)
        .order("logged_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      return (data ?? null) as { logged_date: string; weight_value: number; weight_unit: string | null } | null;
    },
  });
  const { data: latestPhotoAt } = useQuery({
    queryKey: ["progress-latest-photo", userId],
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("progress_submissions")
        .select("submission_date, created_at")
        .eq("user_id", userId)
        .eq("submission_type", "photo")
        .order("submission_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      return (data?.submission_date ?? data?.created_at ?? null) as string | null;
    },
  });
  const { data: latestVideoAt } = useQuery({
    queryKey: ["progress-latest-video", userId],
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("progress_submissions")
        .select("submission_date, created_at")
        .eq("user_id", userId)
        .eq("submission_type", "video")
        .order("submission_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      return (data?.submission_date ?? data?.created_at ?? null) as string | null;
    },
  });
  const { data: latestMeasAt } = useQuery({
    queryKey: ["progress-latest-meas", userId],
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("progress_measurements")
        .select("measured_date")
        .eq("user_id", userId)
        .order("measured_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      return (data?.measured_date ?? null) as string | null;
    },
  });

  const fmtDate = (iso: string | null | undefined): string => {
    if (!iso) return "—";
    const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };

  type Primary = { label: string; icon: ComponentType<{ className?: string }>; action: "bodyweight" | "photo" | "video" | "measure" };
  const primary: Primary[] = [
    { label: "Log Weight", icon: Scale, action: "bodyweight" },
    { label: "Add Photos", icon: Camera, action: "photo" },
    { label: "Add Video", icon: Video, action: "video" },
    { label: "Add Measurements", icon: Ruler, action: "measure" },
  ];

  const PrimaryTile = ({ p }: { p: Primary }) => {
    const Icon = p.icon;
    const inner = (
      <div className="flex h-full flex-col items-center justify-center gap-2 rounded-xl border border-border bg-secondary/30 p-4 text-center transition active:bg-secondary/60 hover:border-primary/40">
        <Icon className="h-6 w-6 text-primary" />
        <span className="text-xs font-bold uppercase tracking-wide">{p.label}</span>
      </div>
    );
    if (progressHref.kind === "member") {
      return <Link to="/m/progress" search={{ action: p.action } as never}>{inner}</Link>;
    }
    if (progressHref.kind === "portal") {
      return <Link to="/portal/progress" search={{ action: p.action } as never}>{inner}</Link>;
    }
    return (
      <Link to="/admin/clients/$id/progress" params={{ id: progressHref.clientId }} search={{ action: p.action } as never}>
        {inner}
      </Link>
    );
  };

  const recentRows: { label: string; value: string; show: boolean }[] = [
    {
      label: "Latest weight",
      value: latestBw
        ? `${Number(latestBw.weight_value).toFixed(1)} ${latestBw.weight_unit ?? "lb"} · ${fmtDate(latestBw.logged_date)}`
        : "—",
      show: !!latestBw,
    },
    { label: "Last photo", value: fmtDate(latestPhotoAt), show: !!latestPhotoAt },
    { label: "Last video", value: fmtDate(latestVideoAt), show: !!latestVideoAt },
    { label: "Last measurement", value: fmtDate(latestMeasAt), show: !!latestMeasAt },
  ];
  const anyRecent = recentRows.some((r) => r.show);

  const viewHubInner = (
    <div className="flex items-center justify-between rounded-xl border border-border bg-secondary/30 px-4 py-3 text-xs font-bold uppercase tracking-wide transition active:bg-secondary/60 hover:border-primary/40">
      <span>View Progress Hub</span>
      <ArrowRight className="h-4 w-4" />
    </div>
  );

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-secondary/40 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Scale className="h-4 w-4 text-primary" />
          <span className="text-xs font-bold uppercase tracking-widest">{title}</span>
        </div>
      </div>
      <div className="p-4 space-y-4">

        {/* Primary quick actions */}
        <div className="grid grid-cols-2 gap-2">
          {primary.map((p) => <PrimaryTile key={p.action} p={p} />)}
        </div>

        {/* Secondary quick actions from host (Upload Lift, Submit Weekly Check-In) */}
        {extraActions ? <div>{extraActions}</div> : null}

        {/* View Progress Hub */}
        {progressHref.kind === "portal" && <Link to="/portal/progress">{viewHubInner}</Link>}
        {progressHref.kind === "member" && <Link to="/m/progress">{viewHubInner}</Link>}
        {progressHref.kind === "admin-client" && (
          <Link to="/admin/clients/$id/progress" params={{ id: progressHref.clientId }}>{viewHubInner}</Link>
        )}

        {/* Recent status */}
        <div className="rounded-xl border border-border bg-secondary/20 p-3">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Recent status
          </div>
          {anyRecent ? (
            <ul className="divide-y divide-border/60">
              {recentRows.filter((r) => r.show).map((r) => (
                <li key={r.label} className="flex items-center justify-between py-1.5 text-xs">
                  <span className="text-muted-foreground">{r.label}</span>
                  <span className="font-semibold">{r.value}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-1 text-xs text-muted-foreground">No progress logged yet.</p>
          )}
        </div>

        {/* Coach Check-In Replies — keep, it's a real surface */}
        <div className="rounded-xl border border-border bg-secondary/30 p-4">
          <div className="flex items-center gap-2 mb-3">
            <MessageSquare className="h-4 w-4 text-primary" />
            <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Coach Check-In Replies</span>
          </div>
          <CoachCheckinReplies />
        </div>
      </div>
    </Card>
  );
}

