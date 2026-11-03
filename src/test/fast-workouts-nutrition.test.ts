import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { QUERY_PERSIST_MAX_AGE } from "@/lib/query-persister";
import { clientWorkoutsQuery, PAGE_CACHE_MS, primaryWorkouts } from "@/lib/client-workouts-query";
import { AT_HOME_BACKUP_SESSIONS_KEY } from "@/lib/at-home-backup";
import { coachMealPlanQuery, portalNutritionCtxQuery, portalWorkoutsClientQuery, WARM_FRESH_MS } from "@/lib/portal-page-queries";

const read = (f: string) => readFileSync(f, "utf8");

describe("Workouts and Nutrition open from the phone's copy", () => {
  it("their data is kept as long as the copy saved on the phone, so it's there on the next open", () => {
    expect(PAGE_CACHE_MS).toBe(QUERY_PERSIST_MAX_AGE);
    for (const q of [
      clientWorkoutsQuery("c1"),
      portalWorkoutsClientQuery("u1"),
      portalNutritionCtxQuery("u1"),
      coachMealPlanQuery("u1", null),
    ]) {
      expect(q.gcTime, String(q.queryKey[0])).toBe(PAGE_CACHE_MS);
    }
    // the app default (10 min) would drop them before they're saved
    expect(read("src/router.tsx")).toContain("gcTime: 10 * 60_000");
  });

  it("one program query for every screen, under the Workouts screen's own key", () => {
    expect(clientWorkoutsQuery("c1").queryKey).toEqual(["my-workouts", "c1"]);
    for (const f of [
      "src/components/workouts/WorkoutsExperience.tsx",
      "src/routes/_authenticated/portal/nutrition-targets.tsx",
      "src/components/cardio/ClientCardioSection.tsx",
      "src/lib/calendar-sources.ts",
      "src/components/nutrition/GroceryListSheet.tsx",
    ]) {
      const src = read(f);
      expect(src, f).toContain("clientWorkoutsQuery(");
      expect(src, f).not.toContain("getClientWorkouts(");
    }
    // Nutrition used to download the whole program a second time just for the day's type
    expect(read("src/routes/_authenticated/portal/nutrition-targets.tsx")).not.toContain("portal-nutrition-schedule");
    expect(read("src/lib/calendar-sources.ts")).not.toContain("cal-client-workouts");
  });

  it("screens that never showed at-home backup sessions still don't", () => {
    const items = [
      { id: 1, block: { source_template_block_key: AT_HOME_BACKUP_SESSIONS_KEY } },
      { id: 2, block: { source_template_block_key: null } },
      { id: 3, block: null },
    ];
    expect(primaryWorkouts(items).map((i) => i.id)).toEqual([2, 3]);
    expect(primaryWorkouts(null)).toEqual([]);
    expect(read("src/lib/calendar-sources.ts")).toContain("select: primaryWorkouts,");
  });

  it("the app warms both pages once it has painted: clients only, never while previewing, only what isn't fresh", () => {
    const layout = read("src/routes/_authenticated/portal/route.tsx");
    expect(layout).toContain("useWarmClientPages({ portalUserId, enabled: !isImpersonating && !tierLoading, nutrition: !isSelfServe });");
    const warm = read("src/lib/portal-page-queries.ts");
    expect(warm).toContain("staleTime: WARM_FRESH_MS");
    expect(warm).toContain("requestIdleCallback");
    expect(WARM_FRESH_MS).toBeGreaterThanOrEqual(5 * 60_000);
  });
});

describe("loading looks like the page it opens into", () => {
  it("no spinners: the schedule, program and plan cards have placeholders in their own shape", () => {
    const wx = read("src/components/workouts/WorkoutsExperience.tsx");
    expect(wx).not.toContain("Loading your schedule…");
    expect(wx).not.toContain("Loading program…");
    expect(wx).toContain("<ScheduleSkeleton />");
    expect(wx).toContain("<ProgramCardSkeleton />");
    const page = read("src/routes/_authenticated/portal/workouts.index.tsx");
    expect(page).toContain('<PageHeader title="Workouts" />');
    expect(page).toContain("<WorkoutsBodySkeleton />");
    const nutrition = read("src/routes/_authenticated/portal/nutrition-targets.tsx");
    expect(nutrition).not.toContain("Loading your nutrition plan…");
    // the meal plan's spot is held while it loads, so it never drops in above the targets
    expect(nutrition).toContain("{planQ.isLoading && <MealPlanCardSkeleton />}");
    expect(nutrition).toContain("<TargetsCardSkeleton />");
  });

  it("placeholders are neutral with one soft sweep, and still under reduced motion", () => {
    const skeleton = read("src/components/ui/skeleton.tsx");
    expect(skeleton).toContain('"jf-skeleton rounded-md bg-muted"');
    expect(skeleton).not.toContain("bg-primary/10");
    expect(skeleton).not.toContain("animate-pulse");
    const css = read("src/styles.css");
    expect(css).toContain("animation: jf-skeleton-sweep");
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.jf-skeleton::after \{ animation: none;/);
  });

  it("content fades in only when it replaced a placeholder, by opacity alone", () => {
    const hook = read("src/hooks/use-arrival.ts");
    expect(hook).toContain('return !loading && waited.current ? "jf-arrive" : "";');
    const css = read("src/styles.css");
    const arrive = css.slice(css.indexOf("@keyframes jf-arrive"), css.indexOf(".jf-arrive {"));
    // a transform would make it the containing block of anything position: fixed inside
    expect(arrive).not.toContain("transform");
    expect(read("src/components/workouts/WorkoutsExperience.tsx")).toContain("const arrived = useArrivalClass(isLoading);");
    expect(read("src/routes/_authenticated/portal/nutrition-targets.tsx")).toContain("const planArrived = useArrivalClass(planQ.isLoading);");
  });
});
