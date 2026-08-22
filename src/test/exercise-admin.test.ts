import { describe, expect, it } from "vitest";
import {
  filterByArchiveScope,
  sortExercises,
  formatAddedDate,
  isSafeToHardDelete,
  describeReferences,
} from "@/lib/exercise-admin";

const rows = [
  { id: "1", name: "Bench Press", archived: false, created_at: "2026-01-05T10:00:00Z" },
  { id: "2", name: "Archived Row", archived: true, created_at: "2026-03-05T10:00:00Z" },
  { id: "3", name: "Any Squat", archived: false, created_at: "2026-02-05T10:00:00Z" },
];

describe("exercise admin library", () => {
  it("scopes by archive status", () => {
    expect(filterByArchiveScope(rows, "active").map((r) => r.id)).toEqual(["1", "3"]);
    expect(filterByArchiveScope(rows, "archived").map((r) => r.id)).toEqual(["2"]);
    expect(filterByArchiveScope(rows, "all")).toHaveLength(3);
  });

  it("sorts by added date and name", () => {
    expect(sortExercises(rows, "newest").map((r) => r.id)).toEqual(["2", "3", "1"]);
    expect(sortExercises(rows, "oldest").map((r) => r.id)).toEqual(["1", "3", "2"]);
    expect(sortExercises(rows, "az").map((r) => r.id)).toEqual(["3", "2", "1"]);
  });

  it("formats missing added dates safely", () => {
    expect(formatAddedDate(null)).toBe("—");
    expect(formatAddedDate("not-a-date")).toBe("—");
    expect(formatAddedDate("2026-01-05T10:00:00Z")).toMatch(/2026/);
  });

  it("blocks permanent delete when history references the exercise", () => {
    expect(isSafeToHardDelete({ member_set_logs: 0, pl_exercise_rows: 0 })).toBe(true);
    expect(isSafeToHardDelete({ member_set_logs: 4, pl_exercise_rows: 0 })).toBe(false);
    expect(describeReferences({ member_set_logs: 4, pl_exercise_rows: 2 })).toBe(
      "4 logged sets, 2 program prescriptions",
    );
  });
});
