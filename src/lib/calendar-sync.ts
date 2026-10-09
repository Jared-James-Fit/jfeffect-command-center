/**
 * Calendar sync status rules (pure, tested). The Setup card turns green only
 * when a real calendar app has pulled the client's private feed recently.
 */

export type CalendarApp = "Google Calendar" | "Apple Calendar" | "Outlook" | "Calendar app";

/**
 * Which calendar app fetched the feed, from its User-Agent. Browsers,
 * link-preview bots and developer tools (someone opening, sharing or testing
 * the link) return null, so they never count as "synced". Anything else
 * fetching a private feed link is a calendar app, even one we don't know by
 * name (iCloud, Fantastical, ICSx5...): a working sync must never stay grey.
 */
export function calendarAppFromUserAgent(ua: string | null | undefined): CalendarApp | null {
  const s = (ua ?? "").trim();
  if (!s) return null;
  if (/google-?calendar|googlecalendar/i.test(s)) return "Google Calendar";
  // Apple's system daemons all send "iOS/18.0 (22A3354) dataaccessd/1.0"-style agents.
  if (
    /dataaccessd|CalendarAgent|\biCal\/|accountsd|remindd|icloud/i.test(s) ||
    /^(iOS|iPadOS|macOS|OS X|watchOS|visionOS)\/\d/i.test(s)
  ) {
    return "Apple Calendar";
  }
  if (/outlook|microsoft office|exchange/i.test(s)) return "Outlook";
  if (/bot|preview|facebookexternalhit|whatsapp|telegram|slack|discord|crawler|spider|unfurl/i.test(s)) return null;
  if (/calendar|caldav|ical/i.test(s)) return "Calendar app";
  if (/^Mozilla\//i.test(s)) return null; // a browser
  if (/^(curl|wget|python|aiohttp|axios|node|undici|go-http|java|libwww|httpie|postman|insomnia|pg_net)/i.test(s)) return null;
  return "Calendar app";
}

export type DevicePlatform = "ios" | "android" | "mac" | "windows" | "other";

/** iPadOS reports a Mac user agent; the touch screen gives it away. */
export function devicePlatform(ua: string | null | undefined, maxTouchPoints = 0): DevicePlatform {
  const s = ua ?? "";
  if (/Android/i.test(s)) return "android";
  if (/iPhone|iPad|iPod/i.test(s)) return "ios";
  if (/Macintosh|Mac OS X/i.test(s)) return maxTouchPoints > 1 ? "ios" : "mac";
  if (/Windows/i.test(s)) return "windows";
  return "other";
}

export type CalendarChoice = {
  id: "apple" | "google" | "outlook";
  label: CalendarApp;
  hint: string;
  /**
   * subscribe: one tap (webcal link, the device asks "Subscribe?").
   * link: opens the provider's own "add calendar" page (works on a computer).
   * web: the provider's phone app can't add a calendar from a link at all
   *   (Google, Outlook), so the client gets the steps that do work: send the
   *   link to a computer, or use the provider's desktop site on the phone.
   */
  how: "subscribe" | "link" | "web";
};

/** The calendars worth offering on this device, the one it most likely uses first. */
export function calendarChoices(p: DevicePlatform): CalendarChoice[] {
  const phone = p === "ios" || p === "android";
  const apple: CalendarChoice = {
    id: "apple",
    label: "Apple Calendar",
    hint: p === "ios" ? "One tap, updates fastest" : "iPhone, iPad, Mac",
    how: "subscribe",
  };
  const google: CalendarChoice = {
    id: "google",
    label: "Google Calendar",
    hint: phone ? "One-time step on the web" : "Gmail, Android",
    how: phone ? "web" : "link",
  };
  const outlook: CalendarChoice = {
    id: "outlook",
    label: "Outlook",
    hint: phone ? "One-time step on the web" : "Outlook.com, Hotmail",
    how: phone ? "web" : "link",
  };
  if (p === "ios" || p === "mac") return [apple, google, outlook];
  if (p === "android") return [google, outlook];
  return [google, outlook, apple];
}

/** Card copy while waiting for the first fetch, by the calendar the client picked. */
export function connectingMessage(app: string | null | undefined): string {
  if (app === "Apple Calendar") return "Tap Subscribe when your phone asks. This turns green as soon as it checks in.";
  if (app === "Google Calendar") return "Finish on Google's website. This turns green a few minutes after you tap Add.";
  if (app === "Outlook") return "Finish on Outlook's website. This turns green once Outlook checks in.";
  return "Waiting for your calendar app to check in.";
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
