/**
 * Server-only: the one way the app sends a text.
 *
 * Every send asks the database first (public.sms_claim, one lock for every
 * worker): master switch, the separate account-security switch, opt-out, +1
 * numbers only, the idempotency key, the retry limit, the per-client daily cap,
 * the monthly budget (nonessential texts stop at 100%) and the hard cap (2x).
 * The claim writes the sms_log row before Twilio is called, so two workers can
 * never send the same text twice, and a crash mid-send never frees its key.
 * Twilio's answer is written back with sms_finish; what Twilio billed and
 * whether it delivered are read back later by sms-status.server.ts.
 *
 * Never import this from client code or from the top level of a
 * `.functions.ts` file: load it inside handlers.
 */
import { withLinkHeadsUp } from "@/lib/sms-identity";
import {
  BLOCKED_REASON_TEXT,
  kindForCategory,
  normalizePhone,
  redactSecrets,
  smartEncode,
  smsSegments,
  TWILIO_UNSUBSCRIBED,
  type SmsCategory,
} from "@/lib/sms-policy";

export { normalizePhone } from "@/lib/sms-policy";

/** Twilio through the Lovable connector (the account's own Twilio, billed by Twilio). */
export const TWILIO_GATEWAY_URL = "https://connector-gateway.lovable.dev/twilio";

type Db = any;

export type SmsRequest = {
  category: SmsCategory;
  /** Phone as typed or stored; normalized here. */
  to: string | null | undefined;
  body: string;
  /**
   * The same key never sends twice (e.g. `session_reminder:<id>:<starts_at>`).
   * A failed send frees it for up to `maxAttempts` tries.
   */
  key?: string | null;
  maxAttempts?: number;
  /** sms_log.kind; defaults from the category. */
  kind?: string;
  /** What the log keeps. Security texts default to the text with links redacted. */
  logBody?: string;
  /** Add "The link can take up to a minute to load." to texts linking into the app (default: everyone but staff). */
  linkHeadsUp?: boolean;
  clientId?: string | null;
  memberId?: string | null;
  messageId?: string | null;
  ptSessionId?: string | null;
  automationId?: string | null;
  automationTrigger?: string | null;
  senderUserId?: string | null;
  reminderStep?: number | null;
};

export type SmsResult =
  | { status: "sent"; sid: string; id: string; segments: number }
  | { status: "failed"; error: string; code?: number | null; id?: string; segments: number }
  | { status: "skipped"; reason: string; id?: string; segments: number };

export function twilioConfigured(): boolean {
  return !!process.env.LOVABLE_API_KEY && !!process.env.TWILIO_API_KEY;
}

/** One call to Twilio's REST API (account-scoped path, e.g. "/Messages.json"). */
export async function twilioFetch(
  path: string,
  init: { method?: "GET" | "POST"; form?: Record<string, string> } = {},
): Promise<{ ok: boolean; status: number; data: any }> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const twilioKey = process.env.TWILIO_API_KEY;
  if (!lovableKey || !twilioKey) return { ok: false, status: 0, data: { message: "Twilio not configured" } };
  const res = await fetch(`${TWILIO_GATEWAY_URL}${path}`, {
    method: init.method ?? (init.form ? "POST" : "GET"),
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": twilioKey,
      ...(init.form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: init.form ? new URLSearchParams(init.form).toString() : undefined,
  });
  const data: any = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

/** The text exactly as it goes to Twilio. */
export function prepareSmsText(body: string, linkHeadsUp = true): string {
  const t = smartEncode(String(body ?? "")).trim();
  return linkHeadsUp ? withLinkHeadsUp(t) : t;
}

export async function sendSms(admin: Db, req: SmsRequest): Promise<SmsResult> {
  const to = normalizePhone(req.to ?? null);
  // Staff alerts go to the coach, who knows the app is slow to open cold.
  const text = prepareSmsText(req.body, req.linkHeadsUp ?? req.category !== "staff_alert");
  const segments = Math.max(1, smsSegments(text));
  const logBody = req.logBody ?? (req.category === "security" ? redactSecrets(text) : text);

  const { data, error } = await admin.rpc("sms_claim", {
    _category: req.category,
    _kind: req.kind ?? kindForCategory(req.category),
    _to: to,
    _body: logBody,
    _segments: segments,
    _key: req.key ?? null,
    _client_id: req.clientId ?? null,
    _member_id: req.memberId ?? null,
    _message_id: req.messageId ?? null,
    _pt_session_id: req.ptSessionId ?? null,
    _automation_id: req.automationId ?? null,
    _automation_trigger: req.automationTrigger ?? null,
    _sender_user_id: req.senderUserId ?? null,
    _reminder_step: req.reminderStep ?? null,
    _max_attempts: req.maxAttempts ?? 3,
  });
  // Fail closed: if the guard can't answer, nothing is sent.
  if (error || !data) {
    console.error("[sms] claim failed", error?.message ?? "no answer");
    return { status: "failed", error: `claim_failed: ${error?.message ?? "no answer"}`, segments };
  }
  const claim = data as { decision: string; reason?: string; id?: string; from?: string; crossed?: number | null };
  if (claim.decision !== "send" || !claim.id || !claim.from || !to) {
    return { status: "skipped", reason: claim.reason ?? "blocked", id: claim.id ?? undefined, segments };
  }

  let sid: string | null = null;
  let errMsg: string | null = null;
  let code: number | null = null;
  try {
    const res = await twilioFetch("/Messages.json", {
      form: { To: to, From: claim.from, Body: text, SmartEncoded: "true" },
    });
    if (res.ok && res.data?.sid) sid = String(res.data.sid);
    else {
      code = Number(res.data?.code) || null;
      errMsg = String(res.data?.message || `Twilio error (${res.status})`);
    }
  } catch (e: any) {
    errMsg = String(e?.message ?? e);
  }

  const { error: finishErr } = await admin.rpc("sms_finish", {
    _id: claim.id,
    _sid: sid,
    _error: errMsg,
    _error_code: code,
  });
  if (finishErr) console.error("[sms] finish failed", finishErr.message);

  if (claim.crossed && claim.crossed >= 80) {
    await notifyBudgetThreshold(admin, claim.crossed).catch((e) => console.warn("[sms] budget alert failed", e?.message ?? e));
  }

  if (sid) return { status: "sent", sid, id: claim.id, segments };
  if (code === TWILIO_UNSUBSCRIBED) await markOptedOut(admin, req).catch(() => {});
  return { status: "failed", error: errMsg ?? "Twilio error", code, id: claim.id, segments };
}

/** They replied STOP: Twilio refuses every text to them, so stop trying. */
export async function markOptedOut(admin: Db, who: { clientId?: string | null; memberId?: string | null }) {
  if (who.clientId) await admin.from("clients").update({ sms_opt_out: true }).eq("id", who.clientId);
  if (who.memberId) await admin.from("app_members").update({ sms_opt_out: true }).eq("id", who.memberId);
}

/** A readable reason for a text that didn't go out. */
export function smsResultMessage(r: SmsResult): string {
  if (r.status === "sent") return "Sent";
  if (r.status === "skipped") return BLOCKED_REASON_TEXT[r.reason] ?? r.reason;
  return r.error;
}

export type SentSms = Extract<SmsResult, { status: "sent" }>;

/** For coach-initiated sends: the sent result, or throw with a readable reason. */
export function requireSent(r: SmsResult): SentSms {
  if (r.status !== "sent") throw new Error(smsResultMessage(r));
  return r;
}

/** 80% and 100% of the month's budget: tell every admin once (push, free). */
async function notifyBudgetThreshold(admin: Db, pct: number) {
  const { data: admins } = await admin.from("user_roles").select("user_id").eq("role", "admin");
  if (!admins?.length) return;
  const { sendWebPushToUser } = await import("@/lib/push/push.server");
  const month = new Date().toISOString().slice(0, 7);
  const stopped = pct >= 100;
  const payload = {
    title: stopped ? "SMS budget reached" : "SMS budget at 80%",
    body: stopped
      ? "Automatic texts are paused until next month. Session reminders and account texts still go out."
      : "Texts this month are at 80% of your budget. Tap to see what's sending.",
    url: "/admin/settings/sms",
    tag: "sms-budget",
  };
  for (const a of admins as Array<{ user_id: string }>) {
    await sendWebPushToUser(admin, a.user_id, payload, {
      category: "billing",
      eventKey: `sms_budget:${month}:${pct}`,
      priority: "urgent",
    });
  }
}
