import { describe, expect, it } from "vitest";
import { isOverdue, moveOutcome, sessionCredit, sessionStatusLabel, statusForDate } from "@/lib/session-credit";

const today = "2026-10-22";

describe("a session's credit reads from its status", () => {
  it("holds one while booked and says when it's used", () => {
    expect(sessionCredit({ status: "Scheduled", session_date: "2026-10-30" }, today)).toEqual({
      state: "held", label: "Holds 1 credit", detail: "Counts as used after Fri Oct 30.",
    });
    expect(sessionCredit({ status: "Scheduled", session_date: today }, today).detail).toBe("Counts as used tonight, once the day is over.");
  });

  it("uses one when done or missed, banks it when cancelled", () => {
    expect(sessionCredit({ status: "Completed", session_date: "2026-10-20" }, today).state).toBe("used");
    expect(sessionCredit({ status: "Missed", session_date: "2026-10-20" }, today)).toMatchObject({ state: "used", detail: "Late cancel or no-show: counted as one of their sessions." });
    expect(sessionCredit({ status: "Cancelled", session_date: "2026-10-30" }, today)).toMatchObject({ state: "banked", label: "Credit banked" });
    expect(sessionCredit({ status: "Rescheduled", session_date: "2026-10-30" }, today).state).toBe("banked");
  });

  it("never mentions credits for a session that doesn't use one", () => {
    expect(sessionCredit({ status: "Completed", session_date: "2026-10-20", uses_credit: false }, today).state).toBe("free");
  });

  it("flags a booked session whose day is over (left for the coach)", () => {
    expect(isOverdue({ status: "Scheduled", session_date: "2026-10-21" }, today)).toBe(true);
    expect(isOverdue({ status: "Scheduled", session_date: today }, today)).toBe(false);
    expect(isOverdue({ status: "Completed", session_date: "2026-10-21" }, today)).toBe(false);
    expect(sessionCredit({ status: "Scheduled", session_date: "2026-10-21" }, today).detail).toMatch(/waiting on you/);
  });
});

describe("moving a session", () => {
  it("is done on a day that's over and booked otherwise", () => {
    expect(statusForDate("2026-10-21", today)).toBe("Completed");
    expect(statusForDate(today, today)).toBe("Scheduled");
    expect(statusForDate("2026-11-02", today)).toBe("Scheduled");
  });

  it("says what happens to the credit", () => {
    expect(moveOutcome("2026-11-02", today)).toBe("Holds 1 credit, used after Mon Nov 2.");
    expect(moveOutcome("2026-10-20", today)).toBe("That day is over, so it counts as done: 1 credit used.");
    expect(moveOutcome("2026-11-02", today, false)).toBe("Booked.");
  });
});

describe("status words", () => {
  it("reads like the coach talks", () => {
    expect(["Scheduled", "Completed", "Missed", "Cancelled"].map(sessionStatusLabel)).toEqual(["Booked", "Done", "Missed", "Cancelled"]);
  });
});
