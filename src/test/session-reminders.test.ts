import { describe, expect, it } from "vitest";
import {
  daySummary,
  dueReminder,
  readSlotPrefs,
  reminderCopy,
  reminderKey,
  type ReminderEvent,
} from "@/lib/reminders/session-reminders";

const START = "2026-11-27T21:00:00Z"; // 3:00 PM Winnipeg
const at = (minsBefore: number) => new Date(Date.parse(START) - minsBefore * 60_000);
const call = (over: Partial<ReminderEvent> = {}): ReminderEvent => ({
  source: "pt_session",
  id: "s1",
  kind: "call",
  status: "Scheduled",
  startsAt: START,
  arrangedAt: "2026-11-20T15:00:00Z",
  ...over,
});
const pt = (over: Partial<ReminderEvent> = {}) => call({ kind: "pt", ...over });

describe("which reminder goes, and when", () => {
  it("a client's call: a day before, an hour before, ten minutes before", () => {
    expect(dueReminder(call(), "client", at(24 * 60 + 1))).toBeNull();
    expect(dueReminder(call(), "client", at(24 * 60))?.slot).toBe("24h");
    expect(dueReminder(call(), "client", at(60))?.slot).toBe("1h");
    expect(dueReminder(call(), "client", at(10))).toMatchObject({ slot: "10m", urgent: true });
    expect(dueReminder(call(), "client", at(0))).toBeNull();
  });

  it("the coach: ten minutes before a call, fifteen before training; a client's training a day and an hour before", () => {
    expect(dueReminder(call(), "coach", at(60))).toBeNull();
    expect(dueReminder(call(), "coach", at(10))?.slot).toBe("10m");
    expect(dueReminder(pt(), "coach", at(15))?.slot).toBe("15m");
    expect(dueReminder(pt(), "client", at(24 * 60))?.slot).toBe("24h");
    expect(dueReminder(pt(), "client", at(60))?.slot).toBe("1h");
    expect(dueReminder(pt(), "client", at(10))).toBeNull();
  });

  it("a cancelled one gets nothing; a moved one gets fresh keys", () => {
    expect(dueReminder(call({ status: "Cancelled" }), "client", at(10))).toBeNull();
    const moved = call({ startsAt: "2026-11-27T22:00:00Z" });
    expect(reminderKey(call(), "1h", "client")).not.toBe(reminderKey(moved, "1h", "client"));
  });

  it("a late booking only gets the reminders still ahead of it", () => {
    const late = call({ arrangedAt: at(90).toISOString() });
    expect(dueReminder(late, "client", at(24 * 60 - 1))).toBeNull();
    expect(dueReminder(late, "client", at(60))?.slot).toBe("1h");
    const veryLate = call({ arrangedAt: at(30).toISOString() });
    expect(dueReminder(veryLate, "client", at(59))).toBeNull();
    expect(dueReminder(veryLate, "client", at(10))?.slot).toBe("10m");
  });

  it("after a missed tick, only the nearest one goes, and a stale one never", () => {
    expect(dueReminder(call(), "client", at(9))?.slot).toBe("10m");
    expect(dueReminder(call(), "client", at(30))).toBeNull(); // the hour-before is 30 min stale
  });

  it("the day-before one waits out quiet hours; the short ones don't", () => {
    const quiet = { on: true, start: 22, end: 7 };
    expect(dueReminder(call(), "client", at(24 * 60), { quiet, localHour: 23 })).toBeNull();
    expect(dueReminder(call(), "client", at(24 * 60 - 8 * 60), { quiet, localHour: 7 })?.slot).toBe("24h");
    expect(dueReminder(call(), "client", at(60), { quiet, localHour: 23 })?.slot).toBe("1h");
    // never "a day before" once it's under three hours away
    expect(dueReminder(call(), "client", at(150), { quiet, localHour: 12 })).toBeNull();
  });

  it("each person's own choices, and training's day-before push stays quiet once the evening text went", () => {
    expect(dueReminder(call(), "client", at(60), { prefs: { hour: false } })).toBeNull();
    expect(dueReminder(call(), "client", at(10), { prefs: { hour: false } })?.slot).toBe("10m");
    expect(dueReminder(call(), "coach", at(10), { prefs: { soon: false } })).toBeNull();
    expect(dueReminder(pt({ textSent: true }), "client", at(24 * 60))).toBeNull();
    expect(readSlotPrefs({ day: false, hour: "no", soon: true })).toEqual({ day: false });
    expect(readSlotPrefs(null)).toEqual({});
  });
});

describe("what they say", () => {
  const base = { when: "3:00 PM", day: "tomorrow", title: "General Call", otherName: "Jared", location: null, joinUrl: "https://meet.google.com/abc" };
  it("the client's call reminders, the last one to join", () => {
    expect(reminderCopy({ ...base, kind: "call", audience: "client", slot: "24h" }).title).toBe("Call tomorrow at 3:00 PM");
    expect(reminderCopy({ ...base, kind: "call", audience: "client", slot: "10m" })).toEqual({ title: "Your call starts in 10 minutes", body: "Tap to join." });
  });
  it("the coach's, with who it is", () => {
    expect(reminderCopy({ ...base, kind: "call", audience: "coach", slot: "10m", otherName: "Sam Lifter" }).title).toBe("Sam Lifter in 10 min");
    expect(reminderCopy({ ...base, kind: "pt", audience: "coach", slot: "15m", otherName: "Sam", title: "PT Session", location: "800 Main St, Selkirk" }).body).toBe("PT Session · 3:00 PM · 800 Main St");
  });
  it("training", () => {
    expect(reminderCopy({ ...base, kind: "pt", audience: "client", slot: "1h", title: "PT Session", location: "800 Main St, Selkirk" })).toEqual({ title: "Training in 1 hour", body: "3:00 PM · 800 Main St" });
  });
  it("the coach's day in one line", () => {
    const s = daySummary(
      [
        { kind: "pt", startsAt: "2026-11-27T15:00:00Z", name: "Sam" },
        { kind: "call", startsAt: "2026-11-27T13:00:00Z", name: "Ana" },
        { kind: "pt", startsAt: "2026-11-27T17:00:00Z", name: null },
      ],
      (iso) => iso.slice(11, 16),
    );
    expect(s).toEqual({ calls: 1, sessions: 2, line: "2 sessions · 1 call, first at 13:00 (Ana)" });
    expect(daySummary([], () => "")).toBeNull();
  });
});
