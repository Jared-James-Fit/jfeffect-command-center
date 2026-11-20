import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  blockShortName,
  dayRefOf,
  historyRoles,
  historySetOf,
  isMeetSession,
  lastTimeLoad,
  relatedSince,
  repsEffort,
  sessionLines,
  trainedOn,
  weightView,
  progressSince,
  relativeDay,
  sameSplit,
  sessionGroups,
  setText,
  topSet,
  workoutName,
  type HistoryDayRef,
  type HistorySession,
} from "@/lib/workouts/exercise-history";

// Nicolas Galli's real program days (Nov 15 2026): Powerbuilding Block 1 weeks 1–2,
// the at-home program before it, and the June program of three blocks (one prep).
const PB = "e83859f9";
const day = (over: Partial<HistoryDayRef>): HistoryDayRef => ({
  dayId: null, dayIndex: null, title: null, subtitle: null, sourceDayId: null, blockId: null, programId: null, ...over,
});
const shB1 = day({ dayId: "w1d2", dayIndex: 2, title: "Strength & Hypertrophy B", blockId: PB });
const shB2 = day({ dayId: "w2d2", dayIndex: 2, title: "Strength & Hypertrophy B", blockId: PB, sourceDayId: "w1d2" });
const shA2 = day({ dayId: "w2d1", dayIndex: 1, title: "Strength & Hypertrophy A", blockId: PB, sourceDayId: "w1d1" });
const homeB = day({ dayId: "h1d2", dayIndex: 2, title: "Full Body B", blockId: "home" });
const juneB1 = day({ dayId: "j1d2", dayIndex: 2, subtitle: "Full Body B", blockId: "june-b1", programId: "prep" });
const juneB2 = day({ dayId: "j2d2", dayIndex: 2, subtitle: "Full Body B", blockId: "june-b2", programId: "prep" });

describe("workoutName: the workout as the logger names it", () => {
  it("title, else the coach's subtitle, else Day N", () => {
    expect(workoutName({ title: "Full Body Day 1 — Barbell + Dumbbells", subtitle: "Target session: 55–60 minutes.", dayIndex: 1 })).toBe("Full Body Day 1 — Barbell + Dumbbells");
    expect(workoutName({ title: null, subtitle: "Full Body A", dayIndex: 1 })).toBe("Full Body A");
    expect(workoutName({ title: "Day 3", subtitle: null, dayIndex: 3 })).toBe("Day 3");
    expect(workoutName({ title: null, subtitle: null, dayIndex: null })).toBe("Workout");
  });
});

describe("sameSplit: the same workout by stable ids, never the same weekday or slot elsewhere", () => {
  it("week 1's Strength & Hypertrophy B is the same split as week 2's (the copy keeps its source)", () => {
    expect(sameSplit(shB1, shB2)).toBe(true);
    expect(sameSplit(shB2, shB1)).toBe(true);
  });
  it("day 2 of another program is not the same split, whatever its slot", () => {
    expect(sameSplit(homeB, shB2)).toBe(false);
    expect(sameSplit(juneB1, shB2)).toBe(false);
  });
  it("another workout of the same block is not the same split", () => {
    expect(sameSplit(shA2, shB2)).toBe(false);
  });
  it("the same named workout in another block of the same program is", () => {
    expect(sameSplit(juneB1, juneB2)).toBe(true);
  });
  it("a generic name never matches across blocks; a renamed copy in its slot still does", () => {
    const g1 = day({ dayId: "a", dayIndex: 1, title: "Day 1", blockId: "b1", programId: "p" });
    const g2 = day({ dayId: "b", dayIndex: 1, title: "Day 1", blockId: "b2", programId: "p" });
    expect(sameSplit(g1, g2)).toBe(false);
    const deload = day({ dayId: "w4d2", dayIndex: 2, title: "Strength & Hypertrophy B (deload)", blockId: PB, sourceDayId: "w1d2" });
    expect(sameSplit(shB1, deload)).toBe(true);
    // duplicated into another slot and renamed: another workout
    const dup = day({ dayId: "w1d3", dayIndex: 3, title: "Strength & Hypertrophy C", blockId: PB, sourceDayId: "w1d2" });
    expect(sameSplit(dup, shB2)).toBe(false);
  });
  it("within one block, the same slot named apart is not the same split", () => {
    const x = day({ dayId: "x", dayIndex: 1, title: "Upper A", blockId: "b" });
    const y = day({ dayId: "y", dayIndex: 1, title: "Lower A", blockId: "b" });
    expect(sameSplit(x, y)).toBe(false);
    expect(sameSplit(x, null)).toBe(false);
  });
  it("reads a pl_days row and its block", () => {
    expect(dayRefOf({ id: "d", day_index: 2, title: "T", subtitle: null, source_day_id: "s" }, { id: "b", prep_id: "p" }))
      .toEqual({ dayId: "d", dayIndex: 2, title: "T", subtitle: null, sourceDayId: "s", blockId: "b", programId: "p" });
  });
});

const set = (lb: number, reps: number, rpe: number | null, over: any = {}) =>
  historySetOf({ id: `${lb}-${reps}-${Math.random()}`, completed_at: "2026-11-08T16:30:00Z", actual_reps: reps, actual_rpe: rpe, entered_value: lb, entered_unit: "lb", normalized_lb: lb, normalized_kg: lb / 2.2046226218, load_type: "external", ...over });

describe("a session's sets as lifted, with their unit", () => {
  it("three equal sets read once with how many", () => {
    expect(sessionGroups([set(55, 12, 8), set(55, 12, 8), set(55, 12, 8)], "lb")).toEqual([{ text: "55 lb × 12 @ 8", count: 3 }]);
  });
  it("RPE that moved is a range; a different weight is its own line", () => {
    expect(sessionGroups([set(185, 5, 8), set(185, 5, 9), set(155, 5, 6)], "lb")).toEqual([
      { text: "185 lb × 5 @ 8–9", count: 2 },
      { text: "155 lb × 5 @ 6", count: 1 },
    ]);
  });
  it("a kg set reads in kg (what was on the bar); bodyweight and assistance say so", () => {
    expect(setText(historySetOf({ id: "k", completed_at: "x", actual_reps: 5, actual_rpe: 7, entered_value: 100, entered_unit: "kg", normalized_kg: 100 }), "lb")).toBe("100 kg × 5 @ 7");
    expect(setText(historySetOf({ id: "b", completed_at: "x", actual_reps: 12, load_type: "bodyweight" }), "lb")).toBe("Bodyweight × 12");
    expect(setText(historySetOf({ id: "a", completed_at: "x", actual_reps: 8, load_type: "assisted", entered_value: 40, entered_unit: "lb" }), "lb")).toBe("40 lb assist × 8");
  });
  it("the top set is the heaviest finished set", () => {
    expect(topSet([set(155, 5, 5), set(185, 5, 5), set(200, 3, 9, { completed_at: null })])?.lb).toBe(185);
  });
});

describe("progressSince: like with like, within one program", () => {
  const at = (iso: string) => Date.parse(iso);
  const sess = (iso: string, blockId: string, sets: ReturnType<typeof set>[], programId: string | null = null): HistorySession =>
    ({ key: iso, at: at(iso), blockId, programId, sets });
  // Nicolas's Belt Squat: home program at 70–85 lb, the gym program from Nov 8 at 55 then 75.
  const nov15 = sess("2026-11-15T15:45:00Z", PB, [set(75, 12, 8), set(75, 12, 8), set(75, 12, 8)]);
  const nov8 = sess("2026-11-08T16:30:00Z", PB, [set(55, 12, 8), set(55, 12, 8)]);
  const nov1 = sess("2026-11-01T15:17:00Z", "home", [set(85, 12, 8)]);
  const now = at("2026-11-15T20:00:00Z");
  it("up 20 lb for 12 reps since Nov 8, same program", () => {
    expect(progressSince([nov15, nov8, nov1], "lb", now)).toEqual({ text: "Up 20 lb for 12 reps since Nov 8 (55 → 75 lb)", direction: "up" });
  });
  it("never compares across programs (home 85 lb vs gym 55 lb is not a 30 lb drop)", () => {
    expect(progressSince([nov8, nov1], "lb", now)).toBeNull();
  });
  it("never across rep counts or efforts more than a point apart", () => {
    const heavy = sess("2026-11-22T15:00:00Z", PB, [set(95, 8, 8)]);
    expect(progressSince([heavy, nov15], "lb", now)).toBeNull();
    const hard = sess("2026-11-22T15:00:00Z", PB, [set(80, 12, 10)]);
    expect(progressSince([hard, nov15], "lb", now)).toBeNull();
  });
  it("same weight and easier reads as progress, in the athlete's unit", () => {
    const easier = sess("2026-11-22T15:00:00Z", PB, [set(75, 12, 7)]);
    expect(progressSince([easier, nov15], "lb", now)).toEqual({ text: "Same weight for 12 reps as Nov 15, and easier (RPE 7, was 8)", direction: "up" });
    // in kg the pounds sets convert exactly, to one decimal, the numbers the list shows
    expect(progressSince([nov15, nov8], "kg", now)?.text).toBe("Up 9.1 kg for 12 reps since Nov 8 (24.9 → 34 kg)");
  });
});

describe("Last time's weight in the card's unit", () => {
  it("exactly as logged in this unit, with the unit", () => {
    expect(lastTimeLoad({ enteredValue: 55, enteredUnit: "lb", normalizedLb: 55, normalizedKg: 24.95 }, "lb")).toBe("55 lb");
  });
  it("logged in the other unit: converted exactly to one decimal and marked ≈, never rounded to a plate", () => {
    expect(lastTimeLoad({ enteredValue: 25, enteredUnit: "kg", normalizedKg: 25, normalizedLb: 55.1156 }, "lb")).toBe("≈55.1 lb");
    expect(lastTimeLoad({ enteredValue: 135, enteredUnit: "lb", normalizedLb: 135, normalizedKg: 61.235 }, "kg")).toBe("≈61.2 kg");
    // Jared's Commonwealth meet single on his pounds card: 330.7, not a plate-rounded 330.5
    expect(lastTimeLoad({ enteredValue: 150, enteredUnit: "kg", normalizedKg: 150, normalizedLb: 330.6934 }, "lb")).toBe("≈330.7 lb");
  });
  it("an older set with no unit on record reads its stored value", () => {
    expect(lastTimeLoad({ enteredValue: null, enteredUnit: null, normalizedLb: 185, normalizedKg: 83.9 }, "lb")).toBe("185 lb");
    expect(lastTimeLoad({ enteredValue: null, enteredUnit: null, normalizedLb: null, normalizedKg: null }, "lb")).toBeNull();
  });
});

describe("relativeDay", () => {
  const now = new Date(2026, 10, 15, 12).getTime();
  it("says how long ago in words, else nothing", () => {
    expect(relativeDay(new Date(2026, 10, 15, 8).getTime(), now)).toBe("Today");
    expect(relativeDay(new Date(2026, 10, 14, 20).getTime(), now)).toBe("Yesterday");
    expect(relativeDay(new Date(2026, 10, 8, 9).getTime(), now)).toBe("1 week ago");
    expect(relativeDay(new Date(2026, 5, 1).getTime(), now)).toBeNull();
  });
});

describe("the card and the History sheet", () => {
  const wdv = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
  const card = readFileSync("src/components/workout-day/load-suggestion-card.tsx", "utf8");
  const sheet = readFileSync("src/components/exercise-history-sheet.tsx", "utf8");
  it("Last time is a button into history: its date never cut, a chevron, its unit; Suggested logs the sets in one tap, never weight buttons", () => {
    expect(wdv).toContain('<span className="shrink-0 whitespace-nowrap" data-last-time-when>· {when}</span>');
    expect(wdv).toContain("const when = data && text ? lastTimeWhen(data) : \"\";");
    expect(wdv).toContain("<ChevronRight className=\"-mr-1 ml-auto h-4 w-4 shrink-0\" aria-hidden=\"true\" />");
    expect(wdv).toContain("const load = lastTimeLoad(data, displayUnit);");
    expect(wdv).not.toContain("<LoadGuide");
    expect(card).not.toContain("data-testid=\"load-pick\"");
    expect(card).toContain("await onApply(load);"); // the shared FillChip, Suggested's and the planned weight's
    expect(card).toContain("load={hint.target}");
    expect(card).toContain("Tap Suggested (or set 1's number) and your sets log at");
  });
  it("the sheet leaves out the open workout, marks its split from stable ids and folds the analytics", () => {
    expect(wdv).toContain("currentDayId={dayId}");
    expect(sheet).toContain("if (currentDayId && d.id === currentDayId) continue;");
    expect(sheet).toContain("same: sameSplit(ref, currentRef),");
    expect(sheet).not.toContain("g.day.day_index === currentDayIndex");
    expect(sheet).toContain("data-history-progress-toggle");
    expect(sheet.indexOf("data-history-session")).toBeLessThan(sheet.indexOf("<LiftProgressCard"));
    expect(sheet).toContain(".range(from, from + PAGE - 1)");
    expect(sheet).toContain("const [showPartial, setShowPartial] = useState(false);");
  });
});

describe("the progress card never overstates a trend", () => {
  const card = readFileSync("src/components/analytics/lift-progress-card.tsx", "utf8");
  it("the strength trend reads hard sets only, never every set as a max", () => {
    expect(card).toContain("? strengthTrend(sessions.filter((s) => s.strength != null).map((s) => ({ date: s.date, value: s.strength! })))");
    expect(card).toContain(': { kind: "unclear", sessions: sessions.filter((s) => s.strength != null).length, days: 0, reason: "few" },');
    expect(card).toContain("latest session lighter");
  });
  it("an accessory reads by what was lifted, never an estimated max", () => {
    expect(card).toContain('label="Last top set"');
    expect(card).toContain("{mainLift && bestEst && estOf(bestEst) != null && (");
  });
  it("records say all-time, this program, this block in words, and only columns that differ", () => {
    const rec = readFileSync("src/components/records/training-records.tsx", "utf8");
    const panel = rec.slice(rec.indexOf("export function ExerciseRecordsPanel"), rec.indexOf("import { createContext"));
    expect(panel).toContain("Best weight for each rep count");
    expect(panel).toContain("This program");
    expect(panel).not.toContain("ATPR");
    expect(panel).toContain("const showProgram = !!data.current_program && data.rep_bests.some((b) => !same(b.program, b.atpr));");
  });
});

// Jared McIntyre's Competition Bench, as production holds it (Nov 19 2026).
describe("trainedOn: the day a session was trained, the same on the card and in History", () => {
  it("a meet logged the next evening is meet day (Commonwealth: sets saved Sep 22 02:40 UTC)", () => {
    // the card said Sep 21 (when the sets were typed), History Sep 20 (the program's day)
    const loggedAt = new Date(2026, 8, 21, 21, 40).toISOString(); // Sep 21, evening where it's read
    expect(trainedOn({ instanceDate: "2026-09-20", dayDate: "2026-09-20", loggedAt })).toBe("2026-09-20");
  });
  it("a moved workout is the day it was moved to, not the program day's old date", () => {
    // "Taper / 4 Days Out": program day Sep 14, moved to Sep 16 and trained that evening
    const loggedAt = new Date(2026, 8, 16, 21, 8).toISOString();
    expect(trainedOn({ instanceDate: "2026-09-16", dayDate: "2026-09-14", loggedAt })).toBe("2026-09-16");
  });
  it("a workout done early is the day it was done, never a date still ahead", () => {
    const loggedAt = new Date(2026, 10, 18, 18, 0).toISOString();
    expect(trainedOn({ instanceDate: null, dayDate: "2026-11-19", loggedAt })).toBe("2026-11-18");
  });
  it("no date on the calendar: the day it was logged; nothing at all: null", () => {
    expect(trainedOn({ loggedAt: new Date(2026, 9, 3, 15).toISOString() })).toBe("2026-10-03");
    expect(trainedOn({})).toBeNull();
  });
});

describe("weightView: one unit to read in, the number as logged kept", () => {
  const kg = (v: number) => historySetOf({ id: "k", completed_at: "x", actual_reps: 1, actual_rpe: 8, entered_value: v, entered_unit: "kg", normalized_kg: v, normalized_lb: v * 2.2046226218 });
  const lb = (v: number) => historySetOf({ id: "l", completed_at: "x", actual_reps: 4, actual_rpe: 6, entered_value: v, entered_unit: "lb", normalized_lb: v, normalized_kg: v / 2.2046226218 });
  it("logged in this unit: as typed", () => {
    expect(weightView(lb(255), "lb")).toEqual({ text: "255 lb", logged: null });
    expect(weightView(kg(102.5), "kg")).toEqual({ text: "102.5 kg", logged: null });
  });
  it("logged in the other unit: exact to one decimal, with the logged number beside it", () => {
    expect(weightView(kg(150), "lb")).toEqual({ text: "330.7 lb", logged: "150 kg" });
    expect(weightView(lb(225), "kg")).toEqual({ text: "102.1 kg", logged: "225 lb" });
  });
  it("bodyweight and assistance say so; reps and effort read after the weight", () => {
    expect(weightView(historySetOf({ id: "b", completed_at: "x", actual_reps: 8, load_type: "bodyweight" }), "lb").text).toBe("Bodyweight");
    expect(weightView(historySetOf({ id: "a", completed_at: "x", actual_reps: 8, load_type: "assisted", entered_value: 40, entered_unit: "lb" }), "lb").text).toBe("40 lb assist");
    expect(repsEffort({ reps: 4, rpe: 6.5, rir: null })).toBe("× 4 @ 6.5");
    expect(repsEffort({ reps: 12, rpe: null, rir: 2 })).toBe("× 12 · 2 RIR");
  });
  it("a session in lines: one unit, roles kept apart, the meet's attempts each their own", () => {
    const meet = [kg(145), kg(147.5), kg(150)];
    expect(sessionLines(meet, "lb").map((l) => `${l.weight} ${l.rest} (${l.logged})`)).toEqual([
      "319.7 lb × 1 @ 8 (145 kg)",
      "325.2 lb × 1 @ 8 (147.5 kg)",
      "330.7 lb × 1 @ 8 (150 kg)",
    ]);
    const day = [{ ...lb(255), role: "top" as const }, { ...lb(245), role: "backoff" as const }, { ...lb(245), role: "backoff" as const }];
    expect(sessionLines(day, "lb")).toEqual([
      { role: "top", weight: "255 lb", logged: null, rest: "× 4 @ 6", count: 1 },
      { role: "backoff", weight: "245 lb", logged: null, rest: "× 4 @ 6", count: 2 },
    ]);
  });
});

describe("historyRoles: a session's top set and back-offs, the server's pl_day_set_names rule", () => {
  const row = (rowId: string, sortOrder: number, over: Partial<{ purposeLabel: string; notes: string; planned: number; topKg: number }> = {}) =>
    ({ rowId, sortOrder, purposeLabel: over.purposeLabel ?? null, notes: over.notes ?? null, planned: over.planned ?? null, topKg: over.topKg ?? null });
  it("labelled cards: Primary Bench then Primary Bench Backoff", () => {
    const r = historyRoles([row("a", 0, { purposeLabel: "Primary Bench" }), row("b", 1, { purposeLabel: "Primary Bench Backoff" })]);
    expect([r.get("a"), r.get("b")]).toEqual(["top", "backoff"]);
  });
  it("a note that starts \"Backoff\" counts like a label", () => {
    const r = historyRoles([row("a", 0), row("b", 1, { notes: "Backoffs: 92.5% of the top set" })]);
    expect([r.get("a"), r.get("b")]).toEqual(["top", "backoff"]);
  });
  it("two unlabelled cards: a single then more is a top set and back-offs, unless the second was heavier", () => {
    expect([...historyRoles([row("a", 0, { planned: 1, topKg: 140 }), row("b", 1, { planned: 3, topKg: 125 })]).values()]).toEqual(["top", "backoff"]);
    expect([...historyRoles([row("a", 0, { planned: 1, topKg: 100 }), row("b", 1, { planned: 3, topKg: 125 })]).values()]).toEqual([null, null]);
  });
  it("one card on its own has no role", () => {
    expect(historyRoles([row("a", 0, { purposeLabel: "Primary" })]).get("a")).toBeNull();
  });
});

describe("isMeetSession", () => {
  it("a day named for a meet, or a card whose role is the meet", () => {
    expect(isMeetSession({ subtitle: "🏆 Commonwealth Powerlifting Championships" }, [])).toBe(true);
    expect(isMeetSession({ title: "Day 4 — Test Day / Meet Day" }, [])).toBe(true);
    expect(isMeetSession({ subtitle: null }, ["Competition"])).toBe(true);
  });
  it("never a training day that only mentions the competition lift or a meet primer", () => {
    expect(isMeetSession({ title: "Thursday — Secondary Squat + Primary Competition Bench" }, ["Primary Bench"])).toBe(false);
    expect(isMeetSession({ title: "Saturday — Meet Primer (2 days out)" }, [])).toBe(false);
    expect(isMeetSession({ title: "Monday", subtitle: "Block 1 — Nationals Base" }, [])).toBe(false);
  });
});

describe("relatedSince: what the family trained after the competition lift's last session", () => {
  const set = (lb: number, reps: number, rpe: number) => historySetOf({ id: `${lb}-${reps}`, completed_at: "x", actual_reps: reps, actual_rpe: rpe, entered_value: lb, entered_unit: "lb", normalized_lb: lb });
  const log = (exerciseId: string, name: string, day: string, s: ReturnType<typeof set>) => ({ exerciseId, name, sessionKey: `${exerciseId}-${day}`, day, set: s });
  it("Jared's October bench lives under its variations, newest first, by the program's names", () => {
    const out = relatedSince([
      log("paused", "1ct Paused Bench", "2026-10-08", set(225, 5, 6)),
      log("paused", "1ct Paused Bench", "2026-11-12", set(255, 4, 6)),
      log("paused", "1ct Paused Bench", "2026-11-12", set(245, 4, 6)),
      log("2ct", "2ct Paused Bench", "2026-11-13", set(235, 6, 5)),
      log("spoto", "Spoto Bench", "2026-09-19", set(175, 7, 4)), // before the meet: not "since"
    ], "2026-09-20");
    expect(out.map((r) => [r.name, r.sessions, r.lastDay, r.top?.lb])).toEqual([
      ["2ct Paused Bench", 1, "2026-11-13", 235],
      ["1ct Paused Bench", 2, "2026-11-12", 255],
    ]);
  });
  it("blockShortName drops the coach's \"Block N —\"", () => {
    expect(blockShortName("Block 6 — Commonwealth Peak")).toBe("Commonwealth Peak");
    expect(blockShortName("Volume 4s/6s")).toBe("Volume 4s/6s");
    expect(blockShortName(null)).toBeNull();
  });
});
