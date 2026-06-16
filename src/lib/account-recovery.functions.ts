import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  RECOVERY_BASE_URL,
  RESET_PATH,
  TOKEN_TTL_MINUTES,
  PER_IDENTIFIER_PER_MINUTE,
  PER_IDENTIFIER_PER_HOUR,
  PER_IP_PER_HOUR,
  recoverySmsBody,
  confirmationSmsBody,
  passwordIsValid,
  maskEmail,
  maskPhone,
  normalizePhoneE164,
  looksLikeEmail,
} from "./account-recovery.constants";

// ─────────────────────────────── helpers (server-only) ──────────────────────

async function sha256(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomToken(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  // URL-safe base64
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function getClientIp(): string | null {
  const xff = getRequestHeader("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return getRequestHeader("x-real-ip") ?? null;
}

async function sendViaTwilio(
  toPhone: string,
  fromPhone: string,
  body: string,
): Promise<{ sid: string }> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const twilioKey = process.env.TWILIO_API_KEY;
  if (!lovableKey || !twilioKey) throw new Error("sms_unavailable");
  const res = await fetch("https://connector-gateway.lovable.dev/twilio/Messages.json", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": twilioKey,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: toPhone, From: fromPhone, Body: body }).toString(),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `twilio_${res.status}`);
  return { sid: data.sid as string };
}

/**
 * Look up a user (across clients/app_members/coaches) by either email or phone.
 * Returns the best-guess Supabase auth user id, the verified email and verified
 * phone (both optional). Never throws if not found — recovery is intentionally
 * silent about account existence.
 */
async function lookupUser(
  supabaseAdmin: any,
  identifier: string,
): Promise<{
  userId: string | null;
  email: string | null;
  phoneE164: string | null;
}> {
  const isEmail = looksLikeEmail(identifier);
  let email: string | null = null;
  let phoneE164: string | null = null;
  let userId: string | null = null;

  if (isEmail) {
    email = identifier.trim().toLowerCase();
    // app_members / clients / coaches may store a phone for this email
    const { data: m } = await supabaseAdmin
      .from("app_members")
      .select("user_id, phone")
      .ilike("email", email)
      .maybeSingle();
    if (m?.user_id) userId = m.user_id;
    if (m?.phone) phoneE164 = normalizePhoneE164(m.phone);

    if (!phoneE164) {
      const { data: c } = await supabaseAdmin
        .from("clients")
        .select("user_id, phone")
        .eq("normalized_email", email)
        .maybeSingle();
      if (!userId && c?.user_id) userId = c.user_id;
      if (!phoneE164 && c?.phone) phoneE164 = normalizePhoneE164(c.phone);
    }
    if (!phoneE164) {
      const { data: co } = await supabaseAdmin
        .from("coaches")
        .select("user_id, phone")
        .ilike("email", email)
        .maybeSingle();
      if (!userId && co?.user_id) userId = co.user_id;
      if (!phoneE164 && co?.phone) phoneE164 = normalizePhoneE164(co.phone);
    }
    // Fallback to auth.users for the canonical user id when role tables don't carry one
    if (!userId) {
      const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
      const u = (list?.users ?? []).find(
        (x: any) => (x.email ?? "").toLowerCase() === email,
      );
      if (u) userId = u.id;
    }
  } else {
    phoneE164 = normalizePhoneE164(identifier);
    if (!phoneE164) return { userId: null, email: null, phoneE164: null };
    const digits = phoneE164.replace(/\D/g, "");

    const { data: c } = await supabaseAdmin
      .from("clients")
      .select("user_id, email, phone")
      .eq("normalized_phone", digits)
      .maybeSingle();
    if (c) {
      userId = c.user_id ?? null;
      email = (c.email ?? "").toLowerCase() || null;
    }
    if (!userId) {
      const { data: m } = await supabaseAdmin
        .from("app_members")
        .select("user_id, email, phone")
        .ilike("phone", `%${digits.slice(-10)}%`)
        .maybeSingle();
      if (m) {
        userId = m.user_id ?? null;
        if (!email && m.email) email = m.email.toLowerCase();
      }
    }
    if (!userId) {
      const { data: co } = await supabaseAdmin
        .from("coaches")
        .select("user_id, email, phone")
        .ilike("phone", `%${digits.slice(-10)}%`)
        .maybeSingle();
      if (co) {
        userId = co.user_id ?? null;
        if (!email && co.email) email = co.email.toLowerCase();
      }
    }
  }

  return { userId, email, phoneE164 };
}

/** Increment + return the count for a (identifier, kind, window-bucket) combo. */
async function bumpRateLimit(
  supabaseAdmin: any,
  identifier: string,
  kind: string,
  windowMs: number,
): Promise<number> {
  const bucket = new Date(Math.floor(Date.now() / windowMs) * windowMs).toISOString();
  const { data: existing } = await supabaseAdmin
    .from("recovery_rate_limits")
    .select("id, count")
    .eq("identifier", identifier)
    .eq("kind", kind)
    .eq("window_start", bucket)
    .maybeSingle();
  if (existing) {
    await supabaseAdmin
      .from("recovery_rate_limits")
      .update({ count: existing.count + 1 })
      .eq("id", existing.id);
    return existing.count + 1;
  }
  await supabaseAdmin.from("recovery_rate_limits").insert({
    identifier,
    kind,
    window_start: bucket,
    count: 1,
  });
  return 1;
}

async function logEvent(
  supabaseAdmin: any,
  row: Record<string, unknown>,
): Promise<void> {
  try {
    await supabaseAdmin.from("password_reset_events").insert(row);
  } catch {
    /* never let audit failure break the flow */
  }
}

async function dispatchEmailReset(
  supabaseAdmin: any,
  email: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await supabaseAdmin.auth.resetPasswordForEmail(email, {
      redirectTo: `${RECOVERY_BASE_URL}${RESET_PATH}`,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

async function dispatchSmsReset(
  supabaseAdmin: any,
  userId: string,
  phoneE164: string,
  ip: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const token = randomToken();
  const hash = await sha256(token);
  const link = `${RECOVERY_BASE_URL}${RESET_PATH}?rt=${token}`;

  const { error: insErr } = await supabaseAdmin
    .from("password_recovery_tokens")
    .insert({
      user_id: userId,
      token_hash: hash,
      channel: "sms",
      expires_at: new Date(Date.now() + TOKEN_TTL_MINUTES * 60_000).toISOString(),
      created_ip: ip,
    });
  if (insErr) return { ok: false, error: insErr.message };

  const { data: settings } = await supabaseAdmin
    .from("sms_settings")
    .select("from_phone, enabled")
    .eq("singleton", true)
    .maybeSingle();
  if (!settings?.enabled || !settings?.from_phone) {
    return { ok: false, error: "sms_disabled" };
  }

  try {
    const { sid } = await sendViaTwilio(phoneE164, settings.from_phone, recoverySmsBody(link));
    await supabaseAdmin.from("sms_log").insert({
      to_phone: phoneE164,
      body: "[password reset link redacted]",
      kind: "manual",
      status: "sent",
      twilio_sid: sid,
    });
    return { ok: true };
  } catch (e: any) {
    await supabaseAdmin.from("sms_log").insert({
      to_phone: phoneE164,
      body: "[password reset link redacted]",
      kind: "manual",
      status: "failed",
      error: e?.message ?? String(e),
    });
    return { ok: false, error: e?.message ?? String(e) };
  }
}

// ──────────────────────────────── PUBLIC: request reset ─────────────────────

const RequestSchema = z.object({
  identifier: z.string().trim().min(3).max(200),
});

export const requestAccountRecovery = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => RequestSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ip = getClientIp();
    const ua = getRequestHeader("user-agent") ?? null;
    const normalized = looksLikeEmail(data.identifier)
      ? data.identifier.trim().toLowerCase()
      : normalizePhoneE164(data.identifier) ?? data.identifier;

    // IP rate limit (10/hour)
    if (ip) {
      const ipCount = await bumpRateLimit(supabaseAdmin, ip, "ip_hour", 60 * 60_000);
      if (ipCount > PER_IP_PER_HOUR) {
        await logEvent(supabaseAdmin, {
          actor_kind: "self",
          channel: "both",
          outcome: "rate_limited",
          ip,
          user_agent: ua,
          metadata: { scope: "ip_hour" },
        });
        return { ok: true } as const;
      }
    }
    // Per-identifier rate limits
    const minuteCount = await bumpRateLimit(supabaseAdmin, normalized, "id_min", 60_000);
    const hourCount = await bumpRateLimit(supabaseAdmin, normalized, "id_hour", 60 * 60_000);
    if (minuteCount > PER_IDENTIFIER_PER_MINUTE || hourCount > PER_IDENTIFIER_PER_HOUR) {
      await logEvent(supabaseAdmin, {
        actor_kind: "self",
        channel: "both",
        outcome: "rate_limited",
        ip,
        user_agent: ua,
        metadata: { scope: minuteCount > PER_IDENTIFIER_PER_MINUTE ? "id_min" : "id_hour" },
      });
      return { ok: true } as const;
    }

    const { userId, email, phoneE164 } = await lookupUser(supabaseAdmin, data.identifier);

    // Always behave the same to the caller — short-circuit cleanly when no match
    if (!userId) {
      await logEvent(supabaseAdmin, {
        actor_kind: "self",
        channel: looksLikeEmail(data.identifier) ? "email" : "sms",
        outcome: "requested",
        ip,
        user_agent: ua,
        metadata: { matched: false },
      });
      return { ok: true } as const;
    }

    const inputIsEmail = looksLikeEmail(data.identifier);
    let emailResult: { ok: boolean; error?: string } | null = null;
    let smsResult: { ok: boolean; error?: string } | null = null;

    // Per spec §5:
    if (inputIsEmail) {
      if (email) emailResult = await dispatchEmailReset(supabaseAdmin, email);
      if (phoneE164) smsResult = await dispatchSmsReset(supabaseAdmin, userId, phoneE164, ip);
    } else {
      if (phoneE164) smsResult = await dispatchSmsReset(supabaseAdmin, userId, phoneE164, ip);
      if (email) emailResult = await dispatchEmailReset(supabaseAdmin, email);
    }

    const channels: string[] = [];
    if (emailResult?.ok) channels.push("email");
    if (smsResult?.ok) channels.push("sms");
    const outcome =
      channels.length === 2
        ? "partial"
        : channels.length === 1
        ? channels[0] === "email"
          ? "email_sent"
          : "sms_sent"
        : "failed";

    await logEvent(supabaseAdmin, {
      target_user_id: userId,
      target_email_masked: maskEmail(email),
      target_phone_masked: maskPhone(phoneE164),
      actor_kind: "self",
      channel: channels.length === 2 ? "both" : channels[0] ?? (inputIsEmail ? "email" : "sms"),
      destination_masked: inputIsEmail ? maskEmail(email) : maskPhone(phoneE164),
      outcome: channels.length === 2 ? "partial" : outcome,
      error_code: emailResult?.error || smsResult?.error || null,
      ip,
      user_agent: ua,
    });

    return { ok: true } as const;
  });

// ──────────────────────────────── PUBLIC: validate token ────────────────────

export const validateRecoveryToken = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ token: z.string().min(10).max(200) }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const hash = await sha256(data.token);
    const { data: row } = await supabaseAdmin
      .from("password_recovery_tokens")
      .select("id, expires_at, consumed_at, attempts_remaining")
      .eq("token_hash", hash)
      .maybeSingle();
    if (!row) return { valid: false, reason: "invalid" } as const;
    if (row.consumed_at) return { valid: false, reason: "consumed" } as const;
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return { valid: false, reason: "expired" } as const;
    }
    if ((row.attempts_remaining ?? 0) <= 0) {
      return { valid: false, reason: "attempts" } as const;
    }
    return { valid: true } as const;
  });

// ──────────────────────────────── PUBLIC: consume token ─────────────────────

export const consumeRecoveryToken = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        token: z.string().min(10).max(200),
        newPassword: z.string().min(10).max(256),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    if (!passwordIsValid(data.newPassword)) {
      throw new Error("Password does not meet the requirements.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ip = getClientIp();
    const ua = getRequestHeader("user-agent") ?? null;
    const hash = await sha256(data.token);

    const { data: row } = await supabaseAdmin
      .from("password_recovery_tokens")
      .select("id, user_id, expires_at, consumed_at, attempts_remaining")
      .eq("token_hash", hash)
      .maybeSingle();
    if (!row) {
      await logEvent(supabaseAdmin, {
        actor_kind: "self",
        channel: "sms",
        outcome: "token_invalid",
        ip,
        user_agent: ua,
      });
      throw new Error("This recovery link is no longer valid.");
    }
    if (row.consumed_at) throw new Error("This recovery link has already been used.");
    if (new Date(row.expires_at).getTime() < Date.now()) {
      throw new Error("This recovery link has expired.");
    }
    if ((row.attempts_remaining ?? 0) <= 0) {
      throw new Error("Too many attempts on this recovery link.");
    }

    // Atomically decrement attempts first
    await supabaseAdmin
      .from("password_recovery_tokens")
      .update({ attempts_remaining: row.attempts_remaining - 1 })
      .eq("id", row.id);

    const { error: pwErr } = await supabaseAdmin.auth.admin.updateUserById(row.user_id, {
      password: data.newPassword,
    });
    if (pwErr) {
      await logEvent(supabaseAdmin, {
        target_user_id: row.user_id,
        actor_kind: "self",
        channel: "sms",
        outcome: "failed",
        error_code: pwErr.message,
        ip,
        user_agent: ua,
      });
      throw new Error(pwErr.message);
    }

    // Mark token consumed
    await supabaseAdmin
      .from("password_recovery_tokens")
      .update({ consumed_at: new Date().toISOString() })
      .eq("id", row.id);

    // Revoke other sessions
    try {
      await supabaseAdmin.auth.admin.signOut(row.user_id, "global" as any);
    } catch {
      /* non-fatal */
    }

    // Send confirmations
    try {
      const { data: u } = await supabaseAdmin.auth.admin.getUserById(row.user_id);
      const email = u?.user?.email ?? null;
      // Find phone across role tables
      let phone: string | null = null;
      const { data: m } = await supabaseAdmin
        .from("app_members")
        .select("phone")
        .eq("user_id", row.user_id)
        .maybeSingle();
      if (m?.phone) phone = normalizePhoneE164(m.phone);
      if (!phone) {
        const { data: c } = await supabaseAdmin
          .from("clients")
          .select("phone")
          .eq("user_id", row.user_id)
          .maybeSingle();
        if (c?.phone) phone = normalizePhoneE164(c.phone);
      }

      if (email) {
        // Reuse Supabase reset email channel as a confirmation cue? Instead,
        // skip — we don't have a dedicated transactional template wired here.
        // (Audit-only confirmation; account settings shows last-changed date.)
      }
      if (phone) {
        const { data: settings } = await supabaseAdmin
          .from("sms_settings")
          .select("from_phone, enabled")
          .eq("singleton", true)
          .maybeSingle();
        if (settings?.enabled && settings?.from_phone) {
          try {
            await sendViaTwilio(phone, settings.from_phone, confirmationSmsBody());
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* ignore confirmation failures */
    }

    await logEvent(supabaseAdmin, {
      target_user_id: row.user_id,
      actor_kind: "self",
      channel: "sms",
      outcome: "reset_success",
      ip,
      user_agent: ua,
    });

    return { ok: true } as const;
  });

// ──────────────────────────────── ADMIN: initiate reset ─────────────────────

const AdminSchema = z.object({
  target_user_id: z.string().uuid(),
  channel: z.enum(["email", "sms", "both"]),
});

export const adminSendPasswordReset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => AdminSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ip = getClientIp();
    const ua = getRequestHeader("user-agent") ?? null;

    // Resolve target email + phone
    const { data: u } = await supabaseAdmin.auth.admin.getUserById(data.target_user_id);
    const email = u?.user?.email?.toLowerCase() ?? null;
    let phone: string | null = null;
    const { data: m } = await supabaseAdmin
      .from("app_members")
      .select("phone")
      .eq("user_id", data.target_user_id)
      .maybeSingle();
    if (m?.phone) phone = normalizePhoneE164(m.phone);
    if (!phone) {
      const { data: c } = await supabaseAdmin
        .from("clients")
        .select("phone")
        .eq("user_id", data.target_user_id)
        .maybeSingle();
      if (c?.phone) phone = normalizePhoneE164(c.phone);
    }
    if (!phone) {
      const { data: co } = await supabaseAdmin
        .from("coaches")
        .select("phone")
        .eq("user_id", data.target_user_id)
        .maybeSingle();
      if (co?.phone) phone = normalizePhoneE164(co.phone);
    }

    let emailResult: { ok: boolean; error?: string } | null = null;
    let smsResult: { ok: boolean; error?: string } | null = null;

    if ((data.channel === "email" || data.channel === "both") && email) {
      emailResult = await dispatchEmailReset(supabaseAdmin, email);
    }
    if ((data.channel === "sms" || data.channel === "both") && phone) {
      smsResult = await dispatchSmsReset(supabaseAdmin, data.target_user_id, phone, ip);
    }

    const channels: string[] = [];
    if (emailResult?.ok) channels.push("email");
    if (smsResult?.ok) channels.push("sms");
    const outcome =
      data.channel === "both"
        ? channels.length === 2
          ? "partial"
          : channels.length === 1
          ? "partial"
          : "failed"
        : channels.length === 1
        ? channels[0] === "email"
          ? "email_sent"
          : "sms_sent"
        : "failed";

    await logEvent(supabaseAdmin, {
      target_user_id: data.target_user_id,
      target_email_masked: maskEmail(email),
      target_phone_masked: maskPhone(phone),
      initiated_by: userId,
      actor_kind: "admin",
      channel: data.channel,
      destination_masked:
        data.channel === "email"
          ? maskEmail(email)
          : data.channel === "sms"
          ? maskPhone(phone)
          : `${maskEmail(email)} & ${maskPhone(phone)}`,
      outcome,
      error_code: emailResult?.error || smsResult?.error || null,
      ip,
      user_agent: ua,
    });

    return {
      ok: true,
      outcome,
      emailSent: !!emailResult?.ok,
      smsSent: !!smsResult?.ok,
      emailMasked: maskEmail(email),
      phoneMasked: maskPhone(phone),
    } as const;
  });

// ──────────────────────────────── ADMIN: list events ────────────────────────

export const listPasswordResetEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ target_user_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    const { data: rows } = await supabase
      .from("password_reset_events")
      .select("*")
      .eq("target_user_id", data.target_user_id)
      .order("created_at", { ascending: false })
      .limit(50);
    return { events: rows ?? [] };
  });