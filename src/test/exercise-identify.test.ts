import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { searchExercises, type SearchableExercise } from "@/lib/exercise-search";
import {
  descriptionKey,
  matchGuesses,
  parseIdentifyReply,
  shouldAskAi,
} from "@/lib/exercise-identify";

const fx = JSON.parse(
  readFileSync(
    path.resolve(process.cwd(), "src/test/fixtures/exercise-library-2026-11.json"),
    "utf8",
  ),
) as { rows: string[][] };
const lib: SearchableExercise[] = fx.rows.map((r) => ({
  id: r[0],
  name: r[1],
  equipment: r[2] || null,
  muscle_group: r[3] || null,
  primary_movement_pattern: r[4] || null,
  category: r[5] || null,
  exercise_family: r[6] || null,
  muscle_groups: r[7] ? r[7].split(" ") : [],
}));

describe("reading the AI's answer", () => {
  it("reads guesses, other names and confidence", () => {
    const r = parseIdentifyReply(
      '{"guesses":[{"name":"Seated Cable Row","also":["Low Cable Row","Cable Row"],"confidence":"high"}],"vague":false}',
    );
    expect(r).toEqual({
      guesses: [
        { name: "Seated Cable Row", also: ["Low Cable Row", "Cable Row"], confidence: "high" },
      ],
      vague: false,
    });
  });

  it("finds the JSON inside a fenced or chatty answer", () => {
    const r = parseIdentifyReply(
      'Sure!\n```json\n{"guesses":[{"name":"Face Pull","confidence":"medium"}]}\n```',
    );
    expect(r?.guesses[0]).toEqual({ name: "Face Pull", also: [], confidence: "medium" });
  });

  it("drops anything malformed instead of guessing", () => {
    expect(parseIdentifyReply("no idea")).toBeNull();
    expect(parseIdentifyReply("{not json")).toBeNull();
    const r = parseIdentifyReply(
      '{"guesses":[{"name":"this is a whole sentence about some exercise you might do"},{"name":42},{"name":"Lat Pulldown","confidence":"certain"},{"name":"lat pulldown"}]}',
    );
    expect(r?.guesses).toEqual([{ name: "Lat Pulldown", also: [], confidence: "low" }]);
  });

  it("keeps at most four guesses and says when it couldn't tell", () => {
    const many = {
      guesses: ["A Row", "B Row", "C Row", "D Row", "E Row"].map((name) => ({
        name,
        confidence: "low",
      })),
    };
    expect(parseIdentifyReply(JSON.stringify(many))?.guesses).toHaveLength(4);
    expect(parseIdentifyReply('{"guesses":[],"vague":true}')).toEqual({ guesses: [], vague: true });
  });

  it("caches a description by what it says", () => {
    expect(descriptionKey("  Pull a CABLE to my waist! ")).toBe(
      descriptionKey("pull a cable to my waist"),
    );
  });
});

describe("when to ask", () => {
  const ask = (q: string) => shouldAskAi(q, searchExercises(lib, q));
  it("asks for a description", () => {
    expect(ask("that back exercise where you pull a cable toward your waist")).toBe(true);
  });
  it("asks for a few words nothing matches by name", () => {
    expect(ask("jefferson curl")).toBe(true);
  });
  it("never for a name the library has, one word, or too little", () => {
    expect(ask("cable lateral raise")).toBe(false);
    expect(ask("rdl")).toBe(false);
    expect(ask("deadlift")).toBe(false);
    expect(ask("ab")).toBe(false);
  });
});

describe("finding the AI's names in the library", () => {
  it("returns the library's own exercise, likely only when the AI was sure and the name is the library's", () => {
    const m = matchGuesses(lib, [
      { name: "Seated Cable Row", also: ["Low Cable Row"], confidence: "high" },
    ]);
    expect(m[0].exercise.name).toBe("Cable Seated Row");
    expect(m[0].confidence).toBe("likely");
    expect(m.slice(1).every((x) => x.confidence === "possible")).toBe(true);
  });

  it("never says likely for a guess it wasn't sure of", () => {
    const m = matchGuesses(lib, [{ name: "Cable Seated Row", also: [], confidence: "medium" }]);
    expect(m.every((x) => x.confidence === "possible")).toBe(true);
  });

  it("can only suggest an exercise in the list it was given (never invents one)", () => {
    expect(
      matchGuesses(lib, [{ name: "Zercher Carry Supreme", also: [], confidence: "high" }]),
    ).toEqual([]);
    const pool = lib.filter((e) => e.name !== "Cable Seated Row");
    const m = matchGuesses(pool, [{ name: "Seated Cable Row", also: [], confidence: "high" }]);
    expect(m.map((x) => x.exercise.name)).not.toContain("Cable Seated Row");
    expect(m.every((x) => x.confidence === "possible")).toBe(true);
  });

  it("keeps the AI's order, two per name, four in all, no repeats", () => {
    const m = matchGuesses(lib, [
      { name: "Lat Pulldown", also: [], confidence: "high" },
      { name: "Seated Cable Row", also: [], confidence: "medium" },
      { name: "Face Pull", also: [], confidence: "low" },
    ]);
    expect(m.length).toBeLessThanOrEqual(4);
    expect(new Set(m.map((x) => x.exercise.id)).size).toBe(m.length);
    expect(m[0].guess).toBe("Lat Pulldown");
    expect(m.filter((x) => x.guess === "Lat Pulldown").length).toBeLessThanOrEqual(2);
  });
});
