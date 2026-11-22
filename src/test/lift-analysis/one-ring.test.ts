/**
 * Confirm shows one ring, never a choice of circles (Nov 22 2026: a read
 * that wasn't sure opened on every circle the finder saw, dashed).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { oneRing, preselectOf, proposalSuggestions } from "@/lib/lift-analysis/suggestions";

const circles = [
  { t: 1.2, fx: 0.4, fy: 0.55, fr: 0.1 },
  { t: 1.4, fx: 0.7, fy: 0.3, fr: 0.06 },
];

describe("Confirm's one ring", () => {
  it("is the ring detection picked when there is one", () => {
    const pre = { t: 2, fx: 0.5, fy: 0.5, fa: 0.12, fb: 0.07 };
    expect(oneRing(pre, circles, 9 / 16)).toEqual({ ring: pre, fromCircle: false });
  });
  it("else the best circle the finder saw, as a circle in the frame, to be snapped to the rim", () => {
    const one = oneRing(null, circles, 9 / 16)!;
    expect(one.fromCircle).toBe(true);
    expect(one.ring).toEqual({ t: 1.2, fx: 0.4, fy: 0.55, fa: 0.1, fb: 0.1 * (9 / 16) });
  });
  it("is nothing only when nothing round was seen", () => {
    expect(oneRing(null, [], 9 / 16)).toBeNull();
  });
  it("a stored read keeps its best guess whatever the doubt, so reopening it is one ring", () => {
    const key = { t: 2, fx: 0.5, fy: 0.5, fa: 0.12, fb: 0.07 };
    const s = proposalSuggestions({ key, candidates: circles });
    expect(preselectOf(s)).toEqual(key);
    expect(oneRing(preselectOf(s), s.filter((x) => !x.preselect), 9 / 16)?.ring).toEqual(key);
  });
  it("the player never draws the other circles", () => {
    const src = readFileSync("src/components/lift-analysis/bar-path-player.tsx", "utf8");
    expect(src).not.toMatch(/candidates/);
    for (const f of ["src/lib/lift-analysis/auto.ts", "src/lib/lift-analysis/chat-lift-run.ts"])
      expect(readFileSync(f, "utf8")).not.toMatch(/key: null/);
  });
});
