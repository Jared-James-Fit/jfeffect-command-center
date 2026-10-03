import { useEffect } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

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
  messages: number;
  liftReviews: number;
  liftUrgent: number;
  checkIns: number;
  supportAlerts: number;
};

export type NavBadge = { count?: number; dot?: boolean };

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
      const [clientMessages, liftPending, liftUrgent, mediaPending, supportAlerts] = await Promise.all([
        // Conversations that need *me*: Needs Response or new inbound activity I
        // haven't seen. Outbound/automated reminders never count.
        (supabase as any).rpc("staff_inbox_state"),
        (supabase.from("lift_videos") as any)
          .select("client_id")
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
        (supabase.from("support_alerts") as any)
          .select("id", { count: "exact", head: true })
          .in("status", ["open", "in_progress"]),
      ]);
      return {
        messages: new Set<string>([
          ...((clientMessages.data ?? []) as any[])
            .filter((r) => !r.archived && (r.workflow_status === "needs_response" || r.unread))
            .map((r) => r.client_id as string),
          ...((liftPending.data ?? []) as any[]).map((r) => r.client_id as string),
        ]).size,
        liftReviews: (liftPending.data ?? []).length,
        liftUrgent: liftUrgent.count ?? 0,
        checkIns: mediaPending.count ?? 0,
        supportAlerts: supportAlerts.count ?? 0,
      };
    },
  });

  // Targeted realtime on exactly the tables the counts read from.
  useEffect(() => {
    if (!enabled || !user) return;
    const bump = () => invalidateAdminNavBadges(qc);
    const ch = supabase.channel(`admin-nav-badges-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_state" }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_staff_reads" }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "lift_videos" }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "media_items" }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "support_alerts" }, bump)
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
  // One unit: conversations needing coach attention (lift reviews are already
  // folded into `messages` as conversations, never double-counted).
  const messageAttention = counts.messages;
  if (messageAttention > 0) {
    r["/admin/messages"] = { count: messageAttention };
  } else if (counts.liftUrgent > 0) {
    r["/admin/messages"] = { dot: true };
  }
  if (counts.checkIns > 0) r["/admin/check-ins"] = { count: counts.checkIns };
  if (counts.supportAlerts > 0) r["/admin/support-alerts"] = { count: counts.supportAlerts };
  return r;
}
