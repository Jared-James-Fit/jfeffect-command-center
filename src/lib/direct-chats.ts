/**
 * Member-to-member chats, started by replying to a community post
 * (20261015090000_direct_message_requests.sql). They ride on the group chat
 * tables as chat_groups.kind = 'direct' and start as a message request the
 * other person previews before answering. Delete / Block are silent: the
 * sender's side keeps looking like a request that hasn't been answered.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import type { CommunityAuthor } from "@/lib/community";

const db = supabase as any;

export type DirectThread = {
  group_id: string;
  status: "request" | "active";
  /** A request to me that I haven't answered. */
  incoming: boolean;
  /** My request, not answered yet. */
  outgoing: boolean;
  other: CommunityAuthor;
  last: { body: string; created_at: string; sender_id: string | null; card: boolean; media: boolean } | null;
  last_at: string;
  read_at: string | null;
  /** My request: how many more messages it can take before they answer. */
  left: number | null;
};

export const directThreadsKey = ["direct-threads"] as const;

export async function listDirectThreads(): Promise<DirectThread[]> {
  const { data, error } = await db.rpc("chat_direct_threads");
  if (error) throw error;
  return Array.isArray(data) ? (data as DirectThread[]) : [];
}

/** New since I last looked (my own messages never count). */
export function isUnread(t: DirectThread, me: string | null | undefined) {
  if (!t.last || t.last.sender_id === me) return false;
  return !t.read_at || new Date(t.last.created_at).getTime() > new Date(t.read_at).getTime();
}

/** The list row's second line. Never empty. */
export function previewLine(t: DirectThread, me: string | null | undefined) {
  const l = t.last;
  if (!l) return "No messages yet";
  const text = l.body?.trim() || (l.card ? "Replied to a post" : l.media ? "Sent an attachment" : "Message");
  return l.sender_id === me ? `You: ${text}` : text;
}

export function useDirectThreads(enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: directThreadsKey,
    enabled: enabled && !!user,
    queryFn: listDirectThreads,
    staleTime: 15_000,
    refetchInterval: 45_000,
  });
}

export type MessageRoute =
  | { route: "direct"; group_id: string; message_id: string; status: "request" | "active" }
  | { route: "coach" | "client"; message_id: string; client_id: string };

/** Reply to a post in Messenger. The database decides where it goes. */
export function useMessageAuthor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ postId, body }: { postId: string; body: string }): Promise<MessageRoute> => {
      const { data, error } = await db.rpc("community_message_author", { _post_id: postId, _body: body });
      if (error) throw new Error(friendlyError(error.message));
      return data as MessageRoute;
    },
    onSuccess: (r) => {
      // Push it like any other message (never blocks the send).
      void (async () => {
        try {
          const ev = await import("@/lib/push/events.functions");
          if (r.route === "direct") await ev.notifyNewGroupMessage({ data: { messageId: r.message_id } });
          else await ev.notifyNewMessage({ data: { messageId: r.message_id } });
        } catch (e) {
          console.warn("[push] post reply push failed", e);
        }
      })();
      qc.invalidateQueries({ queryKey: directThreadsKey });
      qc.invalidateQueries({ queryKey: ["chat-groups"] });
      if (r.route !== "direct") qc.invalidateQueries({ queryKey: ["messages", r.client_id] });
    },
  });
}

export type RequestAction = "accept" | "decline" | "block" | "report";

export function useRespondToChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ groupId, action, reason }: { groupId: string; action: RequestAction; reason?: string }) => {
      const { data, error } = await db.rpc("chat_direct_respond", { _group_id: groupId, _action: action, _reason: reason ?? null });
      if (error) throw new Error(friendlyError(error.message));
      if (action === "report" && data?.report_id) {
        void (async () => {
          try {
            const { notifyChatReport } = await import("@/lib/push/events.functions");
            await notifyChatReport({ data: { reportId: data.report_id } });
          } catch (e) {
            console.warn("[push] report push failed", e);
          }
        })();
      }
      return data as { ok: boolean; report_id?: string };
    },
    onSuccess: (_d, { action }) => {
      qc.invalidateQueries({ queryKey: directThreadsKey });
      qc.invalidateQueries({ queryKey: ["chat-groups"] });
      qc.invalidateQueries({ queryKey: ["group-memberships"] });
      qc.invalidateQueries({ queryKey: ["group-unread"] });
      if (action === "block" || action === "report") qc.invalidateQueries({ queryKey: blockedPeopleKey });
      if (action !== "accept") qc.invalidateQueries({ queryKey: ["group-messages"] });
    },
  });
}

/**
 * "New message" to someone in the community (chat_direct_start). Same rules
 * as replying to their post: a request they read without you knowing, text
 * only, a few lines until they answer, and only so many new people a day.
 */
export function useStartDirect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, body }: { userId: string; body: string }) => {
      const { data, error } = await db.rpc("chat_direct_start", { _user_id: userId, _body: body });
      if (error) throw new Error(friendlyError(error.message));
      return data as { group_id: string; message_id: string; status: "request" | "active" };
    },
    onSuccess: (r) => {
      void (async () => {
        try {
          const ev = await import("@/lib/push/events.functions");
          await ev.notifyNewGroupMessage({ data: { messageId: r.message_id } });
        } catch (e) {
          console.warn("[push] new message push failed", e);
        }
      })();
      qc.invalidateQueries({ queryKey: ["group-messages", r.group_id] });
    },
  });
}

export type BlockedPerson = CommunityAuthor & { blocked_at: string };
export const blockedPeopleKey = ["chat-blocked-people"] as const;

/** People I've blocked. Only I can see this list. */
export function useBlockedPeople(enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: blockedPeopleKey,
    enabled: enabled && !!user,
    staleTime: 60_000,
    queryFn: async (): Promise<BlockedPerson[]> => {
      const { data, error } = await db.rpc("chat_blocked_people");
      if (error) return [];
      return Array.isArray(data) ? (data as BlockedPerson[]) : [];
    },
  });
}

/** Block (or unblock) a person: their messages and invites stop reaching me. They're never told. */
export function useBlockPerson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, blocked }: { userId: string; blocked: boolean }) => {
      const { error } = await db.rpc("chat_block_person", { _user_id: userId, _blocked: blocked });
      if (error) throw new Error(friendlyError(error.message));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: blockedPeopleKey });
      qc.invalidateQueries({ queryKey: directThreadsKey });
      qc.invalidateQueries({ queryKey: ["crew-threads"] });
    },
  });
}

/** Database messages → words a person would say. */
export function friendlyError(message: string) {
  if (/request_daily_limit/.test(message)) return "That's a lot of new people for one day. You can message more tomorrow.";
  if (/request_limit/.test(message)) return "You can send more once they reply.";
  if (/pin_limit/.test(message)) return "You can pin up to 8 chats. Unpin one first.";
  if (/row-level security|violates/i.test(message)) return "That didn't send. Try again in a moment.";
  return message;
}
