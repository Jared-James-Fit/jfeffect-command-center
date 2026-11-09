/**
 * The admin AI panel's data: which models are reachable (the last live check),
 * which model answers each coaching task, and how the generator and Edit with AI
 * calls went over the last 30 days (per model and task: calls, failures, speed,
 * tokens, an estimated cost where the price has a source). Admins only.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DEFAULT_ROUTES, resolveRoute, type AiTask } from "./routing";

async function assertAdmin(context: any): Promise<void> {
  const { data } = await (context.supabase as any).rpc("has_role", { _user_id: context.userId, _role: "admin" });
  if (!data) throw new Error("Admins only.");
}

type CallRow = { model: string; stage: string; ok: boolean; duration_ms: number | null; input_tokens: number | null; output_tokens: number | null; error: string | null; created_at: string };

export type AiStat = { source: "generator" | "edit"; model: string; task: string; calls: number; failed: number; avgSeconds: number | null; maxSeconds: number | null; inputTokens: number; outputTokens: number; estCost: number | null };

/** "construct:2 (retry)" → "construct"; "repair:block 1:1" → "repair". */
export function taskOf(stage: string): string {
  return stage.split(/[: ]/)[0] || stage;
}

export function summarizeCalls(rows: CallRow[], source: AiStat["source"], estimate: (model: string, i: number | null, o: number | null) => number | null): AiStat[] {
  const by = new Map<string, CallRow[]>();
  for (const r of rows) {
    const k = `${r.model}|${taskOf(r.stage)}`;
    by.set(k, [...(by.get(k) ?? []), r]);
  }
  return [...by.entries()]
    .map(([k, list]) => {
      const [model, task] = k.split("|");
      const ok = list.filter((r) => r.ok && r.duration_ms != null);
      const inputTokens = list.reduce((n, r) => n + (r.input_tokens ?? 0), 0);
      const outputTokens = list.reduce((n, r) => n + (r.output_tokens ?? 0), 0);
      const costs = list.map((r) => estimate(model, r.input_tokens, r.output_tokens));
      return {
        source,
        model,
        task,
        calls: list.length,
        failed: list.filter((r) => !r.ok).length,
        avgSeconds: ok.length ? Math.round(ok.reduce((n, r) => n + (r.duration_ms ?? 0), 0) / ok.length / 100) / 10 : null,
        maxSeconds: ok.length ? Math.round(Math.max(...ok.map((r) => r.duration_ms ?? 0)) / 100) / 10 : null,
        inputTokens,
        outputTokens,
        estCost: costs.some((c) => c == null) ? null : Math.round(costs.reduce((n: number, c) => n + (c as number), 0) * 100) / 100,
      };
    })
    .sort((a, b) => b.calls - a.calls);
}

export const aiStatusFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { estimateCost } = await import("./model-client.server");
    const { MODEL_CHECK_KEY } = await import("./model-status.server");
    const db = supabaseAdmin as any;
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const cols = "model, stage, ok, duration_ms, input_tokens, output_tokens, error, created_at";
    const [gen, edit, check, routes] = await Promise.all([
      db.from("program_intel_job_calls").select(cols).gte("created_at", since).order("created_at", { ascending: false }).limit(2000),
      db.from("program_ai_edit_calls").select(cols).gte("created_at", since).order("created_at", { ascending: false }).limit(2000),
      db.from("app_settings").select("value, updated_at").eq("key", MODEL_CHECK_KEY).maybeSingle(),
      db.from("app_settings").select("value").eq("key", "ai_routes").maybeSingle(),
    ]);
    let override: any = null;
    try {
      override = routes.data?.value ? JSON.parse(routes.data.value) : null;
    } catch {
      override = null;
    }
    const tasks = Object.keys(DEFAULT_ROUTES) as AiTask[];
    const rows = [...((gen.data ?? []) as CallRow[]).map((r) => ({ ...r, source: "generator" as const })), ...((edit.data ?? []) as CallRow[]).map((r) => ({ ...r, source: "edit" as const }))];
    return {
      routes: tasks.map((t) => ({ task: t, ...resolveRoute(t, override), overridden: !!override?.[t] })),
      check: check.data?.value ? JSON.parse(check.data.value) : null,
      stats: [...summarizeCalls((gen.data ?? []) as CallRow[], "generator", estimateCost), ...summarizeCalls((edit.data ?? []) as CallRow[], "edit", estimateCost)],
      errors: rows
        .filter((r) => !r.ok)
        .slice(0, 12)
        .map((r) => ({ at: r.created_at, source: r.source, model: r.model, task: taskOf(r.stage), error: String(r.error ?? "").slice(0, 240) })),
    };
  });

export const aiCheckNowFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { checkModels } = await import("./model-check.server");
    const { saveModelCheck } = await import("./model-status.server");
    const result = await checkModels({ probe: true });
    await saveModelCheck(result);
    return result;
  });
