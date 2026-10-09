/**
 * One-off "add this to my calendar" links for a booked time: Google, Outlook
 * and an .ics file (Apple Calendar and everything else). Pure, browser safe.
 */
import { buildIcsFeed, icsUtc } from "@/lib/ics-feed";

export type CalendarEventInput = {
  uid: string;
  title: string;
  start: Date;
  end: Date;
  location?: string | null;
  details?: string | null;
};

export function googleCalendarLink(e: CalendarEventInput): string {
  const p = new URLSearchParams({
    action: "TEMPLATE",
    text: e.title,
    dates: `${icsUtc(e.start)}/${icsUtc(e.end)}`,
  });
  if (e.details) p.set("details", e.details);
  if (e.location) p.set("location", e.location);
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

/** Outlook on the web (outlook.com); work accounts use outlook.office.com with the same path. */
export function outlookCalendarLink(
  e: CalendarEventInput,
  host: "live" | "office" = "live",
): string {
  const p = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: e.title,
    startdt: e.start.toISOString(),
    enddt: e.end.toISOString(),
  });
  if (e.details) p.set("body", e.details);
  if (e.location) p.set("location", e.location);
  return `https://outlook.${host === "live" ? "live" : "office"}.com/calendar/0/deeplink/compose?${p.toString()}`;
}

/** An .ics file as a data link: iPhone opens it straight into Calendar. */
export function icsDataLink(e: CalendarEventInput): string {
  const ics = buildIcsFeed({
    name: e.title,
    events: [
      {
        uid: e.uid,
        start: e.start,
        end: e.end,
        summary: e.title,
        location: e.location,
        description: e.details,
      },
    ],
  });
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
}
