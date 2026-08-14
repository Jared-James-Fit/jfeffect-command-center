import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { invalidateExerciseLibrary, isExerciseLibraryQueryKey } from "@/lib/exercise-library-cache";

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
});
