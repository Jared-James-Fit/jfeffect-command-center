import { describe, expect, it } from "vitest";
import { mergeProposal, snapshotFingerprint, conversationText } from "@/lib/program-ai/conversation";
import { buildPlan, resolveChanges, templatePayloadFrom, effortValues, type EngineCtx } from "@/lib/program-ai/engine";
import { changeSchema, parseReply, type EditChange } from "@/lib/program-ai/ops";
import { programText } from "@/lib/program-ai/prompts";
import type { CatalogExercise, DaySnap, ProgramSnapshot, RowSnap } from "@/lib/program-ai/types";

// ---------------------------------------------------------------------------
// A client program: one block, 4 weeks × 3 workouts; week 1 is trained.

const EX: Record<string, CatalogExercise> = {};
function ex(code: string, name: string, extra: Partial<CatalogExercise> = {}): CatalogExercise {
  const e: CatalogExercise = { code, id: `ex-${code}`, name, muscle: null, equipment: "Barbell", family: null, video: true, timeProfile: "accessory_compound", defaultRest: 120, standard: null, ...extra };
  EX[code] = e;
  return e;
}
ex("X1", "Competition Squat", { family: "squat", timeProfile: "main_lift" });
ex("X2", "Hack Squat", { equipment: "Machine" });
ex("X3", "Belt Squat", { equipment: "Machine" });
ex("X4", "Competition Bench Press", { family: "bench", timeProfile: "main_lift" });
ex("X5", "Lat Pulldown", { equipment: "Cable" });
ex("X6", "Reverse Pec Deck", { equipment: "Machine", muscle: "Rear Delts" });
ex("X7", "Conventional Deadlift", { family: "deadlift", timeProfile: "main_lift" });
ex("X8", "Landmine Lateral Raise", { standard: "isolation on a landmine" });
ex("X9", "Treadmill Walk", { equipment: "Cardio" });

const ctx: EngineCtx = {
  catalog: new Map(Object.values(EX).map((e) => [e.code, e])),
  byId: new Map(Object.values(EX).map((e) => [e.id, e])),
};

let n = 0;
function row(dayRef: string, i: number, code: string, rx: Partial<RowSnap> = {}): RowSnap {
  const e = EX[code];
  n++;
  return {
    id: `row-${dayRef}-${i}`,
    ref: `${dayRef}E${i}`,
    dayId: `day-${dayRef}`,
    sortOrder: i - 1,
    exerciseId: e.id,
    name: e.name,
    nameOverride: null,
    sets: 3,
    reps: "8",
    rpe: "8",
    rir: null,
    percentage: null,
    percentageBasis: null,
    loadKg: null,
    loadLb: null,
    loadUnit: null,
    manualOverride: false,
    restSeconds: 120,
    restOverride: null,
    tempo: null,
    notes: null,
    timeProfile: e.timeProfile,
    purposeLabel: null,
    measurementType: "reps",
    trackingType: "reps_weight",
    durationSeconds: null,
    cardio: false,
    updatedAt: `2026-11-0${(i % 8) + 1}T10:00:00.123456+00:00`,
    ...rx,
  };
}

function client(): ProgramSnapshot {
  const weeks = [1, 2, 3, 4].map((w) => {
    const days: DaySnap[] = [1, 2, 3].map((d) => {
      const ref = `B1W${w}D${d}`;
      const lock = w === 1 ? ("trained" as const) : null;
      const rows =
        d === 1
          ? [row(ref, 1, "X1", { sets: 4, reps: "5", rpe: "7" }), row(ref, 2, "X2", { sets: 3, reps: "10" })]
          : d === 2
            ? [row(ref, 1, "X4", { sets: 4, reps: "5", rpe: "7.5" }), row(ref, 2, "X5", { sets: 3, reps: "12" }), row(ref, 3, "X9", { cardio: true, sets: 1, reps: null, rpe: null, measurementType: "duration", durationSeconds: 600 })]
            : [row(ref, 1, "X7", { sets: 3, reps: "3", rpe: "8" }), row(ref, 2, "X2", { sets: 2, reps: "12" })];
      return { id: `day-${ref}`, ref, weekId: `week-${w}`, dayIndex: d, title: ["Lower", "Upper", "Pull"][d - 1], subtitle: null, focus: null, date: `2026-11-${String(w * 7 + d).padStart(2, "0")}`, lock, isCustom: false, updatedAt: "2026-11-01T09:00:00.5+00:00", rows };
    });
    return { id: `week-${w}`, ref: `B1W${w}`, blockId: "block-1", weekIndex: w, start: null, end: null, phase: null, days };
  });
  return {
    kind: "client",
    clientId: "client-1",
    templateId: null,
    title: "Jared McIntyre",
    unit: "lb",
    today: "2026-11-08",
    trainingDays: ["mon", "wed", "fri"],
    maxSessionMinutes: 60,
    maxLifts: ["squat", "deadlift"],
    blocks: [{ id: "block-1", ref: "B1", name: "Strength Block", status: "Active", visible: true, start: "2026-11-02", end: "2026-11-29", current: true, weeks }],
  };
}

// every change goes through the same schema the model's reply does
const change = (id: string, ops: any[], extra: Partial<EditChange> = {}): EditChange => changeSchema.parse({ id, title: id, why: "", basis: "requested", evidence: [], ops, ...extra });
const hackRefs = (s: ProgramSnapshot) => s.blocks[0].weeks.flatMap((w) => w.days).flatMap((d) => d.rows).filter((r) => r.name === "Hack Squat").map((r) => r.ref);

describe("Edit with AI engine: the 17 scenarios that are pure logic", () => {
  it("1. one exercise in one workout changes that row and nothing else", () => {
    const s = client();
    const [c] = resolveChanges(s, [change("c1", [{ op: "swap", rows: ["B1W3D1E2"], exercise: "X3" }])], ctx);
    expect(c.ok).toBe(true);
    expect(c.days).toHaveLength(1);
    expect(c.days[0].rows).toEqual([{ kind: "swapped", before: "Hack Squat · 3 × 10 @RPE 8 · rest 2:00", after: "Belt Squat · 3 × 10 @RPE 8 · rest 2:00" }]);
    const p = buildPlan(s, [change("c1", [{ op: "swap", rows: ["B1W3D1E2"], exercise: "X3" }])], ctx);
    expect(p.plan.row_updates).toEqual([{ id: "row-B1W3D1-2", patch: { exercise_id: "ex-X3", time_profile: "accessory_compound" } }].map((x) => ({ ...x, patch: { exercise_id: "ex-X3" } })));
    expect(p.plan.row_inserts).toEqual([]);
    expect(p.plan.row_deletes).toEqual([]);
    expect(p.plan.day_bases.map((b) => b.id)).toEqual(["day-B1W3D1"]);
  });

  it("2. replacing an exercise across the program hits every unlocked occurrence, never a trained one", () => {
    const s = client();
    const refs = hackRefs(s);
    expect(refs).toHaveLength(8); // 4 weeks × 2 workouts
    const [c] = resolveChanges(s, [change("c1", [{ op: "swap", rows: refs, exercise: "X3" }])], ctx);
    expect(c.ok).toBe(true);
    expect(c.touched.workouts).toBe(6); // weeks 2–4
    expect(c.touched.weeks).toEqual(["Week 2", "Week 3", "Week 4"]);
    expect(c.issues.find((i) => i.text.startsWith("Left as it is"))?.text).toBe("Left as it is: Week 1 Lower is already trained; Week 1 Pull is already trained.");
    const p = buildPlan(s, [change("c1", [{ op: "swap", rows: refs, exercise: "X3" }])], ctx);
    expect(p.plan.row_updates.map((u) => u.id).sort()).toEqual(["row-B1W2D1-2", "row-B1W2D3-2", "row-B1W3D1-2", "row-B1W3D3-2", "row-B1W4D1-2", "row-B1W4D3-2"]);
    expect(p.plan.row_updates.every((u) => Object.keys(u.patch).join() === "exercise_id")).toBe(true);
  });

  it("3. reducing frequency: workouts removed, later days renumbered, training days and re-dating queued", () => {
    const s = client();
    const ops = [
      { op: "remove_day", days: ["B1W2D2", "B1W3D2", "B1W4D2"] },
      { op: "add", days: ["B1W2D1", "B1W3D1", "B1W4D1"], exercise: "X4", position: 2, set: { sets: 3, reps: "5", rpe: "7" } },
      { op: "schedule", training_days: ["Monday", "thu"] },
    ];
    const [c] = resolveChanges(s, [change("c1", ops)], ctx);
    expect(c.ok).toBe(true);
    expect(c.schedule).toEqual({ before: ["mon", "wed", "fri"], after: ["mon", "thu"], redate: true });
    expect(c.days.filter((d) => d.kind === "removed")).toHaveLength(3);
    const p = buildPlan(s, [change("c1", ops)], ctx);
    expect(p.plan.day_deletes.map((d) => d.id)).toEqual(["day-B1W2D2", "day-B1W3D2", "day-B1W4D2"]);
    // Day 3 becomes Day 2 so the labels stay in order
    expect(p.plan.day_updates).toContainEqual({ id: "day-B1W2D3", patch: { day_index: 2 } });
    // bench moved into the lower day, after the squat
    const ins = p.plan.row_inserts.filter((r) => r.day_id === "day-B1W2D1");
    expect(ins).toEqual([expect.objectContaining({ exercise_id: "ex-X4", sets: 3, reps_text: "5", rpe: "7", sort_order: 1 })]);
    expect(p.plan.row_updates).toContainEqual({ id: "row-B1W2D1-2", patch: { sort_order: 2 } });
    expect(p.schedule).toEqual({ trainingDays: ["mon", "thu"], redate: true });
  });

  it("4. weekly volume: sets change on exactly the rows named", () => {
    const s = client();
    const p = buildPlan(s, [change("c1", [{ op: "update", rows: ["B1W2D2E2", "B1W3D2E2", "B1W4D2E2"], set: { sets: 4 } }])], ctx);
    expect(p.plan.row_updates).toEqual(["row-B1W2D2-2", "row-B1W3D2-2", "row-B1W4D2-2"].map((id) => ({ id, patch: { sets: 4 } })));
  });

  it("5. RPE → percentages: the % is set, RPE cleared; a lift with no max gets a warning", () => {
    const s = client();
    const ops = [{ op: "update", rows: ["B1W2D2E1", "B1W3D2E1"], set: { percentage: 75, clear: ["rpe"] } }];
    const [c] = resolveChanges(s, [change("c1", ops)], ctx);
    expect(c.ok).toBe(true);
    expect(c.days[0].rows[0].after).toBe("Competition Bench Press · 4 × 5 · 75% 1RM · rest 2:00");
    expect(c.issues.map((i) => i.text)).toContain("Competition Bench Press: a % needs a max to turn into a load, and none is on file for it.");
    const p = buildPlan(s, [change("c1", ops)], ctx);
    expect(p.plan.row_updates[0].patch).toEqual({ rpe: null, percentage: 75, percentage_basis: "1rm" });
    // squat has a max on file: no warning
    const [sq] = resolveChanges(s, [change("c1", [{ op: "update", rows: ["B1W2D1E1"], set: { percentage: 80, rpe: "7" } }])], ctx);
    expect(sq.issues.some((i) => /needs a max/.test(i.text))).toBe(false);
  });

  it("12. trained / started / past workouts are never part of a change", () => {
    const s = client();
    const [c] = resolveChanges(s, [change("c1", [{ op: "update", rows: ["B1W1D1E1"], set: { sets: 5 } }])], ctx);
    expect(c.ok).toBe(false);
    expect(c.issues.map((i) => i.text)).toContain("Nothing left to change: every workout in it is already trained, started or in the past.");
    const p = buildPlan(s, [change("c1", [{ op: "update", rows: ["B1W1D1E1", "B1W2D1E1"], set: { sets: 5 } }])], ctx);
    expect(p.plan.row_updates.map((u) => u.id)).toEqual(["row-B1W2D1-1"]);
    expect(p.plan.day_bases.map((b) => b.id)).toEqual(["day-B1W2D1"]);
    // a whole trained day can't be removed either
    const [d] = resolveChanges(s, [change("c1", [{ op: "remove_day", days: ["B1W1D3"] }])], ctx);
    expect(d.ok).toBe(false);
  });

  it("14. invalid operations are refused, each with its reason", () => {
    const s = client();
    const bad = (ops: any[]) => resolveChanges(s, [change("c1", ops)], ctx)[0];
    expect(bad([{ op: "update", rows: ["B1W9D1E1"], set: { sets: 3 } }]).issues[0].text).toBe("B1W9D1E1 isn't an exercise in this program.");
    expect(bad([{ op: "swap", rows: ["B1W2D1E2"], exercise: "Zercher Pogo Squat" }]).issues[0].text).toMatch(/isn't in the exercise library/);
    expect(bad([{ op: "update", rows: ["B1W2D1E1"], set: { rpe: "12" } }]).issues[0].text).toMatch(/isn't a valid RPE/);
    expect(bad([{ op: "update", rows: ["B1W2D1E1"], set: { rpe: "8", rir: "2" } }]).issues[0].text).toMatch(/RPE or RIR, not both/);
    expect(bad([{ op: "update", rows: ["B1W2D1E1"], set: { percentage: 140 } }]).issues[0].text).toMatch(/outside 30–110%/);
    expect(bad([{ op: "update", rows: ["B1W2D1E1"], set: { load: 600, load_unit: "kg" } }]).issues[0].text).toMatch(/over the app's 450 kg limit/);
    expect(bad([{ op: "update", rows: ["B1W2D1E1"], set: { tempo: "slow" } }]).issues[0].text).toMatch(/tempo/);
    expect(bad([{ op: "remove", rows: ["B1W2D2E3"] }]).issues[0].text).toMatch(/cardio plan/);
    expect(bad([{ op: "add", days: ["B1W2D1"], exercise: "X6", set: { sets: 3 } }]).issues[0].text).toMatch(/needs its reps/);
    for (const c of [bad([{ op: "update", rows: ["B1W9D1E1"], set: { sets: 3 } }])]) expect(c.ok).toBe(false);
    // the reply itself is schema-checked
    expect(parseReply("not json").ok).toBe(false);
    const r1 = parseReply(JSON.stringify({ intent: "edit", changes: [{ id: "c1", title: "x", basis: "requested", ops: [{ op: "delete_everything" }] }] }));
    expect(r1.ok).toBe(false);
    const r2 = parseReply(JSON.stringify({ intent: "edit", changes: [{ id: "c1", title: "x", basis: "requested", ops: [{ op: "update", rows: ["B1W2D1E1"], set: { sets: 3, sql: "drop table" } }] }] }));
    expect(r2.ok).toBe(false);
    const r3 = parseReply(`Here you go:\n\`\`\`json\n${JSON.stringify({ intent: "edit", changes: [{ id: 1, title: "More sets", basis: "data", ops: [{ op: "update", rows: ["b1w2d1e1"], set: { sets: "4", rest: 150, rpe: 8 } }] }] })}\n\`\`\``);
    expect(r3.ok && r3.value.changes[0]).toEqual({ id: "c1", title: "More sets", why: "", basis: "data", evidence: [], ops: [{ op: "update", rows: ["B1W2D1E1"], set: { sets: 4, rest_seconds: 150, rpe: "8" } }] });
  });

  it("17. integrity across weeks: refs are stable within a change, changes combine in order, sort orders stay dense", () => {
    const s = client();
    const changes = [
      change("c1", [{ op: "swap", rows: hackRefs(s), exercise: "X3" }]),
      change("c2", [
        { op: "remove", rows: ["B1W2D1E1"] },
        // E2 still means the row that was E2 when the program was read
        { op: "update", rows: ["B1W2D1E2"], set: { sets: 5 } },
        { op: "add", days: ["B1W2D1"], exercise: "X6", position: 1, set: { sets: 3, reps: "15", rpe: "9" } },
      ]),
    ];
    const resolved = resolveChanges(s, changes, ctx);
    expect(resolved[1].issues.some((i) => /Change c1 changes some of the same exercises/.test(i.text))).toBe(true);
    const p = buildPlan(s, changes, ctx);
    expect(p.issues.filter((i) => i.level === "error")).toEqual([]);
    const upd = p.plan.row_updates.find((u) => u.id === "row-B1W2D1-2");
    // removed E1, new row first: the hack squat (now belt squat) stays second
    expect(upd?.patch).toEqual({ exercise_id: "ex-X3", sets: 5 });
    expect(p.plan.row_deletes).toEqual([{ id: "row-B1W2D1-1" }]);
    expect(p.plan.row_inserts).toEqual([expect.objectContaining({ day_id: "day-B1W2D1", exercise_id: "ex-X6", sort_order: 0 })]);
    // the bases are the program as read: same row count, latest edit
    const base = p.plan.day_bases.find((b) => b.id === "day-B1W2D1")!;
    expect(base.rows).toBe(2);
    expect(base.day).toBe("2026-11-01T09:00:00.5+00:00");
    // nothing outside weeks 2–4 or the Hack Squat rows is touched
    const touchedDays = new Set(p.plan.day_bases.map((b) => b.id));
    expect([...touchedDays].every((id) => !id.includes("W1"))).toBe(true);
  });

  it("warns (doesn't block) on a duplicate exercise, a long session and an exercise below the standard", () => {
    const s = client();
    const [c] = resolveChanges(s, [change("c1", [{ op: "add", days: ["B1W2D1"], exercise: "X1", set: { sets: 3, reps: "5", rpe: "6", notes: "Back-off" } }, { op: "add", days: ["B1W2D1"], exercise: "X8", set: { sets: 6, reps: "15", rpe: "9" } }, { op: "add", days: ["B1W2D1"], exercise: "X6", set: { sets: 8, reps: "15", rpe: "9" } }])], ctx);
    expect(c.ok).toBe(true);
    const texts = c.issues.map((i) => i.text).join("\n");
    expect(texts).toMatch(/Competition Squat would be in it 2 times/);
    expect(texts).toMatch(/Landmine Lateral Raise is below the exercise standard/);
    expect(texts).toMatch(/over their 60-min limit/);
    expect(c.days[0].minutesAfter).toBeGreaterThan(c.days[0].minutesBefore!);
  });

  it("a swap to a different kind of exercise doesn't inherit the old rest, label or cue; a like-for-like swap keeps them", () => {
    const s = client();
    s.blocks[0].weeks[1].days[2].rows[0] = { ...s.blocks[0].weeks[1].days[2].rows[0], restOverride: 240, purposeLabel: "Secondary Deadlift", notes: "Technique only. Comp stance." };
    const [far] = resolveChanges(s, [change("c1", [{ op: "swap", rows: ["B1W2D3E1"], exercise: "X5", set: { sets: 3, reps: "10-12", rpe: "8" } }])], ctx);
    expect(far.days[0].rows[0].after).toBe("Lat Pulldown · 3 × 10-12 @RPE 8 · rest 2:00");
    const p = buildPlan(s, [change("c1", [{ op: "swap", rows: ["B1W2D3E1"], exercise: "X5", set: { sets: 3, reps: "10-12", rpe: "8" } }])], ctx);
    expect(p.plan.row_updates[0].patch).toMatchObject({ exercise_id: "ex-X5", rest_seconds_override: null, purpose_label: null, notes: null });
    // hack squat → belt squat: same kind of exercise, the coach's cue stays
    const t = client();
    t.blocks[0].weeks[1].days[0].rows[1].notes = "Control the descent.";
    const [near] = resolveChanges(t, [change("c1", [{ op: "swap", rows: ["B1W2D1E2"], exercise: "X3" }])], ctx);
    expect(near.days[0].rows[0].after).toBe('Belt Squat · 3 × 10 @RPE 8 · rest 2:00 · "Control the descent."');
    // live, Nov 8: belt squat → hack squat (same class, other movement family) lost a superset's 45 s rest
    const u = client();
    u.blocks[0].weeks[1].days[0].rows[1] = { ...u.blocks[0].weeks[1].days[0].rows[1], restSeconds: 45, restOverride: 45, notes: "Superset with calf raises: hack squat, rest 45s" };
    const fam = (e: CatalogExercise) => (e.code === "X2" ? { ...e, family: "machine_squat" } : e.code === "X3" ? { ...e, family: "belt_squat" } : e);
    const famCtx = { catalog: new Map([...ctx.catalog].map(([k, e]) => [k, fam(e)])), byId: new Map([...ctx.byId].map(([k, e]) => [k, fam(e)])) };
    const p2 = buildPlan(u, [change("c1", [{ op: "swap", rows: ["B1W2D1E2"], exercise: "X3" }])], famCtx);
    expect(p2.plan.row_updates[0].patch).toEqual({ exercise_id: "ex-X3", notes: null });
  });

  it("a top set + back-offs already in a workout isn't flagged as a duplicate", () => {
    const s = client();
    const d = s.blocks[0].weeks[1].days[2];
    d.rows.push({ ...d.rows[0], id: "row-backoff", ref: "B1W2D3E3", sortOrder: 2, sets: 3, reps: "5", rpe: "7" });
    const [c] = resolveChanges(s, [change("c1", [{ op: "update", rows: ["B1W2D3E3"], set: { sets: 2 } }])], ctx);
    expect(c.issues.filter((i) => /times/.test(i.text))).toEqual([]);
  });

  it("reads efforts the way coaches write them", () => {
    expect(effortValues("8")).toEqual([8]);
    expect(effortValues("7-8")).toEqual([7, 8]);
    expect(effortValues("7.5")).toEqual([7.5]);
    expect(effortValues("hard")).toBeNull();
  });
});

describe("conversational refinement keeps the proposal", () => {
  const a = change("c1", [{ op: "update", rows: ["B1W2D1E1"], set: { sets: 4 } }]);
  const b = change("c2", [{ op: "update", rows: ["B1W2D2E1"], set: { sets: 4 } }]);
  const c = change("c3", [{ op: "remove", rows: ["B1W2D2E2"] }]);

  it("a small ask adds or replaces only what it names; the rest carries forward untouched", () => {
    const m = mergeProposal([a, b, c], { changes: [change("c2", [{ op: "update", rows: ["B1W2D2E1"], set: { sets: 3 } }]), change("c9", [{ op: "add", days: ["B1W3D2"], exercise: "X6", set: { sets: 3, reps: "15" } }])], drop: [] });
    expect(m.changes.map((x) => x.id)).toEqual(["c1", "c2", "c3", "c9"]);
    expect(m.changes[0]).toBe(a);
    expect(m.changes[2]).toBe(c);
    expect(m.replaced).toEqual(["c2"]);
    expect(m.carried).toEqual(["c1", "c3"]);
  });

  it("unticked and dropped changes go, and a new change can't take their id", () => {
    const m = mergeProposal([a, b, c], { changes: [change("c3", [{ op: "remove", rows: ["B1W3D2E2"] }])], drop: ["c1"] }, ["c3"]);
    expect(m.dropped).toEqual(["c1", "c3"]);
    expect(m.changes.map((x) => x.id)).toEqual(["c2", "c4"]);
  });

  it("the fingerprint moves when the program is edited or trained", () => {
    const s = client();
    const f = snapshotFingerprint(s);
    expect(snapshotFingerprint(client())).toBe(f);
    const t = client();
    t.blocks[0].weeks[1].days[0].lock = "started";
    expect(snapshotFingerprint(t)).not.toBe(f);
    const e = client();
    e.blocks[0].weeks[2].days[1].rows[0].updatedAt = "2026-11-08T00:00:00Z";
    expect(snapshotFingerprint(e)).not.toBe(f);
  });

  it("the model sees the current proposal with its ids, or is told it was cleared because the program changed", () => {
    const turns = [{ instruction: "Optimize Jared's program", status: "ready", result: { answer: "Done", changes: [a, b] }, rejected: [] }];
    expect(conversationText(turns, [a, b], false)).toContain('CURRENT PROPOSAL');
    expect(conversationText(turns, [a, b], false)).toContain('"id":"c1"');
    expect(conversationText(turns, [a, b], true)).toContain("THE PROGRAM CHANGED");
  });
});

describe("the program as the model reads it", () => {
  it("locked workouts are one line with no refs to edit; open ones list every exercise with its catalog code", () => {
    const t = programText(client(), ctx);
    expect(t).toContain('B1W1D1 "Lower" · Sun, Nov 8 · LOCKED (already trained): Competition Squat 4 × 5 @RPE 7 rest 2:00; Hack Squat 3 × 10 @RPE 8 rest 2:00');
    expect(t).not.toContain("B1W1D1E1");
    expect(t).toContain("E2 [X2] Hack Squat · 3 × 10 @RPE 8 · rest 2:00");
    expect(t).toContain("[cardio plan: not editable] Treadmill Walk");
    expect(t).toContain("Session limit: 60 min. Maxes on file: squat, deadlift.");
  });
});

describe("10. templates: the payload changes, nothing else", () => {
  it("rows keep the fields the editor stores, change only what was asked, and the meta follows the days", () => {
    const v2 = {
      schema_version: 2,
      blocks: [
        {
          id: "tb1",
          name: "Block 1",
          archived: false,
          weeks: [
            { week_index: 1, notes: "", days: [{ day_index: 1, title: "Mon", notes: "", rows: [{ exercise_id: "ex-X2", exercise_name_override: "Hack Squat", sets: 3, reps_text: "10", rpe: "8", purpose_label: "Quads", sort_order: 1, tracking_type: "reps_weight" }] }] },
          ],
        },
        { id: "archived", name: "Old", archived: true, weeks: [] },
      ],
    };
    const snap: ProgramSnapshot = {
      kind: "template",
      clientId: null,
      templateId: "t1",
      title: "PL 1 day",
      unit: "lb",
      today: "2026-11-08",
      trainingDays: [],
      revision: 3,
      blocks: [
        {
          id: "tb1",
          ref: "B1",
          name: "Block 1",
          status: "Template",
          visible: true,
          start: null,
          end: null,
          current: true,
          raw: v2.blocks[0],
          weeks: [
            {
              id: "tb1:w1",
              ref: "B1W1",
              blockId: "tb1",
              weekIndex: 1,
              start: null,
              end: null,
              phase: null,
              raw: { week_index: 1, notes: "" },
              days: [
                {
                  id: "tb1:w1:d1",
                  ref: "B1W1D1",
                  weekId: "tb1:w1",
                  dayIndex: 1,
                  title: "Mon",
                  subtitle: null,
                  focus: null,
                  date: null,
                  lock: null,
                  isCustom: false,
                  updatedAt: null,
                  raw: { day_index: 1, title: "Mon", notes: "" },
                  rows: [{ ...row("B1W1D1", 1, "X2", { reps: "10", purposeLabel: "Quads", updatedAt: null }), id: "tb1:w1:d1:e1", raw: v2.blocks[0].weeks[0].days[0].rows[0] }],
                },
              ],
            },
          ],
        },
      ],
    };
    const p = buildPlan(snap, [change("c1", [{ op: "swap", rows: ["B1W1D1E1"], exercise: "X3" }, { op: "add_day", weeks: ["B1W1"], name: "Thu", exercises: [{ exercise: "X4", set: { sets: 4, reps: "5", rpe: "7" } }] }])], ctx);
    const { payload, meta } = templatePayloadFrom(v2, snap, p.work);
    const days = payload.blocks[0].weeks[0].days;
    expect(days[0].rows[0]).toMatchObject({ exercise_id: "ex-X3", exercise_name_override: "Belt Squat", sets: 3, reps_text: "10", rpe: "8", purpose_label: "Quads", sort_order: 1, tracking_type: "reps_weight" });
    expect(days[1]).toMatchObject({ day_index: 2, title: "Thu", rows: [expect.objectContaining({ exercise_id: "ex-X4", sets: 4, reps_text: "5", rpe: "7", sort_order: 1 })] });
    expect(payload.blocks[1]).toEqual(v2.blocks[1]);
    expect(v2.blocks[0].weeks[0].days[0].rows[0].exercise_id).toBe("ex-X2"); // the input isn't mutated
    expect(meta).toEqual({ days_per_week: 2 });
  });

  it("training days are a client's: a schedule op on a template is refused", () => {
    const s = { ...client(), kind: "template" as const };
    const [c] = resolveChanges(s, [change("c1", [{ op: "schedule", redate: true }])], ctx);
    expect(c.ok).toBe(false);
  });
});
