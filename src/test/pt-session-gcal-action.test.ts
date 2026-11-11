import { describe, expect, it } from "vitest";
import { gcalAction } from "@/lib/pt-session-gcal.server";

const NOW = Date.parse("2026-11-11T20:10:00Z");
const DAY = 24 * 60 * 60 * 1000;
const at = (ms: number) => new Date(ms).toISOString();

describe("gcalAction: what the sync does with a session in Google", () => {
  it("writes a booked session until 2 days after it ends, then leaves it", () => {
    expect(gcalAction({ status: "Scheduled", ends_at: at(NOW + DAY) }, NOW)).toBe("write");
    expect(gcalAction({ status: "Scheduled", ends_at: at(NOW - DAY) }, NOW)).toBe("write");
    expect(gcalAction({ status: "Scheduled", ends_at: at(NOW - 3 * DAY) }, NOW)).toBe("keep");
  });

  it("writes a done session put back after the fact (Marc's Nov 9, added Nov 11)", () => {
    const nov9 = { status: "Completed", ends_at: "2026-11-09T16:30:00Z", time_set_at: "2026-11-11T20:03:07Z", google_event_id: null };
    expect(gcalAction(nov9, NOW)).toBe("write");
  });

  it("leaves done history alone: one with an event, one added long ago, one from over a month back", () => {
    const base = { status: "Completed", ends_at: "2026-11-09T16:30:00Z", time_set_at: "2026-11-11T20:03:07Z" };
    expect(gcalAction({ ...base, google_event_id: "ev1" }, NOW)).toBe("keep");
    expect(gcalAction({ ...base, time_set_at: "2026-11-02T12:00:00Z", google_event_id: null }, NOW)).toBe("keep");
    expect(gcalAction({ ...base, ends_at: at(NOW - 40 * DAY), google_event_id: null }, NOW)).toBe("keep");
    expect(gcalAction({ ...base, time_set_at: null, google_event_id: null }, NOW)).toBe("keep");
  });

  it("takes a cancel or move off Google only before it ends", () => {
    expect(gcalAction({ status: "Cancelled", ends_at: at(NOW + DAY), google_event_id: "ev" }, NOW)).toBe("remove");
    expect(gcalAction({ status: "Rescheduled", ends_at: at(NOW + DAY), google_event_id: "ev" }, NOW)).toBe("remove");
    expect(gcalAction({ status: "Missed", ends_at: at(NOW + DAY), google_event_id: "ev" }, NOW)).toBe("remove");
    expect(gcalAction({ status: "Cancelled", ends_at: at(NOW - DAY), google_event_id: "ev" }, NOW)).toBe("keep");
    expect(gcalAction({ status: "Cancelled", ends_at: at(NOW + DAY), google_event_id: null }, NOW)).toBe("keep");
  });

  it("never adds a cancelled or missed session added after the fact", () => {
    const late = { ends_at: "2026-11-09T16:30:00Z", time_set_at: "2026-11-11T20:03:07Z", google_event_id: null };
    expect(gcalAction({ ...late, status: "Cancelled" }, NOW)).toBe("keep");
    expect(gcalAction({ ...late, status: "Missed" }, NOW)).toBe("keep");
  });
});
