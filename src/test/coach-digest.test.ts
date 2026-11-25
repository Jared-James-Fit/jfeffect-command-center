import { describe, expect, it } from "vitest";
import { coachDigest, coachDigestLines, programsEndingCount, unansweredCount, type CoachDigestCounts } from "@/lib/reminders/coach-digest";

const none: CoachDigestCounts = {
  today: null,
  checkInsToReview: 0,
  programsEnding: 0,
  onboardingIncomplete: 0,
  failedPayments: 0,
  unansweredMessages: 0,
  nutritionDue: 0,
  nutritionPlansToApply: 0,
  liftVideos: 0,
};

describe("the coach's morning game plan is one push", () => {
  it("nothing waiting, nothing sent", () => {
    expect(coachDigest(none)).toBeNull();
  });

  it("most urgent first, at most four lines, the rest counted, opening the first thing", () => {
    const d = coachDigest({ ...none, today: "2 sessions · 1 call, first at 7:00 AM (Sam)", failedPayments: 1, unansweredMessages: 3, checkInsToReview: 2, programsEnding: 1, liftVideos: 4 })!;
    expect(d.body).toBe("Today: 2 sessions · 1 call, first at 7:00 AM (Sam) · 1 failed payment · 3 clients waiting on a reply · 2 check-ins to review · +2 more");
    expect(d.url).toBe("/admin/plans");
    expect(coachDigest({ ...none, checkInsToReview: 1 })!.url).toBe("/admin/check-in-reviews");
    expect(coachDigestLines({ ...none, onboardingIncomplete: 1, programsEnding: 2 })).toEqual(["1 new client still onboarding", "2 programs ending this week"]);
  });

  it("a client is waiting when the chat's last word is theirs and 12 hours old", () => {
    const now = new Date("2026-11-25T20:00:00Z");
    expect(
      unansweredCount(
        [
          { sender_role: "client", created_at: "2026-11-25T06:00:00Z" },
          { sender_role: "client", created_at: "2026-11-25T19:00:00Z" },
          { sender_role: "coach", created_at: "2026-11-24T06:00:00Z" },
        ],
        now,
      ),
    ).toBe(1);
  });

  it("a program is ending when the client's latest one ends this week", () => {
    expect(
      programsEndingCount(
        [
          { client_id: "a", end_date: "2026-11-28" },
          { client_id: "b", end_date: "2026-11-27" },
          { client_id: "b", end_date: "2027-01-15" },
          { client_id: "c", end_date: "2026-12-10" },
        ],
        "2026-11-25",
      ),
    ).toBe(1);
  });
});
