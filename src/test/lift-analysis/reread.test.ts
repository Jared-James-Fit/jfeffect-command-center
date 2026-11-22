/**
 * Reads an older engine left unfinished or refused are read again by the
 * current one (reread.ts). The rows are production's nine as stored on
 * Nov 22 2026 (frame, plate, keys; ids cut short).
 */
import { describe, expect, it } from "vitest";
import { rereadPlan } from "@/lib/lift-analysis/reread";

const NOW = "bar-path/4";
const frame = { h: 480, w: 270 };
const rows = {
  dl1: {
    status: "done",
    engine: "bar-path/3",
    source: "tap",
    velocity_accepted: false,
    result: {
      frame,
      plate: { confirmed: false, mm: 450, r: 33.73, t: 10.933, x: 180.99, y: 369.68 },
      track: {
        keys: [{ a: 34.06, b: 33.41, source: "confirmed", t: 10.9333, x: 180.99, y: 369.68 }],
      },
    },
  },
  needsLook: {
    status: "needs_tap",
    engine: "bar-path/2",
    source: "auto",
    velocity_accepted: false,
    result: { why: "no_plate" },
  },
  autoNoReps: {
    status: "done",
    engine: "bar-path/2",
    source: "auto",
    velocity_accepted: false,
    result: { frame, plate: { confirmed: false, mm: 450, r: 28.18, t: 5, x: 61.68, y: 351.68 } },
  },
  benchConfirmedPlate: {
    status: "done",
    engine: "bar-path/2",
    source: "tap",
    velocity_accepted: false,
    result: { frame, plate: { confirmed: true, mm: 450, r: 21.16, t: 8.67, x: 150.32, y: 300.17 } },
  },
};

describe("which old reads are read again", () => {
  it("a refused read the athlete confirmed: read again from their own ring, never asked again", () => {
    const p = rereadPlan(rows.dl1, NOW)!;
    expect(p.mode).toBe("keys");
    if (p.mode !== "keys") return;
    expect(p.keys).toHaveLength(1);
    expect(p.keys[0].fx).toBeCloseTo(180.99 / 270, 6);
    expect(p.keys[0].fb).toBeCloseTo(33.41 / 480, 6);
    expect(p.keys[0].source).toBe("confirmed");
    expect(p.plateMm).toBeNull();
  });
  it("an older read with no keys: from its plate, and a plate size they set is kept", () => {
    const p = rereadPlan(rows.benchConfirmedPlate, NOW)!;
    expect(p.mode).toBe("keys");
    if (p.mode === "keys") {
      expect(p.keys[0].fa).toBeCloseTo(21.16 / 270, 6);
      expect(p.plateMm).toBe(450);
    }
  });
  it("'needs a look' and a refused read found by itself: found again by itself", () => {
    expect(rereadPlan(rows.needsLook, NOW)).toEqual({ mode: "auto", was: "needs_tap" });
    expect(rereadPlan(rows.autoNoReps, NOW)).toEqual({ mode: "auto", was: "done" });
  });
  it("never touches a speed on the set, a read from this engine, or a video that couldn't open", () => {
    expect(rereadPlan({ ...rows.dl1, velocity_accepted: true }, NOW)).toBeNull();
    expect(rereadPlan({ ...rows.dl1, engine: NOW }, NOW)).toBeNull();
    expect(
      rereadPlan({ status: "failed", engine: "bar-path/2", result: { why: "unreadable" } }, NOW),
    ).toBeNull();
    expect(rereadPlan(null, NOW)).toBeNull();
  });
});
