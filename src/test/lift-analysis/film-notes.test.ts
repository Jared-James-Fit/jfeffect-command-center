/**
 * Film notes and rep comparison: what a note keeps (film-notes.ts), when it
 * shows, and how a ghost rep is lined up with the one on screen
 * (overlay-draw.ts samePhaseTime: bottom with bottom, whatever each rep's speed).
 */
import { describe, expect, it } from "vitest";
import type { LiftAnalysis } from "@/lib/lift-analysis/analyze";
import { cleanShapes, noteClock, noteShownAt, NOTE_SHOW_S } from "@/lib/lift-analysis/film-notes";
import { repPhases, samePhaseTime } from "@/components/lift-analysis/overlay-draw";

describe("a film note", () => {
  it("keeps only marks the database takes, rounded", () => {
    const out = cleanShapes([
      { kind: "arrow", a: [0.1, 0.2], b: [0.3, 0.41234567] },
      // a tap, not a stroke
      { kind: "line", a: [0.5, 0.5], b: [0.501, 0.5] },
      { kind: "circle", a: [Number.NaN, 0.2], b: [0.3, 0.4] },
      { kind: "joint", j: 25 },
      { kind: "joint", j: 40 },
    ]);
    expect(out).toEqual([
      { kind: "arrow", a: [0.1, 0.2], b: [0.3, 0.4123] },
      { kind: "joint", j: 25 },
    ]);
  });

  it("holds at most 40 marks", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      kind: "line" as const,
      a: [0, i / 100] as [number, number],
      b: [0.5, i / 100] as [number, number],
    }));
    expect(cleanShapes(many)).toHaveLength(40);
  });

  it("shows around its moment only", () => {
    expect(noteShownAt({ t: 4.2 }, 4.2)).toBe(true);
    expect(noteShownAt({ t: 4.2 }, 4.2 + NOTE_SHOW_S - 0.01)).toBe(true);
    expect(noteShownAt({ t: 4.2 }, 4.2 + NOTE_SHOW_S + 0.01)).toBe(false);
  });

  it("says its moment the way the player does", () => {
    expect(noteClock(4.23)).toBe("0:04.2");
    expect(noteClock(65.5)).toBe("1:05.5");
  });
});

describe("a ghost rep lined up with the one on screen", () => {
  const a = {
    reps: [
      // rep 1: down 1 s, up 1 s
      { dir: "lower_first", ecc: { start: 1, end: 2 }, con: { start: 2, end: 3 } },
      // rep 2: down 1 s, a slow grind up 2 s
      { dir: "lower_first", ecc: { start: 5, end: 6 }, con: { start: 6, end: 8 } },
    ],
  } as unknown as LiftAnalysis;

  it("splits a rep at its turnaround", () => {
    expect(repPhases(a, 1)).toEqual([5, 6, 8]);
  });

  it("puts the bottoms together and stretches each phase to fit", () => {
    expect(samePhaseTime(a, 0, 1, 2)).toBeCloseTo(6); // bottom with bottom
    expect(samePhaseTime(a, 0, 1, 1.5)).toBeCloseTo(5.5); // half way down
    expect(samePhaseTime(a, 0, 1, 2.5)).toBeCloseTo(7); // half way up the slower rep
    expect(samePhaseTime(a, 0, 1, 0.5)).toBeCloseTo(5); // before the rep: its start
    expect(samePhaseTime(a, 0, 1, 9)).toBeCloseTo(8); // after it: its end
  });
});
