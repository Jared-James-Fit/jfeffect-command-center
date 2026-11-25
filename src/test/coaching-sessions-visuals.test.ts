import { describe, expect, it } from "vitest";
import { classLimit, EMPTY_VISUALS, slideVisuals, weekBuckets, type PresentationVisuals } from "@/lib/coaching-sessions/visuals";

const sections = [
  { key: "going_well" as const },
  { key: "improve" as const },
  { key: "athletes_corner" as const },
  { key: "game_plan" as const },
  { key: "alignment" as const },
];

describe("presentation visuals", () => {
  it("buckets the last 4 weeks of required workouts, oldest first", () => {
    const today = "2026-11-25";
    const w = weekBuckets(
      [
        { date: "2026-10-29", done: true, optional: false }, // first day of the window
        { date: "2026-10-28", done: true, optional: false }, // before it
        { date: "2026-11-24", done: false, optional: false },
        { date: "2026-11-25", done: true, optional: false },
        { date: "2026-11-20", done: true, optional: true }, // optional never counts
        { date: "2026-11-26", done: false, optional: false }, // ahead
      ],
      today,
    )!;
    expect(w.weeks).toHaveLength(4);
    expect(w.weeks[0]).toEqual({ start: "2026-10-29", planned: 1, done: 1 });
    expect(w.weeks[3]!.planned).toBe(2);
    expect(w.weeks[3]!.done).toBe(1);
    expect(w.planned).toBe(3);
    expect(w.done).toBe(2);
    expect(weekBuckets([], today)).toBeNull();
  });

  it("reads a class limit, none for a plus class", () => {
    expect(classLimit("63")).toBe(63);
    expect(classLimit("63 kg")).toBe(63);
    expect(classLimit("84+")).toBeNull();
    expect(classLimit("120+ kg")).toBeNull();
    expect(classLimit(null)).toBeNull();
  });

  it("puts each picture on one slide, only with data behind it", () => {
    expect(slideVisuals(sections, EMPTY_VISUALS)).toEqual({});
    const v: PresentationVisuals = {
      unit: "kg",
      training: { weeks: [], planned: 16, done: 6 },
      bodyweight: { points: [{ date: "2026-11-01", value: 64 }, { date: "2026-11-10", value: 63.5 }, { date: "2026-11-20", value: 63.1 }], limit: 63, classLabel: "63 kg class" },
      records: [{ exercise: "Competition Squat", load: 140, reps: 2, date: "2026-11-20" }],
      countdown: { daysOut: 10, date: "2026-12-05", title: "Total Fortification" },
    };
    const m = slideVisuals(sections, v);
    expect(m[0]).toBe("countdown");
    expect(m[1]).toBe("records");
    expect(m[2]).toBe("training"); // workouts were missed: it's what to improve
    expect(m[4]).toBe("bodyweight"); // the class on the game plan
    expect(Object.values(m).filter((k) => k === "training")).toHaveLength(1);
  });

  it("a consistent month is a win, not something to improve", () => {
    const v: PresentationVisuals = { ...EMPTY_VISUALS, training: { weeks: [], planned: 16, done: 16 } };
    const m = slideVisuals(sections, v);
    expect(m[1]).toBe("training");
    expect(m[2]).toBeUndefined();
  });
});
