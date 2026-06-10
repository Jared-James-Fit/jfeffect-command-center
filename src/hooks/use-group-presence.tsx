import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

export type GroupPresencePeer = {
  user_id: string;
  role: "admin" | "coach" | "client" | "member";
  at: number;
};

/** Realtime presence for a group chat. Each member joins `group-presence:{groupId}`. */
export function useGroupPresence(
  groupId: string | null | undefined,
  myRole: GroupPresencePeer["role"],
) {
  const { user } = useAuth();
  const [peers, setPeers] = useState<GroupPresencePeer[]>([]);

  useEffect(() => {
    if (!groupId || !user) {
      setPeers([]);
      return;
    }
    const channel = supabase.channel(`group-presence:${groupId}`, {
      config: {
        private: true,
        presence: { key: `${myRole}:${user.id}` },
      },
    });

    const recompute = () => {
      const state = channel.presenceState() as Record<string, Array<any>>;
      const list: GroupPresencePeer[] = [];
      for (const key of Object.keys(state)) {
        const arr = state[key] ?? [];
        for (const p of arr) {
          if (p?.user_id) {
            list.push({
              user_id: p.user_id,
              role: (p.role ?? "member") as GroupPresencePeer["role"],
              at: p.at ?? Date.now(),
            });
          }
        }
      }
      // dedupe by user_id
      const seen = new Set<string>();
      const unique = list.filter((p) => (seen.has(p.user_id) ? false : (seen.add(p.user_id), true)));
      setPeers(unique);
    };

    channel
      .on("presence", { event: "sync" }, recompute)
      .on("presence", { event: "join" }, recompute)
      .on("presence", { event: "leave" }, recompute)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          void channel.track({ role: myRole, user_id: user.id, at: Date.now() });
        }
      });

    return () => {
      try { void channel.untrack(); } catch {}
      supabase.removeChannel(channel);
      setPeers([]);
    };
  }, [groupId, myRole, user?.id]);

  const others = peers.filter((p) => p.user_id !== user?.id);
  return { peers, others, liveCount: others.length };
}