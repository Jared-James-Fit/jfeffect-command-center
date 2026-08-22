import { describe, expect, it } from "vitest";
import { selectHomeUpcoming, HOME_MAX_TODAY_ROWS } from "@/lib/home-upcoming";

const item = (o: Partial<any>): any => ({
  id: o.id ?? Math.random().toString(36),
  kind: o.kind ?? "workout",
  date: o.date ?? "2026-08-24",
  title: o.title ?? "Day 1",
  ...o,
});

const TODAY = "2026-08-22";
const NOW = Date.parse("2026-08-22T14:00:00Z");

describe("client home upcoming summary", () => {
  it("shows today's remaining events first, not the whole week", () => {
    const out = selectHomeUpcoming(
      [
        item({ id: "a", date: TODAY, kind: "pt_session", title: "Personal Training", startsAt: "2026-08-22T20:00:00Z" }),
        item({ id: "b", date: TODAY, title: "Day 1 Workout" }),
        item({ id: "c", date: "2026-08-24" }),
        item({ id: "d", date: "2026-08-25" }),
        item({ id: "e", date: "2026-08-27" }),
      ],
      { today: TODAY, nowMs: NOW },
    );
    expect(out.mode).toBe("today");
    expect(out.rows.map((r) => r.id)).toEqual(["b", "a"]);
    expect(out.rows.length).toBeLessThanOrEqual(HOME_MAX_TODAY_ROWS);
  });

  it("caps compact rows and reports the remainder", () => {
    const rows = ["1", "2", "3", "4", "5"].map((id) => item({ id, date: TODAY }));
    const out = selectHomeUpcoming(rows, { today: TODAY, nowMs: NOW });
    expect(out.rows).toHaveLength(HOME_MAX_TODAY_ROWS);
    expect(out.moreCount).toBe(2);
  });

  it("prefers appointments when trimming", () => {
    const out = selectHomeUpcoming(
      [
        item({ id: "w1", date: TODAY }),
        item({ id: "w2", date: TODAY }),
        item({ id: "w3", date: TODAY }),
        item({ id: "pt", date: TODAY, kind: "appointment", startsAt: "2026-08-22T23:00:00Z" }),
      ],
      { today: TODAY, nowMs: NOW },
    );
    expect(out.rows.some((r) => r.id === "pt")).toBe(true);
  });

  it("falls back to the next scheduled day when today is empty, max two rows", () => {
    const out = selectHomeUpcoming(
      [
        item({ id: "n1", date: "2026-08-24" }),
        item({ id: "n2", date: "2026-08-24" }),
        item({ id: "n3", date: "2026-08-24" }),
        item({ id: "later", date: "2026-08-25" }),
      ],
      { today: TODAY, nowMs: NOW },
    );
    expect(out.mode).toBe("next");
    expect(out.rows).toHaveLength(2);
    expect(out.moreCount).toBe(2);
  });

  it("drops cancelled events and de-duplicates", () => {
    const out = selectHomeUpcoming(
      [
        item({ id: "x", date: TODAY, status: "Cancelled" }),
        item({ id: "y", date: TODAY }),
        item({ id: "y", date: TODAY }),
      ],
      { today: TODAY, nowMs: NOW },
    );
    expect(out.rows.map((r) => r.id)).toEqual(["y"]);
  });

  it("reports empty when nothing is scheduled", () => {
    expect(selectHomeUpcoming([], { today: TODAY, nowMs: NOW })).toMatchObject({ mode: "empty", rows: [] });
  });

  it("reflects a reschedule immediately (source items are the only input)", () => {
    const moved = selectHomeUpcoming([item({ id: "w", date: "2026-08-26" })], { today: TODAY, nowMs: NOW });
    expect(moved.mode).toBe("next");
    expect(moved.rows[0].date).toBe("2026-08-26");
  });
});
