/**
 * Calendar sync status rules (pure, tested). The Setup card turns green only
 * when a real calendar app has pulled the client's private feed recently.
 */

export type CalendarApp = "Google Calendar" | "Apple Calendar" | "Outlook" | "Calendar app";

/**
 * Which calendar app fetched the feed, from its User-Agent. Browsers and
 * link-preview bots (someone opening or sharing the link) return null, so they
 * never count as "synced".
 */
export function calendarAppFromUserAgent(ua: string | null | undefined): CalendarApp | null {
  const s = (ua ?? "").trim();
  if (!s) return null;
  if (/google-?calendar|googlecalendar/i.test(s)) return "Google Calendar";
  if (/dataaccessd|CalendarAgent|iCal\/|accountsd|remindd/i.test(s)) return "Apple Calendar";
  if (/outlook|microsoft office|exchange/i.test(s)) return "Outlook";
  if (/bot|preview|facebookexternalhit|whatsapp|telegram|slack|discord|crawler|spider/i.test(s)) return null;
  if (/calendar|caldav|ical/i.test(s)) return "Calendar app";
  return null;
}

/** Calendar apps refresh subscribed feeds every few hours to once a day or so. */
export const SYNC_FRESH_MS = 14 * 24 * 60 * 60 * 1000;
/** After tapping "add", Google can take a while to make its first fetch. */
export const CONNECTING_WINDOW_MS = 2 * 60 * 60 * 1000;

export type CalendarSyncState = "synced" | "connecting" | "stale" | "off";

export function calendarSyncState(opts: {
  lastFetchAt: string | null | undefined;
  /** When this device last tapped a Google/Apple button (local only). */
  startedAt?: number | null;
  now?: number;
}): CalendarSyncState {
  const now = opts.now ?? Date.now();
  const last = opts.lastFetchAt ? new Date(opts.lastFetchAt).getTime() : null;
  if (last && now - last <= SYNC_FRESH_MS) return "synced";
  if (opts.startedAt && now - opts.startedAt <= CONNECTING_WINDOW_MS && (!last || last < opts.startedAt)) {
    return "connecting";
  }
  if (last) return "stale";
  return "off";
}

export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
