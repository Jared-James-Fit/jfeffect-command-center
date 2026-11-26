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

import { discussedKg, nearestMeetTarget, validMeetIncrement, inferredUnitKey, reviewedSourceUnit, reviewTarget } from "@/lib/goal-intel/competition-review";
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

import type { GoalRow } from "@/lib/goal-intel/types";
it("distinguishes a supported Cleo option from the discussed fallback", () => {
  const g = {client_unit:"lb",client_value:220,client_value_max:225,feasibility:{confidence:"medium",recommended:"moderate",recommendedWhy:"Training supports this target",approaches:[{key:"moderate",label:"Moderate",targetKg:100,line:"Supported"}]}} as unknown as GoalRow;
  expect(reviewTarget(g,2.5,"cleo")).toMatchObject({kg:100,basis:"Cleo suggested",approach:"Moderate",reason:"Training supports this target"});
  expect(reviewTarget(g,2.5,"discussed").kg).toBe(102.5);
  expect(reviewTarget({...g,feasibility:{...g.feasibility!,confidence:"low"}},2.5,"cleo").basis).toBe("Discussed range");
});

import { targetDifficulty, goalApproachOptions } from "@/lib/goal-intel/competition-review";
import { APPROACHES } from "@/lib/goal-intel/types";
import type { Feasibility } from "@/lib/goal-intel/types";
describe("live competition target rating", () => {
  const f = {confidence:"medium",projection:{expectedKg:120,lowKg:112.5,highKg:122.5},approaches:APPROACHES.map((a,i)=>({...a,targetKg:[107.5,112.5,120,122.5,125,137.5][i]}))} as unknown as Feasibility;
  const g = {feasibility:f,client_unit:"lb" as const,client_value:264,client_value_max:280};
  it("explains the actual displayed target, not the saved rating", () => {
    expect(targetDifficulty(g,122.5)).toMatchObject({band:"high",label:"High"});
    expect(targetDifficulty(g,122.5).brief).toContain("2.5 kg above");
    expect(targetDifficulty(g,122.5).brief).toContain("within the discussed range");
    expect(targetDifficulty(g,122.5).summary).toContain("2.5 kg (5.5 lb) above forecast");
    expect(targetDifficulty(g,120).summary).toContain("At forecast");
    expect(targetDifficulty(g,120).band).toBe("moderate");
    expect(targetDifficulty(g,137.5).band).toBe("extreme");
    expect(targetDifficulty(g,137.5).brief).toContain("above the discussed range");
  });
  it("explains each menu choice using the actual rounded load and client forecast", () => {
    const rows = goalApproachOptions(g, 2.5);
    expect(rows).toHaveLength(6);
    expect(rows.find(a => a.key === "easy")?.summary).toContain("below forecast");
    expect(rows.find(a => a.key === "high")?.summary).toContain("2.5 kg (5.5 lb) above forecast");
    expect(rows.find(a => a.key === "extreme")?.summary).toContain("above discussed range");
    expect(goalApproachOptions({...g, feasibility:{...f, confidence:"low"}},2.5).every(a => a.summary.includes("Low confidence"))).toBe(true);
    expect(goalApproachOptions(g, 5).every(a => validMeetIncrement(a.kg,5))).toBe(true);
    expect(new Set(goalApproachOptions(g, 5).map(a=>a.kg)).size).toBe(goalApproachOptions(g, 5).length);
  });
  it("does not invent a rating without a complete forecast", () => {
    expect(targetDifficulty({...g,feasibility:null},120).label).toBe("Not rated");
    expect(targetDifficulty(g,null).label).toBe("No target");
    expect(targetDifficulty({...g,feasibility:{...f,confidence:"low"}},122.5).brief).toContain("provisional");
    expect(targetDifficulty({...g,feasibility:{...f,confidence:"low"}},122.5).summary).toContain("Low confidence");
  });
});
