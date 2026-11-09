import { describe, expect, it } from "vitest";
import { addDays, defaultMode, goalDeadline, horizonText, lengthForDeadline, mondayOnOrAfter, plannedStart, planHorizon, weekOf } from "@/lib/program-intel/horizon";

const TODAY = "2026-11-02"; // a Monday
const S = "2026-11-09"; // the next program's start
/** A date in program week w (its Saturday). */
const inWeek = (w: number) => addDays(S, (w - 1) * 7 + 5);
const meet = (w: number, name = "Nationals") => ({ kind: "meet" as const, name, date: inWeek(w), source: "Meet prep" });
const goal = (weeksOut: number) => ({ kind: "goal" as const, name: "600 kg total", date: inWeek(weeksOut), source: "Long-term goal" });
const plan = (mode: "default" | "custom" | "goal", deadlines: any[], customWeeks?: number) => planHorizon({ mode, customWeeks, start: S, deadlines });

describe("the start: after whatever is running, on a Monday", () => {
  it("next Monday when nothing runs past today", () => {
    expect(plannedStart(TODAY, null)).toEqual({ date: "2026-11-09", why: "next Monday" });
    expect(plannedStart(TODAY, "2026-10-31").date).toBe("2026-11-09");
  });
  it("the Monday after the current program ends, so the two never overlap", () => {
    expect(plannedStart(TODAY, "2026-11-29").date).toBe("2026-11-30"); // ends Sunday
    expect(plannedStart(TODAY, "2026-11-25").date).toBe("2026-11-30"); // ends Wednesday
    expect(plannedStart(TODAY, "2026-11-29").why).toMatch(/after the current program ends \(2026-11-29\)/);
  });
  it("weeks are counted from the start, not from today", () => {
    expect(mondayOnOrAfter("2026-11-04")).toBe("2026-11-09");
    expect(weekOf(S, "2026-11-09")).toBe(1);
    expect(weekOf(S, "2026-11-15")).toBe(1);
    expect(weekOf(S, "2026-11-16")).toBe(2);
    expect(weekOf(S, "2026-11-08")).toBe(0);
  });
});

describe("the 12-week default, a custom length, and the goal timeline", () => {
  it("no deadline: 12 weeks in every mode but custom", () => {
    for (const m of ["default", "goal"] as const) expect(plan(m, []).weeks).toBe(12);
    expect(plan("custom", [], 20).weeks).toBe(20);
    expect(plan("custom", [], 99).weeks).toBe(24);
    expect(plan("default", []).role).toBe("open");
    expect(defaultMode(plan("default", []))).toBe("default");
  });

  it("a meet in 6 or 8 weeks: the program runs to it, never forced to 12", () => {
    for (const w of [6, 8]) {
      const h = plan("goal", [meet(w)]);
      expect(h.weeks).toBe(w);
      expect(h.role).toBe("to_deadline");
      expect(h.end >= h.deadline!.date).toBe(true);
      expect(weekOf(h.start, h.deadline!.date)).toBe(h.weeks);
    }
    expect(defaultMode(plan("default", [meet(8)]))).toBe("goal");
  });

  it("a meet in week 12 is the program's last week", () => {
    const h = plan("goal", [meet(12)]);
    expect([h.weeks, h.role]).toEqual([12, "to_deadline"]);
    expect(h.roadmap).toEqual([{ from: 1, to: 12, label: "This program" }]);
  });

  it("a meet in 16 weeks: 12 now, the final 4-week prep written next", () => {
    const h = plan("goal", [meet(16)]);
    expect([h.weeks, h.role]).toEqual([12, "before_final_prep"]);
    expect(h.roadmap).toEqual([{ from: 1, to: 12, label: "This program" }, { from: 13, to: 16, label: "Final preparation to Nationals" }]);
    expect(horizonText(h)).toMatch(/no peak or taper here/);
  });

  it("13–15 weeks out keeps a 4-week final prep too", () => {
    expect(lengthForDeadline(13)).toEqual({ weeks: 9, role: "before_final_prep" });
    expect(lengthForDeadline(15)).toEqual({ weeks: 11, role: "before_final_prep" });
  });

  it("a meet in 24 weeks: the first 12 of a longer road, no peak now", () => {
    const h = plan("goal", [meet(24)]);
    expect([h.weeks, h.role]).toEqual([12, "phase"]);
    expect(h.roadmap.map((s) => [s.from, s.to])).toEqual([[1, 12], [13, 24]]);
    expect(horizonText(h)).toMatch(/don't peak or taper now/);
  });

  it("a goal more than a year out: 12 weeks at a time, the road laid out but not written", () => {
    const h = plan("goal", [goal(70)]);
    expect(h.weeks).toBe(12);
    expect(h.roadmap.map((s) => [s.from, s.to])).toEqual([[1, 12], [13, 24], [25, 36], [37, 48], [49, 60], [61, 70]]);
    expect(h.roadmap.at(-1)!.label).toMatch(/Final preparation to 600 kg total/);
  });

  it("the nearest deadline sets the length; a later one stays on the long-term plan", () => {
    const h = plan("goal", [goal(40), meet(8, "Provincials")]);
    expect(h.deadline!.name).toBe("Provincials");
    expect(h.weeks).toBe(8);
    expect(h.later.map((d) => d.name)).toEqual(["600 kg total"]);
    expect(horizonText(h)).toMatch(/Later: 600 kg total/);
  });

  it("a meet before the program starts (during the current one) isn't this program's deadline", () => {
    const h = planHorizon({ mode: "goal", start: S, deadlines: [{ kind: "meet", name: "Total Fortification", date: "2026-11-07", source: "Meet prep" }] });
    expect(h.deadline).toBeNull();
    expect(h.weeks).toBe(12);
  });
});

describe("the coach's explicit length wins, with the deadline conflict explained", () => {
  it("the default 12 with a meet in 8: runs past it, and offers 8", () => {
    const h = plan("default", [meet(8)]);
    expect(h.weeks).toBe(12);
    expect(h.role).toBe("past_deadline");
    expect(h.conflicts[0].id).toBe("runs-past-deadline");
    expect(h.conflicts[0].options[0]).toBe("Make it 8 weeks (finish at Nationals)");
  });
  it("'build the remaining 17 weeks until Nationals' ends at Nationals", () => {
    const h = plan("custom", [meet(17)], 17);
    expect([h.weeks, h.role, h.conflicts.length]).toEqual([17, "to_deadline", 0]);
  });
  it("a 20-week program is written in full", () => {
    const h = plan("custom", [], 20);
    expect(h.weeks).toBe(20);
    expect(h.end).toBe(addDays(S, 20 * 7 - 1));
  });
  it("a length that would leave 1–3 weeks before a meet says so", () => {
    const h = plan("custom", [meet(24)], 21);
    expect(h.conflicts[0].id).toBe("short-final-prep");
    expect(h.conflicts[0].options).toEqual(["Make it 24 weeks (through Nationals)", "Make it 20 weeks (a 4-week final prep next)", "Keep 21"]);
    expect(plan("custom", [meet(24)], 20).conflicts).toEqual([]);
  });
  it("a 6-week hypertrophy block is 6 weeks", () => {
    expect(plan("custom", [], 6).weeks).toBe(6);
  });
});

describe("a dated long-term goal", () => {
  it("is a deadline only with a date and words", () => {
    expect(goalDeadline({ text: "600 kg total", date: "2027-11-01" })).toEqual({ kind: "goal", name: "600 kg total", date: "2027-11-01", source: "Long-term goal" });
    expect(goalDeadline({ text: "600 kg total", date: null })).toBeNull();
    expect(goalDeadline({ text: " ", date: "2027-11-01" })).toBeNull();
  });
});

describe("benchmark deadlines (bench.ts): a pretend meet or goal for one benchmark run", () => {
  it("leaves a coach's run untouched", async () => {
    const { benchRecords } = await import("@/lib/program-intel/bench");
    const { homeGym } = await import("./program-intel-scenarios");
    const rec = homeGym();
    expect(benchRecords(rec, { options: { benchMeet: { name: "X", date: "2027-03-01" } } })).toBe(rec);
  });
  it.each([
    [6, 6],
    [8, 8],
    [16, 12],
    [24, 12],
  ])("a meet %i weeks out reaches the goal timeline (%i weeks now)", async (weeksOut, expected) => {
    const { benchRecords } = await import("@/lib/program-intel/bench");
    const { buildGeneratorIntel } = await import("@/lib/program-intel/intelligence");
    const { horizonFor } = await import("@/lib/program-intel/recommend");
    const { homeGym } = await import("./program-intel-scenarios");
    const start = "2026-11-16";
    // the meet sits in week N counted from the start (its Saturday)
    const date = addDays(start, (weeksOut - 1) * 7 + 5);
    const intel = buildGeneratorIntel(benchRecords(homeGym(), { options: { bench: true, benchMeet: { name: "Test meet", date } } }));
    expect(intel.ctx.competition.next?.date).toBe(date);
    const h = horizonFor(intel.ctx, "goal", null, start);
    expect(h.weeks).toBe(expected);
    expect(h.deadline?.week).toBe(weeksOut);
  });
  it("a dated goal over a year out: the first 12 weeks of a roadmap to it", async () => {
    const { benchRecords } = await import("@/lib/program-intel/bench");
    const { buildGeneratorIntel } = await import("@/lib/program-intel/intelligence");
    const { horizonFor } = await import("@/lib/program-intel/recommend");
    const { homeGym } = await import("./program-intel-scenarios");
    const intel = buildGeneratorIntel(benchRecords(homeGym(), { options: { bench: true, benchGoal: { text: "500 kg total", date: "2028-03-04" } } }));
    expect(intel.ctx.goals.longTerm?.text).toBe("500 kg total");
    const h = horizonFor(intel.ctx, "goal", null, "2026-11-16");
    expect(h.weeks).toBe(12);
    expect(h.roadmap.length).toBeGreaterThan(5);
  });
});
