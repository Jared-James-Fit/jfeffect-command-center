import { describe, expect, it } from "vitest";
import {
  cleanPlan,
  daysWords,
  diffPlans,
  isMeaningful,
  newSession,
  planProblems,
  planTotals,
  rowFields,
  sessionFromRow,
  sessionLine,
  speedInputToMph,
  weekSchedule,
  weekdaysFor,
  withModality,
  type PlanContext,
} from "@/lib/cardio/plan";
import { modalityOf, netKcalPerMin } from "@/lib/cardio/modalities";
import { opsEmpty, planOn, publishOps, withoutPending } from "@/lib/cardio/publish";
import { versionOutcomes } from "@/lib/cardio/history";

const ctx: PlanContext = { trainingDays: ["Monday", "Tuesday", "Thursday", "Friday"], highDays: ["Saturday"] };

describe("cardio plan model", () => {
  it("defaults a new session to an incline treadmill walk", () => {
    const s = newSession(undefined, "non_training", ctx);
    expect(s.modality).toBe("treadmill_incline");
    expect(s.weekdays).toEqual(["Wednesday", "Saturday", "Sunday"]);
    expect(s.speedMinMph).toBe(3);
    expect(s.incline).toBe(6);
  });

  it("puts sessions on the client's own days by rule", () => {
    expect(weekdaysFor("training", [], ctx)).toEqual(["Monday", "Tuesday", "Thursday", "Friday"]);
    expect(weekdaysFor("daily", [], ctx)).toHaveLength(7);
    expect(weekdaysFor("non_training", ["Wednesday", "Monday"], ctx)).toEqual(["Wednesday"]);
    expect(weekdaysFor("high", [], ctx)).toEqual(["Saturday"]);
    expect(daysWords({ days: "training", weekdays: [] }, ctx)).toBe("Training days (Mon, Tue, Thu, Fri)");
  });

  it("only keeps the settings a kind of cardio takes when it's switched", () => {
    const walk = newSession("treadmill_incline", "weekdays", ctx);
    const bike = withModality(walk, "bike");
    expect(bike.speedMinMph).toBeNull();
    expect(bike.incline).toBeNull();
    expect(bike.minutes).toBe(walk.minutes);
    const variable = withModality(walk, "treadmill_variable");
    expect(variable.inclineMax).toBe(8);
  });

  it("reads old rows, whatever they stored", () => {
    expect(modalityOf({ cardio_type: "Incline Treadmill Walk" })).toBe("treadmill_incline");
    expect(modalityOf({ cardio_type: "Outdoor Walking" })).toBe("outdoor_walk");
    expect(modalityOf({ cardio_type: "Stairmaster" })).toBe("stair_climber");
    expect(modalityOf({ cardio_type: "Custom", custom_type: "Sled pushes" })).toBe("conditioning");
    const s = sessionFromRow({ id: "a", cardio_type: "Incline Treadmill Walk", day_type: "Training Day", scheduled_weekdays: ["Monday"], duration_minutes: 15, incline: 5, speed_min_mph: 2, speed_max_mph: 3, intensity: "Zone 2" });
    expect(s.days).toBe("training");
    expect(s.rpeMin).toBe(3);
    expect(s.rpeMax).toBe(4);
  });

  it("cleans a plan from JSON (Cleo's answer, a draft) and refuses nonsense", () => {
    const p = cleanPlan([{ modality: "bike", days: "weekdays", weekdays: ["monday", "Funday"], minutes: 500, rpeMin: 14 }, { modality: "run", minutes: 0 }], ctx);
    expect(p.sessions).toHaveLength(1);
    expect(p.sessions[0].minutes).toBe(240);
    expect(p.sessions[0].weekdays).toEqual(["Monday"]);
    expect(p.sessions[0].rpeMin).toBe(10);
  });

  it("totals the week and lays it out day by day", () => {
    const plan = { sessions: [{ ...newSession("treadmill_incline", "non_training", ctx), minutes: 30 }, { ...newSession("treadmill_flat", "training", ctx), minutes: 10, rpeMin: 3, rpeMax: 3 }] };
    const t = planTotals(plan, ctx, 80);
    expect(t.sessions).toBe(7);
    expect(t.minutes).toBe(3 * 30 + 4 * 10);
    expect(t.estKcal).toBeGreaterThan(0);
    const week = weekSchedule(plan, ctx);
    expect(week.find((d) => d.day === "Wednesday")!.minutes).toBe(30);
    expect(week.find((d) => d.day === "Monday")!.training).toBe(true);
  });

  it("types a speed in km/h and keeps mph for storage", () => {
    expect(speedInputToMph("4.8", "kmh")).toBeCloseTo(2.983, 2);
    expect(speedInputToMph("3,1", "mph")).toBe(3.1);
    const s = { ...newSession("treadmill_incline", "weekdays", ctx), speedMinMph: speedInputToMph("4.8", "kmh"), speedMaxMph: speedInputToMph("4.8", "kmh") };
    expect(sessionLine(s, "kmh")).toContain("4.8 km/h");
  });

  it("flags what blocks publishing and what's only worth a look", () => {
    const noDays = { ...newSession("bike", "weekdays", ctx), weekdays: [] };
    const custom = { ...newSession("custom", "weekdays", ctx), weekdays: ["Monday" as const] };
    const p = planProblems({ sessions: [noDays, custom] }, ctx);
    expect(p.filter((x) => x.level === "error")).toHaveLength(2);
    const unset = planProblems({ sessions: [newSession("bike", "training", { trainingDays: [], highDays: [] })] }, { trainingDays: [], highDays: [] });
    expect(unset[0].text).toContain("training days aren't set");
  });

  it("estimates energy only with a bodyweight, from the walking equation", () => {
    expect(netKcalPerMin({ modality: "treadmill_incline", speedMph: 3, incline: 6, inclineMax: null }, null)).toBeNull();
    const steep = netKcalPerMin({ modality: "treadmill_incline", speedMph: 3, incline: 10, inclineMax: null }, 80)!;
    const flat = netKcalPerMin({ modality: "treadmill_flat", speedMph: 3, incline: 0, inclineMax: null }, 80)!;
    expect(steep).toBeGreaterThan(flat);
  });

  it("says what changed in words, and a private note isn't a change the client sees", () => {
    const before = { sessions: [{ ...newSession("treadmill_incline", "non_training", ctx), key: "a", id: "11111111-1111-1111-1111-111111111111" }] };
    const after = { sessions: [{ ...before.sessions[0], minutes: 30, coachNote: "x" }] };
    const d = diffPlans(before, after, ctx, "mph");
    expect(d).toHaveLength(1);
    expect(d[0].lines[0]).toContain("20 → 30 min");
    const noteOnly = diffPlans(before, { sessions: [{ ...before.sessions[0], coachNote: "only me" }] }, ctx, "mph");
    expect(noteOnly[0].kind).toBe("note");
    expect(isMeaningful(noteOnly)).toBe(false);
  });

  it("writes the fields the program sync and the client's cards read", () => {
    const f = rowFields({ ...newSession("treadmill_incline", "training", ctx), rpeMin: 3, rpeMax: 4 }, ctx, "kmh");
    expect(f.day_type).toBe("Training Day");
    expect(f.cardio_type).toBe("Incline Treadmill Walk");
    expect(f.scheduled_weekdays).toEqual(ctx.trainingDays);
    expect(f.frequency_per_week).toBe(4);
    expect(f.intensity).toBe("RPE 3–4");
    expect(f.speed_unit).toBe("kmh");
  });
});

describe("publishing", () => {
  const row = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    cardio_type: "Incline Treadmill Walk",
    day_type: "Non-Training Day",
    day_rule: "non_training",
    scheduled_weekdays: ["Wednesday", "Saturday", "Sunday"],
    duration_minutes: 20,
    incline: 6,
    speed_min_mph: 3,
    speed_max_mph: 3,
    rpe_min: 3,
    rpe_max: 5,
    status: "Active",
    enabled: true,
    visible_to_client: true,
    start_date: "2026-11-01",
    end_date: null,
    program_name: null,
    ...over,
  });

  it("does nothing when the draft is the plan", () => {
    const rows = [row("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")];
    const ops = publishOps({ rows, draft: planOn(rows, "2026-11-23"), today: "2026-11-23", effective: null, ctx, unit: "mph", pending: null });
    expect(opsEmpty(ops)).toBe(true);
  });

  it("ends a changed session yesterday and starts the new one today, keeping history by date", () => {
    const id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const rows = [row(id)];
    const draft = planOn(rows, "2026-11-23");
    draft.sessions[0] = { ...draft.sessions[0], minutes: 30 };
    const ops = publishOps({ rows, draft, today: "2026-11-23", effective: null, ctx, unit: "mph", pending: null });
    expect(ops.end).toEqual([{ id, end_date: "2026-11-22", prevEnd: null }]);
    expect(ops.insert).toHaveLength(1);
    expect(ops.insert[0].start_date).toBe("2026-11-23");
    expect(ops.insert[0].replaces).toBe(id);
    expect(ops.insert[0].fields.duration_minutes).toBe(30);
    expect(ops.scheduled).toBe(false);
  });

  it("schedules a change for a later date without touching the plan in force until then", () => {
    const id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const rows = [row(id)];
    const draft = { sessions: [] };
    const ops = publishOps({ rows, draft, today: "2026-11-23", effective: "2026-11-30", ctx, unit: "mph", pending: null });
    expect(ops.scheduled).toBe(true);
    expect(ops.end).toEqual([{ id, end_date: "2026-11-29", prevEnd: null }]);
    expect(ops.insert).toHaveLength(0);
  });

  it("rewrites a row that hasn't gone live yet instead of ending it", () => {
    const id = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    const rows = [row(id, { start_date: "2026-11-23" })];
    const draft = planOn(rows, "2026-11-23");
    draft.sessions[0] = { ...draft.sessions[0], minutes: 25 };
    const ops = publishOps({ rows, draft, today: "2026-11-23", effective: null, ctx, unit: "mph", pending: null });
    expect(ops.update).toHaveLength(1);
    expect(ops.end).toHaveLength(0);
  });

  it("takes back a waiting change before publishing the next one", () => {
    const old = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const future = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    const rows = [row(old, { end_date: "2026-11-29" }), row(future, { start_date: "2026-11-30", duration_minutes: 40 })];
    const pending = { versionId: "v", createdIds: [future], closes: [{ id: old, prevEnd: null }] };
    expect(withoutPending(rows, pending)).toHaveLength(1);
    const draft = planOn(withoutPending(rows, pending), "2026-11-23");
    const ops = publishOps({ rows, draft, today: "2026-11-23", effective: null, ctx, unit: "mph", pending });
    expect(ops.revert.deleteIds).toEqual([future]);
    expect(ops.revert.restore).toEqual([{ id: old, end_date: null }]);
    expect(ops.insert).toHaveLength(0);
  });

  it("removing a session ends it (logged sessions keep what they were logged against)", () => {
    const id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const ops = publishOps({ rows: [row(id)], draft: { sessions: [] }, today: "2026-11-23", effective: null, ctx, unit: "mph", pending: null });
    expect(ops.end[0].end_date).toBe("2026-11-22");
    expect(ops.remove).toHaveLength(0);
  });

  it("leaves a multi-week cardio program alone", () => {
    const rows = [row("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", { program_name: "Conditioning block" })];
    expect(planOn(rows, "2026-11-23").sessions).toHaveLength(0);
  });
});

describe("version outcomes", () => {
  it("reads what each version did while it was in force", () => {
    const versions = [
      { id: "1", version_no: 1, effective_date: "2026-10-01", published_at: "2026-10-01T00:00:00Z", weekly_minutes: 90, weekly_sessions: 3, change_lines: ["Added walk"], source: "coach", note: null },
      { id: "2", version_no: 2, effective_date: "2026-10-29", published_at: "2026-10-29T00:00:00Z", weekly_minutes: 120, weekly_sessions: 4, change_lines: ["Walk 20 → 30 min"], source: "cleo", note: "stalled" },
    ];
    const done = Array.from({ length: 12 }, (_, i) => ({ completed_date: `2026-10-${String(2 + i * 2).padStart(2, "0")}`, completed: true, duration_minutes: 30 }));
    const weighIns = Array.from({ length: 8 }, (_, i) => ({ date: `2026-10-${String(1 + i * 3).padStart(2, "0")}`, kg: 90 - i * 0.2 }));
    const out = versionOutcomes(versions, done, weighIns, "2026-11-23");
    expect(out[0].versionNo).toBe(2);
    expect(out[1].to).toBe("2026-10-28");
    expect(out[1].donePct).toBe(100);
    expect(out[1].bodyweightPctPerWeek).toBeLessThan(0);
  });
});

describe("the nutrition plan leaves the Cardio tab's sessions alone", () => {
  it("never rewrites or duplicates a session published from the builder", async () => {
    const { planCardioSync } = await import("@/lib/nutrition-cardio-sync");
    const rows = [{ id: "r1", day_type: "Non-Training Day", status: "Active", duration_minutes: 30, frequency_per_week: 3, plan_version_id: "v1", end_date: null }];
    const draft = { rowId: "r1", enabled: true, duration_minutes: 45, frequency_per_week: 4, cardio_type: "Incline Treadmill Walk", kcal: null, program: null, fromAi: true } as any;
    const out = planCardioSync({ clientId: "c", days: [{ label: "Non-Training Day", draft }, { label: "Rest Day", draft: { ...draft, rowId: null } }], rows: rows as any, today: "2026-11-23" });
    expect(out).toEqual({ updates: [], inserts: [] });
    const legacy = planCardioSync({ clientId: "c", days: [{ label: "Non-Training Day", draft }], rows: [{ ...rows[0], plan_version_id: null }] as any, today: "2026-11-23" });
    expect(legacy.updates).toHaveLength(1);
  });
});

describe("cardio overview", () => {
  it("reads the last 4 full weeks against the plan in force each week", async () => {
    const { cardioKpis, weeklySeries, weekdayDistribution, scaleToWeekly, CARDIO_TEMPLATES, mondayOf } = await import("@/lib/cardio/overview");
    expect(mondayOf("2026-11-23")).toBe("2026-11-23");
    expect(mondayOf("2026-11-29")).toBe("2026-11-23");
    const rows = [{ id: "a", cardio_type: "Incline Treadmill Walk", frequency_per_week: 3, duration_minutes: 30, start_date: "2026-09-01", end_date: null, status: "Active", enabled: true }];
    const completions = Array.from({ length: 10 }, (_, i) => ({ completed_date: `2026-11-${String(2 + i * 2).padStart(2, "0")}`, completed: true, skipped: false, duration_minutes: 30, rpe: 4 }));
    const live = planOn(rows as any, "2026-11-23");
    const k = cardioKpis({ today: "2026-11-23", rows: rows as any, completions: completions as any, live, ctx });
    expect(k.window).toEqual({ from: "2026-10-26", to: "2026-11-22" });
    expect(k.completionPct).toBe(83);
    expect(k.avgRpe).toBe(4);
    const weeks = weeklySeries({ today: "2026-11-23", rows: rows as any, completions: completions as any, weighIns: [{ date: "2026-11-10", kg: 80 }], weeks: 4 });
    expect(weeks).toHaveLength(4);
    expect(weeks[1].bodyweightKg).toBe(80);
    expect(weeks[0].start).toBe("2026-11-02");
    const dist = weekdayDistribution({ today: "2026-11-23", live, ctx, completions: completions as any });
    expect(dist).toHaveLength(7);
    const scaled = scaleToWeekly({ sessions: [{ ...newSession("treadmill_incline", "non_training", ctx), minutes: 30 }] }, ctx, 60);
    expect(scaled.sessions[0].minutes).toBe(20);
    for (const t of CARDIO_TEMPLATES) expect(planProblems({ sessions: t.sessions(ctx) }, ctx).filter((p) => p.level === "error")).toEqual([]);
  });
});
