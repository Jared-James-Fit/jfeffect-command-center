import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DEFAULT_STATE,
  THRESHOLDS,
  checkinFootageLine,
  coachFlag,
  footageStatus,
  reminderCopy,
  reminderDecision,
  reminderTargets,
  type FilmingStatus,
  type ReminderRow,
} from "@/lib/set-videos/filming-reminder";

const NOW = Date.parse("2026-11-25T18:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

const status = (over: Partial<FilmingStatus> = {}, state: Partial<FilmingStatus["state"] & object> = {}): FilmingStatus => ({
  coaching: true,
  coach_first: "Sam",
  last_footage_at: daysAgo(8),
  first_workout_at: daysAgo(90),
  workouts_without: 3,
  c7: 3, f7: 0, c14: 6, f14: 1, c30: 12, f30: 4,
  state: { ...DEFAULT_STATE, ...state },
  ...over,
});

describe("when the filming reminder may show", () => {
  it("only after 7 days AND 3 workouts without logged footage (standard)", () => {
    expect(reminderDecision(status(), "day-1", NOW)).toEqual({ show: true, tier: "initial", requested: false });
    expect(reminderDecision(status({ last_footage_at: daysAgo(6) }), "day-1", NOW)).toMatchObject({ show: false, why: "not_yet" });
    expect(reminderDecision(status({ workouts_without: 2 }), "day-1", NOW)).toMatchObject({ show: false, why: "not_yet" });
  });
  it("coaching clients only, never when the coach turned it off or paused it", () => {
    expect(reminderDecision(status({ coaching: false }), "d", NOW)).toMatchObject({ why: "not_coaching" });
    expect(reminderDecision(status({}, { enabled: false }), "d", NOW)).toMatchObject({ why: "off" });
    expect(reminderDecision(status({}, { paused_until: daysAgo(-3) }), "d", NOW)).toMatchObject({ why: "paused" });
    expect(reminderDecision(status({}, { auto_paused_at: daysAgo(1) }), "d", NOW)).toMatchObject({ why: "paused" });
  });
  it("at most once a rolling 7 days and once a workout", () => {
    expect(reminderDecision(status({}, { last_shown_at: daysAgo(6.9) }), "d2", NOW)).toMatchObject({ why: "this_week" });
    expect(reminderDecision(status({}, { last_shown_at: daysAgo(7.1), last_shown_day_id: "d2" }), "d2", NOW)).toMatchObject({ why: "this_workout" });
  });
  it("the words get more direct, then the coach is flagged instead", () => {
    expect(reminderDecision(status({ last_footage_at: null }), "d", NOW)).toMatchObject({ show: true, tier: "first_time" });
    expect(reminderDecision(status({ last_footage_at: daysAgo(15) }), "d", NOW)).toMatchObject({ tier: "extended" });
    expect(reminderDecision(status({}, { shown_count: 1, last_shown_at: daysAgo(8) }), "d", NOW)).toMatchObject({ tier: "continued" });
    expect(reminderDecision(status({ last_footage_at: daysAgo(22) }), "d", NOW)).toMatchObject({ show: false, why: "flag_coach" });
  });
  it("sensitivity moves the thresholds", () => {
    expect(reminderDecision(status({}, { sensitivity: "gentle" }), "d", NOW)).toMatchObject({ why: "not_yet" });
    expect(reminderDecision(status({ last_footage_at: daysAgo(5), workouts_without: 2 }, { sensitivity: "firm" }), "d", NOW)).toMatchObject({ show: true });
    expect(THRESHOLDS.standard).toEqual({ days: 7, workouts: 3, extended: 14, flag: 21 });
  });
  it("a coach's request lifts the thresholds and the week's cap once", () => {
    const asked = status({ workouts_without: 0, last_footage_at: daysAgo(1) }, { requested_at: daysAgo(0.5), last_shown_at: daysAgo(2) });
    expect(reminderDecision(asked, "d", NOW)).toMatchObject({ show: true, requested: true });
    const shownSince = status({}, { requested_at: daysAgo(3), last_shown_at: daysAgo(2) });
    expect(reminderDecision(shownSince, "d", NOW)).toMatchObject({ why: "this_week" });
  });
});

describe("what it says", () => {
  it("real numbers, the tier's line and the tagline; never 'haven't filmed'", () => {
    const c = reminderCopy(status(), "initial", { now: NOW });
    expect(c.stats).toEqual(["8 days since your last logged video", "3 workouts without logged footage"]);
    expect(c.headline).toBe("You're putting in the work. Let's see it.");
    expect(c.tagline).toBe("Film it. Log it. Improve it.");
    expect(c.primary).toBe("Let's get some footage");
    expect(c.secondary).toBe("Maybe later");
    expect(JSON.stringify(c)).not.toMatch(/haven'?t filmed/i);
    expect(reminderCopy(status(), "first_time").headline).toBe("Let's set the standard.");
    expect(reminderCopy(status(), "extended").headline).toBe("Your coach can't fix what they can't see.");
    expect(reminderCopy(status(), "continued").headline).toBe("Are you getting everything out of your coaching?");
    expect(reminderCopy(status(), "initial", { requested: true }).ask).toBe("Sam asked for footage: one working set of each main lift.");
  });
});

describe("the coach's view", () => {
  it("Consistent / Occasional / Limited recent footage / No footage logged", () => {
    expect(footageStatus(status({ c30: 10, f30: 6, c7: 2, f7: 1, f14: 3 }))).toBe("consistent");
    expect(footageStatus(status())).toBe("occasional");
    expect(footageStatus(status({ f14: 0, f7: 0 }))).toBe("limited");
    expect(footageStatus(status({ f30: 0, f14: 0, f7: 0 }))).toBe("none");
  });
  it("flags twice dismissed and a long run without footage; the check-in line has the numbers", () => {
    expect(coachFlag(status({}, { auto_paused_at: daysAgo(1) }), NOW)).toMatch(/Dismissed the filming reminder twice/);
    expect(coachFlag(status({ last_footage_at: daysAgo(23) }), NOW)).toMatch(/^23 days without logged footage/);
    expect(coachFlag(status(), NOW)).toBeNull();
    expect(checkinFootageLine(status(), NOW)).toBe("Footage: 1 of 6 workouts filmed in 14 days · last logged video 8d ago · Occasional");
  });
});

describe("which set it points at", () => {
  const row = (over: Partial<ReminderRow>): ReminderRow => ({ rowId: "r", name: "Squat", main: false, sets: 3, logged: [], filmed: [], barbell: true, ...over });
  it("the next unlogged set of a main lift with no video, else of a barbell lift", () => {
    expect(reminderTargets([row({ rowId: "a", main: true, logged: [1] }), row({ rowId: "b" })])[0]).toMatchObject({ rowId: "a", setIndex: 2 });
    expect(reminderTargets([row({ rowId: "a", main: true, filmed: [1] }), row({ rowId: "b" })])).toEqual([{ rowId: "b", setIndex: 1, name: "Squat" }]);
    expect(reminderTargets([row({ rowId: "a", barbell: false })])).toEqual([]);
  });
});

describe("the server keeps the same rule", () => {
  const sql = readFileSync(resolve(__dirname, "../../supabase/migrations/20270527101700_filming_accountability.sql"), "utf8");
  it("thresholds, caps and the dismissal pause", () => {
    expect(sql).toContain("ARRAY[10, 4, 18, 28]");
    expect(sql).toContain("ARRAY[5, 2, 10, 14]");
    expect(sql).toContain("ARRAY[7, 3, 14, 21]");
    expect(sql).toContain("interval '7 days'");
    expect(sql).toContain("dismissals + 1 >= 2");
    expect(sql).toMatch(/origin = 'set' OR v\.attached_at IS NOT NULL/);
  });
});
