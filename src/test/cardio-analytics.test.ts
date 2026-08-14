import { describe, it, expect } from "vitest";
import {
  summarizeCardio,
  adherencePct,
  classifyModality,
  classifyZone,
  type CardioTargetRow,
  type CardioCompletionRow,
} from "@/lib/analytics/cardio-adherence";

const start = "2026-01-05"; // Mon
const end = "2026-02-01"; // 4 weeks

function target(over: Partial<CardioTargetRow> = {}): CardioTargetRow {
  return {
    id: "t1",
    cardio_type: "Incline Walking",
    frequency_per_week: 1,
    duration_minutes: 25,
    heart_rate_zone: "Zone 2",
    status: "Active",
    enabled: true,
    ...over,
  };
}
function comp(over: Partial<CardioCompletionRow> & { completed_date: string }): CardioCompletionRow {
  return { completed: true, skipped: false, cardio_target_id: "t1", duration_minutes: 25, cardio_type: "Incline Walking", ...over };
}

describe("cardio analytics", () => {
  it("TEST 1 — full adherence 4/4, 100/100 min", () => {
    const s = summarizeCardio({
      targets: [target({ frequency_per_week: 1, duration_minutes: 25 })],
      completions: ["2026-01-06", "2026-01-13", "2026-01-20", "2026-01-27"].map((d) =>
        comp({ completed_date: d, duration_minutes: 25 }),
      ),
      start,
      end,
    });
    expect(s.prescribedSessions).toBe(4);
    expect(s.completedSessions).toBe(4);
    expect(s.adherence).toBe(100);
    expect(s.prescribedMinutes).toBe(100);
    expect(s.completedMinutes).toBe(100);
  });

  it("TEST 2 — partial adherence 3/4 and 70/100 min", () => {
    const s = summarizeCardio({
      targets: [target({ frequency_per_week: 1, duration_minutes: 25 })],
      completions: [
        comp({ completed_date: "2026-01-06", duration_minutes: 25 }),
        comp({ completed_date: "2026-01-13", duration_minutes: 25 }),
        comp({ completed_date: "2026-01-20", duration_minutes: 20 }),
      ],
      start,
      end,
    });
    expect(s.completedSessions).toBe(3);
    expect(s.prescribedSessions).toBe(4);
    expect(s.adherence).toBe(75);
    expect(s.completedMinutes).toBe(70);
    expect(s.prescribedMinutes).toBe(100);
  });

  it("TEST 3 — no cardio prescribed → null adherence", () => {
    const s = summarizeCardio({ targets: [], completions: [], start, end });
    expect(s.hasPrescription).toBe(false);
    expect(s.adherence).toBeNull();
    expect(adherencePct(0, 0)).toBeNull();
  });

  it("TEST 4 — zone 2 tracker 2/3", () => {
    const t = target({ id: "z", frequency_per_week: 3, duration_minutes: 30, heart_rate_zone: "Zone 2 (60-70%)" });
    const s = summarizeCardio({
      targets: [t],
      completions: [
        comp({ completed_date: "2026-01-06", cardio_target_id: "z", duration_minutes: 30 }),
        comp({ completed_date: "2026-01-08", cardio_target_id: "z", duration_minutes: 25 }),
      ],
      start,
      end: "2026-01-11",
    });
    expect(s.zone2?.prescribedSessions).toBe(3);
    expect(s.zone2?.completedSessions).toBe(2);
    expect(s.zone2?.adherence).toBe(67);
    expect(s.zone2?.completedMinutes).toBe(55);
  });

  it("TEST 5 — incline walking modality with avg incline/speed", () => {
    const s = summarizeCardio({
      targets: [target()],
      completions: [
        comp({ completed_date: "2026-01-06", duration_minutes: 25, incline: 5, avg_speed: 3.0, distance_unit: "mi" }),
        comp({ completed_date: "2026-01-13", duration_minutes: 30, incline: 6, avg_speed: 3.2, distance_unit: "mi" }),
      ],
      start,
      end,
    });
    const m = s.modalities[0];
    expect(m.modality).toBe("Incline Walking");
    expect(m.minutes).toBe(55);
    expect(m.avgIncline).toBe(5.5);
    expect(m.avgSpeed).toBe(3.1);
    expect(m.speedUnit).toBe("mph");
  });

  it("skipped sessions never count as completed", () => {
    const s = summarizeCardio({
      targets: [target({ frequency_per_week: 1 })],
      completions: [comp({ completed_date: "2026-01-06", completed: false, skipped: true })],
      start,
      end,
    });
    expect(s.completedSessions).toBe(0);
    expect(s.skippedSessions).toBe(1);
    expect(s.adherence).toBe(0);
  });

  it("weekly buckets track per-week adherence", () => {
    const s = summarizeCardio({
      targets: [target({ frequency_per_week: 2, duration_minutes: 25 })],
      completions: [
        comp({ completed_date: "2026-01-06", duration_minutes: 25 }),
        comp({ completed_date: "2026-01-07", duration_minutes: 25 }),
        comp({ completed_date: "2026-01-14", duration_minutes: 25 }),
      ],
      start,
      end: "2026-01-18",
    });
    expect(s.weeks).toHaveLength(2);
    expect(s.weeks[0].adherence).toBe(100);
    expect(s.weeks[1].adherence).toBe(50);
    expect(s.weeks[1].completedMinutes).toBe(25);
  });

  it("classifiers stay canonical", () => {
    expect(classifyModality("Stairmaster")).toBe("Stairmill");
    expect(classifyModality("Assault Bike")).toBe("Bike");
    expect(classifyZone({ intensity: "HIIT intervals" })).toBe("hiit");
    expect(classifyZone({ heart_rate_zone: "Zone 2" })).toBe("zone2");
    expect(classifyZone({})).toBe("other");
  });
});
