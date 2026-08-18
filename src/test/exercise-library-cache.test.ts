import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  invalidateExerciseLibrary,
  isExerciseLibraryQueryKey,
  upsertExerciseInLibraryCaches,
  reconcileExerciseLibraryChange,
} from "@/lib/exercise-library-cache";

describe("exercise library cache", () => {
  it("recognises every consumer key", () => {
    for (const k of [
      ["exercises"], ["exercises-min"], ["exercise-search-pool"],
      ["exercise-search-pool-lite"], ["quick-swap-suggestions", "id"],
      ["pl-maxes-exercise-library"], ["day-preview-exercises", "d1", true],
    ]) expect(isExerciseLibraryQueryKey(k)).toBe(true);
    expect(isExerciseLibraryQueryKey(["messages"])).toBe(false);
  });

  it("invalidates inactive pools too", async () => {
    const qc = new QueryClient();
    qc.setQueryData(["exercise-search-pool"], [{ id: "1" }]);
    qc.setQueryData(["exercises-min"], [{ id: "1" }]);
    qc.setQueryData(["messages"], []);
    await invalidateExerciseLibrary(qc);
    expect(qc.getQueryState(["exercise-search-pool"])?.isInvalidated).toBe(true);
    expect(qc.getQueryState(["exercises-min"])?.isInvalidated).toBe(true);
    expect(qc.getQueryState(["messages"])?.isInvalidated).toBe(false);
  });

  it("adds a created row to raw library caches immediately", () => {
    const qc = new QueryClient();
    qc.setQueryData(["exercises"], [{ id: "1", name: "Squat" }]);
    qc.setQueryData(["exercise-search-pool"], [{ id: "1", name: "Squat" }]);
    qc.setQueryData(["quick-swap-suggestions", "1"], [{ ex: { id: "1" } }]);

    upsertExerciseInLibraryCaches(qc, { id: "2", name: "Touch & Go Bench Press", archived: false });

    expect(qc.getQueryData<Array<{ id: string }>>(["exercises"])?.map((row) => row.id)).toContain("2");
    expect(qc.getQueryData<Array<{ id: string }>>(["exercise-search-pool"])?.map((row) => row.id)).toContain("2");
    expect(qc.getQueryData(["quick-swap-suggestions", "1"])).toEqual([{ ex: { id: "1" } }]);
  });

  it("reconciles a remote new exercise into open add and swap pools", () => {
    const qc = new QueryClient();
    qc.setQueryData(["exercises-min"], [{ id: "1", name: "Squat" }]);
    qc.setQueryData(["exercise-search-pool"], [{ id: "1", name: "Squat" }]);
    qc.setQueryData(["exercise-search-pool-lite"], [{ id: "1", name: "Squat" }]);

    reconcileExerciseLibraryChange(qc, {
      eventType: "INSERT",
      newRow: { id: "2", name: "Touch & Go Bench Press", archived: false },
      oldRow: null,
    });

    for (const key of [["exercises-min"], ["exercise-search-pool"], ["exercise-search-pool-lite"]]) {
      expect(qc.getQueryData<Array<{ id: string }>>(key)?.map((row) => row.id)).toContain("2");
    }
  });

  it("removes archived exercises from every open add and swap pool", () => {
    const qc = new QueryClient();
    qc.setQueryData(["exercises"], [{ id: "2", name: "Touch & Go Bench Press", archived: false }]);
    qc.setQueryData(["exercise-search-pool"], [{ id: "2", name: "Touch & Go Bench Press", archived: false }]);

    reconcileExerciseLibraryChange(qc, {
      eventType: "UPDATE",
      newRow: { id: "2", name: "Touch & Go Bench Press", archived: true },
      oldRow: { id: "2" },
    });

    expect(qc.getQueryData<Array<{ id: string }>>(["exercises"])?.map((row) => row.id)).not.toContain("2");
    expect(qc.getQueryData<Array<{ id: string }>>(["exercise-search-pool"])?.map((row) => row.id)).not.toContain("2");
  });
});
