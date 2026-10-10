import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Hall of Strength, Oct 2026: the review held back "305 kg ×5" squats that were
// 305 lb typed into a kg card. Count it / Remove were both wrong answers.
const sql = readFileSync("supabase/migrations/20261031130000_strength_board_unit_fix.sql", "utf8");
const board = readFileSync("src/components/portal/strength-board.tsx", "utf8");
const tools = board.slice(board.indexOf("export function StrengthBoardCoachTools"), board.indexOf("/** Remove a lift that passed"));

describe("review spots lb typed into a kg card", () => {
  it("returns what was typed and whether it reads as lb", () => {
    expect(sql).toContain("entered_value numeric,\n  entered_unit text,\n  likely_lb boolean");
    // saved in kg, passes the typo checks as lb, fits their other sessions ...
    expect(sql).toContain("lower(coalesce(r.entered_unit, r.actual_load_unit)) = 'kg'");
    expect(sql).toContain("alt.e1rm between 0.5 * ref.best and 1.35 * ref.best");
    // ... and is impossible in kg or they log this lift in lb (a real kg PR jump isn't offered)
    expect(sql).toContain("or habit.lb > habit.kg");
  });

  it("the fix keeps the number, changes the unit for that card that day, audited, staff only", () => {
    const fix = sql.slice(sql.indexOf("function public.strength_board_fix_unit"), sql.indexOf("function public.strength_board_unfix_unit"));
    expect(fix).toContain("if not public.league_is_staff()");
    expect(fix).toContain("r.row_id = t.row_id");
    expect(fix).toContain("set actual_load_unit = 'lb', entered_unit = 'lb'");
    expect(fix).not.toMatch(/set[^;]*actual_load\s*=/);
    expect(fix).toContain("'strength_board_unit_fix'");
    expect(fix).toContain("returns uuid[]");
  });

  it("undo only reverts sets this fix changed", () => {
    const undo = sql.slice(sql.indexOf("function public.strength_board_unfix_unit"));
    expect(undo).toContain("if not public.league_is_staff()");
    expect(undo).toContain("a.edit_source = 'strength_board_unit_fix'");
    expect(undo).toContain("set actual_load_unit = 'kg', entered_unit = 'kg'");
  });
});

describe("coach tools: one tap to fix it", () => {
  it("offers 'It was 305 lb' first when the lift reads as lb", () => {
    expect(tools).toContain('label: `It was ${typedLoad(Number(r.entered_value), "lb")}`');
    expect(tools).toContain('db.rpc("strength_board_fix_unit", { _result_id: r.result_id })');
    expect(tools).toContain('lbFix ? "Count as kg" : "Count it"');
  });

  it("the fix toast can undo exactly what it changed", () => {
    expect(tools).toContain('action: { label: "Undo", onClick: () => undoFix.mutate(ids) }');
    expect(tools).toContain('db.rpc("strength_board_unfix_unit", { _result_ids: ids })');
  });

  it("shows the number as typed in the unit it was saved in", () => {
    expect(board).toContain("{r.lift} {typed ?? formatLoad(Number(r.load_kg), unit)} ×{r.reps}");
  });
});
