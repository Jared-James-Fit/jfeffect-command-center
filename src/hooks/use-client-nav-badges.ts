import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isUnread, useDirectThreads } from "@/lib/direct-chats";
import { isCrewUnread, useCrewThreads } from "@/lib/crew-chats";
import { useCommunityActivity } from "@/lib/community.queries";
import { useAuth } from "@/lib/auth";
import { useAdminNavBadgeCounts, adminBadgeMap } from "@/hooks/use-admin-nav-badges";
import { messagesBadgeCount, unreadGroupCount } from "@/lib/nav-badge-counts";
import { listenChannel } from "@/lib/realtime-channel";

export type NavBadge = { count?: number; dot?: boolean };

const LS_PREFIX = "jf-nav-seen";
const SEEN_EVENT = "jf-nav-seen";
const NAV_BADGE_REALTIME_DEBOUNCE_MS = 750;

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
 *  - /portal/messages       — one count: unread coach messages + lift-video feedback
 *                             + member 1:1s + crews + coach groups (never a bare dot)
 *  - /portal/program        — program/phase updated since client last opened (dot)
 *  - /portal/nutrition-targets — nutrition targets updated since client last opened (dot)
 *  - /portal/check-in       — coach feedback on check-in media, link updated, or due (dot)
 */
export function useClientNavBadges(): Record<string, NavBadge> {
  const { user, role, viewOnly } = useAuth();
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
    refetchInterval: 300_000,
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
      // Coach group chats (kind "group"); member 1:1s and crews come from their own lists.
      const { data: memberships } = await (supabase.from("chat_group_members") as any)
        .select("group_id, last_read_at, chat_groups!inner(kind, archived)")
        .eq("user_id", user!.id)
        .eq("chat_groups.kind", "group");
      const groupMemberships = ((memberships ?? []) as any[])
        .filter((m) => !m.chat_groups?.archived)
        .map((m) => ({ group_id: m.group_id as string, last_read_at: (m.last_read_at ?? null) as string | null }));
      let groupMsgs: any[] = [];
      if (groupMemberships.length) {
        const { data: gm } = await (supabase.from("group_messages") as any)
          .select("group_id, sender_id, created_at")
          .in("group_id", groupMemberships.map((m) => m.group_id))
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(200);
        groupMsgs = (gm ?? []) as any[];
      }
      return { client, msgs, state, vids, vcomments, nut, phases, mediaComments, groupMemberships, groupMsgs };
    },
  });

  useEffect(() => {
    const clientId = data?.client?.id;
    if (!enabled || !user || !clientId) return;

    let invalidationTimer: ReturnType<typeof setTimeout> | undefined;
    const invalidateBadges = () => {
      if (invalidationTimer) clearTimeout(invalidationTimer);
      invalidationTimer = setTimeout(() => {
        qc.invalidateQueries({ queryKey: ["client-nav-badges", user.id] });
      }, NAV_BADGE_REALTIME_DEBOUNCE_MS);
    };
    const scoped = { event: "*" as const, schema: "public", filter: `client_id=eq.${clientId}` };
    const ch = listenChannel(`nav-badges-${user.id}-${clientId}`)
      .on("postgres_changes", { ...scoped, table: "messages" }, invalidateBadges)
      .on("postgres_changes", { ...scoped, table: "conversation_state" }, invalidateBadges)
      .on("postgres_changes", { ...scoped, table: "lift_videos" }, invalidateBadges)
      .on("postgres_changes", { ...scoped, table: "lift_video_comments" }, invalidateBadges)
      .on("postgres_changes", { ...scoped, table: "media_comments" }, invalidateBadges)
      .on("postgres_changes", { ...scoped, table: "nutrition_targets" }, invalidateBadges)
      .on("postgres_changes", { ...scoped, table: "training_phases" }, invalidateBadges)
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_group_members", filter: `user_id=eq.${user.id}` }, invalidateBadges)
      .subscribe();
    return () => {
      if (invalidationTimer) clearTimeout(invalidationTimer);
      supabase.removeChannel(ch);
    };
  }, [data?.client?.id, enabled, user, qc]);

  // 1:1 chats and message requests from other members: a dot, like lift feedback.
  const { data: directs } = useDirectThreads(enabled);
  const { data: crews } = useCrewThreads(enabled);
  // New community posts since you last opened it (cleared server-side when you do).
  // Staff see the same count on their League button; a view-only login can't
  // clear it, so it gets none.
  const { data: community } = useCommunityActivity(enabled || (adminEnabled && !viewOnly));

  // Admin/coach nav badges — shared single source of truth
  const { data: adminCounts } = useAdminNavBadgeCounts(adminEnabled);

  if (adminEnabled) {
    const map = adminBadgeMap(adminCounts);
    if (!viewOnly && community?.enabled && community.unseen > 0) map["/admin/community"] = { count: community.unseen };
    return map;
  }

  if (!enabled || !data) return {};

  const result: Record<string, NavBadge> = {};

  // Messages: unread count
  const lastRead = data.state?.client_last_read_at ? new Date(data.state.client_last_read_at).getTime() : 0;
  const unread = (data.msgs ?? []).filter((m: any) => new Date(m.created_at).getTime() > lastRead).length;

  // Lift videos: one per video with coach feedback / comments the client hasn't seen
  const liftWithFeedback = new Set<string>();
  for (const v of (data.vids ?? []) as any[]) {
    const seen = v.client_last_viewed_at ? new Date(v.client_last_viewed_at).getTime() : 0;
    const newer = (t: string | null | undefined) => !!t && new Date(t).getTime() > seen;
    if (newer(v.watched_at) || newer(v.liked_at) || newer(v.reviewed_at) || (v.status === "Needs Follow-Up" && newer(v.updated_at))) {
      liftWithFeedback.add(v.id);
    }
  }
  {
    const vidMap = new Map<string, any>((data.vids ?? []).map((v: any) => [v.id, v]));
    for (const c of (data.vcomments ?? []) as any[]) {
      const v = vidMap.get(c.video_id);
      const seen = v?.client_last_viewed_at ? new Date(v.client_last_viewed_at).getTime() : 0;
      if (new Date(c.created_at).getTime() > seen) liftWithFeedback.add(c.video_id);
    }
  }
  const messagesCount = messagesBadgeCount({
    coachMessages: unread,
    liftFeedback: liftWithFeedback.size,
    directThreads: (directs ?? []).filter((t) => isUnread(t, user?.id)).length,
    crewThreads: (crews ?? []).filter((t) => isCrewUnread(t, user?.id)).length,
    groupThreads: user ? unreadGroupCount(data.groupMemberships ?? [], data.groupMsgs ?? [], user.id) : 0,
  });
  if (messagesCount > 0) result["/portal/messages"] = { count: messagesCount };

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

  if (community?.enabled && community.unseen > 0) result["/portal/community"] = { count: community.unseen };

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