import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const bulk = readFileSync("src/lib/schedule-bulk.functions.ts", "utf8");
const card = readFileSync("src/components/training-schedule-card.tsx", "utf8");

describe("committed training schedule canonical sync", () => {
  it("loads scheduled-workout instances before calculating committed-day moves", () => {
    const instanceQuery = bulk.indexOf('.from("pl_scheduled_workouts")');
    const planningLoop = bulk.indexOf("for (const block of blockList)");
    expect(instanceQuery).toBeGreaterThan(-1);
    expect(planningLoop).toBeGreaterThan(instanceQuery);
  });

  it("uses the instance date/source ahead of stale pl_days fallback values", () => {
    expect(bulk).toContain("const effectiveDate = inst?.scheduled_date ?? d.scheduled_date ?? null");
    expect(bulk).toContain("const effectiveSource = inst?.schedule_source ?? d.schedule_source ?? null");
  });

  it("preserves started/completed/past workouts and their ordinal committed-day slot", () => {
    expect(bulk).toContain("if (isTouched || isPast)");
    expect(bulk).toContain("if (ordinalTarget) consumed.add(ordinalTarget)");
  });

  it("keeps coach-locked workouts protected from client schedule changes", () => {
    expect(bulk).toContain('role === "coach" || role === "admin" || !isCoachLocked');
  });

  it("saving committed days explicitly realigns future manual placements", () => {
    expect(card).toContain("data: { clientId: client.id, includePinned: true }");
    expect(card).not.toContain("window.confirm(");
  });


  it("uses a valid scheduled-workout source when realigning instances", () => {
    expect(bulk).toContain('.update({ scheduled_date: m.next, schedule_source: "moved" })');
    expect(bulk).toContain('new_source: a.target === "instance" ? "moved" : "auto"');
    expect(bulk).not.toContain('.update({ scheduled_date: m.next, schedule_source: "auto" })');
  });

  it("uses a valid schedule audit scope for committed-day realignment", () => {
    expect(bulk).toContain('scope: "pattern"');
    expect(bulk).not.toContain('scope: "committed-schedule-change"');
  });

  it("never rewrites a completed workout through committed-day sync", () => {
    const touchedCheck = bulk.indexOf("if (isTouched || isPast)");
    const movePush = bulk.indexOf("moves.push({", touchedCheck);
    expect(touchedCheck).toBeGreaterThan(-1);
    expect(movePush).toBeGreaterThan(touchedCheck);
  });
});
