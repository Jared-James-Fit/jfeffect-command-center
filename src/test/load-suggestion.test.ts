import { describe, expect, it } from "vitest";
import {
  buildLoadModel,
  warmupTrust,
  todayVsUsual,
  dayFactorFrom,
  DAY_FACTOR_MAX,
  estimateFor,
  loadStep,
  percentOf1RM,
  planningTarget,
  predictReadiness,
  setE1rm,
  suggestSetLoad,
  warmupE1rm,
  warmupReliability,
  warmupSpread,
  readWarmups,
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
    expect(percentOf1RM(20, 0)!).toBeLessThan(percentOf1RM(15, 0)!); // high-rep tail keeps falling
    expect(percentOf1RM(28, 4)).toBeNull(); // too far out to trust
  });

  it("ignores warm-ups and down-weights unlogged effort", () => {
    // A light rating is real work (an RPE 3–5 wave), just trusted less.
    expect(setE1rm({ load: 100, reps: 5, rpe: 3.5 })).not.toBeNull();
    expect(setE1rm({ load: 100, reps: 5, rpe: 3.5 })!.trust).toBeLessThan(setE1rm({ load: 100, reps: 5, rpe: 8 })!.trust);
    expect(setE1rm({ load: 100, reps: 5, rpe: 5 })!.trust).toBeLessThan(setE1rm({ load: 100, reps: 5, rpe: 8 })!.trust);
    expect(setE1rm({ load: 100, reps: 5, rpe: null })!.trust).toBeLessThan(setE1rm({ load: 100, reps: 5, rpe: 8 })!.trust);
  });
});

describe("buildLoadModel / suggestSetLoad", () => {
  it("one recent session gives an early estimate; a week of data a full one", () => {
    const one = buildLoadModel({ history: twoWeeks.filter((l) => l.sessionKey === "s2"), today: [], unit: "kg", now: NOW });
    expect(one.status).toBe("ready");
    expect(one.early).toBe(true);
    expect(suggestSetLoad(one, { reps: 5, rpe: 8 })).not.toBeNull();
    const two = buildLoadModel({ history: twoWeeks, today: [], unit: "kg", now: NOW });
    expect(two.status).toBe("ready");
    expect(two.early).toBe(false);
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
  // Final warm-ups are offered on the competition lifts.
  const base = () => buildLoadModel({ history: twoWeeks, today: [], unit: "kg", now: NOW, lift: "competition" });
  const withWarm = (w: { load: number; reps: number; rpe?: number | null }, extra: Record<string, unknown> = {}) =>
    buildLoadModel({ history: twoWeeks, today: [], unit: "kg", now: NOW, warmup: w, lift: "competition", ...extra });

  describe("warmupE1rm", () => {
    it("reads an easy rating as given (it reads light, measured), and how much it counts is the reliability's call", () => {
      const at6 = warmupE1rm({ load: 120, reps: 2, rpe: 6 })!;
      expect(warmupE1rm({ load: 120, reps: 2, rpe: 5 })!).toBeGreaterThan(at6);
      expect(warmupE1rm({ load: 120, reps: 2, rpe: 3 })!).toBeGreaterThan(warmupE1rm({ load: 120, reps: 2, rpe: 5 })!);
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
      const down = raw({ load: 125, reps: 3, rpe: 7 }); // near the working weight, but weak -> clamped
      const up = raw({ load: 300, reps: 1, rpe: 6 }); // implausibly strong -> clamped
      expect(down / h).toBeCloseTo(0.97, 3); // −3%
      expect(up / h).toBeCloseTo(1.015, 3); // +1.5%
      expect(h - down).toBeGreaterThan(up - h);
    });

    it("a hard (RPE 8+) warm-up is read like a set: down as far as it says, never above the same warm-up rated a normal 7", () => {
      const h = estimateFor(base(), 5, 8)!.load;
      const weak = estimateFor(withWarm({ load: 125, reps: 3, rpe: 9 }), 5, 8)!.load;
      expect(weak).toBeCloseTo(warmupE1rm({ load: 125, reps: 3, rpe: 9 })! * percentOf1RM(5, 2)!, 6);
      const strong = estimateFor(withWarm({ load: 300, reps: 1, rpe: 8 }), 5, 8)!.load;
      const strongNormal = estimateFor(withWarm({ load: 300, reps: 1, rpe: 7 }), 5, 8)!.load;
      expect(strong).toBeLessThanOrEqual(strongNormal + 1e-9);
      expect(strong / h).toBeLessThanOrEqual(1.015 + 1e-9);
    });

    it("rating the same warm-up harder never raises today's weight (with or without history)", () => {
      const cold = (rpe: number) => estimateFor(buildLoadModel({ history: [], today: [], unit: "kg", now: NOW, warmup: { load: 122.5, reps: 2, rpe } }), 5, 8)!.load;
      const warm = (rpe: number) => estimateFor(withWarm({ load: 160, reps: 2, rpe }), 5, 8)!.load;
      for (const f of [cold, warm]) {
        const loads = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10].map(f);
        for (let i = 1; i < loads.length; i++) expect(loads[i]).toBeLessThanOrEqual(loads[i - 1] + 1e-9);
      }
    });

    it("keeps the readiness trim instead of cancelling it", () => {
      const tired = { multiplier: 0.95, reasons: ["short sleep"] };
      const noWarm = estimateFor(buildLoadModel({ history: twoWeeks, today: [], unit: "kg", now: NOW, readiness: tired, lift: "competition" }), 5, 8)!.load;
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

describe("light prescriptions (RPE 3-5) are planned at their real effort", () => {
  it("planningTarget keeps RPE 3-5 instead of bumping it up", () => {
    expect(MIN_RPE).toBe(3);
    expect(planningTarget({ repTarget: { exact: 5 }, rpeTarget: { min: 4, max: 5 }, rirTarget: {} })).toEqual({ reps: 5, rpe: 4.5 });
    expect(planningTarget({ repTarget: { exact: 7 }, rpeTarget: { exact: 3 }, rirTarget: {} })).toEqual({ reps: 7, rpe: 3 });
    expect(planningTarget({ repTarget: { exact: 1 }, rpeTarget: { exact: 2 }, rirTarget: {} })).toEqual({ reps: 1, rpe: 3 });
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
    expect(at(8)).toEqual({ low: 157.5, high: 172.5, target: 165, unit: "kg", warmup: "tuned" });
  });

  it("easier or unrated warm-ups still only nudge recent sessions", () => {
    // RPE 6 is believed about a third as much as a 7 when it reads lighter: between the 7's 185 and history's own
    const plain = suggestSetLoad(buildLoadModel({ history, today: [], unit: "kg", now }), { reps: 5, rpe: 4.5 })!.target;
    expect(at(6)!.target).toBeGreaterThanOrEqual(185);
    expect(at(6)!.target).toBeLessThanOrEqual(plain);
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

describe("live across cards: today's top set moves the lift's other cards", () => {
  const plan = { reps: 5, rpe: 8 };
  const cold = estimateFor(buildLoadModel({ history: twoWeeks, today: [], unit: "kg", now: NOW }), 5, 8)!.load;

  it("reads today vs usual from the sets logged (1 = as predicted)", () => {
    const usual = todayVsUsual({ history: twoWeeks, sets: [{ load: cold, reps: 5, rpe: 8 }], unit: "kg", now: NOW })!;
    expect(usual).toBeCloseTo(1, 6);
    const strong = todayVsUsual({ history: twoWeeks, sets: [{ load: cold * 1.05, reps: 5, rpe: 8 }], unit: "kg", now: NOW })!;
    expect(strong).toBeCloseTo(1.05, 6);
  });

  it("counts light sets too (monotonic: rated easier reads as a better day) and needs history", () => {
    const at = (rpe: number) => todayVsUsual({ history: twoWeeks, sets: [{ load: 140, reps: 5, rpe }], unit: "kg", now: NOW })!;
    expect(at(5)).not.toBeNull();
    expect(at(5)).toBeGreaterThan(at(6));
    expect(at(6)).toBeGreaterThan(at(8));
    expect(todayVsUsual({ history: [], sets: [{ load: 140, reps: 5, rpe: 8 }], unit: "kg", now: NOW })).toBeNull();
  });

  it("trust and cap: same exercise 80%, a variation 50%, never past ±8%", () => {
    expect(dayFactorFrom(1.05, 0.8)).toBeCloseTo(1.04, 6);
    expect(dayFactorFrom(1.05, 0.5)).toBeCloseTo(1.025, 6);
    expect(dayFactorFrom(1.3, 0.8)).toBeCloseTo(1 + DAY_FACTOR_MAX, 6);
    expect(dayFactorFrom(0.6, 0.8)).toBeCloseTo(1 - DAY_FACTOR_MAX, 6);
    expect(dayFactorFrom(1.003, 0.8)).toBeNull();
  });

  it("a back-off before its own first set moves by the day factor, replacing the review forecast", () => {
    const tired = { multiplier: 0.97, reasons: ["short sleep"] };
    const m = buildLoadModel({ history: twoWeeks, today: [], unit: "kg", now: NOW, readiness: tired, dayFactor: 1.04 });
    expect(m.dayFactor).toBeCloseTo(1.04, 6);
    expect(m.readiness.multiplier).toBe(1);
    expect(estimateFor(m, 5, 8)!.load / cold).toBeCloseTo(1.04, 6);
    expect(suggestSetLoad(m, plan)!.target).toBeGreaterThan(suggestSetLoad(buildLoadModel({ history: twoWeeks, today: [], unit: "kg", now: NOW }), plan)!.target);
  });

  it("once the card has its own set, its own sets lead (no day factor)", () => {
    const m = buildLoadModel({ history: twoWeeks, today: [{ load: 150, reps: 5, rpe: 8 }], unit: "kg", now: NOW, dayFactor: 0.95 });
    expect(m.dayFactor).toBeNull();
    expect(m.source).toBe("blend");
  });

  it("a brand-new lift's back-off borrows today's top set of the same exercise", () => {
    const m = buildLoadModel({ history: [], today: [], unit: "kg", now: NOW, carryToday: [{ load: 150, reps: 3, rpe: 8 }] });
    expect(m.status).toBe("ready");
    expect(m.source).toBe("today");
    expect(m.carried).toBe(true);
    expect(suggestSetLoad(m, { reps: 5, rpe: 8 })!.target).toBeLessThan(150);
  });
});

describe("early estimate: one recent session is enough to suggest", () => {
  // Larsen Press, Oct 2026: one session (185 lb x 7 @ 4) and Suggest showed nothing.
  const larsen = [1, 2, 3].map(() => log("l1", 6, 84, 7, 4));

  it("one recent session with an RPE suggests, labelled early, with a wider range", () => {
    const m = buildLoadModel({ history: larsen, today: [], unit: "kg", now: NOW });
    expect(m.status).toBe("ready");
    expect(m.early).toBe(true);
    const s = suggestSetLoad(m, { reps: 7, rpe: 5 })!;
    expect(s.target).toBeGreaterThanOrEqual(82.5);
    expect(s.target).toBeLessThanOrEqual(87.5);
    expect(s.high - s.low).toBeGreaterThanOrEqual(10);
  });

  it("not from a session without any RPE, or one older than 4 weeks", () => {
    expect(buildLoadModel({ history: [log("x", 6, 84, 7, null)], today: [], unit: "kg", now: NOW }).status).toBe("calibrating");
    expect(buildLoadModel({ history: [log("x", 30, 84, 7, 6)], today: [], unit: "kg", now: NOW }).status).toBe("calibrating");
  });

  it("two sessions a week apart are a full (not early) suggestion", () => {
    expect(buildLoadModel({ history: twoWeeks, today: [], unit: "kg", now: NOW }).early).toBe(false);
  });

  it("an early estimate never drives another card's day read", () => {
    expect(todayVsUsual({ history: larsen, sets: [{ load: 90, reps: 7, rpe: 6 }], unit: "kg", now: NOW })).toBeNull();
  });
});

describe("high-rep accessories (10–20, 20+ reps)", () => {
  // Standing Calf Raise - Machine, Oct 2026: 10–20 @ RPE 9–10, every set ever
  // logged at 20 reps, so the old 15-rep cap left Suggest with nothing at all.
  const calf = (session: string, d: number, lb: number) =>
    log(session, d, lb / 2.2046226218, 20, 10, { exerciseName: "Standing Calf Raise - Machine", enteredValue: lb, enteredUnit: "lb", normalizedLb: lb });
  const history = [calf("a", 9, 100), calf("b", 5, 25), calf("c", 1, 50), calf("c", 1, 50)];
  const plan = planningTarget({ repTarget: { min: 10, max: 20 }, rpeTarget: { min: 9, max: 10 }, rirTarget: {} })!;

  it("plans 10–20 @ 9–10 at the midpoint and reads 20-rep sets", () => {
    expect(plan).toEqual({ reps: 15, rpe: 9.5 });
    expect(setE1rm({ load: 50, reps: 20, rpe: 10 })).not.toBeNull();
    expect(setE1rm({ load: 50, reps: 20, rpe: 10 })!.trust).toBeGreaterThanOrEqual(0.7); // counts as a set today
    expect(planningTarget({ repTarget: { min: 15, max: 20 }, rpeTarget: { exact: 8 }, rirTarget: {} })).toEqual({ reps: 18, rpe: 8 });
  });

  it("suggests from history before the first set, and live after it", () => {
    const cold = buildLoadModel({ history, today: [], unit: "lb", now: NOW });
    expect(cold.status).toBe("ready");
    const s = suggestSetLoad(cold, plan)!;
    // 50 × 20 @ 10 yesterday → 15 @ 9.5 a little heavier, never a jump.
    expect(s.target).toBeGreaterThanOrEqual(50);
    expect(s.target).toBeLessThanOrEqual(55);
    const live = buildLoadModel({ history, today: [{ load: 45, reps: 20, rpe: 10 }], unit: "lb", now: NOW });
    expect(live.source).toBe("blend");
    expect(suggestSetLoad(live, plan)!.target).toBeGreaterThanOrEqual(45);
  });

  it("past the chart there's no plan (30 reps @ RPE 7), so no empty promise", () => {
    expect(planningTarget({ repTarget: { exact: 30 }, rpeTarget: { exact: 7 }, rirTarget: {} })).toBeNull();
    expect(setE1rm({ load: 50, reps: 31, rpe: 10 })).toBeNull();
  });
});

describe("effort is monotonic: the same set rated easier never lowers the suggestion", () => {
  // 3-0-0 Tempo to Knee Sumo Deadlift, 3 × 7 @ RPE 5 — an RPE wave (3 → 4 → 5).
  // Oct 2026: 3 × 235 × 7 rated 4 said "next time 240"; rated 3 it said 235.
  const lb = (session: string, d: number, load: number, rpe: number) =>
    log(session, d, load / 2.2046226218, 7, rpe, { enteredValue: load, enteredUnit: "lb", normalizedLb: load });
  const history = [lb("w1", 13, 315, 3), lb("w1", 13, 315, 3), lb("w2", 6, 225, 4), lb("w2", 6, 225, 4), lb("w2", 6, 225, 4)];
  const next = (rpe: number) =>
    suggestSetLoad(buildLoadModel({ history, today: [1, 2, 3].map(() => ({ load: 235, reps: 7, rpe })), unit: "lb", now: NOW }), { reps: 7, rpe: 5 })!.target;

  it("235 × 7 rated 6 → 5 → 4 → 3 → 2 only ever goes up", () => {
    const seq = [6, 5, 4, 3, 2].map(next);
    expect(seq).toEqual([...seq].sort((a, b) => a - b));
    expect(next(5)).toBe(235); // right on plan: same weight
    // One RPE easier is ~1.5% on a 7-rep set, under a plate step once history
    // is read near the load used (HISTORY_PROFILES.other): never down, and two
    // easier goes up.
    expect(next(4)).toBeGreaterThanOrEqual(235);
    expect(next(3)).toBeGreaterThan(235);
    expect(next(6)).toBeLessThan(235); // harder than planned: down
  });

  it("a set rated within a point of the target counts both ways (a heavy day pulls it down)", () => {
    const heavyDay = buildLoadModel({ history: twoWeeks, today: [{ load: 110, reps: 5, rpe: 8 }], unit: "kg", now: NOW });
    const cold = buildLoadModel({ history: twoWeeks, today: [], unit: "kg", now: NOW });
    expect(estimateFor(heavyDay, 5, 9)!.load).toBeLessThan(estimateFor(cold, 5, 9)!.load);
  });

  it("a clearly easy set is a floor: it can lift the number, never drag it down", () => {
    const cold = estimateFor(buildLoadModel({ history: twoWeeks, today: [], unit: "kg", now: NOW }), 5, 8)!.load;
    const opener = estimateFor(buildLoadModel({ history: twoWeeks, today: [{ load: 100, reps: 5, rpe: 5 }], unit: "kg", now: NOW }), 5, 8)!.load;
    const strong = estimateFor(buildLoadModel({ history: twoWeeks, today: [{ load: 150, reps: 5, rpe: 5 }], unit: "kg", now: NOW }), 5, 8)!.load;
    expect(opener).toBeCloseTo(cold, 6);
    expect(strong).toBeGreaterThan(cold);
  });

  it("an easy rating can claim at most 2 RPE of credit", () => {
    const at = (rpe: number) => estimateFor(buildLoadModel({ history: [], today: [{ load: 100, reps: 5, rpe }], unit: "kg", now: NOW }), 5, 8)!.load;
    expect(at(5)).toBeCloseTo(at(6), 6);
    expect(at(3)).toBeCloseTo(at(6), 6);
    expect(at(6.5)).toBeLessThan(at(6));
  });
});


/**
 * Nov 20 2026: the suggestion must not depend on the order weight, reps and RPE
 * were typed in, and an easy warm-up must not be read as precise (it was floored
 * at RPE 6, so a warm-up called easy pulled today's weight down by up to 3%).
 */
describe("low-RPE warm-ups: a reliability model, not a floor", () => {
  const plan = { reps: 5, rpe: 8 };
  const hist = () => buildLoadModel({ history: twoWeeks, today: [], unit: "kg", now: NOW, lift: "competition" });
  const withWarm = (warmups: Array<{ load: number; reps: number; rpe?: number | null }>, unit: "kg" | "lb" = "kg", history = twoWeeks) =>
    buildLoadModel({ history, today: [], unit, now: NOW, warmups, lift: "competition" });

  it("the spread grows with reps in reserve (measured ~3.5% a rep) and reliability ramps 0 → 1 between RPE 5 and 7", () => {
    expect(warmupSpread(9)).toBeCloseTo(0.035, 6);
    expect(warmupSpread(7)).toBeCloseTo(0.105, 6);
    expect(warmupSpread(4)).toBeCloseTo(0.21, 6);
    expect(warmupSpread(null)).toBeCloseTo(warmupSpread(7), 9);
    expect(warmupReliability(4)).toBe(0);
    expect(warmupReliability(5)).toBe(0);
    expect(warmupReliability(7)).toBe(1);
    expect(warmupReliability(9)).toBe(1);
    expect(warmupReliability(null)).toBe(1); // unrated = a normal last warm-up
    let prev = -1;
    for (let r = 3; r <= 10; r += 0.01) {
      const k = warmupReliability(r);
      expect(k).toBeGreaterThanOrEqual(prev);
      expect(k - Math.max(prev, 0)).toBeLessThan(0.02); // continuous: no jumps
      prev = k;
    }
  });

  it("an easy warm-up that reads lighter than history leaves history's number alone, and says why", () => {
    const h = estimateFor(hist(), 5, 8)!.load;
    for (const rpe of [3, 4, 5]) {
      const e = estimateFor(withWarm([{ load: 100, reps: 3, rpe }]), 5, 8)!;
      expect(e.load).toBeCloseTo(h, 9);
      expect(e.warmup).toBe("too_easy");
      expect(suggestSetLoad(withWarm([{ load: 100, reps: 3, rpe }]), plan)!.warmup).toBe("too_easy");
    }
    // a normal one that reads light still backs it off (as before), and says it tuned it
    const normal = estimateFor(withWarm([{ load: 100, reps: 3, rpe: 7 }]), 5, 8)!;
    expect(normal.load).toBeLessThan(h);
    expect(normal.warmup).toBe("tuned");
  });

  it("an easy warm-up that reads heavier than history is a lower bound: a small up, never more than +1.5%", () => {
    const h = estimateFor(hist(), 5, 8)!.load;
    const up = estimateFor(withWarm([{ load: 150, reps: 3, rpe: 4 }]), 5, 8)!;
    expect(up.load).toBeGreaterThan(h);
    expect(up.load / h).toBeLessThanOrEqual(1.015 + 1e-9);
    expect(up.warmup).toBe("tuned");
  });

  it("rating the same warm-up harder never raises the weight, and moving the rating never jumps it", () => {
    for (const w of [{ load: 100, reps: 3 }, { load: 130, reps: 2 }, { load: 150, reps: 1 }, { load: 160, reps: 3 }]) {
      let prev = Infinity;
      for (let r = 3; r <= 10; r += 0.5) {
        const load = estimateFor(withWarm([{ ...w, rpe: r }]), 5, 8)!.load;
        expect(load).toBeLessThanOrEqual(prev + 1e-9);
        // smooth through the reliability ramp (RPE 7 to 8 is the hard-set ramp, note 8)
        if (prev !== Infinity && r <= 7) expect(prev - load).toBeLessThan(prev * 0.025);
        prev = load;
      }
    }
  });

  it("no history and a warm-up too easy to read: no number is made up, the card is told why", () => {
    const cold = (rpe: number) => buildLoadModel({ history: [], today: [], unit: "kg", now: NOW, warmups: [{ load: 100, reps: 3, rpe }] });
    for (const rpe of [3, 4, 5]) {
      const m = cold(rpe);
      expect(m.status).toBe("calibrating");
      expect(m.warmupTooEasy).toBe(true);
      expect(suggestSetLoad(m, plan)).toBeNull();
    }
    const ok = cold(6);
    expect(ok.status).toBe("ready");
    expect(ok.source).toBe("warmup");
    // the range is as wide as the rating is believable (RPE 6: ±14%), never narrower than the old ±8%
    expect(estimateFor(ok, 5, 8)!.spread).toBeCloseTo(warmupSpread(6), 6);
    expect(estimateFor(cold(9), 5, 8)!.spread).toBeGreaterThanOrEqual(0.035 - 1e-9);
  });

  it("several warm-ups read the same in any order; lighter ramp sets don't drag it down", () => {
    const ramp = [
      { load: 60, reps: 5, rpe: 7 },   // the bar and a light set, rated at the default
      { load: 100, reps: 3, rpe: 7 },
      { load: 135, reps: 2, rpe: 7 },
      { load: 140, reps: 1, rpe: 7.5 },
    ];
    const perms = [ramp, [...ramp].reverse(), [ramp[2], ramp[0], ramp[3], ramp[1]], [ramp[1], ramp[3], ramp[0], ramp[2]]];
    const reads = perms.map((p) => readWarmups(p)!);
    for (const r of reads) expect(r).toEqual(reads[0]);
    const loads = perms.map((p) => estimateFor(withWarm(p), 5, 8)!.load);
    for (const l of loads) expect(l).toBeCloseTo(loads[0], 9);
    // only the top two (within 7.5% of the heaviest) are read
    expect(reads[0].count).toBe(2);
    expect(reads[0].load).toBe(140);
    // the bar and the 100 kg triple change nothing: it's the top sets that speak
    expect(loads[0]).toBeCloseTo(estimateFor(withWarm([ramp[2], ramp[3]]), 5, 8)!.load, 9);
  });

  it("a tie on weight is broken by the rating, then the reps, never by which was logged last", () => {
    const a = { load: 140, reps: 1, rpe: 7 };
    const b = { load: 140, reps: 2, rpe: 7 };
    const c = { load: 140, reps: 1, rpe: 8 };
    expect(readWarmups([a, b])).toEqual(readWarmups([b, a]));
    expect(readWarmups([a, c])!.rpe).toBe(8);
    expect(readWarmups([c, a])!.rpe).toBe(8);
  });

  it("singles and multi-rep warm-ups are read through the chart, and kg / lb give the same weight", () => {
    const kg = suggestSetLoad(withWarm([{ load: 140, reps: 1, rpe: 7 }]), plan)!;
    const lbHistory = twoWeeks.map((l) => ({ ...l, enteredUnit: "lb" as const, enteredValue: l.normalizedLb }));
    const lb = suggestSetLoad(withWarm([{ load: 140 * 2.2046226218, reps: 1, rpe: 7 }], "lb", lbHistory), plan)!;
    expect(Math.abs(lb.target / 2.2046226218 - kg.target)).toBeLessThanOrEqual(2.5); // a plate step either way
    const triple = estimateFor(withWarm([{ load: 125, reps: 3, rpe: 7 }]), 5, 8)!.load;
    const single = estimateFor(withWarm([{ load: 140, reps: 1, rpe: 7 }]), 5, 8)!.load;
    expect(Math.abs(triple / single - 1)).toBeLessThan(0.03);
  });

  it("strength level doesn't matter: the same warm-up relative to history moves the number by the same share", () => {
    const scaled = (k: number) => twoWeeks.map((l) => ({ ...l, normalizedKg: l.normalizedKg! * k, enteredValue: l.normalizedKg! * k, normalizedLb: l.normalizedLb! * k }));
    const share = (k: number, rpe: number) => {
      const h = estimateFor(buildLoadModel({ history: scaled(k), today: [], unit: "kg", now: NOW, lift: "competition" }), 5, 8)!.load;
      return estimateFor(withWarm([{ load: 120 * k, reps: 2, rpe }], "kg", scaled(k)), 5, 8)!.load / h;
    };
    for (const rpe of [4, 6, 7, 8]) expect(share(0.5, rpe)).toBeCloseTo(share(1.6, rpe), 6);
  });
});
