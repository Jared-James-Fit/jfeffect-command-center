import { describe, expect, it } from "vitest";
import { SEARCH_TIER, searchExercises, type SearchableExercise } from "@/lib/exercise-search";

const lib: SearchableExercise[] = [
  { id: "csr", name: "Chest Supported Dumbbell Row", muscle_group: "Upper Back", equipment: "Dumbbell", category: "Row" },
  { id: "csrm", name: "Chest Supported Row - Machine", muscle_group: "Upper Back", equipment: "Machine", category: "Row" },
  { id: "dbr", name: "Dumbbell Row", muscle_group: "Lats", equipment: "Dumbbell", category: "Row" },
  { id: "cp", name: "Dumbbell Chest Press", muscle_group: "Chest", equipment: "Dumbbell", category: "Press" },
  { id: "fly", name: "Cable Chest Fly", muscle_group: "Chest", equipment: "Cable", category: "Fly" },
  { id: "scr", name: "Standing Calf Raise", muscle_group: "Calves", equipment: "Machine", category: "Calf" },
  { id: "sdb", name: "Standing Dumbbell Curl", muscle_group: "Biceps", equipment: "Dumbbell", category: "Curl" },
  { id: "comp", name: "Competition Deadlift", muscle_group: "Posterior Chain", equipment: "Barbell", category: "Hinge" },
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
    expect(top("chest supported row")).toBe("Chest Supported Dumbbell Row");
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
});
