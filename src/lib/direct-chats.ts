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
      if (action !== "accept") qc.invalidateQueries({ queryKey: ["group-messages"] });
    },
  });
}

/** Database messages → words a person would say. */
export function friendlyError(message: string) {
  if (/request_limit/.test(message)) return "You can send more once they reply.";
  if (/row-level security|violates/i.test(message)) return "That didn't send. Try again in a moment.";
  return message;
}
