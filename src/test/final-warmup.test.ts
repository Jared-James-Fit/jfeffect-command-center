import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

// Node test env: minimal localStorage-backed window.
const store = new Map<string, string>();
(globalThis as any).window = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
};
const { describeWarmup, readWarmup, warmupInUnit, warmupKey, writeWarmup, WARMUP_TTL_MS } = await import("@/lib/final-warmup");

const w = { load: 140, unit: "kg" as const, reps: 2, rpe: 7, savedAt: Date.now() };
beforeEach(() => store.clear());

describe("final warm-up storage", () => {
  it("is keyed per workout day + exercise row", () => {
    expect(warmupKey("d1", "r1")).not.toBe(warmupKey("d1", "r2"));
    expect(warmupKey("d1", "r1")).not.toBe(warmupKey("d2", "r1"));
  });
  it("round-trips and clears", () => {
    const k = warmupKey("d", "r");
    writeWarmup(k, w);
    expect(readWarmup(k)).toEqual(w);
    writeWarmup(k, null);
    expect(readWarmup(k)).toBeNull();
  });
  it("expires after 16 hours so last week's warm-up never leaks into today", () => {
    const k = warmupKey("d", "r");
    writeWarmup(k, { ...w, savedAt: 1_000_000 });
    expect(readWarmup(k, 1_000_000 + WARMUP_TTL_MS)).not.toBeNull();
    expect(readWarmup(k, 1_000_000 + WARMUP_TTL_MS + 1)).toBeNull();
    expect(store.has(k)).toBe(false); // and it cleans up
  });
  it("ignores corrupt or implausible stored data instead of throwing", () => {
    const k = warmupKey("d", "r");
    for (const bad of ["not json", "{}", JSON.stringify({ ...w, load: -5 }), JSON.stringify({ ...w, reps: 0 }), JSON.stringify({ ...w, unit: "stone" })]) {
      store.set(k, bad);
      expect(readWarmup(k)).toBeNull();
    }
  });
  it("converts when the athlete toggles kg/lb mid-session", () => {
    expect(warmupInUnit(w, "kg").load).toBe(140);
    expect(warmupInUnit(w, "lb").load).toBeCloseTo(308.6, 1);
    expect(warmupInUnit({ ...w, unit: "lb", load: 315 }, "kg").load).toBeCloseTo(142.9, 1);
  });
  it("describes it for the chip", () => {
    expect(describeWarmup(w, "kg")).toBe("140 kg × 2 · RPE 7");
    expect(describeWarmup({ ...w, rpe: null }, "kg")).toBe("140 kg × 2");
  });
  it("never throws when storage is blocked", () => {
    const real = (globalThis as any).window.localStorage;
    (globalThis as any).window.localStorage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
    expect(() => writeWarmup("k", w)).not.toThrow();
    expect(readWarmup("k")).toBeNull();
    (globalThis as any).window.localStorage = real;
  });
});

describe("logger wiring", () => {
  const logger = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
  it("is offered for squat / bench / deadlift family lifts only, and only where a suggestion is possible", () => {
    const m = logger.slice(logger.indexOf("const warmupEligible"), logger.indexOf("const loadModel"));
    expect(m).toContain('family !== "accessory"');
    expect(m).toContain("!coachOwnsLoad"); // a coach-owned load is never second-guessed
    expect(m).toContain("!hideWeight");
    expect(m).toContain('rowLoadType === "external"');
    expect(m).toContain("!workedToday"); // once a working set is logged, that set takes over
    expect(m).toContain("!readonly");
  });
  it("feeds the suggestion engine only when eligible", () => {
    expect(logger).toContain("const warmupForModel = warmupEligible && finalWarmup ?");
    expect(logger).toContain("warmup: warmupForModel");
  });
  it("renders the optional prompt after the suggestion card", () => {
    expect(logger.indexOf("<LoadSuggestionCard hint={loadHint}")).toBeLessThan(logger.indexOf("<FinalWarmupInput"));
  });
  it("is not written to the set-log tables (records, tonnage, league and coach review never see it)", () => {
    const lib = readFileSync("src/lib/final-warmup.ts", "utf8");
    expect(lib).not.toMatch(/supabase|pl_row_results|from\(/);
  });
});
