import { describe, expect, it } from "vitest";
import { coreDaysPerWeek, listingDaysPerWeek } from "@/lib/programs/core-days";
import { buildRunningLibrary } from "@/lib/jf-programs/running-build";
import { buildLibrary } from "@/lib/jf-programs/build";

describe("a membership listing's days a week are the core workouts", () => {
  it("optional days don't count: members pick days for the core workouts only", () => {
    const all = [...buildLibrary(), ...buildRunningLibrary()];
    const byName = (n: string) => all.find((t) => t.name.includes(n))!;
    expect(listingDaysPerWeek(byName("Distance Builder"))).toBe(3);
    expect(listingDaysPerWeek(byName("Marathon Performance"))).toBe(4);
    expect(listingDaysPerWeek(byName("Elite Powerlifting"))).toBe(3);
    expect(listingDaysPerWeek(byName("Run Foundation"))).toBe(3);
    expect(listingDaysPerWeek(byName("Muscle & Strength"))).toBe(4);
    // every program: the template's own count when it has no optional days
    for (const t of all) {
      const optional = t.payload.blocks_data.some((b: any) => b.weeks_data.some((w: any) => w.days.some((d: any) => d.is_optional)));
      if (!optional) expect(listingDaysPerWeek(t)).toBe(t.days_per_week);
    }
  });
  it("reads a single block's weeks, and falls back to what the template says", () => {
    expect(coreDaysPerWeek({ payload: { weeks_data: [{ days: [{}, {}, { is_optional: true }] }, { days: [{}, {}] }] } })).toBe(2);
    expect(listingDaysPerWeek({ payload: {}, days_per_week: 4 })).toBe(4);
    expect(listingDaysPerWeek(null)).toBe(3);
  });
});

import { deriveFacets } from "@/lib/programs/facets";
import { groupBySections, matchesCategory } from "@/lib/programs/categories";
import { scoreProgram } from "@/lib/programs/recommend";

describe("the members' library shelves the JF Effect programs", () => {
  // as the listing migration writes them: the short title, the template's tags, goal and style
  const listings = [...buildLibrary(), ...buildRunningLibrary()].map((t) => ({
    name: t.name.split(" | ")[1].split(" — ")[0],
    public_title: t.name.split(" | ")[1].split(" — ")[0],
    goal: t.goal, training_style: t.training_style, tags: t.tags,
    difficulty: t.tags.includes("Beginner") ? "Beginner" : t.tags.includes("Intermediate") ? "Intermediate" : t.tags.includes("Advanced") ? "Advanced" : "All Levels",
    weeks: t.weeks, days_per_week: listingDaysPerWeek(t), est_minutes_per_workout: t.est_duration_min,
  }));
  const items = listings.map((p) => ({ program: p, facets: deriveFacets(p) }));
  const shelf = (title: string) =>
    groupBySections(items).find((g) => g.items.some((i) => i.program.public_title === title))!.section.label;

  it("the three running programs sit together on Running, never among the lifting ones", () => {
    for (const t of ["Run Foundation", "Distance Builder", "Marathon Performance"]) expect(shelf(t)).toBe("Running");
    const running = items.filter((i) => matchesCategory(i.facets, "running")).map((i) => i.program.public_title);
    expect(running).toEqual(["Run Foundation", "Distance Builder", "Marathon Performance"]);
  });
  it("the lifting programs keep their shelves", () => {
    expect(shelf("Strength Foundation")).toBe("Beginner Foundations");
    expect(shelf("Strength Development")).toBe("Powerlifting");
    expect(shelf("Glute & Physique Builder")).toBe("Glute Development");
    expect(shelf("Dumbbell Muscle Builder")).toBe("Home Training");
    expect(shelf("At-Home Physique Builder")).toBe("Home Training");
    expect(shelf("Physique Specialization")).toBe("Muscle Building");
    expect(items.find((i) => i.program.public_title === "Bodyweight Foundation")!.facets.location).toBe("home");
  });
  it("a lifter is never recommended a running program, however well its days fit", () => {
    const lifter = { main_goal: "Build muscle", training_days_per_week: 3, training_experience: "Beginner", training_location: "Gym", workout_length_minutes: 60 } as any;
    const run = items.find((i) => i.program.public_title === "Run Foundation")!;
    expect(scoreProgram(run.facets, lifter).score).toBeLessThan(3);
    const runner = { ...lifter, main_goal: "Run a 5K" };
    expect(scoreProgram(run.facets, runner).score).toBeGreaterThanOrEqual(3);
  });
});
