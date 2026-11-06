import { describe, expect, it } from "vitest";
import {
  achievementsFor,
  boardMoments,
  boardRows,
  defaultBoardName,
  formatDuration,
  formatScore,
  gapToFirst,
  parseScoreInput,
  personalBests,
  placeLabel,
  publishMissing,
  rankBadge,
  roleCan,
  selfSignupOpen,
  shareCaption,
  slugify,
  statusActions,
  type AthleteEntry,
  type BoardRow,
} from "@/lib/challenges/model";
import { rankLine, splitTitle } from "@/lib/challenges/cards";

const reps = { measure: "reps" as const, unit: "reps" as const, relative: false };
const time = { measure: "time" as const, unit: "s" as const, relative: false };
const lb = { measure: "weight" as const, unit: "lb" as const, relative: false };

function row(p: Partial<BoardRow> & { code: string; rank: number }): BoardRow {
  return {
    name: p.code,
    photo: null,
    handle: null,
    division_id: null,
    score: 10,
    rank_div: p.rank,
    tied: false,
    tied_div: false,
    valid: 1,
    attempts: 1,
    at: null,
    ...p,
  };
}

describe("scores", () => {
  it("formats each measure", () => {
    expect(formatScore(18, reps)).toBe("18 reps");
    expect(formatScore(1, reps)).toBe("1 rep");
    expect(formatScore(405, lb)).toBe("405 lb");
    expect(formatScore(83.4, time)).toBe("1:23.4");
    expect(formatScore(9.25, time)).toBe("9.25 sec");
    expect(formatScore(2.104, { ...lb, relative: true })).toBe("2.1× bodyweight");
    expect(formatScore(null, reps)).toBe("No score");
  });

  it("formats long durations", () => {
    expect(formatDuration(3725)).toBe("1:02:05");
    expect(formatDuration(65)).toBe("1:05");
  });

  it("reads what a judge types", () => {
    expect(parseScoreInput("18", reps)).toBe(18);
    expect(parseScoreInput("18.5", reps)).toBeNull();
    expect(parseScoreInput("1:23.4", time)).toBe(83.4);
    expect(parseScoreInput("1:02:05", time)).toBe(3725);
    expect(parseScoreInput("83,4", time)).toBe(83.4);
    expect(parseScoreInput("", reps)).toBeNull();
    expect(parseScoreInput("abc", lb)).toBeNull();
    expect(parseScoreInput("-5", lb)).toBeNull();
  });

  it("labels places and ties", () => {
    expect(placeLabel(1)).toBe("1st");
    expect(placeLabel(2, true)).toBe("T-2nd");
    expect(placeLabel(11)).toBe("11th");
    expect(placeLabel(23)).toBe("23rd");
    expect(rankBadge(3, true)).toBe("T-3");
    expect(rankBadge(null)).toBe("–");
  });

  it("says how far off first", () => {
    expect(gapToFirst(15, 18, { ...reps, direction: "higher" })).toBe("3 reps off first");
    expect(gapToFirst(18, 18, { ...reps, direction: "higher" })).toBeNull();
    expect(gapToFirst(95.4, 91.2, { ...time, direction: "lower" })).toBe("4.2 off first");
  });
});

describe("boards", () => {
  it("ranks within a division by its own places", () => {
    const rows = [
      row({ code: "a", rank: 1, division_id: "x", rank_div: 1 }),
      row({ code: "b", rank: 2, division_id: "y", rank_div: 1 }),
      row({ code: "c", rank: 3, division_id: "x", rank_div: 2 }),
    ];
    expect(boardRows(rows, "x").map((r) => [r.code, r.place])).toEqual([
      ["a", 1],
      ["c", 2],
    ]);
    expect(boardRows(rows, null).map((r) => r.code)).toEqual(["a", "b", "c"]);
  });

  it("spots a new leader and a move into the top three, never on first load", () => {
    const before = [
      row({ code: "a", rank: 1 }),
      row({ code: "b", rank: 2 }),
      row({ code: "c", rank: 3 }),
      row({ code: "d", rank: 4 }),
    ];
    expect(boardMoments(undefined, before)).toEqual([]);
    const after = [
      row({ code: "d", rank: 1 }),
      row({ code: "a", rank: 2 }),
      row({ code: "b", rank: 3 }),
      row({ code: "c", rank: 4 }),
    ];
    expect(boardMoments(before, after)).toEqual([{ kind: "new_leader", code: "d", name: "d" }]);
    const newcomer = [
      ...before.slice(0, 2),
      row({ code: "e", rank: 3 }),
      row({ code: "c", rank: 4 }),
    ];
    expect(boardMoments(before, newcomer)).toEqual([{ kind: "top_three", code: "e", name: "e" }]);
  });
});

describe("lifecycle", () => {
  it("offers the right moves from each status", () => {
    expect(statusActions("draft").map((a) => a.to)).toEqual(["upcoming", "cancelled"]);
    expect(statusActions("live").map((a) => a.to)).toContain("verifying");
    expect(statusActions("verifying")[0]!.to).toBe("finalize");
    expect(statusActions("completed").map((a) => a.to)).toEqual(["archived", "verifying"]);
  });

  it("knows who can do what", () => {
    expect(roleCan("judge", "judge")).toBe(true);
    expect(roleCan("judge", "manage")).toBe(false);
    expect(roleCan("registration", "judge")).toBe(false);
    expect(roleCan("registration", "register")).toBe(true);
    expect(roleCan("manager", "admin")).toBe(false);
    expect(roleCan(null, "register")).toBe(false);
  });

  it("won't publish without a date, venue and rules", () => {
    expect(publishMissing({ starts_at: null, venue_name: "", rules: [] })).toEqual([
      "a start date and time",
      "a venue",
      "the rules",
    ]);
    expect(
      publishMissing({ starts_at: "2026-11-21T19:00:00Z", venue_name: "Gym", rules: ["x"] }),
    ).toEqual([]);
  });

  it("opens self sign-up only when it should", () => {
    const base = {
      status: "upcoming" as const,
      self_registration: true,
      max_participants: null,
      registered: 0,
    };
    expect(selfSignupOpen(base)).toBe(true);
    expect(selfSignupOpen({ ...base, status: "draft" })).toBe(false);
    expect(selfSignupOpen({ ...base, status: "verifying" })).toBe(false);
    expect(selfSignupOpen({ ...base, self_registration: false })).toBe(false);
    expect(selfSignupOpen({ ...base, max_participants: 10, registered: 10 })).toBe(false);
  });
});

describe("words", () => {
  it("makes links and board names", () => {
    expect(slugify("Winnipeg 225 Bench Press Challenge")).toBe(
      "winnipeg-225-bench-press-challenge",
    );
    expect(slugify("  Café Pull-Up Showdown!! ")).toBe("cafe-pull-up-showdown");
    expect(defaultBoardName("jared mcintyre")).toBe("jared M.");
    expect(defaultBoardName("Cher")).toBe("Cher");
  });

  it("captions a live result as live, a final one as final", () => {
    const c = {
      ...reps,
      title: "Winnipeg 225 Bench Press Challenge",
      load_label: "225 lb",
      city: "Winnipeg",
      final: false,
    };
    expect(
      shareCaption({ name: "Jared", score: 18, rank: 2, tied: false, of: 47 }, c, "https://x"),
    ).toBe(
      "225 lb for 18 reps at the Winnipeg 225 Bench Press Challenge. Currently #2 of 47. Think you can beat me? https://x",
    );
    expect(
      shareCaption(
        { name: "Jared", score: 18, rank: 2, tied: false, of: 47 },
        { ...c, final: true },
        "https://x",
      ),
    ).toContain("Finished 2nd of 47.");
  });

  it("splits a title for the card", () => {
    expect(splitTitle("Winnipeg 225 Bench Press Challenge")).toEqual([
      "WINNIPEG 225",
      "BENCH PRESS CHALLENGE",
    ]);
    expect(splitTitle("Dead Hang")).toEqual(["DEAD HANG", null]);
    expect(rankLine({ kind: "live", rank: 7, tied: false, of: 40 })).toBe("#7 OF 40 RIGHT NOW");
    expect(rankLine({ kind: "winner", rank: 1, tied: false, of: 40 })).toBe("1ST PLACE OF 40");
    expect(rankLine({ kind: "result", rank: 12, tied: true, of: 40 })).toBe("T-12TH OF 40");
  });
});

describe("profile", () => {
  const entry = (p: Partial<AthleteEntry>): AthleteEntry =>
    ({
      id: "1",
      slug: "s",
      title: "T",
      tagline: null,
      status: "completed",
      activity: "Bench",
      measure: "reps",
      direction: "higher",
      unit: "reps",
      aggregate: "best",
      attempts_allowed: 1,
      relative: false,
      load_label: "225 lb",
      objective: null,
      tiebreak: "shared",
      starts_at: null,
      ends_at: null,
      timezone: "America/Winnipeg",
      venue_name: null,
      city: null,
      cover_path: null,
      prize_summary: null,
      entry_fee_label: null,
      is_test: false,
      final: true,
      results_final_at: null,
      started_at: null,
      ended_at: null,
      separate_divisions: false,
      code: "c",
      entry_name: "J",
      entry_status: "checked_in",
      division: null,
      score: 10,
      rank: 5,
      tied: false,
      of: 20,
      ...p,
    }) as AthleteEntry;

  it("only awards what really happened", () => {
    expect(achievementsFor([entry({ rank: 1 })]).map((a) => a.key)).toEqual([
      "winner",
      "podium",
      "competitor",
    ]);
    expect(achievementsFor([entry({ rank: 1, final: false })]).map((a) => a.key)).toEqual([
      "competitor",
    ]);
    expect(achievementsFor([entry({ score: null })])).toEqual([]);
  });

  it("keeps the best per activity and load", () => {
    const bests = personalBests([
      entry({ score: 12, code: "a" }),
      entry({ score: 15, code: "b" }),
      entry({ score: 9, load_label: "315 lb", code: "c" }),
    ]);
    expect(bests.map((b) => [b.label, b.score])).toEqual([
      ["Bench · 225 lb", 15],
      ["Bench · 315 lb", 9],
    ]);
  });
});
