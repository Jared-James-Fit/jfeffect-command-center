import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { exerciseGuideKey, exerciseGuideQuery } from "@/lib/exercise-guide";
import { exerciseVideoSetGlobalQuery } from "@/hooks/use-exercise-video-set";

const read = (f: string) => readFileSync(f, "utf8");
const howTo = read("src/components/workout-day/exercise-how-to.tsx");

describe("How To opens in place, in the same frame", () => {
  it("is part of the logger: no code to fetch on the tap, so no spinner and nothing a publish can break", () => {
    expect(howTo).not.toContain("lazyWithRetry");
    expect(howTo).not.toContain("Suspense");
    expect(howTo).not.toContain("import(");
    const view = read("src/components/workout-day/WorkoutDayView.tsx");
    expect(view).toContain('import { ExerciseHowToButton } from "@/components/workout-day/exercise-how-to";');
    expect(view).toContain("<ExerciseHowToButton\n");
  });

  it("the button stays in the row while the sheet is up, and the sheet slides away when closed", () => {
    // one button, never swapped for a spinner or taken out of the row
    expect(howTo.match(/How&nbsp;To/g)).toHaveLength(1);
    expect(howTo).not.toContain("Loader2 className=\"mr-1");
    expect(howTo).toContain("<ExerciseHowToSheet open={open} onOpenChange={setOpen}");
    expect(howTo).toContain("{used && (");
  });

  it("the touch-down starts the guide, the live video set and the player's connection", () => {
    expect(howTo).toContain("onPointerDown={warm}");
    expect(howTo).toContain("void qc.prefetchQuery(exerciseGuideQuery(exerciseId, fallbackName));");
    expect(howTo).toContain("void qc.prefetchQuery(exerciseVideoSetGlobalQuery);");
    // the sheet reads the very same queries
    expect(howTo).toContain("useQuery(exerciseGuideQuery(exerciseId, fallbackName))");
    expect(howTo).toContain("useQuery(exerciseVideoSetGlobalQuery)");
    expect(exerciseGuideQuery("ex-1", "Squat").queryKey).toEqual(exerciseGuideKey("ex-1", "Squat"));
    expect(exerciseGuideQuery(null, "Squat").queryKey).toEqual(["workout-exercise-guide", "Squat"]);
    expect(exerciseVideoSetGlobalQuery.queryKey).toEqual(["app_settings", "exercise_video_set"]);
  });

  it("the demo shows as a cover once both queries have settled; the player only loads on Play", () => {
    expect(howTo).toContain("} else if (loading) {");
    expect(howTo).toContain("loading={guide.isPending || videoSet.isPending}");
    expect(howTo).toContain("<ExerciseDemoVideo url={videoUrl}");
    expect(howTo).not.toContain("HOW_TO_SETTLE_MS");
    // no blur over the player
    expect(howTo).not.toContain("backdrop-blur");
  });

  it("a guide that fails stays in the sheet (never the logger's 'Workout didn't load properly')", () => {
    expect(howTo).toContain("<GuideBoundary>");
    expect(howTo).toContain("Couldn't load this guide.");
    expect(howTo).toContain("onRetry={() => void guide.refetch()}");
  });
});
