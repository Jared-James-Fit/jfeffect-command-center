import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("workout critical payload contract", () => {
  it("keeps required results on the critical path while deferring secondary hydration", () => {
    const view = source("src/components/workout-day/WorkoutDayView.tsx");

    expect(view).toContain("const [secondaryHydrationReady, setSecondaryHydrationReady] = useState(false)");
    expect(view).toContain("enabled: !!client?.id && (rows as any[]).length > 0");
    expect(view).toContain("enabled: secondaryHydrationReady && !!historyOwnerId");
    expect(view).toContain("enabled: secondaryHydrationReady && (rows as any[]).length > 0");
    expect(view).toContain("<WorkoutExerciseCardsSkeleton />");
    expect(view).toContain("<WorkoutExerciseCardsSkeleton focusMode />");
  });

  it("does not include video media in the logger’s initial prescription projection", () => {
    const view = source("src/components/workout-day/WorkoutDayView.tsx");
    const adapter = source("src/lib/workout-context/client-adapter.ts");

    expect(view).toContain("exercises(id,name,cues,muscle_group,category,equipment,difficulty");
    expect(view).not.toContain("exercises(id,name,video_url,vimeo_embed_url");
    expect(adapter).toContain("exercises(id,name,cues,muscle_group,category,equipment,difficulty");
  });

  it("reuses loaded row IDs and lazy-loads only user-requested secondary action modules", () => {
    const view = source("src/components/workout-day/WorkoutDayView.tsx");
    const adapter = source("src/lib/workout-context/client-adapter.ts");
    const actions = source("src/components/workout-day/deferred-exercise-actions.tsx");

    expect(view).toContain("adapter.listRowResultsRaw(dayId, rowIds)");
    expect(adapter).toContain("async listRowResultsRaw(dayId: string, knownRowIds?: string[])");
    expect(actions).toContain('lazy(() => import("./deferred-exercise-history-sheet"))');
    expect(actions).toContain('lazy(() => import("./deferred-exercise-how-to-sheet"))');
    expect(actions).toContain('import("./QuickSwapButton")');
  });
});
