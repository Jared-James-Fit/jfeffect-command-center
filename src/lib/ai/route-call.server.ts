/**
 * One short routed call answered inside the request (Nov 18 2026): the route's models in order
 * (src/lib/ai/routing.ts), each through callModelNow, the next one when a model fails or says
 * nothing. The admin's override (app_settings.ai_routes) is honoured like every other route.
 * For coach-side writing a person reads before anything reaches a client: the check-in recap,
 * AI drafts of a reply, a lead's first text, the inbox Brief, My Voice's "Try it".
 */
import { callModelNow, type ModelReply } from "./model-client.server";
import { resolveRoute, type AiTask } from "./routing";
import { classifyAiError, isAccountFailure, AiUnavailableError } from "./ai-errors";

type Db = any;

/** The admin's route override, if any (null when unset or unreadable). */
export async function readRouteOverride(sb: Db): Promise<Partial<Record<AiTask, string[]>> | null> {
  try {
    const { data } = await sb.from("app_settings").select("value").eq("key", "ai_routes").maybeSingle();
    return data?.value ? JSON.parse(data.value) : null;
  } catch {
    return null;
  }
}

export class RouteExhausted extends Error {}

/** "openai" for "openai:…", "gateway" for "gateway:…": models on one key share its credits. */
const keyOf = (model: string) => (model.startsWith("gateway:") ? "gateway" : "openai");

export async function askRoute(
  task: AiTask,
  req: { system: string; prompt: string; timeoutMs?: number; /** ai_call_log feature (default: the task) */ tag?: string },
  opts: { sb?: Db; override?: Partial<Record<AiTask, string[]>> | null } = {},
): Promise<ModelReply> {
  const override = opts.override !== undefined ? opts.override : opts.sb ? await readRouteOverride(opts.sb) : null;
  const route = resolveRoute(task, override);
  let last = "no answer";
  // a key whose credits ran out (or was refused, or is paused) answers for none of its models:
  // the next model on the same key is never asked, so a dead account costs one call, not two
  const deadKeys = new Set<string>();
  let paused: AiUnavailableError | null = null;
  for (const model of route.models) {
    if (deadKeys.has(keyOf(model))) continue;
    try {
      const reply = await callModelNow(model, { system: req.system, prompt: req.prompt, effort: route.effort, maxOutputTokens: route.maxOutputTokens, timeoutMs: req.timeoutMs ?? 45_000, tag: req.tag ?? task });
      if (reply.text?.trim()) return reply;
      last = `${model}: empty answer`;
    } catch (e: any) {
      last = `${model}: ${e?.message ?? e}`;
      const kind = classifyAiError(e);
      if (kind === "paused") paused = e as AiUnavailableError;
      if (isAccountFailure(kind) || kind === "paused") deadKeys.add(keyOf(model));
      console.error(`[ai:${task}] model failed`, { model, kind, message: e?.message });
    }
  }
  if (paused && deadKeys.size >= new Set(route.models.map(keyOf)).size) throw paused;
  throw new RouteExhausted(`No model answered (${last})`);
}
