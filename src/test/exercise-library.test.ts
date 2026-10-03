import { describe, expect, it } from "vitest";
import {
  duplicateKey,
  exerciseIssues,
  findPossibleDuplicates,
  hasMuscleTags,
  pairKey,
  previewEmbedUrl,
  searchLibrary,
  summarizeLibrary,
  videoStatus,
  type ExerciseAlias,
  type LibraryExercise,
} from "@/lib/exercise-library";
import { computeWeeklyVolume } from "@/lib/volume";
import { resolveMuscleGroups } from "@/lib/analytics/muscle-map";

const ex = (o: Partial<LibraryExercise> & { id: string; name: string }): LibraryExercise => ({
  archived: false, exercise_family: "Bench Press", muscle_groups: ["chest"], secondary_muscle_groups: [], ...o,
});

const comp = ex({
  id: "comp", name: "Competition Bench Press", equipment: "Barbell",
  muscle_groups: ["chest", "triceps", "front_delts"], secondary_muscle_groups: ["upper_back"],
  vimeo_embed_url: "https://player.vimeo.com/video/1",
});
const spoto = ex({ id: "spoto", name: "Spoto Press", muscle_groups: ["chest", "triceps", "front_delts"] });
const fly = ex({ id: "fly", name: "Chest Fly - Machine", exercise_family: "Chest Fly", video_url: "https://player.vimeo.com/video/2" });
const flyDup = ex({ id: "fly2", name: "Machine Chest Fly", exercise_family: "Chest Fly" });
const aliases: ExerciseAlias[] = [
  { alias_key: "barbellbenchpress", alias_name: "Barbell Bench Press", exercise_id: "comp" },
  { alias_key: "compbench", alias_name: "Comp Bench", exercise_id: "comp" },
];

describe("video status", () => {
  it("reads the same URLs the athlete How-To sheet plays", () => {
    expect(videoStatus(comp)).toBe("video");
    expect(videoStatus(spoto)).toBe("none");
    expect(videoStatus(ex({ id: "x", name: "x", video_url: "not a url" }))).toBe("broken");
    expect(videoStatus(ex({ id: "y", name: "y", video_url: "https://vimeo.com/1", quality_warning: "blurry" }))).toBe("broken");
  });
  it("builds embeddable previews", () => {
    expect(previewEmbedUrl("https://youtu.be/abcdefgh")).toBe("https://www.youtube-nocookie.com/embed/abcdefgh");
    expect(previewEmbedUrl("https://vimeo.com/12345")).toBe("https://player.vimeo.com/video/12345");
    expect(previewEmbedUrl("https://player.vimeo.com/video/9?x=1")).toBe("https://player.vimeo.com/video/9?x=1");
  });
});

describe("duplicates", () => {
  it("treats word order and spelling variants as the same movement", () => {
    expect(duplicateKey("Hip Thrust - Barbell")).toBe(duplicateKey("Barbell Hip Thrust"));
    expect(duplicateKey("Lateral Raises Dumbbell")).toBe(duplicateKey("Dumbbell Lateral Raise"));
    expect(duplicateKey("Cable Machine High To Low")).not.toBe(duplicateKey("Cable Machine Low To High"));
    expect(duplicateKey("Spoto Press")).not.toBe(duplicateKey("Competition Bench Press"));
  });
  it("flags look-alikes and names that are another exercise's alias, honouring Keep Separate", () => {
    const aliasClash = ex({ id: "bbp", name: "Barbell Bench Press" });
    const dups = findPossibleDuplicates([comp, spoto, fly, flyDup, aliasClash], aliases);
    expect(dups.get("fly")?.map((d) => d.id)).toEqual(["fly2"]);
    expect(dups.get("bbp")?.[0]).toMatchObject({ id: "comp", via: "alias" });
    expect(dups.has("spoto")).toBe(false);
    const kept = findPossibleDuplicates([fly, flyDup], [], new Set([pairKey("fly", "fly2")]));
    expect(kept.size).toBe(0);
  });
});

describe("needs attention", () => {
  it("lists every missing piece", () => {
    const bare = ex({ id: "b", name: "Mystery", exercise_family: null, muscle_groups: [] });
    expect(exerciseIssues(bare, new Map())).toEqual(["no_video", "missing_muscles", "no_family"]);
    expect(exerciseIssues(comp, new Map())).toEqual([]);
  });
  it("accepts 'Other' only for mobility/conditioning", () => {
    expect(hasMuscleTags(ex({ id: "m", name: "Hip Stretch", exercise_family: "Mobility", muscle_groups: ["other"] }))).toBe(true);
    expect(hasMuscleTags(ex({ id: "s", name: "Press", exercise_family: "Overhead Press", muscle_groups: ["other"] }))).toBe(false);
  });
  it("summarises the library", () => {
    const list = [comp, spoto, fly, flyDup];
    const dups = findPossibleDuplicates(list, aliases);
    const issues = new Map(list.map((e) => [e.id, exerciseIssues(e, dups)]));
    const s = summarizeLibrary(list, issues, new Map([["comp", 2]]));
    expect(s).toMatchObject({ total: 4, withVideo: 2, missingVideo: 2, needsAttention: 3, duplicates: 2, withAliases: 1 });
  });
});

describe("search", () => {
  const list = [comp, spoto, fly, flyDup];
  it("finds the canonical exercise through an alias and says why", () => {
    const { hits } = searchLibrary(list, aliases, "barbell bench");
    expect(hits[0].exercise.id).toBe("comp");
    expect(hits[0].reason).toEqual({ kind: "alias", text: "Barbell Bench Press" });
    const comp2 = searchLibrary(list, aliases, "comp bench").hits[0];
    expect(comp2.exercise.id).toBe("comp");
    expect(comp2.reason).toEqual({ kind: "alias", text: "Comp Bench" });
  });
  it("never lists an alias as its own exercise", () => {
    const ids = searchLibrary(list, aliases, "bench").hits.map((h) => h.exercise.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("comp");
  });
  it("searches families and muscles", () => {
    const fam = searchLibrary(list, aliases, "chest fly").hits.map((h) => h.exercise.id);
    expect(fam).toEqual(expect.arrayContaining(["fly", "fly2"]));
    const tri = searchLibrary(list, aliases, "triceps").hits;
    expect(tri.find((h) => h.exercise.id === "spoto")?.reason).toEqual({ kind: "muscle", text: "Triceps" });
  });
});

describe("muscle analytics read primary + secondary", () => {
  it("volume: primaries get full sets, secondaries half", () => {
    const v = computeWeeklyVolume(
      { days: [{ rows: [{ exercise_id: "comp", sets: 4 }] }] },
      [{ id: "comp", muscle_groups: ["chest", "triceps", "front_delts"], secondary_muscle_groups: ["upper_back"], variation_type: "competition" }],
    );
    const by = Object.fromEntries(v.byMuscle.map((b) => [b.key, b.rawSets]));
    expect(by).toEqual({ chest: 4, triceps: 4, front_delts: 4, upper_back: 2 });
    expect(v.untaggedRowCount).toBe(0);
  });
  it("performance insights normalises snake_case keys and arrays", () => {
    const c = resolveMuscleGroups(["quads", "glutes", "adductors"], ["lower_back", "core"]);
    expect(c).toEqual(expect.arrayContaining([
      { group: "Quads", weight: 1 }, { group: "Glutes", weight: 1 }, { group: "Back", weight: 0.5 }, { group: "Core", weight: 0.5 },
    ]));
    expect(resolveMuscleGroups("Upper Back", null)).toEqual([{ group: "Back", weight: 1 }]);
  });
});
