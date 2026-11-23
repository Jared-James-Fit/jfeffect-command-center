/**
 * Usage & spend (/admin/usage): one read of what AI and texts cost, what they're used for, how
 * reliably they work, and the limits that protect the month. Admins only; the ledgers have no
 * client policies, so they're read with the service role after the admin check. The SMS month
 * summary and AI credits overview check admin themselves and are read as the caller.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { featureName } from "@/lib/ai/ai-usage";
import {
  aiArea,
  AREAS,
  changePct,
  projectMonth,
  readBudget,
  round2,
  smsArea,
  smsPurposeLabel,
  suggestedBudget,
  usageAlerts,
  type AreaKey,
  type BudgetRead,
  type UsageAlert,
} from "./usage-model";

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

const TZ = "America/Winnipeg";
function localDay(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export type DailySpend = {
  day: string;
  ai: number;
  sms: number;
  aiCalls: number;
  aiFailed: number;
  smsSent: number;
  smsDelivered: number;
};

export type UsageView = {
  days: number;
  generatedAt: string;
  today: string;
  daily: DailySpend[];
  totals: {
    ai: number;
    aiPrev: number;
    aiChange: number | null;
    sms: number;
    smsPrev: number;
    smsChange: number | null;
    aiCalls: number;
    aiFailed: number;
    aiPaused: number;
    aiUnpriced: number;
    aiSuccess: number | null;
    gatewayCost: number;
  };
  ai: {
    status: "ok" | "credits" | "auth" | "outage";
    since: string | null;
    lastFailure: string | null;
    nextProbeAt: string | null;
    keySet: boolean;
    waiting: { coachingReplies: number; checkinRecaps: number; athleteInsights: number; postDecks: number };
    month: BudgetRead & { projected: number; dayOfMonth: number; daysInMonth: number };
    suggestedBudget: number;
    holdBackground: boolean;
    held: boolean;
    heldSince: string | null;
    errors: { at: string; feature: string; model: string; failure: string | null; error: string | null }[];
  };
  sms: {
    month: BudgetRead & { currency: "CAD"; actualCad: number | null; fixedCad: number; rate: number; level2: string };
    dailyCap: number | null;
    enabled: boolean;
    funnel: { asked: number; sent: number; delivered: number; unconfirmed: number; undelivered: number; failed: number; blocked: number; byPush: number };
    purposes: { category: string; label: string; area: AreaKey; sent: number; cost: number; delivered: number; undelivered: number; blocked: number; byPush: number }[];
  };
  areas: { key: AreaKey; label: string; hint: string; ai: number; sms: number; total: number; calls: number; texts: number }[];
  features: { key: string; name: string; area: AreaKey; calls: number; failed: number; cost: number; perCall: number | null; avgSeconds: number | null; unpriced: number; models: string[] }[];
  models: { model: string; provider: string; calls: number; failed: number; cost: number; perCall: number | null; avgSeconds: number | null; tokens: number; unpriced: number }[];
  credits: { uses: number; people: number; credits: number; costUsd: number; salesCount: number; salesMinor: number } | null;
  alerts: UsageAlert[];
};

export const getUsageViewFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { days?: number }) => z.object({ days: z.number().int().min(7).max(90).optional() }).parse(d ?? {}))
  .handler(async ({ data, context }): Promise<UsageView> => {
    await assertAdmin(context);
    const db = await admin();
    const days = data.days ?? 30;
    const sinceIso = new Date(Date.now() - days * 86_400_000).toISOString();
    const today = localDay();
    const firstDay = localDay(new Date(Date.now() - (days - 1) * 86_400_000));
    const prevFirst = localDay(new Date(Date.now() - (2 * days - 1) * 86_400_000));

    const { readHealthView } = await import("@/lib/ai/ai-usage.functions");
    const [health, aiDaily, smsDaily, byTask, byModel, smsCats, months, errs, budgetRow, holdRow, smsSettings, smsMonth, creditsRes, unusualRow] =
      await Promise.all([
        readHealthView(db),
        db.rpc("ops_ai_daily", { _days: days * 2 }),
        db.rpc("ops_sms_daily", { _days: days * 2 }),
        db.rpc("ai_usage_by_task", { _since: sinceIso }),
        db.rpc("ops_ai_by_model", { _since: sinceIso }),
        db.rpc("ops_sms_by_category", { _since: sinceIso }),
        db.rpc("ai_usage_by_month", { _months: 1 }),
        db
          .from("ai_call_log")
          .select("at, task, model, failure, error")
          .eq("ok", false)
          .neq("failure", "paused")
          .gte("at", sinceIso)
          .order("at", { ascending: false })
          .limit(8),
        db.from("app_settings").select("value").eq("key", "ai_budget").maybeSingle(),
        db.from("app_settings").select("value").eq("key", "ai_spend_hold").maybeSingle(),
        db.from("sms_settings").select("enabled, monthly_budget_cad, usd_to_cad, number_fee_usd, client_daily_cap, twilio_usage").eq("singleton", true).maybeSingle(),
        (context.supabase as any).rpc("sms_cost_summary"),
        (context.supabase as any).rpc("ai_credits_overview", { _days: days }),
        db.from("support_alerts").select("error_message").eq("error_type", "ai_unusual_usage").in("status", ["open", "in_progress"]).limit(1).maybeSingle(),
      ]);
    for (const r of [aiDaily, smsDaily, byTask, byModel, smsCats]) if (r.error) throw new Error(r.error.message);

    // ---- daily, this period and the one before
    const aiByDay = new Map<string, any>(((aiDaily.data ?? []) as any[]).map((r) => [String(r.day), r]));
    const smsByDay = new Map<string, any>(((smsDaily.data ?? []) as any[]).map((r) => [String(r.day), r]));
    const daily: DailySpend[] = [];
    let aiPrev = 0;
    let smsPrev = 0;
    for (let i = 2 * days - 1; i >= 0; i--) {
      const day = localDay(new Date(Date.now() - i * 86_400_000));
      const a = aiByDay.get(day);
      const s = smsByDay.get(day);
      if (day < firstDay) {
        if (day >= prevFirst) {
          aiPrev += Number(a?.cost ?? 0);
          smsPrev += Number(s?.cost_usd ?? 0);
        }
        continue;
      }
      daily.push({
        day,
        ai: round4(Number(a?.cost ?? 0)),
        sms: round4(Number(s?.cost_usd ?? 0)),
        aiCalls: Number(a?.calls ?? 0),
        aiFailed: Number(a?.failed ?? 0),
        smsSent: Number(s?.sent ?? 0),
        smsDelivered: Number(s?.delivered ?? 0),
      });
    }
    const aiTotal = daily.reduce((n, d) => n + d.ai, 0);
    const smsTotal = daily.reduce((n, d) => n + d.sms, 0);
    const aiDailyRows = ((aiDaily.data ?? []) as any[]).filter((r) => String(r.day) >= firstDay);
    const aiCalls = aiDailyRows.reduce((n, r) => n + Number(r.calls), 0);
    const aiFailed = aiDailyRows.reduce((n, r) => n + Number(r.failed), 0);
    const aiPaused = aiDailyRows.reduce((n, r) => n + Number(r.paused), 0);
    const aiUnpriced = aiDailyRows.reduce((n, r) => n + Number(r.unpriced), 0);
    const gatewayCost = aiDailyRows.reduce((n, r) => n + Number(r.gateway_cost), 0);

    // ---- features and models
    const features = ((byTask.data ?? []) as any[])
      .map((r) => {
        const calls = Number(r.calls);
        const okPriced = Number(r.ok_priced);
        return {
          key: String(r.task),
          name: featureName(String(r.task)),
          area: aiArea(r.task),
          calls,
          failed: Number(r.failed),
          cost: round4(Number(r.cost)),
          perCall: okPriced ? Number(r.ok_cost) / okPriced : null,
          avgSeconds: r.avg_ms != null ? Math.round(Number(r.avg_ms) / 100) / 10 : null,
          unpriced: Math.max(0, calls - Number(r.priced) - Number(r.paused)),
          models: (r.models ?? []) as string[],
        };
      })
      .sort((a, b) => b.cost - a.cost || b.calls - a.calls);
    const models = ((byModel.data ?? []) as any[])
      .map((r) => {
        const okPriced = Number(r.ok_priced);
        return {
          model: String(r.model),
          provider: String(r.provider ?? "openai"),
          calls: Number(r.calls),
          failed: Number(r.failed),
          cost: round4(Number(r.cost)),
          perCall: okPriced ? Number(r.ok_cost) / okPriced : null,
          avgSeconds: r.avg_ms != null ? Math.round(Number(r.avg_ms) / 100) / 10 : null,
          tokens: Number(r.tokens),
          unpriced: Math.max(0, Number(r.calls) - Number(r.priced)),
        };
      })
      .sort((a, b) => b.cost - a.cost || b.calls - a.calls);

    // ---- texts
    const purposes = ((smsCats.data ?? []) as any[])
      .map((r) => ({
        category: String(r.category),
        label: smsPurposeLabel(String(r.category)),
        area: smsArea(r.category),
        sent: Number(r.sent),
        cost: round4(Number(r.cost_usd)),
        delivered: Number(r.delivered),
        undelivered: Number(r.undelivered),
        blocked: Number(r.blocked),
        byPush: Number(r.by_push),
      }))
      .sort((a, b) => b.cost - a.cost || b.sent - a.sent);
    const smsRows = ((smsDaily.data ?? []) as any[]).filter((r) => String(r.day) >= firstDay);
    const sum = (k: string) => smsRows.reduce((n, r) => n + Number(r[k] ?? 0), 0);
    const funnel = {
      asked: sum("asked"),
      sent: sum("sent"),
      delivered: sum("delivered"),
      unconfirmed: sum("unconfirmed"),
      undelivered: sum("undelivered"),
      failed: sum("failed"),
      blocked: sum("blocked"),
      byPush: purposes.reduce((n, p) => n + p.byPush, 0),
    };

    // ---- areas: AI and texts together
    const areas = AREAS.map((a) => {
      const aiCost = features.filter((f) => f.area === a.key).reduce((n, f) => n + f.cost, 0);
      const smsCost = purposes.filter((p) => p.area === a.key).reduce((n, p) => n + p.cost, 0);
      return {
        ...a,
        ai: round4(aiCost),
        sms: round4(smsCost),
        total: round4(aiCost + smsCost),
        calls: features.filter((f) => f.area === a.key).reduce((n, f) => n + f.calls, 0),
        texts: purposes.filter((p) => p.area === a.key).reduce((n, p) => n + p.sent, 0),
      };
    })
      .filter((a) => a.total > 0 || a.calls > 0 || a.texts > 0)
      .sort((a, b) => b.total - a.total || b.calls + b.texts - (a.calls + a.texts));

    // ---- the month: AI (US$, Winnipeg month) and texts (CAD, the SMS ledger's month)
    let budgetSetting: any = {};
    try {
      budgetSetting = JSON.parse(budgetRow.data?.value ?? "{}") ?? {};
    } catch {
      budgetSetting = {};
    }
    let hold: any = {};
    try {
      hold = JSON.parse(holdRow.data?.value ?? "{}") ?? {};
    } catch {
      hold = {};
    }
    const month = today.slice(0, 7);
    const aiMonthSpent = Number(((months.data ?? []) as any[]).find((m) => m.month === month)?.cost ?? 0);
    const dayOfMonth = Number(today.slice(8, 10));
    const [y, m] = month.split("-").map(Number);
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const aiProjected = projectMonth(aiMonthSpent, dayOfMonth, daysInMonth);
    const aiMonth = { ...readBudget(aiMonthSpent, Number(budgetSetting.monthly_usd ?? 0)), projected: aiProjected, dayOfMonth, daysInMonth };

    const st = smsSettings.data ?? {};
    const rate = Number(st.usd_to_cad ?? 1.38) || 1.38;
    const smsSummary = smsMonth.data ?? null;
    const smsSpentCad = Number(smsSummary?.spent_usd ?? 0) * rate;
    const usage = st.twilio_usage ?? null;
    const actualCad =
      usage && smsSummary && usage.month === smsSummary.month && usage.total != null
        ? String(usage.price_unit ?? "USD").toUpperCase() === "USD"
          ? Number(usage.total) * rate
          : Number(usage.total)
        : null;
    const smsBudgetRead = readBudget(smsSpentCad, Number(st.monthly_budget_cad ?? 0));
    const smsLevel2 =
      smsBudgetRead.pct != null && smsBudgetRead.pct >= 200 ? "hard_stop" : smsBudgetRead.level;

    const c = creditsRes?.data ?? null;
    const credits = c
      ? {
          uses: Number(c.uses?.count ?? 0),
          people: Number(c.uses?.people ?? 0),
          credits: Number(c.uses?.credits ?? 0),
          costUsd: Number(c.uses?.cost_usd ?? 0),
          salesCount: Number(c.sales?.count ?? 0),
          salesMinor: Number(c.sales?.amount_minor ?? 0),
        }
      : null;

    const waiting = health.waiting;
    const waitingTotal = waiting.coachingReplies + waiting.checkinRecaps + waiting.athleteInsights + waiting.postDecks;
    const view: UsageView = {
      days,
      generatedAt: new Date().toISOString(),
      today,
      daily,
      totals: {
        ai: round2(aiTotal),
        aiPrev: round2(aiPrev),
        aiChange: changePct(aiTotal, aiPrev),
        sms: round2(smsTotal),
        smsPrev: round2(smsPrev),
        smsChange: changePct(smsTotal, smsPrev),
        aiCalls,
        aiFailed,
        aiPaused,
        aiUnpriced,
        aiSuccess: aiCalls - aiPaused > 0 ? Math.round(((aiCalls - aiPaused - aiFailed) / (aiCalls - aiPaused)) * 1000) / 10 : null,
        gatewayCost: round2(gatewayCost),
      },
      ai: {
        status: health.openai.status,
        since: health.openai.since,
        lastFailure: health.openai.lastFailure,
        nextProbeAt: health.openai.nextProbeAt,
        keySet: health.keySet,
        waiting,
        month: aiMonth,
        suggestedBudget: suggestedBudget(aiProjected),
        holdBackground: budgetSetting.hold_background !== false,
        held: !!hold.held && hold.month === month,
        heldSince: hold.held ? (hold.since ?? null) : null,
        errors: ((errs.data ?? []) as any[]).map((e) => ({
          at: e.at,
          feature: featureName(e.task),
          model: e.model,
          failure: e.failure,
          error: e.error,
        })),
      },
      sms: {
        month: { ...smsBudgetRead, currency: "CAD", actualCad: actualCad != null ? round2(actualCad) : null, fixedCad: round2(Number(st.number_fee_usd ?? 1.15) * rate), rate, level2: smsLevel2 },
        dailyCap: st.client_daily_cap ?? null,
        enabled: st.enabled !== false,
        funnel,
        purposes,
      },
      areas,
      features,
      models,
      credits,
      alerts: [],
    };
    view.alerts = usageAlerts({
      aiStatus: view.ai.status,
      aiSince: view.ai.since,
      waiting: waitingTotal,
      aiMonth: view.ai.month,
      aiProjected,
      aiHeld: view.ai.held,
      smsMonth: smsBudgetRead,
      features,
      unpricedCalls: aiUnpriced,
      gatewayCost,
      smsSent: funnel.sent,
      smsUndelivered: funnel.undelivered,
      smsUnconfirmed: funnel.unconfirmed,
      unusual: unusualRow?.data?.error_message ?? null,
    });
    return view;
  });

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
