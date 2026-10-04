import { describe, expect, it } from "vitest";
import { inQuietHours, localHour, quietEndsAt } from "@/lib/push/push.server";
import { digestBody, plural } from "@/lib/push/scheduled-pushes.server";
import { APP_EVENTS } from "@/lib/push/app-events.server";

describe("quiet hours", () => {
  it("handles windows that wrap midnight", () => {
    expect(inQuietHours(22, 22, 7)).toBe(true);
    expect(inQuietHours(3, 22, 7)).toBe(true);
    expect(inQuietHours(7, 22, 7)).toBe(false);
    expect(inQuietHours(12, 22, 7)).toBe(false);
  });
  it("handles same-day windows and off", () => {
    expect(inQuietHours(14, 13, 15)).toBe(true);
    expect(inQuietHours(15, 13, 15)).toBe(false);
    expect(inQuietHours(5, 9, 9)).toBe(false);
  });
  it("holds until quiet hours end in local time", () => {
    // 23:30 Winnipeg (CDT, UTC-5) → release at ~07:05 local the next day.
    const at = new Date("2026-10-05T04:30:00Z");
    expect(localHour("America/Winnipeg", at)).toBe(23);
    const release = quietEndsAt("America/Winnipeg", 7, at);
    expect(localHour("America/Winnipeg", release)).toBe(7);
    expect(release.getTime()).toBeGreaterThan(at.getTime());
    expect(release.getTime() - at.getTime()).toBeLessThan(9 * 3_600_000);
  });
  it("falls back on a bad time zone", () => {
    expect(() => localHour("Not/AZone")).not.toThrow();
  });
});

describe("digest copy", () => {
  it("only builds a body when something is due", () => {
    expect(digestBody([null, false, undefined])).toBeNull();
    expect(digestBody([`${plural(1, "lift video")} to review`, `${plural(2, "AI plan")} to apply`]))
      .toBe("1 lift video to review · 2 AI plans to apply");
  });
});

describe("app events", () => {
  it("keep lockscreen copy content-free", () => {
    for (const spec of Object.values(APP_EVENTS)) {
      expect(spec.body.length).toBeLessThan(90);
      expect(spec.body).not.toMatch(/\d+\s*(g|kcal|cal|lbs?|kg)\b/i);
      expect(spec.rateMinutes).toBeGreaterThanOrEqual(60);
    }
  });
});
