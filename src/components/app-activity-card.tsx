import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Circle, Clock, MapPin, LogIn } from "lucide-react";
import { formatDistanceToNow, parseISO, format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";

type Props = {
  clientId: string;
  lastSignedInAt: string | null | undefined;
  lastActiveAt: string | null | undefined;
  lastActiveRoute: string | null | undefined;
  complianceStatus?: string | null;
};

type ActivityRow = {
  id: string;
  action: string;
  created_at: string;
  details: Record<string, any> | null;
};

/** Live presence + last action card shown on the admin/coach client profile.
 *  Falls back gracefully when the client has never signed in. */
export function AppActivityCard({ clientId, lastSignedInAt, lastActiveAt, lastActiveRoute, complianceStatus }: Props) {
  const [recent, setRecent] = useState<ActivityRow | null>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      const { data } = await supabase
        .from("client_activity_log")
        .select("id, action, created_at, details")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false })
        .limit(1);
      if (!cancel) setRecent((data?.[0] as any) ?? null);
    })();
    return () => { cancel = true; };
  }, [clientId]);

  const presence = derivePresence(lastActiveAt, lastSignedInAt);

  return (
    <Card className="border-border bg-card p-6 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs uppercase tracking-widest text-muted-foreground">App Activity</h3>
        <Badge variant="outline" className={presence.tone}>
          <Circle className={`mr-1 h-2 w-2 ${presence.dot}`} fill="currentColor" /> {presence.label}
        </Badge>
      </div>

      <dl className="grid grid-cols-2 gap-y-1.5 text-xs">
        <dt className="text-muted-foreground inline-flex items-center gap-1"><LogIn className="h-3 w-3" /> Last signed in</dt>
        <dd className="font-medium">{formatRelative(lastSignedInAt)}</dd>

        <dt className="text-muted-foreground inline-flex items-center gap-1"><Clock className="h-3 w-3" /> Last active</dt>
        <dd className="font-medium">{formatRelative(lastActiveAt)}</dd>

        {lastActiveRoute && (
          <>
            <dt className="text-muted-foreground inline-flex items-center gap-1"><MapPin className="h-3 w-3" /> Last viewed</dt>
            <dd className="font-medium truncate" title={lastActiveRoute}>{prettyRoute(lastActiveRoute)}</dd>
          </>
        )}
      </dl>

      {recent && (
        <div className="rounded-md border border-border bg-secondary/30 p-2.5">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Most recent action</div>
          <div className="mt-0.5 text-sm">
            {prettyAction(recent.action)}{" "}
            <span className="text-xs text-muted-foreground">· {formatRelative(recent.created_at)}</span>
          </div>
        </div>
      )}

      {complianceStatus && (
        <div className="flex items-center justify-between pt-1">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Compliance</div>
          <Badge variant="outline" className={complianceTone(complianceStatus)}>{complianceStatus}</Badge>
        </div>
      )}
    </Card>
  );
}

function derivePresence(lastActive: string | null | undefined, lastSignedIn: string | null | undefined) {
  if (!lastSignedIn && !lastActive) {
    return { label: "Never signed in", tone: "border-muted-foreground/40 bg-muted text-muted-foreground", dot: "text-muted-foreground" };
  }
  if (!lastActive) {
    return { label: "Inactive", tone: "border-muted-foreground/40 bg-muted text-muted-foreground", dot: "text-muted-foreground" };
  }
  const diffMs = Date.now() - new Date(lastActive).getTime();
  const min = diffMs / 60000;
  if (min < 5) return { label: "Online now", tone: "border-emerald-500/40 bg-emerald-500/10 text-emerald-500", dot: "text-emerald-500" };
  if (min < 60 * 24) return { label: "Active today", tone: "border-blue-500/40 bg-blue-500/10 text-blue-400", dot: "text-blue-400" };
  const days = Math.floor(min / (60 * 24));
  if (days < 7) return { label: `Active ${days}d ago`, tone: "border-blue-500/30 bg-blue-500/5 text-blue-300", dot: "text-blue-300" };
  if (days < 14) return { label: `Inactive ${days}d`, tone: "border-amber-500/40 bg-amber-500/10 text-amber-400", dot: "text-amber-400" };
  return { label: `Inactive ${days}d`, tone: "border-rose-500/40 bg-rose-500/10 text-rose-400", dot: "text-rose-400" };
}

function complianceTone(status: string) {
  switch (status) {
    case "On Track": return "border-emerald-500/40 bg-emerald-500/10 text-emerald-500";
    case "Watch": return "border-amber-500/40 bg-amber-500/10 text-amber-400";
    case "Needs Follow-Up": return "border-orange-500/40 bg-orange-500/10 text-orange-400";
    case "Non-Compliant": return "border-rose-500/40 bg-rose-500/10 text-rose-400";
    case "Paused": return "border-muted-foreground/40 bg-muted text-muted-foreground";
    default: return "border-border";
  }
}

function formatRelative(ts: string | null | undefined): string {
  if (!ts) return "Never";
  try {
    const d = parseISO(ts);
    const diff = Date.now() - d.getTime();
    if (diff < 60_000) return "Just now";
    if (diff < 24 * 60 * 60 * 1000) return formatDistanceToNow(d, { addSuffix: true });
    return `${format(d, "MMM d")} · ${formatDistanceToNow(d, { addSuffix: true })}`;
  } catch {
    return "Never";
  }
}

function prettyRoute(path: string): string {
  const map: Record<string, string> = {
    "/portal": "Home",
    "/portal/program": "Program",
    "/portal/lift-videos": "Lift Videos",
    "/portal/messages": "Messages",
    "/portal/check-in": "Check-In",
    "/portal/progress-metrics": "Progress Metrics",
    "/portal/media": "Media",
    "/portal/calendar": "Calendar",
    "/portal/agreements": "Agreements",
    "/portal/purchases": "Purchases",
    "/portal/documents": "Documents",
    "/portal/account": "Account",
    "/portal/nutrition-targets": "Nutrition",
    "/portal/exercises": "Exercises",
    "/portal/resources": "Resources",
  };
  return map[path] ?? (path.replace(/^\/portal\/?/, "").replace(/-/g, " ") || "Home");
}

function prettyAction(action: string): string {
  const map: Record<string, string> = {
    signed_in: "Signed in",
    bodyweight_logged: "Logged bodyweight",
    bodyweight_goal_set: "Set bodyweight goal",
    bodyweight_goal_reached: "Reached bodyweight goal",
    lift_video_uploaded: "Uploaded lift video",
    message_sent: "Sent a message",
    check_in_submitted: "Submitted check-in",
    progress_metric_logged: "Logged progress metric",
    agreement_signed: "Signed agreement",
    payment_completed: "Payment completed",
    profile_updated: "Updated profile",
  };
  return map[action] ?? action.replace(/_/g, " ");
}