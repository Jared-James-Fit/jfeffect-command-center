import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { historySetOrder } from "@/components/exercise-history-sheet";

const read = (p: string) => readFileSync(p, "utf8");

describe("a typed reps / RPE saves on the set it was typed in", () => {
  it("a pending autosave survives re-renders (dropped only on unmount or a different record)", () => {
    const hook = read("src/hooks/use-autosave.ts");
    expect(hook).toContain("if (timer.current) { clearTimeout(timer.current); timer.current = null; }\n  }, [key]);");
    expect(hook).not.toContain("}, [doSave, equals]);");
  });
  it("the set saves now, then the sets below fill down", () => {
    const day = read("src/components/workout-day/WorkoutDayView.tsx");
    expect(day).toContain('setCommitFlushToken((t) => t + 1);\n    void onFieldCascade?.(setIndex, "reps", v, previous);');
    expect(day).toContain('setCommitFlushToken((t) => t + 1);\n    void onFieldCascade?.(setIndex, "rpe", stored, previous);');
  });
});

describe("History lists a day's sets in the order they were done", () => {
  const row = (id: string, sort_order: number) => ({ id, sort_order });
  it("by set number, never by when the rows were saved", () => {
    // Marc, Oct 16: one weight filled sets 2-4, and the writes landed 2, 1, 4, 3
    const bench = row("bench", 0);
    const saved = [
      { set_index: 2, created_at: "23:09:17.930", pl_exercise_rows: bench },
      { set_index: 1, created_at: "23:09:18.217", pl_exercise_rows: bench },
      { set_index: 4, created_at: "23:09:18.230", pl_exercise_rows: bench },
      { set_index: 3, created_at: "23:09:18.334", pl_exercise_rows: bench },
    ];
    expect([...saved].sort(historySetOrder).map((s) => s.set_index)).toEqual([1, 2, 3, 4]);
  });
  it("the same lift on two rows: the earlier row's sets first, each row's kept together", () => {
    const top = row("top", 0);
    const backoff = row("backoff", 3);
    const saved = [
      { set_index: 1, pl_exercise_rows: backoff },
      { set_index: 2, pl_exercise_rows: top },
      { set_index: 2, pl_exercise_rows: backoff },
      { set_index: 1, pl_exercise_rows: top },
    ];
    expect([...saved].sort(historySetOrder).map((s) => `${s.pl_exercise_rows.id}:${s.set_index}`)).toEqual([
      "top:1", "top:2", "backoff:1", "backoff:2",
    ]);
  });
});
