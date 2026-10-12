import { describe, expect, it } from "vitest";
import { boostLine, boostProgress, monthClockLabel, rankedRows } from "@/lib/league-standing";
import { defaultDivision } from "@/components/portal/strength-board";
import type { StrengthRow } from "@/lib/strength-board";

const boost = (o: Record<string, unknown>) => ({
  qualified: true, is_final_week: true, month_closed: false, boost_status: "chasing", needed_workouts: 2, projected_match: 40, ...o,
}) as any;

describe("Final Week Boost, in one line", () => {
  it("only in the final week, only for ranked athletes who can still unlock it", () => {
    expect(boostLine(boost({}))).toEqual({ tone: "chasing", text: "2 workouts to unlock your Boost" });
    expect(boostLine(boost({ needed_workouts: 1 }))?.text).toBe("1 workout to unlock your Boost");
    expect(boostLine(boost({ boost_status: "ready" }))).toEqual({ tone: "ready", text: "Boost unlocked · +40 pts" });
    expect(boostLine(boost({ boost_status: "ready", projected_match: 0 }))?.text).toBe("Boost unlocked · 90%+ done");
    expect(boostLine(boost({ is_final_week: false }))).toBeNull();
    expect(boostLine(boost({ month_closed: true }))).toBeNull();
    expect(boostLine(boost({ boost_status: "out" }))).toBeNull();
    expect(boostLine(boost({ qualified: false }))).toBeNull();
    expect(boostLine(null)).toBeNull();
  });
  it("before the final week: done vs the 90% target (live: 8 of 23 prescribed → 21 needed)", () => {
    expect(boostProgress({ boost_status: "chasing", eligible_workouts: 23, completed_eligible: 8 } as any)).toEqual({ done: 8, target: 21, eligible: 23, pct: 38 });
    expect(boostProgress({ boost_status: "none", eligible_workouts: 0, completed_eligible: 0 } as any)).toBeNull();
    expect(boostProgress({ boost_status: "out", eligible_workouts: 20, completed_eligible: 3 } as any)).toBeNull();
  });
});

describe("the month clock (league timezone)", () => {
  it("days left, the final week, the last day", () => {
    expect(monthClockLabel(false, new Date("2026-10-12T18:00:00Z"))).toBe("20 days left");
    expect(monthClockLabel(true, new Date("2026-10-27T18:00:00Z"))).toBe("Final 5 days");
    expect(monthClockLabel(true, new Date("2026-10-31T18:00:00Z"))).toBe("Last day");
  });
});

describe("ranked rows", () => {
  it("qualified only, best first", () => {
    const rows = [
      { client_id: "b", display_name: "B", rank: 2, total_points: 5, qualified: true, is_me: false },
      { client_id: "x", display_name: "X", rank: null, total_points: 75, qualified: false, is_me: false },
      { client_id: "a", display_name: "A", rank: 1, total_points: 9, qualified: true, is_me: false },
    ];
    expect(rankedRows(rows).map((r) => r.client_id)).toEqual(["a", "b"]);
  });
});

describe("Hall of Strength opens on your division", () => {
  const r = (o: Partial<StrengthRow>) => ({ is_me: false, sex: null, lift: "total", ...o }) as StrengthRow;
  it("your sex from any of your rows, else All (never Men by default)", () => {
    expect(defaultDivision([r({ is_me: true, sex: "female", lift: "squat" }), r({ sex: "male" })])).toBe("female");
    expect(defaultDivision([r({ is_me: true, sex: null }), r({ sex: "male" })])).toBe("all");
    expect(defaultDivision([])).toBe("all");
  });
});
