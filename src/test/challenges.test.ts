import { describe, expect, it } from "vitest";
import {
  countdownText,
  formatScore,
  formatSeconds,
  gapText,
  isoToWall,
  loadText,
  objectiveText,
  ordinal,
  parseScoreInput,
  rankLabel,
  scoreParts,
  slugify,
  wallToIso,
} from "@/lib/challenges/format";
import { awardWinners } from "@/lib/challenges/awards";
import { CHALLENGE_PRESETS, UNITS_FOR, defaultDirection, presetFields } from "@/lib/challenges/presets";
import { achievements, personalBests } from "@/lib/challenges/achievements";
import { badgeFor, cardFromResult, challengeUrl, detailLine, eventFacts, headlineOptions, initials, resultCaption, shortPrize } from "@/lib/challenges/share";
import type { ProfileHistoryItem, ResultData } from "@/lib/challenges/types";

const reps = { metric: "reps", unit: "reps", scoring: "best", direction: "higher" } as const;

describe("scores", () => {
  it("formats every kind of score", () => {
    expect(formatScore(18, reps)).toBe("18 reps");
    expect(formatScore(1, reps)).toBe("1 rep");
    expect(formatScore(405, { metric: "weight", unit: "lb", scoring: "best" })).toBe("405 lb");
    expect(formatScore(102.06, { metric: "weight", unit: "kg", scoring: "best" })).toBe("102.1 kg");
    expect(formatScore(1.523, { metric: "weight", unit: "lb", scoring: "bodyweight_ratio" })).toBe("1.52× bodyweight");
    expect(formatScore(62.3, { metric: "time", unit: "s", scoring: "best" })).toBe("1:02.3");
    expect(formatScore(40, { metric: "time", unit: "s", scoring: "best" })).toBe("40s");
    expect(formatScore(42.35, { metric: "time", unit: "s", scoring: "best" })).toBe("42.35s");
    expect(formatScore(3723, { metric: "time", unit: "s", scoring: "best" })).toBe("1:02:03");
    expect(formatScore(null, reps)).toBe("–");
    expect(scoreParts(18, reps)).toEqual({ value: "18", unit: "reps" });
  });

  it("reads what a judge types", () => {
    expect(parseScoreInput("18", "reps")).toBe(18);
    expect(parseScoreInput("18.5", "reps")).toBeNull();
    expect(parseScoreInput("-1", "reps")).toBeNull();
    expect(parseScoreInput("1:02.5", "time")).toBe(62.5);
    expect(parseScoreInput("1:00:00", "time")).toBe(3600);
    expect(parseScoreInput("102,5", "weight")).toBe(102.5);
    expect(parseScoreInput("", "weight")).toBeNull();
  });

  it("ranks, ordinals, loads and gaps", () => {
    expect(ordinal(1)).toBe("1st");
    expect(ordinal(2)).toBe("2nd");
    expect(ordinal(3)).toBe("3rd");
    expect(ordinal(11)).toBe("11th");
    expect(ordinal(22)).toBe("22nd");
    expect(ordinal(113)).toBe("113th");
    expect(rankLabel(2, true)).toBe("T2");
    expect(rankLabel(2, false)).toBe("2");
    expect(loadText(225, "lb")).toBe("225 lb (102.1 kg)");
    expect(gapText(16, 18, reps, "Cal")).toBe("3 more reps to pass Cal");
    expect(gapText(18, 18, reps, "Cal")).toBe("Tied with Cal");
    expect(objectiveText({ activity: "Dead Hang", metric: "time", direction: "higher", scoring: "best", unit: "s" })).toBe("Longest time wins.");
    expect(countdownText(90_061_000)).toBe("1d 1h");
    expect(countdownText(65_000)).toBe("1:05");
    expect(slugify("Winnipeg 225 Bench Press Challenge!")).toBe("winnipeg-225-bench-press-challenge");
    expect(slugify("Crème Brûlée Deadlift")).toBe("creme-brulee-deadlift");
  });

  it("converts the event's wall clock to an instant and back (Manitoba stays UTC-5 after Nov 1, 2026)", () => {
    // Before Nov 1, 2026: CDT (UTC-5). After: Manitoba kept UTC-5 (browsers' tz data).
    const iso = wallToIso("2026-10-15T10:00", "America/Winnipeg")!;
    expect(iso).toBe("2026-10-15T15:00:00.000Z");
    expect(isoToWall(iso, "America/Winnipeg")).toBe("2026-10-15T10:00");
    // Manitoba kept UTC-5 when the clocks would have fallen back (AGENTS.md)
    expect(wallToIso("2026-12-12T10:00", "America/Winnipeg")).toBe("2026-12-12T15:00:00.000Z");
    for (const tz of ["America/Edmonton", "America/Toronto", "America/Vancouver"]) {
      const at = wallToIso("2026-12-12T10:00", tz)!;
      expect(isoToWall(at, tz)).toBe("2026-12-12T10:00");
    }
  });
});

describe("prizes follow ties exactly like challenge_finalize", () => {
  const rows = [
    { id: "a", rank: 1, division_rank: 1, division_id: "open" },
    { id: "b", rank: 1, division_rank: 1, division_id: "women" },
    { id: "c", rank: 3, division_rank: 2, division_id: "open" },
    { id: "d", rank: 4, division_rank: 3, division_id: "open" },
  ];
  it("a tie for 1st shares the 1st and 2nd prizes", () => {
    expect(awardWinners(rows, { id: "p1", place: 1, division_id: null })).toEqual([
      { id: "a", share: 0.5 },
      { id: "b", share: 0.5 },
    ]);
    expect(awardWinners(rows, { id: "p2", place: 2, division_id: null })).toEqual([
      { id: "a", share: 0.5 },
      { id: "b", share: 0.5 },
    ]);
    expect(awardWinners(rows, { id: "p3", place: 3, division_id: null })).toEqual([{ id: "c", share: 1 }]);
  });
  it("a division prize ranks within the division", () => {
    expect(awardWinners(rows, { id: "o2", place: 2, division_id: "open" })).toEqual([{ id: "c", share: 1 }]);
    expect(awardWinners(rows, { id: "w2", place: 2, division_id: "women" })).toEqual([]);
  });
});

describe("presets", () => {
  it("every preset is consistent: unit fits the metric, ratio only for weight, rules for every real event", () => {
    for (const p of CHALLENGE_PRESETS) {
      expect(UNITS_FOR[p.metric]).toContain(p.unit);
      if (p.scoring === "bodyweight_ratio") expect(p.metric).toBe("weight");
      if (p.id !== "custom") expect(p.rules.length).toBeGreaterThan(2);
      expect(presetFields(p).acknowledgments[0]).toBe("I'm 18 or older.");
    }
  });
  it("suggests the sensible winner", () => {
    expect(defaultDirection("time", "Dead Hang")).toBe("higher");
    expect(defaultDirection("time", "500 m Row")).toBe("lower");
    expect(defaultDirection("weight")).toBe("higher");
    expect(CHALLENGE_PRESETS.find((p) => p.id === "dead_hang")!.direction).toBe("higher");
    expect(CHALLENGE_PRESETS.find((p) => p.id === "max_lift")!.metric).toBe("weight");
  });
});

const challenge = {
  id: "c1",
  slug: "winnipeg-225",
  title: "Winnipeg 225 Bench Press Challenge",
  tagline: null,
  description: null,
  status: "live",
  activity: "Barbell Bench Press",
  metric: "reps",
  unit: "reps",
  direction: "higher",
  scoring: "best",
  attempts_allowed: 1,
  load_value: 225,
  load_unit: "lb",
  time_cap_seconds: null,
  objective: null,
  equipment: null,
  judging_standard: null,
  rules: [],
  eligibility: null,
  safety: null,
  how_it_works: null,
  acknowledgments: [],
  min_age: 18,
  reg_fields: {},
  tiebreak: "bodyweight_lower",
  tiebreak_note: null,
  starts_at: "2026-12-12T16:00:00.000Z",
  ends_at: null,
  timezone: "America/Winnipeg",
  registration_closes_at: null,
  location_name: "Gym",
  location_address: null,
  city: "Winnipeg",
  max_participants: null,
  entry_fee: "Free",
  self_registration: true,
  registration_open: true,
  cover_path: null,
  published_at: null,
  final: false,
  finalized_at: null,
  is_template: false,
} as const;

function result(over: Partial<ResultData> = {}): ResultData {
  return {
    challenge: { ...challenge } as unknown as ResultData["challenge"],
    version: 1,
    athlete: { bib: 7, name: "Jared", handle: "jared", listed: true, photo: null, division_id: null, instagram: null, is_me: false, claimed: false },
    division: "Open",
    status: "checked_in",
    rank: 2,
    division_rank: 2,
    tied: false,
    score: 18,
    attempts: [{ n: 1, v: 18, r: "valid" }],
    ranked: 47,
    division_ranked: 47,
    divisions: 1,
    leader: { name: "Bea", score: 20 },
    above: { name: "Bea", score: 20, rank: 1 },
    final: false,
    won: [],
    ...over,
  };
}

describe("share cards and captions", () => {
  it("a live rank is labelled live with its time, never final", () => {
    const card = cardFromResult(result(), { now: new Date("2026-12-12T19:42:00Z") });
    expect(card.kind).toBe("result");
    expect(card.badge.live).toBe(true);
    expect(card.badge.text).toBe("LIVE RANK · DEC 12, 2:42 PM");
    expect(card.rank).toEqual({ label: "#2", of: 47, division: null });
    expect(card.score).toEqual({ value: "18", unit: "reps" });
    expect(card.qrUrl).toBe("https://jfeffect.com/challenges/winnipeg-225?ref=jared&src=qr");
    expect(card.gold).toBe(false);
  });
  it("a final win is gold and says champion", () => {
    const r = result({ final: true, rank: 1, above: null });
    expect(headlineOptions({ ...r })[0]).toBe("CHAMPION");
    expect(cardFromResult(r).gold).toBe(true);
    expect(cardFromResult(r).badge).toEqual({ text: "FINAL RESULT", live: false });
    expect(headlineOptions({ ...r, tied: true })[0]).toBe("CO-CHAMPION");
    expect(headlineOptions({ ...r, rank: 3 })[0]).toBe("PODIUM FINISH");
  });
  it("someone who hasn't competed gets an I'm-in card, no score", () => {
    const card = cardFromResult(result({ rank: null, score: null }));
    expect(card.kind).toBe("entered");
    expect(card.score).toBeUndefined();
    expect(card.badge.text).toBe("BIB #7");
  });
  it("captions say live or final honestly, with one link", () => {
    const live = resultCaption(result(), "https://x");
    expect(live).toContain("18 reps with 225 lb at the Winnipeg 225 Bench Press Challenge. Currently #2 of 47.");
    expect(live).toContain("Think you can beat me?");
    const fin = resultCaption(result({ final: true, rank: 2 }), "https://x");
    expect(fin).toContain("Finished 2nd of 47.");
    expect(resultCaption(result({ final: true, rank: 1 }), "https://x")).toContain("Won it.");
    expect(resultCaption(result({ rank: null, score: null }), "https://x")).toContain("I'm in the Winnipeg 225 Bench Press Challenge on Saturday, December 12.");
  });
  it("links, details and facts", () => {
    expect(challengeUrl("winnipeg-225")).toBe("https://jfeffect.com/challenges/winnipeg-225");
    expect(challengeUrl("winnipeg-225", { handle: "jared", ref: "jared" })).toBe("https://jfeffect.com/challenges/winnipeg-225/jared?ref=jared");
    expect(detailLine(challenge)).toBe("BENCH PRESS · 225 LB · ONE SET");
    expect(eventFacts(challenge, "$225 prize")).toEqual(["SAT DEC 12", "WINNIPEG", "$225 PRIZE"]);
    expect(shortPrize("$225 CAD + the winner's trophy")).toBe("$225 prize");
    expect(badgeFor(true, new Date())).toEqual({ text: "FINAL RESULT", live: false });
    expect(initials("Jared McIntyre")).toBe("JM");
    expect(initials("Bea")).toBe("B");
  });
});

describe("achievements come from real results only", () => {
  const h = (over: Partial<ProfileHistoryItem>): ProfileHistoryItem => ({
    slug: "s",
    title: "T",
    status: "completed",
    starts_at: "2026-01-01",
    activity: "Barbell Bench Press",
    city: null,
    final: true,
    bib: 1,
    show_name: true,
    entry_status: "checked_in",
    division: null,
    rank: 5,
    score: 12,
    field: 30,
    won: [],
    metric: "reps",
    unit: "reps",
    direction: "higher",
    scoring: "best",
    load_value: 225,
    load_unit: "lb",
    ...over,
  });
  it("champion, podium, personal best", () => {
    const history = [h({ slug: "b", starts_at: "2026-06-01", rank: 1, score: 18, title: "Second" }), h({ slug: "a", starts_at: "2026-01-01", rank: 3, score: 14, title: "First" })];
    const ids = achievements(history).map((a) => a.id);
    expect(ids).toContain("champion");
    expect(ids).toContain("podium");
    expect(ids).toContain("pb-b");
    expect(personalBests(history)[0].item.score).toBe(18);
  });
  it("a registration with no score earns nothing", () => {
    expect(achievements([h({ rank: null, score: null })])).toEqual([]);
  });
  it("a live rank of 1 isn't a win", () => {
    expect(achievements([h({ final: false, rank: 1, status: "live" })]).map((a) => a.id)).not.toContain("champion");
  });
});
