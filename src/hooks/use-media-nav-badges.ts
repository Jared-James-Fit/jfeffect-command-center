import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import type { NavBadge } from "./use-client-nav-badges";

/**
 * Media Manager sidebar count badges.
 *
 * Surfaces counts beside three high-signal Daily-Work routes when real data
 * exists. No fake numbers — if the underlying table is empty the badge is
 * omitted entirely.
 *
 *   /media/work        — open tasks scoped to `tasks.scope = 'media'`
 *   /media/inbox       — pending Media Manager broadcast drafts in review
 *   /media/publishing  — content records marked scheduled / approved
 */
export function useMediaNavBadges(): Record<string, NavBadge> {
  const { user, role } = useAuth();
  const qc = useQueryClient();
  const enabled = !!user && (role === "admin" || role === "media_manager");

  const { data } = useQuery({
    queryKey: ["media-nav-badges", user?.id],
    enabled,
    refetchInterval: 300_000,
    queryFn: async () => {
      const [work, inbox, publishing] = await Promise.all([
        (supabase.from("tasks") as any)
          .select("id", { count: "exact", head: true })
          .eq("scope", "media")
          .eq("status", "open"),
        (supabase.from("broadcasts") as any)
          .select("id", { count: "exact", head: true })
          .in("status", ["in_review", "pending_review", "needs_review"]),
        (supabase.from("media_content_records") as any)
          .select("id", { count: "exact", head: true })
          .in("production_status", ["scheduled", "approved"])
          .eq("archived", false),
      ]);
      return {
        work: work.count ?? 0,
        inbox: inbox.count ?? 0,
        publishing: publishing.count ?? 0,
      };
    },
  });

  useEffect(() => {
    if (!enabled || !user) return;
    const ch = supabase
      .channel(`media-nav-badges-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" },
        () => qc.invalidateQueries({ queryKey: ["media-nav-badges", user.id] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "media_content_records" },
        () => qc.invalidateQueries({ queryKey: ["media-nav-badges", user.id] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [enabled, user, qc]);

  if (!enabled || !data) return {};
  const r: Record<string, NavBadge> = {};
  if (data.work > 0) r["/media/work"] = { count: data.work };
  if (data.inbox > 0) r["/media/inbox"] = { count: data.inbox };
  if (data.publishing > 0) r["/media/publishing"] = { count: data.publishing };
  return r;
}