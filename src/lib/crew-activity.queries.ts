import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { fetchCommunityNotices } from "@/lib/community-notifications";
import { signCommunityPaths } from "@/lib/community-media";
import { ACTIVITY_PREVIEW_STATE, type ActivityItem } from "@/lib/crew-activity";

export const crewActivityKey = (userId: string | null | undefined) => ["notifications", "crew-activity", userId ?? null] as const;

/**
 * The crew's activity on you, with what's unread. Under the bell's
 * "notifications" key, so whatever refreshes the bell (realtime, marking
 * read) refreshes this too.
 */
export function useCrewActivity(enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: crewActivityKey(user?.id),
    enabled: enabled && !!user,
    staleTime: 30_000,
    // back from another app (or the phone's lock screen): anything new since? It's what the heart's bubble shows
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<ActivityItem[]> => {
      const notices = await fetchCommunityNotices();
      if (!notices.length || !user) return [];
      const { data: states } = await (supabase.from("notification_state") as any)
        .select("source_id, read_at")
        .eq("user_id", user.id)
        .eq("kind", "community")
        .in("source_id", [...new Set(notices.map((n) => n.anchor))]);
      const readAt = new Map<string, number>();
      for (const s of (states ?? []) as { source_id: string; read_at: string | null }[]) {
        if (s.read_at) readAt.set(s.source_id, Date.parse(s.read_at));
      }
      // same rule as the bell: read only covers what had happened when it was read
      return notices.map((n) => ({ ...n, unread: !((readAt.get(n.anchor) ?? 0) >= Date.parse(n.at)) }));
    },
  });
}

/** Mark lines read (the bell's notification_state), then refresh the bell and this. */
export function useMarkCrewActivityRead() {
  const qc = useQueryClient();
  return async (items: Pick<ActivityItem, "anchor">[]) => {
    if (!items.length) return;
    const pairs = [...new Set(items.map((i) => i.anchor))].map((source_id) => ({ kind: "community", source_id }));
    const { error } = await (supabase.rpc as any)("notif_mark_read", { items: pairs });
    if (!error) void qc.invalidateQueries({ queryKey: ["notifications"] });
  };
}

/**
 * The heart's bubble showed: note it on the server (every phone stops replaying
 * it) and zero what's "fresh" here without a refetch. The unread dot stays
 * until Activity is actually read.
 */
export function useMarkActivityPreviewed() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useCallback(() => {
    qc.setQueryData<ActivityItem[]>(crewActivityKey(user?.id), (prev) => prev?.map((i) => (i.fresh ? { ...i, fresh: 0 } : i)));
    void (supabase.rpc as any)("notif_mark_read", { items: [ACTIVITY_PREVIEW_STATE] });
  }, [qc, user?.id]);
}

/** The thumbnails beside the lines: one storage call for all of them. */
export function useActivityThumbs(paths: (string | null | undefined)[]) {
  const list = [...new Set(paths.filter((p): p is string => !!p))];
  const key = list.join("|");
  const { data } = useQuery({
    queryKey: ["community-media-urls", key],
    enabled: key.length > 0,
    staleTime: 45 * 60 * 1000,
    queryFn: () => signCommunityPaths(list),
  });
  return data ?? {};
}
