import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  applyRowOp,
  backoffLabelFor,
  backoffLoad,
  followsHead,
  freshCopy,
  laidOutTheSame,
  layoutOf,
  replayRowOp,
  rowUnits,
  takesBackoffs,
  weekNumbersWords,
  rowKeysOf,
  stampRowKeys,
  withoutRowKeys,
} from "@/lib/program-editor-rows";

const SQ = "11111111-1111-1111-1111-111111111111";
const BP = "22222222-2222-2222-2222-222222222222";
const RDL = "33333333-3333-3333-3333-333333333333";
const ROW = "44444444-4444-4444-4444-444444444444";

const squatTop = { _dbId: "row-sq", exercise_id: SQ, sets: 1, reps_text: "3", rpe: "8", sort_order: 0 };
const squatBack = { _dbId: "row-sq-b", exercise_id: SQ, sets: 3, reps_text: "3", percentage: 90, percentage_basis: "top_set", sort_order: 1 };
const bench = { _dbId: "row-bp", exercise_id: BP, sets: 4, reps_text: "5", rpe: "7", sort_order: 2 };
const rdl = { exercise_id: RDL, sets: 3, reps_text: "8", rpe: "7", sort_order: 3 };
const day = () => [squatTop, squatBack, bench, rdl].map((r) => ({ ...r }));

describe("an exercise and its back-offs are one unit", () => {
  it("groups a % of the top set, a % of the previous set and a row called a back-off under the row above", () => {
    const rows = [
      squatTop,
      squatBack,
      { exercise_id: SQ, sets: 2, reps_text: "5", percentage: 95, percentage_basis: "prev_set" },
      { exercise_id: SQ, sets: 2, reps_text: "5", rpe: "7", purpose_label: "Primary Squat Backoff" },
      bench,
    ];
    expect(rowUnits(rows)).toEqual([{ start: 0, end: 4 }, { start: 4, end: 5 }]);
  });

  it("never groups another exercise, or the same exercise that isn't a back-off", () => {
    expect(followsHead({ exercise_id: BP, percentage_basis: "top_set" }, squatTop)).toBe(false);
    expect(followsHead({ exercise_id: SQ, rpe: "8" }, squatTop)).toBe(false);
    expect(rowUnits([squatTop, { exercise_id: SQ, rpe: "7" }]).length).toBe(2);
  });

  it("reads a typed name when there's no library exercise", () => {
    expect(followsHead({ exercise_name_override: "Sled push", purpose_label: "Back-off" }, { exercise_name_override: "sled push" })).toBe(true);
  });

  it("offers back-offs only on an exercise lifted for reps with a weight", () => {
    expect(takesBackoffs(squatTop)).toBe(true);
    expect(takesBackoffs({ exercise_id: SQ, tracking_type: "time" })).toBe(false);
    expect(takesBackoffs({ exercise_id: SQ, tracking_type: "reps" })).toBe(false);
    expect(takesBackoffs({})).toBe(false);
  });
});

describe("edits move, copy and remove whole exercises", () => {
  it("moves the squat with its back-off below the bench", () => {
    const rows = day();
    const res = applyRowOp(rows, { kind: "move", from: 0, to: 1 })!;
    expect(res.rows.map((r) => r._dbId ?? r.exercise_id)).toEqual(["row-bp", "row-sq", "row-sq-b", RDL]);
    expect(res.rows.map((r) => r.sort_order)).toEqual([0, 1, 2, 3]);
  });

  it("keeps an untouched row's object (the editor keys its cards by it)", () => {
    const rows = day();
    const res = applyRowOp(rows, { kind: "move", from: 1, to: 2 })!;
    // the bench moves under the RDL: the squat rows before them stay the same objects
    expect(res.rows[0]).toBe(rows[0]);
    expect(res.rows[1]).toBe(rows[1]);
  });

  it("refuses a move that goes nowhere", () => {
    expect(applyRowOp(day(), { kind: "move", from: 1, to: 1 })).toBeNull();
    expect(applyRowOp(day(), { kind: "move", from: 9, to: 0 })).toBeNull();
  });

  it("duplicates an exercise right under it as new rows with their own identity", () => {
    const rows = day();
    const res = applyRowOp(rows, { kind: "duplicate", unit: 0 })!;
    expect(res.rows.length).toBe(6);
    expect(res.added).toEqual([2, 3]);
    const [copyTop, copyBack] = [res.rows[2], res.rows[3]];
    expect(copyTop.exercise_id).toBe(SQ);
    expect(copyTop.rpe).toBe("8");
    expect(copyBack.percentage).toBe(90);
    // a new row: no saved id (inserted, never an update of the original), set blocks cloned from it
    expect(copyTop._dbId).toBeUndefined();
    expect(copyTop._sourceDbId).toBe("row-sq");
    expect(copyBack._sourceDbId).toBe("row-sq-b");
    // independent: changing the copy never changes the original
    copyTop.rpe = "9";
    expect((rows[0] as any).rpe).toBe("8");
    expect(res.rows[4]._dbId).toBe("row-bp");
  });

  it("a fresh copy of a row that was never saved carries no source id", () => {
    expect(freshCopy(rdl)._sourceDbId).toBeUndefined();
    expect(freshCopy({ ...rdl, sort_order: 4 }).sort_order).toBeUndefined();
  });

  it("adds back-off sets after the top set: two sets at 90% of it, its reps, labelled from it", () => {
    const rows = [squatTop, bench].map((r) => ({ ...r }));
    const res = applyRowOp(rows, { kind: "backoff", unit: 0, label: backoffLabelFor("Primary Squat") })!;
    const b = res.rows[1];
    expect(res.added).toEqual([1]);
    expect(b).toMatchObject({ exercise_id: SQ, sets: 2, reps_text: "3", percentage: 90, percentage_basis: "top_set", purpose_label: "Primary Squat Backoff" });
    expect(rowUnits(res.rows)).toEqual([{ start: 0, end: 2 }, { start: 2, end: 3 }]);
  });

  it("a second back-off group starts as a copy of the last one", () => {
    const res = applyRowOp(day(), { kind: "backoff", unit: 0, label: "Backoff" })!;
    expect(res.added).toEqual([2]);
    expect(res.rows[2]).toMatchObject({ percentage: 90, percentage_basis: "top_set", sets: 3 });
    expect(res.rows[2]._sourceDbId).toBe("row-sq-b");
    expect(rowUnits(res.rows)[0]).toEqual({ start: 0, end: 3 });
  });

  it("removes an exercise with its back-offs", () => {
    const res = applyRowOp(day(), { kind: "remove", unit: 0 })!;
    expect(res.rows.map((r) => r.exercise_id)).toEqual([BP, RDL]);
  });

  it("swaps an exercise and its back-offs, keeping every number", () => {
    const res = applyRowOp(day(), { kind: "swap", unit: 0, exerciseId: ROW, name: "Pause Squat" })!;
    expect(res.rows[0]).toMatchObject({ exercise_id: ROW, exercise_name_override: "Pause Squat", rpe: "8" });
    expect(res.rows[1]).toMatchObject({ exercise_id: ROW, percentage: 90 });
    expect(rowUnits(res.rows)[0]).toEqual({ start: 0, end: 2 });
  });

  it("duplicates or removes one back-off inside its exercise", () => {
    const copied = applyRowOp(day(), { kind: "copyRow", row: 1 })!;
    expect(copied.added).toEqual([2]);
    expect(copied.rows[2]).toMatchObject({ exercise_id: SQ, percentage: 90, _sourceDbId: "row-sq-b" });
    expect(rowUnits(copied.rows)[0]).toEqual({ start: 0, end: 3 });
    const removed = applyRowOp(day(), { kind: "removeRow", row: 1 })!;
    expect(removed.rows.map((r) => r._dbId ?? r.exercise_id)).toEqual(["row-sq", "row-bp", RDL]);
  });

  it("adds an exercise between exercises, never between a top set and its back-off", () => {
    const res = applyRowOp(day(), { kind: "add", at: 1, row: { exercise_id: ROW } })!;
    expect(res.rows.map((r) => r.exercise_id)).toEqual([SQ, SQ, ROW, BP, RDL]);
    expect(res.added).toEqual([2]);
    const end = applyRowOp(day(), { kind: "add", at: 3, row: { exercise_id: ROW } })!;
    expect(end.rows[end.rows.length - 1].exercise_id).toBe(ROW);
  });
});

describe("an edit repeats in the later weeks laid out the same", () => {
  const week = (n: number, rows: any[], extra: any = {}) => ({ week_index: n, days: [{ day_index: 1, rows }, { day_index: 2, rows: [{ ...bench }] }], ...extra });
  const progressed = (rpe: string) => [{ ...squatTop, rpe }, { ...squatBack }, { ...bench }, { ...rdl }];

  it("finds the later weeks whose day has the same exercises in the same order", () => {
    const weeks = [
      week(1, progressed("7")),
      week(2, progressed("8")),
      week(3, [{ ...bench }, { ...rdl }]),
      week(4, progressed("9")),
    ];
    const layout = layoutOf(weeks[0].days[0].rows);
    expect(laidOutTheSame(weeks, 0, 1, layout)).toEqual([1, 3]);
    // a trained workout is left out
    expect(laidOutTheSame(weeks, 0, 1, layout, (d) => d === weeks[3].days[0])).toEqual([1]);
    // never an earlier week
    expect(laidOutTheSame(weeks, 1, 1, layout)).toEqual([3]);
  });

  it("makes the same move in each week, keeping that week's own numbers", () => {
    const weeks = [week(1, progressed("7")), week(2, progressed("8")), week(3, progressed("9"))];
    const layout = layoutOf(weeks[0].days[0].rows);
    const op = { kind: "move" as const, from: 0, to: 2 };
    const { weeks: out, changed } = replayRowOp(weeks, [1, 2], 1, layout, op);
    expect(changed).toEqual([1, 2]);
    expect(out[1].days![0].rows.map((r: any) => r.exercise_id)).toEqual([BP, RDL, SQ, SQ]);
    expect(out[1].days![0].rows[2].rpe).toBe("8");
    expect(out[2].days![0].rows[2].rpe).toBe("9");
    // week 1 (where the edit was made) and the other day aren't touched here
    expect(out[0]).toBe(weeks[0]);
    expect(out[1].days![1]).toBe(weeks[1].days[1]);
  });

  it("leaves a week alone that no longer matches", () => {
    const weeks = [week(1, progressed("7")), week(2, [{ ...bench }])];
    const layout = layoutOf(weeks[0].days[0].rows);
    const { weeks: out, changed } = replayRowOp(weeks, [1], 1, layout, { kind: "remove", unit: 0 });
    expect(changed).toEqual([]);
    expect(out[1]).toBe(weeks[1]);
  });

  it("copies each week's own exercise when duplicating", () => {
    const weeks = [week(1, progressed("7")), week(2, progressed("8"))];
    const layout = layoutOf(weeks[0].days[0].rows);
    const { weeks: out } = replayRowOp(weeks, [1], 1, layout, { kind: "duplicate", unit: 0 });
    expect(out[1].days![0].rows[2].rpe).toBe("8");
    expect(out[1].days![0].rows.length).toBe(6);
  });

  it("says which weeks in plain words", () => {
    expect(weekNumbersWords([4])).toBe("week 4");
    expect(weekNumbersWords([4, 5, 6, 7, 8])).toBe("weeks 4–8");
    expect(weekNumbersWords([4, 5, 6, 8, 10])).toBe("weeks 4–6, 8 and 10");
  });
});

describe("a back-off's weight is worked out like the logger does", () => {
  it("rounds 90% of a 405 lb top set to 365 lb, and to 2.5 lb with fine rounding", () => {
    expect(backoffLoad(405, 90, "lb", null)).toBe(365);
    expect(backoffLoad(425, 90, "lb", "fine")).toBe(382.5);
    expect(backoffLoad(180, 92.5, "kg", null)).toBe(167.5);
    expect(backoffLoad(180, 92.5, "kg", "fine")).toBe(167);
    expect(backoffLoad(0, 90, "kg", null)).toBeNull();
  });

  it("labels a back-off from its top set's role", () => {
    expect(backoffLabelFor("Primary Squat")).toBe("Primary Squat Backoff");
    expect(backoffLabelFor("Assistance")).toBe("Backoff");
    expect(backoffLabelFor(null)).toBe("Backoff");
    expect(backoffLabelFor("Primary Squat Backoff")).toBe("Backoff");
  });
});

describe("a row keeps its key when it moves", () => {
  it("follows the key on the row, keeps positions for rows without one, and gives a copy a new one", () => {
    let n = 0;
    const fresh = () => `k${++n}`;
    const a = { id: "a" }, b = { id: "b" }, c = { id: "c" };
    // never touched: a key per position
    const k1 = rowKeysOf([a, b, c], [], fresh);
    expect(k1).toEqual(["k1", "k2", "k3"]);
    // stamped, moved and deep-copied (as the editor's payload is): the keys follow the rows
    const stamped = stampRowKeys([a, b, c], k1);
    const moved = JSON.parse(JSON.stringify([stamped[2], stamped[0], stamped[1]]));
    expect(rowKeysOf(moved, k1, fresh)).toEqual(["k3", "k1", "k2"]);
    // an unstamped row edited in place keeps its position's key
    expect(rowKeysOf([a, { ...b, rpe: 8 }, c], k1, fresh)).toEqual(["k1", "k2", "k3"]);
    // a copy never shares a key with the row it came from
    expect(freshCopy(stamped[0])._k).toBeUndefined();
    const withPaste = [...stamped, { ...stamped[0] }];
    const k4 = rowKeysOf(withPaste, ["k1", "k2", "k3"], fresh);
    expect(k4.slice(0, 3)).toEqual(["k1", "k2", "k3"]);
    expect(new Set(k4).size).toBe(4);
  });

  it("never saves an editor key", () => {
    const saved = withoutRowKeys({ weeks: [{ days: [{ rows: [{ _k: "k1", sets: 3 }] }] }] });
    expect(JSON.stringify(saved)).toBe('{"weeks":[{"days":[{"rows":[{"sets":3}]}]}]}');
  });
});

describe("the coach's editor uses it", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  const editor = read("src/route-pages/_authenticated/admin/program-library_.$templateId.tsx");
  const sortable = read("src/components/program-editor/sortable-rows.tsx");

  it("drags an exercise by its handle: a mouse at once, a finger after a short hold, keys after Space", () => {
    expect(sortable).toContain("useSensor(MouseSensor, { activationConstraint: { distance: 4 } })");
    expect(sortable).toContain("useSensor(TouchSensor, { activationConstraint: { delay: 160, tolerance: 8 } })");
    expect(sortable).toContain("useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })");
    expect(sortable).toContain('autoScroll={{ threshold: { x: 0, y: 0.25 }, acceleration: 14 }}');
    expect(sortable).toContain('haptic("medium")');
    expect(editor).toContain("<SortableUnits");
    expect(editor).toContain('onMove={(from, to) => runOp({ kind: "move", from, to })}');
    // the handle is always there (never hover-only or computer-only) and never opens the card
    expect(editor).toContain("const grip = handle ? <RowGrip handle={handle} name={exName} phone={phone} /> : null;");
    expect(editor).toContain("!onGrip(e.target)) openCard();");
  });

  it("has no Move up / Move down and no browser drag of rows", () => {
    expect(editor).not.toContain("Move up");
    expect(editor).not.toContain("Move down");
    expect(editor).not.toContain("application/x-pb-row-reorder");
  });

  it("duplicates, adds back-off sets and deletes a whole exercise from its ⋯", () => {
    expect(editor).toContain('{followTitle ? "Duplicate this back-off" : "Duplicate"}');
    expect(editor).toContain("Add back-off sets");
    expect(editor).toContain('`Delete with its ${backoffs === 1 ? "back-off" : `${backoffs} back-offs`}`');
    expect(editor).toContain('runOp({ kind: "backoff", unit: ui, label: backoffLabelFor(purposeLabels[u.start]) }, { open: true })');
  });

  it("a back-off at a % of the top set says what it works out to and how it rounds", () => {
    expect(editor).toContain('label="Round to"');
    expect(editor).toContain('setRow({ ...row, load_round: v === "fine" ? "fine" : null })');
    expect(editor).toContain("backoffLoad(base, Number(r.percentage), unit, r.load_round)");
    expect(read("src/routes/_authenticated/admin/blocks.$blockId.tsx")).toContain('"load_round",');
    const migration = read("supabase/migrations/20270510090000_template_load_round.sql");
    expect(migration).toContain("SET load_round = 'fine'");
    expect(migration).toContain("AND er.load_round IS NULL");
  });

  it("an edit changes its week only, and offers the later weeks laid out the same, never a trained workout", () => {
    expect(editor).toContain("Edits change week {aw.week_index} only");
    expect(editor).toContain("const targets = laidOutTheSame(weeks, wi, dayIndex, layout, trained);");
    expect(editor).toContain('return st?.status === "completed" || st?.status === "in-progress";');
    expect(editor).toContain("label: `Also ${weekNumbersWords(targets.map((j) => weekNo(weeks, j)))}`");
    expect(editor).toContain('label: "Undo",');
  });
});
