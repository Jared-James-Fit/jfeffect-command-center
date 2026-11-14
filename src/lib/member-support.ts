/**
 * Member support in the coach's Messages (pure, tested): a JF member's Support
 * chat as a row in 1:1 Chats. The rows come from `staff_support_threads()`;
 * the pane is src/components/support/member-support-pane.tsx and the server
 * side src/lib/member-support.functions.ts.
 */
import { newestFirst, timeOf } from "@/lib/recency";

/** One row of `staff_support_threads()`. */
export type SupportThreadRow = {
  thread_id: string;
  member_id: string;
  client_id: string | null;
  user_id: string | null;
  name: string | null;
  email: string | null;
  avatar: string | null;
  service_tier: string | null;
  status: string;
  unread_count: number | null;
  last_body: string | null;
  last_sender_role: string | null;
  last_at: string | null;
  ticket_number: number | null;
};

export type SupportChat = {
  threadId: string;
  clientId: string | null;
  name: string;
  email: string | null;
  avatar: string | null;
  preview: string;
  at: string | null;
  unread: number;
  /** Marked Done: under Archived until they write again (which reopens it). */
  done: boolean;
};

/** What the member's row says under their name. */
export const SUPPORT_LINE = "JF member · Support";

export function supportPreview(body: string | null | undefined, senderRole: string | null | undefined): string {
  const text = (body ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return senderRole && senderRole !== "member" ? `You: ${text}` : text;
}

export function supportChat(r: SupportThreadRow): SupportChat {
  return {
    threadId: r.thread_id,
    clientId: r.client_id,
    name: r.name?.trim() || r.email || "Member",
    email: r.email,
    avatar: r.avatar,
    preview: supportPreview(r.last_body, r.last_sender_role),
    at: r.last_at,
    unread: Math.max(0, r.unread_count ?? 0),
    done: r.status === "closed",
  };
}

/** Which inbox filters show a support chat: the Inbox while it's open, Archived once it's done. */
export function supportInFilter(c: SupportChat, filter: string): boolean {
  if (filter === "Archived") return c.done;
  if (filter === "Inbox") return !c.done;
  return false;
}

export function supportMatches(c: SupportChat, search: string): boolean {
  const s = search.trim().toLowerCase();
  if (!s) return true;
  return c.name.toLowerCase().includes(s) || (c.email ?? "").toLowerCase().includes(s);
}

/** Support chats with a new message from the member: what they add to the Messages badge and the Inbox chip. */
export function supportNewChats(chats: { unread: number; done: boolean }[]): number {
  return chats.filter((c) => c.unread > 0 && !c.done).length;
}

/**
 * The coach-chat rows and the support rows as one list, newest first (an
 * Instagram inbox): each list keeps its own order for ties.
 */
export function mergeByRecency<A, B>(
  chats: A[], chatAt: (a: A) => string | null | undefined,
  support: B[], supportAt: (b: B) => string | null | undefined,
): Array<{ kind: "chat"; item: A } | { kind: "support"; item: B }> {
  const out: Array<{ kind: "chat"; item: A } | { kind: "support"; item: B }> = [];
  let i = 0;
  let j = 0;
  const t = timeOf;
  while (i < chats.length || j < support.length) {
    if (j >= support.length) out.push({ kind: "chat", item: chats[i++] });
    else if (i >= chats.length) out.push({ kind: "support", item: support[j++] });
    else if (t(supportAt(support[j])) > t(chatAt(chats[i]))) out.push({ kind: "support", item: support[j++] });
    else out.push({ kind: "chat", item: chats[i++] });
  }
  return out;
}

/** Newest support chat first. */
export function sortSupportChats(chats: SupportChat[]): SupportChat[] {
  return [...chats].sort((a, b) => newestFirst(a.at, b.at));
}

/** A member's photo for the coach: their account photo, else the one on their member record. */
export function avatarFor(accountPhoto: string | null | undefined, memberPhoto: string | null | undefined): string | null {
  return (accountPhoto && accountPhoto.trim()) || (memberPhoto && memberPhoto.trim()) || null;
}
