import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TOP, meStatus, normalizeAllRow, normalizeMeetRow, pickBoard, type BoardLift, type BoardMode, type Division } from "@/lib/strength-board";

// Crew → Rankings → Strength runs the same filters over two sources: All-time
// (get_strength_board_all) and Competition (get_strength_board_meets).
const lifts: BoardLift[] = ["total", "squat", "bench", "deadlift"];
const people = Array.from({ length: 14 }, (_, i) => ({ i, sex: i % 3 === 2 ? "female" : "male", me: i === 12 }));

const allRows = people.flatMap(({ i, sex, me }) =>
  lifts.map((lift) =>
    normalizeAllRow({
      person: `p${i}`, client_id: `c${i}`, display_name: `P${i}`, sex, lift, kg: 600 - i * 10, reps: 1,
      bw_kg: 80 + (i % 4) * 5, bw_multiple: (600 - i * 10) / (80 + (i % 4) * 5),
      abs_rank: null, p4p_rank: i + 1, all_rank: i + 1, p4p_count: 14, all_count: 14, abs_count: null,
      source: i % 2 ? "meet" : "training", lifted_on: "2026-09-01", is_me: me,
    }),
  ),
);
const meetRows = people.slice(0, 11).flatMap(({ i, sex, me }) =>
  lifts.map((lift) =>
    normalizeMeetRow({
      athlete_id: `a${i}`, client_id: `c${i}`, display_name: `P${i}`, sex, lift, kg: 550 - i * 10,
      bw_kg: 82, bw_multiple: (550 - i * 10) / 82, abs_rank: null, p4p_rank: i + 1, all_rank: i + 1,
      p4p_count: 11, all_count: 11, abs_count: null, meet_date: "2025-05-01", meet_name: "Provincials", is_me: me,
    }),
  ),
);

describe("Strength filters on both sources", () => {
  const combos: [BoardMode, Division][] = [["p4p", "male"], ["p4p", "female"], ["p4p", "all"], ["absolute", "all"]];
  for (const [source, rows] of [["All-time", allRows], ["Competition", meetRows]] as const) {
    for (const [mode, division] of combos) {
      for (const lift of lifts) {
        it(`${source} · ${mode} · ${division} · ${lift}: Top 10, then everyone on Show all, in rank order, one lift only`, () => {
          const shown = pickBoard(rows, mode, lift, division, TOP);
          const everyone = pickBoard(rows, mode, lift, division, Infinity);
          expect(shown.top.length).toBe(Math.min(TOP, everyone.top.length));
          expect(everyone.top.length).toBe(everyone.count);
          expect(everyone.top.every((r) => r.lift === lift)).toBe(true);
          expect(everyone.top.slice(0, shown.top.length).map((r) => r.key)).toEqual(shown.top.map((r) => r.key));
          if (mode === "p4p" && division !== "all") expect(everyone.top.every((r) => r.sex === division)).toBe(true);
        });
      }
    }
  }

  it("you below the Top 10 on All-time: ranked, and not in the ten shown (so your row is added under it)", () => {
    const { top, me } = pickBoard(allRows, "p4p", "total", "all", TOP);
    expect(me?.is_me).toBe(true);
    expect(meStatus(me, "p4p", "total", "all")).toMatchObject({ kind: "ranked" });
    expect(top.some((r) => r.key === me!.key)).toBe(false);
  });

  it("you with no meet: no Competition rank, and nothing claims one", () => {
    const { me } = pickBoard(meetRows, "p4p", "total", "all", TOP);
    expect(me).toBeNull();
    expect(meStatus(me, "p4p", "total", "all").kind).not.toBe("ranked");
  });
});

describe("Strength source switch", () => {
  const board = readFileSync("src/components/portal/strength-board.tsx", "utf8");
  const slide = board.slice(board.indexOf("export function StrengthBoardSlide()"), board.indexOf("function KingTile("));
  it("both boards load up front, so switching is instant; any filter change folds Show all back", () => {
    expect(slide).toContain("const allTime = useStrengthBoard();");
    expect(slide).toContain("const meets = useMeetBoard();");
    expect(slide).toContain("onClick={() => pick(setSource)(k)}");
    expect(slide).toContain("onClick={() => pick(setMode)(k)}");
    expect(slide).toContain("onClick={() => pick(setDivision)(d)}");
    expect(slide).toContain("onClick={() => pick(setLift)(l.key)}");
    expect(slide).toContain("const pick = <T,>(set: (v: T) => void) => (v: T) => { set(v); setShowAll(false); };");
  });
  it("Competition: no training hints, no Not ranked yet; a failed load says so instead of 'nobody's here'", () => {
    expect(slide).toContain('source === "meets" ? null');
    expect(slide).toContain('showAll && source === "all" && roster.data');
    expect(slide).toContain("The board couldn't load.");
  });
  it("a career opens from either source and Back closes it", () => {
    expect(slide).toContain("<HallOfStrengthSheet careerOnly open={!!careerId} onOpenChange={(o) => !o && setCareerId(null)} initialSource={source}");
  });
});
