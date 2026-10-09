/**
 * The client's Messages tab badge, as one number.
 *
 * It used to be a count for unread coach messages plus a bare red dot for
 * everything else (lift-video feedback, member 1:1s and crews). A dot with no
 * number doesn't say what's waiting or how much, and a stale cached thread list
 * could leave one lit with nothing unread (Jared McIntyre, Oct 2026). Every
 * source is now counted, so the tab shows exactly how many things are waiting.
 */
export type MessagesBadgeSources = {
  /** Unread messages from the coach in the 1:1 coaching thread. */
  coachMessages: number;
  /** Lift videos with coach feedback the client hasn't opened. */
  liftFeedback: number;
  /** Member 1:1 chats / requests with something new. */
  directThreads: number;
  /** Crew chats with something new (or an unopened invite). */
  crewThreads: number;
  /** Coach group chats with something new. */
  groupThreads: number;
};

export function messagesBadgeCount(s: MessagesBadgeSources): number {
  const n = (v: number) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
  return n(s.coachMessages) + n(s.liftFeedback) + n(s.directThreads) + n(s.crewThreads) + n(s.groupThreads);
}

/** Number of coach groups with a message from someone else newer than my last read. */
export function unreadGroupCount(
  memberships: { group_id: string; last_read_at: string | null }[],
  messages: { group_id: string; sender_id: string | null; created_at: string }[],
  me: string,
): number {
  const lastRead = new Map(memberships.map((m) => [m.group_id, m.last_read_at ? Date.parse(m.last_read_at) : 0]));
  const unread = new Set<string>();
  for (const msg of messages) {
    if (!lastRead.has(msg.group_id) || msg.sender_id === me) continue;
    if (Date.parse(msg.created_at) > (lastRead.get(msg.group_id) ?? 0)) unread.add(msg.group_id);
  }
  return unread.size;
}
