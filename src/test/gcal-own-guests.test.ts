import { describe, expect, it } from "vitest";
import {
  attendeesWithout,
  coachOwnCalendarIds,
  copyMatchesEvent,
  ownGuestEmails,
  seriesGuestCopiesSafe,
  type EventLike,
} from "@/lib/gcal-own-guests";

// Shapes as Google returned them for Nicolas's weekend series on Nov 13 2026.
const coaching = "49b3724508af3a3f1258217ec5e8978a87f020b472af1743d0be8bdcd802c5ae@group.calendar.google.com";
const main = "jaredjamesfit@gmail.com";
const family = "family02461101426358837604@group.calendar.google.com";

const calendars = [
  { id: main, primary: true, accessRole: "owner" },
  { id: coaching, accessRole: "owner" },
  { id: family, accessRole: "writer" },
  { id: "holidays@group.v.calendar.google.com", accessRole: "reader" },
  { id: "side-project@group.calendar.google.com", accessRole: "owner" },
];
const own = coachOwnCalendarIds(calendars, [coaching]);

const guests = [
  { email: "JaredJamesFit@gmail.com", displayName: "Jared McIntyre", responseStatus: "needsAction" },
  { email: "nicogalli555@gmail.com", responseStatus: "needsAction" },
  { email: "nicogalli@yahoo.com", responseStatus: "accepted", comment: "see you", optional: true },
];

const repeat = (day: string, start: string, extra: Partial<EventLike> = {}): EventLike => ({
  id: `a2sih9bfb6madq1fvjo9rk29fk_${day.replace(/-/g, "")}T150000Z`,
  iCalUID: "a2sih9bfb6madq1fvjo9rk29fk@google.com",
  recurringEventId: "a2sih9bfb6madq1fvjo9rk29fk",
  status: "confirmed",
  summary: "Nicolas Galli · 1:1 Training",
  location: "800 Vaughan Ave Unit 404, Selkirk, Manitoba R1A 4R4, Canada",
  originalStartTime: { dateTime: `${day}T10:00:00-05:00` },
  start: { dateTime: `${day}T${start}:00-05:00` },
  end: { dateTime: `${day}T${String(Number(start.slice(0, 2)) + 1).padStart(2, "0")}${start.slice(2)}:00-05:00` },
  organizer: { email: coaching },
  attendees: guests,
  ...extra,
});

describe("the coach's own calendars", () => {
  it("is their main calendar and the one the app writes to, when they own them", () => {
    expect([...own].sort()).toEqual([coaching, main].sort());
  });

  it("never someone else's calendar they can write to, or another of their own", () => {
    expect(own.has(family)).toBe(false);
    expect(own.has("side-project@group.calendar.google.com")).toBe(false);
    expect(coachOwnCalendarIds([{ id: coaching, accessRole: "writer" }], [coaching]).size).toBe(0);
  });
});

describe("the coach as a guest of their own event", () => {
  it("finds their main calendar on the event the coaching calendar organizes", () => {
    expect(ownGuestEmails(repeat("2026-11-14", "06:30"), coaching, own)).toEqual([main]);
  });

  it("never on an invitation copy (its guest list isn't ours to change)", () => {
    expect(ownGuestEmails(repeat("2026-11-14", "06:30"), main, own)).toEqual([]);
  });

  it("never the organizer, and nothing when only clients are invited", () => {
    const organizerListed = repeat("2026-11-14", "06:30", { attendees: [{ email: coaching, organizer: true }, ...guests.slice(1)] });
    expect(ownGuestEmails(organizerListed, coaching, own)).toEqual([]);
    expect(ownGuestEmails(repeat("2026-11-14", "06:30", { attendees: guests.slice(1) }), coaching, own)).toEqual([]);
    expect(ownGuestEmails(repeat("2026-11-14", "06:30", { attendees: null }), coaching, own)).toEqual([]);
  });

  it("keeps every client invited with their answer, note and options", () => {
    expect(attendeesWithout(guests, [main])).toEqual([
      { email: "nicogalli555@gmail.com", responseStatus: "needsAction" },
      { email: "nicogalli@yahoo.com", responseStatus: "accepted", comment: "see you", optional: true },
    ]);
  });

  it("leaves Google's read-only flags off the list it sends back", () => {
    const sent = attendeesWithout([{ email: "nicogalli@yahoo.com", self: true, organizer: false, id: "x", resource: false }], []);
    expect(sent).toEqual([{ email: "nicogalli@yahoo.com" }]);
  });
});

describe("a copy on the coach's calendar loses nothing when it goes", () => {
  it("when it says what the event says (Google carries a move to it)", () => {
    expect(copyMatchesEvent(repeat("2026-11-14", "06:30"), repeat("2026-11-14", "06:30"))).toBe(true);
  });

  it("not when it was changed on its own (Oct 31: 8:30 on the coach's copy, 10 AM on the event)", () => {
    const event = repeat("2026-10-31", "10:00", { summary: "PT Session - Nicolas", location: null });
    const copy = repeat("2026-10-31", "08:30");
    expect(copyMatchesEvent(event, copy)).toBe(false);
    expect(copyMatchesEvent(repeat("2026-11-07", "10:00"), repeat("2026-11-07", "10:00", { summary: "Nico PT" }))).toBe(false);
  });

  it("a copy already cancelled always can; a live one with no event behind it can't", () => {
    expect(copyMatchesEvent(undefined, repeat("2026-11-07", "10:00", { status: "cancelled" }))).toBe(true);
    expect(copyMatchesEvent(undefined, repeat("2026-11-07", "10:00"))).toBe(false);
    expect(copyMatchesEvent(repeat("2026-11-07", "10:00", { status: "cancelled" }), repeat("2026-11-07", "10:00"))).toBe(false);
  });
});

describe("a whole series", () => {
  const days = ["2026-11-01", "2026-11-07", "2026-11-08", "2026-11-14", "2026-11-15"];
  const events = days.map((d) => repeat(d, d === "2026-11-14" ? "06:30" : "10:00"));

  it("can drop the coach when every copy matches and none is a session's", () => {
    const copies = days.map((d) => repeat(d, d === "2026-11-14" ? "06:30" : "10:00", { attendees: guests }));
    expect(seriesGuestCopiesSafe(events, copies, new Set())).toEqual({ safe: true, differs: [], linked: [] });
  });

  it("can't when a copy differs or a session points at one, and says which", () => {
    const copies = days.map((d) => repeat(d, d === "2026-11-14" ? "06:30" : "10:00"));
    copies[1] = repeat("2026-11-07", "08:30");
    const check = seriesGuestCopiesSafe(events, copies, new Set([copies[0].id]));
    expect(check.safe).toBe(false);
    expect(check.differs).toEqual(["2026-11-07T10:00:00-05:00"]);
    expect(check.linked).toEqual(["2026-11-01T10:00:00-05:00"]);
  });

  it("matches a moved repeat by its original start", () => {
    const moved = [repeat("2026-11-14", "06:30")];
    expect(seriesGuestCopiesSafe(moved, [repeat("2026-11-14", "06:30")], new Set()).safe).toBe(true);
  });
});
