import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  inSmsSendWindow, pickAnchorMessages, reminderLookbackMs, SMS_CLIENT_COOLDOWN_MS,
} from "@/lib/sms-reminder-rules";
import { birthdayPushYear } from "@/lib/birthday-push";

describe("reminder lookback", () => {
  it("is the longest enabled step plus a day, not 30 days", () => {
    const steps = [{ delay_minutes: 1440, enabled: true }, { delay_minutes: 2880, enabled: true }];
    expect(reminderLookbackMs(steps)).toBe((2880 + 1440) * 60_000); // 72h
    expect(reminderLookbackMs([{ delay_minutes: 2880, enabled: false }, { delay_minutes: 1440 }])).toBe((1440 + 1440) * 60_000);
    expect(reminderLookbackMs([])).toBe(24 * 3600_000);
  });
});

describe("send window", () => {
  it("is 9am to 8pm in the client's timezone", () => {
    // 2026-10-07T15:00Z = 10:00 in Winnipeg (CDT), 08:00 in Vancouver
    const t = new Date("2026-10-07T15:00:00Z");
    expect(inSmsSendWindow("America/Winnipeg", t)).toBe(true);
    expect(inSmsSendWindow("America/Vancouver", t)).toBe(false);
    expect(inSmsSendWindow(null, t)).toBe(true); // defaults to Winnipeg
    expect(inSmsSendWindow("Not/AZone", t)).toBe(true); // bad tz falls back to Winnipeg
    // 8pm sharp is already out; 3am is out
    expect(inSmsSendWindow("America/Winnipeg", new Date("2026-10-08T01:00:00Z"))).toBe(false);
    expect(inSmsSendWindow("America/Winnipeg", new Date("2026-10-07T08:00:00Z"))).toBe(false);
  });
});

describe("anchor messages", () => {
  it("keeps one message per client, the oldest unread one", () => {
    const msgs = [
      { id: "a2", client_id: "A", created_at: "2026-10-06T12:00:00Z" },
      { id: "a1", client_id: "A", created_at: "2026-10-05T12:00:00Z" },
      { id: "b1", client_id: "B", created_at: "2026-10-06T09:00:00Z" },
    ];
    expect(pickAnchorMessages(msgs).map((m) => m.id)).toEqual(["a1", "b1"]);
    expect(SMS_CLIENT_COOLDOWN_MS).toBe(24 * 3600_000);
  });
});

describe("birthday push timing", () => {
  it("fires on the client's LOCAL birthday, in the morning or later, not the UTC date", () => {
    // 2026-10-08T00:05Z is still Oct 7 at 7:05pm in Winnipeg.
    const justAfterUtcMidnight = new Date("2026-10-08T00:05:00Z");
    expect(birthdayPushYear("1990-10-08", "America/Winnipeg", justAfterUtcMidnight)).toBeNull(); // the old bug: "birthday" the evening before
    // Their real birthday is Oct 7 locally, and 7:05pm is still inside the 9am-9pm window.
    expect(birthdayPushYear("1990-10-07", "America/Winnipeg", justAfterUtcMidnight)).toBe(2026);
    // 9:05am Winnipeg on Oct 8
    expect(birthdayPushYear("1990-10-08", "America/Winnipeg", new Date("2026-10-08T14:05:00Z"))).toBe(2026);
    // 6:05am is too early, 9:05pm is too late
    expect(birthdayPushYear("1990-10-08", "America/Winnipeg", new Date("2026-10-08T11:05:00Z"))).toBeNull();
    expect(birthdayPushYear("1990-10-08", "America/Winnipeg", new Date("2026-10-09T02:05:00Z"))).toBeNull();
    // Missing or bad data never fires
    expect(birthdayPushYear(null, "America/Winnipeg")).toBeNull();
    expect(birthdayPushYear("garbage", null)).toBeNull();
  });

  it("celebrates a Feb 29 birthday on Feb 28 in common years only", () => {
    expect(birthdayPushYear("1992-02-29", "America/Winnipeg", new Date("2027-02-28T16:00:00Z"))).toBe(2027);
    expect(birthdayPushYear("1992-02-29", "America/Winnipeg", new Date("2028-02-28T16:00:00Z"))).toBeNull(); // 2028 is a leap year
    expect(birthdayPushYear("1992-02-29", "America/Winnipeg", new Date("2028-02-29T16:00:00Z"))).toBe(2028);
  });
});
