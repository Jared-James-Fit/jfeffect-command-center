/**
 * JF Effect Support as a queue in the coach's Messages (Nov 25 2026): the
 * Support filter's chips, Needs Me first. One reading of where a chat stands,
 * from who handles it and who wrote last, for the chips, their counts and the
 * line on each row. Pure and tested (support-cleo.test.ts).
 */
import { CATEGORY_LABEL, type Escalation } from "./rules";

export type SupportQueueFilter = "needs_me" | "unread" | "waiting" | "cleo" | "resolved" | "all";
export type SupportQueueState = "needs_me" | "waiting" | "cleo" | "resolved";

export const SUPPORT_QUEUE_FILTERS: Array<[SupportQueueFilter, string]> = [
  ["needs_me", "Needs Me"],
  ["unread", "Unread"],
  ["waiting", "Waiting on Member"],
  ["cleo", "Cleo Handling"],
  ["resolved", "Resolved"],
  ["all", "All"],
];
export const SUPPORT_QUEUE_DEFAULT: SupportQueueFilter = "needs_me";

export const SUPPORT_QUEUE_HELP: Record<SupportQueueFilter, string> = {
  needs_me: "Support chats Cleo handed to you, or that you took over, where they're waiting on your reply.",
  unread: "Support chats with a message from them you haven't read.",
  waiting: "Support chats you answered, now waiting on them.",
  cleo: "Cleo is answering these from the help answers. Nothing here notifies you; take one over any time.",
  resolved: "Resolved Support chats. A new message from them goes back to Cleo first.",
  all: "Every Support chat, newest first.",
};

export type QueueChat = {
  done: boolean;
  handler?: string | null;
  lastSenderRole?: string | null;
  unread: number;
};

/** Where a Support chat stands. A chat with no handler on record (before Cleo) is a person's. */
export function supportQueueState(c: QueueChat): SupportQueueState {
  if (c.done) return "resolved";
  if (c.handler === "cleo") return "cleo";
  // a person has it: their move or ours (Cleo's hand-off message is ours to answer)
  return c.lastSenderRole === "team" ? "waiting" : "needs_me";
}

export function inSupportQueue(c: QueueChat, f: SupportQueueFilter): boolean {
  if (f === "all") return true;
  if (f === "unread") return !c.done && c.unread > 0;
  return supportQueueState(c) === f;
}

export function supportQueueCounts(chats: QueueChat[]): Record<SupportQueueFilter, number> {
  const out = { needs_me: 0, unread: 0, waiting: 0, cleo: 0, resolved: 0, all: chats.length } as Record<SupportQueueFilter, number>;
  for (const c of chats) {
    out[supportQueueState(c)] += 1;
    if (!c.done && c.unread > 0) out.unread += 1;
  }
  return out;
}

/** The status on a row: why it's here, in a few words. */
export function supportStateLine(c: QueueChat & { escalation?: Escalation | null }): string {
  const s = supportQueueState(c);
  if (s === "cleo") return "Cleo handling";
  if (s === "resolved") return "Resolved";
  if (s === "waiting") return "Waiting on them";
  const esc = c.escalation;
  if (!esc) return "Needs you";
  return `Needs you · ${CATEGORY_LABEL[esc.category] ?? "Handed off"}${esc.priority === "high" ? " · High" : ""}`;
}
