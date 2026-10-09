import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  calendarAppFromUserAgent,
  calendarChoices,
  calendarSyncState,
  connectingMessage,
  devicePlatform,
  SYNC_FRESH_MS,
  CONNECTING_WINDOW_MS,
} from "@/lib/calendar-sync";
import { buildIcsFeed } from "@/lib/ics-feed";

describe("which calendar app pulled the feed", () => {
  it("recognises the real calendar apps", () => {
    expect(calendarAppFromUserAgent("Google-Calendar-Importer")).toBe("Google Calendar");
    expect(calendarAppFromUserAgent("Mozilla/5.0 (compatible; Google-Calendar-Importer)")).toBe("Google Calendar");
    expect(calendarAppFromUserAgent("iOS/18.0 (22A3354) dataaccessd/1.0")).toBe("Apple Calendar");
    expect(calendarAppFromUserAgent("macOS/14.0 (23A344) CalendarAgent/988")).toBe("Apple Calendar");
    expect(calendarAppFromUserAgent("Microsoft Outlook 16.0")).toBe("Outlook");
  });

  it("counts any Apple system service, and calendar apps it doesn't know by name", () => {
    // Whatever daemon (or iCloud) refreshes an iPhone subscription, a working sync must go green.
    expect(calendarAppFromUserAgent("iOS/26.0 (23A341) calaccessd/1.0")).toBe("Apple Calendar");
    expect(calendarAppFromUserAgent("iPadOS/26.0 (23A341) somedaemon/2.0")).toBe("Apple Calendar");
    expect(calendarAppFromUserAgent("ICSx5/2.3 (ical4j/3.2; okhttp/4.12) Android/14")).toBe("Calendar app");
    expect(calendarAppFromUserAgent("Fantastical/4.0 CFNetwork/1498 Darwin/24.0.0")).toBe("Calendar app");
  });

  it("never counts a browser, a link preview or a dev tool as synced", () => {
    expect(calendarAppFromUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1")).toBeNull();
    expect(calendarAppFromUserAgent("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36")).toBeNull();
    expect(calendarAppFromUserAgent("facebookexternalhit/1.1")).toBeNull();
    expect(calendarAppFromUserAgent("Slackbot-LinkExpanding 1.0")).toBeNull();
    expect(calendarAppFromUserAgent("curl/8.0")).toBeNull();
    expect(calendarAppFromUserAgent("pg_net/0.10")).toBeNull();
    expect(calendarAppFromUserAgent("python-requests/2.32")).toBeNull();
    expect(calendarAppFromUserAgent("")).toBeNull();
  });
});

describe("connect choices per device", () => {
  const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";
  const IPAD_DESKTOP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15";
  const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36";
  const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129.0 Safari/537.36";

  it("knows the device, including an iPad that says it's a Mac", () => {
    expect(devicePlatform(IPHONE)).toBe("ios");
    expect(devicePlatform(IPAD_DESKTOP_UA, 5)).toBe("ios");
    expect(devicePlatform(IPAD_DESKTOP_UA, 0)).toBe("mac");
    expect(devicePlatform(ANDROID)).toBe("android");
    expect(devicePlatform(WINDOWS)).toBe("windows");
    expect(devicePlatform("")).toBe("other");
  });

  it("iPhone: Apple is one tap and first; Google and Outlook get the steps that work, never a dead link", () => {
    const c = calendarChoices("ios");
    expect(c.map((x) => x.id)).toEqual(["apple", "google", "outlook"]);
    expect(c[0].how).toBe("subscribe");
    expect(c.find((x) => x.id === "google")?.how).toBe("web");
    expect(c.find((x) => x.id === "outlook")?.how).toBe("web");
  });

  it("Android: Google first with web steps, no Apple", () => {
    const c = calendarChoices("android");
    expect(c.map((x) => x.id)).toEqual(["google", "outlook"]);
    expect(c.every((x) => x.how === "web")).toBe(true);
  });

  it("computers get the one-click add links", () => {
    expect(calendarChoices("windows").map((x) => [x.id, x.how])).toEqual([
      ["google", "link"],
      ["outlook", "link"],
      ["apple", "subscribe"],
    ]);
    expect(calendarChoices("mac")[0]).toMatchObject({ id: "apple", how: "subscribe" });
    expect(calendarChoices("mac").find((x) => x.id === "google")?.how).toBe("link");
  });

  it("the waiting message matches the calendar they picked", () => {
    expect(connectingMessage("Google Calendar")).toMatch(/Google's website/);
    expect(connectingMessage("Apple Calendar")).toMatch(/Subscribe/);
    expect(connectingMessage(null)).toMatch(/check in/);
  });

  it("feed links end in .ics, which the feed route strips before the token check", () => {
    const fns = readFileSync("src/lib/schedule.functions.ts", "utf8");
    expect(fns).toContain("/api/public/calendar-feed?t=${token}.ics");
    const route = readFileSync("src/routes/api/public/calendar-feed.ts", "utf8");
    expect(route).toContain('.replace(/\\.ics$/i, "")');
  });

  it("phones never get Google's add-by-link URL as a plain tap target", () => {
    const card = readFileSync("src/components/schedule/calendar-sync-card.tsx", "utf8");
    expect(card).toContain("Send the link to my computer");
    expect(card).toContain("Request Desktop Website");
    expect(card).toContain("Add Subscribed Calendar");
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
