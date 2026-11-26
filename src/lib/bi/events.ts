/**
 * The analytics event catalog (Business intelligence, Nov 25 2026). Pure, used by the browser that
 * sends an event and the server that stores it (pulse.server.ts → bi_pulse_extras), so a name or a
 * field nobody listed here can never reach the database.
 *
 * Most of what the business wants to know is already in the records each feature keeps (a workout
 * finished, a check-in sent, a payment): the reports read those, never a copy. Events are only for
 * what leaves no record: how fast a page was, an error a person hit, a request that failed, a page
 * that wasn't found. Each carries a short label, an optional number and a rating, and the page as a
 * path with ids taken out (pulse-rules.ts normalizePath). Never: anything typed, a name, an email,
 * a message, a health or payment detail, a full URL or a query string.
 *
 * Add a new event by adding it here (and to the database's check, bi_event_names()), with the one
 * rule for its label.
 */

export const BI_EVENT_NAMES = ["web_vital", "js_error", "request_failed", "page_not_found"] as const;
export type BiEventName = (typeof BI_EVENT_NAMES)[number];

export const VITALS = ["LCP", "INP", "CLS", "FCP", "TTFB"] as const;
export type Vital = (typeof VITALS)[number];

/** Google's published thresholds (web.dev): good at or under the first, poor over the second. */
export const VITAL_THRESHOLDS: Record<Vital, [number, number]> = {
  LCP: [2500, 4000],
  INP: [200, 500],
  CLS: [0.1, 0.25],
  FCP: [1800, 3000],
  TTFB: [800, 1800],
};

export const VITAL_LABEL: Record<Vital, string> = {
  LCP: "Largest content shown",
  INP: "Response to taps",
  CLS: "Layout shift",
  FCP: "First content shown",
  TTFB: "Server response",
};

export type VitalRating = "good" | "ni" | "poor";

export function rateVital(name: Vital, value: number): VitalRating {
  const [good, poor] = VITAL_THRESHOLDS[name];
  if (!Number.isFinite(value) || value <= good) return "good";
  return value > poor ? "poor" : "ni";
}

/** Request failures as the loading system names them (lib/loading/load-state.ts loadErrorKind). */
export const FAILURE_KINDS = ["offline", "network", "timeout", "session", "forbidden", "not_found", "rate", "server", "other"] as const;
export type FailureKind = (typeof FAILURE_KINDS)[number];

export type BiEvent = {
  /** a random id made on the device, so a re-sent beat never stores an event twice */
  id: string;
  name: BiEventName;
  label: string;
  value: number | null;
  rating: string | null;
  path: string;
  feature: string;
  at: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An error message with anything that could be personal taken out: addresses, emails, numbers of 3+
 * digits, ids, quoted text and tokens. "Cannot read properties of undefined (reading 'map')" stays
 * as it is; "No client 9f1c… for jane@x.com" becomes "No client :id for :email".
 */
export function cleanErrorLabel(raw: unknown): string {
  let s = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "Unknown error";
  s = s
    .replace(/https?:\/\/\S+/gi, ":url")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, ":email")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id")
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, ":token")
    .replace(/"[^"]{0,200}"/g, '":text"')
    .replace(/\d{3,}/g, ":n");
  return s.slice(0, 120);
}

/** A query key's first part as an area ("client-billing"), letters, digits and dashes only. */
export function cleanArea(raw: unknown): string {
  const s = String(raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s || "unknown";
}

function cleanPath(raw: unknown): string {
  const s = String(raw ?? "/").split(/[?#]/)[0].slice(0, 200);
  return s.startsWith("/") ? s : "/";
}

/**
 * One event, checked and cut to what the catalog allows; null when it isn't one. The browser and
 * the server both run it, so a tampered request can't store anything the browser wouldn't.
 */
export function cleanEvent(raw: unknown): BiEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const name = String(r.name ?? "") as BiEventName;
  if (!(BI_EVENT_NAMES as readonly string[]).includes(name)) return null;
  const id = String(r.id ?? "");
  if (!UUID.test(id)) return null;
  const path = cleanPath(r.path);
  const feature = String(r.feature ?? "Other").slice(0, 60) || "Other";
  let at = new Date(String(r.at ?? ""));
  if (Number.isNaN(at.getTime())) at = new Date();
  let label = "";
  let value: number | null = null;
  let rating: string | null = null;
  const num = Number(r.value);
  switch (name) {
    case "web_vital": {
      const v = String(r.label ?? "").toUpperCase() as Vital;
      if (!(VITALS as readonly string[]).includes(v)) return null;
      if (!Number.isFinite(num) || num < 0 || num > (v === "CLS" ? 50 : 120_000)) return null;
      label = v;
      value = v === "CLS" ? Math.round(num * 1000) / 1000 : Math.round(num);
      rating = rateVital(v, value);
      break;
    }
    case "js_error":
      label = cleanErrorLabel(r.label);
      break;
    case "request_failed": {
      label = cleanArea(r.label);
      const k = String(r.rating ?? "other");
      rating = (FAILURE_KINDS as readonly string[]).includes(k) ? k : "other";
      break;
    }
    case "page_not_found":
      label = path;
      break;
  }
  return { id, name, label, value, rating, path, feature, at: at.toISOString() };
}

/** At most this many events ride one beat, and one visit stores at most EVENTS_PER_VISIT. */
export const EVENTS_PER_BEAT = 30;
export const EVENTS_PER_VISIT = 200;
