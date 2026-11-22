import { describe, expect, it } from "vitest";
import {
  compareToExpected,
  fitLoadVelocity,
  MODEL_RULES,
  predictVelocity,
  whyNoPrediction,
  type VelocitySample,
} from "@/lib/lift-analysis/velocity-model";

const NOW = Date.parse("2026-11-22T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

/** A lifter whose set-average speed falls 0.006 m/s per kg, with a little day-to-day noise. */
function lifter(n: number, noise = [0.012, -0.01, 0.006, -0.008, 0.01, -0.004, 0.003, -0.012]) {
  const out: VelocitySample[] = [];
  for (let i = 0; i < n; i++) {
    const load = 100 + (i % 5) * 10;
    out.push({
      loadKg: load,
      reps: 3,
      mcv: 1.2 - 0.006 * load + noise[i % noise.length],
      at: daysAgo(3 + i * 2),
      session: `s${Math.floor(i / 2)}`,
    });
  }
  return out;
}

describe("velocity model", () => {
  it("says nothing until it has enough measured sets from enough workouts", () => {
    const m = fitLoadVelocity(lifter(3), NOW);
    expect(m.ok).toBe(false);
    expect(whyNoPrediction(m)).toContain(`3 of ${MODEL_RULES.MIN_SETS}`);
    const oneSession = lifter(6).map((s) => ({ ...s, session: "one" }));
    expect(fitLoadVelocity(oneSession, NOW)).toMatchObject({ ok: false, why: "too_few_sessions" });
  });

  it("recovers the athlete's own line and predicts inside it", () => {
    const m = fitLoadVelocity(lifter(10), NOW);
    expect(m.ok && m.kind).toBe("line");
    const p = predictVelocity(m, 125, 3)!;
    expect(p).not.toBeNull();
    const truth = 1.2 - 0.006 * 125;
    expect(Math.abs(p.v - truth)).toBeLessThan(0.02);
    expect(p.lo).toBeLessThan(truth);
    expect(p.hi).toBeGreaterThan(truth);
    expect(p.hi - p.lo).toBeLessThanOrEqual(2 * MODEL_RULES.MAX_HALF_WIDTH);
  });

  it("never extrapolates past the loads or rep counts it has seen", () => {
    const m = fitLoadVelocity(lifter(10), NOW);
    expect(predictVelocity(m, 160, 3)).toBeNull();
    expect(predictVelocity(m, 80, 3)).toBeNull();
    expect(predictVelocity(m, 120, 8)).toBeNull();
  });

  it("a slope that doesn't fall with load isn't a slope: only a flat estimate near the loads seen", () => {
    const flatish: VelocitySample[] = [100, 110, 120, 130, 140, 100, 120].map((l, i) => ({
      loadKg: l,
      reps: 3,
      mcv: 0.5 + (i % 2 ? 0.01 : -0.01),
      at: daysAgo(i * 3),
      session: `s${i}`,
    }));
    const m = fitLoadVelocity(flatish, NOW);
    expect(m.ok && m.kind).toBe("flat");
  });

  it("moves the line by how today's measured sets ran, shrunk until there are a few", () => {
    const m = fitLoadVelocity(lifter(10), NOW);
    const base = predictVelocity(m, 120, 3)!;
    const fast = predictVelocity(m, 120, 3, [{ loadKg: 110, reps: 3, mcv: 1.2 - 0.66 + 0.06 }])!;
    expect(fast.today).toBe(true);
    expect(fast.v - base.v).toBeGreaterThan(0.02);
    expect(fast.v - base.v).toBeLessThan(0.06);
  });

  it("calls a set faster or slower only outside the 95 % interval", () => {
    const m = fitLoadVelocity(lifter(10), NOW);
    const p = predictVelocity(m, 120, 3)!;
    expect(compareToExpected(p.v, p)).toBe("as_expected");
    expect(compareToExpected(p.hi + 0.01, p)).toBe("faster");
    expect(compareToExpected(p.lo - 0.01, p)).toBe("slower");
  });

  it("forgets sets older than its window", () => {
    const old = lifter(10).map((s) => ({ ...s, at: daysAgo(400) }));
    expect(fitLoadVelocity(old, NOW)).toMatchObject({ ok: false, why: "too_few_sets" });
  });
});
