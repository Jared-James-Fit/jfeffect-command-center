import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildGeneratorIntel } from "@/lib/program-intel/intelligence";
import type { GenerationSetup } from "@/lib/program-intel/recommend";
import type { IntelRecords } from "@/lib/program-intel/types";
import { homeGym } from "./program-intel-scenarios";

// The AI gateway, answered from the test (never a real call). Each call's model and prompt are kept.
const replies: Array<string | Error> = [];
const calls: Array<{ model: string; system: string; prompt: string }> = [];
vi.mock("@/lib/ai-gateway.server", () => ({ createLovableAiGateway: () => (model: string) => ({ model }), DEFAULT_AI_MODEL: "test-model" }));
vi.mock("ai", () => ({
  generateText: vi.fn(async (x: any) => {
    calls.push({ model: x.model.model, system: x.system, prompt: x.prompt });
    const r = replies.shift() ?? "{}";
    if (r instanceof Error) throw r;
    return { text: r, usage: { inputTokens: 1000, outputTokens: 200 } };
  }),
}));
vi.mock("@/lib/pl-programs", () => ({ inferTimeProfileFromExercise: () => "strength" }));
vi.mock("@/lib/exercise-metadata", () => ({ defaultRestSeconds: () => 120 }));

/** A small in-memory stand-in for the service-role client (enough for the worker). */
function memoryDb(seed: Record<string, any[]>, opts: { canCoach?: boolean; failRowsInsert?: boolean } = {}) {
  const t: Record<string, any[]> = JSON.parse(JSON.stringify(seed));
  let n = 0;
  const table = (name: string) => (t[name] ??= []);
  class Q {
    f: Array<(r: any) => boolean> = [];
    op = "select";
    payload: any;
    want: "one" | "maybe" | null = null;
    rng: [number, number] | null = null;
    lim: number | null = null;
    constructor(public name: string) {}
    select() { return this; }
    insert(p: any) { this.op = "insert"; this.payload = p; return this; }
    update(p: any) { this.op = "update"; this.payload = p; return this; }
    upsert(p: any) { this.op = "insert"; this.payload = p; return this; }
    delete() { this.op = "delete"; return this; }
    eq(c: string, v: any) { this.f.push((r) => r[c] === v); return this; }
    neq(c: string, v: any) { this.f.push((r) => r[c] !== v); return this; }
    in(c: string, vs: any[]) { this.f.push((r) => vs.includes(r[c])); return this; }
    is(c: string, v: any) { this.f.push((r) => (v === null ? r[c] == null : r[c] === v)); return this; }
    gt(c: string, v: any) { this.f.push((r) => r[c] > v); return this; }
    gte(c: string, v: any) { this.f.push((r) => r[c] >= v); return this; }
    lt(c: string, v: any) { this.f.push((r) => r[c] < v); return this; }
    not() { return this; }
    order() { return this; }
    limit(x: number) { this.lim = x; return this; }
    range(a: number, b: number) { this.rng = [a, b]; return this; }
    maybeSingle() { this.want = "maybe"; return this; }
    single() { this.want = "one"; return this; }
    then(res: any, rej: any) { return Promise.resolve().then(() => this.exec()).then(res, rej); }
    exec() {
      const rows = table(this.name).filter((r) => this.f.every((fn) => fn(r)));
      let data: any;
      if (this.op === "select") {
        data = rows;
        if (this.rng) data = data.slice(this.rng[0], this.rng[1] + 1);
        if (this.lim != null) data = data.slice(0, this.lim);
      } else if (this.op === "insert") {
        if (this.name === "pl_exercise_rows" && opts.failRowsInsert) return { data: null, error: { message: "insert failed" } };
        const list = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((p: any) => ({ id: `${this.name}-${++n}`, created_at: new Date(Date.now() + n).toISOString(), updated_at: new Date().toISOString(), ...p }));
        table(this.name).push(...list);
        data = list;
      } else if (this.op === "update") {
        for (const r of rows) Object.assign(r, JSON.parse(JSON.stringify(this.payload)), { updated_at: new Date(Date.now() + 1).toISOString() });
        data = rows;
      } else {
        t[this.name] = table(this.name).filter((r) => !rows.includes(r));
        if (this.name === "pl_blocks") {
          const gone = new Set(rows.map((r) => r.id));
          const weeks = table("pl_weeks").filter((w) => gone.has(w.block_id)).map((w) => w.id);
          t.pl_weeks = table("pl_weeks").filter((w) => !gone.has(w.block_id));
          const days = table("pl_days").filter((d) => weeks.includes(d.week_id)).map((d) => d.id);
          t.pl_days = table("pl_days").filter((d) => !weeks.includes(d.week_id));
          t.pl_exercise_rows = table("pl_exercise_rows").filter((r) => !days.includes(r.day_id));
        }
        data = rows;
      }
      if (this.want) data = Array.isArray(data) ? data[0] ?? null : data;
      return { data, error: null };
    }
  }
  return {
    tables: t,
    from: (name: string) => new Q(name),
    rpc: async (name: string, args: any) => {
      if (name === "program_intel_can_coach") return { data: opts.canCoach ?? true, error: null };
      if (name === "resolve_exercise_id") return { data: args._name === "Hamstring Curl" ? "e-hcurl" : null, error: null };
      return { data: null, error: null };
    },
  };
}

function seed(rec: IntelRecords, job: any) {
  return {
    clients: [{ ...rec.client, user_id: null }],
    client_goals_setup: rec.goals ? [{ ...rec.goals, client_id: "client-1" }] : [],
    pl_blocks: rec.blocks.map((b) => ({ ...b, client_id: "client-1" })),
    pl_weeks: rec.weeks.map((w) => ({ ...w, archived: false, deleted_at: null })),
    pl_days: rec.days.map((d) => ({ ...d, archived: false, deleted_at: null })),
    pl_exercise_rows: rec.rows,
    pl_row_results: rec.results.map((r) => ({ ...r, client_id: "client-1" })),
    pl_day_completions: rec.completions.map((c) => ({ ...c, client_id: "client-1" })),
    pl_workout_feedback: rec.feedback.map((f) => ({ ...f, client_id: "client-1" })),
    exercises: rec.exercises.map((e) => ({ ...e, archived: false })),
    pl_preps: rec.preps.map((p) => ({ ...p, client_id: "client-1" })),
    global_ai_config: [{ default_model: "test-model" }],
    program_intel_jobs: [job],
    program_intel_observations: [],
    program_intel_job_calls: [],
  };
}

const rec = homeGym();
const intel = buildGeneratorIntel(rec);
const recommended = intel.recommendation.setup;
const job = (over: any = {}) => ({ id: "job-1", client_id: "client-1", kind: "generate", status: "pending", stage: null, scope: { kind: "history" }, brain: recommended.brain, instructions: null, options: { setup: recommended, edited: [], dataHash: intel.dataHash }, privacy_safe: false, attempts: 0, created_by: "coach-1", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...over });

const strategyJson = (setup: GenerationSetup, over: any = {}) =>
  JSON.stringify({
    athlete_read: "Intermediate lifter, 4 days a week in a home gym with one cable column.",
    previous_program: { intent: "Strength + hypertrophy", outcome: "Every set done; squat and bench progressed." },
    keep: [{ item: "Competition Squat 1×/week, 5–8 reps", why: "Progressed with every set done", evidence: ["Competition Squat"] }],
    change: [{ item: "Bench top set then back-offs", why: "Bench progressed slower", evidence: [] }],
    prioritize: [],
    reduce: [],
    progression: { model: "Double progression at RPE 7–8", expected: "Load up on the main lifts", fatigue: "Week 4 lighter", success_criteria: ["Squat top set +5 kg"] },
    structure: { weeks: setup.weeks, days_per_week: setup.daysPerWeek, session_minutes: setup.sessionMinutes, blocks: setup.blocks.map((b) => ({ name: b.name, weeks: b.weeks, objective: b.objective, phases: [{ week: b.weeks, phase: "Deload" }] })) },
    weekly_layout: Array.from({ length: setup.daysPerWeek }, (_, i) => ({ day: i + 1, title: ["Lower A", "Upper A", "Lower B", "Upper B"][i] ?? `Day ${i + 1}`, focus: "", primary: [], notes: "" })),
    frequency_targets: [],
    volume_targets: [],
    intensity: "RPE 7–8 main, 8–9 accessories",
    exercise_plan: { retain: [{ exercise_id: "e-csq", name: "Competition Squat", why: "" }], replace: [], add: [] },
    decisions: [{ area: "squat", observation: "Competition Squat progressed over the block", evidence: ["Competition Squat"], change: "Keep squat once a week at 5–8 reps", benefit: "Keeps what worked", monitor: "Top set load at RPE 8", basis: "fact", confidence: "high" }],
    coach_requirements: [],
    conflicts: [],
    data_limits: [],
    monitor: ["Session length"],
    ...over,
  });

const e = (id: string, name: string, extra: any = {}) => ({ exercise_id: id, exercise_name: name, role: null, station: null, superset: null, sets: 3, reps: "8-10", rpe: "8", rest_seconds: 90, tempo: null, progression: "Reps to the top of the range, then +2.5 kg", substitutions: [], notes: null, weeks: [{ week: 4, sets: 2, rpe: "6" }], ...extra });
const blockJson = (days = 4, extra: any = {}) =>
  JSON.stringify({
    name: "Strength + hypertrophy",
    objective: "Progress the main lifts; accessories by double progression",
    weeks: 4,
    week_phases: [{ week: 4, phase: "Deload" }],
    deload_rule: "Week 4: fewer sets, RPE 6",
    progression_rules: ["Double progression"],
    days: [
      { day: 1, title: "Lower A", exercises: [e("e-csq", "Competition Squat", { role: "Primary Squat", reps: "5-8", rest_seconds: 150 }), e("e-bss", "Dumbbell Bulgarian Split Squat", { reps: "8-12 each leg" }), e("e-hcurl", "Bench Hamstring Curl Attachment"), ...(extra.lowerA ?? [])] },
      { day: 2, title: "Upper A", exercises: [e("e-idb", "Incline Bench Press - Dumbbell"), e("e-pull", "Wide-Grip Lat Pulldown"), e("e-row", "Cable Seated On Floor Row")] },
      { day: 3, title: "Lower B", exercises: [e("e-rdl", "Romanian Deadlift"), e("e-lbs", "Landmine Belt Squat"), e("e-lext", "Bench Leg Extension Attachment")] },
      { day: 4, title: "Upper B", exercises: [e("e-bbb", "Barbell Bench Press", { role: "Primary Bench", reps: "5-8", rest_seconds: 150 }), e("e-bor", "Bent-Over Barbell Row"), e("e-lat", "Lateral Raises Dumbbell")] },
    ].slice(0, days),
  });

async function runToEnd(db: any, max = 20) {
  const { runIntelJob } = await import("@/lib/program-intel/jobs.server");
  let r: any = null;
  for (let i = 0; i < max; i++) {
    r = await runIntelJob(db, "job-1");
    if (r.status !== "pending") break;
  }
  return r;
}

describe("Generate Next Program pipeline (background, service role, one stage per request)", () => {
  beforeEach(() => {
    replies.length = 0;
    calls.length = 0;
  });

  it("fast path: context → strategy → block → audit → hidden draft, with a snapshot and every model call logged", async () => {
    replies.push("```json\n" + strategyJson(recommended) + "\n```", blockJson());
    const db = memoryDb(seed(rec, job()));
    const r = await runToEnd(db);
    expect(r.error ?? null).toBeNull();
    const j = db.tables.program_intel_jobs[0];
    expect(j.status).toBe("ready");
    expect(j.stage).toBe("done");
    expect(j.progress.stages.map((s: any) => [s.key, s.status])).toEqual([["context", "done"], ["strategy", "done"], ["construct:0", "done"], ["audit", "done"], ["save", "done"]]);
    // stage 5 used the design model first; prompts carry the setup and the brief
    expect(calls.map((c) => c.model)).toEqual(["google/gemini-3.1-pro-preview", "google/gemini-3.1-pro-preview"]);
    expect(calls[0].prompt).toContain("Write the programming strategy for the next 4-week, 4-day program.");
    expect(calls[0].prompt).toContain("## Previous program: full log, set by set");
    expect(calls[1].prompt).toContain("## The approved strategy");
    expect(calls[1].prompt).toContain("Station 2 — High cable");
    // the library catalog the builder saw only holds what their equipment allows
    expect(calls[1].prompt).not.toMatch(/\| Leg Press \|/);
    expect(db.tables.program_intel_job_calls.map((c: any) => [c.stage, c.ok])).toEqual([["strategy", true], ["construct:0", true]]);
    expect(db.tables.program_intel_job_calls[0].input_tokens).toBe(1000);
    // the snapshot: what the run used
    expect(j.context.data_hash).toBe(intel.dataHash);
    expect(j.context.records_changed).toBe(false);
    expect(j.context.brief.sections.map((s: any) => s.key)).toContain("log");
    expect(j.context.sources.previous_program).toBe("Home Gym 4-Day Strength + Hypertrophy");
    expect(j.context.model).toMatchObject({ primary: "google/gemini-3.1-pro-preview", fallback: "test-model" });
    // the draft: hidden, undated, every week written from its own prescription
    const draft = db.tables.pl_blocks.find((b: any) => b.id === j.block_id);
    expect(draft).toMatchObject({ client_visible: false, status: "Draft", start_date: null, end_date: null, created_by: "coach-1" });
    const weeks = db.tables.pl_weeks.filter((w: any) => w.block_id === draft.id);
    expect(weeks.map((w: any) => [w.week_index, w.phase])).toEqual([[1, null], [2, null], [3, null], [4, "Deload"]]);
    const days = db.tables.pl_days.filter((d: any) => weeks.some((w: any) => w.id === d.week_id));
    expect(days).toHaveLength(16);
    const squat = db.tables.pl_exercise_rows.filter((x: any) => x.exercise_id === "e-csq" && days.some((d: any) => d.id === x.day_id));
    expect(squat.map((x: any) => [x.sets, x.rpe])).toEqual([[3, "8"], [3, "8"], [3, "8"], [2, "6"]]);
    expect(squat[0].notes).toContain("Progress: Reps to the top of the range");
    // scorecard stored, decisions as proposed hypotheses, the original program untouched, nothing created in the library
    expect(j.result.audit.scorecard).toHaveLength(15);
    expect(j.result.audit.scorecard.find((x: any) => x.criterion === "equipment").status).toBe("passed");
    expect(j.result.strategySource).toBe("auto");
    expect(db.tables.program_intel_observations).toEqual([expect.objectContaining({ kind: "decision", status: "proposed", source: "ai", confidence: "hypothesis", block_id: draft.id })]);
    expect(db.tables.pl_blocks.filter((b: any) => b.client_visible !== false)).toHaveLength(3);
    expect(db.tables.exercises).toHaveLength(rec.exercises.length);
  });

  it("review the strategy first: a strategy run stops with the strategy and builds nothing", async () => {
    replies.push(strategyJson(recommended));
    const db = memoryDb(seed(rec, job({ kind: "strategy" })));
    const r = await runToEnd(db);
    expect(r.status).toBe("ready");
    const j = db.tables.program_intel_jobs[0];
    expect(j.result.strategy.decisions).toHaveLength(1);
    expect(db.tables.pl_blocks).toHaveLength(3);
    expect(j.progress.stages.map((s: any) => s.key)).toEqual(["context", "strategy"]);
  });

  it("an approved strategy is used as the coach left it (no strategy call)", async () => {
    replies.push(blockJson());
    const approved = JSON.parse(strategyJson(recommended, { decisions: [{ area: "bench", observation: "o", evidence: [], change: "Coach's own wording", benefit: "", monitor: "", basis: "hypothesis", confidence: "medium" }] }));
    const db = memoryDb(seed(rec, job({ options: { setup: recommended, edited: [], strategy: approved, strategyJobId: "s-1" } })));
    const r = await runToEnd(db);
    expect(r.status).toBe("ready");
    expect(calls).toHaveLength(1);
    expect(calls[0].prompt).toContain("Coach's own wording");
    const j = db.tables.program_intel_jobs[0];
    expect(j.result.strategySource).toBe("coach");
    expect(j.progress.stages.find((s: any) => s.key === "strategy").status).toBe("skipped");
  });

  it("the audit's repairable failures go back for a targeted repair; the reliable parts stay", async () => {
    // block 1 puts a leg press (not in their home gym) on Lower A
    replies.push(strategyJson(recommended), blockJson(4, { lowerA: [e("e-legpress", "Leg Press")] }), blockJson());
    const db = memoryDb(seed(rec, job()));
    const r = await runToEnd(db);
    expect(r.status).toBe("ready");
    const j = db.tables.program_intel_jobs[0];
    expect(j.result.repairs).toHaveLength(1);
    expect(j.result.repairs[0].issues.join(" ")).toMatch(/Leg Press needs/);
    expect(calls[2].prompt).toContain("Fix ONLY these problems");
    expect(db.tables.program_intel_job_calls.map((c: any) => c.stage)).toEqual(["strategy", "construct:0", "repair:block 1"]);
    expect(j.result.audit.scorecard.find((x: any) => x.criterion === "equipment").status).toBe("passed");
    expect(JSON.stringify(j.result.program)).not.toContain("Leg Press\"");
  });

  it("a failed stage stops cleanly and Try again resumes at that stage (finished stages aren't redone)", async () => {
    replies.push(strategyJson(recommended), "not json", "still not json");
    const db = memoryDb(seed(rec, job()));
    const r = await runToEnd(db);
    expect(r.status).toBe("error");
    const j = db.tables.program_intel_jobs[0];
    expect(j.stage).toBe("construct:0");
    expect(j.progress.stages.find((s: any) => s.key === "construct:0").status).toBe("error");
    expect(j.progress.stages.find((s: any) => s.key === "strategy").status).toBe("done");
    expect(db.tables.pl_blocks.filter((b: any) => b.status === "Draft")).toHaveLength(0);
    // retry
    Object.assign(j, { status: "pending", attempts: 0 });
    calls.length = 0;
    replies.push(blockJson());
    const r2 = await runToEnd(db);
    expect(r2.status).toBe("ready");
    expect(calls).toHaveLength(1);
    expect(calls[0].prompt).toContain("## Build block 1 of 1");
  });

  it("4 → 3 days: the setup reaches the AI; a strategy that ignores it is sent back with the problem named", async () => {
    const three: GenerationSetup = { ...recommended, daysPerWeek: 3, trainingDays: [] };
    replies.push(strategyJson(recommended), strategyJson(three), blockJson(3));
    const db = memoryDb(seed(rec, job({ options: { setup: three, edited: ["daysPerWeek"] } })));
    const r = await runToEnd(db);
    expect(r.status).toBe("ready");
    expect(calls[0].prompt).toContain("Write the programming strategy for the next 4-week, 3-day program.");
    expect(calls[0].prompt).toContain("Days per week: the coach changed it");
    expect(calls[0].prompt).toContain("4 → 3 days");
    expect(calls[1].prompt).toContain("structure.days_per_week is 4; the coach's setup is 3 days.");
    const j = db.tables.program_intel_jobs[0];
    expect(j.context.redistribution.toDays).toBe(3);
    const days = db.tables.pl_days.filter((d: any) => db.tables.pl_weeks.some((w: any) => w.id === d.week_id && w.block_id === j.block_id));
    expect(days).toHaveLength(12);
  });

  it("blocking conflicts stop the run before any AI call", async () => {
    const bad: GenerationSetup = { ...recommended, required: [{ id: "e-csq", name: "Competition Squat" }], excluded: [{ id: "e-csq", name: "Competition Squat" }] };
    const db = memoryDb(seed(rec, job({ options: { setup: bad, edited: ["required", "excluded"] } })));
    const r = await runToEnd(db);
    expect(r.status).toBe("error");
    expect(db.tables.program_intel_jobs[0].error).toMatch(/Resolve before generating: Competition Squat is both required and excluded/);
    expect(calls).toHaveLength(0);
  });

  it("falls back to the app's default model when the design model fails, and logs both", async () => {
    replies.push(new Error("model not available"), strategyJson(recommended));
    const db = memoryDb(seed(rec, job({ kind: "strategy" })));
    const r = await runToEnd(db);
    expect(r.status).toBe("ready");
    expect(calls.map((c) => c.model)).toEqual(["google/gemini-3.1-pro-preview", "test-model"]);
    expect(db.tables.program_intel_job_calls.map((c: any) => [c.model, c.ok])).toEqual([["google/gemini-3.1-pro-preview", false], ["test-model", true]]);
  });

  it("refuses when the coach who asked no longer coaches the client", async () => {
    const db = memoryDb(seed(rec, job()), { canCoach: false });
    const r = await runToEnd(db);
    expect(r.status).toBe("error");
    expect(db.tables.program_intel_jobs[0].error).toContain("no longer coaches");
    expect(db.tables.pl_blocks).toHaveLength(3);
  });

  it("leaves nothing behind if writing the draft fails part-way", async () => {
    replies.push(strategyJson(recommended), blockJson());
    const db = memoryDb(seed(rec, job()), { failRowsInsert: true });
    const r = await runToEnd(db);
    expect(r.status).toBe("error");
    expect(db.tables.pl_blocks).toHaveLength(3);
    expect(db.tables.program_intel_jobs[0].stage).toBe("save");
  });

  it("privacy-safe runs send no name, notes or check-ins", async () => {
    replies.push(strategyJson(recommended));
    const named = homeGym();
    named.client.full_name = "Marcus Example";
    const db = memoryDb(seed(named, job({ kind: "strategy", privacy_safe: true })));
    await runToEnd(db);
    expect(calls[0].prompt).not.toContain("Marcus");
    expect(calls[0].prompt).toContain("Name: Athlete");
  });

  it("interpret: proposals stored as hypotheses waiting for review, with their evidence", async () => {
    replies.push(JSON.stringify({ observations: [{ statement: "Squat may respond to 2x frequency", category: "squat", evidence: ["B1·W2 squat e1RM"] }], questions: ["Sleep?"] }));
    const db = memoryDb(seed(rec, job({ kind: "interpret", scope: { kind: "program" } })));
    const r = await runToEnd(db);
    expect(r.status).toBe("ready");
    expect(db.tables.program_intel_observations).toEqual([expect.objectContaining({ kind: "observation", status: "proposed", source: "ai", confidence: "hypothesis", evidence: ["B1·W2 squat e1RM"] })]);
  });

  it("a job already running elsewhere (and fresh) isn't taken twice", async () => {
    const db = memoryDb(seed(rec, job({ status: "running", updated_at: new Date().toISOString() })));
    const { runIntelJob } = await import("@/lib/program-intel/jobs.server");
    expect(await runIntelJob(db, "job-1")).toEqual({ status: "idle" });
  });
});
