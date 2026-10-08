import { describe, expect, it } from "vitest";
import { COACH_VOICE_RULES, casualize } from "@/lib/coach-voice";
import { readFileSync } from "node:fs";

describe("casualize", () => {
  it("strips the AI tells: em dashes, semicolons, that's / let's / it's", () => {
    const out = casualize("Great work this week. It’s a huge win—that’s a clear sign; let's keep going.");
    expect(out).not.toMatch(/[—–;]/);
    expect(out).toContain("thats");
    expect(out).toContain("lets");
    expect(out).toContain("its a huge win");
  });

  it("lowercases ordinary sentence starts but keeps names and stressed words", () => {
    const out = casualize("Since energy took a hit, rest up. Reece pause the FIRST rep. That's RPE 8");
    expect(out.startsWith("since energy")).toBe(true);
    expect(out).toContain("Reece pause the FIRST rep");
    expect(out).toContain("thats RPE 8");
  });

  it("keeps paragraphs and tidies spacing", () => {
    expect(casualize("Good week!\n\n\n\nThis week lets lock in")).toBe("good week!\n\nthis week lets lock in");
  });
});

describe("voice rules", () => {
  it("bans the AI-isms and asks for nerd specifics without inventing data", () => {
    for (const s of ["em dashes", "Great work this week, Name.", "navigating", "Mostly lowercase", "RPE", "Never invent"]) {
      expect(COACH_VOICE_RULES).toContain(s);
    }
  });

  it("is wired into the check-in recap and cleans the suggestion", () => {
    const src = readFileSync("src/lib/messenger-checkins.functions.ts", "utf8");
    expect(src).toContain("COACH_VOICE_RULES,");
    expect(src).toContain("suggested_response: casualize(");
  });
});
