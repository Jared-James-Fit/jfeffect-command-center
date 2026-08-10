import { describe, it, expect } from "vitest";
import {
  buildProgramScheduleStatus,
  summarizeProgramSchedule,
} from "@/lib/program-schedule-status";

const day = (id: string, scheduled_date: string | null = null) => ({ id, scheduled_date });
const inst = (id: string, dayId: string, date: string) => ({
  id,
  source_day_id: dayId,
  scheduled_date: date,
});
const comp = (dayId: string, completed_at: string | null) => ({ day_id: day_id_fix(dayId), completed_at });
// keep helper explicit to avoid accidental typos in tests
function day_id_fix(v: string) { return v; }

describe("buildProgramScheduleStatus", () => {
  it("instance date is canonical over the legacy mirror", () => {
    const m = buildProgramScheduleStatus({
      days: [day("d1", "2026-06-01")],
      instances: [inst("i1", "d1", "2026-06-10")],
      completions: [],
    });
    const st = m.get("d1")!;
    expect(st.canonicalDate).toBe("2026-06-10");
    expect(st.scheduledWorkoutId).toBe("i1");
    expect(st.hasInstance).toBe(true);
    expect(st.calendarIssue).toBe(true); // legacy disagrees
    expect(st.status).toBe("calendar-issue");
  });

  it("legacy mirror matching the instance is not an issue", () => {
    const m = buildProgramScheduleStatus({
      days: [day("d1", "2026-06-10")],
      instances: [inst("i1", "d1", "2026-06-10")],
      completions: [],
    });
    const st = m.get("d1")!;
    expect(st.calendarIssue).toBe(false);
    expect(st.status).toBe("on-calendar");
  });

  it("falls back to the legacy date when no instance exists", () => {
    const m = buildProgramScheduleStatus({
      days: [day("d1", "2026-06-05")],
      instances: [],
      completions: [],
    });
    const st = m.get("d1")!;
    expect(st.canonicalDate).toBe("2026-06-05");
    expect(st.hasInstance).toBe(false);
    expect(st.status).toBe("on-calendar");
  });

  it("flags missing dates (no instance, no legacy date)", () => {
    const m = buildProgramScheduleStatus({
      days: [day("d1", null)],
      instances: [],
      completions: [],
    });
    const st = m.get("d1")!;
    expect(st.missingDate).toBe(true);
    expect(st.status).toBe("missing-date");
  });

  it("completed takes precedence over schedule states", () => {
    const m = buildProgramScheduleStatus({
      days: [day("d1", null)],
      instances: [],
      completions: [comp("d1", "2026-06-01T10:00:00Z")],
    });
    expect(m.get("d1")!.status).toBe("completed");
    expect(m.get("d1")!.missingDate).toBe(false);
  });

  it("in-progress beats calendar display states", () => {
    const m = buildProgramScheduleStatus({
      days: [day("d1", "2026-06-05")],
      instances: [],
      completions: [comp("d1", null)],
    });
    expect(m.get("d1")!.status).toBe("in-progress");
  });

  it("picks the earliest instance as canonical for repeat sessions", () => {
    const m = buildProgramScheduleStatus({
      days: [day("d1", null)],
      instances: [inst("i2", "d1", "2026-06-12"), inst("i1", "d1", "2026-06-08")],
      completions: [],
    });
    const st = m.get("d1")!;
    expect(st.canonicalDate).toBe("2026-06-08");
    expect(st.scheduledWorkoutId).toBe("i1");
    expect(st.instanceCount).toBe(2);
  });
});

describe("summarizeProgramSchedule", () => {
  it("counts scheduled, missing, issues and progress", () => {
    const m = buildProgramScheduleStatus({
      days: [day("a", "2026-06-01"), day("b", null), day("c", "2026-06-01")],
      instances: [inst("i1", "c", "2026-06-09")],
      completions: [comp("a", "2026-06-01T00:00:00Z")],
    });
    const s = summarizeProgramSchedule(m.values());
    expect(s.totalDays).toBe(3);
    expect(s.completedCount).toBe(1);
    expect(s.missingCount).toBe(1);
    expect(s.issueCount).toBe(1);
    expect(s.scheduledCount).toBe(3); // completed day keeps its date
  });
});