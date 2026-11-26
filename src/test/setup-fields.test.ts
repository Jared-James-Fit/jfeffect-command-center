import { describe, expect, it } from "vitest";
import {
  FIELDS,
  controlFor,
  fieldFor,
  fieldsFor,
  moreFieldsFor,
  optionsFor,
  previousValues,
  rankSettings,
  readNumber,
  settingWords,
  stepValue,
} from "@/lib/equipment/setup-fields";
import { setupFields, setupPhotos, setupSummary, suggestKind, type EquipmentData, type ExerciseSetup } from "@/lib/equipment/equipment";

const ex = (name: string, equipment: string | null = null) => ({ name, equipment });
const labels = (keys: string[]) => keys.map((k) => FIELDS[k as keyof typeof FIELDS].label);

describe("what a setup asks for, by equipment and lift", () => {
  it("a squat in a rack: rack and safety height, then stance", () => {
    expect(labels(fieldsFor("rack", ex("Competition Squat", "Barbell")))).toEqual(["Rack height", "Safety height", "Stance"]);
  });
  it("a bench in a rack: the heights, then grip", () => {
    expect(labels(fieldsFor(suggestKind(ex("Competition Bench Press", "Barbell")), ex("Competition Bench Press", "Barbell")))).toEqual(["Rack height", "Safety height", "Grip"]);
  });
  it("a cable: pulley height and attachment", () => {
    expect(labels(fieldsFor("cable", ex("Seated Cable Row", "Cable")))).toEqual(["Pulley height", "Attachment"]);
  });
  it("machines by what they are: a leg press's seat and feet, a leg curl's pad, a chest-supported row's chest pad", () => {
    expect(labels(fieldsFor("machine", ex("Leg Press", "Machine")))).toEqual(["Seat position", "Foot position"]);
    expect(labels(fieldsFor("machine", ex("Seated Leg Curl", "Machine")))).toEqual(["Seat position", "Leg pad", "Start position"]);
    expect(labels(fieldsFor("machine", ex("Chest Supported T-Bar Row", "Machine")))).toEqual(["Chest pad", "Seat position"]);
    expect(labels(fieldsFor("machine", ex("Hammer Strength Chest Press", "Machine")))).toEqual(["Seat position", "Back pad"]);
  });
  it("a bench's angle, and a dumbbell incline press with no equipment picked still gets it", () => {
    expect(labels(fieldsFor("bench", ex("Incline Dumbbell Press", "Dumbbell")))).toEqual(["Bench angle", "Seat position"]);
    expect(labels(fieldsFor(null, ex("Incline Dumbbell Press", "Dumbbell")))).toEqual(["Bench angle"]);
  });
  it("a deadlift with nothing picked: stance and grip", () => {
    expect(labels(fieldsFor(null, ex("Competition Deadlift", "Barbell")))).toEqual(["Stance", "Grip"]);
  });
  it("cardio by machine: a treadmill's incline and speed, a bike's level, a rower's damper", () => {
    expect(labels(fieldsFor("cardio", ex("Treadmill Walk")))).toEqual(["Incline", "Speed"]);
    expect(labels(fieldsFor("cardio", ex("Assault Bike")))).toEqual(["Level", "Seat position"]);
    expect(labels(fieldsFor("cardio", ex("Rowing Machine")))).toEqual(["Damper"]);
  });
  it("a lateral raise asks for nothing up front (optional extras one tap away)", () => {
    expect(fieldsFor(null, ex("Lateral Raise", "Dumbbell"))).toEqual([]);
    expect(moreFieldsFor(null, ex("Lateral Raise", "Dumbbell"), []).length).toBeGreaterThan(0);
  });
  it("never more than four up front", () => {
    expect(fieldsFor("smith", ex("Smith Machine Incline Press", "Smith")).length).toBeLessThanOrEqual(4);
  });
  it("more fields never repeat one that's there, under any name", () => {
    const more = moreFieldsFor("rack", ex("Competition Squat"), ["J-hooks", "Safeties", "stance"]);
    expect(more).not.toContain("rack_height");
    expect(more).not.toContain("stance");
  });
});

describe("labels saved before keep their words and get the right control", () => {
  it("J-hooks is the rack height, Safeties the safety height, Seat the seat", () => {
    expect(fieldFor("J-hooks")?.key).toBe("rack_height");
    expect(fieldFor("j hooks")?.key).toBe("rack_height");
    expect(fieldFor("Safeties")?.key).toBe("safety_height");
    expect(fieldFor("Seat")?.key).toBe("seat");
    expect(fieldFor("Pulley")?.key).toBe("pulley_height");
    expect(fieldFor("Handle")?.key).toBe("attachment");
  });
  it("an incline is the treadmill's on cardio, the bench's anywhere else", () => {
    expect(fieldFor("Incline", "cardio")?.key).toBe("incline");
    expect(fieldFor("Incline", "bench")?.key).toBe("bench_angle");
  });
  it("numbers step, choices are chips, words of their own are a box", () => {
    expect(controlFor("J-hooks", "9")).toBe("number");
    expect(controlFor("Attachment", "")).toBe("choice");
    expect(controlFor("Handle position", "3")).toBe("number");
    expect(controlFor("Thumb", "on the ring")).toBe("text");
  });
  it("a grip's answers fit the lift", () => {
    expect(optionsFor(FIELDS.grip, ex("Competition Deadlift"))).toContain("Hook");
    expect(optionsFor(FIELDS.grip, ex("Lat Pulldown"))).toContain("Neutral");
    expect(optionsFor(FIELDS.grip, ex("Competition Bench Press"))).toContain("Wide");
  });
});

describe("the stepper", () => {
  it("steps from the value, kept in range, written the way it's typed", () => {
    expect(stepValue("9", 1, FIELDS.rack_height)).toBe("10");
    expect(stepValue("0", -1, FIELDS.rack_height)).toBe("0");
    expect(stepValue("2.5", 1, FIELDS.speed)).toBe("2.6");
    expect(stepValue("2,5", -1, FIELDS.speed)).toBe("2.4");
    expect(stepValue("3", 1, FIELDS.incline)).toBe("3.5");
  });
  it("an empty box starts from what they used before, else the field's usual", () => {
    expect(stepValue("", 1, FIELDS.rack_height, "11")).toBe("11");
    expect(stepValue("", 1, FIELDS.rack_height)).toBe("8");
    expect(stepValue("", -1, FIELDS.speed, null)).toBe("3");
  });
  it("reads numbers as typed", () => {
    expect(readNumber(" 10 ")).toBe(10);
    expect(readNumber("2,5")).toBe(2.5);
    expect(readNumber("9a")).toBeNull();
  });
});

describe("the card's one line", () => {
  it("the settings that set the lift up first, then the equipment", () => {
    const s = { settings: [{ label: "Stance", value: "Wide" }, { label: "J-hooks", value: "9" }, { label: "Safeties", value: "4" }] };
    expect(setupSummary(s, { name: "Rogue rack", brand: null, model: null, kind: "rack" })).toBe("J-hooks 9 · Safeties 4 · Wide stance · Rogue rack");
  });
  it("short forms of the field's own labels, their own words kept", () => {
    expect(settingWords({ label: "Rack height", value: "9" })).toBe("Rack 9");
    expect(settingWords({ label: "J-hooks", value: "9" })).toBe("J-hooks 9");
    expect(settingWords({ label: "Pulley height", value: "12" })).toBe("Pulley 12");
    expect(settingWords({ label: "Attachment", value: "Rope" })).toBe("Rope");
    expect(settingWords({ label: "Bench angle", value: "30°" })).toBe("Bench 30°");
    expect(settingWords({ label: "Bench angle", value: "Flat" })).toBe("Flat bench");
    expect(settingWords({ label: "Grip", value: "Close" })).toBe("Close grip");
    expect(settingWords({ label: "Thumb", value: "on the ring" })).toBe("Thumb on the ring");
  });
  it("ranks a label of their own after the known ones, in saved order", () => {
    expect(rankSettings([{ label: "Note", value: "x" }, { label: "Grip", value: "Wide" }, { label: "Seat", value: "3" }]).map((s) => s.label)).toEqual(["Seat", "Grip", "Note"]);
  });
});

describe("what they used before", () => {
  const data: EquipmentData = {
    gyms: [],
    equipment: [],
    setups: [
      { id: "a", client_id: "c", exercise_id: "squat", equipment_id: "rack2", settings: [{ label: "J-hooks", value: "10" }], notes: null, photo_path: null, source: "athlete", last_used_at: null, updated_at: "2026-11-01T00:00:00Z" },
      { id: "b", client_id: "c", exercise_id: "bench", equipment_id: "rack1", settings: [{ label: "Rack height", value: "4" }], notes: null, photo_path: null, source: "athlete", last_used_at: null, updated_at: "2026-11-02T00:00:00Z" },
    ],
  };
  it("this setup's earlier versions first, then the lift on other equipment, then the equipment for other lifts", () => {
    const revisions = [{ equipment_id: "rack1", settings: [{ label: "J-hooks", value: "9" }], created_at: "2026-11-20T00:00:00Z" }];
    expect(previousValues({ data, revisions, exerciseId: "squat", equipmentId: "rack1", label: "Rack height" })).toEqual(["9", "10", "4"]);
  });
  it("never what's in the box now", () => {
    expect(previousValues({ data, exerciseId: "squat", equipmentId: "rack1", label: "J-hooks", current: "10" })).toEqual(["4"]);
  });
});

describe("offered settings and photos", () => {
  it("what's saved first, then the equipment's and lift's, never twice under another name", () => {
    expect(setupFields("rack", [], ex("Competition Squat"))).toEqual([
      { label: "Rack height", value: "" },
      { label: "Safety height", value: "" },
      { label: "Stance", value: "" },
    ]);
    expect(setupFields("rack", [{ label: "J-hooks", value: "9" }], ex("Competition Squat")).map((f) => f.label)).toEqual(["J-hooks", "Safety height", "Stance"]);
  });
  it("a setup's photos: the list when there is one, else its one photo", () => {
    const base = { photo_path: "c/a.jpg" } as Pick<ExerciseSetup, "photo_path" | "photo_paths">;
    expect(setupPhotos(base)).toEqual(["c/a.jpg"]);
    expect(setupPhotos({ ...base, photo_paths: ["c/a.jpg", "c/b.jpg"] })).toEqual(["c/a.jpg", "c/b.jpg"]);
    expect(setupPhotos({ photo_path: null, photo_paths: [] })).toEqual([]);
    expect(setupPhotos(null)).toEqual([]);
  });
});
