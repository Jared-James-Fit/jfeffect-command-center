import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { builtBlockSchema, strategySchema, type BuiltProgram } from "@/lib/program-intel/generator-schemas";
import { constructSystemPrompt, strategySystemPrompt } from "@/lib/program-intel/generator-prompts";
import { draftBlockDates, exerciseRow, interpretReplySchema, parseJsonReply, resolveProgramExercises } from "@/lib/program-intel/next-program";
import { rxForWeek } from "@/lib/program-intel/program-view";
import { blockIssues, strategyIssues } from "@/lib/program-intel/pipeline.server";
import { DEFAULT_ROUTES, resolveRoute, STRONG_MODELS } from "@/lib/ai/routing";
import { BRAINS } from "@/lib/program-intel/types";
import { currentProgramBlocks, lastTrainedByBlock, fetchAll, fetchByIds } from "@/lib/program-intel/load";

const block = (over: any = {}): any => ({
  name: "Accumulation",
  objective: "Volume",
  weeks: 3,
  week_phases: [{ week: 3, phase: "Deload" }],
  deload_rule: "Week 3: half the sets",
  progression_rules: ["Add load when the top of the range is hit at the target RPE"],
  days: [
    {
      title: "Squat day",
      exercises: [
        { exercise_id: "ex-squat", exercise_name: "Comp Squat (typo)", role: "Primary Squat", sets: 4, reps: "5", rpe: "7", rest_seconds: 180, progression: "+2.5 kg when all sets ≤ RPE 7", substitutions: [{ exercise_id: null, exercise_name: "Safety Bar Squat" }], weeks: [{ week: 2, rpe: "8" }, { week: 3, sets: 2, rpe: "6" }] },
        { exercise_id: null, exercise_name: "Bulgarian Split Squat", sets: 3, reps: "8-10", rpe: "8" },
        { exercise_id: "made-up-id", exercise_name: "Zercher Moonwalk", sets: 3, reps: "10" },
      ],
    },
  ],
  ...over,
});
const program = (over: any = {}): BuiltProgram => ({ program_name: "Next cycle", summary: "", blocks: [builtBlockSchema.parse(block(over))], progression: "", recovery: "", changes: [], watch: [] });

describe("Generate Next Program: every stage's answer is checked before it's used", () => {
  it("JSON is pulled out of fences and prose, and must match the block shape", () => {
    const ok = parseJsonReply("Sure!\n```json\n" + JSON.stringify(block()) + "\n```", builtBlockSchema);
    expect(ok.ok).toBe(true);
    expect(parseJsonReply('{"name": "x"}', builtBlockSchema).ok).toBe(false);
    expect(parseJsonReply("no json here", builtBlockSchema).ok).toBe(false);
    expect(parseJsonReply(JSON.stringify(block({ weeks: 13 })), builtBlockSchema).ok).toBe(false);
  });
  it("a strategy needs at least one decision; an unknown basis reads as a hypothesis, never a fact", () => {
    const base = { athlete_read: "x", previous_program: {}, progression: {}, structure: { weeks: 4, days_per_week: 4, blocks: [{ name: "A", weeks: 4 }] }, weekly_layout: [{ day: 1, title: "A" }], exercise_plan: {} };
    expect(parseJsonReply(JSON.stringify({ ...base, decisions: [] }), strategySchema).ok).toBe(false);
    const p = parseJsonReply(JSON.stringify({ ...base, decisions: [{ observation: "o", change: "c", basis: "certain" }] }), strategySchema);
    expect(p.ok && p.value.decisions[0].basis).toBe("hypothesis");
  });
  it("the strategy must match the coach's setup; a block must match the strategy", () => {
    const s = strategySchema.parse({ athlete_read: "x", previous_program: {}, progression: {}, structure: { weeks: 5, days_per_week: 3, blocks: [{ name: "A", weeks: 4 }] }, weekly_layout: [{ day: 1, title: "A" }], exercise_plan: { retain: [{ name: "Leg Press" }] }, decisions: [{ observation: "o", change: "c" }] });
    const issues = strategyIssues(s, { weeks: 4, daysPerWeek: 4, excluded: [{ id: null, name: "Leg Press" }], required: [{ id: null, name: "Nordic Curl" }] } as any);
    expect(issues.join(" ")).toMatch(/structure.weeks is 5/);
    expect(issues.join(" ")).toMatch(/days_per_week is 3/);
    expect(issues.join(" ")).toMatch(/add up to 4, not 5/);
    expect(issues.join(" ")).toMatch(/weekly_layout has 1 days/);
    expect(issues.join(" ")).toMatch(/Leg Press is excluded/);
    expect(issues.join(" ")).toMatch(/Nordic Curl isn't in exercise_plan/);
    expect(blockIssues(builtBlockSchema.parse(block()), { weeks: 4, days: 2 })).toHaveLength(2);
    // blocks the coach set are kept; otherwise the strategy picks them
    const ok = strategySchema.parse({ athlete_read: "x", previous_program: {}, progression: {}, structure: { weeks: 12, days_per_week: 1, blocks: [{ name: "A", weeks: 7 }, { name: "B", weeks: 5 }] }, weekly_layout: [{ day: 1, title: "A" }], exercise_plan: {}, decisions: [{ observation: "o", change: "c" }] });
    expect(strategyIssues(ok, { weeks: 12, daysPerWeek: 1, blocks: [], excluded: [], required: [] } as any)).toEqual([]);
    expect(strategyIssues(ok, { weeks: 12, daysPerWeek: 1, blocks: [{ name: "A", weeks: 4, objective: "" }, { name: "B", weeks: 4, objective: "" }, { name: "C", weeks: 4, objective: "" }], excluded: [], required: [] } as any).join(" ")).toMatch(/The coach set the blocks: A 4 wk, B 4 wk, C 4 wk/);
    // no block runs longer than 12 weeks (a longer program is several, each built in its own request)
    expect(() => strategySchema.parse({ ...ok, structure: { weeks: 16, days_per_week: 1, blocks: [{ name: "A", weeks: 16 }] } })).toThrow();
  });
  it("interpretations are capped and carry evidence", () => {
    const p = parseJsonReply(JSON.stringify({ observations: [{ statement: "Squat responds to frequency", category: "squat", evidence: ["B1·W2"] }], questions: ["Sleep?"] }), interpretReplySchema);
    expect(p.ok && p.value.observations![0].evidence).toEqual(["B1·W2"]);
  });
  it("exercises: catalog ids keep the library's name, names resolve through the library, the rest stay unmatched; swaps are settled too; nothing is created", async () => {
    const known = new Map([["ex-squat", "Competition Squat"], ["ex-bss", "Bulgarian Split Squat"], ["ex-ssb", "Safety Bar Squat"]]);
    const asked: string[] = [];
    const { program: out, unmatched } = await resolveProgramExercises(program(), known, async (name) => {
      asked.push(name);
      return name === "Bulgarian Split Squat" ? "ex-bss" : name === "Safety Bar Squat" ? "ex-ssb" : null;
    });
    const ex = out.blocks[0].days[0].exercises;
    expect(ex[0]).toMatchObject({ exercise_id: "ex-squat", exercise_name: "Competition Squat" });
    expect(ex[0].substitutions[0]).toMatchObject({ exercise_id: "ex-ssb", exercise_name: "Safety Bar Squat" });
    expect(ex[1]).toMatchObject({ exercise_id: "ex-bss", exercise_name: "Bulgarian Split Squat" });
    // an id the model made up is never trusted: it goes through the name, and stays a name if the library doesn't know it
    expect(ex[2]).toMatchObject({ exercise_id: null, exercise_name: "Zercher Moonwalk" });
    expect(unmatched).toEqual(["Zercher Moonwalk"]);
    expect(asked).toEqual(["Safety Bar Squat", "Bulgarian Split Squat", "Zercher Moonwalk"]);
  });
  it("each week's rows: the base with that week's changes, rest, the progression rule and swaps in the athlete's notes, unmatched as a name only", () => {
    const b = builtBlockSchema.parse(block());
    const sq = b.days[0].exercises[0];
    expect(rxForWeek(sq, 1)).toMatchObject({ sets: 4, reps: "5", rpe: "7" });
    expect(rxForWeek(sq, 2)).toMatchObject({ sets: 4, rpe: "8" });
    expect(rxForWeek(sq, 3)).toMatchObject({ sets: 2, rpe: "6" });
    const r = exerciseRow(sq, 3, 0);
    expect(r).toMatchObject({ sets: 2, reps_text: "5", rpe: "6", rest_seconds: 180, exercise_id: "ex-squat", exercise_name_override: null, purpose_label: "Primary Squat", sort_order: 0 });
    expect(String(r.notes)).toContain("Progress: +2.5 kg when all sets ≤ RPE 7");
    expect(String(r.notes)).toContain("Swap if needed: Safety Bar Squat");
    const pct = exerciseRow({ ...sq, percentage: 80, rpe: null, weeks: [] }, 1, 1);
    expect(pct).toMatchObject({ percentage: 80, percentage_basis: "est_1rm" });
    // after resolution an unknown exercise has no id: it's written by name only
    const named = exerciseRow({ ...b.days[0].exercises[2], exercise_id: null }, 1, 2);
    expect(named).toMatchObject({ exercise_name_override: "Zercher Moonwalk" });
  });
  it("coaching decisions go to the top tier only; building may fall back further", () => {
    for (const t of ["strategy", "review", "interpret"] as const) {
      expect(DEFAULT_ROUTES[t].strongOnly).toBe(true);
      expect(DEFAULT_ROUTES[t].models.every((m) => STRONG_MODELS.includes(m))).toBe(true);
    }
    // building: GPT-5.5 (the same audit results as Flash in the benchmark, on the OpenAI key), Astra behind it
    expect(DEFAULT_ROUTES.construct.models).toEqual(["openai:gpt-5.5", "openai:gpt-6-astra"]);
    // no default spends Lovable credits: every route is on the OpenAI key
    expect(Object.values(DEFAULT_ROUTES).flatMap((r) => r.models).every((m) => m.startsWith("openai:"))).toBe(true);
    // no route leans on a model that can't finish inside one request through the gateway
    expect(Object.values(DEFAULT_ROUTES).flatMap((r) => r.models).some((m) => m.startsWith("gateway:anthropic/"))).toBe(false);
    // an admin override can't put a weaker model on a coaching decision; a benchmark can, on purpose
    expect(resolveRoute("strategy", { strategy: ["gateway:google/gemini-3-flash-preview"] }).models).toEqual(DEFAULT_ROUTES.strategy.models);
    expect(resolveRoute("strategy", { strategy: ["gateway:google/gemini-3-flash-preview"] }, { anyModel: true }).models).toEqual(["gateway:google/gemini-3-flash-preview"]);
    expect(resolveRoute("construct", { construct: ["gateway:anthropic/claude-sonnet-5"] }).models).toEqual(["gateway:anthropic/claude-sonnet-5"]);
    expect(strategySystemPrompt("powerbuilding")).toContain("An observation that links a cause");
  });
  it("assigning: blocks back to back from the start date, each week seven days", () => {
    const d = draftBlockDates("2026-11-02", [3, 2]);
    expect(d[0]).toMatchObject({ start: "2026-11-02", end: "2026-11-22" });
    expect(d[0].weeks[2]).toEqual({ start: "2026-11-16", end: "2026-11-22" });
    expect(d[1]).toMatchObject({ start: "2026-11-23", end: "2026-12-06" });
  });
  it("every brain writes from the athlete's response, cites evidence, and builds from the library and their equipment", () => {
    for (const b of BRAINS) {
      const s = strategySystemPrompt(b);
      expect(s).toContain("never a generic template");
      expect(s).toContain("Never compute, estimate or invent a past result");
      expect(s).toContain("Observation → Evidence → Proposed change → Expected benefit → What to monitor");
      const c = constructSystemPrompt(b);
      expect(c).toContain("exercise_id values from the catalog");
      expect(c).toContain("Only use exercises the athlete's equipment allows");
      expect(c).toContain("no fake progression");
    }
    expect(strategySystemPrompt("powerlifting")).toContain("squat, bench and deadlift independently");
    expect(strategySystemPrompt("powerlifting")).toContain('never impose a generic rule (e.g. "bench 3×/week")');
    expect(strategySystemPrompt("bodybuilding")).toContain("do not raise volume just because they progressed");
    expect(strategySystemPrompt("powerbuilding")).toContain("Prioritize the main strength lifts");
  });
});

describe("Program Intelligence loader never cuts a list short", () => {
  it("reads page after page until a short page", async () => {
    const all = Array.from({ length: 2345 }, (_, i) => i);
    const calls: Array<[number, number]> = [];
    const out = await fetchAll<number>(async (from, to) => {
      calls.push([from, to]);
      return { data: all.slice(from, to + 1), error: null };
    });
    expect(out).toHaveLength(2345);
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });
  it("an error is never swallowed into a short list", async () => {
    await expect(fetchAll(async () => ({ data: null, error: { message: "permission denied" } }))).rejects.toThrow("permission denied");
  });
  it("any number of ids, in chunks, every page of each", async () => {
    const ids = Array.from({ length: 400 }, (_, i) => `id${i}`);
    const out = await fetchByIds<string>(ids, async (chunk) => ({ data: chunk, error: null }));
    expect(out).toHaveLength(400);
  });
  it("current program: the blocks of the current block's meet prep; a lone block without one; archived and backups left out", () => {
    const b = (id: string, prep: string | null, start: string, end: string, extra: any = {}) => ({ id, prep_id: prep, name: id, status: "Active", start_date: start, end_date: end, weeks: 4, training_focus: null, goal: null, coach_notes: null, client_visible: true, archived: false, sort_order: 0, created_at: start, ...extra });
    const blocks = [b("old", "p0", "2026-01-01", "2026-02-01"), b("b1", "p1", "2026-09-01", "2026-09-28"), b("b2", "p1", "2026-09-29", "2026-11-30"), b("arch", "p1", "2026-08-01", "2026-08-28", { archived: true })];
    const cur = currentProgramBlocks(blocks, "2026-10-15");
    expect(cur.blocks.map((x) => x.id)).toEqual(["b1", "b2"]);
    const lone = currentProgramBlocks([b("solo", null, "2026-10-01", "2026-10-31")], "2026-10-15");
    expect(lone.blocks.map((x) => x.id)).toEqual(["solo"]);
  });
  it("two programs overlapping today (a replaced one never archived): the one they train, never the one created first (Alyssa, Nov 9 2026)", () => {
    const b = (id: string, prep: string, start: string, end: string, created: string) => ({ id, prep_id: prep, name: id, status: "Draft", start_date: start, end_date: end, weeks: 4, training_focus: null, goal: null, coach_notes: null, client_visible: true, archived: false, sort_order: 0, created_at: created });
    // the old program (made Sep 7, 2 workouts ever) and the meet prep she trains (made Sep 28)
    const blocks = [
      b("old1", "old", "2026-09-07", "2026-09-27", "2026-09-07"),
      b("old3", "old", "2026-11-02", "2026-11-29", "2026-09-07"),
      b("new1", "meet", "2026-09-28", "2026-10-18", "2026-09-28"),
      b("new2", "meet", "2026-10-19", "2026-11-08", "2026-09-28"),
      b("new3", "meet", "2026-11-09", "2026-11-22", "2026-09-28"),
    ];
    const trained = new Map([["old1", "2026-09-10"], ["new1", "2026-10-15"], ["new2", "2026-11-06"]]);
    expect(currentProgramBlocks(blocks, "2026-11-09", trained).prepId).toBe("meet");
    // with no training read yet, the later start wins, still never the first created
    expect(currentProgramBlocks(blocks, "2026-11-09").prepId).toBe("meet");
    expect(lastTrainedByBlock({ weeks: [{ id: "w", block_id: "new2" }] as any, days: [{ id: "d", week_id: "w" }] as any, completions: [{ day_id: "d", completed_at: "2026-11-06T18:00:00Z" }, { day_id: "d", completed_at: null }] as any }).get("new2")).toBe("2026-11-06");
  });
});

describe("Program Intelligence is for the client's coaches and admins only", () => {
  const sql = readFileSync("supabase/migrations/20270112090000_program_intelligence.sql", "utf8");
  it("every table has RLS, admin-or-coached-client policies only, nothing for anon", () => {
    for (const t of ["program_intel_observations", "program_intel_profiles", "program_intel_jobs", "program_intel_exports"]) {
      expect(sql).toContain(`alter table public.${t} enable row level security;`);
    }
    const policies = sql.match(/create policy[\s\S]*?;/g) ?? [];
    expect(policies.length).toBeGreaterThanOrEqual(7);
    for (const p of policies) expect(p).toContain("(select public.has_role((select auth.uid()), 'admin'::app_role)) or client_id in (select public.coached_client_ids())");
    expect(sql).toContain("revoke all on public.program_intel_observations, public.program_intel_profiles, public.program_intel_jobs, public.program_intel_exports from anon;");
  });
  it("a coach can only queue a run as themselves, never write its result or its draft block; the worker re-checks the coach", () => {
    expect(sql).toContain("created_by = (select auth.uid())\n    and status = 'pending'\n    and block_id is null");
    expect(sql).toContain("raise exception 'Only the status of a Program Intelligence run can change'");
    expect(sql).toContain("grant execute on function public.program_intel_can_coach(uuid, uuid) to service_role;");
    const worker = readFileSync("src/lib/program-intel/jobs.server.ts", "utf8");
    expect(worker).toContain('admin.rpc("program_intel_can_coach", { _user: job.created_by, _client: job.client_id })');
    const pipeline = readFileSync("src/lib/program-intel/pipeline.server.ts", "utf8");
    expect(pipeline).toContain('admin.rpc("program_intel_can_coach", { _user: job.created_by, _client: job.client_id })');
  });
  it("the model calls log is readable by the client's coaches only and written only by the worker", () => {
    const v2 = readFileSync("supabase/migrations/20270113090000_program_intel_generator_v2.sql", "utf8");
    expect(v2).toContain("alter table public.program_intel_job_calls enable row level security;");
    expect(v2).toContain("revoke all on public.program_intel_job_calls from anon, authenticated;");
    expect(v2).toContain("grant select on public.program_intel_job_calls to authenticated;");
    expect(v2).not.toMatch(/grant (insert|update|delete)[^;]*program_intel_job_calls/);
    expect(v2).toContain("or new.stage is distinct from old.stage or new.progress is distinct from old.progress");
    expect(v2).toContain("and stage is null\n    and progress is null\n    and context is null\n    and result is null");
  });
  it("an AI statement is stored as a hypothesis until the coach approves it", () => {
    expect(sql).toContain("check (source <> 'ai' or confidence = 'hypothesis' or status in ('approved', 'corrected'))");
    const worker = readFileSync("src/lib/program-intel/jobs.server.ts", "utf8") + readFileSync("src/lib/program-intel/pipeline.server.ts", "utf8");
    expect(worker.match(/confidence: "hypothesis",\n\s+status: "proposed",\n\s+source: "ai"/g)).toHaveLength(2);
  });
  it("a draft is hidden, undated and never assigned by the AI", () => {
    const worker = readFileSync("src/lib/program-intel/pipeline.server.ts", "utf8");
    expect(worker).toContain('status: "Draft",\n          client_visible: false,\n          start_date: null,\n          end_date: null,');
    expect(worker).not.toContain("client_visible: true");
    expect(worker).not.toContain("realignClientToCommittedDays");
    const fns = readFileSync("src/lib/program-intel/intel.functions.ts", "utf8");
    // only the coach's Assign makes it visible
    expect(fns.match(/client_visible: true/g)).toHaveLength(1);
    expect(fns).toContain('if (job.status !== "ready") throw new Error');
  });
  it("the page is gated to coaches (view-only logins see a note) and reads with the coach's own session", () => {
    const page = readFileSync("src/components/program-intel/ProgramIntelligencePage.tsx", "utf8");
    expect(page).toContain("if (viewOnly)");
    const hooks = readFileSync("src/components/program-intel/use-program-intel.ts", "utf8");
    expect(hooks).toContain('import { supabase } from "@/integrations/supabase/client";');
    expect(hooks).not.toContain("supabaseAdmin");
  });
});

describe("a lift's trend across blocks reads as the evidence says (Jared's bench, Nov 9 2026)", () => {
  it("+1.2% and +13% is one block progressed and one small gain, never 'didn't progress in any'", async () => {
    const { liftTrend } = await import("@/lib/program-intel/patterns");
    expect(liftTrend("Bench", [1.2, 13]).statement).toBe("Bench progressed (+2% e1RM or more) in 1 of the 2 blocks with enough data, with a small gain (1 to 2%) in 1.");
    expect(liftTrend("Bench", [3, 13]).statement).toMatch(/progressed in every one of the 2/);
    expect(liftTrend("Bench", [0.5, -4]).statement).toMatch(/didn't progress in any of the 2/);
    expect(liftTrend("Bench", [1.5, 0.2, -1]).statement).toBe("Bench made at most small gains (under 2% e1RM) in the 3 blocks with enough data: a small gain in 1, none in 2.");
    expect(liftTrend("Squat", [4, 1.1, 0]).statement).toBe("Squat progressed (+2% e1RM or more) in 1 of the 3 blocks with enough data, with a small gain (1 to 2%) in 1 and no progress in 1.");
  });
});

describe("a thorough model answer is read, never wiped (Nov 9 2026 benchmark)", () => {
  const base = { athlete_read: "x", previous_program: {}, progression: {}, structure: { weeks: 4, days_per_week: 2, blocks: [{ name: "A", weeks: 4 }] }, weekly_layout: [{ day: 1, title: "A" }], exercise_plan: {}, decisions: [{ observation: "o", change: "c" }] };
  it("long text is kept (cut only past its cap), and an object where text belongs is kept as its text", () => {
    const intensity = "RPE 7–8 on compounds, ".repeat(60); // ~1300 characters: a 900 cap used to make it ""
    const s = strategySchema.parse({ ...base, intensity, progression: { model: { main: "+2.5 kg when every set is at RPE 8 or under", accessories: "double progression" } } });
    expect(s.intensity).toBe(intensity.trim());
    expect(s.progression.model).toContain("+2.5 kg when every set");
    expect(strategySchema.parse({ ...base, intensity: "x".repeat(9000) }).intensity).toHaveLength(4000);
  });
  it("one long or broken item never empties the list: the rest are kept", () => {
    const s = strategySchema.parse({
      ...base,
      frequency_targets: [
        { target: "Back — direct upper/mid-back work, averaged over alternating weeks", per_week: 3.5 },
        { target: "Chest", per_week: 3 },
        { target: "Quads", per_week: "nine" },
      ],
      weekly_layout: [{ day: 1, title: "Monday", primary: ["Competition Squat", "Paused Bench", "Romanian Deadlift", "Chest Supported Row", "Leg Press", "Lat Pulldown"] }],
    });
    expect(s.frequency_targets.map((f) => f.target)).toEqual(["Back — direct upper/mid-back work, averaged over alternating weeks", "Chest"]);
    expect(s.weekly_layout[0].primary).toHaveLength(6);
  });
  it("a review issue with a long problem is kept, not the whole list dropped", async () => {
    const { reviewReplySchema } = await import("@/lib/program-intel/coaching-review");
    const r = reviewReplySchema.parse({ verdict: "needs_fixes", issues: [{ block: 1, area: "fatigue", severity: "must_fix", problem: "p".repeat(800), fix: "move it" }, { problem: "" }] });
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0].problem).toHaveLength(800);
  });
});

describe("the brief speaks the athlete's units and plans (blind grading, Nov 9 2026)", () => {
  it("rest-day cardio 2× a week with three days ticked reads as two of those days", async () => {
    const { cardioBriefLines } = await import("@/lib/program-intel/cardio");
    const lines = cardioBriefLines({ source: "plan", origin: "nutrition", why: "their nutrition plan", trainingDay: null, restDay: { type: "Incline Treadmill Walk", minutes: 30, perWeek: 2, weekdays: ["Tuesday", "Saturday", "Sunday"], incline: 5, zone: "Zone 2" }, updatedAt: null, done: null });
    expect(lines.join("\n")).toContain("2× a week (2 of Tuesday, Saturday, Sunday)");
  });
});

describe("a strategy's week-by-week detail is kept (blind grading, Nov 9 2026)", () => {
  it("a phase that carries the week's main-lift prescription isn't cut to a label", () => {
    const phase = "W3 build: Squat 3×4 @RPE 7.5 (top set +2.5 kg if W2 hit), Bench 4×4 @7.5, Deadlift 2×3 @7; accessories hold reps";
    const s = strategySchema.parse({ athlete_read: "x", previous_program: {}, progression: {}, structure: { weeks: 4, days_per_week: 2, blocks: [{ name: "A", weeks: 4, phases: [{ week: 3, phase }] }] }, weekly_layout: [{ day: 1, title: "A", notes: "n".repeat(2000) }], exercise_plan: {}, decisions: [{ observation: "o", change: "c" }] });
    expect(s.structure.blocks[0].phases[0].phase).toBe(phase);
    expect(s.weekly_layout[0].notes).toHaveLength(2000);
  });
});

describe("one impossible week change never fails a block (Devin, Nov 9 2026)", () => {
  it("0 sets in a week's change is dropped for that field; the rest of the change and the block stay", async () => {
    const { builtBlockSchema } = await import("@/lib/program-intel/generator-schemas");
    const ex = { exercise_name: "Leg Press", sets: 3, reps: "10", weeks: [{ week: 4, sets: 0, rpe: "6" }, { week: 2, sets: 4 }] };
    const b = builtBlockSchema.parse({ name: "Block 2", weeks: 4, days: [{ title: "Lower", exercises: [ex] }] });
    expect(b.days[0].exercises[0].weeks).toEqual([{ week: 4, rpe: "6" }, { week: 2, sets: 4 }]);
  });
});

describe("a superset label a model writes long still pairs (Devin, Nov 9 2026)", () => {
  it("'SS A1' / 'Superset A-2' read as A1 / A2; nonsense is no superset; the block stands", async () => {
    const { builtBlockSchema } = await import("@/lib/program-intel/generator-schemas");
    const e = (superset: unknown) => ({ exercise_name: "Curl", sets: 3, reps: "10", superset });
    const b = builtBlockSchema.parse({ name: "B", weeks: 4, days: [{ title: "Arms", exercises: [e("SS A1"), e("Superset A-2"), e("pair with curls"), e("B1"), e(null)] }] });
    expect(b.days[0].exercises.map((x) => x.superset ?? null)).toEqual(["A1", "A2", null, "B1", null]);
  });
});
