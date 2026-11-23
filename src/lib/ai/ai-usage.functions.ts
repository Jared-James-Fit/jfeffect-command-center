/**
 * The admin panel's AI health and spend (Settings → AI & Cleo; Nov 23 2026): whether OpenAI is
 * answering, what's waiting on it, what the last recovery redid, the open AI alerts, usage and
 * estimated cost per feature, the monthly trend, and the month's budget. Admins only; read with
 * the service role after the role check (ai_call_log and ai_provider_health have no policies).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { featureName } from "./ai-usage";

async function assertAdmin(context: any): Promise<void> {
  const { data } = await (context.supabase as any).rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (!data) throw new Error("Admins only.");
}

async function admin(): Promise<any> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

export type AiHealthView = {
  openai: {
    status: "ok" | "credits" | "auth" | "outage";
    since: string | null;
    lastOkAt: string | null;
    lastFailure: string | null;
    nextProbeAt: string | null;
    recoveredAt: string | null;
    recoveryDoneAt: string | null;
    recoverySummary: string | null;
  };
  waiting: {
    coachingReplies: number;
    checkinRecaps: number;
    athleteInsights: number;
    postDecks: number;
  };
  alerts: { type: string; message: string; at: string }[];
  keySet: boolean;
};

const AI_ALERT_TYPES = [
  "ai_unavailable",
  "ai_failures",
  "ai_stuck_jobs",
  "ai_unusual_usage",
  "ai_budget",
];

export async function readHealthView(db: any): Promise<AiHealthView> {
  const count = async (q: any) => (await q).count ?? 0;
  const head = { count: "exact" as const, head: true };
  const [h, alerts, replies, recaps, insights, decks] = await Promise.all([
    db.from("ai_provider_health").select("*").eq("provider", "openai").maybeSingle(),
    db
      .from("support_alerts")
      .select("error_type, error_message, updated_at, created_at")
      .in("error_type", AI_ALERT_TYPES)
      .in("status", ["open", "in_progress"])
      .order("created_at", { ascending: false }),
    count(
      db
        .from("coach_automation_items")
        .select("id", head)
        .eq("status", "queued")
        .like("error", "Waiting for AI%"),
    ),
    count(
      db
        .from("messenger_checkins")
        .select("id", head)
        .eq("status", "completed")
        .eq("ai_status", "failed")
        .is("reviewed_at", null),
    ),
    count(db.from("community_daily_visuals").select("id", head).like("error", "Waiting for AI%")),
    count(db.from("community_post_decks").select("id", head).eq("status", "pending")),
  ]);
  const r = (h.data ?? {}) as any;
  return {
    openai: {
      status: r.status ?? "ok",
      since: r.since ?? null,
      lastOkAt: r.last_ok_at ?? null,
      lastFailure: r.last_failure ?? null,
      nextProbeAt: r.next_probe_at ?? null,
      recoveredAt: r.recovered_at ?? null,
      recoveryDoneAt: r.recovery_done_at ?? null,
      recoverySummary: r.recovery_report?.summary ?? null,
    },
    waiting: {
      coachingReplies: replies,
      checkinRecaps: recaps,
      athleteInsights: insights,
      postDecks: decks,
    },
    alerts: ((alerts.data ?? []) as any[]).map((a) => ({
      type: a.error_type,
      message: a.error_message,
      at: a.updated_at ?? a.created_at,
    })),
    keySet: !!process.env.OPENAI_API_KEY,
  };
}

export const getAiHealthFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    return readHealthView(await admin());
  });

/** "Check now": one probe and a full health pass (alerts, recovery) right away. */
export const aiHealthCheckNowFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const db = await admin();
    const { runAiHealthTick } = await import("./ai-monitor.server");
    await runAiHealthTick(db, { forceProbe: true });
    return readHealthView(db);
  });

export type AiUsageView = {
  days: number;
  totals: {
    calls: number;
    failed: number;
    paused: number;
    cost: number;
    openaiCost: number;
    unpriced: number;
  };
  features: {
    key: string;
    name: string;
    calls: number;
    failed: number;
    cost: number;
    perCall: number | null;
    avgSeconds: number | null;
    tokens: number;
    models: string[];
    unpriced: number;
  }[];
  months: {
    month: string;
    calls: number;
    failed: number;
    cost: number;
    openaiCost: number;
    gatewayCost: number;
    unpriced: number;
  }[];
  errors: {
    at: string;
    task: string;
    model: string;
    failure: string | null;
    error: string | null;
  }[];
  budget: number | null;
};

export const getAiUsageFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { days?: number }) =>
    z.object({ days: z.number().int().min(1).max(90).optional() }).parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<AiUsageView> => {
    await assertAdmin(context);
    const db = await admin();
    const days = data.days ?? 30;
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const [byTask, byMonth, errs, budget] = await Promise.all([
      db.rpc("ai_usage_by_task", { _since: since }),
      db.rpc("ai_usage_by_month", { _months: 12 }),
      db
        .from("ai_call_log")
        .select("at, task, model, failure, error")
        .eq("ok", false)
        .neq("failure", "paused")
        .gte("at", since)
        .order("at", { ascending: false })
        .limit(12),
      db.from("app_settings").select("value").eq("key", "ai_budget").maybeSingle(),
    ]);
    if (byTask.error) throw new Error(byTask.error.message);
    const features = ((byTask.data ?? []) as any[])
      .map((r) => {
        const calls = Number(r.calls);
        const okPriced = Number(r.ok_priced);
        return {
          key: r.task,
          name: featureName(r.task),
          calls,
          failed: Number(r.failed),
          cost: Math.round(Number(r.cost) * 100) / 100,
          perCall: okPriced ? Math.round((Number(r.ok_cost) / okPriced) * 10000) / 10000 : null,
          avgSeconds: r.avg_ms != null ? Math.round(Number(r.avg_ms) / 100) / 10 : null,
          tokens: Number(r.tokens),
          models: (r.models ?? []) as string[],
          unpriced: calls - Number(r.priced) - Number(r.paused),
        };
      })
      .sort((a, b) => b.cost - a.cost || b.calls - a.calls);
    let monthly: number | null = null;
    try {
      monthly = Number(JSON.parse(budget.data?.value ?? "{}")?.monthly_usd ?? 0) || null;
    } catch {
      monthly = null;
    }
    const rows = (byTask.data ?? []) as any[];
    return {
      days,
      totals: {
        calls: rows.reduce((n, r) => n + Number(r.calls), 0),
        failed: rows.reduce((n, r) => n + Number(r.failed), 0),
        paused: rows.reduce((n, r) => n + Number(r.paused), 0),
        cost: Math.round(rows.reduce((n, r) => n + Number(r.cost), 0) * 100) / 100,
        openaiCost: Math.round(rows.reduce((n, r) => n + Number(r.openai_cost), 0) * 100) / 100,
        unpriced: features.reduce((n, f) => n + Math.max(0, f.unpriced), 0),
      },
      features,
      months: ((byMonth.data ?? []) as any[]).map((m) => ({
        month: m.month,
        calls: Number(m.calls),
        failed: Number(m.failed),
        cost: Math.round(Number(m.cost) * 100) / 100,
        openaiCost: Math.round(Number(m.openai_cost) * 100) / 100,
        gatewayCost: Math.round(Number(m.gateway_cost) * 100) / 100,
        unpriced: Number(m.unpriced),
      })),
      errors: ((errs.data ?? []) as any[]).map((e) => ({
        at: e.at,
        task: featureName(e.task),
        model: e.model,
        failure: e.failure,
        error: e.error,
      })),
      budget: monthly,
    };
  });

/** The month's AI budget in US$ (alerts at 80% and 100%); 0 or empty turns it off. */
export const setAiBudgetFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { monthlyUsd: number | null; holdBackground?: boolean }) =>
    z
      .object({
        monthlyUsd: z.number().min(0).max(100_000).nullable(),
        holdBackground: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const db = await admin();
    const { data: row } = await db
      .from("app_settings")
      .select("id, value")
      .eq("key", "ai_budget")
      .maybeSingle();
    let before: { hold_background?: boolean } = {};
    try {
      before = JSON.parse(row?.value ?? "{}") ?? {};
    } catch {
      before = {};
    }
    // the hold is on unless the owner turned it off (it only ever acts with a budget set)
    const hold = data.holdBackground ?? before.hold_background ?? true;
    const value = JSON.stringify({ monthly_usd: data.monthlyUsd || 0, hold_background: hold });
    if (row?.id)
      await db
        .from("app_settings")
        .update({ value, updated_at: new Date().toISOString() })
        .eq("id", row.id);
    else await db.from("app_settings").insert({ key: "ai_budget", value });
    // the hold follows the new budget at once, not at the next hourly read
    try {
      const { refreshSpendHold } = await import("./ai-monitor.server");
      await refreshSpendHold(db);
    } catch (e: any) {
      console.error("[ai-budget] hold not refreshed", e?.message);
    }
    return { ok: true };
  });

/**
 * For the Coaching queue: whether AI drafts are paused right now (any staff member with the queue
 * sees it; the details stay on the admin panel).
 */
export const getAiPausedFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: staff } = await (context.supabase as any).rpc("has_role", {
      _user_id: context.userId,
      _role: "coach",
    });
    const { data: isAdmin } = await (context.supabase as any).rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!staff && !isAdmin) return { paused: false as const };
    const db = await admin();
    const { data } = await db
      .from("ai_provider_health")
      .select("status, since")
      .eq("provider", "openai")
      .maybeSingle();
    if (!data || data.status === "ok") return { paused: false as const };
    return {
      paused: true as const,
      reason: data.status as "credits" | "auth" | "outage",
      since: data.since as string | null,
    };
  });
