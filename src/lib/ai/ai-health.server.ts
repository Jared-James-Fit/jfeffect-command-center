/**
 * Whether each AI provider is answering, and every model call on record (Nov 23 2026).
 *
 * - `ai_call_log` keeps one row per model call (task, feature, model, ok / why not, tokens,
 *   seconds, estimated US$), written here by every call path (model-client, stagedCall, the
 *   direct image and Cleo calls). It's what the usage and cost panel reads.
 * - `ai_provider_health` holds one row per provider: `ok`, or down because its credits ran
 *   out (`credits`), its key was refused (`auth`) or it stopped answering (`outage`).
 *
 * The circuit breaker: while a provider is down, `assertProviderUp` refuses a call before any
 * request is made (AiUnavailableError), so jobs park instead of burning their attempts and
 * nothing is spent. Every `PROBE_EVERY_MS` one call is let through as a probe (the ai-health
 * tick makes a tiny one itself); the first call that answers marks the provider ok again, and
 * the tick then redoes what failed while it was down (ai-recovery.server.ts). Server only.
 */
import {
  AiUnavailableError,
  classifyAiError,
  errorText,
  isAccountFailure,
  type AiFailureKind,
} from "./ai-errors";
import { callCost } from "./ai-usage";

export type Provider = "openai" | "gateway";
export type HealthStatus = "ok" | "credits" | "auth" | "outage";
export type Health = {
  provider: Provider;
  status: HealthStatus;
  since: string | null;
  last_ok_at: string | null;
  last_failure_at: string | null;
  last_failure: string | null;
  failures_in_row: number;
  next_probe_at: string | null;
  recovered_at: string | null;
  recovery_done_at: string | null;
  alerted_at: string | null;
};

/** How often a down provider gets one call through to see whether it's back. */
export const PROBE_EVERY_MS = 10 * 60_000;
/** Outages need this many failures in a row (across calls) before calls are held. */
export const OUTAGE_AFTER = 5;
const CACHE_MS = 20_000;

let cache: { at: number; rows: Map<Provider, Health> } | null = null;

async function admin(): Promise<any> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

export function providerOf(model: string): Provider {
  return model.startsWith("gateway:") ? "gateway" : "openai";
}

function blank(provider: Provider): Health {
  return {
    provider,
    status: "ok",
    since: null,
    last_ok_at: null,
    last_failure_at: null,
    last_failure: null,
    failures_in_row: 0,
    next_probe_at: null,
    recovered_at: null,
    recovery_done_at: null,
    alerted_at: null,
  };
}

/** Every provider's health (cached ~20 s per server instance; `fresh` reads it now). */
export async function readHealth(opts: { fresh?: boolean } = {}): Promise<Map<Provider, Health>> {
  if (!opts.fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.rows;
  const rows = new Map<Provider, Health>([
    ["openai", blank("openai")],
    ["gateway", blank("gateway")],
  ]);
  try {
    const { data } = await (await admin()).from("ai_provider_health").select("*");
    for (const r of (data ?? []) as Health[]) rows.set(r.provider, { ...blank(r.provider), ...r });
  } catch {
    // unreadable (an older database): treat as answering, never block on it
  }
  cache = { at: Date.now(), rows };
  return rows;
}

/** True while the provider is down and its next probe isn't due yet. Pure. */
export function heldBack(h: Health, now = Date.now()): boolean {
  if (h.status === "ok") return false;
  return !!h.next_probe_at && new Date(h.next_probe_at).getTime() > now;
}

/** Refuses a call before any request is made while the provider is known to be down. */
export async function assertProviderUp(provider: Provider): Promise<void> {
  const h = (await readHealth()).get(provider);
  if (h && heldBack(h))
    throw new AiUnavailableError(provider, h.status === "ok" ? "outage" : h.status);
}

export type CallRecord = {
  model: string;
  task?: string | null;
  feature?: string | null;
  ok: boolean;
  error?: unknown;
  usage?: {
    input?: number | null;
    cached?: number | null;
    output?: number | null;
    reasoning?: number | null;
  } | null;
  ms?: number | null;
  /** The ai-health probe: logged, never alerted on. */
  probe?: boolean;
};

/**
 * Keeps a call on record and moves its provider's health: an answer marks it ok (and, after
 * an incident, recovered); credits or a refused key mark it down at once; an outage only after
 * `OUTAGE_AFTER` failures in a row. Never throws: a log that can't be written loses a row,
 * never a coaching job.
 */
export async function recordAiCall(c: CallRecord): Promise<void> {
  const provider = providerOf(c.model);
  const kind: AiFailureKind | null = c.ok ? null : classifyAiError(c.error);
  // the breaker's own refusals cost nothing and say nothing new about the provider
  if (kind === "paused") return;
  const db = await admin().catch(() => null);
  if (!db) return;
  const now = new Date().toISOString();
  try {
    await db.from("ai_call_log").insert({
      at: now,
      provider,
      model: c.model.slice(0, 120),
      task: String(c.task || "untagged").slice(0, 80),
      feature: c.feature ? String(c.feature).slice(0, 120) : null,
      ok: c.ok,
      failure: kind,
      error: c.ok ? null : errorText(c.error).slice(0, 400),
      input_tokens: c.usage?.input ?? null,
      cached_tokens: c.usage?.cached ?? null,
      output_tokens: c.usage?.output ?? null,
      reasoning_tokens: c.usage?.reasoning ?? null,
      ms: c.ms != null ? Math.round(c.ms) : null,
      cost_usd: c.ok || c.usage ? callCost(c.model, c.usage ?? {}) : null,
    });
  } catch (e: any) {
    console.error("[ai-health] call log not written", e?.message);
  }
  try {
    await moveHealth(db, provider, c.ok, kind, c.ok ? null : errorText(c.error));
  } catch (e: any) {
    console.error("[ai-health] health not updated", e?.message);
  }
}

async function moveHealth(
  db: any,
  provider: Provider,
  ok: boolean,
  kind: AiFailureKind | null,
  error: string | null,
): Promise<void> {
  const rows = await readHealth();
  const h = rows.get(provider) ?? blank(provider);
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  if (ok) {
    // an answer: back to ok (a recovery the ai-health tick acts on), else a light heartbeat
    if (h.status !== "ok") {
      const next: Partial<Health> = {
        status: "ok",
        failures_in_row: 0,
        last_ok_at: now,
        recovered_at: now,
        next_probe_at: null,
      };
      await db
        .from("ai_provider_health")
        .upsert({ provider, ...next, updated_at: now }, { onConflict: "provider" });
      rows.set(provider, { ...h, ...next });
    } else if (
      h.failures_in_row > 0 ||
      !h.last_ok_at ||
      nowMs - new Date(h.last_ok_at).getTime() > 5 * 60_000
    ) {
      await db
        .from("ai_provider_health")
        .upsert(
          { provider, status: "ok", failures_in_row: 0, last_ok_at: now, updated_at: now },
          { onConflict: "provider" },
        );
      rows.set(provider, { ...h, failures_in_row: 0, last_ok_at: now });
    }
    return;
  }
  if (!kind || kind === "answer" || kind === "other" || kind === "timeout" || kind === "rate")
    return;
  const inRow = h.failures_in_row + 1;
  const down: HealthStatus | null = isAccountFailure(kind)
    ? kind === "credits"
      ? "credits"
      : "auth"
    : kind === "outage" && inRow >= OUTAGE_AFTER
      ? "outage"
      : null;
  const next: Partial<Health> = {
    failures_in_row: inRow,
    last_failure_at: now,
    last_failure: (error ?? "").slice(0, 400),
    ...(down
      ? {
          status: down,
          since: h.status === "ok" ? now : (h.since ?? now),
          next_probe_at: new Date(nowMs + PROBE_EVERY_MS).toISOString(),
          ...(h.status === "ok" ? { alerted_at: null, recovery_done_at: null } : {}),
        }
      : {}),
  };
  await db
    .from("ai_provider_health")
    .upsert(
      { provider, status: down ?? h.status, ...next, updated_at: now },
      { onConflict: "provider" },
    );
  rows.set(provider, { ...h, ...next, status: down ?? h.status });
}

/**
 * The tick's probe: one tiny call (a few tokens on GPT-5 mini, a fraction of a cent) that goes
 * around the breaker. Answered, or refused for anything but credits, the key or an outage, the
 * provider is reachable and billing works.
 */
export async function probeOpenAi(): Promise<{
  ok: boolean;
  kind: AiFailureKind | null;
  ms: number;
}> {
  const t0 = Date.now();
  try {
    const { callModelNow } = await import("./model-client.server");
    await callModelNow("openai:gpt-5-mini", {
      system: "Reply with the single word OK.",
      prompt: "OK",
      effort: "minimal",
      maxOutputTokens: 64,
      timeoutMs: 20_000,
      tag: "probe",
      skipBreaker: true,
    });
    return { ok: true, kind: null, ms: Date.now() - t0 };
  } catch (e) {
    const kind = classifyAiError(e);
    const reachable = kind === "answer" || kind === "rate" || kind === "other";
    if (reachable)
      await recordAiCall({
        model: "openai:gpt-5-mini",
        task: "probe",
        ok: true,
        ms: Date.now() - t0,
      });
    return { ok: reachable, kind, ms: Date.now() - t0 };
  }
}

/** Forget the cached health (after the tick or a "Check now" changed it). */
export function clearHealthCache(): void {
  cache = null;
}

/**
 * For the few calls that fetch a provider themselves (pictures, Athlete Insights): the reason
 * it's paused (the breaker would refuse it), else null.
 */
export async function pausedReason(provider: Provider): Promise<string | null> {
  try {
    await assertProviderUp(provider);
    return null;
  } catch (e: any) {
    return String(e?.message ?? e);
  }
}

/** A direct fetch's answer as a call record: chat completions, Responses and image usage alike. */
export function usageOf(json: any): {
  input: number | null;
  cached: number | null;
  output: number | null;
  reasoning: number | null;
} {
  const u = json?.usage ?? {};
  return {
    input: u.input_tokens ?? u.prompt_tokens ?? null,
    cached: u.input_tokens_details?.cached_tokens ?? u.prompt_tokens_details?.cached_tokens ?? null,
    output: u.output_tokens ?? u.completion_tokens ?? null,
    reasoning:
      u.output_tokens_details?.reasoning_tokens ??
      u.completion_tokens_details?.reasoning_tokens ??
      null,
  };
}
