import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

export type NavBadge = { count?: number; dot?: boolean };

const LS_PREFIX = "jf-nav-seen";
const SEEN_EVENT = "jf-nav-seen";

function seenKey(userId: string, route: string) {
  return `${LS_PREFIX}:${userId}:${route}`;
}

export function getLastSeen(userId: string | undefined, route: string): number {
  if (!userId) return 0;
  try {
    return Number(localStorage.getItem(seenKey(userId, route))) || 0;
  } catch {
    return 0;
  }
}

export function markNavSeen(userId: string | undefined, route: string) {
  if (!userId) return;
  try {
    localStorage.setItem(seenKey(userId, route), String(Date.now()));
  } catch {}
  try {
    window.dispatchEvent(new CustomEvent(SEEN_EVENT, { detail: { route } }));
  } catch {}
}

/**
 * Returns badge state per portal route. Only fetches data for clients.
 * Badge rules (kept minimal to avoid notification overload):
 *  - /portal/messages       — unread coach messages (count)
 *  - /portal/lift-videos    — coach feedback/comments on a lift video (dot)
 *  - /portal/program        — program/phase updated since client last opened (dot)
 *  - /portal/nutrition-targets — nutrition targets updated since client last opened (dot)
 *  - /portal/check-in       — coach feedback on check-in media, link updated, or due (dot)
 */
export function useClientNavBadges(): Record<string, NavBadge> {
  const { user, role } = useAuth();
  const qc = useQueryClient();
  const [, setTick] = useState(0);

  useEffect(() => {
    const handler = () => setTick((t) => t + 1);
    window.addEventListener(SEEN_EVENT, handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener(SEEN_EVENT, handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  const enabled = !!user && role === "client";
  const adminEnabled = !!user && (role === "admin" || role === "coach");

  const { data } = useQuery({
    queryKey: ["client-nav-badges", user?.id],
    enabled,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data: client } = await supabase
        .from("clients")
        .select("id, last_program_update, checkin_due_day, checkin_link_updated_at")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (!client) return null;
      const [{ data: msgs }, { data: state }, { data: vids }, { data: vcomments }, { data: nut }, { data: phases }, { data: mediaComments }] = await Promise.all([
        (supabase.from("messages") as any).select("created_at").eq("client_id", client.id).eq("sender_role", "admin").eq("is_internal_note", false).order("created_at", { ascending: false }).limit(50),
        (supabase.from("conversation_state") as any).select("client_last_read_at").eq("client_id", client.id).maybeSingle(),
        (supabase.from("lift_videos") as any).select("id, watched_at, liked_at, reviewed_at, status, client_last_viewed_at, updated_at").eq("client_id", client.id).order("updated_at", { ascending: false }).limit(50),
        (supabase.from("lift_video_comments") as any).select("video_id, created_at").eq("client_id", client.id).eq("author_role", "admin").eq("is_internal_note", false).order("created_at", { ascending: false }).limit(50),
        (supabase.from("nutrition_targets") as any).select("updated_at, last_updated_at").eq("client_id", client.id).order("updated_at", { ascending: false }).limit(5),
        (supabase.from("training_phases") as any).select("updated_at").eq("client_id", client.id).order("updated_at", { ascending: false }).limit(5),
        (supabase.from("media_comments") as any).select("created_at, author_role, is_internal_note").eq("client_id", client.id).eq("author_role", "admin").eq("is_internal_note", false).order("created_at", { ascending: false }).limit(20),
      ]);
      return { client, msgs, state, vids, vcomments, nut, phases, mediaComments };
    },
  });

  useEffect(() => {
    if (!enabled || !user) return;
    const ch = supabase.channel(`nav-badges-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => qc.invalidateQueries({ queryKey: ["client-nav-badges", user.id] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_state" }, () => qc.invalidateQueries({ queryKey: ["client-nav-badges", user.id] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "lift_videos" }, () => qc.invalidateQueries({ queryKey: ["client-nav-badges", user.id] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "lift_video_comments" }, () => qc.invalidateQueries({ queryKey: ["client-nav-badges", user.id] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "media_comments" }, () => qc.invalidateQueries({ queryKey: ["client-nav-badges", user.id] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "nutrition_targets" }, () => qc.invalidateQueries({ queryKey: ["client-nav-badges", user.id] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "training_phases" }, () => qc.invalidateQueries({ queryKey: ["client-nav-badges", user.id] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [enabled, user, qc]);

  // Admin/coach nav badges
  const { data: adminData } = useQuery({
    queryKey: ["admin-nav-badges", user?.id],
    enabled: adminEnabled,
    refetchInterval: 30_000,
    queryFn: async () => {
      const [needsResp, liftPending, liftUrgent, mediaPending, supportAlerts] = await Promise.all([
        (supabase.from("conversation_state") as any)
          .select("client_id", { count: "exact", head: true })
          .eq("status", "needs_response"),
        (supabase.from("lift_videos") as any)
          .select("id", { count: "exact", head: true })
          .in("status", ["New Upload", "Awaiting Review"]),
        (supabase.from("lift_videos") as any)
          .select("id", { count: "exact", head: true })
          .eq("is_urgent", true)
          .neq("status", "Archived")
          .neq("status", "Reviewed"),
        (supabase.from("media_items") as any)
          .select("id", { count: "exact", head: true })
          .eq("media_type", "Check-In Videos")
          .eq("status", "Pending Review"),
        (supabase.from("support_alerts") as any).select("id", { count: "exact", head: true }).in("status", ["open", "in_progress"]),
      ]);
      return {
        messages: needsResp.count ?? 0,
        liftReviews: liftPending.count ?? 0,
        liftUrgent: liftUrgent.count ?? 0,
        checkIns: mediaPending.count ?? 0,
        supportAlerts: supportAlerts.count ?? 0,
      };
    },
  });

  useEffect(() => {
    if (!adminEnabled || !user) return;
    const ch = supabase.channel(`admin-nav-badges-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_state" }, () => qc.invalidateQueries({ queryKey: ["admin-nav-badges", user.id] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "lift_videos" }, () => qc.invalidateQueries({ queryKey: ["admin-nav-badges", user.id] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "media_items" }, () => qc.invalidateQueries({ queryKey: ["admin-nav-badges", user.id] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "support_alerts" }, () => qc.invalidateQueries({ queryKey: ["admin-nav-badges", user.id] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [adminEnabled, user, qc]);

  if (adminEnabled && adminData) {
    const r: Record<string, NavBadge> = {};
    if (adminData.messages > 0) r["/admin/messages"] = { count: adminData.messages };
    if (adminData.liftReviews > 0) r["/admin/lift-videos"] = { count: adminData.liftReviews };
    else if (adminData.liftUrgent > 0) r["/admin/lift-videos"] = { dot: true };
    if (adminData.checkIns > 0) r["/admin/check-ins"] = { count: adminData.checkIns };
    if (adminData.supportAlerts > 0) r["/admin/support-alerts"] = { count: adminData.supportAlerts };
    return r;
  }

  if (!enabled || !data) return {};

  const result: Record<string, NavBadge> = {};

  // Messages: unread count
  const lastRead = data.state?.client_last_read_at ? new Date(data.state.client_last_read_at).getTime() : 0;
  const unread = (data.msgs ?? []).filter((m: any) => new Date(m.created_at).getTime() > lastRead).length;
  if (unread > 0) result["/portal/messages"] = { count: unread };

  // Lift videos: coach feedback / comments newer than client_last_viewed_at
  let liftDot = false;
  for (const v of (data.vids ?? []) as any[]) {
    const seen = v.client_last_viewed_at ? new Date(v.client_last_viewed_at).getTime() : 0;
    if (v.watched_at && new Date(v.watched_at).getTime() > seen) { liftDot = true; break; }
    if (v.liked_at && new Date(v.liked_at).getTime() > seen) { liftDot = true; break; }
    if (v.reviewed_at && new Date(v.reviewed_at).getTime() > seen) { liftDot = true; break; }
    if (v.status === "Needs Follow-Up" && new Date(v.updated_at).getTime() > seen) { liftDot = true; break; }
  }
  if (!liftDot) {
    const vidMap = new Map<string, any>((data.vids ?? []).map((v: any) => [v.id, v]));
    for (const c of (data.vcomments ?? []) as any[]) {
      const v = vidMap.get(c.video_id);
      const seen = v?.client_last_viewed_at ? new Date(v.client_last_viewed_at).getTime() : 0;
      if (new Date(c.created_at).getTime() > seen) { liftDot = true; break; }
    }
  }
  if (liftDot) result["/portal/lift-videos"] = { dot: true };

  // Program/phase updates now surface on the Workouts tab
  const programSeen = getLastSeen(user?.id, "/portal/workouts");
  const programTimes = [
    data.client.last_program_update ? new Date(data.client.last_program_update).getTime() : 0,
    ...((data.phases ?? []) as any[]).map((p) => new Date(p.updated_at).getTime()),
  ];
  const programLatest = Math.max(0, ...programTimes);
  if (programLatest > 0 && programLatest > programSeen) result["/portal/workouts"] = { dot: true };

  // Nutrition targets: dot if targets updated since last viewed
  const nutSeen = getLastSeen(user?.id, "/portal/nutrition-targets");
  const nutLatest = Math.max(
    0,
    ...((data.nut ?? []) as any[]).map((n) => Math.max(
      n.updated_at ? new Date(n.updated_at).getTime() : 0,
      n.last_updated_at ? new Date(n.last_updated_at).getTime() : 0,
    )),
  );
  if (nutLatest > 0 && nutLatest > nutSeen) result["/portal/nutrition-targets"] = { dot: true };

  // Weekly check-in: dot for coach feedback, link updated, or weekly due reminder
  const ciSeen = getLastSeen(user?.id, "/portal/check-in");
  let ciDot = false;
  const ciFeedbackLatest = Math.max(0, ...((data.mediaComments ?? []) as any[]).map((c) => new Date(c.created_at).getTime()));
  if (ciFeedbackLatest > ciSeen) ciDot = true;
  if (data.client.checkin_link_updated_at && new Date(data.client.checkin_link_updated_at).getTime() > ciSeen) ciDot = true;
  if (!ciDot && data.client.checkin_due_day && (Date.now() - ciSeen) > 6 * 24 * 60 * 60 * 1000) ciDot = true;
  if (ciDot) result["/portal/check-in"] = { dot: true };

  return result;
}