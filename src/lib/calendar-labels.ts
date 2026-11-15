/**
 * What a calendar item says about itself in a small space, the same on every
 * coach calendar: who (for a session or appointment), when, what, where. A
 * month cell has room for "10a Nicolas G."; the rest is on hover and in the
 * day list under the grid. Pure, so it's tested.
 */
import { KIND_META, placeLabel, scheduleTitle, type CalendarItem, type CalendarKind } from "@/lib/calendar-sources";
import { compactTimeRange, durationLabel } from "@/lib/schedule-time";

/** Items that are with someone: their name is what the coach scans for. */
const PERSON_KINDS: CalendarKind[] = ["pt_session", "appointment"];

/** The person a session or appointment is with (never the "Google Calendar" source label). */
export function personName(item: Pick<CalendarItem, "kind" | "clientName">): string | null {
  if (!PERSON_KINDS.includes(item.kind)) return null;
  const name = (item.clientName ?? "").trim();
  return name && name !== "Google Calendar" ? name : null;
}

/** "Nicolas Galli" → "Nicolas G."; one word stays as is. */
export function shortName(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] ?? "";
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

/** "10a", "5:30p", "12p": a start time that fits a month cell (device clock). */
export function chipTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const h = d.getHours();
  const m = d.getMinutes();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "a" : "p"}`;
}

/** A month cell's chip: the time, then who it's with, else what it is. */
export function chipParts(item: CalendarItem, withPerson: boolean): { time: string; label: string } {
  const who = withPerson ? personName(item) : null;
  return { time: chipTime(item.startsAt), label: who ? shortName(who) : scheduleTitle(item) };
}

/** Everything about an item, one line each, for the hover card and screen readers. */
export function itemDetailLines(item: CalendarItem, withPerson: boolean): string[] {
  const who = withPerson ? personName(item) : null;
  const when = item.startsAt ? compactTimeRange(item.startsAt, item.endsAt) : "All day";
  const length = item.startsAt ? durationLabel(item.startsAt, item.endsAt) : null;
  const what = scheduleTitle(item);
  const status = item.status && item.status !== "Scheduled" ? item.status : null;
  return [
    who,
    length ? `${when} (${length})` : when,
    [what !== who ? what : null, what === KIND_META[item.kind].label ? null : KIND_META[item.kind].label].filter(Boolean).join(" · ") || null,
    placeLabel(item.location),
    status,
  ].filter((l): l is string => !!l);
}

/**
 * A row's two lines in a list: the person as the title when there is one
 * ("Colten Murray" / "12–1 PM · 1:1 Training · 800 Vaughan Ave"), otherwise
 * the item's own title and when / what.
 */
export function rowLines(item: CalendarItem, withPerson: boolean): { title: string; meta: string } {
  const who = withPerson ? personName(item) : null;
  const when = item.startsAt ? compactTimeRange(item.startsAt, item.endsAt) : null;
  const status = item.status && item.status !== "Scheduled" ? item.status : null;
  if (who) {
    return { title: who, meta: [when, scheduleTitle(item), placeLabel(item.location), status].filter(Boolean).join(" · ") };
  }
  return {
    title: scheduleTitle(item),
    meta: [when, KIND_META[item.kind].label, status, withPerson && item.kind !== "google_event" ? item.clientName : null].filter(Boolean).join(" · "),
  };
}
