import { describe, expect, it } from "vitest";
import { dualRange, inputKg, kgIn, roundUpWeight } from "@/lib/dual-weight";

describe("compact goal weight", () => {
  it("preserves exact source and displays both units", () => {
    const kg = inputKg(225, "lb");
    expect(kgIn(kg, "lb")).toBeCloseTo(225, 10);
    expect(dualRange(kg, null, "kg", "lb")).toEqual({ unit: "kg", primary: "102.1 kg", secondary: "225 lb" });
    expect(dualRange(inputKg(220, "lb"), kg, "kg", "lb").primary).toBe("99.8–102.1 kg");
  });
  it("rounds up only when needed and uses the meet's increment", () => {
    expect(roundUpWeight(inputKg(225, "lb"), 2.5)).toBe(102.5);
    expect(roundUpWeight(102.5, 2.5)).toBeNull();
    expect(roundUpWeight(102.1, 5)).toBe(105);
    expect(roundUpWeight(102.1, 0.5)).toBe(102.5);
    expect(roundUpWeight(0, 2.5)).toBeNull();
    expect(roundUpWeight(NaN, 2.5)).toBeNull();
  });
});

import { discussedKg, nearestMeetTarget, validMeetIncrement, inferredUnitKey, reviewedSourceUnit } from "@/lib/goal-intel/competition-review";
describe("competition review", () => {
  it("rounds draft targets without altering the original pounds", () => {
    const source = { client_unit: "lb" as const, client_value: 220, client_value_max: 225 };
    expect(nearestMeetTarget(discussedKg(source), 2.5)).toBe(102.5);
    expect(nearestMeetTarget(inputKg(115,"lb"), 2.5)).toBe(52.5);
    expect(nearestMeetTarget(inputKg(280,"lb"), 2.5)).toBe(127.5);
    expect(validMeetIncrement(inputKg(225,"lb"),2.5)).toBe(false);
    expect(validMeetIncrement(102.5,2.5)).toBe(true);
    expect(source.client_value_max).toBe(225);
  });
  it("does not infer a missing unit or accept stale source confirmation", () => {
    expect(discussedKg({client_unit:null,client_value:225,client_value_max:null})).toBeNull();
    const g = {id:"squat",version:1,client_unit:"lb" as const,client_unit_source:"inferred" as const};
    const key = inferredUnitKey(g)!;
    expect(reviewedSourceUnit(g,{[key]:true})).toBe("lb");
    expect(reviewedSourceUnit({...g,version:2},{[key]:true})).toBeUndefined();
  });
});
