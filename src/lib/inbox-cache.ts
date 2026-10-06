// Keeps the admin inbox's "last messages" list current from realtime events,
// instead of re-downloading ~1,000 recent messages after every change.
//
// The inbox derives each row's preview, time, ordering and unread dot from
// this list (newest first). A realtime message event already carries the full
// row, so we can patch the list in place the moment it arrives.

import type { Message } from "@/lib/messages";

/** Columns the inbox actually reads; trimming keeps cache entries small. */
export const INBOX_MESSAGE_COLUMNS =
  "id, client_id, body, sender_role, created_at, read_by_admin_at, read_by_client_at, is_automated, is_internal_note, message_type, attachments";

const KEYS = [
  "id", "client_id", "body", "sender_role", "created_at", "read_by_admin_at", "read_by_client_at",
  "is_automated", "is_internal_note", "message_type", "attachments",
] as const;

const MAX_ROWS = 2000;

/** Same visibility rule as the inbox query: delivered, non-internal. */
export function belongsInInbox(row: Partial<Message> | null | undefined): row is Message {
  if (!row || !row.id || !row.client_id || !row.created_at) return false;
  if (row.is_internal_note) return false;
  const s = (row as any).delivery_status;
  return s === undefined || s === null || s === "sent" || s === "sending";
}

function slim(row: Message): Message {
  const out: Record<string, unknown> = {};
  for (const k of KEYS) out[k] = (row as any)[k];
  // Optimistic rows carry delivery_status for the thread; harmless to keep off the inbox copy.
  return out as unknown as Message;
}

/** Insert or replace `row` keeping the list newest-first. */
export function upsertRow(list: Message[], row: Message): Message[] {
  const next = list.filter((m) => m.id !== row.id);
  const t = new Date(row.created_at).getTime();
  let i = 0;
  while (i < next.length && new Date(next[i].created_at).getTime() > t) i++;
  next.splice(i, 0, slim(row));
  return next.length > MAX_ROWS ? next.slice(0, MAX_ROWS) : next;
}

export type MessageChange = {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new?: Partial<Message> | null;
  old?: Partial<Message> | null;
};

/**
 * Apply one realtime `messages` change. Returns the same array when nothing
 * relevant changed (so React Query doesn't re-render for nothing).
 */
export function applyMessageChange(prev: Message[] | undefined, change: MessageChange): Message[] | undefined {
  if (!prev) return prev; // nothing loaded yet: the first fetch will include it
  if (change.eventType === "DELETE") {
    const id = change.old?.id;
    if (!id || !prev.some((m) => m.id === id)) return prev;
    return prev.filter((m) => m.id !== id);
  }
  const row = change.new;
  if (!row?.id) return prev;
  if (!belongsInInbox(row)) {
    // e.g. became an internal note: it must leave the list.
    return prev.some((m) => m.id === row.id) ? prev.filter((m) => m.id !== row.id) : prev;
  }
  return upsertRow(prev, row);
}

/** The optimistic temp row gives way to the saved one (or disappears if the send failed). */
export function resolveOptimistic(prev: Message[] | undefined, tempId: string, saved: Message | null): Message[] | undefined {
  if (!prev) return prev;
  const without = prev.filter((m) => m.id !== tempId);
  return saved && belongsInInbox(saved) ? upsertRow(without, saved) : without;
}
