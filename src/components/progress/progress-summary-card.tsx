import { type ReactNode, type ComponentType } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Camera, Scale, Ruler, ArrowRight, Video, MessageSquare, Dumbbell, ClipboardCheck } from "lucide-react";
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
  liftHref,
  checkInHref,
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
   * Optional href to a lift upload flow surfaced as a secondary action.
   * Omit to hide the Upload Lift shortcut (e.g. member dashboards).
   */
  liftHref?: string;
  /**
   * Optional href to a check-in submission flow surfaced as a secondary action.
   * Omit to hide the Submit Check-In shortcut (e.g. member dashboards).
   */
  checkInHref?: string;
  /**
   * Optional secondary action tiles rendered below the built-in secondary row.
   * Used by the client + member home dashboards to surface flow-specific
   * shortcuts (e.g. member Tools/Announcements/Support) that need data only the
   * host route has.
   */
  extraActions?: ReactNode;
}) {
  void currentUserId; void viewerRole;

  // ---------- Recent status (single parallel fetch — one cache entry) ----------
  const { data: latest } = useQuery({
    queryKey: ["progress-snapshot-latest", userId],
    staleTime: 60_000,
    enabled: !!userId,
    queryFn: async () => {
      const [bwRes, photoRes, videoRes, measRes] = await Promise.all([
        supabase
          .from("progress_bodyweight")
          .select("logged_date, weight_value, weight_unit")
          .eq("user_id", userId)
          .order("logged_date", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("progress_submissions")
          .select("submission_date, created_at")
          .eq("user_id", userId)
          .eq("submission_type", "photo")
          .order("submission_date", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("progress_submissions")
          .select("submission_date, created_at")
          .eq("user_id", userId)
          .eq("submission_type", "video")
          .order("submission_date", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("progress_measurements")
          .select("measured_date")
          .eq("user_id", userId)
          .order("measured_date", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      return {
        bw: (bwRes.data ?? null) as { logged_date: string; weight_value: number; weight_unit: string | null } | null,
        photoAt: (photoRes.data?.submission_date ?? photoRes.data?.created_at ?? null) as string | null,
        videoAt: (videoRes.data?.submission_date ?? videoRes.data?.created_at ?? null) as string | null,
        measAt: (measRes.data?.measured_date ?? null) as string | null,
      };
    },
  });
  const latestBw = latest?.bw ?? null;
  const latestPhotoAt = latest?.photoAt ?? null;
  const latestVideoAt = latest?.videoAt ?? null;
  const latestMeasAt = latest?.measAt ?? null;

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
      label: "Weight",
      value: latestBw
        ? `${Number(latestBw.weight_value).toFixed(1)} ${latestBw.weight_unit ?? "lb"} · ${fmtDate(latestBw.logged_date)}`
        : "—",
      show: !!latestBw,
    },
    { label: "Photo", value: fmtDate(latestPhotoAt), show: !!latestPhotoAt },
    { label: "Video", value: fmtDate(latestVideoAt), show: !!latestVideoAt },
    { label: "Measurements", value: fmtDate(latestMeasAt), show: !!latestMeasAt },
  ];
  const anyRecent = recentRows.some((r) => r.show);

  const progressHubHref =
    progressHref.kind === "member"
      ? "/m/progress"
      : progressHref.kind === "portal"
      ? "/portal/progress"
      : `/admin/clients/${progressHref.clientId}/progress`;

  type SecondaryAction = { label: string; icon: ComponentType<{ className?: string }>; to: string };
  const secondary: SecondaryAction[] = [
    ...(liftHref ? [{ label: "Upload Lift", icon: Dumbbell, to: liftHref }] : []),
    ...(checkInHref ? [{ label: "Submit Check-In", icon: ClipboardCheck, to: checkInHref }] : []),
    { label: "View Progress Hub", icon: ArrowRight, to: progressHubHref },
  ];

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

        {/* Secondary quick actions */}
        {secondary.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {secondary.map((s) => {
              const Icon = s.icon;
              return (
                <Link
                  key={s.label}
                  to={s.to}
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/30 px-3 py-2 text-xs font-semibold transition hover:border-primary/40 hover:bg-secondary/50 active:bg-secondary/60"
                >
                  <Icon className="h-3.5 w-3.5 text-primary" />
                  <span>{s.label}</span>
                </Link>
              );
            })}
          </div>
        )}

        {/* Optional host-specific secondary tiles */}
        {extraActions ? <div>{extraActions}</div> : null}

        {/* Recent status pills */}
        {anyRecent ? (
          <div className="flex flex-wrap gap-2">
            {recentRows
              .filter((r) => r.show)
              .map((r) => (
                <span
                  key={r.label}
                  className="inline-flex items-baseline gap-1.5 rounded-full border border-border bg-secondary/20 px-2.5 py-1 text-xs"
                >
                  <span className="text-muted-foreground">{r.label}</span>
                  <span className="font-medium text-foreground">{r.value}</span>
                </span>
              ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No progress logged yet.</p>
        )}

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

