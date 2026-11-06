import { describe, expect, it } from "vitest";
import { PRESETS } from "@/lib/challenges/model";
import {
  UNTITLED,
  applyScoringChoice,
  buildPatch,
  draftFromPreset,
  fieldErrors,
  followSlug,
  missingItems,
  nextSlug,
  scoringChoiceOf,
  stepDone,
  type ChallengeRow,
} from "@/lib/challenges/wizard";

function row(over: Partial<ChallengeRow> = {}): ChallengeRow {
  return {
    id: "c1",
    slug: "winnipeg-225",
    title: "Winnipeg 225",
    tagline: null,
    description: null,
    status: "draft",
    activity: "Barbell bench press",
    exercise_id: null,
    measure: "reps",
    direction: "higher",
    unit: "reps",
    aggregate: "best",
    attempts_allowed: 1,
    relative_to_bodyweight: false,
    load_label: "225 lb",
    objective: null,
    tiebreak: "lighter",
    starts_at: "2026-11-21T18:00:00.000Z",
    ends_at: null,
    timezone: "America/Winnipeg",
    venue_name: "Test Gym",
    city: "Winnipeg, Manitoba",
    address: null,
    max_participants: null,
    min_age: 18,
    eligibility: null,
    rules: ["Full range of motion."],
    safety: null,
    warmup: null,
    prize_summary: null,
    entry_fee_label: "Free",
    self_registration: true,
    registration_opens_at: null,
    registration_closes_at: null,
    collect: { phone: "optional", instagram: "optional" },
    acknowledgments: [],
    cover_path: null,
    is_template: false,
    is_test: false,
    announcement: null,
    announcement_at: null,
    results_final_at: null,
    ...over,
  };
}

describe("scoring choices", () => {
  it("reads the choice back from the stored scoring", () => {
    expect(scoringChoiceOf(row())).toBe("most_reps");
    expect(scoringChoiceOf(row({ measure: "time", direction: "lower" }))).toBe("fastest");
    expect(scoringChoiceOf(row({ measure: "reps", direction: "lower" }))).toBeNull();
  });
  it("keeps a compatible unit and drops what no longer applies", () => {
    expect(applyScoringChoice(row(), "heaviest")).toMatchObject({
      measure: "weight",
      unit: "lb",
      load_label: null,
    });
    const kg = applyScoringChoice({ unit: "kg", relative_to_bodyweight: true, load_label: null }, "heaviest");
    expect(kg.unit).toBe("kg");
    expect(kg.relative_to_bodyweight).toBe(true);
    expect(applyScoringChoice(row({ relative_to_bodyweight: true }), "fastest")).toMatchObject({
      measure: "time",
      direction: "lower",
      unit: "s",
      relative_to_bodyweight: false,
    });
  });
});

describe("missing items", () => {
  it("names what publishing needs, by step", () => {
    const m = missingItems(row({ title: UNTITLED, starts_at: null, venue_name: " ", rules: [" "] }));
    expect(m.map((x) => [x.step, x.field])).toEqual([
      [1, "title"],
      [1, "starts_at"],
      [1, "venue_name"],
      [2, "rules"],
    ]);
    expect(stepDone(row(), 1)).toBe(true);
    expect(missingItems(row())).toEqual([]);
  });
});

describe("autosave patch", () => {
  it("sends only what changed, cleaned", () => {
    const { patch } = buildPatch(row(), row({ tagline: "  One set.  ", venue_name: "" }));
    expect(patch).toEqual({ tagline: "One set.", venue_name: null });
  });
  it("treats the same moment written two ways as unchanged", () => {
    const { patch } = buildPatch(
      row({ starts_at: "2026-11-21T18:00:00+00:00" }),
      row({ starts_at: "2026-11-21T18:00:00.000Z" }),
    );
    expect(patch).toEqual({});
  });
  it("ignores blank lines while a rule is being added", () => {
    const { patch } = buildPatch(row(), row({ rules: ["Full range of motion.", ""] }));
    expect(patch).toEqual({});
  });
  it("holds back a value that can't be saved and still saves the rest", () => {
    const { patch, errors } = buildPatch(
      row(),
      row({ title: "Wi", ends_at: "2026-11-21T17:00:00.000Z", city: "Selkirk" }),
    );
    expect(errors.title).toBeTruthy();
    expect(errors.ends_at).toBeTruthy();
    expect(patch).toEqual({ city: "Selkirk" });
  });
  it("never writes the placeholder name, nor an emptied name", () => {
    expect(buildPatch(row({ title: UNTITLED }), row({ title: "" })).patch).toEqual({});
  });
  it("leaves out a published link and locked scoring", () => {
    const { patch } = buildPatch(row(), row({ slug: "new-link", measure: "time", unit: "s", title: "New" }), {
      slugLocked: true,
      scoringLocked: true,
    });
    expect(patch).toEqual({ title: "New" });
  });
  it("checks the registration window", () => {
    const e = fieldErrors(
      row({
        registration_opens_at: "2026-11-10T00:00:00Z",
        registration_closes_at: "2026-11-09T00:00:00Z",
      }),
    );
    expect(e.registration_closes_at).toBeTruthy();
  });
});

describe("links", () => {
  it("follows the name while it hasn't been set by hand", () => {
    expect(followSlug(UNTITLED, "untitled-ab12cd", "Winnipeg 225")).toBe("winnipeg-225");
    expect(followSlug("Winnipeg 225", "winnipeg-225", "Winnipeg 225 Bench")).toBe(
      "winnipeg-225-bench",
    );
    expect(followSlug("Winnipeg 225", "my-own-link", "Winnipeg 225 Bench")).toBe("my-own-link");
    expect(followSlug(UNTITLED, "untitled-ab12cd", "Wi")).toBe("untitled-ab12cd");
  });
  it("finds a free link when one is taken", () => {
    expect(nextSlug("winnipeg-225", 0)).toBe("winnipeg-225-2");
    expect(nextSlug("winnipeg-225", 1)).toBe("winnipeg-225-3");
    expect(nextSlug("a".repeat(60), 0).length).toBeLessThanOrEqual(60);
    expect(nextSlug("winnipeg-225", 6)).toMatch(/^winnipeg-225-[a-z0-9]{1,4}$/);
  });
});

describe("a new draft", () => {
  it("starts untitled with the preset's scoring and rules", () => {
    const d = draftFromPreset(PRESETS[0]!);
    expect(d.title).toBe(UNTITLED);
    expect(String(d.slug)).toMatch(/^untitled-[a-z0-9]+$/);
    expect(d.measure).toBe(PRESETS[0]!.measure);
    expect(d.rules).toEqual(PRESETS[0]!.rules);
  });
});
