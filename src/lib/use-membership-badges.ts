import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Membership badges for screens that list people without author cards (League, Hall, chats):
 * every id a screen asks for in the same moment goes in one `community_badges` call (≤ 200), and
 * each answer is cached a few minutes. A failed lookup shows no badge, never a wrong one.
 */
export type BadgeLookup = { badge: string | null; virtual: boolean; is_coach: boolean };

type Waiter = { resolve: (v: BadgeLookup | null) => void };
let queue = new Map<string, Waiter[]>();
let timer: ReturnType<typeof setTimeout> | null = null;

async function flush() {
  const batch = queue;
  queue = new Map();
  timer = null;
  const ids = [...batch.keys()];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    let rows: Array<{ user_id: string; badge: string | null; is_virtual: boolean; is_coach: boolean }> = [];
    try {
      const { data, error } = await (supabase as any).rpc("community_badges", { _ids: chunk });
      if (!error) rows = (data ?? []) as typeof rows;
    } catch {
      rows = [];
    }
    const byId = new Map(rows.map((r) => [r.user_id, r]));
    for (const id of chunk) {
      const r = byId.get(id);
      const v = r ? { badge: r.badge, virtual: !!r.is_virtual, is_coach: !!r.is_coach } : null;
      for (const w of batch.get(id) ?? []) w.resolve(v);
    }
  }
}

export function lookupBadge(userId: string): Promise<BadgeLookup | null> {
  return new Promise((resolve) => {
    const list = queue.get(userId) ?? [];
    list.push({ resolve });
    queue.set(userId, list);
    if (!timer) timer = setTimeout(() => void flush(), 15);
  });
}

export function useMembershipBadge(userId: string | null | undefined): BadgeLookup | null {
  const { data } = useQuery({
    queryKey: ["membership-badge", userId],
    enabled: !!userId,
    queryFn: () => lookupBadge(userId!),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });
  return data ?? null;
}
