import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  CLIENT_GCAL_READ_SCOPES,
  hasGoogleReadAccess,
  pickImportedEvents,
  visibleCalendarIds,
  type GoogleReadEvent,
} from "@/lib/client-gcal";

const ev = (id: string, start: string, extra: Partial<GoogleReadEvent> = {}): GoogleReadEvent => ({
  id,
  iCalUID: `${id}@google.com`,
  status: "confirmed",
  summary: id,
  start: { dateTime: start },
  end: { dateTime: start.replace("T09", "T10") },
  ...extra,
});

describe("client's Google events in the app", () => {
  it("needs both read permissions", () => {
    expect(hasGoogleReadAccess(`openid ${CLIENT_GCAL_READ_SCOPES.join(" ")}`)).toBe(true);
    expect(hasGoogleReadAccess(`openid ${CLIENT_GCAL_READ_SCOPES[1]}`)).toBe(false);
    expect(hasGoogleReadAccess(null)).toBe(false);
  });

  it("drops what JF Effect already shows, cancelled and declined events", () => {
    const out = pickImportedEvents({
      jfCalendarId: "jf-cal",
      appEventIds: ["apptevt"],
      lists: [
        { id: "jf-cal", items: [ev("ours", "2026-10-12T09:00:00Z")] },
        {
          id: "primary@x.com",
          name: "Me",
          items: [
            ev("dentist", "2026-10-12T09:00:00Z", { location: "Main St" }),
            ev("tagged", "2026-10-12T09:00:00Z", { extendedProperties: { private: { jf: "1" } } }),
            ev("feedcopy", "2026-10-12T09:00:00Z", { iCalUID: "pt-123@jfeffect.com" }),
            ev("apptevt", "2026-10-13T09:00:00Z"),
            ev("apptevt_20261020T090000Z", "2026-10-20T09:00:00Z"),
            ev("gone", "2026-10-12T09:00:00Z", { status: "cancelled" }),
            ev("no", "2026-10-12T09:00:00Z", { attendees: [{ self: true, responseStatus: "declined" }] }),
          ],
        },
      ],
    });
    expect(out.map((e) => e.summary)).toEqual(["dentist"]);
    expect(out[0]).toMatchObject({ calendarId: "primary@x.com", calendarName: "Me", location: "Main St", allDay: false });
  });

  it("shows an event on two calendars once, and all-day events by date", () => {
    const shared = ev("party", "2026-10-14T09:00:00Z");
    const allDay: GoogleReadEvent = { id: "trip", iCalUID: "trip@google.com", start: { date: "2026-10-15" }, end: { date: "2026-10-17" } };
    const out = pickImportedEvents({ lists: [{ id: "a", items: [shared, allDay] }, { id: "b", items: [shared] }] });
    expect(out.map((e) => e.summary)).toEqual(["party", "Busy"]);
    expect(out[1]).toMatchObject({ allDay: true, start: "2026-10-15", end: "2026-10-17" });
  });

  it("shows their main calendar until they pick, never the JF Effect one", () => {
    const cals = [{ id: "jf-cal" }, { id: "me", primary: true }, { id: "work" }];
    expect(visibleCalendarIds(cals, null, "jf-cal")).toEqual(["me"]);
    expect(visibleCalendarIds(cals, ["work", "jf-cal", "deleted"], "jf-cal")).toEqual(["work"]);
    expect(visibleCalendarIds(cals, [], "jf-cal")).toEqual([]);
  });

  it("is private to the client: never for a coach previewing them", () => {
    const fns = readFileSync("src/lib/schedule.functions.ts", "utf8");
    const block = fns.slice(fns.indexOf("export const getMyGoogleEvents"), fns.indexOf("export const getMyGoogleCalendars"));
    expect(block).toMatch(/const mine = await ownOrLinkedClient\(userId\);\s*if \(!mine \|\| mine\.id !== data\.clientId\) return/);
    expect(block).not.toMatch(/resolvePovClientId|canViewClient/);
  });

  it("never writes or stores their events", () => {
    const server = readFileSync("src/lib/client-gcal.server.ts", "utf8");
    const read = server.slice(server.indexOf("// ---- Their own Google events"));
    expect(read).not.toMatch(/method: "(POST|PUT|PATCH|DELETE)"/);
    expect(read).not.toMatch(/\.insert\(|\.upsert\(/);
  });
});
