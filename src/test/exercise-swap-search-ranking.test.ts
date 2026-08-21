import { describe, expect, it } from "vitest";
import {
  SEARCH_TIER,
  highlightSegments,
  searchEligibleExercises,
  searchExercises,
  type SearchableExercise,
} from "@/lib/exercise-search";

const lib: SearchableExercise[] = [
  { id: "csr", name: "Chest Supported Dumbbell Row", muscle_group: "Upper Back", equipment: "Dumbbell", category: "Row" },
  { id: "csrm", name: "Chest Supported Row - Machine", muscle_group: "Upper Back", equipment: "Machine", category: "Row" },
  { id: "dbr", name: "Dumbbell Row", muscle_group: "Lats", equipment: "Dumbbell", category: "Row" },
  { id: "cp", name: "Dumbbell Chest Press", muscle_group: "Chest", equipment: "Dumbbell", category: "Press" },
  { id: "fly", name: "Cable Chest Fly", muscle_group: "Chest", equipment: "Cable", category: "Fly" },
  { id: "scr", name: "Standing Calf Raise", muscle_group: "Calves", equipment: "Machine", category: "Calf" },
  { id: "sdb", name: "Standing Dumbbell Curl", muscle_group: "Biceps", equipment: "Dumbbell", category: "Curl" },
  { id: "comp", name: "Competition Deadlift", muscle_group: "Posterior Chain", equipment: "Barbell", category: "Hinge" },
  { id: "scm", name: "Standing Calf Raise Machine", muscle_group: "Calves", equipment: "Machine", category: "Calf" },
  { id: "seated", name: "Seated Calf Raise Machine", muscle_group: "Calves", equipment: "Machine", category: "Calf" },
];

const top = (q: string) => searchExercises(lib, q).results[0]?.exercise.name;
const names = (q: string) => searchExercises(lib, q).results.map((r) => r.exercise.name);

describe("swap search ranking contract", () => {
  it("ranks the exact full name first", () => {
    expect(top("Chest Supported Dumbbell Row")).toBe("Chest Supported Dumbbell Row");
    const first = searchExercises(lib, "Chest Supported Dumbbell Row").results[0];
    expect(first.tier).toBe(SEARCH_TIER.exactName);
  });

  it("is case-insensitive and whitespace/punctuation normalised", () => {
    expect(top("  chest   supported dumbbell  row ")).toBe("Chest Supported Dumbbell Row");
    expect(top("CHEST-SUPPORTED DUMBBELL ROW")).toBe("Chest Supported Dumbbell Row");
  });

  it("matches keywords separated by other title words", () => {
    expect(names("chest supported row").slice(0, 2)).toContain("Chest Supported Dumbbell Row");
    expect(names("chest dumbbell row")[0]).toBe("Chest Supported Dumbbell Row");
    expect(names("supported dumbbell")).toContain("Chest Supported Dumbbell Row");
  });

  it("out-of-order tokens still match, ordered tokens rank higher", () => {
    const ordered = searchExercises(lib, "dumbbell row").results[0];
    expect(ordered.exercise.name).toBe("Dumbbell Row");
    expect(ordered.tier).toBeLessThanOrEqual(SEARCH_TIER.orderedTokens);
  });

  it("text matches always beat metadata-only (recommendation) matches", () => {
    const res = searchExercises(lib, "chest supported dumbbell row").results;
    const rank = (id: string) => res.findIndex((r) => r.exercise.id === id);
    expect(rank("csr")).toBe(0);
    // Cable Chest Fly only shares the muscle "Chest" — must rank below.
    expect(rank("fly")).toBeGreaterThan(rank("csr"));
    const flyResult = res.find((r) => r.exercise.id === "fly");
    if (flyResult) expect(flyResult.tier).toBeGreaterThan(SEARCH_TIER.orderedTokens);
  });

  it("prioritises stronger title matches for a single keyword", () => {
    const res = names("standing");
    expect(res.slice(0, 2)).toEqual(
      expect.arrayContaining(["Standing Calf Raise", "Standing Dumbbell Curl"]),
    );
  });

  it("supports partial words", () => {
    expect(names("dumbb ro")).toContain("Dumbbell Row");
  });

  it("searches the complete list passed in (no truncation below the limit)", () => {
    const big: SearchableExercise[] = Array.from({ length: 1800 }, (_, i) => ({
      id: `x${i}`,
      name: `Filler Movement ${i}`,
    }));
    const pool = [...big, { id: "needle", name: "Zercher Carry" }];
    expect(searchExercises(pool, "zercher carry").results[0]?.exercise.id).toBe("needle");
  });

  it.each([
    "Standing Calf Raise Machine",
    "standing calf raise machine",
    "standing calf raises machine",
    "calf raise machine",
    "calf raises machine",
    "standing calf",
    "raise machine",
  ])("finds the canonical calf exercise for %s", (query) => {
    expect(names(query)).toContain("Standing Calf Raise Machine");
  });

  it("ranks plural-equivalent full titles directly after literal exact titles", () => {
    const result = searchExercises(lib, "standing calf raises machine").results[0];
    expect(result.exercise.id).toBe("scm");
    expect(result.tier).toBe(SEARCH_TIER.tokenEquivalent);
  });

  it.each([
    ["raises", "raise"],
    ["curls", "curl"],
    ["extensions", "extension"],
    ["rows", "row"],
    ["presses", "press"],
  ])("normalises %s to match %s", (plural, singular) => {
    const pool = [{ id: singular, name: `Cable ${singular}` }];
    expect(searchExercises(pool, `cable ${plural}`).results[0]?.exercise.id).toBe(singular);
  });

  it("supports unordered all-token plural matches", () => {
    expect(top("machine standing raises calf")).toBe("Standing Calf Raise Machine");
  });

  it("searches the full eligible pool regardless of recommendation ordering", () => {
    const recommendationSubset = lib.filter((exercise) => exercise.equipment === "Dumbbell");
    expect(recommendationSubset.some((exercise) => exercise.id === "scm")).toBe(false);
    expect(searchEligibleExercises(lib, "standing calf raises machine").results[0]?.exercise.id).toBe("scm");
  });

  it("keeps archived and current exercises out of eligible swap results", () => {
    const pool = [
      ...lib,
      { id: "archived", name: "Perfect Exact Name", archived: true },
    ];
    expect(searchEligibleExercises(pool, "perfect exact name", { excludeId: "csr" }).results).toHaveLength(0);
    expect(searchEligibleExercises(pool, "chest supported dumbbell row", { excludeId: "csr" }).results[0]?.exercise.id).not.toBe("csr");
  });

  it("scores every eligible row before applying a result limit", () => {
    const filler = Array.from({ length: 6000 }, (_, index) => ({
      id: `f${index}`,
      name: `Standing Machine Movement ${index}`,
    }));
    const result = searchEligibleExercises(
      [...filler, { id: "exact", name: "Standing Calf Raise Machine" }],
      "standing calf raise machine",
      { limit: 10 },
    );
    expect(result.results[0]?.exercise.id).toBe("exact");
  });

  it("highlights singular title words for plural query tokens", () => {
    const result = searchExercises(lib, "standing calf raises machine");
    const segments = highlightSegments("Standing Calf Raise Machine", result.highlightTerms);
    expect(segments.filter((segment) => segment.match).map((segment) => segment.text.toLowerCase())).toEqual(
      expect.arrayContaining(["standing", "calf", "raise", "machine"]),
    );
  });

  it("does not mutate the exercise pool while searching", () => {
    const before = structuredClone(lib);
    searchEligibleExercises(lib, "standing calf raises machine");
    expect(lib).toEqual(before);
  });
});
