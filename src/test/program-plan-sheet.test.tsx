/**
 * Nov 23 2026: the client's Full plan read like a coach's notes, every week of every block open at
 * once ("SBD reintroduction and RPE calibration: volume-first week with conservative top sets at
 * RPE 6, 7 (2, 3 RIR)…"). It's Focus (one week at a time, the default) and List (one line a week)
 * now, in plain words.
 */
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({ Link: ({ children }: any) => createElement("a", { href: "#" }, children) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const { PlanFocus, PlanList, planStartIndex, planWeeks, weekRange } = await import("@/components/workouts/program-roadmap");
import type { ProgramRoadmap, RoadmapBlockView, RoadmapWeekView } from "@/lib/training-roadmap";

const week = (id: string, index: number, status: RoadmapWeekView["status"], label: string | null, focus: string | null, start: string): RoadmapWeekView => ({
  id,
  index,
  start,
  end: null,
  status,
  label,
  focus,
});
const blockOf = (id: string, label: string | null, purpose: string | null, weeks: RoadmapWeekView[]): RoadmapBlockView => ({
  id,
  name: `Block — ${id}`,
  status: weeks.some((w) => w.status === "current") ? "current" : weeks.every((w) => w.status === "completed") ? "completed" : "upcoming",
  start: weeks[0]?.start ?? null,
  end: null,
  weekCount: weeks.length,
  weeks,
  label,
  purpose,
  style: null,
  byCoach: false,
});
const roadmap = {
  blocks: [
    blockOf("b1", "Build a base", "Get back into squat, bench and deadlift and build a solid base.", [
      week("w1", 1, "completed", "Ease in", "Learn the workouts and find good weights to start with.", "2026-11-16"),
      week("w2", 2, "current", "A bit heavier", "Same idea as last week, a little heavier.", "2026-11-23"),
      week("w3", 3, "upcoming", "Lighter week", "Less work this week so you recover.", "2026-11-30"),
    ]),
    blockOf("b2", "Get stronger", null, [week("w4", 1, "upcoming", "New phase", "A new part of your program starts this week.", "2026-12-07")]),
  ],
} as unknown as ProgramRoadmap;

describe("the plan, one week at a time or one line a week", () => {
  const weeks = planWeeks(roadmap);
  it("weeks are numbered across the whole program, and it opens on this week", () => {
    expect(weeks.map((w) => w.n)).toEqual([1, 2, 3, 4]);
    expect(weeks[3].blockNo).toBe(2);
    expect(planStartIndex(weeks, null)).toBe(1);
    expect(planStartIndex(weeks, "b2")).toBe(1);
    expect(planStartIndex(weeks.map((w) => ({ ...w, week: { ...w.week, status: "upcoming" as const } })), "b2")).toBe(3);
    expect(weekRange("2026-11-23", "2026-11-29")).toBe("Nov 23 – 29");
    expect(weekRange("2026-12-28", "2027-01-03")).toBe("Dec 28 – Jan 3");
  });
  it("Focus says where the week sits, its name and one sentence; nothing else from the other weeks", () => {
    const html = renderToStaticMarkup(createElement(PlanFocus, { weeks, at: 1, onAt: () => {}, total: 4, multi: true, blockCount: 2 }));
    expect(html).toContain("Block 1 of 2 · Build a base");
    expect(html).toContain("Week 2 · Nov 23");
    expect(html).toContain('aria-label="Week 2 of 4, this week"');
    expect(html).toContain("A bit heavier");
    expect(html).toContain("Same idea as last week, a little heavier.");
    expect(html).toContain("This week");
    expect(html).not.toContain("Lighter week");
    expect(html).not.toContain("Get back into squat");
    expect(html.match(/data-plan-strip-week=/g)).toHaveLength(4);
    expect(html).toContain("Previous week");
    expect(html).toContain("Next week");
  });
  it("the block's purpose shows once, on its first week", () => {
    const html = renderToStaticMarkup(createElement(PlanFocus, { weeks, at: 0, onAt: () => {}, total: 4, multi: true, blockCount: 2 }));
    expect(html).toContain("Get back into squat, bench and deadlift and build a solid base.");
    expect(html).toContain("Done");
  });
  it("List is one line a week (no sentences), grouped by block, each a tap into Focus", () => {
    const html = renderToStaticMarkup(createElement(PlanList, { roadmap, weeks, onWeek: () => {} }));
    expect(html).toContain("Block 1");
    expect(html).toContain("Build a base");
    expect(html).toContain("Lighter week");
    expect(html).not.toContain("Same idea as last week");
    expect(html.match(/data-plan-list-week=/g)).toHaveLength(4);
    expect(html).toContain('data-plan-list-week="4"');
  });
  it("Focus is the default and the choice is remembered on the phone", () => {
    const src = readFileSync("src/components/workouts/program-roadmap.tsx", "utf8");
    expect(src).toContain('=== "list" ? "list" : "focus"');
    expect(src).toContain("window.localStorage.setItem(PLAN_MODE_KEY, m)");
    expect(src).toContain('data-plan-modes');
  });
});
