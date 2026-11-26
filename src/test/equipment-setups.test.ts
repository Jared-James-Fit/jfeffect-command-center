import { describe, expect, it } from "vitest";
import {
  cardEquipment,
  cleanSettings,
  comparesAcrossEquipment,
  currentSetup,
  equipmentDetail,
  equipmentName,
  findDuplicate,
  loadEquipmentId,
  pickerSections,
  preferSameEquipment,
  quickSwitch,
  settingsFromNote,
  setupFields,
  setupSummary,
  similarEquipment,
  suggestKind,
  type Equipment,
  type EquipmentData,
  type ExerciseSetup,
} from "@/lib/equipment/equipment";
import { matchHistoryLogs, selectPreviousLifts, type PreviousLiftLog } from "@/lib/workout-previous-lift";

const T0 = Date.parse("2026-11-19T12:00:00Z");
const iso = (minsAgo: number) => new Date(T0 - minsAgo * 60_000).toISOString();

function eq(id: string, over: Partial<Equipment> = {}): Equipment {
  return {
    id, client_id: "c", gym_id: null, kind: "rack", name: id, brand: null, model: null, notes: null,
    photo_path: null, favorite: false, last_used_at: null, archived_at: null, ...over,
  };
}
function setup(id: string, exercise: string, equipment: string | null, over: Partial<ExerciseSetup> = {}): ExerciseSetup {
  return {
    id, client_id: "c", exercise_id: exercise, equipment_id: equipment, settings: [], notes: null, photo_path: null,
    source: "athlete", last_used_at: null, updated_at: null, ...over,
  };
}

describe("settings", () => {
  it("cleans like the database: trimmed, labelled values only, at most 12, order kept", () => {
    expect(cleanSettings([
      { label: " J-hooks ", value: " 9 " },
      { label: "Safeties", value: "" },
      { label: "", value: "x" },
      5,
      null,
      ["a"],
      { label: "Safeties", value: "4" },
    ])).toEqual([{ label: "J-hooks", value: "9" }, { label: "Safeties", value: "4" }]);
    expect(cleanSettings("nope")).toEqual([]);
    const many = Array.from({ length: 20 }, (_, i) => ({ label: `L${i}`, value: "v" }));
    expect(cleanSettings(many)).toHaveLength(12);
    expect(cleanSettings([{ label: "x".repeat(50), value: "y".repeat(60) }])[0]).toEqual({ label: "x".repeat(32), value: "y".repeat(40) });
  });

  it("offers the kind's fields after what's saved, never twice (under any name)", () => {
    expect(setupFields("rack", [])).toEqual([{ label: "Rack height", value: "" }, { label: "Safety height", value: "" }]);
    expect(setupFields("rack", [{ label: "j-hooks", value: "9" }])).toEqual([{ label: "j-hooks", value: "9" }, { label: "Safety height", value: "" }]);
    expect(setupFields(null, [])).toEqual([]);
    expect(setupFields("machine", []).map((f) => f.label)).toEqual(["Seat position", "Back pad"]);
  });
});

describe("suggestKind", () => {
  it("reads the library's equipment and the name", () => {
    expect(suggestKind({ name: "Competition Squat", equipment: "Barbell" })).toBe("rack");
    expect(suggestKind({ name: "Competition Bench Press", equipment: "Barbell, Bench, Rack" })).toBe("rack");
    expect(suggestKind({ name: "Hammer Strength ISO-Lateral Row", equipment: "Machine" })).toBe("machine");
    expect(suggestKind({ name: "Leg Press", equipment: null })).toBe("machine");
    expect(suggestKind({ name: "Cable Triceps Pushdown", equipment: "Cable" })).toBe("cable");
    expect(suggestKind({ name: "Lat Pulldown", equipment: "Machine" })).toBe("cable");
    expect(suggestKind({ name: "Smith Machine Squat", equipment: "Smith Machine" })).toBe("smith");
    expect(suggestKind({ name: "Treadmill Walk", equipment: null })).toBe("cardio");
    expect(suggestKind({ name: "Incline Dumbbell Press", equipment: "Dumbbell" })).toBe("bench");
    expect(suggestKind({ name: "Dumbbell Curl", equipment: "Dumbbell" })).toBeNull();
    expect(suggestKind({ name: "Push Up", equipment: "Bodyweight" })).toBeNull();
    expect(suggestKind(null)).toBeNull();
  });
});

describe("currentSetup", () => {
  const data: EquipmentData = {
    gyms: [],
    equipment: [eq("rogue"), eq("old", { archived_at: iso(1) }), eq("home")],
    setups: [
      setup("s1", "squat", "rogue", { last_used_at: iso(60) }),
      setup("s2", "squat", "old", { last_used_at: iso(5) }),
      setup("s3", "squat", "home", { last_used_at: null }),
      setup("s4", "bench", null, { last_used_at: iso(10) }),
    ],
  };
  it("is the newest pick, never retired equipment, never one never picked", () => {
    expect(currentSetup(data, "squat")?.id).toBe("s1");
    expect(currentSetup(data, "bench")?.equipment_id).toBeNull();
    expect(currentSetup(data, "row")).toBeNull();
    expect(currentSetup(data, null)).toBeNull();
  });
});

describe("cardEquipment", () => {
  const current = setup("s", "squat", "rogue", { last_used_at: iso(30) });
  it("shows what the sets were logged on, else today's pick", () => {
    expect(cardEquipment([], current, T0)).toEqual({ equipmentId: "rogue", source: "current" });
    expect(cardEquipment([{ completed_at: iso(5), equipment_id: null }], current, T0)).toEqual({ equipmentId: "rogue", source: "current" });
    expect(cardEquipment([
      { completed_at: iso(5), equipment_id: "home" },
      { completed_at: iso(4), equipment_id: "home" },
      { completed_at: iso(3), equipment_id: "rogue" },
    ], current, T0)).toEqual({ equipmentId: "home", source: "logged" });
  });
  it("never puts today's pick on an old workout", () => {
    expect(cardEquipment([{ completed_at: iso(60 * 24 * 3), equipment_id: null }], current, T0)).toEqual({ equipmentId: null, source: "none" });
    expect(cardEquipment([{ completed_at: iso(60 * 24 * 3), equipment_id: "home" }], current, T0)).toEqual({ equipmentId: "home", source: "logged" });
  });
  it("drafts don't count as logged", () => {
    expect(cardEquipment([{ completed_at: null, equipment_id: "home" }], current, T0).source).toBe("current");
    expect(cardEquipment([], null, T0)).toEqual({ equipmentId: null, source: "none" });
  });
});

describe("summary line", () => {
  it("reads the most important settings first, then the equipment (the card shows what fits one line)", () => {
    const s = setup("s", "squat", "rogue", { settings: [{ label: "J-hooks", value: "9" }, { label: "Safeties", value: "4" }, { label: "Pin", value: "2" }] });
    expect(setupSummary(s, eq("rogue", { name: "Rogue rack" }))).toBe("J-hooks 9 · Safeties 4 · Pin 2 · Rogue rack");
    expect(setupSummary(s, null)).toBe("J-hooks 9 · Safeties 4 · Pin 2");
    expect(setupSummary(null, eq("rogue", { name: "Rogue rack" }))).toBe("Rogue rack");
    expect(setupSummary(null, null)).toBe("");
  });
  it("names equipment by brand and model when it has no name, and the detail adds only what's new", () => {
    expect(equipmentName({ name: " ", brand: "Hammer Strength", model: "ISO Row" })).toBe("Hammer Strength ISO Row");
    expect(equipmentDetail({ name: "Hammer row", brand: "Hammer Strength", model: "ISO-Lateral Row" }, "Gold's")).toBe("Gold's · Hammer Strength · ISO-Lateral Row");
    expect(equipmentDetail({ name: "Rogue Monster", brand: "Rogue", model: "Monster" }, null)).toBe("");
  });
});

describe("weights on different machines are never the same thing", () => {
  it("a rack or a bench compares across; a machine, cable or Smith doesn't", () => {
    expect(comparesAcrossEquipment("rack")).toBe(true);
    expect(comparesAcrossEquipment("bench")).toBe(true);
    expect(comparesAcrossEquipment("machine")).toBe(false);
    expect(comparesAcrossEquipment("cable")).toBe(false);
    expect(comparesAcrossEquipment("smith")).toBe(false);
    expect(loadEquipmentId(eq("rogue", { kind: "rack" }))).toBeNull();
    expect(loadEquipmentId(eq("hammer", { kind: "machine" }))).toBe("hammer");
    expect(loadEquipmentId(null)).toBeNull();
  });

  it("history on this machine (and sets that never said) wins; else everything, flagged", () => {
    const logs = [{ id: "a", equipmentId: "hammer" }, { id: "b", equipmentId: "lifefit" }, { id: "c", equipmentId: null }, { id: "d" }];
    expect(preferSameEquipment(logs, "hammer").logs.map((l) => l.id)).toEqual(["a", "c", "d"]);
    expect(preferSameEquipment(logs, null)).toEqual({ logs, other: false });
    const onlyOther = [{ id: "b", equipmentId: "lifefit" }];
    expect(preferSameEquipment(onlyOther, "hammer")).toEqual({ logs: onlyOther, other: true });
    expect(preferSameEquipment([], "hammer")).toEqual({ logs: [], other: false });
  });
});

describe("Last time and the suggestions read the card's machine", () => {
  const log = (id: string, session: string, at: string, kg: number, equipmentId: string | null): PreviousLiftLog => ({
    id, exerciseId: "row", exerciseName: "Machine Row", sessionKey: session, occurredAt: at, reps: 10, rpe: 8, rir: null,
    enteredValue: kg, enteredUnit: "kg", normalizedKg: kg, normalizedLb: kg * 2.2046226218, isWorkingSet: true, equipmentId,
  });
  const logs = [
    log("a", "day:1", "2026-11-10T18:00:00Z", 80, "hammer"),
    log("b", "day:2", "2026-11-15T18:00:00Z", 45, "lifefit"),
  ];
  const identity = { rowId: "r", exerciseId: "row", exerciseName: "Machine Row" };

  it("on the Hammer, last time is the Hammer session even when another machine's is newer", () => {
    const sel = selectPreviousLifts([{ ...identity, equipmentId: "hammer" }], logs, "day:now").get("r");
    expect(sel?.id).toBe("a");
    expect(sel?.otherEquipment).toBeUndefined();
    expect(matchHistoryLogs({ ...identity, equipmentId: "hammer" }, logs, "day:now").map((l) => l.id)).toEqual(["a"]);
  });
  it("with no machine picked (or a rack), every session counts as before", () => {
    expect(selectPreviousLifts([identity], logs, "day:now").get("r")?.id).toBe("b");
    expect(matchHistoryLogs(identity, logs, "day:now")).toHaveLength(2);
  });
  it("on a machine with no history yet, last time is another machine's, and says so", () => {
    const sel = selectPreviousLifts([{ ...identity, equipmentId: "new" }], logs, "day:now").get("r");
    expect(sel?.id).toBe("b");
    expect(sel?.otherEquipment).toBe(true);
  });
});

describe("picker", () => {
  const data: EquipmentData = {
    gyms: [
      { id: "g1", client_id: "c", name: "Gold's", archived_at: null },
      { id: "g0", client_id: "c", name: "Anytime", archived_at: null },
      { id: "gx", client_id: "c", name: "Closed", archived_at: iso(1) },
    ],
    equipment: [
      eq("rogue", { gym_id: "g1", kind: "rack", last_used_at: iso(10), name: "Rogue rack" }),
      eq("hammer", { gym_id: "g1", kind: "machine", favorite: true, name: "Hammer row" }),
      eq("home", { kind: "rack", name: "Home rack" }),
      eq("cable", { gym_id: "g0", kind: "cable", name: "Cable stack" }),
      eq("gone", { gym_id: "g1", archived_at: iso(1), name: "Old rack" }),
    ],
    setups: [
      setup("s1", "squat", "home", { last_used_at: iso(5) }),
      setup("s2", "squat", "rogue", { last_used_at: iso(50) }),
      setup("s3", "squat", "gone", { last_used_at: iso(1) }),
    ],
  };
  it("lists what the exercise was done on, favorites, then the rest by gym, never retired", () => {
    const s = pickerSections(data, "squat", "rack");
    expect(s.forExercise.map((e) => e.id)).toEqual(["home", "rogue"]);
    expect(s.favorites.map((e) => e.id)).toEqual(["hammer"]);
    expect(s.byGym.map((g) => [g.gym?.name ?? null, g.items.map((e) => e.id)])).toEqual([["Anytime", ["cable"]]]);
  });
  it("quick switch: the exercise's others and favorites, never the one on", () => {
    expect(quickSwitch(data, "squat", "home").map((e) => e.id)).toEqual(["rogue", "hammer"]);
    expect(quickSwitch(data, "squat", "home", 1).map((e) => e.id)).toEqual(["rogue"]);
  });
  it("finds a duplicate by name in the same gym only", () => {
    expect(findDuplicate(data, "  rogue RACK ", "g1")?.id).toBe("rogue");
    expect(findDuplicate(data, "Rogue rack", null)).toBeNull();
    expect(findDuplicate(data, "Old rack", "g1")).toBeNull();
    expect(findDuplicate(data, "Rogue rack", "g1", "rogue")).toBeNull();
    expect(similarEquipment(data, "rack").map((e) => e.id)).toEqual(["rogue", "home"]);
    expect(similarEquipment(data, "r")).toEqual([]);
  });
});

describe("setups already typed into notes", () => {
  it("reads the settings athletes typed (real notes from the logger)", () => {
    expect(settingsFromNote("Rack height 33")).toEqual([{ label: "Rack height", value: "33" }]);
    expect(settingsFromNote("Do rack height 30 next time")).toEqual([{ label: "Rack height", value: "30" }]);
    expect(settingsFromNote("Rack 9\n90lbs")).toEqual([{ label: "Rack height", value: "9" }]);
    expect(settingsFromNote("Incline 10, Speed 2.5 & Incline 5, Speed 3.5")).toEqual([
      { label: "Incline", value: "5" },
      { label: "Speed", value: "3.5" },
    ]);
    expect(settingsFromNote("J-hooks at 9, safeties 4")).toEqual([{ label: "J-hooks", value: "9" }, { label: "Safeties", value: "4" }]);
    expect(settingsFromNote("seat: 3, back pad 2")).toEqual([{ label: "Seat", value: "3" }, { label: "Back pad", value: "2" }]);
  });
  it("never reads a weight or a feeling as a setting", () => {
    expect(settingsFromNote("upper left scap pain is back when i unrack")).toEqual([]);
    expect(settingsFromNote("Hook gripping hurts")).toEqual([]);
    expect(settingsFromNote("Assisted machine -120")).toEqual([]);
    expect(settingsFromNote("Bench 225lbs felt heavy")).toEqual([]);
    expect(settingsFromNote(null)).toEqual([]);
  });
});

import { setPrItems } from "@/lib/set-pr-items";
import { historySetOf, progressSince } from "@/lib/workouts/exercise-history";
import { readFileSync } from "node:fs";

describe("PRs and progress say which machine", () => {
  it("a PR on a machine names it", () => {
    const record = { reps: 10, load_kg: 50, atpr: true, program_pr: false, block_pr: false, prev_all_kg: 45 };
    expect(setPrItems({ record, unit: "kg", equipment: "Hammer row" })[0].detail).toBe("50 kg × 10 · was 45 kg · on Hammer row");
    expect(setPrItems({ record, unit: "kg" })[0].detail).toBe("50 kg × 10 · was 45 kg");
  });

  it("the progress line never compares two machines", () => {
    const now = Date.parse("2026-11-19T12:00:00Z");
    const set = (lb: number) => historySetOf({ id: String(lb), completed_at: "x", actual_reps: 10, actual_rpe_num: 8, entered_value: lb, entered_unit: "lb", normalized_lb: lb, normalized_kg: lb / 2.2046226218 });
    const base = { blockId: "b", programId: "p" };
    const sessions = [
      { key: "1", at: now - 1 * 86400e3, sets: [set(160)], equipmentKey: "hammer", ...base },
      { key: "2", at: now - 4 * 86400e3, sets: [set(90)], equipmentKey: "lifefit", ...base },
      { key: "3", at: now - 8 * 86400e3, sets: [set(150)], equipmentKey: "hammer", ...base },
    ];
    expect(progressSince(sessions, "lb", now)?.text).toMatch(/^Up 10 lb for 10 reps since .*\(150 → 160 lb\)$/);
    // without machines it reads the latest one before, as it always did
    const plain = sessions.map(({ equipmentKey: _e, ...s }) => s);
    expect(progressSince(plain, "lb", now)?.text).toMatch(/\(90 → 160 lb\)/);
  });
});

describe("the card stays quiet", () => {
  const card = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
  const sheet = readFileSync("src/components/equipment/setup-sheet.tsx", "utf8");
  it("the setup line is on every card that can change it (Nov 26 2026): what's saved, else a quiet Add your setup; read-only shows only what's saved", () => {
    expect(card).toContain('{cardSetup && (cardSetup.summary || cardSetup.photo || cardSetup.mode !== "view") && (');
    expect(card).toContain('data-testid="card-setup"');
    // one slim line: the prescription under it moves up to make room
    expect(card).toContain('cardSetup ? "mt-1.5" : "mt-2.5"');
  });
  it("the setup sheet is a grip sheet that swipes down and stays above the keyboard", () => {
    // pinned to the visible part of the screen while typing (setup-sheet-reliability.test.ts)
    expect(sheet).toMatch(/side="bottom"\s+swipeToClose=\{!kb\}/);
    expect(sheet).toContain("useVisualViewportBox(open)");
  });
  it("the walkthrough never opens inside a workout", () => {
    expect(card).not.toContain("EquipmentIntroGate");
    expect(readFileSync("src/routes/_authenticated/portal/workouts.index.tsx", "utf8")).toContain("<EquipmentIntroGate");
  });
});
