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
import { interpretReplySchema, interpretSystemPrompt, parseJsonReply } from "./next-program";
import { reportToMarkdown, privacySafeRecords } from "./export";
import { loadIntelRecords } from "./load";
import { buildIntelReport } from "./report";
import type { Brain, IntelScopeRequest } from "./types";

type Db = any;
const STALE_RUN_MS = 10 * 60_000;
const MAX_ATTEMPTS = 3;
const INTERPRET_PROMPT_VERSION = 1;

/** Reading an athlete's training is a coaching task: the coaching brain answers (routing.ts "interpret"), never a weaker model. */
async function askModel(admin: Db, system: string, prompt: string, timeoutMs: number): Promise<{ text: string; model: string }> {
  const { callModel, ModelHttpError } = await import("@/lib/ai/model-client.server");
  const { resolveRoute } = await import("@/lib/ai/routing");
  const { data } = await admin.from("app_settings").select("value").eq("key", "ai_routes").maybeSingle();
  let override: any = null;
  try {
    override = data?.value ? JSON.parse(data.value) : null;
  } catch {
    override = null;
  }
  const route = resolveRoute("interpret", override);
  const errors: string[] = [];
  for (const model of route.models) {
    try {
      const r = await callModel(model, { system, prompt, effort: route.effort, maxOutputTokens: route.maxOutputTokens, timeoutMs, temperature: 0.3 });
      return { text: r.text, model };
    } catch (e: any) {
      if (e instanceof ModelHttpError && e.status === 402) throw new Error("AI credits are used up.");
      errors.push(`${model}: ${String(e?.message ?? e).slice(0, 120)}`);
    }
  }
  throw new Error(`The coaching model didn't answer (${errors.join("; ")}). Try again in a few minutes.`);
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

export async function runIntelJob(admin: Db, jobId: string | null): Promise<{ status: string; jobId?: string; error?: string; stage?: string }> {
  const job = await claimJob(admin, jobId);
  if (!job) return { status: "idle" };
  if (job.kind === "strategy" || job.kind === "generate") {
    // Generate Next Program runs as stages, one per request (see pipeline.server.ts).
    const { runPipelineStage, WaitingForModel } = await import("./pipeline.server");
    try {
      const r = await runPipelineStage(admin, job);
      if (r === "next") await admin.from("program_intel_jobs").update({ status: "pending", attempts: 0 }).eq("id", job.id);
      return { status: r === "next" ? "pending" : "ready", jobId: job.id };
    } catch (e: any) {
      // the model is still thinking (background mode): the next request keeps polling where this one stopped
      if (e instanceof WaitingForModel) {
        await admin.from("program_intel_jobs").update({ status: "pending", attempts: 0 }).eq("id", job.id);
        return { status: "pending", jobId: job.id };
      }
      const message = String(e?.message ?? e).slice(0, 500);
      const { data: cur } = await admin.from("program_intel_jobs").select("progress, stage, result").eq("id", job.id).maybeSingle();
      const stages = ((cur?.progress as any)?.stages ?? []).map((s: any) => (s.status === "running" ? { ...s, status: "error", detail: message.slice(0, 200) } : s));
      // the answers kept for the failed stage go too, so Try again asks again instead of replaying them
      const result = cur?.result ? { ...(cur.result as any), calls: {}, pending: {} } : cur?.result;
      await finish(admin, job.id, { status: "error", error: message, progress: { stages, current: cur?.stage ?? null }, ...(result ? { result } : {}) });
      return { status: "error", jobId: job.id, error: message, stage: cur?.stage ?? undefined };
    }
  }
  try {
    const { data: allowed, error: pe } = await admin.rpc("program_intel_can_coach", { _user: job.created_by, _client: job.client_id });
    if (pe) throw new Error(pe.message);
    if (!allowed) throw new Error("The coach who asked for this no longer coaches this client.");
    const scope = job.scope as IntelScopeRequest;
    const raw = await loadIntelRecords(admin, job.client_id, scope);
    const rec = job.privacy_safe ? privacySafeRecords(raw) : raw;
    const report = buildIntelReport(rec, { brainOverride: job.brain as Brain });
    // how they're developing (bodyweight-adjusted strength, training age, phase, progress / hold / back off)
    const { buildGeneratorIntel } = await import("./intelligence");
    const { developmentText } = await import("./athlete-development");
    const dev = buildGeneratorIntel(rec, { brainOverride: job.brain as Brain }).development;
    const markdown = `${reportToMarkdown(report, rec, { privacySafe: !!job.privacy_safe, reportId: job.id })}\n\n## Athlete development (computed from their records)\n${developmentText(dev, report.client.unit)}`;
    const { value, model } = await askJson<any>(admin, interpretSystemPrompt(job.brain), markdown, interpretReplySchema, 140_000);
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
    await finish(admin, job.id, { status: "ready", model, prompt_version: INTERPRET_PROMPT_VERSION, data_hash: report.dataHash, result: { observations: rows.length, questions: value.questions } });
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

export async function assertCanCoach(sb: Db, userId: string, clientId: string): Promise<void> {
  const { data: isAdmin } = await sb.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (isAdmin) return;
  const { data: assigned } = await sb.rpc("is_assigned_coach", { _client_id: clientId });
  if (!assigned) throw new Error("Only this client's coach (or an admin) can use Program Intelligence.");
}
