import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compareInstants } from "@/lib/schedule-time";

describe("calendar rows are ordered by when they happen", () => {
  it("puts an 8:30 session before Google's 10 AM and 1:30 PM, whatever their text", () => {
    const rows = [
      { t: "PT Session - Nicolas", at: "2026-10-31T10:00:00-05:00" },
      { t: "Commic Con", at: "2026-10-31T13:30:00-05:00" },
      { t: "Nicolas Galli", at: "2026-10-31T13:30:00.000Z" },
    ];
    expect([...rows].sort((a, b) => compareInstants(a.at, b.at)).map((r) => r.t)).toEqual(["Nicolas Galli", "PT Session - Nicolas", "Commic Con"]);
  });

  it("puts missing times first", () => {
    expect(compareInstants(null, "2026-10-31T13:30:00Z")).toBe(-1);
    expect(compareInstants("2026-10-31T13:30:00Z", "2026-10-31T08:30:00-05:00")).toBe(0);
  });

  it("every agenda that mixes Google and app times uses it", () => {
    for (const f of [
      "src/components/admin-calendar/dashboard-schedule-card.tsx",
      "src/components/calendar/calendar-board.tsx",
      "src/lib/home-upcoming.ts",
      "src/components/workouts/WorkoutsExperience.tsx",
    ]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toContain("compareInstants(");
      expect(src, f).not.toMatch(/startsAt \?\? ""\)\.localeCompare/);
    }
  });
});

describe("the Google sync writes to the event, never an invitation copy", () => {
  it("looks up the organizer's calendar before an update", () => {
    const src = readFileSync("src/lib/pt-session-gcal.server.ts", "utf8");
    expect(src).toContain("target = (await organizerCalendarOf(target, eventId, writable)) ?? target;");
    expect(src).toContain("if (!org?.email || isOrganizerCopy(r.data, calendarId)) return null;");
    expect(src).toMatch(/c\.accessRole === "owner" \|\| c\.accessRole === "writer"/);
  });
});
