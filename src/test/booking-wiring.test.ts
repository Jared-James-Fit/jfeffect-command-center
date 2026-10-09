import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { googleCalendarLink, icsDataLink, outlookCalendarLink } from "@/lib/add-to-calendar";

const read = (p: string) => readFileSync(p, "utf8");

describe("one place for booking", () => {
  it("Calendar has a Booking tab, and old Setup / booking links land on it", () => {
    const cal = read("src/routes/_authenticated/admin/calendar.tsx");
    expect(cal).toContain(
      'const TAB_VALUES = ["board", "booking", "sessions", "upcoming", "events"]',
    );
    expect(cal).toContain('setup: "booking"');
    expect(cal).toContain('"booking-links": "booking"');
    expect(cal).toContain("<AdminBookingPanel />");
  });

  it("booking cards and booking links are one list now", () => {
    expect(read("src/components/admin-calendar/pt-calendar-panel.tsx")).not.toContain(
      "BookingCardsPanel",
    );
    for (const gone of [
      "src/lib/booking-links.functions.ts",
      "src/components/booking-cards/booking-cards-panel.tsx",
      "src/components/appointments/send-booking-link-dialog.tsx",
      "src/route-pages/_authenticated/admin/booking-links.tsx",
    ]) {
      expect(existsSync(gone)).toBe(false);
    }
  });

  it("clients see Book above their sessions", () => {
    const page = read("src/routes/_authenticated/portal/calendar.tsx");
    expect(page.indexOf("<ClientBookCard />")).toBeGreaterThan(-1);
    expect(page.indexOf("<ClientBookCard />")).toBeLessThan(page.indexOf("<ClientSessionList"));
  });

  it("calendar sync covers Google, Apple, Outlook and any other app", () => {
    const fns = read("src/lib/schedule.functions.ts");
    expect(fns).toContain("outlookUrl:");
    expect(fns).toContain("office365Url:");
    const card = read("src/components/schedule/calendar-sync-card.tsx");
    for (const label of ["Apple Calendar", "Google Calendar", "Outlook", "Any other calendar app"])
      expect(card).toContain(label);
  });

  it("booked calls and video links reach the client's calendar feed", () => {
    const feed = read("src/lib/calendar-feed.server.ts");
    expect(feed).toContain("feedAppointments(admin, clientId");
    expect(feed).toContain("meet_link");
  });
});

describe("add to calendar links", () => {
  const e = {
    uid: "x@jfeffect.com",
    title: "1:1 Training",
    start: new Date("2026-10-12T11:00:00Z"),
    end: new Date("2026-10-12T12:00:00Z"),
    location: "Iron Image Gym",
  };
  it("Google gets the exact UTC times", () => {
    expect(googleCalendarLink(e)).toContain("dates=20261012T110000Z%2F20261012T120000Z");
  });
  it("Outlook gets ISO times", () => {
    expect(outlookCalendarLink(e)).toContain("startdt=2026-10-12T11%3A00%3A00.000Z");
  });
  it("Apple gets a real calendar file", () => {
    const ics = decodeURIComponent(icsDataLink(e).split(",")[1]);
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("DTSTART:20261012T110000Z");
    expect(ics).toContain("SUMMARY:1:1 Training");
  });
});
