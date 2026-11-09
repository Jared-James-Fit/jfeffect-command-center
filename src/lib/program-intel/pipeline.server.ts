/**
 * Generate Next Program, run as stages in the background (one stage per
 * request, so no request runs long; a failed stage is retried from where it
 * stopped, never from scratch):
 *
 *   context   → stages 1–3: read the full history with the service role
 *               (after re-checking the coach), rebuild the deterministic
 *               intelligence, apply the coach's setup, refuse blocking
 *               conflicts, and write the brief + a snapshot of what it used;
 *   strategy  → stage 4: the programming strategy (skipped when the coach
 *               approved one);
 *   construct → stage 5: one block per request, from the approved strategy;
 *   audit     → stage 6: settle exercises against the library, run the
 *               quality audit; repairable failures go to repair;
 *   repair    → one flagged block per request, then audit again (2 rounds);
 *   save      → stage 7: hidden, undated draft blocks + the decisions as
 *               proposed hypotheses. Nothing is assigned (stage 8 is the
 *               coach's Assign).
 *
 * Every model call is logged with its exact prompt, reply, model and size in
 * program_intel_job_calls (coach-readable) for the context inspector.
 */
import { resolveRoute, type AiTask } from "@/lib/ai/routing";
import type { Effort } from "@/lib/ai/model-client.server";
import { auditProgram, type AuditResult } from "./audit";
import { reviewRepairs, reviewReplySchema, reviewSystemPrompt, reviewUserPrompt, withReview, type CoachingReview, type ReviewReply } from "./coaching-review";
import { buildBrief, CONSTRUCT_EXCLUDE, loadReferences } from "./brief";
import { builtBlockSchema, setupSchema, strategySchema, type BuiltBlock, type BuiltProgram, type Strategy } from "./generator-schemas";
import { constructSystemPrompt, constructUserPrompt, PIPELINE_PROMPT_VERSION, repairUserPrompt, strategySystemPrompt, strategyUserPrompt } from "./generator-prompts";
import { buildGeneratorIntel, type GeneratorIntel } from "./intelligence";
import { privacySafeRecords } from "./export";
import { isLowValueExercise, meetsStandard, withStandardStrategy, withStandardSubstitutions } from "./exercise-standard";
import { loadIntelRecords } from "./load";
import { athleteCatalog, catalogText, equipmentFit, exerciseRow, parseJsonReply, resolveProgramExercises, withoutCardioRows, type CatalogExercise } from "./next-program";
import { generatedProgramOutcomes, outcomeLines } from "./outcomes";
import { benchRecords } from "./bench";
import { findConflicts, horizonFor, redistribution, type GenerationSetup, type SetupField } from "./recommend";
import { BRAIN_LABEL, type Brain, type IntelRecords, type RawExercise } from "./types";

type Db = any;
/**
 * Which model answers each stage comes from the routing table (src/lib/ai/routing.ts): the
 * coaching brain writes the strategy and reviews the program; building and repairs may fall
 * back further. OpenAI models run in background mode: the call is submitted, its id kept on
 * the job, and polled across requests, so a long think never hits a request's time limit.
 */
const MAX_REPAIR_ROUNDS = 2;
/** How long one request polls a background call before handing over to the next request, and how often. */
export const pollConfig = { ms: 200_000, every: 4000 };
/** A gateway (synchronous) call's limit. */
const SYNC_TIMEOUT_MS = 240_000;
/** A background call that hasn't finished by now is given up on (and the next model tried). */
const BACKGROUND_LIMIT_MS = 25 * 60_000;

/** The model hasn't answered yet; the job is re-queued and the next request keeps polling. */
export class WaitingForModel extends Error {
  constructor() {
    super("Waiting for the model");
  }
}

export type StageState = { key: string; label: string; status: "pending" | "running" | "done" | "skipped" | "error"; detail?: string };

function stagesFor(kind: "strategy" | "generate", blocks: number | null, approved: boolean): StageState[] {
  const s: StageState[] = [
    { key: "context", label: "Athlete data, analytics and intelligence", status: "pending" },
    { key: "strategy", label: "Programming strategy", status: approved ? "skipped" : "pending", detail: approved ? "Approved by you" : undefined },
  ];
  if (kind === "generate") {
    const n = blocks ?? 1;
    for (let i = 0; i < n; i++) s.push({ key: `construct:${i}`, label: n > 1 ? `Building block ${i + 1} of ${n}` : "Building the program", status: "pending" });
    s.push({ key: "audit", label: "Quality audit", status: "pending" }, { key: "review", label: "Coaching review", status: "pending" }, { key: "save", label: "Saving the hidden draft", status: "pending" });
  }
  return s;
}

/** Model routing for this job: a benchmark run's own models, else the admin's override, else the defaults. */
async function routeOverride(admin: Db, job: any): Promise<Partial<Record<AiTask, string[]>> | null> {
  if (job.options?.models) return job.options.models;
  const { data } = await admin.from("app_settings").select("value").eq("key", "ai_routes").maybeSingle();
  try {
    return data?.value ? JSON.parse(data.value) : null;
  } catch {
    return null;
  }
}

async function pollFor(id: string, ms: number) {
  const { pollBackground } = await import("@/lib/ai/model-client.server");
  const t0 = Date.now();
  for (;;) {
    const st = await pollBackground(id);
    if (st.status !== "running" || Date.now() - t0 >= ms) return st;
    await new Promise((r) => setTimeout(r, pollConfig.every));
  }
}

/**
 * One model call for a stage, routed (`task`) and logged. `key` names the call within the job: a
 * finished answer is kept on the job (so a stage resumed by the next request never asks twice) and
 * a background call in flight is resumed, not restarted.
 */
async function ask(admin: Db, job: any, result: any, task: AiTask, key: string, system: string, prompt: string): Promise<{ text: string; model: string }> {
  result.calls = result.calls ?? {};
  result.pending = result.pending ?? {};
  if (result.calls[key]) return result.calls[key];
  const { submitBackground, callModel, parseModelRef, ModelHttpError } = await import("@/lib/ai/model-client.server");
  const route = resolveRoute(task, await routeOverride(admin, job), { anyModel: !!job.options?.bench });
  // a benchmark run may compare a model at another effort (e.g. Claude at its own default, medium)
  const benchEffort = job.options?.bench ? (job.options?.effort?.[task] as Effort | undefined) : undefined;
  const req = { system, prompt, effort: benchEffort && ["low", "medium", "high"].includes(benchEffort) ? benchEffort : route.effort, maxOutputTokens: route.maxOutputTokens, temperature: 0.3 };
  const pending = result.pending[key] as { id?: string; model?: string; at?: number; failed?: string[] } | undefined;
  const tried: string[] = [...(pending?.failed ?? [])];
  const done = async (text: string, model: string, usage: any, ms: number) => {
    result.calls[key] = { text, model };
    delete result.pending[key];
    await logCall(admin, job, { stage: key, model, system, prompt, response: text, ok: true, ms, usage });
    await save(admin, job.id, { result });
    return { text, model };
  };
  const failed = async (model: string, ms: number, error: string) => {
    tried.push(model);
    result.pending[key] = { failed: tried };
    await logCall(admin, job, { stage: key, model, system, prompt, response: null, ok: false, ms, error: error.slice(0, 500) });
    // kept at once: if this request is cut off trying the next model, the next one skips this
    await save(admin, job.id, { result });
  };
  if (pending?.id && pending.model) {
    const st = await pollFor(pending.id, pollConfig.ms);
    if (st.status === "running" && Date.now() - (pending.at ?? 0) < BACKGROUND_LIMIT_MS) throw new WaitingForModel();
    if (st.status === "done") return done(st.reply.text, pending.model, st.reply.usage, Date.now() - (pending.at ?? Date.now()));
    await failed(pending.model, Date.now() - (pending.at ?? Date.now()), st.status === "failed" ? st.error : "no answer in time");
  }
  for (const model of route.models.filter((m) => !tried.includes(m))) {
    const t0 = Date.now();
    try {
      if (parseModelRef(model).via === "openai") {
        const { id } = await submitBackground(model, req);
        result.pending[key] = { id, model, at: t0, failed: tried };
        await save(admin, job.id, { result });
        const st = await pollFor(id, pollConfig.ms);
        if (st.status === "running") throw new WaitingForModel();
        if (st.status === "done") return done(st.reply.text, model, st.reply.usage, Date.now() - t0);
        throw new Error(st.error);
      }
      const r = await callModel(model, { ...req, timeoutMs: SYNC_TIMEOUT_MS });
      return done(r.text, model, r.usage, r.ms);
    } catch (e: any) {
      if (e instanceof WaitingForModel) throw e;
      if (e instanceof ModelHttpError && e.status === 402) throw new Error("AI credits are used up.");
      await failed(model, Date.now() - t0, String(e?.message ?? e));
    }
  }
  await save(admin, job.id, { result });
  throw new Error(
    route.strongOnly
      ? `The coaching model didn't answer (tried ${tried.join(", ")}). Coaching decisions aren't handed to a weaker model; try again in a few minutes.`
      : `No model answered (tried ${tried.join(", ")}). Try again in a few minutes.`,
  );
}

/** A stage finished: the answers kept for it aren't needed any more. */
function clearCalls(result: any) {
  result.calls = {};
  result.pending = {};
}

async function logCall(admin: Db, job: any, x: { stage: string; model: string; system: string; prompt: string; response: string | null; ok: boolean; ms: number; error?: string; usage?: any }) {
  await admin
    .from("program_intel_job_calls")
    .insert({
      job_id: job.id,
      client_id: job.client_id,
      stage: x.stage,
      model: x.model,
      system_prompt: x.system,
      prompt: x.prompt,
      response: x.response,
      prompt_chars: x.system.length + x.prompt.length,
      response_chars: x.response?.length ?? 0,
      est_input_tokens: Math.round((x.system.length + x.prompt.length) / 4),
      input_tokens: x.usage?.input ?? x.usage?.inputTokens ?? x.usage?.promptTokens ?? null,
      output_tokens: x.usage?.output ?? x.usage?.outputTokens ?? x.usage?.completionTokens ?? null,
      duration_ms: x.ms,
      ok: x.ok,
      error: x.error ?? null,
    })
    .then(
      () => undefined,
      () => undefined,
    );
}

/** Ask, check the JSON (and the caller's own checks), and ask once more with the problems named. */
async function askChecked<T>(admin: Db, job: any, result: any, task: AiTask, key: string, system: string, prompt: string, schema: any, check: (v: T) => string[]): Promise<{ value: T; model: string; issues: string[] }> {
  const first = await ask(admin, job, result, task, key, system, prompt);
  const p1 = parseJsonReply<T>(first.text, schema);
  const issues1 = p1.ok ? check(p1.value) : [p1.error];
  if (p1.ok && !issues1.length) return { value: p1.value, model: first.model, issues: [] };
  const second = await ask(admin, job, result, task, `${key} (retry)`, system, `${prompt}\n\nYour previous reply couldn't be used:\n${issues1.map((i) => `- ${i}`).join("\n")}\nReply again with ONE valid JSON object in exactly the required shape that fixes these, nothing else.`);
  const p2 = parseJsonReply<T>(second.text, schema);
  if (!p2.ok) throw new Error(`The AI reply wasn't in the required shape: ${p2.error}`);
  return { value: p2.value, model: second.model, issues: check(p2.value) };
}

/**
 * Exercises below the exercise standard that the strategy keeps, adds or swaps in: the model gets
 * one retry to fix them, and whatever's left is taken out by `withStandardStrategy` rather than
 * failing the run (it's the model's pick, not a mismatch with the coach's setup).
 */
export function strategyStandardIssues(s: Strategy, setup: Pick<GenerationSetup, "required">): string[] {
  const required = new Set(setup.required.map((r) => r.name.toLowerCase()));
  const names = [...s.exercise_plan.retain, ...s.exercise_plan.add].map((x) => x.name).concat(s.exercise_plan.replace.flatMap((r) => (r.with ? [r.with] : [])));
  return [...new Set(names)]
    .filter((n) => isLowValueExercise(n) && !required.has(n.toLowerCase()))
    .map((n) => `${n} is below the exercise standard; replace it with a dumbbell, cable or machine exercise for the same muscle.`);
}

/**
 * Parts of a strategy the workouts are written from that came back empty (blind grading on Nov 9
 * 2026 found two of the best strategies with no intensity, progression model or a day's main
 * lifts, so construction had to guess). They go back with the one retry; what's still empty after
 * it is kept on the run (`strategyGaps`) and never stops it.
 */
export function strategyGaps(s: Strategy): string[] {
  const out: string[] = [];
  const blank = (v: string | null | undefined) => !String(v ?? "").trim();
  if (blank(s.intensity)) out.push("intensity is empty: say how hard each phase is (RPE / RIR or % ranges for the main lifts, and how that changes week to week).");
  if (blank(s.progression.model)) out.push("progression.model is empty: say how loads, reps or sets progress week to week for the main lifts and the accessories.");
  if (blank(s.progression.fatigue)) out.push("progression.fatigue is empty: say how fatigue is managed across the weeks (and when it's shed, if it needs to be).");
  if (!s.frequency_targets.length) out.push("frequency_targets is empty: give how many days a week each main lift and major muscle is trained.");
  for (const d of s.weekly_layout) if (!d.primary.length) out.push(`weekly_layout day ${d.day} ("${d.title}") lists no main exercises in primary.`);
  return out;
}

/** Where the strategy doesn't match the coach's setup: these stop the run. */
export function strategyIssues(s: Strategy, setup: GenerationSetup): string[] {
  const out: string[] = [];
  if (s.structure.weeks !== setup.weeks) out.push(`structure.weeks is ${s.structure.weeks}; the coach's setup is ${setup.weeks} weeks.`);
  if (s.structure.days_per_week !== setup.daysPerWeek) out.push(`structure.days_per_week is ${s.structure.days_per_week}; the coach's setup is ${setup.daysPerWeek} days.`);
  const sum = s.structure.blocks.reduce((n, b) => n + b.weeks, 0);
  if (sum !== s.structure.weeks) out.push(`The blocks' weeks add up to ${sum}, not ${s.structure.weeks}.`);
  if (s.weekly_layout.length !== setup.daysPerWeek) out.push(`weekly_layout has ${s.weekly_layout.length} days; it needs exactly ${setup.daysPerWeek}.`);
  // blocks the coach set are kept as set; otherwise the strategy chooses them (each at most 12 weeks)
  const set = setup.blocks ?? [];
  if (set.length && (s.structure.blocks.length !== set.length || s.structure.blocks.some((b, i) => b.weeks !== set[i].weeks)))
    out.push(`The coach set the blocks: ${set.map((b) => `${b.name} ${b.weeks} wk`).join(", ")}; structure.blocks must match them.`);
  const names = JSON.stringify(s.exercise_plan).toLowerCase();
  for (const e of setup.excluded) if ([...s.exercise_plan.retain, ...s.exercise_plan.add].some((x) => x.name.toLowerCase() === e.name.toLowerCase())) out.push(`${e.name} is excluded by the coach but the plan keeps or adds it.`);
  for (const r of setup.required) if (!names.includes(r.name.toLowerCase())) out.push(`Required exercise ${r.name} isn't in exercise_plan (retain or add).`);
  return out;
}

/** The roadmap the last assigned program was written with, in words (continuity for the next one). */
export function roadmapText(job: any): string | null {
  const r = job?.result?.strategy?.roadmap;
  const st = job?.result?.setup;
  if (!r && !st) return null;
  const lines = [
    `Assigned ${String(job.created_at ?? "").slice(0, 10)}: ${st?.weeks ?? "?"} weeks${st?.startDate ? ` from ${st.startDate}` : ""}${st?.durationMode === "goal" ? " (goal timeline)" : ""}.`,
    r?.timeline ? `Timeline then: ${r.timeline}` : "",
    r?.this_program ? `What it was for: ${r.this_program}` : "",
    r?.phases?.length ? `What was to follow: ${r.phases.map((p: any) => `weeks ${p.weeks} ${p.focus}${p.milestone ? ` (${p.milestone})` : ""}`).join("; ")}` : "",
    r?.track ? `Track then: ${r.track}${r.track_why ? `, ${r.track_why}` : ""}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

export function blockIssues(b: BuiltBlock, want: { weeks: number; days: number }): string[] {
  const out: string[] = [];
  if (b.weeks !== want.weeks) out.push(`The block has ${b.weeks} weeks; it must have ${want.weeks}.`);
  if (b.days.length !== want.days) out.push(`The block has ${b.days.length} days; it must have exactly ${want.days}, one per training day.`);
  return out;
}

async function libraryCatalog(admin: Db): Promise<Array<CatalogExercise & { archived?: boolean }>> {
  const used = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from("pl_exercise_rows").select("exercise_id").not("exercise_id", "is", null).range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) used.add(r.exercise_id);
    if (!data || data.length < 1000) break;
  }
  const ids = [...used];
  const out: CatalogExercise[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await admin.from("exercises").select("id, name, movement_family, primary_muscle_group, equipment, archived, video_url").in("id", ids.slice(i, i + 150));
    if (error) throw new Error(error.message);
    // "demo video": the athlete can watch how it's done (what a first program leans on)
    for (const e of data ?? []) if (!e.archived) out.push({ id: e.id, name: e.name, family: e.movement_family, muscle: e.primary_muscle_group, equipment: e.equipment, history: e.video_url ? "demo video" : null });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function exerciseMeta(admin: Db, ids: string[]): Promise<Map<string, RawExercise>> {
  const meta = new Map<string, RawExercise>();
  const uniq = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < uniq.length; i += 150) {
    const { data } = await admin
      .from("exercises")
      .select("id, name, primary_muscle_group, muscle_groups, secondary_muscle_groups, movement_family, is_competition_lift, competition_lift_type, exercise_category, variation_type, counts_toward_volume, volume_multiplier, equipment, category, muscle_group")
      .in("id", uniq.slice(i, i + 150));
    for (const m of data ?? []) meta.set(m.id, m);
  }
  return meta;
}

async function save(admin: Db, id: string, patch: Record<string, unknown>) {
  const { error } = await admin.from("program_intel_jobs").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

function setStage(stages: StageState[], key: string, status: StageState["status"], detail?: string): StageState[] {
  return stages.map((s) => (s.key === key ? { ...s, status, ...(detail !== undefined ? { detail } : {}) } : s));
}

/** Rebuild the intelligence for a job (records read fresh with the service role). */
async function intelFor(admin: Db, job: any): Promise<{ intel: GeneratorIntel; rec: IntelRecords; setup: GenerationSetup; edited: SetupField[] }> {
  const raw = benchRecords(await loadIntelRecords(admin, job.client_id, { kind: "history" }), job);
  // privacy-safe: no name, no notes or check-ins the athlete typed (training data kept)
  const rec = job.privacy_safe ? privacySafeRecords(raw) : raw;
  const intel = buildGeneratorIntel(rec, { brainOverride: job.brain as Brain });
  const parsed = job.options?.setup ? setupSchema.safeParse(job.options.setup) : null;
  if (parsed && !parsed.success) throw new Error(`The setup sent with this run isn't valid: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  let setup = (parsed?.data as GenerationSetup | undefined) ?? intel.recommendation.setup;
  // a benchmark run: the recommended setup with its own changes (a start date, a length), weeks from the goal timeline when asked
  if (job.options?.bench && job.options?.setupPatch) {
    setup = { ...setup, ...job.options.setupPatch };
    if (setup.durationMode === "goal") setup = { ...setup, weeks: horizonFor(intel.ctx, "goal", null, setup.startDate).weeks };
  }
  return { intel, rec, setup, edited: (job.options?.edited ?? []) as SetupField[] };
}

/**
 * Run the job's current stage. Returns "next" when another stage follows (the
 * caller queues it), "done" when the run is finished.
 */
export async function runPipelineStage(admin: Db, job: any): Promise<"next" | "done"> {
  const kind = job.kind as "strategy" | "generate";
  const approved = !!job.options?.strategy;
  const result = { ...(job.result ?? {}) } as any;
  let stages: StageState[] = job.progress?.stages ?? stagesFor(kind, null, approved);
  const stage: string = job.stage ?? "context";
  stages = setStage(stages, stage.startsWith("repair") ? "audit" : stage, "running");
  await save(admin, job.id, { progress: { stages, current: stage } });

  if (stage === "context") {
    const { data: allowed, error: pe } = await admin.rpc("program_intel_can_coach", { _user: job.created_by, _client: job.client_id });
    if (pe) throw new Error(pe.message);
    if (!allowed) throw new Error("The coach who asked for this no longer coaches this client.");
    const { intel, rec, setup, edited } = await intelFor(admin, job);
    const lookup = (r: { id: string | null; name: string }) => (r.id ? intel.exercises.get(r.id) ?? null : null) ?? (r.name ? { name: r.name, equipment: null } : null);
    const conflicts = findConflicts(setup, intel.ctx, intel.recommendation.baseline, lookup, intel.recommendation.setup);
    const blockers = conflicts.filter((c) => c.severity === "blocker");
    if (blockers.length) throw new Error(`Resolve before generating: ${blockers.map((b) => b.title).join("; ")}`);
    const red = redistribution(setup, intel.recommendation.baseline);
    const { data: assigned } = await admin.from("program_intel_jobs").select("id, created_at, result, brain").eq("client_id", job.client_id).eq("kind", "generate").eq("status", "assigned").order("created_at");
    const outcomes = generatedProgramOutcomes(rec, (assigned ?? []) as any);
    const previousRoadmap = roadmapText((assigned ?? []).slice(-1)[0]);
    const brief = buildBrief(intel, { setup, edited, conflicts, redistribution: red, outcomes: outcomeLines(outcomes), previousRoadmap });
    const compact = buildBrief(intel, { setup, edited, conflicts, redistribution: red, outcomes: outcomeLines(outcomes), exclude: CONSTRUCT_EXCLUDE, previousRoadmap });
    const override = await routeOverride(admin, job);
    const context = {
      version: 2,
      prompt_version: PIPELINE_PROMPT_VERSION,
      data_hash: intel.dataHash,
      coach_saw_hash: job.options?.dataHash ?? null,
      records_changed: job.options?.dataHash ? job.options.dataHash !== intel.dataHash : null,
      brain: setup.brain,
      brain_label: BRAIN_LABEL[setup.brain],
      classification: intel.classification,
      setup,
      edited,
      conflicts,
      redistribution: red,
      brief: { sections: brief.sections, warnings: brief.warnings, chars: brief.chars, est_tokens: brief.estTokens },
      brief_text: brief.text,
      construct_brief: { sections: compact.sections, chars: compact.chars, est_tokens: compact.estTokens, left_out: CONSTRUCT_EXCLUDE },
      construct_brief_text: compact.text,
      sources: {
        blocks: intel.history.blocks.length,
        workouts: intel.history.days.length,
        set_records: intel.history.coverage.loggedSets,
        previous_program: intel.ctx.previous?.label ?? null,
        previous_set_records: intel.prev?.coverage.loggedSets ?? 0,
        checkins: intel.ctx.notes.checkins.length,
        coach_notes: intel.ctx.notes.coach.length,
        memory: intel.ctx.memory.established.length,
        unreadable: intel.history.coverage.unreadable,
      },
      quality_summary: intel.quality?.summary ?? null,
      model: { routes: Object.fromEntries((["strategy", "construct", "repair", "review"] as AiTask[]).map((t) => [t, resolveRoute(t, override, { anyModel: !!job.options?.bench })])), background_poll_ms: pollConfig.ms, sync_timeout_ms: SYNC_TIMEOUT_MS },
      previous_adherence_pct: intel.ctx.previous?.sessionAdherencePct ?? null,
      // what the later stages build and audit from (the same data the brief came from)
      // a first program has no previous one: maxes entered at setup are its only load references
      load_refs: loadReferences(intel.prev ?? (intel.history.lifts.some((l) => l.maxOnFileKg != null) ? intel.history : null)),
      first_program: intel.firstProgram,
      athlete_catalog: intel.prev ? athleteCatalog(intel.prev, intel.exercises) : [],
      audit_inputs: {
        baseline: intel.recommendation.baseline,
        ctx: { schedule: intel.ctx.schedule, session: intel.ctx.session, previous: intel.ctx.previous, today: intel.ctx.today },
        quality: intel.quality ? { confidence: intel.quality.confidence } : null,
        home: intel.equipment.home,
        equipment_rules: intel.equipment.constraints,
        athlete_exercise_ids: (intel.prev?.exercises ?? []).map((e) => e.exerciseId).filter(Boolean),
      },
    };
    result.setup = setup;
    result.previousAdherencePct = intel.ctx.previous?.sessionAdherencePct ?? null;
    if (approved) {
      result.strategy = strategySchema.parse(job.options.strategy);
      result.strategySource = "coach";
    }
    stages = setStage(stages, "context", "done", `${intel.history.coverage.loggedSets} set records, ${Math.round(brief.chars / 1000)}k characters${brief.warnings.length ? ` · ${brief.warnings.length} note${brief.warnings.length === 1 ? "" : "s"}` : ""}`);
    if (approved && kind === "generate") {
      stages = stagesFor(kind, result.strategy.structure.blocks.length, true).map((s) => stages.find((x) => x.key === s.key) ?? s);
      await save(admin, job.id, { context, result, data_hash: intel.dataHash, stage: "construct:0", progress: { stages, current: "construct:0" } });
    } else await save(admin, job.id, { context, result, data_hash: intel.dataHash, stage: "strategy", progress: { stages, current: "strategy" } });
    return "next";
  }

  const ctxRow = job.context ?? {};
  const setup: GenerationSetup = ctxRow.setup;
  const brief: string = ctxRow.brief_text ?? "";
  const brain: Brain = setup.brain;

  if (stage === "strategy") {
    const { value, model } = await askChecked<Strategy>(admin, job, result, "strategy", "strategy", strategySystemPrompt(brain, { first: !!ctxRow.first_program }), strategyUserPrompt(brief, setup, { first: !!ctxRow.first_program }), strategySchema, (v) => [...strategyIssues(v, setup), ...strategyStandardIssues(v, setup), ...strategyGaps(v)]);
    const issues = strategyIssues(value, setup);
    const gaps = strategyGaps(value);
    if (gaps.length) result.strategyGaps = gaps;
    if (issues.length) throw new Error(`The strategy didn't match your setup: ${issues.join(" ")}`);
    // anything still below the exercise standard after the retry comes out here, never fails the run
    const clean = withStandardStrategy(value, setup.required);
    if (clean.removed.length) result.standardRemoved = clean.removed;
    result.strategy = clean.strategy;
    result.strategySource = "auto";
    clearCalls(result);
    stages = setStage(stages, "strategy", "done", `${value.decisions.length} decisions · ${model}`);
    if (kind === "strategy") {
      await save(admin, job.id, { result, model, prompt_version: PIPELINE_PROMPT_VERSION, stage: "done", status: "ready", finished_at: new Date().toISOString(), progress: { stages, current: "done" } });
      return "done";
    }
    stages = stagesFor(kind, value.structure.blocks.length, false).map((s) => stages.find((x) => x.key === s.key) ?? s);
    await save(admin, job.id, { result, model, stage: "construct:0", progress: { stages, current: "construct:0" } });
    return "next";
  }

  const strategy: Strategy = result.strategy;
  const ai = ctxRow.audit_inputs ?? {};
  const exercisesCtx = async () => {
    const eq = { items: setup.equipment.items as any, confidence: setup.equipment.confidence };
    // only exercises their equipment allows and that meet the exercise standard (a coach's required pick always stays)
    const athlete = meetsStandard(equipmentFit((ctxRow.athlete_catalog ?? []) as CatalogExercise[], eq), setup.required);
    const lib = await libraryCatalog(admin);
    const library = meetsStandard(equipmentFit(lib.filter((e) => !athlete.some((a) => a.id === e.id)), eq), setup.required);
    return { athlete, library, all: lib };
  };

  if (stage.startsWith("construct:")) {
    const i = Number(stage.split(":")[1]);
    const { athlete, library } = await exercisesCtx();
    const sb = strategy.structure.blocks[i];
    const built: BuiltBlock[] = result.blocks ?? [];
    const { value, model, issues } = await askChecked<BuiltBlock>(
      admin,
      job,
      result,
      "construct",
      stage,
      constructSystemPrompt(brain, { first: !!ctxRow.first_program }),
      constructUserPrompt({ brief: ctxRow.construct_brief_text ?? brief, setup, strategy, blockIndex: i, previousBlocks: built.slice(0, i), loadRefs: ctxRow.load_refs ?? "", athleteCatalog: athlete, libraryCatalog: library, catalogText }),
      builtBlockSchema,
      (v) => blockIssues(v, { weeks: sb.weeks, days: setup.daysPerWeek }),
    );
    if (issues.length) throw new Error(`Block ${i + 1} didn't match the strategy: ${issues.join(" ")}`);
    // cardio is the client's cardio plan (added to every workout by the app), never a second copy here
    const lean = withoutCardioRows(withStandardSubstitutions(value));
    if (lean.removed.length) result.cardioRemoved = [...new Set([...(result.cardioRemoved ?? []), ...lean.removed])];
    built[i] = { ...lean.block, name: lean.block.name || sb.name };
    result.blocks = built;
    clearCalls(result);
    stages = setStage(stages, stage, "done", `${value.days.length} days · ${value.days.reduce((n, d) => n + d.exercises.length, 0)} exercises · ${model}`);
    const next = i + 1 < strategy.structure.blocks.length ? `construct:${i + 1}` : "audit";
    await save(admin, job.id, { result, model, stage: next, progress: { stages, current: next } });
    return "next";
  }

  if (stage === "audit" || stage.startsWith("repair")) {
    const { athlete, library, all } = await exercisesCtx();
    const known = new Map<string, string>([...athlete, ...all].map((e) => [e.id, e.name]));
    if (stage.startsWith("repair")) {
      // fix one flagged block per request
      const queue: number[] = result.repairQueue ?? [];
      const bi = queue[0];
      if (bi != null) {
        const issues: string[] = result.audit?.repairs?.[bi] ?? [];
        const { value } = await askChecked<BuiltBlock>(admin, job, result, "repair", `repair:block ${bi + 1}:${result.repairRound ?? 1}`, constructSystemPrompt(brain, { first: !!ctxRow.first_program }), repairUserPrompt({ block: result.blocks[bi], blockIndex: bi, issues, setup, athleteCatalog: athlete, libraryCatalog: library, catalogText, equipmentRules: ai.equipment_rules ?? [] }), builtBlockSchema, (v) => blockIssues(v, { weeks: result.blocks[bi].weeks, days: setup.daysPerWeek }));
        const lean = withoutCardioRows(withStandardSubstitutions(value));
        if (lean.removed.length) result.cardioRemoved = [...new Set([...(result.cardioRemoved ?? []), ...lean.removed])];
        result.blocks[bi] = lean.block;
        result.repairs = [...(result.repairs ?? []), { round: result.repairRound ?? 1, block: bi, issues }];
        clearCalls(result);
      }
      result.repairQueue = queue.slice(1);
      const next = result.repairQueue.length ? "repair" : "audit";
      await save(admin, job.id, { result, stage: next, progress: { stages: setStage(stages, "audit", "running", `Repairing block ${(bi ?? 0) + 1}`), current: next } });
      return "next";
    }
    const program: BuiltProgram = {
      program_name: `${BRAIN_LABEL[brain]} · ${setup.weeks} weeks · ${setup.daysPerWeek} days`,
      summary: [strategy.previous_program.outcome, strategy.progression.model].filter(Boolean).join(" "),
      blocks: result.blocks,
      progression: strategy.progression.model,
      recovery: strategy.progression.fatigue,
      changes: strategy.decisions.map((d) => ({ change: d.change, why: [d.observation, d.benefit && `Expected: ${d.benefit}`].filter(Boolean).join(" "), evidence: d.evidence, basis: d.basis })),
      watch: strategy.monitor,
    };
    const resolved = await resolveProgramExercises(program, known, async (name) => {
      const { data } = await admin.rpc("resolve_exercise_id", { _name: name });
      return (typeof data === "string" && data) || null;
    });
    const ids = resolved.program.blocks.flatMap((b) => b.days.flatMap((d) => d.exercises.map((e) => e.exercise_id))).filter(Boolean) as string[];
    const meta = await exerciseMeta(admin, ids);
    const audit: AuditResult = auditProgram({
      program: resolved.program,
      setup,
      strategy,
      baseline: ai.baseline,
      equipment: { items: setup.equipment.items as any, confidence: setup.equipment.confidence, home: !!ai.home, cableStations: setup.equipment.cableStations },
      ctx: ai.ctx,
      quality: ai.quality,
      meta,
      unmatched: resolved.unmatched,
      athleteExerciseIds: new Set((ai.athlete_exercise_ids ?? []) as string[]),
      brief,
    });
    result.blocks = resolved.program.blocks;
    result.program = resolved.program;
    result.unmatched = resolved.unmatched;
    result.matched = [...resolved.resolved.values()];
    // the coaching review's verdict (once it has run) sits on the scorecard with the automatic checks
    const scored = withReview(audit, (result.review as CoachingReview | undefined) ?? null);
    result.audit = { scorecard: scored.scorecard, overall: scored.overall, findings: scored.findings, sessions: audit.sessions, weekly: audit.weekly, repairs: audit.repairs, facts: audit.facts ?? [] };
    const round = result.repairRound ?? 0;
    const flagged = Object.keys(audit.repairs).map(Number).sort((a, b) => a - b);
    if (flagged.length && round < MAX_REPAIR_ROUNDS) {
      result.repairRound = round + 1;
      result.repairQueue = flagged;
      await save(admin, job.id, { result, stage: "repair", progress: { stages: setStage(stages, "audit", "running", `Repair round ${round + 1}: ${flagged.length} block${flagged.length === 1 ? "" : "s"}`), current: "repair" } });
      return "next";
    }
    const label = scored.overall === "passed" ? "Passed" : scored.overall === "review" ? "Needs review" : "Failed validation";
    stages = setStage(stages, "audit", scored.overall === "failed" ? "error" : "done", `${label}${round ? ` after ${round} repair round${round === 1 ? "" : "s"}` : ""}`);
    // the automatic checks are done: the coaching brain reads the program once before it's saved
    const next = !result.review && !job.options?.skipReview ? "review" : "save";
    await save(admin, job.id, { result, stage: next, progress: { stages, current: next } });
    return "next";
  }

  if (stage === "review") {
    const program: BuiltProgram = result.program;
    const { value, model } = await askChecked<ReviewReply>(
      admin,
      job,
      result,
      "review",
      "review",
      reviewSystemPrompt(brain),
      reviewUserPrompt({ brief: ctxRow.construct_brief_text ?? brief, setup, strategy, program, audit: result.audit }),
      reviewReplySchema,
      () => [],
    );
    const fixes = reviewRepairs(value, program.blocks.length);
    const blocks = Object.keys(fixes).map(Number).sort((a, b) => a - b);
    const round = result.repairRound ?? 0;
    const repairing = blocks.length > 0 && round < MAX_REPAIR_ROUNDS;
    result.review = { ...value, model, at: new Date().toISOString(), repaired: repairing ? blocks : [] } satisfies CoachingReview;
    clearCalls(result);
    const mustFix = value.issues.filter((i) => i.severity === "must_fix").length;
    stages = setStage(stages, "review", "done", `${value.verdict === "sound" ? "Sound" : `${mustFix} to fix`}${value.issues.length - mustFix ? ` · ${value.issues.length - mustFix} to consider` : ""} · ${model}`);
    if (repairing) {
      // genuine problems go to a targeted repair of their block; the automatic checks re-run after
      result.repairRound = round + 1;
      result.repairQueue = blocks;
      result.audit = { ...result.audit, repairs: fixes };
      await save(admin, job.id, { result, stage: "repair", progress: { stages, current: "repair" } });
      return "next";
    }
    // nothing to repair: put the review on the scorecard and save
    const scored = withReview({ ...result.audit, repairs: result.audit.repairs ?? {} } as AuditResult, result.review);
    result.audit = { ...result.audit, scorecard: scored.scorecard, overall: scored.overall, findings: scored.findings };
    await save(admin, job.id, { result, stage: "save", progress: { stages, current: "save" } });
    return "next";
  }

  if (stage === "save") {
    const program: BuiltProgram = result.program;
    // a benchmark run keeps its result for comparison and writes nothing to the client's training
    if (job.options?.bench) {
      stages = setStage(stages, "save", "skipped", "Benchmark: no draft written");
      await save(admin, job.id, { result, stage: "done", status: "ready", finished_at: new Date().toISOString(), prompt_version: PIPELINE_PROMPT_VERSION, progress: { stages, current: "done" } });
      return "done";
    }
    const blockIds = await insertDraftProgram(admin, { clientId: job.client_id, createdBy: job.created_by, program, jobId: job.id });
    const decisions = strategy.decisions.map((d) => ({
      client_id: job.client_id,
      kind: "decision",
      category: (d.area || "programming").slice(0, 60),
      statement: `${d.change}. Why: ${d.observation}${d.monitor ? ` Monitor: ${d.monitor}` : ""}`.slice(0, 1000),
      confidence: "hypothesis",
      status: "proposed",
      source: "ai",
      // the model's own basis is kept as evidence; it stays a hypothesis until the coach approves it
      evidence: [`Basis given: ${d.basis === "fact" ? "measured records" : "interpretation"} (${d.confidence} confidence)`, ...d.evidence],
      block_id: blockIds[0],
      job_id: job.id,
      data_hash: job.data_hash,
      created_by: job.created_by,
    }));
    if (decisions.length) {
      const { error } = await admin.from("program_intel_observations").insert(decisions);
      if (error) throw new Error(error.message);
    }
    result.blockIds = blockIds;
    stages = setStage(stages, "save", "done", `${blockIds.length} hidden block${blockIds.length === 1 ? "" : "s"}`);
    await save(admin, job.id, { result, block_id: blockIds[0], prompt_version: PIPELINE_PROMPT_VERSION, stage: "done", status: "ready", finished_at: new Date().toISOString(), progress: { stages, current: "done" } });
    return "done";
  }
  throw new Error(`Unknown stage ${stage}`);
}

/**
 * The program as draft blocks: hidden from the client (client_visible false),
 * with no dates (so schedule re-alignment never places it), every week's rows
 * written out from its own prescription, later weeks' days linked to week 1's.
 * If anything fails, nothing is left behind.
 */
export async function insertDraftProgram(admin: Db, x: { clientId: string; createdBy: string; program: BuiltProgram; jobId: string }): Promise<string[]> {
  const { inferTimeProfileFromExercise } = await import("@/lib/pl-programs");
  const { defaultRestSeconds } = await import("@/lib/exercise-metadata");
  const ids = [...new Set(x.program.blocks.flatMap((b) => b.days.flatMap((d) => d.exercises.map((e) => e.exercise_id)).filter(Boolean)))] as string[];
  const meta = new Map<string, any>();
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await admin.from("exercises").select("id, name, category, muscle_group, exercise_category, is_competition_lift, competition_lift_type").in("id", ids.slice(i, i + 150));
    for (const m of data ?? []) meta.set(m.id, m);
  }
  const created: string[] = [];
  try {
    for (const [bi, b] of x.program.blocks.entries()) {
      const { data: block, error } = await admin
        .from("pl_blocks")
        .insert({
          client_id: x.clientId,
          name: `${x.program.blocks.length > 1 ? `Block ${bi + 1} — ` : ""}${b.name}`.slice(0, 120),
          weeks: b.weeks,
          status: "Draft",
          client_visible: false,
          start_date: null,
          end_date: null,
          training_focus: (b.objective ?? null)?.slice(0, 500) ?? null,
          coach_notes: `Draft from Program Intelligence (${x.program.program_name}). Not visible to the client until you assign it.${b.deload_rule ? ` Deload: ${b.deload_rule}` : ""}`,
          created_by: x.createdBy,
          sort_order: 1000 + bi,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      created.push(block.id);
      const firstDayIds: string[] = [];
      for (let w = 1; w <= b.weeks; w++) {
        const phase = (b.week_phases ?? []).find((p) => p.week === w)?.phase ?? null;
        const { data: week, error: we } = await admin.from("pl_weeks").insert({ block_id: block.id, week_index: w, phase }).select("id").single();
        if (we) throw new Error(we.message);
        for (const [di, d] of b.days.entries()) {
          const { data: day, error: de } = await admin
            .from("pl_days")
            .insert({ week_id: week.id, day_index: di + 1, title: d.title, focus: d.focus ?? null, source_day_id: w > 1 ? firstDayIds[di] : null, is_custom: false })
            .select("id")
            .single();
          if (de) throw new Error(de.message);
          if (w === 1) firstDayIds.push(day.id);
          const rows = d.exercises.map((ex, i) => {
            const m = ex.exercise_id ? meta.get(ex.exercise_id) : null;
            const row = exerciseRow(ex, w, i, d.exercises);
            return {
              day_id: day.id,
              time_profile: inferTimeProfileFromExercise(m ?? { name: ex.exercise_name }),
              ...(row.rest_seconds == null ? { rest_seconds: defaultRestSeconds(m), rest_seconds_override: null } : {}),
              ...row,
            };
          });
          const { error: re } = await admin.from("pl_exercise_rows").insert(rows);
          if (re) throw new Error(re.message);
        }
      }
    }
    return created;
  } catch (e) {
    for (const id of created) await admin.from("pl_blocks").delete().eq("id", id);
    throw e;
  }
}
