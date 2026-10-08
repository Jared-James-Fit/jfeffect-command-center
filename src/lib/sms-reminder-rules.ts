/**
 * Pure rules for the "you have an unread message" text sweep (runReminderSweep).
 *
 * The sweep used to look back 30 days and text once per unread message, at any
 * hour. After downtime that meant a burst of texts about weeks-old messages.
 * These rules keep it to what the steps are actually for.
 */

const DEFAULT_TZ = "America/Winnipeg";
export const SMS_SEND_FROM_HOUR = 9;
export const SMS_SEND_UNTIL_HOUR = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ReminderStep = { delay_minutes: number; enabled?: boolean };

/** How far back an unread message can still earn a text: the longest step plus a day of slack. */
export function reminderLookbackMs(steps: ReminderStep[]): number {
  const longest = Math.max(0, ...steps.filter((s) => s.enabled !== false).map((s) => s.delay_minutes));
  return longest * 60_000 + DAY_MS;
}

function localHour(tz: string, at: Date): number {
  const fmt = (zone: string) =>
    Number(new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", hourCycle: "h23" }).format(at)) % 24;
  try { return fmt(tz); } catch { return fmt(DEFAULT_TZ); }
}

/** Texts only go out 9am to 8pm in the client's timezone (America/Winnipeg when unknown). */
export function inSmsSendWindow(tz: string | null | undefined, at: Date = new Date()): boolean {
  const h = localHour(tz || DEFAULT_TZ, at);
  return h >= SMS_SEND_FROM_HOUR && h < SMS_SEND_UNTIL_HOUR;
}

/**
 * One anchor per client: their OLDEST unread message in the window. The steps
 * (24h, 48h, ...) are measured from it, so several unread messages never mean
 * several texts.
 */
export function pickAnchorMessages<T extends { client_id: string; created_at: string }>(messages: T[]): T[] {
  const byClient = new Map<string, T>();
  for (const m of messages) {
    const cur = byClient.get(m.client_id);
    if (!cur || new Date(m.created_at).getTime() < new Date(cur.created_at).getTime()) byClient.set(m.client_id, m);
  }
  return [...byClient.values()].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

/** At most one reminder text per client per 24 hours, whatever the messages. */
export const SMS_CLIENT_COOLDOWN_MS = DAY_MS;
