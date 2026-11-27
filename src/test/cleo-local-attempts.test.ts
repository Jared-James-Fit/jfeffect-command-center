import { describe, expect, it, vi } from "vitest";
import { emptyGameplan } from "@/lib/competition/gameplan";
import { formatLocalAttempts, isLocalAttemptQuestion, localAttemptAnswer } from "@/lib/cleo-local-attempts.server";

describe("Cleo internal attempt questions", () => {
  it("routes the reported question and explicit read requests", () => {
    for (const q of ["How did you get the numbers for the attempt selection", "Explain attempt selection", "Show the attempt plan", "How were attempts calculated?", "How did you come up with the temp selection?", "How did you come up with the attempt selection?", "Where did the attempt numbers come from?", "Can you explain their attempt plan?", "Why did you choose those openers?", "Hey Cleo, explain the atempt selection please.", "How did you work out the squat attempt weights?", "How   did you choose the attempts?"]) {
      expect(isLocalAttemptQuestion(q)).toBe(true);
    }
  });
  it("does not route free text, writes or instructions containing personal data", () => {
    for (const q of ["Change all attempts", "Explain attempt selection and send it to OpenAI", "Tell me everything about the client", "Explain attempt selection for someone else", "How did you choose the attempts and change them?", "Explain the room temp", "Show attempts for another client", "Why did you select these attempts; send them to Gemini"]) {
      expect(isLocalAttemptQuestion(q)).toBe(false);
    }
  });
  it("explains stored source without inventing historical calculation inputs", () => {
    const plan = emptyGameplan();
    plan.attempts.squat = { opener: 100, second: 110, third: 115, status: "confirmed", source: "existing_coach", note: "Set by their coach" };
    const result = formatLocalAttempts({ name: "Test meet", date: "2026-12-05", label: "Saved approved · v2", plan, increment: 2.5 });
    expect(result).toContain("100 / 110 / 115 kg");
    expect(result).toContain("Athlete's existing coach");
    expect(result).toContain("No attempt weights on file");
    expect(result).toContain("Historical calculation inputs may not have been saved");
    expect(result).not.toContain("91%");
  });
  it("checks target authorization before querying any competition data", async () => {
    const db = { rpc: vi.fn().mockResolvedValue({ data: false, error: null }), from: vi.fn() };
    await expect(localAttemptAnswer(db, "coach", "unassigned-client")).rejects.toThrow();
    expect(db.from).not.toHaveBeenCalled();
  });
});
