// Instagram-style "Seen by" for group chats.
//
// Built entirely on chat_group_members.last_read_at (one timestamp per member,
// bumped when they have the group open). A member has seen a message when
// their last_read_at is at or after the message's created_at.

export type ReadMember = { user_id: string; last_read_at: string | null };

export type SeenEntry = { user_id: string; seen_at: string };

export type SeenState = {
  /** Most recent reader first. */
  seen: SeenEntry[];
  notSeen: string[];
};

/**
 * Who has / hasn't seen `message`. The sender and the person looking are left
 * out: you don't need to be told you've seen your own screen.
 */
export function seenStateFor(
  message: { created_at: string; sender_id: string | null },
  members: ReadMember[],
  viewerId: string | null | undefined,
): SeenState {
  const sentAt = new Date(message.created_at).getTime();
  const seen: SeenEntry[] = [];
  const notSeen: string[] = [];
  for (const m of members) {
    if (!m.user_id || m.user_id === message.sender_id || m.user_id === viewerId) continue;
    const readAt = m.last_read_at ? new Date(m.last_read_at).getTime() : NaN;
    if (Number.isFinite(readAt) && readAt >= sentAt) seen.push({ user_id: m.user_id, seen_at: m.last_read_at! });
    else notSeen.push(m.user_id);
  }
  seen.sort((a, b) => new Date(b.seen_at).getTime() - new Date(a.seen_at).getTime());
  return { seen, notSeen };
}

/** "Seen by Jen", "Seen by Jen and Alex", "Seen by Jen, Alex +3", "Seen by everyone". */
export function seenSummary(state: SeenState, nameFor: (userId: string) => string): string | null {
  const n = state.seen.length;
  if (n === 0) return null;
  if (state.notSeen.length === 0 && n > 2) return "Seen by everyone";
  const first = (id: string) => nameFor(id).trim().split(/\s+/)[0] || "Member";
  if (n === 1) return `Seen by ${first(state.seen[0].user_id)}`;
  if (n === 2) return `Seen by ${first(state.seen[0].user_id)} and ${first(state.seen[1].user_id)}`;
  return `Seen by ${first(state.seen[0].user_id)}, ${first(state.seen[1].user_id)} +${n - 2}`;
}

/**
 * Timestamp to store when marking a group read. Uses the newest loaded
 * message time as a floor, so a phone clock running behind the server can't
 * record a read that appears to predate the message it just displayed.
 */
export function readStampFor(latestMessageCreatedAt: string | null | undefined, now = new Date()): string {
  const latest = latestMessageCreatedAt ? new Date(latestMessageCreatedAt).getTime() : NaN;
  const t = Number.isFinite(latest) ? Math.max(now.getTime(), latest) : now.getTime();
  return new Date(t).toISOString();
}
