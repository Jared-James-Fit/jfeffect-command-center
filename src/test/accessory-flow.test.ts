/**
 * Accessory flow: accessories grouped by station after the main lifts, never at
 * the cost of the main lifts' order, a muscle's training order or a priority
 * (Nov 18 2026). The sessions are the generator's own, from programs it wrote.
 */
import { describe, expect, it } from "vitest";
import { flowStation, isMainLift, orderAccessories, priorityMuscles, reletterSupersets, stationChanges, stationReturns, withAccessoryFlow } from "@/lib/program-intel/accessory-flow";

type Ex = { exercise_name: string; role?: string | null; superset?: string | null; equipment: string | null };
const ex = (exercise_name: string, equipment: string | null, role: string | null = "Accessory", superset: string | null = null): Ex => ({ exercise_name, equipment, role, superset });
const eq = (e: Ex) => e.equipment;
const names = (xs: Ex[]) => xs.map((e) => e.exercise_name);

const squatDay = (): Ex[] => [
  ex("Competition Squat", "Barbell, Rack", "Primary Squat"),
  ex("Competition Squat", "Barbell, Rack", "Primary Squat Backoff"),
  ex("Leg Extension - Machine", "Machine", "Accessory", "A1"),
  ex("Seated Leg Curl Machine", "Machine", "Accessory", "A2"),
  ex("Hip Thrust - Barbell", "Barbell"),
  ex("Standing Calf Raise - Machine", "Machine"),
];

describe("orderAccessories", () => {
  it("brings a barbell compound back next to the squat instead of walking back to the bar later", () => {
    const r = orderAccessories(squatDay(), eq);
    expect(names(r.exercises)).toEqual(["Competition Squat", "Competition Squat", "Hip Thrust - Barbell", "Leg Extension - Machine", "Seated Leg Curl Machine", "Standing Calf Raise - Machine"]);
    expect(r.before).toBe(3);
    expect(r.after).toBe(1);
    expect(r.moved).toEqual([{ name: "Hip Thrust - Barbell", toMain: true }]);
  });

  it("never moves anything past a priority muscle's work", () => {
    const day = squatDay();
    const r = orderAccessories(day, eq, { priorities: ["Quads"] });
    expect(r.exercises).toBe(day);
  });

  it("keeps the main lifts and anything between them exactly where they are", () => {
    const day = [
      ex("Competition Deadlift", "Barbell, Rack", "Primary Deadlift"),
      ex("Lateral Raises Dumbbell", "Dumbbell"),
      ex("Bent-Over Barbell Row", "Barbell", "Secondary Back"),
      ex("Cable Triceps Pushdown", "Cable"),
      ex("Dumbbell Hammer Curl", "Dumbbell"),
      ex("Cable Rope Face Pull", "Cable"),
    ];
    const r = orderAccessories(day, eq);
    expect(names(r.exercises).slice(0, 3)).toEqual(["Competition Deadlift", "Lateral Raises Dumbbell", "Bent-Over Barbell Row"]);
    expect(names(r.exercises).slice(3)).toEqual(["Cable Triceps Pushdown", "Cable Rope Face Pull", "Dumbbell Hammer Curl"]);
  });

  it("never puts an isolation ahead of a compound that works the same muscle (curls before rows, pushdowns before presses)", () => {
    const curls = [ex("Barbell Bench Press", "Barbell", "Primary Bench"), ex("Incline Bench Press - Dumbbell", "Dumbbell"), ex("Cable Seated Row", "Cable"), ex("Dumbbell Curl", "Dumbbell")];
    expect(orderAccessories(curls, eq).exercises).toBe(curls);
    const pushdowns = [ex("Competition Squat", "Barbell, Rack", "Primary Squat"), ex("Cable Triceps Pushdown", "Cable"), ex("Dumbbell Shoulder Press", "Dumbbell"), ex("Overhead Cable Triceps Extension", "Cable")];
    // the second triceps exercise may not jump ahead of the press that works triceps too
    expect(orderAccessories(pushdowns, eq).exercises).toBe(pushdowns);
  });

  it("groups unrelated accessories at one station", () => {
    const day = [
      ex("Barbell Bench Press", "Barbell", "Primary Bench"),
      ex("Chest Supported Dumbbell Row", "Dumbbell"),
      ex("Cable Triceps Pushdown", "Cable"),
      ex("Lateral Raises Dumbbell", "Dumbbell"),
      ex("Straight Bar Cable Curl", "Cable"),
    ];
    const r = orderAccessories(day, eq);
    expect(names(r.exercises)).toEqual(["Barbell Bench Press", "Chest Supported Dumbbell Row", "Lateral Raises Dumbbell", "Cable Triceps Pushdown", "Straight Bar Cable Curl"]);
    expect(r.after).toBeLessThan(r.before);
    expect(r.moved).toEqual([{ name: "Lateral Raises Dumbbell", toMain: false }]);
  });

  it("never pulls an isolation forward to the main lift's bar (an EZ-bar curl isn't the deadlift's setup)", () => {
    const day = [ex("Competition Deadlift", "Barbell, Rack", "Primary Deadlift"), ex("Lying Hamstring Curl - Machine", "Machine"), ex("EZ Bar Curl", "Barbell")];
    expect(orderAccessories(day, eq).exercises).toBe(day);
  });

  it("moves a superset as one and letters supersets in the order they come", () => {
    const day = [
      ex("Barbell Bench Press", "Barbell", "Primary Bench"),
      ex("Cable Middle Fly", "Cable"),
      ex("Lateral Raises Dumbbell", "Dumbbell", "Accessory", "A1"),
      ex("Dumbbell Hammer Curl", "Dumbbell", "Accessory", "A2"),
      ex("Cable Triceps Pushdown", "Cable", "Accessory", "B1"),
      ex("Cable Crunch", "Cable", "Accessory", "B2"),
    ];
    const r = orderAccessories(day, eq);
    expect(names(r.exercises)).toEqual(["Barbell Bench Press", "Cable Middle Fly", "Cable Triceps Pushdown", "Cable Crunch", "Lateral Raises Dumbbell", "Dumbbell Hammer Curl"]);
    const lettered = reletterSupersets(r.exercises);
    expect(lettered.map((e) => e.superset)).toEqual([null, null, "A1", "A2", "B1", "B2"]);
  });

  it("leaves a session alone when it already flows, or when nothing can move without breaking an order", () => {
    const flows = [ex("Competition Squat", "Barbell, Rack", "Primary Squat"), ex("Leg Press Machine", "Machine"), ex("Seated Leg Curl Machine", "Machine"), ex("Standing Calf Raise - Machine", "Machine")];
    expect(orderAccessories(flows, eq).exercises).toBe(flows);
    // a name the classifier can't read is never moved and never moved past
    const unknown = [ex("Competition Squat", "Barbell, Rack", "Primary Squat"), ex("Leg Press Machine", "Machine"), ex("Zercher Carry Thing", "Barbell"), ex("Leg Extension - Machine", "Machine")];
    expect(orderAccessories(unknown, eq).exercises).toBe(unknown);
  });

  it("treats bodyweight work as doable anywhere", () => {
    const day = [ex("Barbell Bench Press", "Barbell", "Primary Bench"), ex("Chest Supported Dumbbell Row", "Dumbbell"), ex("Reverse Crunch", "Bodyweight"), ex("Dumbbell Hammer Curl", "Dumbbell")];
    expect(stationChanges(day, eq)).toBe(1);
    expect(orderAccessories(day, eq).exercises).toBe(day);
  });
});

describe("stationReturns", () => {
  it("names the accessory that goes back to a station the session left", () => {
    const day = [ex("Barbell Bench Press", "Barbell", "Primary Bench"), ex("Cable Middle Fly", "Cable"), ex("Lateral Raises Dumbbell", "Dumbbell"), ex("Cable Triceps Pushdown", "Cable")];
    expect(stationReturns(day, eq)).toEqual([{ name: "Cable Triceps Pushdown", station: "cable" }]);
    expect(stationReturns(squatDay(), eq)).toEqual([{ name: "Hip Thrust - Barbell", station: "barbell" }, { name: "Standing Calf Raise - Machine", station: "machine" }]);
  });
});

describe("the pieces", () => {
  it("reads main lifts from the session's first exercise and the main-work labels", () => {
    expect(isMainLift({ exercise_name: "Leg Press", role: "Accessory" }, 0)).toBe(true);
    expect(isMainLift({ exercise_name: "Belt Squat", role: "Secondary Quads" }, 3)).toBe(true);
    expect(isMainLift({ exercise_name: "Competition Squat", role: "Primary Squat Backoff" }, 1)).toBe(true);
    expect(isMainLift({ exercise_name: "Leg Press", role: "Accessory" }, 2)).toBe(false);
    expect(isMainLift({ exercise_name: "Competition Bench", role: null }, 2)).toBe(true);
    expect(isMainLift({ exercise_name: "Cable Fly", role: "Lats" }, 2)).toBe(false);
  });

  it("puts a home gym's leg attachment apart from a commercial gym's machines", () => {
    expect(flowStation("Leg Extension - Machine", "Machine")).toBe("machine");
    expect(flowStation("Leg Extension - Machine", "Machine", { home: true, items: ["leg_extension", "leg_curl", "dumbbells"] })).toBe("leg attachment");
    expect(flowStation("Push Up", "Bodyweight")).toBeNull();
    expect(flowStation("Band Pull Apart", "Bands")).toBeNull();
  });

  it("reads priorities as muscles, never lifts", () => {
    expect([...priorityMuscles(["Side delts"])]).toEqual(["side_delts"]);
    expect([...priorityMuscles(["Shoulders"])].sort()).toEqual(["front_delts", "rear_delts", "side_delts"]);
    expect(priorityMuscles(["Bench", "Squat lockout"]).size).toBe(0);
    expect([...priorityMuscles(["Upper back"])]).toEqual(["upper_back"]);
  });

  it("says what moved for the coach and leaves an unchanged block as it was", () => {
    const block = { name: "Block", days: [{ title: "Monday — Squat-led lower body", exercises: squatDay() }, { title: "Tuesday", exercises: [ex("Barbell Bench Press", "Barbell", "Primary Bench"), ex("Cable Middle Fly", "Cable")] }] };
    const r = withAccessoryFlow(block, eq);
    expect(r.notes).toEqual(["Monday — Squat-led lower body: Hip Thrust - Barbell moved up to follow the main lift at the same setup (3 → 1 station change after the main lifts)."]);
    expect(r.saved).toBe(2);
    expect(r.block.days[1]).toBe(block.days[1]);
    const again = withAccessoryFlow(r.block, eq);
    expect(again.block).toBe(r.block);
    expect(again.notes).toEqual([]);
  });
});

describe("real sessions the generator wrote", () => {
  it("never pulls an upper-body superset in front of the hamstring curl because its curl is on a barbell", () => {
    const day = [
      ex("Competition Deadlift", "Barbell, Rack", "Primary Deadlift"),
      ex("Competition Deadlift", "Barbell, Rack", "Primary Deadlift Backoff"),
      ex("Lying Hamstring Curl - Machine", "Machine"),
      ex("Lat Pull Down Normal Grip", "Cable", "Accessory", "A1"),
      ex("EZ Bar Curl", "Barbell", "Accessory", "A2"),
      ex("Reverse Crunch", "Bodyweight"),
    ];
    expect(orderAccessories(day, eq).exercises).toBe(day);
  });

  it("keeps curls after the pulldown and pushdowns after the press, even though that means a second trip to the station", () => {
    const pull = [ex("Chest Supported Dumbbell Row", "Dumbbell", "Primary"), ex("Lat Pull Down Normal Grip", "Cable", "Secondary"), ex("Dumbbell Curl", "Dumbbell")];
    expect(orderAccessories(pull, eq).exercises).toBe(pull);
    const push = [ex("Barbell Bench Press", "Barbell", "Primary Bench"), ex("Cable Seated Row", "Cable"), ex("Incline Dumbbell Press", "Dumbbell"), ex("Cable Triceps Pushdown", "Cable")];
    expect(orderAccessories(push, eq).exercises).toBe(push);
  });

  it("puts the hip thrust straight after the squat and the leg machines together", () => {
    const day = [
      ex("Competition Deadlift", "Barbell, Rack", "Primary Deadlift"),
      ex("Competition Squat", "Barbell, Rack", "Secondary Squat"),
      ex("Seated Leg Curl Machine", "Machine", "Accessory", "A1"),
      ex("Standing Calf Raise - Machine", "Machine", "Accessory", "A2"),
      ex("Hip Thrust - Barbell", "Barbell"),
    ];
    expect(names(orderAccessories(day, eq).exercises)).toEqual(["Competition Deadlift", "Competition Squat", "Hip Thrust - Barbell", "Seated Leg Curl Machine", "Standing Calf Raise - Machine"]);
  });
});

describe("the generator and Edit with AI are told the same rule", async () => {
  const { ACCESSORY_FLOW_RULES, accessoryStationsLine, constructSystemPrompt, strategySystemPrompt } = await import("@/lib/program-intel/generator-prompts");
  const { EDIT_SYSTEM_PROMPT } = await import("@/lib/program-ai/prompts");
  const { reviewSystemPrompt } = await import("@/lib/program-intel/coaching-review");
  it("strategy, build and review read the session flow rule; the main lifts keep their order", () => {
    expect(strategySystemPrompt("powerlifting")).toContain(ACCESSORY_FLOW_RULES);
    expect(constructSystemPrompt("bodybuilding")).toContain(ACCESSORY_FLOW_RULES);
    expect(ACCESSORY_FLOW_RULES).toContain("come first in the order performance needs, whatever it costs in convenience");
    expect(ACCESSORY_FLOW_RULES).toContain("When grouping and training order disagree, training order wins.");
    expect(reviewSystemPrompt("powerlifting")).toContain("session flow:");
    expect(EDIT_SYSTEM_PROMPT).toContain("Session flow (each exercise line ends with where it's done");
    expect(EDIT_SYSTEM_PROMPT).toContain("Don't reorder a workout the coach didn't ask you to touch");
  });
  it("a shorter session aims for fewer accessory stations", () => {
    expect(accessoryStationsLine(45)).toBe("aim for at most 2 accessory stations besides the main lift's (a 45-min session), more only when the work truly needs it or a clearly better exercise is at another station (quality beats the count).");
    expect(accessoryStationsLine(60)).toContain("at most 3 accessory stations");
    expect(accessoryStationsLine(90)).toContain("at most 4 accessory stations");
    expect(accessoryStationsLine(null)).toBe("aim for at most 3 accessory stations besides the main lift's, more only when the work truly needs it or a clearly better exercise is at another station (quality beats the count).");
  });
});
