/**
 * A subscribable iCalendar feed (RFC 5545). Google Calendar, Apple Calendar and
 * Outlook poll the URL and keep the client's sessions in their own calendar.
 */

export type FeedEvent = {
  uid: string;
  start: Date;
  end: Date;
  /** yyyy-mm-dd for an all-day event (start/end are then ignored). */
  allDayDate?: string | null;
  summary: string;
  location?: string | null;
  description?: string | null;
  url?: string | null;
  cancelled?: boolean;
  lastModified?: Date | null;
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function icsUtc(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function icsDate(dateISO: string): string {
  return dateISO.replace(/-/g, "");
}

function nextDay(dateISO: string): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

export function icsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Lines longer than 75 octets are folded with CRLF + space, per RFC 5545 3.1. */
export function foldLine(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let current = "";
  let currentBytes = 0;
  for (const ch of line) {
    const b = new TextEncoder().encode(ch).length;
    const limit = out.length === 0 ? 75 : 74;
    if (currentBytes + b > limit) {
      out.push(current);
      current = "";
      currentBytes = 0;
    }
    current += ch;
    currentBytes += b;
  }
  out.push(current);
  return out.join("\r\n ");
}

export function buildIcsFeed(opts: { name: string; events: FeedEvent[]; now?: Date }): string {
  const stamp = icsUtc(opts.now ?? new Date());
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//JF Effect//Schedule//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(opts.name)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const e of opts.events) {
    lines.push("BEGIN:VEVENT", `UID:${e.uid}`, `DTSTAMP:${stamp}`);
    if (e.allDayDate) {
      // A training day, not an appointment: all-day and "free", so it never
      // blocks time or rings an alarm at midnight.
      lines.push(
        `DTSTART;VALUE=DATE:${icsDate(e.allDayDate)}`,
        `DTEND;VALUE=DATE:${icsDate(nextDay(e.allDayDate))}`,
        "TRANSP:TRANSPARENT",
      );
    } else {
      lines.push(`DTSTART:${icsUtc(e.start)}`, `DTEND:${icsUtc(e.end)}`);
    }
    lines.push(`SUMMARY:${icsEscape(e.summary)}`);
    if (e.location) lines.push(`LOCATION:${icsEscape(e.location)}`);
    if (e.description) lines.push(`DESCRIPTION:${icsEscape(e.description)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    if (e.lastModified) lines.push(`LAST-MODIFIED:${icsUtc(e.lastModified)}`);
    lines.push(`STATUS:${e.cancelled ? "CANCELLED" : "CONFIRMED"}`);
    if (!e.cancelled && !e.allDayDate) {
      // One phone alert an hour before. Calendar apps own this alert, so it
      // costs nothing and never adds to the texts.
      lines.push("BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Reminder", "TRIGGER:-PT1H", "END:VALARM");
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
