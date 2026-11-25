/**
 * Usage & spend (Nov 23 2026): what AI and texts cost the business, read as one picture. Pure.
 *
 * Every number comes from the ledgers the app already keeps: ai_call_log (one row per model call,
 * an estimated US$ from published prices, null when a model has none) and sms_log (one row per
 * text the gateway was asked for, the larger of Twilio's price and our estimate). Nothing here
 * invents a cost: an AI call with no price on file is counted as "unpriced", a text Twilio hasn't
 * confirmed is "unconfirmed", and the page says so.
 *
 * Both vendors bill in US dollars, so spend is shown in US$; the SMS budget is the coach's own
 * CAD figure (sms_settings.monthly_budget_cad) and is compared in CAD.
 */
import { featureName } from "@/lib/ai/ai-usage";
import { CATEGORY_LABEL } from "@/lib/sms-policy";

export type AreaKey =
  | "coaching"
  | "clients"
  | "membership"
  | "crew"
  | "cleo"
  | "sales"
  | "automations"
  | "security"
  | "other";

export const AREAS: { key: AreaKey; label: string; hint: string }[] = [
  { key: "coaching", label: "Coaching", hint: "Programs, nutrition plans, check-in recaps, the coaching queue, forms" },
  { key: "clients", label: "Clients & members", hint: "What people use themselves: food log, imports, exercise search, pain reports, texts to clients" },
  { key: "membership", label: "Membership", hint: "Membership automations" },
  { key: "crew", label: "Crew", hint: "Post decks, Athlete Insights, post pictures, lesson covers" },
  { key: "cleo", label: "Cleo", hint: "The AI assistant" },
  { key: "sales", label: "Sales", hint: "Lead texts, payment nudges" },
  { key: "automations", label: "Automations & alerts", hint: "Unread-message nudges, staff alerts, health checks" },
  { key: "security", label: "Sign-in & security", hint: "Setup links, sign-in codes, recovery" },
  { key: "other", label: "Other", hint: "Anything not tagged with a feature" },
];

export const AREA_LABEL: Record<AreaKey, string> = Object.fromEntries(AREAS.map((a) => [a.key, a.label])) as Record<AreaKey, string>;

const AI_AREA: Record<string, AreaKey> = {
  // coach tools and automated coaching
  strategy: "coaching",
  construct: "coaching",
  repair: "coaching",
  review: "coaching",
  interpret: "coaching",
  edit: "coaching",
  nutrition: "coaching",
  nutrition_write: "coaching",
  nutrition_roadmap: "coaching",
  roadmap: "coaching",
  checkin_recap: "coaching",
  recovery_write: "coaching",
  cardio_plan: "coaching",
  competition: "coaching",
  competition_extract: "coaching",
  session_brief: "coaching",
  session_analysis: "coaching",
  coach_write: "coaching",
  form_draft: "coaching",
  // what people use themselves
  meal_estimate: "clients",
  program_import: "clients",
  nutrition_import: "clients",
  nutrition_create: "clients",
  exercise_identify: "clients",
  pain_describe: "clients",
  pain_transcribe: "clients",
  // Crew
  post_write: "crew",
  daily_visual: "crew",
  post_picture: "crew",
  lesson_art: "crew",
  // Cleo
  assistant: "cleo",
  cleo_title: "cleo",
  cleo_memory: "cleo",
  cleo_dictation: "cleo",
  coach_voice: "coaching",
  // sales
  lead_reply: "sales",
  member_application: "sales",
  // platform
  probe: "automations",
};

/** The business area an AI call's task belongs to ("recovery_write:pain" reads as "recovery_write"). */
export function aiArea(task: string | null | undefined): AreaKey {
  const t = String(task ?? "").trim();
  if (!t || t === "untagged") return "other";
  if (AI_AREA[t]) return AI_AREA[t];
  const head = t.split(":")[0];
  if (AI_AREA[head]) return AI_AREA[head];
  if (/lead/.test(t)) return "sales";
  return "other";
}

const SMS_AREA: Record<string, AreaKey> = {
  security: "security",
  session: "clients",
  manual: "clients",
  bulk: "clients",
  test: "automations",
  reminder: "automations",
  staff_alert: "automations",
  admin_alert: "automations",
  payment: "sales",
  automation: "membership",
};

export function smsArea(category: string | null | undefined): AreaKey {
  return SMS_AREA[String(category ?? "")] ?? "other";
}

export function smsPurposeLabel(category: string): string {
  return CATEGORY_LABEL[category] ?? (category === "admin_alert" ? CATEGORY_LABEL.staff_alert : category.replace(/_/g, " "));
}

export function aiFeatureLabel(task: string): string {
  return featureName(task);
}

/** Where the month will land at today's pace: spend so far ÷ days gone × days in the month. */
export function projectMonth(spentSoFar: number, dayOfMonth: number, daysInMonth: number): number {
  if (dayOfMonth <= 0 || daysInMonth <= 0) return spentSoFar;
  const pace = spentSoFar / Math.min(dayOfMonth, daysInMonth);
  return round2(pace * daysInMonth);
}

/** A budget suggestion from the month's projection: 50% headroom, rounded up to a clean figure. */
export function suggestedBudget(projected: number, floor = 10): number {
  const want = Math.max(floor, projected * 1.5);
  const step = want >= 200 ? 50 : want >= 50 ? 10 : 5;
  return Math.ceil(want / step) * step;
}

export type BudgetRead = {
  spent: number;
  budget: number | null;
  pct: number | null;
  level: "none" | "ok" | "watch" | "close" | "over";
};

export function readBudget(spent: number, budget: number | null | undefined): BudgetRead {
  const b = budget && budget > 0 ? budget : null;
  if (!b) return { spent: round2(spent), budget: null, pct: null, level: "none" };
  const pct = (spent / b) * 100;
  return {
    spent: round2(spent),
    budget: b,
    pct: Math.round(pct),
    level: pct >= 100 ? "over" : pct >= 80 ? "close" : pct >= 50 ? "watch" : "ok",
  };
}

/**
 * A change in a count of people, only when it means something: null when both sides are under
 * `min` (1 → 2 people is "+100%", which says nothing).
 */
export function countChange(now: number, before: number, min = 5): number | null {
  if (Math.max(now, before) < min) return null;
  return changePct(now, before);
}

/** Day-over-day comparison of two totals, as a signed whole percent (null when there's nothing to compare). */
export function changePct(now: number, before: number): number | null {
  if (!before) return null;
  return Math.round(((now - before) / before) * 100);
}

export type UsageAlert = {
  key: string;
  tone: "critical" | "warning" | "info";
  title: string;
  body: string;
  action?: { label: string; to?: string; hash?: string };
};

export type AlertInput = {
  aiStatus: "ok" | "credits" | "auth" | "outage";
  aiSince: string | null;
  waiting: number;
  aiMonth: BudgetRead;
  aiProjected: number;
  aiHeld: boolean;
  smsMonth: BudgetRead;
  features: { key: string; name: string; calls: number; failed: number }[];
  unpricedCalls: number;
  gatewayCost: number;
  smsSent: number;
  smsUndelivered: number;
  smsUnconfirmed: number;
  unusual: string | null;
};

/**
 * What needs a look, most serious first. Each one says what it is and offers the next step; a
 * quiet month says nothing at all.
 */
export function usageAlerts(i: AlertInput): UsageAlert[] {
  const out: UsageAlert[] = [];
  if (i.aiStatus !== "ok") {
    out.push({
      key: "ai-down",
      tone: "critical",
      title:
        i.aiStatus === "credits"
          ? "AI is paused: OpenAI credits ran out"
          : i.aiStatus === "auth"
            ? "AI is paused: the OpenAI key was refused"
            : "AI is paused: OpenAI isn't answering",
      body:
        (i.aiStatus === "credits"
          ? "Add credits at platform.openai.com → Settings → Billing. "
          : i.aiStatus === "auth"
            ? "Check OPENAI_API_KEY. "
            : "It's retried every 10 minutes. ") +
        (i.waiting > 0 ? `${i.waiting} job${i.waiting === 1 ? " is" : "s are"} waiting and will run once it answers.` : "Nothing is lost: jobs wait and run once it answers."),
      action: { label: "See what's waiting", hash: "health" },
    });
  }
  if (i.aiMonth.level === "over")
    out.push({
      key: "ai-over",
      tone: "critical",
      title: `AI is over this month's budget (${i.aiMonth.pct}%)`,
      body: i.aiHeld
        ? "Background AI (the Crew post backlog) is on hold until next month or a higher budget. Coaching and client features keep running."
        : "Nothing is held back. Turn on the hold to stop background AI when the budget is reached.",
      action: { label: "Budgets & limits", hash: "controls" },
    });
  else if (i.aiMonth.level === "close")
    out.push({
      key: "ai-close",
      tone: "warning",
      title: `AI is at ${i.aiMonth.pct}% of this month's budget`,
      body: `At this pace the month ends near $${i.aiProjected.toFixed(2)}.`,
      action: { label: "Budgets & limits", hash: "controls" },
    });
  else if (i.aiMonth.level === "none" && i.aiProjected > 0)
    out.push({
      key: "ai-no-budget",
      tone: "info",
      title: "No monthly AI budget is set",
      body: `At this month's pace AI costs about $${i.aiProjected.toFixed(2)}. A budget alerts you at 80% and can hold background AI past 100%.`,
      action: { label: `Set a budget`, hash: "controls" },
    });
  if (i.unusual)
    out.push({ key: "ai-unusual", tone: "warning", title: "AI use is unusual today", body: i.unusual, action: { label: "See what's using it", hash: "features" } });
  if (i.smsMonth.level === "over")
    out.push({
      key: "sms-over",
      tone: "critical",
      title: "Texts are over this month's budget",
      body: "Automatic texts (nudges, payment and membership texts) are paused; session, account and your own texts still go out up to twice the budget.",
      action: { label: "Budgets & limits", hash: "controls" },
    });
  else if (i.smsMonth.level === "close")
    out.push({
      key: "sms-close",
      tone: "warning",
      title: `Texts are at ${i.smsMonth.pct}% of this month's budget`,
      body: "At 100% automatic texts pause until next month.",
      action: { label: "Budgets & limits", hash: "controls" },
    });
  const failing = i.features
    .filter((f) => f.calls >= 10 && f.failed / f.calls >= 0.1)
    .sort((a, b) => b.failed / b.calls - a.failed / a.calls)[0];
  if (failing)
    out.push({
      key: `ai-failing-${failing.key}`,
      tone: "warning",
      title: `${failing.name}: ${Math.round((failing.failed / failing.calls) * 100)}% of calls failed`,
      body: `${failing.failed} of ${failing.calls} calls in this period didn't get an answer.`,
      action: { label: "See failures", hash: "health" },
    });
  if (i.smsSent >= 10 && i.smsUndelivered / i.smsSent >= 0.05)
    out.push({
      key: "sms-undelivered",
      tone: "warning",
      title: `${i.smsUndelivered} texts weren't delivered`,
      body: "Carriers refused them (a wrong number, a landline or a block). The person's phone number may need fixing.",
      action: { label: "Texts", hash: "texts" },
    });
  if (i.gatewayCost > 0)
    out.push({
      key: "ai-gateway",
      tone: "info",
      title: "Some AI ran through Lovable credits",
      body: `About $${i.gatewayCost.toFixed(2)} of this period's AI went through the Lovable gateway (billed in Lovable credits). Every default route is on the OpenAI key; check Settings → AI for an override.`,
      action: { label: "AI settings", to: "/admin/settings/ai" },
    });
  const order = { critical: 0, warning: 1, info: 2 } as const;
  return out.sort((a, b) => order[a.tone] - order[b.tone]);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** "$0.42", "$12.30", "<$0.01" for a tiny non-zero cost. */
export function usd(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  if (v > 0 && v < 0.01) return "<$0.01";
  return `$${v.toFixed(2)}`;
}

/** A cost per operation: four decimals under a cent, else cents. */
export function perOp(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n === 0) return "$0";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(n < 1 ? 3 : 2)}`;
}
