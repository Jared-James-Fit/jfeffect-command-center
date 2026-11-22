import { describe, expect, it } from "vitest";
import { barPathSegments } from "@/components/lift-analysis/bar-path-overlay";

const read = (ok: number[]) => ({
  frame: { w: 270, h: 480 },
  window: { start: 0.1, end: 0.9 },
  series: {
    t: ok.map((_, i) => i / 10),
    x: ok.map(() => 0.5),
    y: ok.map((_, i) => 0.3 + i * 0.02),
    v: ok.map(() => null),
    ok,
  },
});

describe("the bar path on a chat video", () => {
  it("is the set's own path in the frame's pixels, only inside the set", () => {
    const segs = barPathSegments(read([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]));
    expect(segs).toHaveLength(1);
    const pts = segs[0].split(" ");
    // 0.1 … 0.9 s: nine points
    expect(pts).toHaveLength(9);
    expect(pts[0]).toBe("135.0,153.6");
  });
  it("never draws through where the plate wasn't followed", () => {
    const segs = barPathSegments(read([1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1]));
    expect(segs).toHaveLength(2);
  });
  it("draws nothing when nothing was followed", () => {
    expect(barPathSegments(read([0, 0, 0, 0, 0]))).toHaveLength(0);
  });
});
