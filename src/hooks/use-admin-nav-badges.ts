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
export function messagesBadge(rows: InboxBadgeRow[], support: SupportBadgeRow[] = []): number {
  const chats = new Set<string>();
  for (const r of rows) if (r.unread && !r.archived) chats.add(r.client_id);
  // A JF member's Support chat with a message you haven't read is a new message
  // too (it's a row in 1:1 Chats). One marked Done is reopened by a new message.
  for (const t of support) if ((t.unread_for_team ?? 0) > 0 && t.status !== "closed") chats.add(`support:${t.id}`);
  return chats.size;
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
      const [inbox, mediaPending, supportAlerts, supportChats] = await Promise.all([
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
      ]);
      return {
        messages: messagesBadge((inbox.data ?? []) as InboxBadgeRow[], (supportChats.data ?? []) as SupportBadgeRow[]),
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
