import { describe, expect, it } from "vitest";
import {
  formatLoad,
  formatMultiple,
  gapToTop10,
  meStatus,
  meetHistory,
  normalizeMeetRow,
  normalizeRow,
  pickBoard,
  totalClub,
  type StrengthRow,
} from "@/lib/strength-board";

const row = (over: Partial<StrengthRow>): StrengthRow => ({
  ...normalizeRow({
    client_id: over.client_id ?? "x",
    display_name: "A",
    sex: "male",
    lift: "total",
    kg: 500,
    reps: null,
    lifted_at: "2026-09-01T12:00:00Z",
    bw_kg: 80,
    bw_multiple: 6.25,
    abs_rank: 1,
    p4p_rank: 1,
    all_rank: 1,
    abs_count: 12,
    p4p_count: 12,
    all_count: 14,
    is_me: false,
  }),
  ...over,
  key: over.key ?? over.client_id ?? "x",
});

describe("formatting", () => {
  it("shows loads in the athlete's unit", () => {
    expect(formatLoad(250, "kg")).toBe("250 kg");
    expect(formatLoad(250, "lb")).toBe("551 lb");
    expect(formatLoad(52.16, "kg")).toBe("52.2 kg");
    expect(formatLoad(52.16, "lb")).toBe("115 lb");
    expect(formatLoad(0, "lb")).toBe("0 lb");
  });

  it("formats x bodyweight", () => {
    expect(formatMultiple(9.4142)).toBe("9.41×");
    expect(formatMultiple(null)).toBeNull();
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
    row({ client_id: "a", abs_rank: 2, all_rank: 2, p4p_rank: 1 }),
    row({ client_id: "b", abs_rank: 1, all_rank: 1, p4p_rank: 2 }),
    row({ client_id: "c", sex: "female", abs_rank: 1, all_rank: 3, p4p_rank: 3 }),
    row({ client_id: "n", sex: null, abs_rank: null, all_rank: 4, p4p_rank: null }),
    row({ client_id: "me", is_me: true, abs_rank: 14, all_rank: 16, p4p_rank: 15 }),
    row({ client_id: "a", lift: "bench", abs_rank: 1, all_rank: 1, p4p_rank: 1 }),
  ];

  it("absolute All ranks everyone, sex set or not", () => {
    const { top, me, count } = pickBoard(rows, "absolute", "total", "all");
    expect(top.map((r) => r.client_id)).toEqual(["b", "a", "c", "n"]);
    expect(me?.client_id).toBe("me");
    expect(count).toBe(14);
  });

  it("Men / Women use the division ranking", () => {
    expect(pickBoard(rows, "absolute", "total", "male").top.map((r) => r.client_id)).toEqual(["b", "a"]);
    expect(pickBoard(rows, "absolute", "total", "female").top.map((r) => r.client_id)).toEqual(["c"]);
  });

  it("pound for pound is one board for everyone with a bodyweight", () => {
    const { top } = pickBoard(rows, "p4p", "total", "female");
    expect(top.map((r) => r.client_id)).toEqual(["a", "b", "c"]);
  });

  it("keeps lifts separate", () => {
    expect(pickBoard(rows, "absolute", "bench", "all").top.map((r) => r.client_id)).toEqual(["a"]);
  });

  it("meet athletes can have a different row per board", () => {
    const meets = [
      row({ key: "m1", client_id: null, kg: 240, all_rank: 1, abs_rank: 1, p4p_rank: null }),
      row({ key: "m1", client_id: null, kg: 230, all_rank: null, abs_rank: null, p4p_rank: 1, bw_multiple: 4.42 }),
    ];
    expect(pickBoard(meets, "absolute", "total", "all").top.map((r) => r.kg)).toEqual([240]);
    expect(pickBoard(meets, "p4p", "total", "all").top.map((r) => r.kg)).toEqual([230]);
  });

  it("can show everyone, not just the top 10", () => {
    const many = Array.from({ length: 14 }, (_, i) => row({ client_id: `t${i}`, all_rank: i + 1 }));
    expect(pickBoard(many, "absolute", "total", "all").top).toHaveLength(10);
    expect(pickBoard(many, "absolute", "total", "all", Infinity).top).toHaveLength(14);
  });
});

describe("gapToTop10", () => {
  // #10 lifted 510 kg at 80 kg bodyweight (6.375x).
  const top = Array.from({ length: 10 }, (_, i) =>
    row({ client_id: `t${i}`, all_rank: i + 1, abs_rank: i + 1, p4p_rank: i + 1, kg: 600 - i * 10, bw_kg: 80 }),
  );

  it("absolute: the weight needed to pass #10, rounded up to a plate", () => {
    const me = row({ is_me: true, all_rank: 12, kg: 503 });
    expect(gapToTop10(me, top, "absolute", "all", "kg")).toBe(7.5); // 7 kg short → 7.5 kg
  });

  it("matching #10 still needs one more plate (ties go to whoever lifted it first)", () => {
    const me = row({ is_me: true, all_rank: 11, kg: 510 });
    expect(gapToTop10(me, top, "absolute", "all", "kg")).toBe(2.5);
    expect(gapToTop10(me, top, "absolute", "all", "lb")).toBe(5);
  });

  it("pound for pound: extra weight at my bodyweight to match #10's x bodyweight", () => {
    const me = row({ is_me: true, p4p_rank: 13, kg: 450, bw_kg: 75 });
    // 6.375 × 75 = 478.1 kg → +28.1 kg → 30 kg, or 62.0 lb → 65 lb
    expect(gapToTop10(me, top, "p4p", "all", "kg")).toBe(30);
    expect(gapToTop10(me, top, "p4p", "all", "lb")).toBe(65);
  });

  it("nothing to chase when already in the top 10 or the board isn't full", () => {
    expect(gapToTop10(row({ is_me: true, all_rank: 4 }), top, "absolute", "all", "kg")).toBeNull();
    expect(gapToTop10(row({ is_me: true, all_rank: 16 }), top.slice(0, 5), "absolute", "all", "kg")).toBeNull();
    expect(gapToTop10(null, top, "absolute", "all", "kg")).toBeNull();
  });
});

describe("meStatus", () => {
  it("explains what to do next", () => {
    expect(meStatus(null, "absolute", "squat", "all")).toEqual({ kind: "no-lift" });
    expect(meStatus(null, "absolute", "total", "all")).toEqual({ kind: "no-total" });
    const noSex = row({ is_me: true, sex: null, abs_rank: null, all_rank: 7, all_count: 20, p4p_rank: null });
    expect(meStatus(noSex, "absolute", "squat", "all")).toEqual({ kind: "ranked", rank: 7, count: 20 });
    expect(meStatus(noSex, "absolute", "squat", "male")).toEqual({ kind: "no-division" });
    expect(meStatus(noSex, "p4p", "squat", "all")).toEqual({ kind: "no-bodyweight" });
    expect(meStatus(row({ is_me: true }), "absolute", "squat", "female")).toEqual({ kind: "other-division" });
    expect(meStatus(row({ is_me: true, abs_rank: 3, abs_count: 9 }), "absolute", "squat", "male")).toEqual({ kind: "ranked", rank: 3, count: 9 });
  });
});

describe("meet history", () => {
  const meet = (athlete_id: string, lift: string, meets: number, first: string) =>
    normalizeMeetRow({ athlete_id, client_id: null, display_name: athlete_id, lift, kg: 500, meet_date: "2024-03-01",
      meet_name: "Nationals", athlete_meets: meets, first_meet: first, all_rank: 1, competed_as: "Nicole Carta", is_alumni: true });

  it("keys meet rows by athlete and keeps the meet details", () => {
    const r = meet("a1", "total", 3, "2019-05-01");
    expect(r.key).toBe("a1");
    expect(r.reps).toBeNull();
    expect(r.meet?.competed_as).toBe("Nicole Carta");
    expect(r.meet?.is_alumni).toBe(true);
  });

  it("counts athletes and meets once each", () => {
    const rows = [meet("a1", "total", 3, "2019-05-01"), meet("a1", "squat", 3, "2019-05-01"), meet("a2", "bench", 2, "2021-01-01")];
    expect(meetHistory(rows)).toEqual({ athletes: 2, meets: 5, since: 2019 });
    expect(meetHistory([])).toEqual({ athletes: 0, meets: 0, since: null });
  });
});
