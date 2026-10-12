/**
 * Who a text is "from": the client's assigned coach + the business name.
 *
 *   "Hi Bob, this is Jared from JF Effect. …"
 *
 * `{coach}` is the client's assigned coach's first name. Clients with no coach (and app
 * members) get the fallback name from SMS settings. `{brand}` is the business name. Both
 * are edited in Settings → SMS, so changing them changes every text at once.
 */

export type SmsCoachRow = {
  first_name?: string | null;
  full_name?: string | null;
  archived?: boolean | null;
  status?: string | null;
} | null | undefined;

/** Template tags every SMS template understands, in the order the editor shows them. */
export const SMS_TAGS = [
  { tag: "{first_name}", label: "Client first name", sample: "Alex" },
  { tag: "{coach}", label: "Their coach", sample: "Jared" },
  { tag: "{brand}", label: "Business name", sample: "JF Effect" },
  { tag: "{full_name}", label: "Client full name", sample: "Alex Sample" },
] as const;

/** First name of a coach row, or "" if they're archived / inactive / nameless. */
export function coachFirstName(co: SmsCoachRow): string {
  if (!co || co.archived || (co.status && co.status !== "Active")) return "";
  const first = (co.first_name ?? "").trim() || (co.full_name ?? "").trim().split(/\s+/)[0] || "";
  return first;
}

/** The assigned coach's first name, else the fallback from settings. */
export function resolveCoachName(co: SmsCoachRow, fallback: string | null | undefined): string {
  return coachFirstName(co) || (fallback ?? "").trim();
}

/** "Jared from JF Effect" — or whichever half exists. */
export function smsSender(coach: string | null | undefined, brand: string | null | undefined): string {
  const c = (coach ?? "").trim();
  const b = (brand ?? "").trim();
  if (c && b) return `${c} from ${b}`;
  return c || b || "your coach";
}

/**
 * Fill a template. With no coach name, "{coach} from {brand}" collapses to "{brand}" so a
 * text never reads "this is  from JF Effect".
 */
export function renderSmsTemplate(tpl: string, vars: Record<string, string | null | undefined>): string {
  const coach = (vars.coach ?? "").trim();
  const brand = (vars.brand ?? "").trim();
  let t = tpl;
  if (!coach) t = t.replace(/\{coach\}\s+(from|at|with)\s+/gi, "").replace(/\{coach\}/g, brand || "your coach");
  if (!brand) t = t.replace(/\s+(from|at|with)\s+\{brand\}/gi, "").replace(/\{brand\}/g, coach || "your coach");
  return t.replace(/\{(\w+)\}/g, (_, k) => (k === "coach" ? coach : k === "brand" ? brand : vars[k] ?? ""));
}

/** Tags a template uses that we don't know (typos like "{firstname}") — shown as a warning. */
export function unknownSmsTags(tpl: string, extra: string[] = []): string[] {
  const known = new Set<string>([...SMS_TAGS.map((t) => t.tag.slice(1, -1)), ...extra]);
  const found = Array.from(tpl.matchAll(/\{(\w+)\}/g)).map((m) => m[1]);
  return Array.from(new Set(found.filter((k) => !known.has(k))));
}

/** Rough SMS segment count (GSM-7: 160 / 153 per part; anything else: 70 / 67). */
export function smsSegments(text: string): number {
  if (!text) return 0;
  const gsm = /^[\x0A\x0D\x20-\x7E£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ¡ÄÖÑÜ§¿äöñüà€]*$/.test(text);
  const single = gsm ? 160 : 70;
  const multi = gsm ? 153 : 67;
  return text.length <= single ? 1 : Math.ceil(text.length / multi);
}

/** Supabase embed that pulls a client's assigned coach alongside the client row. */
export const CLIENT_COACH_EMBED = "coach:coaches!clients_assigned_coach_id_fkey(first_name, full_name, archived, status)";

/** Said wherever we send someone a link: a cold open can be slow, so they don't give up. */
export const LINK_HEADS_UP = "The link can take up to a minute to load.";

/** A link into our own app (jfeffect.com, or the lovable.app host), not Meet / YouTube etc. */
const APP_LINK = /https?:\/\/([a-z0-9-]+\.)*(jfeffect\.com|lovable\.app)(\/|\b)/i;

/**
 * Add the link heads-up to a text with a link into the app (once, before "Reply STOP…"
 * so the opt-out stays last). Plain ASCII, so it never tips a text into 70-char unicode
 * parts.
 */
export function withLinkHeadsUp(body: string): string {
  if (!APP_LINK.test(body) || body.includes(LINK_HEADS_UP)) return body;
  const stop = body.search(/\s*Reply STOP\b/i);
  if (stop === -1) return `${body.trimEnd()} ${LINK_HEADS_UP}`;
  return `${body.slice(0, stop).trimEnd()} ${LINK_HEADS_UP} ${body.slice(stop).trimStart()}`;
}
