import { describe, expect, it } from "vitest";
import {
  activityText,
  gapText,
  hasBoard,
  isFresh,
  isProvisional,
  mergePages,
  placeOf,
  primaryAction,
  sharedOf,
  standingLine,
  type BoardPage,
  type RankRow,
} from "@/lib/challenges/board";

const reps = { measure: "reps" as const, unit: "reps" as const, relative: false };
const time = { measure: "time" as const, unit: "s" as const, relative: false };

function row(code: string, over: Partial<RankRow> = {}): RankRow {
  return {
    code,
    name: code.toUpperCase(),
    bib: 1,
    photo: null,
    handle: null,
    division_id: null,
    score: 10,
    rank: 1,
    rank_div: 1,
    tied: false,
    tied_div: false,
    valid: 1,
    attempts: 1,
    at: null,
    ...over,
  };
}

function page(offset: number, rows: RankRow[], total = 100): BoardPage {
  return {
    challenge_id: "c",
    status: "live",
    final: false,
    as_of: "",
    version: 1,
    registered: total,
    total,
    offset,
    limit: 50,
    rows,
    recent: [],
  };
}

const base = {
  status: "upcoming" as const,
  final: false,
  self_registration: true,
  max_participants: null,
  registered: 3,
  my_role: null,
};

describe("primaryAction", () => {
  it("offers Register while sign-up is open and the viewer has no entry", () => {
    expect(primaryAction(base, null).kind).toBe("register");
  });
  it("uses the database's registration window when it has one", () => {
    expect(primaryAction({ ...base, registration_open: false }, null).kind).toBe("none");
  });
  it("finds my ranking once the board is up and I have an entry", () => {
    const a = primaryAction({ ...base, status: "live" }, "abc");
    expect(a).toEqual({ kind: "find_me", label: "Find my ranking", code: "abc" });
  });
  it("says you're registered before the board opens", () => {
    expect(primaryAction(base, "abc").kind).toBe("my_entry");
  });
  it("points at the rankings when sign-up is closed", () => {
    expect(primaryAction({ ...base, status: "live", self_registration: false }, null).kind).toBe(
      "rankings",
    );
  });
  it("points at final results once it's over", () => {
    expect(primaryAction({ ...base, status: "completed", final: true }, null).kind).toBe("final");
  });
  it("offers nothing on a cancelled event", () => {
    expect(primaryAction({ ...base, status: "cancelled" }, "abc").kind).toBe("none");
  });
  it("a full event stops offering Register", () => {
    expect(primaryAction({ ...base, max_participants: 3 }, null).kind).toBe("none");
  });
});

describe("hasBoard / isProvisional", () => {
  it("shows a draft's practice board only to staff", () => {
    expect(hasBoard({ status: "draft" })).toBe(false);
    expect(hasBoard({ status: "draft", my_role: "judge" })).toBe(true);
    expect(hasBoard({ status: "upcoming" })).toBe(false);
    expect(hasBoard({ status: "live" })).toBe(true);
    expect(hasBoard({ status: "archived" })).toBe(true);
  });
  it("is provisional until confirmed", () => {
    expect(isProvisional({ status: "live", final: false })).toBe(true);
    expect(isProvisional({ status: "verifying", final: false })).toBe(true);
    expect(isProvisional({ status: "completed", final: true })).toBe(false);
  });
});

describe("mergePages", () => {
  it("keeps board order and shows each athlete once across page edges", () => {
    const merged = mergePages([
      page(0, [row("a"), row("b")]),
      page(2, [row("b"), row("c")]),
      null,
    ]);
    expect(merged.map((r) => r.code)).toEqual(["a", "b", "c"]);
  });
});

describe("placeOf / sharedOf", () => {
  it("reads the division's place when a division is on screen", () => {
    const r = row("a", { rank: 9, rank_div: 2, tied: false, tied_div: true });
    expect(placeOf(r, null)).toBe(9);
    expect(placeOf(r, "d1")).toBe(2);
    expect(sharedOf(r, "d1")).toBe(true);
  });
  it("prefers the place the database worked out for the board asked for", () => {
    expect(placeOf(row("a", { rank: 9, place: 4 }), null)).toBe(4);
  });
});

describe("standingLine", () => {
  const c = { ...reps, direction: "higher" as const };
  it("says leading for first", () => {
    expect(standingLine(row("a"), 1, false, null, c)).toBe("Leading");
    expect(standingLine(row("a"), 1, true, null, c)).toBe("Tied for 1st");
  });
  it("names the gap to the next place up", () => {
    const next = { code: "k", name: "Kim L.", score: 48, place: 2 };
    expect(standingLine(row("a", { score: 45 }), 3, false, next, c)).toBe(
      "3 reps behind 2nd (Kim L.)",
    );
  });
  it("combines a shared place with the gap", () => {
    const next = { code: "k", name: "Kim", score: 11, place: 1 };
    expect(standingLine(row("a", { score: 10 }), 2, true, next, c)).toBe(
      "Tied for 2nd · 1 rep behind 1st (Kim)",
    );
  });
  it("is empty with no score", () => {
    expect(standingLine(row("a", { score: null }), null, false, null, c)).toBeNull();
  });
});

describe("gapText", () => {
  it("reads in the challenge's unit", () => {
    expect(gapText(48, 45, reps)).toBe("3 reps");
    expect(gapText(80.2, 83.4, time)).toBe("3.2 sec");
    expect(gapText(2.25, 2, { measure: "weight", unit: "lb", relative: true })).toBe(
      "0.25× bodyweight",
    );
  });
});

describe("isFresh", () => {
  it("drops a judge's count that stopped updating", () => {
    const now = Date.parse("2026-11-15T19:00:00Z");
    expect(isFresh({ updated_at: "2026-11-15T18:55:00Z" }, now)).toBe(true);
    expect(isFresh({ updated_at: "2026-11-15T18:40:00Z" }, now)).toBe(false);
    expect(isFresh(null, now)).toBe(false);
  });
});

describe("activityText", () => {
  const a = {
    at: "",
    entity: "attempt",
    name: "Jared M.",
    value: 18,
    valid: true,
    to: null,
    change_status: null,
    tiebreak: false,
    reason: null,
    source: null,
    by: null,
  };
  it("describes each kind of change", () => {
    expect(activityText({ ...a, action: "record" }, reps)).toBe("Score: 18 reps · Jared M.");
    expect(activityText({ ...a, action: "record", valid: false }, reps)).toBe(
      "Score: no valid score · Jared M.",
    );
    expect(activityText({ ...a, action: "record", tiebreak: true }, reps)).toBe(
      "Run-off: 18 reps · Jared M.",
    );
    expect(activityText({ ...a, action: "register", source: "self" }, reps)).toBe(
      "Signed up · Jared M.",
    );
    expect(activityText({ ...a, action: "update", change_status: "checked_in" }, reps)).toBe(
      "Checked in · Jared M.",
    );
    expect(activityText({ ...a, action: "status", name: null, to: "live" }, reps)).toBe(
      "Event started",
    );
    expect(activityText({ ...a, action: "correct", value: 17, reason: "Bounce" }, reps)).toBe(
      "Score corrected to 17 reps (Bounce) · Jared M.",
    );
  });
});
