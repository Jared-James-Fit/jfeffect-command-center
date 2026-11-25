import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Meet day (Nov 25 2026): the attempt rows keep what's typed locally until it's
 * saved, so a row reused across lifts carried the squat's 262.5 into the
 * deadlift's second attempt. Every row is keyed by its lift.
 */
describe("meet-day rows never carry one lift's weights into another", () => {
  const src = readFileSync("src/components/competition/meet-day.tsx", "utf8");
  it("keys the athlete's attempt rows by lift and attempt", () => {
    expect(src).toMatch(/<AttemptRow[\s\S]{0,200}key=\{`\$\{lift\}-\$\{n\}`\}/);
  });
  it("keys the rivals' rows by lift", () => {
    expect(src).toMatch(/<RivalRow\s+key=\{lift\}/);
  });
  it("a made lift is green, never the brand red", () => {
    expect(src).not.toMatch(/result === "good" \? "default"/);
    expect(src).toMatch(/border-success bg-success/);
  });
});
