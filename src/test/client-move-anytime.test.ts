import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");

describe("clients can move their own workouts any time", () => {
  const manager = read("src/lib/schedule-manager.functions.ts");
  const bulk = read("src/lib/schedule-bulk.functions.ts");
  it("no 'locked by your coach': not per workout (a coach's planned date), not per account", () => {
    for (const src of [manager, bulk]) {
      expect(src).not.toMatch(/locked by your coach|date-locked|Schedule editing is locked/);
      expect(src).not.toMatch(/day\.schedule_locked && role|d\.schedule_locked\)/);
    }
    // the client is still only ever allowed their own schedule
    expect(manager).toContain('throw new Error("You don\'t have permission to change this schedule.");');
    expect(bulk).toContain('throw new Error("You don\'t have permission to change this schedule.");');
    expect(manager).toContain("if (client.user_id && client.user_id === userId) {\n    return { role: \"client\", client };");
  });
  it("the coach's 'lock schedule editing' switch and the client's locked banner are gone", () => {
    expect(bulk).not.toContain("export const setScheduleLock");
    expect(existsSync("src/components/schedule/CoachOverridePanel.tsx")).toBe(false);
    expect(read("src/components/schedule/ScheduleManagerShell.tsx")).not.toContain("Your coach has locked schedule editing");
  });
  it("changing training days moves hand-placed workouts too, and never says 'locked'", () => {
    expect(bulk).toMatch(/clientId: data\.clientId, userId, role, includePinned: true,/);
    const card = read("src/components/training-schedule-card.tsx");
    expect(card).not.toMatch(/locked kept|locked workout|coach-locked/);
  });
  it("what stays fixed is what's done: completed workouts", () => {
    expect(read("src/lib/workout-move.ts")).toContain("if (isCompletedItem(item)) return false;");
  });
});
