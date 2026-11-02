import { beforeEach, describe, expect, it, vi } from "vitest";
import { fixture } from "./program-intel-fixture";

// The AI gateway, answered from the test (never a real call).
const replies: string[] = [];
vi.mock("@/lib/ai-gateway.server", () => ({ createLovableAiGateway: () => (model: string) => ({ model }), DEFAULT_AI_MODEL: "test-model" }));
vi.mock("ai", () => ({ generateText: vi.fn(async () => ({ text: replies.shift() ?? "{}" })) }));
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
    ret = false;
    constructor(public name: string) {}
    select() { if (this.op !== "select") this.ret = true; return this; }
    insert(p: any) { this.op = "insert"; this.payload = p; return this; }
    update(p: any) { this.op = "update"; this.payload = p; return this; }
    delete() { this.op = "delete"; return this; }
    eq(c: string, v: any) { this.f.push((r) => r[c] === v); return this; }
    neq(c: string, v: any) { this.f.push((r) => r[c] !== v); return this; }
    in(c: string, vs: any[]) { this.f.push((r) => vs.includes(r[c])); return this; }
    is(c: string, v: any) { this.f.push((r) => (v === null ? r[c] == null : r[c] === v)); return this; }
    gt(c: string, v: any) { this.f.push((r) => r[c] > v); return this; }
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
        const list = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((p: any) => ({ id: `${this.name}-${++n}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...p }));
        table(this.name).push(...list);
        data = list;
      } else if (this.op === "update") {
        for (const r of rows) Object.assign(r, this.payload, { updated_at: new Date(Date.now() + 1).toISOString() });
        data = rows;
      } else {
        t[this.name] = table(this.name).filter((r) => !rows.includes(r));
        // cascade like the database: a block's weeks, days and rows go with it
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
      if (name === "resolve_exercise_id") return { data: args._name === "Leg Extension" ? "ex-legext" : null, error: null };
      return { data: null, error: null };
    },
  };
}

function seedFromFixture(job: any) {
  const f = fixture();
  return {
    clients: [{ ...f.client, user_id: null }],
    pl_blocks: f.blocks.map((b) => ({ ...b, client_id: "client-1" })),
    pl_weeks: f.weeks.map((w) => ({ ...w, archived: false, deleted_at: null })),
    pl_days: f.days.map((d) => ({ ...d, archived: false, deleted_at: null })),
    pl_exercise_rows: f.rows,
    pl_row_results: f.results.map((r) => ({ ...r, client_id: "client-1" })),
    pl_day_completions: f.completions.map((c) => ({ ...c, client_id: "client-1" })),
    exercises: f.exercises,
    pl_preps: f.preps.map((p) => ({ ...p, client_id: "client-1" })),
    global_ai_config: [{ default_model: "test-model" }],
    program_intel_jobs: [job],
    program_intel_observations: [],
  };
}

const job = (over: any = {}) => ({ id: "job-1", client_id: "client-1", kind: "generate", status: "pending", scope: { kind: "history" }, brain: "powerlifting", instructions: "Keep deadlift once a week", options: { weeks: 2 }, privacy_safe: false, attempts: 0, created_by: "coach-1", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...over });

const programJson = JSON.stringify({
  program_name: "Next cycle",
  summary: "Squat progressed.",
  blocks: [
    {
      name: "Strength",
      focus: "Heavier",
      weeks: 2,
      week_phases: [{ week: 2, phase: "Deload" }],
      days: [
        { title: "Squat", exercises: [{ exercise_id: "ex-squat", exercise_name: "Comp squat", role: "Primary Squat", sets: 4, reps: "4", rpe: "8", weeks: [{ week: 2, sets: 2, rpe: "6" }] }, { exercise_id: null, exercise_name: "Leg Extension", sets: 3, reps: "12", rpe: "8" }] },
        { title: "Bench", exercises: [{ exercise_id: null, exercise_name: "Hover Press Deluxe", sets: 3, reps: "6", rpe: "7" }] },
      ],
    },
  ],
  progression: "Load up 2.5kg a week",
  recovery: "Week 2 deload",
  changes: [{ change: "Squat 4×4", why: "Squat e1RM +4.3% at 3×5", evidence: ["B1·W2"], basis: "fact" }],
  watch: [],
});

describe("Program Intelligence worker (background, service role)", () => {
  beforeEach(() => {
    replies.length = 0;
  });
  it("writes the next program as a hidden, undated draft, weekly changes applied, unknown exercises by name only, changes as proposed decisions", async () => {
    replies.push("```json\n" + programJson + "\n```");
    const db = memoryDb(seedFromFixture(job()));
    const { runIntelJob } = await import("@/lib/program-intel/jobs.server");
    const r = await runIntelJob(db, "job-1");
    expect(r.error ?? null).toBeNull();
    expect(r).toMatchObject({ status: "ready", jobId: "job-1" });
    const j = db.tables.program_intel_jobs[0];
    expect(j.status).toBe("ready");
    const draft = db.tables.pl_blocks.find((b: any) => b.id === j.block_id);
    expect(draft).toMatchObject({ client_visible: false, status: "Draft", start_date: null, end_date: null, client_id: "client-1", created_by: "coach-1" });
    const weeks = db.tables.pl_weeks.filter((w: any) => w.block_id === draft.id);
    expect(weeks.map((w: any) => [w.week_index, w.phase])).toEqual([[1, null], [2, "Deload"]]);
    const days = db.tables.pl_days.filter((d: any) => weeks.some((w: any) => w.id === d.week_id));
    expect(days).toHaveLength(4);
    // week 2's days link to week 1's (like the editor's copy-week)
    const w1 = days.filter((d: any) => d.week_id === weeks[0].id);
    expect(days.filter((d: any) => d.week_id === weeks[1].id).map((d: any) => d.source_day_id)).toEqual(w1.map((d: any) => d.id));
    const rows = db.tables.pl_exercise_rows.filter((x: any) => days.some((d: any) => d.id === x.day_id));
    const squat = rows.filter((x: any) => x.exercise_id === "ex-squat");
    expect(squat.map((x: any) => [x.sets, x.rpe])).toEqual([[4, "8"], [2, "6"]]);
    expect(rows.find((x: any) => x.exercise_name_override === "Hover Press Deluxe")).toMatchObject({ exercise_id: null });
    expect(rows.find((x: any) => x.exercise_id === "ex-legext")).toBeTruthy();
    expect(db.tables.exercises).toHaveLength(3); // nothing created
    expect(j.result.unmatched).toEqual(["Hover Press Deluxe"]);
    const decisions = db.tables.program_intel_observations;
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ kind: "decision", status: "proposed", source: "ai", confidence: "hypothesis", block_id: draft.id });
    expect(decisions[0].evidence[0]).toBe("Basis given: measured records");
  });
  it("asks once more when the reply isn't valid JSON, then fails cleanly", async () => {
    replies.push("not json", "still not json");
    const db = memoryDb(seedFromFixture(job()));
    const { runIntelJob } = await import("@/lib/program-intel/jobs.server");
    const r = await runIntelJob(db, "job-1");
    expect(r.status).toBe("error");
    expect(db.tables.program_intel_jobs[0]).toMatchObject({ status: "error" });
    expect(db.tables.pl_blocks.filter((b: any) => b.status === "Draft")).toHaveLength(0);
  });
  it("refuses when the coach who asked no longer coaches the client", async () => {
    replies.push(programJson);
    const db = memoryDb(seedFromFixture(job()), { canCoach: false });
    const { runIntelJob } = await import("@/lib/program-intel/jobs.server");
    const r = await runIntelJob(db, "job-1");
    expect(r.status).toBe("error");
    expect(db.tables.program_intel_jobs[0].error).toContain("no longer coaches");
    expect(db.tables.pl_blocks).toHaveLength(1);
  });
  it("leaves nothing behind if writing the draft fails part-way", async () => {
    replies.push(programJson);
    const db = memoryDb(seedFromFixture(job()), { failRowsInsert: true });
    const { runIntelJob } = await import("@/lib/program-intel/jobs.server");
    const r = await runIntelJob(db, "job-1");
    expect(r.status).toBe("error");
    expect(db.tables.pl_blocks).toHaveLength(1);
    expect(db.tables.pl_weeks.filter((w: any) => w.block_id !== "b1")).toHaveLength(0);
  });
  it("interpret: proposals stored as hypotheses waiting for review, with their evidence", async () => {
    replies.push(JSON.stringify({ observations: [{ statement: "Squat may respond to 2x frequency", category: "squat", evidence: ["B1·W2 squat e1RM"] }], questions: ["Sleep?"] }));
    const db = memoryDb(seedFromFixture(job({ kind: "interpret" })));
    const { runIntelJob } = await import("@/lib/program-intel/jobs.server");
    const r = await runIntelJob(db, "job-1");
    expect(r.status).toBe("ready");
    expect(db.tables.program_intel_observations).toEqual([expect.objectContaining({ kind: "observation", status: "proposed", source: "ai", confidence: "hypothesis", evidence: ["B1·W2 squat e1RM"] })]);
    expect(db.tables.program_intel_jobs[0].result.questions).toEqual(["Sleep?"]);
  });
  it("a job already running elsewhere (and fresh) isn't taken twice", async () => {
    const db = memoryDb(seedFromFixture(job({ status: "running", updated_at: new Date().toISOString() })));
    const { runIntelJob } = await import("@/lib/program-intel/jobs.server");
    expect(await runIntelJob(db, "job-1")).toEqual({ status: "idle" });
  });
});
