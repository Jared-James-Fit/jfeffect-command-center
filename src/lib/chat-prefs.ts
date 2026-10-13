/**
 * Your own settings for each chat, iMessage style: Pin, Hide Alerts, Delete
 * (off your list until someone writes again) and Mark as Unread.
 * Stored in chat_thread_prefs (20261121090000_messenger_inbox_controls.sql):
 * only you can read or write your rows, so nobody can tell you pinned, muted
 * or deleted their chat. Mark as Unread never touches your read marker, so
 * the other side's "Seen" doesn't change either.
 *
 * Keys are the chat's id (chat_groups.id). The client's chat with their coach
 * is always pinned first and isn't stored here.
 */
import { useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { listenChannel } from "@/lib/realtime-channel";
import { friendlyError } from "@/lib/direct-chats";

const db = supabase as any;

/** Pins of your own, under the coach (9 in all, like iMessage). */
export const MAX_PINS = 8;

export type ChatPref = {
  thread_key: string;
  pinned_at: string | null;
  muted: boolean;
  hidden_at: string | null;
  unread_at: string | null;
};
export type ChatPrefPatch = Partial<Omit<ChatPref, "thread_key">>;
export type ChatPrefs = ReadonlyMap<string, ChatPref>;

export const chatPrefsKey = ["chat-thread-prefs"] as const;
const EMPTY: ChatPrefs = new Map();

export async function listChatPrefs(): Promise<ChatPref[]> {
  const { data, error } = await db
    .from("chat_thread_prefs")
    .select("thread_key, pinned_at, muted, hidden_at, unread_at");
  // Not there yet (or offline): every chat just has no settings.
  if (error) return [];
  return Array.isArray(data) ? (data as ChatPref[]) : [];
}

export function toPrefMap(rows: ChatPref[] | null | undefined): ChatPrefs {
  return new Map((rows ?? []).map((r) => [r.thread_key, r]));
}

export const isPinned = (prefs: ChatPrefs, key: string) => !!prefs.get(key)?.pinned_at;
export const isMuted = (prefs: ChatPrefs, key: string) => !!prefs.get(key)?.muted;
export const isMarkedUnread = (prefs: ChatPrefs, key: string) => !!prefs.get(key)?.unread_at;

/** Deleted from my list, and nobody has written since. */
export function isHidden(prefs: ChatPrefs, key: string, lastAt: string | null | undefined): boolean {
  const h = prefs.get(key)?.hidden_at;
  if (!h) return false;
  if (!lastAt) return true;
  return Date.parse(lastAt) <= Date.parse(h);
}

/** Pinned chats in the order they were pinned. */
export function pinnedKeys(prefs: ChatPrefs): string[] {
  return [...prefs.values()]
    .filter((p) => !!p.pinned_at)
    .sort((a, b) => Date.parse(a.pinned_at!) - Date.parse(b.pinned_at!))
    .map((p) => p.thread_key);
}

/** What "Delete" writes: off the list, and not pinned or marked unread any more. */
export function deletePatch(now = new Date().toISOString()): ChatPrefPatch {
  return { hidden_at: now, pinned_at: null, unread_at: null };
}

/**
 * My chat settings as a map. `live` (the Messages list) also listens for
 * changes made on my other devices; everything else shares the same cache,
 * which saves through useSetChatPrefs update straight away.
 */
export function useChatPrefs(enabled = true, { live = false }: { live?: boolean } = {}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const on = enabled && !!user;
  const q = useQuery({
    queryKey: chatPrefsKey,
    enabled: on,
    queryFn: listChatPrefs,
    staleTime: 60_000,
  });
  // Pins and mutes follow you across devices.
  useEffect(() => {
    if (!on || !live || !user) return;
    const ch = listenChannel(`chat-prefs-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_thread_prefs", filter: `user_id=eq.${user.id}` }, () => {
        qc.invalidateQueries({ queryKey: chatPrefsKey });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [on, live, user, qc]);
  const rows = on && Array.isArray(q.data) ? q.data : null;
  const prefs = useMemo(() => (rows ? toPrefMap(rows) : EMPTY), [rows]);
  return { prefs, isFetched: q.isFetched };
}

/** Change one or more chats' settings (shows immediately; undone if it doesn't save). */
export function useSetChatPrefs() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (changes: Array<{ key: string; patch: ChatPrefPatch }>) => {
      if (!user) throw new Error("Not signed in");
      const rows = changes.map(({ key, patch }) => ({ user_id: user.id, thread_key: key, ...patch }));
      const { error } = await db.from("chat_thread_prefs").upsert(rows, { onConflict: "user_id,thread_key" });
      if (error) throw new Error(friendlyError(error.message));
    },
    onMutate: async (changes) => {
      await qc.cancelQueries({ queryKey: chatPrefsKey });
      const prev = qc.getQueryData<ChatPref[]>(chatPrefsKey);
      const next = new Map((prev ?? []).map((r) => [r.thread_key, r]));
      for (const { key, patch } of changes) {
        const cur = next.get(key) ?? { thread_key: key, pinned_at: null, muted: false, hidden_at: null, unread_at: null };
        next.set(key, { ...cur, ...patch });
      }
      qc.setQueryData<ChatPref[]>(chatPrefsKey, [...next.values()]);
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx) qc.setQueryData(chatPrefsKey, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: chatPrefsKey });
    },
  });
}
