import type {
  RolloutState,
  VirtualAccount,
  VirtualSettings,
} from "@/lib/virtual-accounts/virtual-accounts.functions";

/**
 * The words the admin page uses for the gradual start (pure, tested in virtual-likes-rollout.test.ts).
 * The rule itself is the database's (virtual_rollout_state / virtual_accounts_rollout_step); this
 * only says it.
 */

const shortDay = (d: Date) =>
  d.toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "America/Winnipeg" });

export const fullName = (a: Pick<VirtualAccount, "first_name" | "last_name">) =>
  `${a.first_name}${a.last_name ? ` ${a.last_name}` : ""}`;

/** Whether it likes posts yet, in a few words. */
export function likeStateWords(
  a: Pick<VirtualAccount, "active" | "likes_enabled" | "likes_started_at" | "rollout_position">,
): string {
  if (!a.active) return "Inactive";
  if (a.likes_enabled)
    return a.likes_started_at ? `Liking since ${shortDay(new Date(a.likes_started_at))}` : "Liking";
  if (a.rollout_position != null) return `In the queue · #${a.rollout_position}`;
  return "Not liking";
}

/** When the next queued account starts, or what it's waiting for, in words. */
export function rolloutStatusWords(
  r: RolloutState | null,
  accounts: Pick<VirtualAccount, "user_id" | "first_name" | "last_name">[],
  s: Pick<VirtualSettings, "automation_enabled" | "rollout_enabled">,
  now: Date = new Date(),
): string {
  if (!s.automation_enabled)
    return "Paused: the global switch is off, so nobody likes anything and nobody new starts.";
  if (!s.rollout_enabled) return "Off: accounts in the queue wait until you switch this on.";
  if (!r || !r.next_user_id) return "Nobody's waiting. Everyone in the queue has started.";
  const next = accounts.find((a) => a.user_id === r.next_user_id);
  const who = next ? fullName(next) : "The next account";
  if (!r.last_started_at) return `${who} starts next, between 10 AM and 8 PM.`;
  const due = r.due_after ? new Date(r.due_after) : null;
  if (due && due > now) {
    const tail = r.needs_like ? ", once there's been a like since the last one started" : "";
    return `${who} starts next, from ${shortDay(due)} between 10 AM and 8 PM${tail}.`;
  }
  if (r.needs_like)
    return `${who} starts next, after the first like since the last one started (they only like members' posts).`;
  return `${who} starts next, today or tomorrow between 10 AM and 8 PM.`;
}
