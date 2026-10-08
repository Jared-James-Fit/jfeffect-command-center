import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// Planning rules live in the pure module (behaviour is covered in
// committed-schedule-realign.test.ts); these checks guard the wiring.
const planner = readFileSync("src/lib/committed-schedule-realign.ts", "utf8");
const bulk = readFileSync("src/lib/schedule-bulk.functions.ts", "utf8");
const card = readFileSync("src/components/training-schedule-card.tsx", "utf8");

describe("committed training schedule canonical sync", () => {
  it("loads scheduled-workout instances before planning committed-day moves", () => {
    const instanceQuery = bulk.indexOf('.from("pl_scheduled_workouts")');
    const planCall = bulk.indexOf("planCommittedRealign({");
    expect(instanceQuery).toBeGreaterThan(-1);
    expect(planCall).toBeGreaterThan(instanceQuery);
  });

  it("uses the instance date/source ahead of stale pl_days fallback values", () => {
    expect(planner).toContain("const effectiveDate = inst?.scheduled_date ?? d.scheduled_date ?? null");
    expect(planner).toContain("const effectiveSource = inst?.schedule_source ?? d.schedule_source ?? null");
  });

  it("preserves started/completed/past workouts and their ordinal committed-day slot", () => {
    expect(planner).toContain("if (isTouched || isPast)");
    expect(planner).toContain("if (ordinalTarget) consumed.add(ordinalTarget)");
  });

  it("keeps coach-locked workouts protected from client schedule changes", () => {
    expect(planner).toContain('role === "coach" || role === "admin" || !isCoachLocked');
  });

  it("saving committed days is one server call that realigns future workouts", () => {
    expect(card).toContain("saveSchedule({");
    expect(card).not.toContain("window.confirm(");
    expect(card).not.toContain('supabase\n      .from("clients")'); // no separate client-side write
    expect(bulk).toContain("export const saveCommittedSchedule");
    expect(bulk).toContain("includePinned: true");
  });

  it("realigns upcoming Draft/hidden blocks (reads with the service role, after authorization)", () => {
    const fn = bulk.slice(bulk.indexOf("async function realignClientToCommittedDays"));
    expect(fn).toContain('import("@/integrations/supabase/client.server")');
    expect(fn).not.toContain("supabase\n    .from(\"pl_blocks\")");
    expect(fn).toContain("filterPrimaryProgramBlocks(");
  });

  it("uses a valid scheduled-workout source when realigning instances", () => {
    expect(bulk).toContain('.update({ scheduled_date: m.next, schedule_source: "moved" })');
    expect(bulk).toContain('new_source: a.target === "instance" ? "moved" : "auto"');
    expect(bulk).not.toContain('.update({ scheduled_date: m.next, schedule_source: "auto" })');
  });

  it("mirrors the new date onto pl_days for instance-backed workouts", () => {
    const instanceWrite = bulk.indexOf('.update({ scheduled_date: m.next, schedule_source: "moved" })');
    const mirrorWrite = bulk.indexOf(
      '.update({ scheduled_date: m.next, schedule_source: "auto", schedule_locked: false })',
      instanceWrite,
    );
    expect(instanceWrite).toBeGreaterThan(-1);
    expect(mirrorWrite).toBeGreaterThan(instanceWrite);
  });

  it("uses a valid schedule audit scope for committed-day realignment", () => {
    expect(bulk).toContain('scope: "pattern"');
    expect(bulk).not.toContain('scope: "committed-schedule-change"');
  });

  it("never rewrites a completed workout through committed-day sync", () => {
    const touchedCheck = planner.indexOf("if (isTouched || isPast)");
    const movePush = planner.indexOf("moves.push({", touchedCheck);
    expect(touchedCheck).toBeGreaterThan(-1);
    expect(movePush).toBeGreaterThan(touchedCheck);
  });
});

describe("every committed-day writer realigns the calendar", () => {
  const files = [
    "src/components/quick-assign-template-dialog.tsx",
    "src/route-pages/_authenticated/admin/program-library.tsx",
    "src/components/program-planner/AvailabilityGuardDialog.tsx",
  ];
  for (const f of files) {
    it(`${f} saves days through saveCommittedSchedule, not a raw clients update`, () => {
      const src = readFileSync(f, "utf8");
      expect(src).toContain("saveCommittedSchedule");
      expect(src).not.toContain("committed_training_days: longDays");
    });
  }

  it("assigning a template re-dates the new workouts onto committed days without touching pins", () => {
    const programs = readFileSync("src/lib/pl-programs.functions.ts", "utf8");
    expect(programs).toContain("realignClientToCommittedDays");
    expect(programs).toContain("includePinned: false");
  });
});
