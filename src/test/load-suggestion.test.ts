import { describe, expect, it } from "vitest";
import {
  buildLoadModel,
  warmupTrust,
  estimateFor,
  loadStep,
  percentOf1RM,
  planningTarget,
  predictReadiness,
  setE1rm,
  suggestSetLoad,
  warmupE1rm,
  WARMUP_COLD_START_MAX_RATIO,
  audibleStep,
  MIN_RPE,
  WARMUP_COLD_START_SPREAD,
  HISTORY_SPREAD,
} from "@/lib/load-suggestion";
import type { PreviousLiftLog } from "@/lib/workout-previous-lift";

const NOW = new Date("2026-10-06T18:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const log = (session: string, d: number, kg: number, reps: number, rpe: number | null, extra: Partial<PreviousLiftLog> = {}): PreviousLiftLog => ({
  id: `${session}-${kg}-${reps}-${Math.random()}`, exerciseId: "squat", exerciseName: "Squat",
  sessionKey: session, occurredAt: daysAgo(d), reps, rpe, rir: null,
  enteredValue: kg, enteredUnit: "kg", normalizedKg: kg, normalizedLb: kg * 2.2046226218,
  isWorkingSet: true, loadType: "external", ...extra,
});
const twoWeeks = [
  log("s1", 9, 140, 5, 8), log("s1", 9, 140, 5, 8), log("s1", 9, 140, 5, 8.5),
  log("s2", 2, 145, 5, 8), log("s2", 2, 145, 5, 8.5), log("s2", 2, 145, 5, 8.5),
];

describe("RPE chart", () => {
  it("matches the RTS chart and interpolates half RPEs", () => {
    expect(percentOf1RM(1, 0)).toBe(1);
    expect(percentOf1RM(5, 2)).toBeCloseTo(0.811, 3); // 5 @ RPE 8 ≈ 7RM
    expect(percentOf1RM(3, 1.5)!).toBeGreaterThan(percentOf1RM(3, 2)!);
    expect(percentOf1RM(15, 3)!).toBeLessThan(percentOf1RM(12, 0)!);
    expect(percentOf1RM(20, 4)).toBeNull(); // too far out to trust
  });

  it("ignores warm-ups and down-weights unlogged effort", () => {
    expect(setE1rm({ load: 100, reps: 5, rpe: 3.5 })).toBeNull(); // below RPE 4 = warm-up
    expect(setE1rm({ load: 100, reps: 5, rpe: 5 })!.trust).toBeLessThan(setE1rm({ load: 100, reps: 5, rpe: 8 })!.trust);
    expect(setE1rm({ load: 100, reps: 5, rpe: null })!.trust).toBeLessThan(setE1rm({ load: 100, reps: 5, rpe: 8 })!.trust);
  });
});

describe("buildLoadModel / suggestSetLoad", () => {
  it("waits for a week of data before suggesting anything cold", () => {
    const one = buildLoadModel({ history: twoWeeks.filter((l) => l.sessionKey === "s2"), today: [], unit: "kg", now: NOW });
    expect(one.status).toBe("calibrating");
    expect(suggestSetLoad(one, { reps: 5, rpe: 8 })).toBeNull();
    const two = buildLoadModel({ history: twoWeeks, today: [], unit: "kg", now: NOW });
    expect(two.status).toBe("ready");
  });

  it("suggests the athlete's recent load for the same reps/RPE, as a plate-loadable range", () => {
    const m = buildLoadModel({ history: twoWeeks, today: [], unit: "kg", now: NOW });
    const s = suggestSetLoad(m, { reps: 5, rpe: 8 })!;
    expect(s.target).toBeGreaterThanOrEqual(140);
    expect(s.target).toBeLessThanOrEqual(147.5);
    expect(s.low).toBeLessThan(s.target);
    expect(s.high).toBeGreaterThan(s.target);
    for (const v of [s.low, s.target, s.high]) expect(v % 2.5).toBe(0);
  });

  it("goes lighter for more reps or a lower RPE, heavier for a higher RPE", () => {
    const m = buildLoadModel({ history: twoWeeks, today: [], unit: "kg", now: NOW });
    const base = suggestSetLoad(m, { reps: 5, rpe: 8 })!.target;
    expect(suggestSetLoad(m, { reps: 8, rpe: 8 })!.target).toBeLessThan(base);
    expect(suggestSetLoad(m, { reps: 5, rpe: 6.5 })!.target).toBeLessThan(base);
    expect(suggestSetLoad(m, { reps: 3, rpe: 9 })!.target).toBeGreaterThan(base);
  });

  it("autoregulates from today's sets: an easy top set raises the back-offs", () => {
    const cold = suggestSetLoad(buildLoadModel({ history: twoWeeks, today: [], unit: "kg", now: NOW }), { reps: 5, rpe: 8 })!;
    const strongDay = buildLoadModel({
      history: twoWeeks, today: [{ load: 150, reps: 5, rpe: 7 }], unit: "kg", now: NOW,
    });
    expect(strongDay.source).toBe("blend");
    expect(suggestSetLoad(strongDay, { reps: 5, rpe: 8 })!.target).toBeGreaterThan(cold.target);
    const grindDay = buildLoadModel({
      history: twoWeeks, today: [{ load: 140, reps: 5, rpe: 9.5 }], unit: "kg", now: NOW,
    });
    expect(suggestSetLoad(grindDay, { reps: 5, rpe: 8 })!.target).toBeLessThan(cold.target);
  });

  it("works on a brand-new lift after the first logged set", () => {
    const m = buildLoadModel({ history: [], today: [{ load: 60, reps: 10, rpe: 8 }], unit: "kg", now: NOW });
    expect(m.source).toBe("today");
    expect(suggestSetLoad(m, { reps: 10, rpe: 8 })!.target).toBe(60);
  });

  it("only lets readiness trim a cold suggestion, never inflate it", () => {
    const tired = predictReadiness(
      { submittedAt: daysAgo(1), sessionRpe: 10, pain: true, sleepBucket: "lt5", recoveryToday: 1 }, NOW,
    );
    expect(tired.multiplier).toBeCloseTo(0.95, 5); // capped at -5%
    const normal = suggestSetLoad(buildLoadModel({ history: twoWeeks, today: [], unit: "kg", now: NOW }), { reps: 5, rpe: 8 })!;
    const trimmed = suggestSetLoad(buildLoadModel({ history: twoWeeks, today: [], unit: "kg", now: NOW, readiness: tired }), { reps: 5, rpe: 8 })!;
    expect(trimmed.target).toBeLessThan(normal.target);
    expect(predictReadiness({ submittedAt: daysAgo(6), sessionRpe: 10, pain: true, sleepBucket: "lt5", recoveryToday: 1 }, NOW).multiplier).toBe(1);
    expect(predictReadiness({ submittedAt: daysAgo(1), sessionRpe: 7, pain: false, sleepBucket: "7_8", recoveryToday: 5 }, NOW).multiplier).toBe(1);
  });

  it("ignores bodyweight/assisted sets, other units convert", () => {
    const bw = twoWeeks.map((l) => ({ ...l, loadType: "bodyweight" as const }));
    expect(buildLoadModel({ history: bw, today: [], unit: "kg", now: NOW }).status).toBe("calibrating");
    const lb = suggestSetLoad(buildLoadModel({ history: twoWeeks, today: [], unit: "lb", now: NOW }), { reps: 5, rpe: 8 })!;
    expect(lb.target % 5).toBe(0);
    expect(lb.target).toBeGreaterThan(300);
  });

  it("backs off after a long layoff", () => {
    const old = twoWeeks.map((l) => ({ ...l, occurredAt: new Date(Date.parse(l.occurredAt!) - 35 * 86_400_000).toISOString() }));
    const m = buildLoadModel({ history: old, today: [], unit: "kg", now: NOW });
    expect(m.staleDays).toBeGreaterThan(21);
    const fresh = suggestSetLoad(buildLoadModel({ history: twoWeeks, today: [], unit: "kg", now: NOW }), { reps: 5, rpe: 8 })!;
    expect(suggestSetLoad(m, { reps: 5, rpe: 8 })!.target).toBeLessThanOrEqual(fresh.target);
  });
});

describe("planningTarget", () => {
  it("plans rep ranges at the midpoint and defaults effort to RPE 8", () => {
    expect(planningTarget({ repTarget: { min: 8, max: 12 }, rpeTarget: {}, rirTarget: {} })).toEqual({ reps: 10, rpe: 8 });
    expect(planningTarget({ repTarget: { exact: 5 }, rpeTarget: { exact: 7.5 }, rirTarget: {} })).toEqual({ reps: 5, rpe: 7.5 });
    expect(planningTarget({ repTarget: { exact: 6 }, rpeTarget: {}, rirTarget: { min: 1, max: 2 } })).toEqual({ reps: 6, rpe: 8.5 });
    expect(planningTarget({ repTarget: { exact: 30 }, rpeTarget: {}, rirTarget: {} })).toBeNull();
  });
});

describe("helpers", () => {
  it("uses finer steps for light loads", () => {
    expect(loadStep("kg", 12)).toBe(1);
    expect(loadStep("lb", 30)).toBe(2.5);
    expect(loadStep("lb", 225)).toBe(5);
  });
});

describe("final warm-up (SBD) → working-set suggestion", () => {
  const plan = { reps: 5, rpe: 8 };
  const base = () => buildLoadModel({ history: twoWeeks, today: [], unit: "kg", now: NOW });
  const withWarm = (w: { load: number; reps: number; rpe?: number | null }, extra: Record<string, unknown> = {}) =>
    buildLoadModel({ history: twoWeeks, today: [], unit: "kg", now: NOW, warmup: w, ...extra });

  describe("warmupE1rm", () => {
    it("floors the RPE at 6 so a claimed 'easy' warm-up can never inflate the estimate", () => {
      const at6 = warmupE1rm({ load: 120, reps: 2, rpe: 6 })!;
      expect(warmupE1rm({ load: 120, reps: 2, rpe: 3 })).toBeCloseTo(at6, 6);
      expect(warmupE1rm({ load: 120, reps: 2, rpe: 5 })).toBeCloseTo(at6, 6);
    });
    it("a harder-feeling warm-up implies a LOWER e1RM; unspecified RPE assumes a typical warm-up (7)", () => {
      expect(warmupE1rm({ load: 120, reps: 2, rpe: 8 })!).toBeLessThan(warmupE1rm({ load: 120, reps: 2, rpe: 7 })!);
      expect(warmupE1rm({ load: 120, reps: 2 })).toBeCloseTo(warmupE1rm({ load: 120, reps: 2, rpe: 7 })!, 6);
    });
    it("rejects what it can't trust", () => {
      expect(warmupE1rm({ load: 0, reps: 2 })).toBeNull();
      expect(warmupE1rm({ load: 120, reps: 0 })).toBeNull();
      expect(warmupE1rm({ load: 120, reps: 12 })).toBeNull(); // not a warm-up any more
    });
  });

  describe("with history: only a nudge", () => {
    const hist = suggestSetLoad(base(), plan)!;

    it("a warm-up in line with history leaves the suggestion essentially unchanged", () => {
      // e1RM from history ≈ 171; a 135×2 @7 lands right around it
      const m = withWarm({ load: 135, reps: 2, rpe: 7 });
      expect(m.source).toBe("history_warmup");
      const s = suggestSetLoad(m, plan)!;
      expect(Math.abs(s.target - hist.target) / hist.target).toBeLessThanOrEqual(0.03);
    });

    it("a very easy / light warm-up can raise the suggestion by at most ~1.5% (never a big jump)", () => {
      const s = suggestSetLoad(withWarm({ load: 100, reps: 1, rpe: 6 }), plan)!;
      // 100 kg single is far below history → pushes DOWN, never up; flip it: a huge warm-up that implies a huge e1RM
      const up = suggestSetLoad(withWarm({ load: 200, reps: 1, rpe: 6 }), plan)!;
      expect(up.target / hist.target).toBeLessThanOrEqual(1.015 + 0.03); // 1.5% + one plate step of rounding
      expect(s.target).toBeLessThanOrEqual(hist.target);
    });

    it("a weak normal (RPE ≤ 7) warm-up backs the suggestion off by at most ~3%", () => {
      const s = suggestSetLoad(withWarm({ load: 70, reps: 3, rpe: 7 }), plan)!;
      expect(s.target).toBeLessThanOrEqual(hist.target);
      expect(s.target / hist.target).toBeGreaterThanOrEqual(0.97 - 0.02); // −3% + rounding
    });

    it("backing off is allowed more than pushing up (asymmetric, safety first) — on the unrounded estimate", () => {
      const raw = (w: { load: number; reps: number; rpe: number }) => estimateFor(withWarm(w), 5, 8)!.load;
      const h = estimateFor(base(), 5, 8)!.load;
      const down = raw({ load: 60, reps: 1, rpe: 7 }); // implausibly weak -> clamped
      const up = raw({ load: 300, reps: 1, rpe: 6 }); // implausibly strong -> clamped
      expect(down / h).toBeCloseTo(0.97, 3); // −3%
      expect(up / h).toBeCloseTo(1.015, 3); // +1.5%
      expect(h - down).toBeGreaterThan(up - h);
    });

    it("a hard (RPE 8+) warm-up is read like a set: down as far as it says, up by at most 7.5%", () => {
      const h = estimateFor(base(), 5, 8)!.load;
      const weak = estimateFor(withWarm({ load: 90, reps: 3, rpe: 9 }), 5, 8)!.load;
      expect(weak).toBeCloseTo(warmupE1rm({ load: 90, reps: 3, rpe: 9 })! * percentOf1RM(5, 2)!, 6);
      const strong = estimateFor(withWarm({ load: 300, reps: 1, rpe: 8 }), 5, 8)!.load;
      expect(strong / h).toBeLessThanOrEqual(1.015 * 1.075 + 1e-9);
    });

    it("keeps the readiness trim instead of cancelling it", () => {
      const tired = { multiplier: 0.95, reasons: ["short sleep"] };
      const noWarm = estimateFor(buildLoadModel({ history: twoWeeks, today: [], unit: "kg", now: NOW, readiness: tired }), 5, 8)!.load;
      const warm = estimateFor(withWarm({ load: 135, reps: 2, rpe: 7 }, { readiness: tired }), 5, 8)!.load;
      expect(warm).toBeLessThan(hist.target); // still eased for the bad sleep
      expect(warm / noWarm).toBeGreaterThanOrEqual(0.97 - 1e-9); // the warm-up only nudges: −3% .. +1.5%
      expect(warm / noWarm).toBeLessThanOrEqual(1.015 + 1e-9);
    });

    it("never narrows the range below the history floor", () => {
      const s = suggestSetLoad(withWarm({ load: 135, reps: 2, rpe: 7 }), plan)!;
      expect(s.low).toBeLessThan(s.target);
      expect(s.high).toBeGreaterThan(s.target);
    });
  });

  describe("no history (a new lift)", () => {
    const cold = (w: { load: number; reps: number; rpe?: number | null }) => buildLoadModel({ history: [], today: [], unit: "kg", now: NOW, warmup: w });

    it("without a warm-up it still just calibrates", () => {
      expect(buildLoadModel({ history: [], today: [], unit: "kg", now: NOW }).status).toBe("calibrating");
    });
    it("a warm-up unlocks a first suggestion — conservative and with a wider range", () => {
      const m = cold({ load: 100, reps: 3, rpe: 7 });
      expect(m.status).toBe("ready");
      expect(m.source).toBe("warmup");
      const s = suggestSetLoad(m, plan)!;
      // conservative: below the raw chart value for that warm-up
      const raw = warmupE1rm({ load: 100, reps: 3, rpe: 7 })! * percentOf1RM(5, 2)!;
      expect(s.target).toBeLessThan(raw);
      expect(s.high - s.low).toBeGreaterThan(suggestSetLoad(base(), plan)!.high - suggestSetLoad(base(), plan)!.low - 0.001);
    });
    it("never suggests more than 1.25× the warm-up load", () => {
      for (const w of [{ load: 40, reps: 8, rpe: 7 }, { load: 100, reps: 3, rpe: 6 }, { load: 180, reps: 1, rpe: 6 }]) {
        const s = suggestSetLoad(cold(w), { reps: 3, rpe: 8 })!;
        expect(s.target).toBeLessThanOrEqual(w.load * WARMUP_COLD_START_MAX_RATIO + 2.5);
      }
    });
    it("uses the documented cold-start spread", () => {
      expect(WARMUP_COLD_START_SPREAD).toBeGreaterThan(HISTORY_SPREAD);
    });
    it("ignores an unusable warm-up (stays calibrating)", () => {
      expect(cold({ load: 100, reps: 15 }).status).toBe("calibrating");
    });
  });

  describe("once a working set is logged today, that set takes over", () => {
    it("the warm-up has no effect any more", () => {
      const today = [{ load: 150, reps: 5, rpe: 8 }];
      const a = suggestSetLoad(buildLoadModel({ history: twoWeeks, today, unit: "kg", now: NOW }), { reps: 5, rpe: 8 })!;
      const b = suggestSetLoad(buildLoadModel({ history: twoWeeks, today, unit: "kg", now: NOW, warmup: { load: 100, reps: 1, rpe: 6 } }), { reps: 5, rpe: 8 })!;
      expect(b).toEqual(a);
    });
    it("also for a new lift: the logged set calibrates, the warm-up is dropped", () => {
      const m = buildLoadModel({ history: [], today: [{ load: 120, reps: 5, rpe: 8 }], unit: "kg", now: NOW, warmup: { load: 60, reps: 3, rpe: 7 } });
      expect(m.source).toBe("today");
      expect(m.warmup).toBeNull();
    });
  });

  it("works in lb as well", () => {
    const m = buildLoadModel({ history: [], today: [], unit: "lb", now: NOW, warmup: { load: 225, reps: 3, rpe: 7 } });
    const s = suggestSetLoad(m, plan)!;
    expect(s.unit).toBe("lb");
    expect(s.target % 5).toBe(0);
  });
});

describe("light prescriptions (RPE 4-5) are planned at their real effort", () => {
  it("planningTarget keeps RPE 4-5 instead of bumping it to 6", () => {
    expect(MIN_RPE).toBe(4);
    expect(planningTarget({ repTarget: { exact: 5 }, rpeTarget: { min: 4, max: 5 }, rirTarget: {} })).toEqual({ reps: 5, rpe: 4.5 });
    expect(planningTarget({ repTarget: { exact: 1 }, rpeTarget: { exact: 3 }, rirTarget: {} })).toEqual({ reps: 1, rpe: 4 });
  });
  it("a light target suggests less than the same reps at RPE 6", () => {
    const m = buildLoadModel({ history: twoWeeks, today: [], unit: "kg", now: NOW });
    expect(suggestSetLoad(m, { reps: 5, rpe: 4.5 })!.target).toBeLessThan(suggestSetLoad(m, { reps: 5, rpe: 6 })!.target);
  });
  it("a light set logged today never drags a heavier target down", () => {
    const cold = suggestSetLoad(buildLoadModel({ history: twoWeeks, today: [], unit: "kg", now: NOW }), { reps: 5, rpe: 8 })!;
    const afterLight = suggestSetLoad(buildLoadModel({ history: twoWeeks, today: [{ load: 80, reps: 5, rpe: 4 }], unit: "kg", now: NOW }), { reps: 5, rpe: 8 })!;
    expect(afterLight.target).toBe(cold.target);
  });
  it("but it does calibrate the next light set", () => {
    const m = buildLoadModel({ history: twoWeeks, today: [{ load: 80, reps: 5, rpe: 4 }], unit: "kg", now: NOW });
    expect(estimateFor(m, 5, 4)!.load).toBeLessThan(estimateFor(buildLoadModel({ history: twoWeeks, today: [], unit: "kg", now: NOW }), 5, 4)!.load);
  });
});

describe("audibleStep (the 'moving fast / grinding' tip)", () => {
  it("is ~2.5% rounded to real plates, never below one plate step", () => {
    expect(audibleStep(225, "lb")).toBe(5);
    expect(audibleStep(500, "lb")).toBe(15);
    expect(audibleStep(140, "kg")).toBe(2.5);
    expect(audibleStep(240, "kg")).toBe(5);
    expect(audibleStep(30, "lb")).toBe(2.5);
    expect(audibleStep(12, "kg")).toBe(1);
  });
});

describe("bodyweight-adjusted history", () => {
  it("scales strength with bodyweight^0.67 and ignores implausible jumps", async () => {
    const { bodyweightScale } = await import("@/lib/load-suggestion");
    expect(bodyweightScale(102, 100)).toBeCloseTo(Math.pow(1.02, 0.67), 6);
    expect(bodyweightScale(98, 100)).toBeLessThan(1);
    expect(bodyweightScale(150, 100)).toBe(1); // unit slip, not a real change
    expect(bodyweightScale(null, 100)).toBe(1);
    expect(bodyweightScale(100, undefined)).toBe(1);
  });
  it("a heavier athlete gets a proportionally heavier suggestion from the same history", () => {
    const at = (bw: number | null) => twoWeeks.map((l) => ({ ...l, bodyweightKg: bw }));
    const same = suggestSetLoad(buildLoadModel({ history: at(90), today: [], unit: "kg", now: NOW, bodyweightKg: 90 }), { reps: 5, rpe: 8 })!;
    const up = buildLoadModel({ history: at(90), today: [], unit: "kg", now: NOW, bodyweightKg: 94 });
    expect(up.bodyweightScale).toBeGreaterThan(1.02);
    expect(estimateFor(up, 5, 8)!.load).toBeGreaterThan(estimateFor(buildLoadModel({ history: at(90), today: [], unit: "kg", now: NOW, bodyweightKg: 90 }), 5, 8)!.load);
    expect(same.target).toBeGreaterThan(0);
  });
});

describe("a hard last warm-up sets today's weight", () => {
  // Oct 2026: 210 kg × 1 @ 8 (e1RM ≈ 227.5) → 5 @ RPE 4.5 suggested 185 kg
  // because recent sessions were heavier; the chart says ~165.
  const now = new Date("2026-10-10T12:00:00Z");
  const history = [3, 10].flatMap((d) => [1, 2, 3].map(() => ({
    sessionKey: `s${d}`, occurredAt: new Date(now.getTime() - d * 864e5).toISOString(),
    normalizedKg: 195, normalizedLb: 430, loadUnit: "kg", load: 195, reps: 5, rpe: "6", loadType: "external",
  } as any)));
  const at = (rpe: number | null) =>
    suggestSetLoad(buildLoadModel({ history, today: [], unit: "kg", warmup: { load: 210, reps: 1, rpe }, now }), { reps: 5, rpe: 4.5 });

  it("RPE 8 single: the warm-up's own chart math wins", () => {
    expect(at(8)).toEqual({ low: 157.5, high: 172.5, target: 165, unit: "kg" });
  });

  it("easier or unrated warm-ups still only nudge recent sessions", () => {
    expect(at(6)!.target).toBe(185);
    expect(at(null)!.target).toBe(185);
    expect(at(7)!.target).toBe(185);
    expect(at(7.5)!.target).toBeGreaterThan(165);
    expect(at(7.5)!.target).toBeLessThan(185);
  });

  it("trust ramps from RPE 7 to 8", () => {
    expect(warmupTrust(7)).toBe(0);
    expect(warmupTrust(8)).toBe(1);
    expect(warmupTrust(9)).toBe(1);
    expect(warmupTrust(null)).toBe(0);
  });
});
