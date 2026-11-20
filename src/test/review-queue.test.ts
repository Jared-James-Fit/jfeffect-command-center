import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { TO_REVIEW_DAYS, waitingForReview, type ReviewCandidate } from "@/lib/review-queue";

const now = Date.parse("2026-11-20T15:00:00Z");
const ago = (h: number) => new Date(now - h * 3_600_000).toISOString();
const c = (over: Partial<ReviewCandidate> & { id: string }): ReviewCandidate & { id: string } => ({
  clientId: "reece",
  type: "checkin:weekly_checkin",
  submittedAt: ago(24),
  reviewed: false,
  ...over,
});

describe("what's waiting on the coach's review", () => {
  it("not reviewed, recent, not superseded", () => {
    expect(waitingForReview([c({ id: "a" })], now)).toHaveLength(1);
    expect(waitingForReview([c({ id: "a", reviewed: true })], now)).toHaveLength(0);
    expect(waitingForReview([c({ id: "a", reviewed: null })], now)).toHaveLength(0);
    expect(waitingForReview([c({ id: "a", superseded: true })], now)).toHaveLength(0);
    expect(waitingForReview([c({ id: "a", submittedAt: ago(24 * TO_REVIEW_DAYS - 1) })], now)).toHaveLength(1);
    expect(waitingForReview([c({ id: "a", submittedAt: ago(24 * TO_REVIEW_DAYS + 1) })], now)).toHaveLength(0);
    expect(waitingForReview([c({ id: "a", submittedAt: null })], now)).toHaveLength(0);
  });

  it("only the client's newest of a type; reviewed or not, a newer one retires the older", () => {
    const rows = [c({ id: "w1", submittedAt: ago(24 * 9) }), c({ id: "w2", submittedAt: ago(24 * 2) })];
    expect(waitingForReview(rows, now).map((r) => r.id)).toEqual(["w2"]);
    rows[1].reviewed = true;
    expect(waitingForReview(rows, now)).toEqual([]);
  });

  it("types and clients are separate; no client means nothing to compare with", () => {
    const rows = [
      c({ id: "w" }),
      c({ id: "n", type: "native:nutrition" }),
      c({ id: "j", clientId: "jarrett" }),
      c({ id: "x1", clientId: null, type: "application:x" }),
      c({ id: "x2", clientId: null, type: "application:x", submittedAt: ago(1) }),
    ];
    expect(waitingForReview(rows, now).map((r) => r.id)).toEqual(["w", "n", "j", "x1", "x2"]);
  });

  it("the dashboard, Forms → Submissions and the Messages inbox all read it", () => {
    expect(readFileSync("src/lib/form-submissions.ts", "utf8")).toContain("waitingForReview(");
    expect(readFileSync("src/lib/inbox-requests.ts", "utf8")).toContain("waitingForReview(");
    expect(readFileSync("src/components/forms/checkins-to-review-card.tsx", "utf8")).toContain("toReviewKeys(");
  });
});
