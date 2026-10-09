import { describe, expect, it } from "vitest";
import { wallTimeToUtc, localDateISO, addDaysISO, fmtWallClock, overlaps, addMinutesHM } from "@/lib/schedule-time";
import {
  buildSessionChangeSms,
  buildSessionReminderSms,
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
  it("turns local wall time into the right instant across DST", () => {
    expect(wallTimeToUtc("2026-10-12", "11:00", TZ).toISOString()).toBe("2026-10-12T16:00:00.000Z"); // CDT
    expect(wallTimeToUtc("2026-12-01", "11:00", TZ).toISOString()).toBe("2026-12-01T17:00:00.000Z"); // CST
    expect(wallTimeToUtc("2026-11-01", "09:00", TZ).toISOString()).toBe("2026-11-01T15:00:00.000Z"); // DST ends 2am
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
    expect(body).toBe(
      "Hi Marc, this is Jared James Coaching. Reminder: 1:1 Training tomorrow (Mon Oct 12) at 11:00 AM, 800 Vaughan Ave Unit 404. Need to change it? jfeffect.com/portal/calendar",
    );
    expect(body).toMatch(/^[\x20-\x7E]+$/);
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
