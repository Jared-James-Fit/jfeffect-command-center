/**
 * One short routed call answered inside the request (Nov 18 2026): the route's models in order
 * (src/lib/ai/routing.ts), each through callModelNow, the next one when a model fails or says
 * nothing. The admin's override (app_settings.ai_routes) is honoured like every other route.
 * For coach-side writing a person reads before anything reaches a client: the check-in recap,
 * AI drafts of a reply, a lead's first text, the inbox Brief, My Voice's "Try it".
 */
import { callModelNow, type ModelReply } from "./model-client.server";
import { resolveRoute, type AiTask } from "./routing";

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

export async function askRoute(
  task: AiTask,
  req: { system: string; prompt: string; timeoutMs?: number },
  opts: { sb?: Db; override?: Partial<Record<AiTask, string[]>> | null } = {},
): Promise<ModelReply> {
  const override = opts.override !== undefined ? opts.override : opts.sb ? await readRouteOverride(opts.sb) : null;
  const route = resolveRoute(task, override);
  let last = "no answer";
  for (const model of route.models) {
    try {
      const reply = await callModelNow(model, { system: req.system, prompt: req.prompt, effort: route.effort, maxOutputTokens: route.maxOutputTokens, timeoutMs: req.timeoutMs ?? 45_000 });
      if (reply.text?.trim()) return reply;
      last = `${model}: empty answer`;
    } catch (e: any) {
      last = `${model}: ${e?.message ?? e}`;
      console.error(`[ai:${task}] model failed`, { model, message: e?.message });
    }
  }
  throw new RouteExhausted(`No model answered (${last})`);
}
