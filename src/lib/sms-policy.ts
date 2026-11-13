/**
 * Pure rules for every text the app sends (no network, no database), shared by
 * the one sender (sms-gateway.server.ts), the cost dashboard and the tests.
 *
 * What may go out is decided in the database (public.sms_claim, under a lock),
 * so these helpers only shape the text and explain the numbers.
 */
import { smsSegments } from "@/lib/sms-identity";

/**
 * Why a text is sent. The category decides how the budget treats it:
 * - security: account access (recovery links, setup / sign-in links, invites).
 *   Own switch, never stopped by the budget.
 * - session, manual, test: essential (a PT reminder or last-minute change, a
 *   text the coach chose to send). Stop only at the hard cap (2x budget).
 * - reminder, payment, automation, staff_alert, bulk: nonessential. Stop at the
 *   budget.
 */
export type SmsCategory =
  | "security"
  | "session"
  | "manual"
  | "test"
  | "reminder"
  | "payment"
  | "automation"
  | "staff_alert"
  | "bulk";

export const ESSENTIAL_CATEGORIES: readonly SmsCategory[] = ["security", "session", "manual", "test"];

export const CATEGORY_LABEL: Record<string, string> = {
  security: "Account & sign-in",
  session: "Session reminders & changes",
  manual: "Texts you sent",
  test: "Test texts",
  reminder: "Unread message nudges",
  payment: "Payment setup nudge",
  automation: "Membership automations",
  staff_alert: "Alerts to staff",
  bulk: "Bulk texts",
};

/** sms_log.kind for a category (the column predates categories). */
export function kindForCategory(c: SmsCategory): string {
  switch (c) {
    case "security": return "security";
    case "session": return "session";
    case "reminder": return "reminder";
    case "bulk": return "bulk";
    case "test": return "test";
    case "staff_alert": return "admin_alert";
    case "payment":
    case "automation": return "automation";
    default: return "manual";
  }
}

/** E.164 for a typed phone. Ten digits are North American (+1). */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = String(raw).replace(/[^\d+]/g, "");
  if (!cleaned) return null;
  if (cleaned.startsWith("+")) return /^\+\d{8,15}$/.test(cleaned) ? cleaned : null;
  if (/^\d{10}$/.test(cleaned)) return "+1" + cleaned;
  if (/^1\d{10}$/.test(cleaned)) return "+" + cleaned;
  return /^\d{8,15}$/.test(cleaned) ? "+" + cleaned : null;
}

/**
 * The look-alike characters phones and editors put in (curly quotes, long
 * dashes, …, non-breaking spaces) swapped for plain ones, so a text stays in
 * GSM-7 (160 characters a segment) instead of UCS-2 (70). Twilio's
 * SmartEncoded does the same; doing it here keeps the segment count we log
 * equal to what Twilio bills. Emoji are left alone (the sender chose them).
 */
export function smartEncode(text: string): string {
  return text
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/…/g, "...")
    .replace(/[   ]/g, " ")
    .replace(/[​‌‍﻿]/g, "");
}

export { smsSegments };

/** Links that sign someone in or reset a password, never stored in the log. */
const SECRET_LINK = /https?:\/\/\S*(token|token_hash|invite|rt=|code=|otp)\S*/gi;

/** The text as it may be stored: sign-in and reset links replaced. */
export function redactSecrets(text: string): string {
  return text.replace(SECRET_LINK, "[link]");
}

/**
 * The first candidate that fits one segment, else the shortest. Candidates go
 * from friendliest to tersest; a reminder that tips into a second segment costs
 * double for nothing.
 */
export function fitOneSegment(candidates: string[]): string {
  const clean = candidates.map((c) => smartEncode(c).replace(/\s{2,}/g, " ").trim()).filter(Boolean);
  const fits = clean.find((c) => smsSegments(c) <= 1);
  if (fits) return fits;
  return clean.reduce((a, b) => (b.length < a.length ? b : a), clean[0] ?? "");
}

// ── Money ──────────────────────────────────────────────────────────────────

export type BudgetLevel = "ok" | "warn" | "alert" | "stopped" | "hard_stop";

/** Where this month's spend sits against the budget (CAD). */
export function budgetLevel(spentCad: number, budgetCad: number): { pct: number; level: BudgetLevel } {
  const pct = budgetCad > 0 ? (spentCad / budgetCad) * 100 : 0;
  const level: BudgetLevel =
    pct >= 200 ? "hard_stop" : pct >= 100 ? "stopped" : pct >= 80 ? "alert" : pct >= 50 ? "warn" : "ok";
  return { pct, level };
}

export const BUDGET_LEVEL_TEXT: Record<BudgetLevel, string> = {
  ok: "Under budget",
  warn: "Over half the budget",
  alert: "Close to the budget",
  stopped: "Budget reached: automatic texts paused",
  hard_stop: "Hard cap reached: only account texts go out",
};

export function cad(usd: number, rate: number): number {
  return usd * rate;
}

export function money(amount: number): string {
  const v = Number.isFinite(amount) ? amount : 0;
  return `$${v.toFixed(2)}`;
}

/** Estimated cost per billed segment in CAD from SMS settings (defaults: Canada long code + carrier fee). */
export function segmentCostCad(settings: { price_per_segment_usd?: number | string | null; usd_to_cad?: number | string | null } | null | undefined): number {
  return Number(settings?.price_per_segment_usd ?? 0.0161) * Number(settings?.usd_to_cad ?? 1.38);
}

/** "12 SMS segments billed, about $0.27 CAD." for a send to `people`. */
export function bulkCostLine(people: number, text: string, settings: Parameters<typeof segmentCostCad>[0]): string {
  const segs = Math.max(1, smsSegments(smartEncode(text ?? "")));
  const total = people * segs;
  return `${total} SMS segment${total === 1 ? "" : "s"} billed, about ${money(total * segmentCostCad(settings))} CAD.`;
}

/** Plain words for why a text didn't go out (sms_log.blocked_reason). */
export const BLOCKED_REASON_TEXT: Record<string, string> = {
  duplicate: "Already sent (duplicate stopped)",
  budget: "Monthly budget reached",
  hard_cap: "Hard cap reached",
  client_daily_cap: "Daily limit for this person",
  security_daily_cap: "Daily limit for this number",
  retry_limit: "Gave up after 3 failed tries",
  sms_disabled: "Texts are switched off",
  security_texts_off: "Account texts are switched off",
  no_phone: "No valid phone number",
  opted_out: "Opted out of texts",
  country_not_allowed: "Number outside Canada / US",
  no_from_phone: "No Twilio number set",
  not_configured: "SMS isn't set up",
  push_delivered: "Sent as a free push instead",
  automated_no_push: "Automated message: push only, no text",
};

/** Twilio's "this number replied STOP" (we mark them opted out). */
export const TWILIO_UNSUBSCRIBED = 21610;
