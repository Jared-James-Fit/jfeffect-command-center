import { useEffect } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { listenChannel } from "@/lib/realtime-channel";

/**
 * Single source of truth for admin/coach nav badge counts.
 * Every surface (bottom nav, sidebar, dropdowns, mobile menu) reads this one query.
 */
export const ADMIN_NAV_BADGES_KEY = ["admin-nav-badges"] as const;

export function invalidateAdminNavBadges(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: ADMIN_NAV_BADGES_KEY });
}

/** Optimistically nudge one badge field, then reconcile with the server. */
export function adjustAdminNavBadge(qc: QueryClient, field: keyof AdminBadgeCounts, delta: number) {
  qc.setQueriesData({ queryKey: ADMIN_NAV_BADGES_KEY }, (prev: any) => {
    if (!prev || typeof prev[field] !== "number") return prev;
    return { ...prev, [field]: Math.max(0, prev[field] + delta) };
  });
  return invalidateAdminNavBadges(qc);
}

export type AdminBadgeCounts = {
  /** Chats with a new message you haven't read (`messagesBadge`): clients' coach chats and members' Support chats. */
  messages: number;
  checkIns: number;
  /** App alerts not resolved (Communication → Alerts). */
  supportAlerts: number;
};

export type NavBadge = { count?: number; dot?: boolean };

export type InboxBadgeRow = { client_id: string; unread: boolean; archived: boolean };
/** A member's Support chat (member_support_threads). */
export type SupportBadgeRow = { id: string; unread_for_team: number | null; status: string };

/**
 * The Messages tab's number: how many chats have a new message from the
 * client you haven't read (or that you marked unread). The same chats carry
 * the blue dot in the inbox and are counted on its Inbox chip. A form sent
 * in or a check-in card is never "new message" (staff_inbox_state leaves
 * them out); archived chats don't count (a new message reopens one).
 */
export function messagesBadge(rows: InboxBadgeRow[], support: SupportBadgeRow[] = [], groups = 0): number {
  const chats = new Set<string>();
  for (const r of rows) if (r.unread && !r.archived) chats.add(r.client_id);
  // A JF member's Support chat with a message you haven't read is a new message
  // too (it's a row in 1:1 Chats). One marked Done is reopened by a new message.
  for (const t of support) if ((t.unread_for_team ?? 0) > 0 && t.status !== "closed") chats.add(`support:${t.id}`);
  // Coach-run group chats with a message from someone else since I read them
  // (the inbox's Unread chip counts the same groups).
  return chats.size + groups;
}

/** My coach-run groups (not archived) whose latest message is someone else's, after I last read them. */
export function unreadGroupCount(
  memberships: { group_id: string; last_read_at: string | null }[],
  latest: { group_id: string; created_at: string; sender_id: string | null }[],
  me: string,
): number {
  const readAt = new Map(memberships.map((m) => [m.group_id, m.last_read_at]));
  const seen = new Set<string>();
  let n = 0;
  for (const m of latest) {
    if (seen.has(m.group_id) || !readAt.has(m.group_id)) continue;
    seen.add(m.group_id);
    const read = readAt.get(m.group_id);
    if (m.sender_id !== me && new Date(m.created_at).getTime() > (read ? new Date(read).getTime() : 0)) n += 1;
  }
  return n;
}

export function useAdminNavBadgeCounts(enabledOverride?: boolean) {
  const { user, role } = useAuth();
  const qc = useQueryClient();
  const enabled = enabledOverride ?? (!!user && (role === "admin" || role === "coach"));

  const query = useQuery({
    queryKey: [...ADMIN_NAV_BADGES_KEY, user?.id],
    enabled,
    // badges must feel live: never serve stale, refresh on mount/focus/reconnect
    staleTime: 0,
    gcTime: 5 * 60_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchOnReconnect: "always",
    refetchInterval: 120_000,
    refetchIntervalInBackground: false,
    placeholderData: (prev) => prev, // keep last known count while refetching
    queryFn: async (): Promise<AdminBadgeCounts> => {
      const [inbox, mediaPending, supportAlerts, supportChats, myGroups, personal] = await Promise.all([
        // Per staff login: which chats have a new message from the client
        // (staff_inbox_state's `unread`: never a form sent in or a check-in card).
        (supabase as any).rpc("staff_inbox_state"),
        (supabase.from("media_items") as any)
          .select("id", { count: "exact", head: true })
          .eq("media_type", "Check-In Videos")
          .eq("status", "Pending Review"),
        (supabase.from("support_alerts") as any)
          .select("id", { count: "exact", head: true })
          .in("status", ["open", "in_progress"]),
        // Members' Support chats with a message nobody on the team has read.
        (supabase.from("member_support_threads") as any)
          .select("id, unread_for_team, status")
          .gt("unread_for_team", 0),
        // The coach-run groups I'm in (not archived), with when I last read each.
        (supabase.from("chat_group_members") as any)
          .select("group_id, last_read_at, chat_groups!inner(kind, archived)")
          .eq("user_id", user!.id)
          .eq("chat_groups.kind", "group")
          .eq("chat_groups.archived", false),
        (supabase as any).rpc("chat_direct_threads"),
      ]);
      const memberships = (myGroups.data ?? []) as { group_id: string; last_read_at: string | null }[];
      let groups = 0;
      if (memberships.length) {
        const { data: latest } = await (supabase.from("group_messages") as any)
          .select("group_id, created_at, sender_id")
          .in("group_id", memberships.map((m) => m.group_id))
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(200);
        groups = unreadGroupCount(memberships, latest ?? [], user!.id);
      }
      return {
        messages: messagesBadge((inbox.data ?? []) as InboxBadgeRow[], (supportChats.data ?? []) as SupportBadgeRow[], groups)
          + (Array.isArray(personal.data) ? personal.data.filter((t: any) => t.last && t.last.sender_id !== user!.id && (!t.read_at || new Date(t.last.created_at).getTime() > new Date(t.read_at).getTime())).length : 0),
        checkIns: mediaPending.count ?? 0,
        supportAlerts: supportAlerts.count ?? 0,
      };
    },
  });

  // Targeted realtime on exactly the tables the counts read from.
  useEffect(() => {
    if (!enabled || !user) return;
    const bump = () => invalidateAdminNavBadges(qc);
    const ch = listenChannel(`admin-nav-badges-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_state" }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_staff_reads" }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "media_items" }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "support_alerts" }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "member_support_threads" }, bump)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "group_messages" }, bump)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chat_group_members" }, bump)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [enabled, user, qc]);

  // App resume / tab focus: never trust counts from before backgrounding.
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => {
      if (document.visibilityState === "visible") invalidateAdminNavBadges(qc);
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
    };
  }, [enabled, qc]);

  return query;
}

export function adminBadgeMap(counts: AdminBadgeCounts | undefined): Record<string, NavBadge> {
  const r: Record<string, NavBadge> = {};
  if (!counts) return r;
  // New messages only (Instagram's): forms, check-ins and what's waiting on
  // you live in the inbox's filters and the line under each name.
  if (counts.messages > 0) r["/admin/messages"] = { count: counts.messages };
  if (counts.checkIns > 0) r["/admin/check-ins"] = { count: counts.checkIns };
  if (counts.supportAlerts > 0) r["/admin/support-alerts"] = { count: counts.supportAlerts };
  return r;
}
