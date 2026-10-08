import { describe, expect, it } from "vitest";
import {
  formatDots,
  formatLoad,
  formatMultiple,
  gapToTop10,
  meStatus,
  normalizeRow,
  pickBoard,
  totalClub,
  type StrengthRow,
} from "@/lib/strength-board";

const row = (over: Partial<StrengthRow>): StrengthRow =>
  normalizeRow({
    client_id: over.client_id ?? "x",
    display_name: "A",
    sex: "male",
    lift: "total",
    kg: 500,
    reps: null,
    lifted_at: "2026-09-01T12:00:00Z",
    bw_kg: 80,
    bw_multiple: 6.25,
    dots: 350,
    abs_rank: 1,
    p4p_rank: 1,
    abs_count: 12,
    p4p_count: 12,
    is_me: false,
    ...over,
  });

describe("formatting", () => {
  it("shows loads in the athlete's unit", () => {
    expect(formatLoad(250, "kg")).toBe("250 kg");
    expect(formatLoad(250, "lb")).toBe("551 lb");
    expect(formatLoad(52.16, "kg")).toBe("52.2 kg");
    expect(formatLoad(52.16, "lb")).toBe("115 lb");
    expect(formatLoad(0, "lb")).toBe("0 lb");
  });

  it("formats x bodyweight and DOTS", () => {
    expect(formatMultiple(9.4142)).toBe("9.41×");
    expect(formatMultiple(null)).toBeNull();
    expect(formatDots(496.1)).toBe("496");
    expect(formatDots(null)).toBe("—");
  });

  it("names the totals club", () => {
    expect(totalClub(765)).toBe("1500 CLUB"); // 1,686 lb
    expect(totalClub(665)).toBe("1200 CLUB"); // 1,466 lb
    expect(totalClub(460)).toBe("1000 LB CLUB"); // 1,014 lb
    expect(totalClub(250)).toBeNull();
  });
});

describe("pickBoard", () => {
  const rows = [
    row({ client_id: "a", abs_rank: 2, p4p_rank: 1 }),
    row({ client_id: "b", abs_rank: 1, p4p_rank: 2 }),
    row({ client_id: "c", sex: "female", abs_rank: 1, p4p_rank: 3 }),
    row({ client_id: "me", is_me: true, abs_rank: 14, p4p_rank: 15 }),
    row({ client_id: "a", lift: "bench", abs_rank: 1, p4p_rank: 1 }),
  ];

  it("absolute boards are split by division and sorted", () => {
    const { top, me } = pickBoard(rows, "absolute", "total", "male");
    expect(top.map((r) => r.client_id)).toEqual(["b", "a"]);
    expect(me?.client_id).toBe("me");
  });

  it("pound for pound is one board for everyone", () => {
    const { top } = pickBoard(rows, "p4p", "total", "male");
    expect(top.map((r) => r.client_id)).toEqual(["a", "b", "c"]);
  });

  it("keeps lifts separate", () => {
    expect(pickBoard(rows, "absolute", "bench", "male").top.map((r) => r.client_id)).toEqual(["a"]);
  });
});

describe("gapToTop10", () => {
  const top = Array.from({ length: 10 }, (_, i) => row({ client_id: `t${i}`, abs_rank: i + 1, p4p_rank: i + 1, kg: 600 - i * 10, dots: 400 - i * 5 }));
  // #10 lifted 510 kg / 355 DOTS.

  it("absolute: the weight needed to pass #10, rounded up to a plate", () => {
    const me = row({ is_me: true, abs_rank: 12, kg: 503 });
    expect(gapToTop10(me, top, "absolute", "kg")).toBe(7.5); // 7 kg short → 7.5 kg
  });

  it("matching #10 still needs one more plate (ties go to whoever lifted it first)", () => {
    const me = row({ is_me: true, abs_rank: 11, kg: 510 });
    expect(gapToTop10(me, top, "absolute", "kg")).toBe(2.5);
    expect(gapToTop10(me, top, "absolute", "lb")).toBe(5);
  });

  it("pound for pound: extra weight at the same bodyweight", () => {
    const me = row({ is_me: true, p4p_rank: 13, kg: 500, dots: 340 });
    // needs 500 × 355/340 − 500 = 22.06 kg → 22.5 kg, or 48.6 lb → 50 lb
    expect(gapToTop10(me, top, "p4p", "kg")).toBe(22.5);
    expect(gapToTop10(me, top, "p4p", "lb")).toBe(50);
  });

  it("nothing to chase when already in the top 10 or the board isn't full", () => {
    expect(gapToTop10(row({ is_me: true, abs_rank: 4 }), top, "absolute", "kg")).toBeNull();
    expect(gapToTop10(row({ is_me: true, abs_rank: 6 }), top.slice(0, 5), "absolute", "kg")).toBeNull();
    expect(gapToTop10(null, top, "absolute", "kg")).toBeNull();
  });
});

describe("meStatus", () => {
  it("explains what to do next", () => {
    expect(meStatus(null, "absolute", "squat")).toEqual({ kind: "no-lift" });
    expect(meStatus(null, "absolute", "total")).toEqual({ kind: "no-total" });
    expect(meStatus(row({ is_me: true, sex: null, abs_rank: null, p4p_rank: null }), "p4p", "squat")).toEqual({ kind: "no-division" });
    expect(meStatus(row({ is_me: true, p4p_rank: null }), "p4p", "squat")).toEqual({ kind: "no-bodyweight" });
    expect(meStatus(row({ is_me: true, abs_rank: 3, abs_count: 9 }), "absolute", "squat")).toEqual({ kind: "ranked", rank: 3, count: 9 });
  });
});
