import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  draftBlockDates,
  exerciseRow,
  generationSystemPrompt,
  interpretReplySchema,
  parseJsonReply,
  programReplySchema,
  resolveProgramExercises,
  weekRx,
  type ProgramReply,
} from "@/lib/program-intel/next-program";
import { currentProgramBlocks, fetchAll, fetchByIds } from "@/lib/program-intel/load";

const program = (over: Partial<ProgramReply> = {}): any => ({
  program_name: "Next cycle",
  summary: "Squat progressed at 2x/week.",
  blocks: [
    {
      name: "Accumulation",
      focus: "Volume",
      weeks: 3,
      week_phases: [{ week: 3, phase: "Deload" }],
      days: [
        {
          title: "Squat day",
          exercises: [
            { exercise_id: "ex-squat", exercise_name: "Comp Squat (typo)", role: "Primary Squat", sets: 4, reps: "5", rpe: "7", weeks: [{ week: 2, rpe: "8" }, { week: 3, sets: 2, rpe: "6" }] },
            { exercise_id: null, exercise_name: "Bulgarian Split Squat", sets: 3, reps: "8-10", rpe: "8" },
            { exercise_id: "made-up-id", exercise_name: "Zercher Moonwalk", sets: 3, reps: "10" },
          ],
        },
      ],
    },
  ],
  progression: "RPE +1 a week",
  recovery: "Deload week 3",
  changes: [{ change: "Squat 2x/week", why: "Progressed +4% at 2x", evidence: ["B1·W2 squat"], basis: "fact" }],
  watch: [],
  ...over,
});

describe("Generate Next Program: the model's answer is checked before anything is written", () => {
  it("JSON is pulled out of fences and prose, and must match the shape", () => {
    const ok = parseJsonReply("Sure!\n```json\n" + JSON.stringify(program()) + "\n```", programReplySchema);
    expect(ok.ok).toBe(true);
    const bad = parseJsonReply('{"program_name": "x"}', programReplySchema);
    expect(bad.ok).toBe(false);
    expect(parseJsonReply("no json here", programReplySchema).ok).toBe(false);
    // at most 16 weeks in total
    const long = program({ blocks: [{ ...program().blocks[0], weeks: 12 }, { ...program().blocks[0], weeks: 12 }] });
    expect(parseJsonReply(JSON.stringify(long), programReplySchema).ok).toBe(false);
  });
  it("an unknown basis reads as a hypothesis, never as a fact", () => {
    const p = parseJsonReply(JSON.stringify(program({ changes: [{ change: "x", why: "y", evidence: [], basis: "certain" as any }] })), programReplySchema);
    expect(p.ok && p.value.changes![0].basis).toBe("hypothesis");
  });
  it("interpretations are capped and carry evidence", () => {
    const p = parseJsonReply(JSON.stringify({ observations: [{ statement: "Squat responds to frequency", category: "squat", evidence: ["B1·W2"] }], questions: ["Sleep?"] }), interpretReplySchema);
    expect(p.ok && p.value.observations![0].evidence).toEqual(["B1·W2"]);
  });
  it("exercises: catalog ids keep the library's name, names resolve through the library, the rest stay unmatched; nothing is created", async () => {
    const parsed = programReplySchema.parse(program());
    const known = new Map([["ex-squat", "Competition Squat"], ["ex-bss", "Bulgarian Split Squat"]]);
    const asked: string[] = [];
    const { program: out, unmatched } = await resolveProgramExercises(parsed, known, async (name) => {
      asked.push(name);
      return name === "Bulgarian Split Squat" ? "ex-bss" : null;
    });
    const ex = out.blocks[0].days[0].exercises;
    expect(ex[0]).toMatchObject({ exercise_id: "ex-squat", exercise_name: "Competition Squat" });
    expect(ex[1]).toMatchObject({ exercise_id: "ex-bss", exercise_name: "Bulgarian Split Squat" });
    // an id the model made up is never trusted: it goes through the name, and stays a name if the library doesn't know it
    expect(ex[2]).toMatchObject({ exercise_id: null, exercise_name: "Zercher Moonwalk" });
    expect(unmatched).toEqual(["Zercher Moonwalk"]);
    expect(asked).toEqual(["Bulgarian Split Squat", "Zercher Moonwalk"]);
  });
  it("each week's rows: the base prescription with that week's overrides, % as % of estimated 1RM, unmatched as a name only", () => {
    const parsed = programReplySchema.parse(program());
    const sq = parsed.blocks[0].days[0].exercises[0];
    expect(weekRx(sq, 1)).toMatchObject({ sets: 4, reps: "5", rpe: "7" });
    expect(weekRx(sq, 2)).toMatchObject({ sets: 4, rpe: "8" });
    expect(weekRx(sq, 3)).toMatchObject({ sets: 2, rpe: "6" });
    const r = exerciseRow(sq, 3, 0);
    expect(r).toMatchObject({ sets: 2, reps_text: "5", rpe: "6", exercise_id: "ex-squat", exercise_name_override: null, purpose_label: "Primary Squat", sort_order: 0 });
    const pct = exerciseRow({ ...sq, percentage: 80, rpe: null }, 1, 1);
    expect(pct).toMatchObject({ percentage: 80, percentage_basis: "est_1rm" });
    const named = exerciseRow({ exercise_id: null, exercise_name: "Zercher Moonwalk", sets: 3, reps: "10" } as any, 1, 2);
    expect(named).toMatchObject({ exercise_id: null, exercise_name_override: "Zercher Moonwalk" });
  });
  it("assigning: blocks back to back from the start date, each week seven days", () => {
    const d = draftBlockDates("2026-11-02", [3, 2]);
    expect(d[0]).toMatchObject({ start: "2026-11-02", end: "2026-11-22" });
    expect(d[0].weeks[2]).toEqual({ start: "2026-11-16", end: "2026-11-22" });
    expect(d[1]).toMatchObject({ start: "2026-11-23", end: "2026-12-06" });
  });
  it("each brain writes from the athlete's response, cites evidence and uses the library", () => {
    for (const b of ["powerlifting", "bodybuilding", "powerbuilding", "general_fitness"] as const) {
      const s = generationSystemPrompt(b);
      expect(s).toContain("never a generic template");
      expect(s).toContain("Never invent past results");
      expect(s).toContain("exercise_id values from the catalog");
    }
    expect(generationSystemPrompt("powerlifting")).toContain("squat, bench and deadlift independently");
    expect(generationSystemPrompt("bodybuilding")).toContain("weekly hard sets per muscle");
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
  });
  it("an AI statement is stored as a hypothesis until the coach approves it", () => {
    expect(sql).toContain("check (source <> 'ai' or confidence = 'hypothesis' or status in ('approved', 'corrected'))");
    const worker = readFileSync("src/lib/program-intel/jobs.server.ts", "utf8");
    expect(worker.match(/confidence: "hypothesis",\n\s+status: "proposed",\n\s+source: "ai"/g)).toHaveLength(2);
  });
  it("a draft is hidden, undated and never assigned by the AI", () => {
    const worker = readFileSync("src/lib/program-intel/jobs.server.ts", "utf8");
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
