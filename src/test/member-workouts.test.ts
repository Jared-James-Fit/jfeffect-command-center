import { describe, it, expect } from "vitest";
import { MemberWorkoutInput, memberWorkoutRows } from "@/lib/member-workouts";

const ex = (n: number) => ({ exerciseId: `00000000-0000-4000-8000-00000000000${n}`, sets: 3, reps: "8" });

describe("member-built workout input", () => {
  it("accepts a named workout with library exercises", () => {
    expect(() => MemberWorkoutInput.parse({ title: "Upper A", date: "2026-10-08", exercises: [ex(1)] })).not.toThrow();
  });
  it("needs a name, a date and 1-20 exercises", () => {
    expect(() => MemberWorkoutInput.parse({ title: " ", date: "2026-10-08", exercises: [ex(1)] })).toThrow();
    expect(() => MemberWorkoutInput.parse({ title: "A", date: "Oct 8", exercises: [ex(1)] })).toThrow();
    expect(() => MemberWorkoutInput.parse({ title: "A", date: "2026-10-08", exercises: [] })).toThrow();
  });
  it("rejects silly set counts", () => {
    expect(() => MemberWorkoutInput.parse({ title: "A", date: "2026-10-08", exercises: [{ ...ex(1), sets: 0 }] })).toThrow();
    expect(() => MemberWorkoutInput.parse({ title: "A", date: "2026-10-08", exercises: [{ ...ex(1), sets: 21 }] })).toThrow();
  });
});

describe("memberWorkoutRows", () => {
  it("keeps the picked order and the normal logging defaults", () => {
    const rows = memberWorkoutRows("day1", [ex(1), { ...ex(2), loadKg: 100 }]);
    expect(rows.map((r) => r.sort_order)).toEqual([0, 1]);
    expect(rows[0]).toEqual({
      day_id: "day1", sort_order: 0, exercise_id: ex(1).exerciseId, sets: 3, reps_text: "8",
      load_kg: null, load_unit: null, measurement_type: "reps", tracking_type: "reps_weight", time_profile: "accessory_compound",
    });
    expect(rows[1].load_kg).toBe(100);
    expect(rows[1].load_unit).toBe("kg");
  });
});
