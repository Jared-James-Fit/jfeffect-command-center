import { describe, expect, it } from "vitest";
import { wallTimeToUtc, localDateISO, addDaysISO, fmtWallClock, overlaps, addMinutesHM } from "@/lib/schedule-time";
import {
  buildSessionChangeSms,
  buildSessionReminderSms,
  changeTextDecision,
  gsmSafe,
  isLastMinute,
  reminderDecision,
  reminderSendAt,
  shortLocation,
  type ReminderSession,
} from "@/lib/pt-session-reminders";
import { findConflicts, googleEventBlocksTime, appSessionIdOf } from "@/lib/session-conflicts";
import { buildIcsFeed, foldLine } from "@/lib/ics-feed";

const TZ = "America/Winnipeg";

function session(over: Partial<ReminderSession> = {}): ReminderSession {
  const date = over.session_date ?? "2026-10-12";
  return {
    status: "Scheduled",
    reminders_enabled: true,
    visible_to_client: true,
    reminder_24h_sent_at: null,
    session_date: date,
    timezone: TZ,
    starts_at: wallTimeToUtc(date, "11:00", TZ).toISOString(),
    time_set_at: "2026-10-08T23:51:00Z",
    ...over,
  };
}
const at = (date: string, time: string) => wallTimeToUtc(date, time, TZ);

describe("schedule time math", () => {
  it("turns local wall time into the right instant, Manitoba's UTC-5 from Nov 1 2026 included", () => {
    expect(wallTimeToUtc("2026-10-12", "11:00", TZ).toISOString()).toBe("2026-10-12T16:00:00.000Z"); // CDT
    // Manitoba kept UTC-5 instead of falling back on Nov 1 2026
    expect(wallTimeToUtc("2026-12-01", "11:00", TZ).toISOString()).toBe("2026-12-01T16:00:00.000Z");
    expect(wallTimeToUtc("2026-11-01", "09:00", TZ).toISOString()).toBe("2026-11-01T14:00:00.000Z");
    // the last real fall-back, Nov 2 2025
    expect(wallTimeToUtc("2025-12-01", "11:00", TZ).toISOString()).toBe("2025-12-01T17:00:00.000Z"); // CST
    expect(wallTimeToUtc("2025-11-02", "09:00", TZ).toISOString()).toBe("2025-11-02T15:00:00.000Z"); // DST ended 2am
  });
  it("reads local dates and does plain date math", () => {
    expect(localDateISO(new Date("2026-10-13T03:30:00Z"), TZ)).toBe("2026-10-12");
    expect(addDaysISO("2026-11-01", -1)).toBe("2026-10-31");
    expect(addMinutesHM("11:00", 60)).toBe("12:00");
    expect(fmtWallClock("16:05:00")).toBe("4:05 PM");
  });
  it("treats back-to-back as no overlap", () => {
    expect(overlaps({ start: 0, end: 10 }, { start: 10, end: 20 })).toBe(false);
    expect(overlaps({ start: 0, end: 11 }, { start: 10, end: 20 })).toBe(true);
  });
});

describe("evening-before reminder timing", () => {
  it("is due at 6 PM local the day before", () => {
    expect(reminderSendAt(session()).toISOString()).toBe("2026-10-11T23:00:00.000Z");
    expect(reminderDecision(session(), at("2026-10-11", "17:55"))).toEqual({ action: "wait", reason: "not_yet" });
    expect(reminderDecision(session(), at("2026-10-11", "18:00"))).toEqual({ action: "send" });
  });

  it("never texts twice, or for sessions that are hidden, off, or not scheduled", () => {
    const t = at("2026-10-11", "18:05");
    expect(reminderDecision(session({ reminder_24h_sent_at: "2026-10-11T23:00:00Z" }), t).action).toBe("skip");
    expect(reminderDecision(session({ reminders_enabled: false }), t)).toEqual({ action: "skip", reason: "reminders_off" });
    expect(reminderDecision(session({ visible_to_client: false }), t)).toEqual({ action: "skip", reason: "hidden" });
    expect(reminderDecision(session({ status: "Cancelled" }), t)).toEqual({ action: "skip", reason: "not_scheduled" });
  });

  it("stays quiet for sessions booked or moved after the 6 PM mark", () => {
    const s = session({ time_set_at: at("2026-10-11", "19:30").toISOString() });
    expect(reminderDecision(s, at("2026-10-11", "19:35"))).toEqual({ action: "skip", reason: "arranged_recently" });
  });

  it("catches up next morning after downtime, but not within 2 hours of the session", () => {
    expect(reminderDecision(session(), at("2026-10-11", "22:00"))).toEqual({ action: "wait", reason: "quiet_hours" });
    expect(reminderDecision(session(), at("2026-10-12", "08:30"))).toEqual({ action: "wait", reason: "quiet_hours" });
    expect(reminderDecision(session(), at("2026-10-12", "09:00"))).toEqual({ action: "send" });
    expect(reminderDecision(session(), at("2026-10-12", "09:30"))).toEqual({ action: "skip", reason: "too_late" });
    const afternoon = session({ starts_at: at("2026-10-12", "16:00").toISOString() });
    expect(reminderDecision(afternoon, at("2026-10-12", "09:00"))).toEqual({ action: "send" });
  });
});

describe("reminder text", () => {
  it("is short, plain and says when, where and how to change it", () => {
    const body = buildSessionReminderSms({
      firstName: "Marc",
      brand: "Jared James Coaching",
      title: "1:1 Training",
      startsAt: at("2026-10-12", "11:00"),
      tz: TZ,
      location: "800 Vaughan Ave Unit 404, Selkirk, Manitoba R1A 4R4, Canada",
      link: "jfeffect.com/portal/calendar",
      now: at("2026-10-11", "18:00"),
    });
    // The friendliest wording was 171 characters (2 billed segments); the
    // reminder now always fits one.
    expect(body).toBe(
      "Hi Marc, Jared James Coaching here. Reminder: 1:1 Training tomorrow (Mon Oct 12) at 11:00 AM, 800 Vaughan Ave Unit 404. Change it: jfeffect.com/portal/calendar",
    );
    expect(body.length).toBeLessThanOrEqual(160);
    expect(body).toMatch(/^[\x20-\x7E]+$/);
  });

  it("always fits one segment, however long the name, coach or place", () => {
    const body = buildSessionReminderSms({
      firstName: "Maximilian-Alexander",
      brand: "JF Effect",
      coach: "Jared",
      title: "1:1 Strength & Conditioning Session Extra",
      startsAt: at("2026-10-12", "11:00"),
      tz: TZ,
      location: "800 Vaughan Ave Unit 404 Rear Entrance Building B, Selkirk",
      link: "jfeffect.com/portal/calendar",
      now: at("2026-10-11", "18:00"),
    });
    expect(body.length).toBeLessThanOrEqual(160);
    expect(body).toContain("jfeffect.com/portal/calendar");
    expect(body).toContain("Jared from JF Effect");
  });

  it("change texts name the new time or the cancellation", () => {
    const base = { firstName: "Marc", brand: "JJC", title: "1:1 Training", tz: TZ, link: "jfeffect.com/portal/calendar" };
    expect(buildSessionChangeSms({ ...base, kind: "moved", startsAt: at("2026-10-14", "16:00"), location: "Iron Image Gym" }))
      .toBe("Hi Marc, this is JJC. Your 1:1 Training moved to Wed Oct 14 at 4:00 PM, Iron Image Gym. Your schedule: jfeffect.com/portal/calendar");
    expect(buildSessionChangeSms({ ...base, kind: "cancelled", startsAt: at("2026-10-13", "11:00") }))
      .toBe("Hi Marc, this is JJC. Your 1:1 Training on Tue Oct 13 at 11:00 AM is cancelled. Your schedule: jfeffect.com/portal/calendar");
  });

  it("strips characters that would force the expensive SMS encoding", () => {
    expect(gsmSafe("It’s “today” — 💪 ok")).toBe(`It's "today" - ok`);
    expect(shortLocation("Iron Image Gym")).toBe("Iron Image Gym");
  });

  it("only offers a change text inside 48 hours", () => {
    const now = at("2026-10-12", "09:00");
    expect(isLastMinute(at("2026-10-13", "11:00"), now)).toBe(true);
    expect(isLastMinute(at("2026-10-20", "11:00"), now)).toBe(false);
  });

  it("texts a change only when the chat message's push may not reach them in time", () => {
    const now = at("2026-10-12", "09:00");
    // No push: inside 48 hours is texted.
    expect(changeTextDecision({ startsAt: at("2026-10-13", "16:00"), now, pushReachable: false })).toEqual({ text: true });
    // With push: 31 hours out the chat push is enough...
    expect(changeTextDecision({ startsAt: at("2026-10-13", "16:00"), now, pushReachable: true })).toEqual({ text: false, reason: "push_reaches_them" });
    // ...but the same day is still texted (a missed push means a wasted trip).
    expect(changeTextDecision({ startsAt: at("2026-10-12", "17:00"), now, pushReachable: true })).toEqual({ text: true });
    // Moving today's session to next week is urgent: the old time counts.
    expect(changeTextDecision({ startsAt: at("2026-10-20", "11:00"), previousStartsAt: at("2026-10-12", "17:00"), now, pushReachable: true })).toEqual({ text: true });
    // A time the client asked for is never texted to someone push reaches.
    expect(changeTextDecision({ startsAt: at("2026-10-12", "17:00"), now, pushReachable: true, clientAsked: true })).toEqual({ text: false, reason: "push_reaches_them" });
    expect(changeTextDecision({ startsAt: at("2026-10-12", "17:00"), now, pushReachable: false, clientAsked: true })).toEqual({ text: true });
    // Far off: nothing.
    expect(changeTextDecision({ startsAt: at("2026-10-20", "11:00"), now, pushReachable: false })).toEqual({ text: false, reason: "not_last_minute" });
  });

  it("change texts fit one segment too", () => {
    const base = { firstName: "Maximilian", brand: "JF Effect", coach: "Jared", title: "1:1 Training", tz: TZ, link: "jfeffect.com/portal/calendar" };
    const moved = buildSessionChangeSms({ ...base, kind: "moved", startsAt: at("2026-11-14", "06:30"), location: "800 Vaughan Ave Unit 404, Selkirk" });
    expect(moved.length).toBeLessThanOrEqual(160);
    expect(moved).toContain("Sat Nov 14 at 6:30 AM");
  });
});

describe("double-booking", () => {
  const slot = (key: string, d: string, s: string, e: string) => ({ key, start: at(d, s).getTime(), end: at(d, e).getTime() });

  it("flags app and Google overlaps per slot, not back-to-back", () => {
    const busy = [
      { source: "app" as const, id: "a", title: "Dana · 1:1 Training", ...{ start: at("2026-10-13", "10:00").getTime(), end: at("2026-10-13", "11:00").getTime() } },
      { source: "google" as const, id: "g", title: "Dentist", ...{ start: at("2026-10-13", "11:30").getTime(), end: at("2026-10-13", "12:30").getTime() } },
    ];
    const res = findConflicts([slot("mon", "2026-10-12", "11:00", "12:00"), slot("tue", "2026-10-13", "11:00", "12:00")], busy);
    expect(res).toHaveLength(1);
    expect(res[0].key).toBe("tue");
    expect(res[0].items.map((i) => i.id)).toEqual(["g"]);
  });

  it("ignores Google events that don't block time", () => {
    const timed = { start: { dateTime: "2026-10-13T16:00:00Z" }, end: { dateTime: "2026-10-13T17:00:00Z" } };
    expect(googleEventBlocksTime({ id: "1", ...timed })).toBe(true);
    expect(googleEventBlocksTime({ id: "2", ...timed, transparency: "transparent" })).toBe(false);
    expect(googleEventBlocksTime({ id: "3", start: { date: "2026-10-13" }, end: { date: "2026-10-14" } })).toBe(false);
    expect(googleEventBlocksTime({ id: "4", ...timed, status: "cancelled" })).toBe(false);
    expect(googleEventBlocksTime({ id: "5", ...timed, attendees: [{ self: true, responseStatus: "declined" }] })).toBe(false);
    const own = { id: "6", ...timed, extendedProperties: { private: { jfPtSessionId: "abc" } } };
    expect(googleEventBlocksTime(own)).toBe(false);
    expect(appSessionIdOf(own)).toBe("abc");
  });
});

describe("calendar feed", () => {
  it("builds a valid, folded feed", () => {
    const ics = buildIcsFeed({
      name: "JF Effect · Marc",
      now: new Date("2026-10-08T00:00:00Z"),
      events: [{ uid: "pt-1@jfeffect.com", start: new Date("2026-10-12T16:00:00Z"), end: new Date("2026-10-12T17:00:00Z"), summary: "1:1 Training", location: "800 Vaughan Ave, Selkirk" }],
    });
    expect(ics).toContain("BEGIN:VCALENDAR\r\n");
    expect(ics).toContain("DTSTART:20261012T160000Z");
    expect(ics).toContain("LOCATION:800 Vaughan Ave\\, Selkirk");
    expect(ics).toContain("TRIGGER:-PT1H");
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
  it("folds long lines", () => {
    const folded = foldLine("DESCRIPTION:" + "x".repeat(200));
    expect(folded.split("\r\n ").every((l) => l.length <= 75)).toBe(true);
    expect(folded.replace(/\r\n /g, "")).toBe("DESCRIPTION:" + "x".repeat(200));
  });
});

describe("time ranges on the calendar", async () => {
  const { compactTimeRange, durationLabel } = await import("@/lib/schedule-time");
  const tz = "America/Winnipeg";
  it("reads short", () => {
    expect(compactTimeRange("2026-10-09T14:00:00Z", "2026-10-09T22:00:00Z", tz)).toBe("9 AM–5 PM");
    expect(compactTimeRange("2026-10-09T15:00:00Z", "2026-10-09T16:30:00Z", tz)).toBe("10–11:30 AM");
    expect(compactTimeRange("2026-10-09T17:00:00Z", "2026-10-09T18:00:00Z", tz)).toBe("12–1 PM");
    expect(compactTimeRange("2026-10-09T17:00:00Z", null, tz)).toBe("12 PM");
  });
  it("says how long", () => {
    expect(durationLabel("2026-10-09T14:00:00Z", "2026-10-09T22:00:00Z")).toBe("8 hr");
    expect(durationLabel("2026-10-09T15:00:00Z", "2026-10-09T16:30:00Z")).toBe("1 hr 30 min");
    expect(durationLabel("2026-10-09T15:00:00Z", "2026-10-09T15:45:00Z")).toBe("45 min");
    expect(durationLabel("2026-10-09T15:00:00Z", null)).toBeNull();
  });
});

describe("where, in a few words", async () => {
  const { placeLabel } = await import("@/lib/calendar-sources");
  it("keeps an address short and names call links", () => {
    expect(placeLabel("800 Vaughan Ave Unit 404, Selkirk, Manitoba R1A 4R4, Canada")).toBe("800 Vaughan Ave Unit 404");
    expect(placeLabel("https://meet.google.com/abc-defg-hij")).toBe("Google Meet");
    expect(placeLabel("https://us02web.zoom.us/j/123")).toBe("Zoom");
    expect(placeLabel("")).toBeNull();
    expect(placeLabel(null)).toBeNull();
  });
});
