import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  checkoutCta,
  deriveOverallRating,
  effortChip,
  EFFORT_OPTIONS,
  initialEffort,
  sleepChip,
  trustedSessionRpe,
  REVIEW_VERSION,
  SLEEP_OPTIONS,
} from "@/lib/workout-review";
import { sleepBucketHours, sleepBucketLabel } from "@/lib/analytics/recovery-score";

describe("quick check-out (review v2)", () => {
  it("derives overall_rating from real answers instead of asking", () => {
    expect(deriveOverallRating({ pain: true, sessionRpe: 7, recoveryToday: 5 })).toBe(2);
    expect(deriveOverallRating({ pain: false, sessionRpe: 10, recoveryToday: 4 })).toBe(3);
    expect(deriveOverallRating({ pain: false, sessionRpe: 8, recoveryToday: 2 })).toBe(3);
    expect(deriveOverallRating({ pain: false, sessionRpe: 8, recoveryToday: 5 })).toBe(5);
    expect(deriveOverallRating({ pain: false, sessionRpe: 9, recoveryToday: null })).toBe(4);
  });

  it("never pre-fills effort; only reopens a real v2 answer", () => {
    expect(initialEffort(null)).toBeNull();
    expect(initialEffort({ submittedAt: "x", sessionRpe: 5, reviewVersion: null })).toBeNull();
    expect(initialEffort({ submittedAt: "x", sessionRpe: 7, reviewVersion: 2 })).toBe(7);
    expect(trustedSessionRpe({ session_rpe: 7, review_version: null })).toBeNull();
    expect(trustedSessionRpe({ session_rpe: 9, review_version: REVIEW_VERSION })).toBe(9);
  });

  it("shows effort as words and stores values that match the recovery buckets", () => {
    expect(EFFORT_OPTIONS.map((o) => o.label)).toEqual(["Easy", "Moderate", "Hard", "Very hard", "Max"]);
    // recovery-score: <6 easy, 6–7 moderate, 8 hard, 9+ very hard
    expect(EFFORT_OPTIONS.map((o) => o.v)).toEqual([5, 7, 8, 9, 10]);
    expect(effortChip(6)).toBe(5); // earlier reviews stored "Easy" as 6
    expect(effortChip(8)).toBe(8);
    expect(effortChip(null)).toBeNull();
    expect(initialEffort({ submittedAt: "x", sessionRpe: 6, reviewVersion: 2 })).toBe(6);
    const editor = readFileSync("src/components/workout/shared/workout-review-editor.tsx", "utf8");
    expect(editor).not.toContain('tabular-nums">{o.v}');
  });

  it("asks sleep anchored on 8h and still shows older answers", () => {
    expect(SLEEP_OPTIONS.map((o) => o.label)).toEqual(["<5h", "5–6h", "6–7h", "7–8h", "8h+"]);
    expect(sleepChip("8_9")).toBe("gte8");
    expect(sleepChip("gte9")).toBe("gte8");
    expect(sleepChip("7_8")).toBe("7_8");
    expect(sleepChip("gte7")).toBeNull();
    expect(sleepChip("5_6")).toBe("5_6");
    expect(sleepChip(null)).toBeNull();
    expect(sleepBucketHours("gte8")).toBe(8.5);
    expect(sleepBucketLabel("gte8")).toBe("8h+");
    expect(sleepBucketLabel("gte7")).toBe("7h+");
    const server = readFileSync("src/lib/workout-completion.functions.ts", "utf8");
    expect(server).toContain('"gte9", "gte7", "gte8"]');
  });

  it("never pre-selects sleep, energy or pain, and says what a quick finish skips", () => {
    const base = {
      isEdit: false,
      effort: 8,
      pain: null,
      painArea: null,
      sleepBucket: null,
      recoveryToday: null,
    };
    expect(checkoutCta(base)).toEqual({ label: "Skip 3 & finish", enabled: true });
    expect(checkoutCta({ ...base, pain: false, sleepBucket: "7_8" })).toEqual({
      label: "Skip 1 & finish",
      enabled: true,
    });
    expect(checkoutCta({ ...base, pain: false, sleepBucket: "7_8", recoveryToday: 4 })).toEqual({
      label: "Done",
      enabled: true,
    });
    expect(checkoutCta({ ...base, effort: null }).enabled).toBe(false);
    expect(checkoutCta({ ...base, pain: true }).enabled).toBe(false);
    expect(checkoutCta({ ...base, isEdit: true }).label).toBe("Save changes");
    const editor = readFileSync("src/components/workout/shared/workout-review-editor.tsx", "utf8");
    expect(editor).toContain(
      "useState<boolean | null>(initial?.submittedAt ? !!initial.pain : null)",
    );
    expect(editor).toContain("useState<SleepBucket | null>(initial?.sleepBucket ?? null)");
    expect(editor).toContain("useState<number | null>(initial?.recoveryToday ?? null)");
  });

  it("opens the recap only after the review sheet has closed, and never on an edit", () => {
    const editor = readFileSync("src/components/workout/shared/workout-review-editor.tsx", "utf8");
    const day = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
    expect(editor).toContain("if (onViewScore && (!wasEdit || scoreAfterEdit))");
    expect(editor).toContain("onCloseAutoFocus={(e) => {");
    // The finish-by-review sheet stays mounted until it has closed.
    expect(day).toContain("(quickFinishReviewOpen || quickFinishMounted || (!completion?.completed_at && autoFinishReady))");
    expect(day).not.toContain("requestAnimationFrame(() => requestAnimationFrame(() => setSummaryOpen(true)))");
    expect(day).toContain("{!focusMode && completion?.completed_at && client?.id && (");
  });

  it("is one screen, effort is never pre-filled, and it stores the version", () => {
    const editor = readFileSync("src/components/workout/shared/workout-review-editor.tsx", "utf8");
    const server = readFileSync("src/lib/workout-completion.functions.ts", "utf8");
    expect(editor).toContain("useState<number | null>(() => initialEffort(initial))");
    expect(editor).not.toContain("suggestedSessionRpe");
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
  it("builds a model per exercise and shows a card plus the suggestion faded in the next set's weight cell", () => {
    expect(wdv).toContain("buildLoadModel({ history: loadHistory, today, unit: activeUnit, readiness, warmup: warmupForModel, bodyweightKg })");
    expect(wdv).toContain("<LoadSuggestionCard hint={loadHint} model={loadModel} plan={loadPlan} warmup={warmupGauge} />");
    expect(wdv).not.toContain("suggested={!readonly && !isConfirmed && isNextSet");
  });
  it("never competes with a coach's fixed load or top-set back-off", () => {
    expect(wdv).toContain('const coachOwnsLoad = !!row.manual_override || row.percentage_basis === "top_set";');
  });
});
