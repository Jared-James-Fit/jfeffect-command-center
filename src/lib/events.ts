import { differenceInCalendarDays, parseISO, format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";

export const EVENT_TYPES = [
  "Competition","Powerlifting Meet","Bodybuilding Show","Photoshoot","Testing Day",
  "Weigh-In","Travel","Appointment","Coaching Call","Deadline","Gym Event","Custom",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_IMPORTANCE = ["Low","Medium","High","Critical"] as const;
export type EventImportance = (typeof EVENT_IMPORTANCE)[number];

export const EVENT_STATUSES = ["Draft","Active","Completed","Archived"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const EVENT_LINK_TYPES = [
  "Event Website","Registration Link","Schedule","Rules / Info Package","Athlete Roster",
  "Livestream","Location / Map","Hotel / Travel","Weigh-In Info","Payment Link","Google Meet","Custom",
] as const;
export type EventLinkType = (typeof EVENT_LINK_TYPES)[number];

export const AUDIENCE_SCOPES = ["selected_clients","all_coaching","app_members","program_only"] as const;
export type AudienceScope = (typeof AUDIENCE_SCOPES)[number];

export const REMINDER_OFFSETS = [
  { key: "w12", label: "12 weeks out", days: 84 },
  { key: "w8",  label: "8 weeks out",  days: 56 },
  { key: "w4",  label: "4 weeks out",  days: 28 },
  { key: "w2",  label: "2 weeks out",  days: 14 },
  { key: "w1",  label: "1 week out",   days: 7  },
  { key: "d3",  label: "3 days out",   days: 3  },
  { key: "d1",  label: "1 day out",    days: 1  },
  { key: "day_of", label: "Day of event", days: 0 },
] as const;
export type ReminderOffsetKey = (typeof REMINDER_OFFSETS)[number]["key"];

export interface EventRow {
  id: string;
  name: string;
  event_type: EventType;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  timezone: string | null;
  location: string | null;
  description: string | null;
  client_facing_notes: string | null;
  internal_notes: string | null;
  importance: EventImportance;
  status: EventStatus;
  audience_scope: AudienceScope;
  created_by: string | null;
  archived_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuickLink {
  id: string;
  event_id: string;
  title: string;
  url: string;
  link_type: EventLinkType;
  visible_to_client: boolean;
  internal_note: string | null;
  sort_order: number;
}

export interface Deadline {
  id: string;
  event_id: string;
  title: string;
  due_date: string | null;
  notes: string | null;
  visible_to_client: boolean;
  sort_order: number;
}

export interface Reminder {
  id: string;
  event_id: string;
  offset_key: ReminderOffsetKey;
  enabled: boolean;
  message: string | null;
  visible_to_client: boolean;
}

/* ---------------- countdown ---------------- */

export interface Countdown {
  label: string;
  daysRemaining: number;
  weeksRemaining: number;
  tone: "default" | "soon" | "imminent" | "today" | "past";
  isPast: boolean;
}

export function computeCountdown(eventDate: string, today = new Date()): Countdown {
  const target = parseISO(eventDate);
  const days = differenceInCalendarDays(target, today);
  if (days < 0)  return { label: "Completed", daysRemaining: days, weeksRemaining: 0, tone: "past", isPast: true };
  if (days === 0) return { label: "Today",     daysRemaining: 0, weeksRemaining: 0, tone: "today", isPast: false };
  if (days === 1) return { label: "Tomorrow",  daysRemaining: 1, weeksRemaining: 0, tone: "imminent", isPast: false };
  if (days <= 6)  return { label: `${days} days out`, daysRemaining: days, weeksRemaining: 0, tone: "imminent", isPast: false };
  const weeks = Math.round(days / 7);
  if (days <= 14) return { label: `${days} days out`, daysRemaining: days, weeksRemaining: weeks, tone: "soon", isPast: false };
  return { label: `${weeks} weeks out`, daysRemaining: days, weeksRemaining: weeks, tone: "default", isPast: false };
}

/* ---------------- link type auto-detect ---------------- */

export function guessLinkType(url: string): EventLinkType {
  const u = url.toLowerCase();
  if (u.includes("meet.google")) return "Google Meet";
  if (u.includes("zoom.us")) return "Google Meet";
  if (u.includes("youtube") || u.includes("twitch") || u.includes("livestream")) return "Livestream";
  if (u.includes("maps.")  || u.includes("goo.gl/maps")) return "Location / Map";
  if (u.includes("hotel") || u.includes("airbnb") || u.includes("booking.com")) return "Hotel / Travel";
  if (u.includes("register") || u.includes("signup") || u.includes("eventbrite")) return "Registration Link";
  if (u.includes("schedule")) return "Schedule";
  if (u.includes("roster") || u.includes("athletes")) return "Athlete Roster";
  if (u.includes("rule") || u.includes("info")) return "Rules / Info Package";
  if (u.includes("weigh")) return "Weigh-In Info";
  if (u.includes("stripe") || u.includes("checkout") || u.includes("pay")) return "Payment Link";
  return "Event Website";
}

export function guessLinkTitle(url: string, type: EventLinkType): string {
  if (type !== "Event Website") return type;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host;
  } catch { return "Link"; }
}

/* ---------------- ICS export ---------------- */

function pad(n: number) { return String(n).padStart(2, "0"); }
function toICSDate(d: Date, allDay = false): string {
  if (allDay) return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}`;
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
}

export function buildICS(ev: EventRow): string {
  const uid = `${ev.id}@jfeffect.events`;
  const dt = parseISO(ev.event_date);
  const startTime = ev.start_time;
  const endTime = ev.end_time;
  let dtStart: string, dtEnd: string;
  if (startTime) {
    const [sh, sm] = startTime.split(":").map(Number);
    const start = new Date(dt); start.setHours(sh ?? 0, sm ?? 0, 0, 0);
    const [eh, em] = (endTime ?? startTime).split(":").map(Number);
    const end = new Date(dt); end.setHours(eh ?? (sh+1), em ?? sm ?? 0, 0, 0);
    dtStart = `DTSTART:${toICSDate(start)}`;
    dtEnd = `DTEND:${toICSDate(end)}`;
  } else {
    const next = new Date(dt); next.setDate(next.getDate()+1);
    dtStart = `DTSTART;VALUE=DATE:${toICSDate(dt, true)}`;
    dtEnd = `DTEND;VALUE=DATE:${toICSDate(next, true)}`;
  }
  const desc = (ev.description || ev.client_facing_notes || "").replace(/\n/g, "\\n");
  const lines = [
    "BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//JF Effect//Events//EN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${toICSDate(new Date())}`,
    `SUMMARY:${ev.name.replace(/\n/g, " ")}`,
    dtStart, dtEnd,
    ev.location ? `LOCATION:${ev.location.replace(/\n/g, " ")}` : "",
    desc ? `DESCRIPTION:${desc}` : "",
    "END:VEVENT","END:VCALENDAR",
  ].filter(Boolean);
  return lines.join("\r\n");
}

export function downloadICS(ev: EventRow) {
  const blob = new Blob([buildICS(ev)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${ev.name.replace(/[^a-z0-9]+/gi, "-")}.ics`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/* ---------------- Default ChatGPT prompt ---------------- */

export const DEFAULT_FORMAT_PROMPT = `Format this event for my coaching app using this exact structure:

Event Name:
[official event name]

Event Type:
[Competition / Powerlifting Meet / Bodybuilding Show / Photoshoot / Testing Day / Weigh-In / Travel / Appointment / Coaching Call / Deadline / Gym Event / Custom]

Event Date:
[YYYY-MM-DD]

Start Time:
[time if available]

End Time:
[time if available]

Location:
[venue/address/city if available]

Importance:
[Low / Medium / High / Critical]

Client-Facing Description:
[clean short description clients can understand]

Client-Facing Notes:
[notes clients should see]

Coach Notes:
[internal notes for coach only]

Quick Links:

Title: [link title]
URL: [link]
Type: [Event Website / Registration Link / Schedule / Rules / Info Package / Athlete Roster / Livestream / Location / Map / Hotel / Travel / Weigh-In Info / Payment Link / Google Meet / Custom]
Visible To Client: [Yes / No]

Key Deadlines:

Title: [deadline title]
Date: [YYYY-MM-DD if available]
Notes: [deadline notes]
Visible To Client: [Yes / No]

Reminder Notes:
12 weeks out:
8 weeks out:
4 weeks out:
2 weeks out:
1 week out:
3 days out:
1 day out:
Day of event:

Reminder Notes Visible To Client:
[Yes / No]

Keep the formatting clean, simple, and easy to paste into my app.

If information is missing, write "Not provided" instead of guessing.`;

/* ---------------- Parser ---------------- */

export interface ParsedEvent {
  name?: string;
  event_type?: EventType;
  event_date?: string;
  start_time?: string;
  end_time?: string;
  location?: string;
  importance?: EventImportance;
  description?: string;
  client_facing_notes?: string;
  internal_notes?: string;
  quick_links: Array<{ title: string; url: string; link_type: EventLinkType; visible_to_client: boolean }>;
  deadlines: Array<{ title: string; due_date: string | null; notes: string | null; visible_to_client: boolean }>;
  reminders: Partial<Record<ReminderOffsetKey, string>>;
  reminders_visible_to_client?: boolean;
}

const reminderLabelMap: Record<string, ReminderOffsetKey> = {
  "12 weeks out": "w12",
  "8 weeks out": "w8",
  "4 weeks out": "w4",
  "2 weeks out": "w2",
  "1 week out": "w1",
  "3 days out": "d3",
  "1 day out": "d1",
  "day of event": "day_of",
};

function valueAfter(text: string, label: string): string | undefined {
  const re = new RegExp(`(?:^|\\n)\\s*${label}\\s*:?\\s*\\n([^\\n]+(?:\\n(?!\\s*[A-Z][A-Za-z ]+:|\\s*\\n).+)*)`, "i");
  const m = text.match(re);
  return m ? m[1].trim() : undefined;
}

export function parseFormattedEvent(text: string): ParsedEvent {
  const out: ParsedEvent = { quick_links: [], deadlines: [], reminders: {} };
  const norm = text.replace(/\r/g, "");

  const get = (label: string) => {
    const v = valueAfter(norm, label);
    return v && v.toLowerCase() !== "not provided" ? v : undefined;
  };

  out.name = get("Event Name");
  const et = get("Event Type");
  if (et) {
    const found = EVENT_TYPES.find((t) => t.toLowerCase() === et.toLowerCase());
    if (found) out.event_type = found;
  }
  const date = get("Event Date");
  if (date && /^\d{4}-\d{2}-\d{2}/.test(date)) out.event_date = date.slice(0,10);
  const st = get("Start Time"); if (st) out.start_time = st;
  const en = get("End Time"); if (en) out.end_time = en;
  out.location = get("Location");
  const imp = get("Importance");
  if (imp) {
    const f = EVENT_IMPORTANCE.find((x) => x.toLowerCase() === imp.toLowerCase());
    if (f) out.importance = f;
  }
  out.description = get("Client-Facing Description");
  out.client_facing_notes = get("Client-Facing Notes");
  out.internal_notes = get("Coach Notes");

  // Quick Links block
  const qlMatch = norm.match(/Quick Links\s*:?\s*\n([\s\S]*?)(?=\n\s*Key Deadlines\s*:|\n\s*Reminder Notes\s*:|\n\s*Reminder Notes Visible|$)/i);
  if (qlMatch) {
    const block = qlMatch[1];
    const items = block.split(/\n\s*\n/);
    for (const item of items) {
      const titleM = item.match(/Title:\s*(.+)/i);
      const urlM = item.match(/URL:\s*(\S+)/i);
      if (!titleM || !urlM) continue;
      const typeM = item.match(/Type:\s*(.+)/i);
      const visM = item.match(/Visible To Client:\s*(Yes|No)/i);
      const ty = typeM?.[1].trim();
      const found = ty ? EVENT_LINK_TYPES.find((x) => x.toLowerCase() === ty.toLowerCase()) : undefined;
      out.quick_links.push({
        title: titleM[1].trim(),
        url: urlM[1].trim(),
        link_type: found ?? guessLinkType(urlM[1]),
        visible_to_client: visM ? /yes/i.test(visM[1]) : true,
      });
    }
  }

  // Deadlines
  const dlMatch = norm.match(/Key Deadlines\s*:?\s*\n([\s\S]*?)(?=\n\s*Reminder Notes\s*:|\n\s*Reminder Notes Visible|$)/i);
  if (dlMatch) {
    const items = dlMatch[1].split(/\n\s*\n/);
    for (const item of items) {
      const titleM = item.match(/Title:\s*(.+)/i);
      if (!titleM) continue;
      const dateM = item.match(/Date:\s*(\d{4}-\d{2}-\d{2})/i);
      const notesM = item.match(/Notes:\s*(.+)/i);
      const visM = item.match(/Visible To Client:\s*(Yes|No)/i);
      out.deadlines.push({
        title: titleM[1].trim(),
        due_date: dateM ? dateM[1] : null,
        notes: notesM ? notesM[1].trim() : null,
        visible_to_client: visM ? /yes/i.test(visM[1]) : true,
      });
    }
  }

  // Reminders
  const rnMatch = norm.match(/Reminder Notes\s*:?\s*\n([\s\S]*?)(?=\n\s*Reminder Notes Visible|$)/i);
  if (rnMatch) {
    const block = rnMatch[1];
    for (const [label, key] of Object.entries(reminderLabelMap)) {
      const re = new RegExp(`${label}\\s*:\\s*(.+)`, "i");
      const m = block.match(re);
      if (m && m[1].trim() && m[1].trim().toLowerCase() !== "not provided") out.reminders[key] = m[1].trim();
    }
  }
  const rv = get("Reminder Notes Visible To Client");
  if (rv) out.reminders_visible_to_client = /yes/i.test(rv);

  return out;
}

/* ---------------- queries ---------------- */

export async function listAdminEvents(opts: { status?: EventStatus } = {}): Promise<EventRow[]> {
  let q = (supabase.from("events") as any).select("*").order("event_date", { ascending: true });
  if (opts.status) q = q.eq("status", opts.status);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as EventRow[];
}

export async function getEvent(id: string) {
  const [ev, links, deadlines, reminders, assignments] = await Promise.all([
    (supabase.from("events") as any).select("*").eq("id", id).maybeSingle(),
    (supabase.from("event_quick_links") as any).select("*").eq("event_id", id).order("sort_order"),
    (supabase.from("event_deadlines") as any).select("*").eq("event_id", id).order("sort_order"),
    (supabase.from("event_reminders") as any).select("*").eq("event_id", id),
    (supabase.from("event_assignments") as any).select("client_id, assigned_at").eq("event_id", id),
  ]);
  if (ev.error) throw ev.error;
  return {
    event: ev.data as EventRow | null,
    links: (links.data ?? []) as QuickLink[],
    deadlines: (deadlines.data ?? []) as Deadline[],
    reminders: (reminders.data ?? []) as Reminder[],
    assignments: (assignments.data ?? []) as { client_id: string; assigned_at: string }[],
  };
}

export function importanceBadgeClass(imp: EventImportance) {
  switch (imp) {
    case "Critical": return "bg-destructive text-destructive-foreground";
    case "High":     return "bg-primary text-primary-foreground";
    case "Medium":   return "bg-secondary text-foreground";
    default:         return "bg-muted text-muted-foreground";
  }
}

export function formatEventWhen(ev: Pick<EventRow, "event_date"|"start_time">): string {
  const d = format(parseISO(ev.event_date), "MMM d, yyyy");
  return ev.start_time ? `${d} · ${ev.start_time.slice(0,5)}` : d;
}
