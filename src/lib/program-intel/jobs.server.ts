/**
 * Program Intelligence AI runs, in the background (the program-intel-tick
 * hook; never inside the coach's request, which the host cuts off when the
 * phone leaves the screen). Each run re-checks that the coach who asked may
 * still coach the client, reads the records, builds the deterministic report,
 * and then either:
 *   - interpret: proposed observations (hypotheses) for the coach to approve,
 *     correct or reject; or
 *   - generate: the next program as hidden, undated draft blocks the coach
 *     previews and edits in the program editor, plus each change and why as a
 *     proposed decision. Nothing is assigned or shown to the client.
 */
import { exerciseRow, generationSystemPrompt, generationUserPrompt, interpretReplySchema, interpretSystemPrompt, parseJsonReply, programReplySchema, resolveProgramExercises, athleteCatalog, GENERATION_PROMPT_VERSION, type CatalogExercise, type GenerationOptions, type ProgramReply } from "./next-program";
import { reportToMarkdown, privacySafeRecords } from "./export";
import { loadIntelRecords } from "./load";
import { buildIntelReport } from "./report";
import type { Brain, IntelScopeRequest } from "./types";

type Db = any;
const STALE_RUN_MS = 10 * 60_000;
const MAX_ATTEMPTS = 3;

async function askModel(admin: Db, system: string, prompt: string, timeoutMs: number): Promise<{ text: string; model: string }> {
  const { createLovableAiGateway, DEFAULT_AI_MODEL } = await import("@/lib/ai-gateway.server");
  const { generateText } = await import("ai");
  const { data: cfg } = await admin.from("global_ai_config").select("default_model").limit(1).maybeSingle();
  const model = (cfg?.default_model as string | undefined) || DEFAULT_AI_MODEL;
  try {
    const r = await generateText({ model: createLovableAiGateway()(model), system, prompt, temperature: 0.3, abortSignal: AbortSignal.timeout(timeoutMs) });
    return { text: r.text, model };
  } catch (e: any) {
    const status = e?.statusCode ?? e?.status;
    if (status === 429) throw new Error("The AI service is busy (too many requests). Try again in a minute.");
    if (status === 402) throw new Error("AI credits are used up.");
    throw new Error(`The AI service didn't answer: ${String(e?.message ?? e).slice(0, 200)}`);
  }
}

/** Ask, check the JSON, and ask once more with the problem named if it didn't hold up. */
async function askJson<T>(admin: Db, system: string, prompt: string, schema: any, timeoutMs: number): Promise<{ value: T; model: string }> {
  const first = await askModel(admin, system, prompt, timeoutMs);
  const p1 = parseJsonReply<T>(first.text, schema);
  if (p1.ok) return { value: p1.value, model: first.model };
  const second = await askModel(admin, system, `${prompt}\n\nYour previous reply could not be used (${p1.error}). Reply again with ONE valid JSON object in exactly the required shape, nothing else.`, timeoutMs);
  const p2 = parseJsonReply<T>(second.text, schema);
  if (p2.ok) return { value: p2.value, model: second.model };
  throw new Error(`The AI reply wasn't in the required shape: ${p2.error}`);
}

/** The library exercises coaches actually program (their working vocabulary), with names for every id the model may use. */
async function libraryCatalog(admin: Db): Promise<CatalogExercise[]> {
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
    const { data, error } = await admin.from("exercises").select("id, name, movement_family, primary_muscle_group, archived").in("id", ids.slice(i, i + 150));
    if (error) throw new Error(error.message);
    for (const e of data ?? []) if (!e.archived) out.push({ id: e.id, name: e.name, family: e.movement_family, muscle: e.primary_muscle_group });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function claimJob(admin: Db, jobId: string | null): Promise<any | null> {
  const since = new Date(Date.now() - 2 * 86_400_000).toISOString();
  let q = admin.from("program_intel_jobs").select("*").gt("updated_at", since).lt("attempts", MAX_ATTEMPTS).in("status", ["pending", "running"]).order("created_at").limit(5);
  if (jobId) q = admin.from("program_intel_jobs").select("*").eq("id", jobId).limit(1);
  const { data } = await q;
  const job = (data ?? []).find((j: any) => j.status === "pending" || (j.status === "running" && Date.now() - Date.parse(j.updated_at) > STALE_RUN_MS));
  if (!job || job.attempts >= MAX_ATTEMPTS) return null;
  // Claim it: only one worker gets the row.
  const { data: claimed } = await admin
    .from("program_intel_jobs")
    .update({ status: "running", attempts: job.attempts + 1, started_at: new Date().toISOString(), error: null })
    .eq("id", job.id)
    .eq("status", job.status)
    .eq("attempts", job.attempts)
    .select("*")
    .maybeSingle();
  return claimed ?? null;
}

export async function runIntelJob(admin: Db, jobId: string | null): Promise<{ status: string; jobId?: string; error?: string }> {
  const job = await claimJob(admin, jobId);
  if (!job) return { status: "idle" };
  try {
    const { data: allowed, error: pe } = await admin.rpc("program_intel_can_coach", { _user: job.created_by, _client: job.client_id });
    if (pe) throw new Error(pe.message);
    if (!allowed) throw new Error("The coach who asked for this no longer coaches this client.");
    const scope = job.scope as IntelScopeRequest;
    const raw = await loadIntelRecords(admin, job.client_id, scope);
    const rec = job.privacy_safe ? privacySafeRecords(raw) : raw;
    const report = buildIntelReport(rec, { brainOverride: job.brain as Brain });
    const markdown = reportToMarkdown(report, rec, { privacySafe: !!job.privacy_safe, reportId: job.id });

    if (job.kind === "interpret") {
      const { value, model } = await askJson<any>(admin, interpretSystemPrompt(job.brain), markdown, interpretReplySchema, 120_000);
      const rows = value.observations.map((o: any) => ({
        client_id: job.client_id,
        kind: "observation",
        category: o.category ?? null,
        statement: o.statement,
        confidence: "hypothesis",
        status: "proposed",
        source: "ai",
        evidence: o.evidence ?? [],
        job_id: job.id,
        data_hash: report.dataHash,
        created_by: job.created_by,
      }));
      if (rows.length) {
        const { error } = await admin.from("program_intel_observations").insert(rows);
        if (error) throw new Error(error.message);
      }
      await finish(admin, job.id, { status: "ready", model, prompt_version: GENERATION_PROMPT_VERSION, data_hash: report.dataHash, result: { observations: rows.length, questions: value.questions } });
      return { status: "ready", jobId: job.id };
    }

    // generate
    const athlete = athleteCatalog(report);
    const library = (await libraryCatalog(admin)).filter((e) => !athlete.some((a) => a.id === e.id));
    const known = new Map<string, string>([...athlete, ...library].map((e) => [e.id, e.name]));
    const options = (job.options ?? {}) as GenerationOptions;
    const { value: program, model } = await askJson<ProgramReply>(
      admin,
      generationSystemPrompt(job.brain),
      generationUserPrompt({ reportMarkdown: markdown, athleteCatalog: athlete, libraryCatalog: library, instructions: job.instructions, options }),
      programReplySchema,
      240_000,
    );
    const resolved = await resolveProgramExercises(program, known, async (name) => {
      const { data } = await admin.rpc("resolve_exercise_id", { _name: name });
      return (typeof data === "string" && data) || null;
    });
    const blockIds = await insertDraftProgram(admin, { clientId: job.client_id, createdBy: job.created_by, program: resolved.program, jobId: job.id });
    // Each change and why, as a proposed decision for the coach to approve (never a proven response).
    const decisions = resolved.program.changes.map((c) => ({
      client_id: job.client_id,
      kind: "decision",
      category: "programming",
      statement: `${c.change}. Why: ${c.why}`.slice(0, 1000),
      confidence: "hypothesis",
      status: "proposed",
      source: "ai",
      // the model's own basis is kept as evidence; it stays a hypothesis until the coach approves it
      evidence: [`Basis given: ${c.basis === "fact" ? "measured records" : "interpretation"}`, ...c.evidence],
      block_id: blockIds[0],
      job_id: job.id,
      data_hash: report.dataHash,
      created_by: job.created_by,
    }));
    if (decisions.length) {
      const { error } = await admin.from("program_intel_observations").insert(decisions);
      if (error) throw new Error(error.message);
    }
    await finish(admin, job.id, {
      status: "ready",
      model,
      prompt_version: GENERATION_PROMPT_VERSION,
      data_hash: report.dataHash,
      block_id: blockIds[0],
      result: { program: resolved.program, blockIds, unmatched: resolved.unmatched, matched: [...resolved.resolved.values()] },
    });
    return { status: "ready", jobId: job.id };
  } catch (e: any) {
    const message = String(e?.message ?? e).slice(0, 500);
    await finish(admin, job.id, { status: "error", error: message });
    return { status: "error", jobId: job.id, error: message };
  }
}

async function finish(admin: Db, id: string, patch: Record<string, unknown>) {
  await admin.from("program_intel_jobs").update({ ...patch, finished_at: new Date().toISOString() }).eq("id", id);
}

/**
 * The program as draft blocks: hidden from the client (client_visible false),
 * with no dates (so schedule re-alignment never places it), weeks and days in
 * the editor's own shape (later weeks link to week 1's days). If anything
 * fails, nothing is left behind.
 */
export async function insertDraftProgram(admin: Db, x: { clientId: string; createdBy: string; program: ProgramReply; jobId: string }): Promise<string[]> {
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
          training_focus: b.focus ?? null,
          coach_notes: `Draft from Program Intelligence (${x.program.program_name}). Not visible to the client until you assign it.`,
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
            const row = exerciseRow(ex, w, i);
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

export async function assertCanCoach(sb: Db, userId: string, clientId: string): Promise<void> {
  const { data: isAdmin } = await sb.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (isAdmin) return;
  const { data: assigned } = await sb.rpc("is_assigned_coach", { _client_id: clientId });
  if (!assigned) throw new Error("Only this client's coach (or an admin) can use Program Intelligence.");
}
