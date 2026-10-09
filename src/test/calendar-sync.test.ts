import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { calendarAppFromUserAgent, calendarSyncState, SYNC_FRESH_MS, CONNECTING_WINDOW_MS } from "@/lib/calendar-sync";
import { buildIcsFeed } from "@/lib/ics-feed";

describe("which calendar app pulled the feed", () => {
  it("recognises the real calendar apps", () => {
    expect(calendarAppFromUserAgent("Google-Calendar-Importer")).toBe("Google Calendar");
    expect(calendarAppFromUserAgent("Mozilla/5.0 (compatible; Google-Calendar-Importer)")).toBe("Google Calendar");
    expect(calendarAppFromUserAgent("iOS/18.0 (22A3354) dataaccessd/1.0")).toBe("Apple Calendar");
    expect(calendarAppFromUserAgent("macOS/14.0 (23A344) CalendarAgent/988")).toBe("Apple Calendar");
    expect(calendarAppFromUserAgent("Microsoft Outlook 16.0")).toBe("Outlook");
  });

  it("never counts a browser or a link preview as synced", () => {
    expect(calendarAppFromUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1")).toBeNull();
    expect(calendarAppFromUserAgent("facebookexternalhit/1.1")).toBeNull();
    expect(calendarAppFromUserAgent("Slackbot-LinkExpanding 1.0")).toBeNull();
    expect(calendarAppFromUserAgent("curl/8.0")).toBeNull();
    expect(calendarAppFromUserAgent("")).toBeNull();
  });
});

describe("sync state for the Setup card", () => {
  const now = Date.parse("2026-10-09T12:00:00Z");
  it("is green after a recent fetch", () => {
    expect(calendarSyncState({ lastFetchAt: "2026-10-09T08:00:00Z", now })).toBe("synced");
  });
  it("shows connecting right after tapping add, then gives up quietly", () => {
    expect(calendarSyncState({ lastFetchAt: null, startedAt: now - 60_000, now })).toBe("connecting");
    expect(calendarSyncState({ lastFetchAt: null, startedAt: now - CONNECTING_WINDOW_MS - 1, now })).toBe("off");
  });
  it("flags a calendar that stopped checking in", () => {
    expect(calendarSyncState({ lastFetchAt: new Date(now - SYNC_FRESH_MS - 1).toISOString(), now })).toBe("stale");
  });
  it("is off when nothing happened", () => {
    expect(calendarSyncState({ lastFetchAt: null, now })).toBe("off");
  });
});

describe("workouts in the feed", () => {
  it("are all-day, free, and have no midnight alarm", () => {
    const ics = buildIcsFeed({
      name: "JF Effect",
      now: new Date("2026-10-08T00:00:00Z"),
      events: [{ uid: "workout-1@jfeffect.com", start: new Date(), end: new Date(), allDayDate: "2026-10-31", summary: "Workout: Upper B" }],
    });
    expect(ics).toContain("DTSTART;VALUE=DATE:20261031");
    expect(ics).toContain("DTEND;VALUE=DATE:20261101");
    expect(ics).toContain("TRANSP:TRANSPARENT");
    expect(ics).not.toContain("VALARM");
  });
});

describe("theme", () => {
  it("registers the success and warning colors Tailwind classes rely on", () => {
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).toContain("--color-success: var(--success);");
    expect(css).toContain("--color-warning: var(--warning);");
  });
});
