import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { deriveOverallRating, initialEffort, trustedSessionRpe, REVIEW_VERSION } from "@/lib/workout-review";

describe("quick check-out (review v2)", () => {
  it("derives overall_rating from real answers instead of asking", () => {
    expect(deriveOverallRating({ pain: true, sessionRpe: 7, recoveryToday: 5 })).toBe(2);
    expect(deriveOverallRating({ pain: false, sessionRpe: 10, recoveryToday: 4 })).toBe(3);
    expect(deriveOverallRating({ pain: false, sessionRpe: 8, recoveryToday: 2 })).toBe(3);
    expect(deriveOverallRating({ pain: false, sessionRpe: 8, recoveryToday: 5 })).toBe(5);
    expect(deriveOverallRating({ pain: false, sessionRpe: 9, recoveryToday: null })).toBe(4);
  });

  it("pre-fills effort from logged RPE, but never trusts a legacy derived RPE", () => {
    expect(initialEffort(null, 8)).toBe(8);
    expect(initialEffort({ submittedAt: "x", sessionRpe: 5, reviewVersion: null }, 9)).toBe(9);
    expect(initialEffort({ submittedAt: "x", sessionRpe: 7, reviewVersion: 2 }, 9)).toBe(7);
    expect(trustedSessionRpe({ session_rpe: 7, review_version: null })).toBeNull();
    expect(trustedSessionRpe({ session_rpe: 9, review_version: REVIEW_VERSION })).toBe(9);
  });

  it("is one screen that can finish in a single tap and stores the version", () => {
    const editor = readFileSync("src/components/workout/shared/workout-review-editor.tsx", "utf8");
    const server = readFileSync("src/lib/workout-completion.functions.ts", "utf8");
    expect(editor).toContain("initialEffort(initial, suggestedSessionRpe)");
    expect(editor).toContain("reviewVersion: REVIEW_VERSION");
    expect(editor).not.toContain("Need Attention");
    expect(server).toContain("review_version: data.reviewVersion ?? null");
  });

  it("feeds the athlete's session RPE and pain into the recovery score", () => {
    const rec = readFileSync("src/lib/analytics/recovery-score.ts", "utf8");
    expect(rec).toContain("sessionRpe: sessionRpeByCompletion.get(c.id) ?? effRpe");
    expect(rec).toContain("pain: painByCompletion.has(c.id)");
  });
});

describe("load suggestions in the logger", () => {
  const wdv = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
  it("builds a model per exercise and shows a card plus a per-set tap-to-use chip", () => {
    expect(wdv).toContain("buildLoadModel({ history: loadHistory, today, unit: activeUnit, readiness, warmup: warmupForModel })");
    expect(wdv).toContain("<LoadSuggestionCard hint={loadHint} model={loadModel} plan={loadPlan} />");
    expect(wdv).toContain("onClick={() => setLoad(fmtNum(loadHint.target))}");
  });
  it("never competes with a coach's fixed load or top-set back-off", () => {
    expect(wdv).toContain('const coachOwnsLoad = !!row.manual_override || row.percentage_basis === "top_set";');
  });
});
