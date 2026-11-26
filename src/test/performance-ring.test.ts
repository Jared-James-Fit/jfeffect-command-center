import { describe, expect, it } from "vitest";
import { currentRing, competitionRing, gymRingBests, ringTotal, type GymRingRecord } from "@/lib/analytics/performance-ring";
import { weightContextAt, weightPeriods, nearestWeightReference } from "@/lib/analytics/weight-context";
import { liftStrengths } from "@/lib/analytics/lift-strength";
import type { MeetResult } from "@/lib/analytics/competition-strength";

const refs = [{ kg: 66, label: "66 kg" }, { kg: 74, label: "74 kg" }];
const meet = (date: string, weightClass: string, squat: number, bench: number, deadlift: number): MeetResult => ({
  date, weightClass, name: date, lifts: { squat, bench, deadlift }, total: squat + bench + deadlift, bodyweightLb: null,
});
describe("dated training weight categories", () => {
  const points = [{day:"2026-01-01",kg:66},{day:"2026-01-02",kg:67},{day:"2026-02-01",kg:74},{day:"2026-02-02",kg:74},{day:"2026-03-01",kg:66},{day:"2026-03-02",kg:66}];
  it("uses the nearest reference, not the competition eligibility ceiling", () => {
    expect(nearestWeightReference(68, refs)?.label).toBe("66 kg");
    expect(nearestWeightReference(72, refs)?.label).toBe("74 kg");
  });
  it("does not assign past records today's class or bridge long logging gaps", () => {
    expect(weightContextAt(points, refs, "2026-01-02").category?.label).toBe("66 kg");
    expect(weightContextAt(points, refs, "2026-01-20").category).toBeNull();
    expect(weightContextAt(points, refs, "2026-02-02").category?.label).toBe("74 kg");
    expect(weightPeriods(points, refs).map(p => p.category)).toEqual(["66 kg","74 kg","66 kg"]);
  });
});
describe("performance views", () => {
  const meets = [meet("2026-03-01","66",500,330,600),meet("2026-04-01","74",550,300,610),meet("2026-05-01","66",520,310,590)];
  it("does not replace a missing current estimate with an achieved meet", () => {
    const result = currentRing(liftStrengths([], meets, "2026-11-26"), "2026-11-26");
    expect(result.totalLb).toBeNull();
    expect(result.missing).toHaveLength(3);
  });
  it("keeps official meet totals separate from aggregated best lifts", () => {
    const official = competitionRing(meets, "66 kg", "best");
    const individual = competitionRing(meets, "66 kg", "individual");
    expect(official.totalLb).toBe(1430);
    expect(individual.totalLb).toBe(1450);
    expect(individual.meet).toBeNull();
  });
  it("filters actual and estimated gym records independently by historical category", () => {
    const records: GymRingRecord[] = [
      { lift:"squat",metric:"actual",lb:500,day:"2026-01-01",detail:"",classLabel:"66 kg" },
      { lift:"squat",metric:"actual",lb:530,day:"2026-02-01",detail:"",classLabel:"74 kg" },
      { lift:"squat",metric:"estimated",lb:550,day:"2026-01-01",detail:"",classLabel:"66 kg" },
    ];
    expect(gymRingBests(records,"actual","66 kg").squat?.lb).toBe(500);
    expect(gymRingBests(records,"estimated","66 kg").squat?.lb).toBe(550);
    expect(gymRingBests(records,"actual","all").squat?.lb).toBe(530);
    expect(ringTotal(gymRingBests(records,"actual","all"))).toBeNull();
  });
});
