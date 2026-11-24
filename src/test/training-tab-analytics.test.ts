/**
 * A client's analytics are a tap from their Training tab (Nov 24 2026): the
 * athlete's own Performance card, opening the coach's analytics page, right
 * under the program on a phone and heading the side column on a computer;
 * its month ring counts planned workouts the way the athlete's card does.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { monthWorkoutsDone, type PeekSchedule } from "@/lib/workout-peek";

const read = (p: string) => readFileSync(p, "utf8");
const TODAY = "2026-11-24";

function schedule(): PeekSchedule {
  return {
    blocks: [
      { id: "b1", name: "Block 2 — General Strength", client_visible: true },
      { id: "home", name: "At-home sessions", client_visible: true, source_template_block_key: "at_home_backup_sessions_v1" },
      { id: "hidden", name: "Draft peak", client_visible: false },
    ],
    weeks: [
      { id: "w0", week_index: 1, block_id: "b1" },
      { id: "w1", week_index: 2, block_id: "b1" },
      { id: "wh", week_index: 1, block_id: "home" },
      { id: "wx", week_index: 1, block_id: "hidden" },
    ],
    days: [
      { id: "oct", week_id: "w0", day_index: 1, title: "Last month", scheduled_date: "2026-10-30" },
      { id: "done1", week_id: "w1", day_index: 1, title: "Squat", scheduled_date: "2026-11-02" },
      { id: "done2", week_id: "w1", day_index: 2, title: "Bench", scheduled_date: "2026-11-04" },
      { id: "missed", week_id: "w1", day_index: 3, title: "Pull", scheduled_date: "2026-11-06" },
      { id: "opt", week_id: "w1", day_index: 4, title: "Recovery", scheduled_date: "2026-11-07", is_optional: true },
      { id: "today", week_id: "w1", day_index: 5, title: "Today", scheduled_date: TODAY },
      { id: "ahead", week_id: "w1", day_index: 6, title: "Ahead", scheduled_date: "2026-11-27" },
      { id: "home1", week_id: "wh", day_index: 1, title: "Home", scheduled_date: "2026-11-10" },
      { id: "draft", week_id: "wx", day_index: 1, title: "Draft", scheduled_date: "2026-11-12" },
    ],
    completions: [
      { day_id: "done1", completed_at: "2026-11-02T23:00:00Z" },
      { day_id: "done2", completed_at: "2026-11-04T23:00:00Z" },
      { day_id: "oct", completed_at: "2026-10-30T23:00:00Z" },
    ],
    scheduledInstances: [],
  };
}

describe("this month's planned workouts on the coach's card", () => {
  it("counts the month to today the athlete's way", () => {
    // done1, done2, missed: today's is still to do, the optional, at-home and hidden ones never count
    expect(monthWorkoutsDone(schedule(), TODAY)).toEqual({ label: "November", planned: 3, done: 2 });
  });
  it("counts today once it's done", () => {
    const s = schedule();
    s.completions!.push({ day_id: "today", completed_at: `${TODAY}T18:00:00Z` });
    expect(monthWorkoutsDone(s, TODAY)).toEqual({ label: "November", planned: 4, done: 3 });
  });
  it("says nothing until something is due, never 0 of 0", () => {
    expect(monthWorkoutsDone(schedule(), "2026-11-01")).toBeNull();
    expect(monthWorkoutsDone(null, TODAY)).toBeNull();
  });
});

describe("the Training tab's way into analytics", () => {
  const tab = read("src/components/clients/client-training-tab.tsx");
  it("is the athlete's own Performance card, opening the coach's analytics page", () => {
    expect(tab).toContain("<ClientPerformance clientId={clientId} client={client} />");
    expect(tab).toContain('analytics={{ to: "/admin/client-programs/$clientId/analytics", params: { clientId } }}');
    expect(tab).toContain("monthWorkoutsDone(schedule.data as any, today)");
    // one door: the program card's ⋯ no longer repeats it
    expect(tab).not.toContain("Analytics &amp; PRs");
  });
  it("sits right under the program on a phone and heads the side column on a computer", () => {
    expect(tab).toMatch(/order-2[^"]*">\s*<ProgramCard/);
    expect(tab).toMatch(/order-3[^"]*" id=\{TRAINING_ANALYTICS_ANCHOR\}>\s*<ClientPerformance/);
    expect(tab).toMatch(/id=\{TRAINING_SCHEDULE_ANCHOR\} aria-label="Schedule" className="order-4/);
    expect((tab.match(/className="contents lg:block/g) ?? []).length).toBe(2);
  });
  it("the card takes the coach's page and words, and still links when it has nothing to show yet", () => {
    const card = read("src/components/performance-card.tsx");
    expect(card).toContain("analytics?: { to: string; params?: Record<string, string> };");
    expect(card).toContain("data-performance-empty");
    expect(card).toContain("{analytics && (");
  });
});
