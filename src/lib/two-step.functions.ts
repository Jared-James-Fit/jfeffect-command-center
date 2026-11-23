/**
 * Two-step sign-in by text message, passkey and trusted device (two-step.ts,
 * 20270512090000_two_step_sms_passkeys.sql), beside the authenticator app.
 *
 * Confirming a session (callable before it's confirmed: MFA_EXEMPT_FNS):
 *   getTwoStepStatus          what the gate needs: the ways, whether this
 *                             session is confirmed, the preferred way
 *   sendTwoStepCode           text a 6-digit code (sign-in, or a new phone), or
 *                             email one to the login's own email (sign-in only,
 *                             the backup: 20270515090000_two_step_email_backup.sql)
 *   verifyTwoStepCode         check it: confirms the session, or adds the phone
 *   startTwoStepPasskey       a one-time challenge for Face ID / Touch ID
 *   finishTwoStepPasskey      check the passkey: confirms, or adds it
 *   confirmWithTrustedDevice  a device ticked "Don't ask again" (30 days)
 * Each acts only for the signed-in login, only for a team login, and adds a
 * way to an unconfirmed session only when the login has none yet (its first
 * setup). Every limit is the database's.
 *
 * Managing (a confirmed session; the guard refuses anything else):
 *   confirmTwoStepTotp, trustThisDevice, listTwoStepDevices,
 *   forgetTwoStepDevice, removeTwoStepMethod, setTwoStepPreferred,
 *   setTwoStepEmailBackup
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  CODE_TTL_S,
  KIND_TITLE,
  MAX_PASSKEYS,
  MAX_PHONES,
  RESEND_AFTER_S,
  checkRefusalText,
  maskEmail,
  maskPhone,
  normalizeSmsCode,
  sendRefusalText,
  smsCodeHash,
  smsCodeText,
  smsLabel,
  twoStepPhone,
  type EmailBackup,
  type TwoStepKind,
  type TwoStepStatus,
} from "@/lib/two-step";
import {
  CHALLENGE_TTL_MS,
  creationOptions,
  fromB64url,
  newChallenge,
  requestOptions,
  rpIdForOrigin,
  verifyAssertion,
  verifyRegistration,
  type AssertionJSON,
  type CreationOptionsJSON,
  type RegistrationJSON,
  type RequestOptionsJSON,
} from "@/lib/webauthn";

async function h() {
  return import("@/lib/two-step.server");
}

const trustInput = z
  .object({ label: z.string().max(80) })
  .nullable()
  .optional();

export const getTwoStepStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TwoStepStatus> => {
    const s = await h();
    return s.statusFor(await s.admin(), context.userId, context.claims as any);
  });

export type SendCodeResult =
  | { ok: true; to: string; resendInS: number; expiresInS: number }
  | { ok: false; reason: string; waitS: number | null; message: string };

export const sendTwoStepCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        purpose: z.enum(["sign_in", "add_phone"]),
        methodId: z.string().uuid().nullable().optional(),
        phone: z.string().max(40).nullable().optional(),
        channel: z.enum(["sms", "email"]).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<SendCodeResult> => {
    const s = await h();
    const db = await s.admin();
    const uid = context.userId;
    const sid = s.sessionIdOf(context.claims as any);
    await s.requireTeam(db, uid);
    if (data.channel === "email") return emailCode(db, uid, sid, data.purpose);
    const own = await s.activeMethods(db, uid);

    let phone: string | null = null;
    let methodId: string | null = null;
    if (data.purpose === "sign_in") {
      const sms = own.filter((m) => m.kind === "sms");
      const m = (data.methodId && sms.find((x) => x.id === data.methodId)) || sms[0];
      if (!m?.phone) throw new Error("There's no phone number on your two-step sign-in.");
      phone = m.phone;
      methodId = m.id;
    } else {
      phone = twoStepPhone(data.phone);
      if (!phone)
        return {
          ok: false,
          reason: "phone",
          waitS: null,
          message: "Type a Canadian or US mobile number, like 204 555 0123.",
        };
      const hasAny = own.length > 0 || (await s.totpFactors(db, uid)).length > 0;
      if (hasAny && !(await s.sessionConfirmed(db, uid, context.claims as any))) {
        throw new Error("Confirm it's you first, then add a phone.");
      }
      if (own.some((m) => m.kind === "sms" && m.phone === phone)) {
        return {
          ok: false,
          reason: "exists",
          waitS: null,
          message: "That number is already on your two-step sign-in.",
        };
      }
      if (own.filter((m) => m.kind === "sms").length >= MAX_PHONES) {
        return {
          ok: false,
          reason: "max",
          waitS: null,
          message: `You can have up to ${MAX_PHONES} phone numbers. Remove one first.`,
        };
      }
    }

    const { newSmsCode } = await import("@/lib/two-step");
    const code = newSmsCode();
    const { data: issued, error } = await db.rpc("two_step_code_issue", {
      _uid: uid,
      _session: sid,
      _purpose: data.purpose,
      _phone: phone,
      _method: methodId,
      _hash: await smsCodeHash(uid, sid, code),
      _ttl_s: CODE_TTL_S,
    });
    if (error) throw new Error(`Couldn't make a code: ${error.message}`);
    if (!issued?.ok) {
      const waitS = typeof issued?.wait_s === "number" ? issued.wait_s : null;
      return {
        ok: false,
        reason: String(issued?.reason ?? "failed"),
        waitS,
        message: sendRefusalText(issued?.reason ?? "failed", waitS),
      };
    }

    const { sendSms } = await import("@/lib/sms-gateway.server");
    const sent = await sendSms(db, {
      category: "security",
      kind: "security",
      to: phone,
      body: smsCodeText(code, data.purpose),
      logBody: `JF Effect two-step code (${data.purpose === "add_phone" ? "adding a phone" : "sign-in"}); code hidden`,
      key: `two_step:${issued.id}`,
      maxAttempts: 1,
      linkHeadsUp: false,
      senderUserId: uid,
    });
    if (sent.status !== "sent") {
      await db.rpc("two_step_code_unsent", { _id: issued.id });
      const reason = sent.status === "skipped" ? sent.reason : "failed";
      console.warn(
        "[two-step] code text didn't go",
        reason,
        sent.status === "failed" ? sent.error : "",
      );
      return { ok: false, reason, waitS: null, message: sendRefusalText(reason) };
    }
    return { ok: true, to: maskPhone(phone), resendInS: RESEND_AFTER_S, expiresInS: CODE_TTL_S };
  });

/**
 * Email a sign-in code to the login's own email (the backup). The database
 * decides whether one may go and where (two_step_code_issue with 'email'), so
 * the address never comes from the request.
 */
async function emailCode(
  db: any,
  uid: string,
  sid: string,
  purpose: "sign_in" | "add_phone",
): Promise<SendCodeResult> {
  if (purpose !== "sign_in") throw new Error("An emailed code is only for signing in.");
  const { newSmsCode } = await import("@/lib/two-step");
  const code = newSmsCode();
  const { data: issued, error } = await db.rpc("two_step_code_issue", {
    _uid: uid,
    _session: sid,
    _purpose: "sign_in",
    _phone: null,
    _method: null,
    _hash: await smsCodeHash(uid, sid, code),
    _ttl_s: CODE_TTL_S,
    _channel: "email",
  });
  if (error) throw new Error(`Couldn't make a code: ${error.message}`);
  if (!issued?.ok || !issued.email) {
    const waitS = typeof issued?.wait_s === "number" ? issued.wait_s : null;
    const reason = String(issued?.reason ?? "email_failed");
    return { ok: false, reason, waitS, message: sendRefusalText(reason, waitS) };
  }
  const { sendTemplateEmail } = await import("@/lib/transactional-email.server");
  const sent = await sendTemplateEmail(db, {
    template: "two-step-code",
    to: String(issued.email),
    data: { code },
    idempotencyKey: `two_step:${issued.id}`,
    sensitive: true,
  });
  if (!sent.sent) {
    await db.rpc("two_step_code_unsent", { _id: issued.id });
    const reason = sent.reason === "suppressed" ? "email_suppressed" : "email_failed";
    console.warn("[two-step] code email didn't go", sent.reason);
    return { ok: false, reason, waitS: null, message: sendRefusalText(reason) };
  }
  return {
    ok: true,
    to: maskEmail(String(issued.email)),
    resendInS: RESEND_AFTER_S,
    expiresInS: CODE_TTL_S,
  };
}

export type ConfirmResult =
  | { ok: true; added?: TwoStepKind; trust: { id: string; token: string; until: string } | null }
  | { ok: false; reason: string; left?: number | null; waitS?: number | null; message: string };

export const verifyTwoStepCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        purpose: z.enum(["sign_in", "add_phone"]),
        code: z.string().max(20),
        trust: trustInput,
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<ConfirmResult> => {
    const s = await h();
    const db = await s.admin();
    const uid = context.userId;
    const sid = s.sessionIdOf(context.claims as any);
    await s.requireTeam(db, uid);
    const code = normalizeSmsCode(data.code);
    if (!code) return { ok: false, reason: "format", message: checkRefusalText("format") };

    const { data: r, error } = await db.rpc("two_step_code_check", {
      _uid: uid,
      _session: sid,
      _purpose: data.purpose,
      _hash: await smsCodeHash(uid, sid, code),
    });
    if (error) throw new Error(`Couldn't check the code: ${error.message}`);
    if (!r?.ok) {
      const left = typeof r?.left === "number" ? r.left : null;
      const waitS = typeof r?.wait_s === "number" ? r.wait_s : null;
      return {
        ok: false,
        reason: String(r?.reason ?? "none"),
        left,
        waitS,
        message: checkRefusalText(r?.reason ?? "none", left, waitS),
      };
    }

    if (data.purpose === "sign_in") {
      const byEmail = r.channel === "email";
      await s.markSession(db, uid, sid, byEmail ? "email" : "sms");
      if (byEmail) {
        // An emailed code is the backup: say so, in case it wasn't them.
        await s.tellTwoStep(
          db,
          uid,
          {
            title: "You signed in with an emailed code",
            body: "If this wasn't you, someone has your password and your email. Change both now.",
          },
          null,
          uid,
        );
      }
      if (r.method_id)
        await db
          .from("two_step_methods")
          .update({ last_used_at: new Date().toISOString() })
          .eq("id", r.method_id)
          .eq("user_id", uid);
      const trust = data.trust ? await s.mintTrust(db, uid, data.trust.label) : null;
      return { ok: true, trust };
    }

    // Adding a phone: the code proved the phone; the session was checked when the code was sent.
    const own = await s.activeMethods(db, uid);
    const first = own.length === 0 && (await s.totpFactors(db, uid)).length === 0;
    if (!first && !(await s.sessionConfirmed(db, uid, context.claims as any))) {
      throw new Error("Confirm it's you first, then add a phone.");
    }
    if (!own.some((m) => m.kind === "sms" && m.phone === r.phone)) {
      const { error: insErr } = await db.from("two_step_methods").insert({
        user_id: uid,
        kind: "sms",
        label: smsLabel(r.phone),
        phone: r.phone,
        last_used_at: new Date().toISOString(),
      });
      if (insErr && !/duplicate|unique/i.test(insErr.message))
        throw new Error(`Couldn't add the phone: ${insErr.message}`);
      await s.recordEvent(db, uid, "method_added");
    }
    await s.preferIfNone(db, uid, "sms");
    await s.markSession(db, uid, sid, "sms");
    if (!first) {
      await s.tellTwoStep(
        db,
        uid,
        {
          title: "A phone was added to your two-step sign-in",
          body: `Codes can now be texted to ${maskPhone(r.phone)}. If this wasn't you, change your password now.`,
        },
        null,
        uid,
      );
    }
    const trust = data.trust ? await s.mintTrust(db, uid, data.trust.label) : null;
    return { ok: true, added: "sms", trust };
  });

export const startTwoStepPasskey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ purpose: z.enum(["register", "verify"]) }).parse(i))
  .handler(
    async ({
      data,
      context,
    }): Promise<
      | { purpose: "register"; options: CreationOptionsJSON }
      | { purpose: "verify"; options: RequestOptionsJSON }
    > => {
      const s = await h();
      const db = await s.admin();
      const uid = context.userId;
      const sid = s.sessionIdOf(context.claims as any);
      await s.requireTeam(db, uid);
      const rpId = rpIdForOrigin(await s.requestOrigin());
      if (!rpId)
        throw new Error("Face ID and Touch ID work on jfeffect.com. Use another way here.");
      const own = await s.activeMethods(db, uid);
      const passkeys = own.filter(
        (m) => m.kind === "passkey" && m.rp_id === rpId && m.credential_id,
      );

      if (data.purpose === "register") {
        const hasAny = own.length > 0 || (await s.totpFactors(db, uid)).length > 0;
        if (hasAny && !(await s.sessionConfirmed(db, uid, context.claims as any))) {
          throw new Error("Confirm it's you first, then add Face ID.");
        }
        if (own.filter((m) => m.kind === "passkey").length >= MAX_PASSKEYS) {
          throw new Error(`You can have up to ${MAX_PASSKEYS} passkeys. Remove one first.`);
        }
      } else if (!passkeys.length) {
        throw new Error("There's no passkey on your login for this site. Use another way.");
      }

      const challenge = newChallenge();
      await db
        .from("two_step_challenges")
        .delete()
        .eq("user_id", uid)
        .lt("created_at", new Date(Date.now() - 86_400_000).toISOString());
      const { error } = await db.from("two_step_challenges").insert({
        user_id: uid,
        session_id: sid,
        purpose: data.purpose,
        challenge,
        rp_id: rpId,
        expires_at: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
      });
      if (error) throw new Error(`Couldn't start: ${error.message}`);

      if (data.purpose === "verify") {
        return {
          purpose: "verify",
          options: requestOptions({
            challenge,
            rpId,
            allow: passkeys.map((m) => ({ id: m.credential_id!, transports: m.transports })),
          }),
        };
      }
      const { data: prof } = await db
        .from("profiles")
        .select("full_name")
        .eq("id", uid)
        .maybeSingle();
      const email = String((context.claims as any)?.email ?? "") || "JF Effect login";
      return {
        purpose: "register",
        options: creationOptions({
          challenge,
          rpId,
          userId: uid,
          email,
          name: String(prof?.full_name ?? "").trim(),
          exclude: passkeys.map((m) => ({ id: m.credential_id!, transports: m.transports })),
        }),
      };
    },
  );

const credentialInput = z.object({
  id: z.string().max(1400),
  rawId: z.string().max(1400),
  type: z.literal("public-key"),
  response: z.object({
    clientDataJSON: z.string().max(4000),
    attestationObject: z.string().max(20000).optional(),
    authenticatorData: z.string().max(4000).optional(),
    signature: z.string().max(2000).optional(),
    userHandle: z.string().max(400).nullable().optional(),
    transports: z.array(z.string().max(20)).max(10).optional(),
  }),
});

function challengeOf(clientDataJSON: string): string {
  try {
    const c = JSON.parse(new TextDecoder().decode(fromB64url(clientDataJSON)));
    if (typeof c?.challenge === "string") return c.challenge;
  } catch {
    /* fall through */
  }
  throw new Error("That passkey answer can't be read. Try again.");
}

export const finishTwoStepPasskey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        purpose: z.enum(["register", "verify"]),
        credential: credentialInput,
        label: z.string().max(80).optional(),
        trust: trustInput,
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<ConfirmResult> => {
    const s = await h();
    const db = await s.admin();
    const uid = context.userId;
    const sid = s.sessionIdOf(context.claims as any);
    await s.requireTeam(db, uid);

    // The challenge is spent whatever happens next: one try per request.
    const challenge = challengeOf(data.credential.response.clientDataJSON);
    const { data: spent, error: chErr } = await db
      .from("two_step_challenges")
      .update({ used_at: new Date().toISOString() })
      .eq("challenge", challenge)
      .eq("user_id", uid)
      .eq("session_id", sid)
      .eq("purpose", data.purpose)
      .is("used_at", null)
      .gt("expires_at", new Date().toISOString())
      .select("rp_id");
    if (chErr) throw new Error(`Couldn't check the passkey: ${chErr.message}`);
    const rpId = spent?.[0]?.rp_id as string | undefined;
    if (!rpId) return { ok: false, reason: "expired", message: "That request ran out. Try again." };

    if (data.purpose === "register") {
      const own = await s.activeMethods(db, uid);
      const first = own.length === 0 && (await s.totpFactors(db, uid)).length === 0;
      if (!first && !(await s.sessionConfirmed(db, uid, context.claims as any))) {
        throw new Error("Confirm it's you first, then add Face ID.");
      }
      let saved: Awaited<ReturnType<typeof verifyRegistration>>;
      try {
        saved = await verifyRegistration({
          credential: data.credential as RegistrationJSON,
          challenge,
          rpId,
        });
      } catch (e: any) {
        return {
          ok: false,
          reason: "invalid",
          message: e?.message ?? "That passkey couldn't be set up.",
        };
      }
      const { error } = await db.from("two_step_methods").insert({
        user_id: uid,
        kind: "passkey",
        label: (data.label || "Passkey").slice(0, 80),
        credential_id: saved.credentialId,
        public_key: saved.jwk,
        alg: saved.alg,
        rp_id: rpId,
        sign_count: saved.signCount,
        transports: saved.transports,
        last_used_at: new Date().toISOString(),
      });
      if (error) {
        if (/duplicate|unique/i.test(error.message))
          return { ok: false, reason: "exists", message: "That passkey is already set up." };
        throw new Error(`Couldn't save the passkey: ${error.message}`);
      }
      await s.recordEvent(db, uid, "method_added");
      await s.preferIfNone(db, uid, "passkey");
      await s.markSession(db, uid, sid, "passkey");
      if (!first) {
        await s.tellTwoStep(
          db,
          uid,
          {
            title: "A passkey was added to your two-step sign-in",
            body: `${data.label || "A new device"} can now confirm it's you. If this wasn't you, change your password now.`,
          },
          null,
          uid,
        );
      }
      const trust = data.trust ? await s.mintTrust(db, uid, data.trust.label) : null;
      return { ok: true, added: "passkey", trust };
    }

    const { data: row } = await db
      .from("two_step_methods")
      .select("id, public_key, alg, rp_id, sign_count")
      .eq("user_id", uid)
      .eq("kind", "passkey")
      .eq("credential_id", data.credential.rawId)
      .is("removed_at", null)
      .maybeSingle();
    if (!row || row.rp_id !== rpId) {
      await s.recordEvent(db, uid, "passkey_wrong");
      return {
        ok: false,
        reason: "unknown",
        message: "That passkey isn't on your login. Try another way.",
      };
    }
    try {
      const used = await verifyAssertion({
        credential: data.credential as AssertionJSON,
        challenge,
        rpId,
        jwk: row.public_key,
        alg: row.alg,
        storedSignCount: Number(row.sign_count ?? 0),
      });
      await db
        .from("two_step_methods")
        .update({ sign_count: used.signCount, last_used_at: new Date().toISOString() })
        .eq("id", row.id);
    } catch (e: any) {
      await s.recordEvent(db, uid, "passkey_wrong");
      return {
        ok: false,
        reason: "invalid",
        message: e?.message ?? "That passkey didn't check out.",
      };
    }
    await s.markSession(db, uid, sid, "passkey");
    await s.recordEvent(db, uid, "passkey_ok");
    const trust = data.trust ? await s.mintTrust(db, uid, data.trust.label) : null;
    return { ok: true, trust };
  });

export const confirmWithTrustedDevice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ token: z.string().min(20).max(100) }).parse(i))
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    const s = await h();
    const db = await s.admin();
    const sid = s.sessionIdOf(context.claims as any);
    const { data: ok, error } = await db.rpc("two_step_trust_use", {
      _uid: context.userId,
      _session: sid,
      _hash: await s.trustTokenHash(data.token),
    });
    if (error) throw new Error(`Couldn't check this device: ${error.message}`);
    return { ok: ok === true };
  });

// ── Managing (a confirmed session) ──────────────────────────────────────────

/** After an authenticator code (aal2): keep the session confirmed if that app is removed later, and trust the device if asked. */
export const confirmTwoStepTotp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ trust: trustInput }).parse(i))
  .handler(async ({ data, context }) => {
    if ((context.claims as any)?.aal !== "aal2")
      throw new Error("Enter your authenticator code first.");
    const s = await h();
    const db = await s.admin();
    await s.markSession(db, context.userId, s.sessionIdOf(context.claims as any), "totp");
    const trust = data.trust ? await s.mintTrust(db, context.userId, data.trust.label) : null;
    return { ok: true as const, trust };
  });

async function requireConfirmed(context: { userId: string; claims?: any }) {
  const s = await h();
  const db = await s.admin();
  await s.requireTeam(db, context.userId);
  if (!(await s.sessionConfirmed(db, context.userId, context.claims)))
    throw new Error("Confirm it's you first.");
  return { s, db };
}

export const trustThisDevice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ label: z.string().max(80) }).parse(i))
  .handler(async ({ data, context }) => {
    const { s, db } = await requireConfirmed(context);
    return s.mintTrust(db, context.userId, data.label);
  });

export type TrustedDeviceRow = {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
};

export const listTwoStepDevices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TrustedDeviceRow[]> => {
    const { db } = await requireConfirmed(context);
    const { data, error } = await db
      .from("two_step_trusted_devices")
      .select("id, label, created_at, last_used_at, expires_at")
      .eq("user_id", context.userId)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });
    if (error) throw new Error(`Couldn't read your devices: ${error.message}`);
    return (data ?? []).map((d: any) => ({
      id: d.id,
      label: d.label,
      createdAt: d.created_at,
      lastUsedAt: d.last_used_at,
      expiresAt: d.expires_at,
    }));
  });

export const forgetTwoStepDevice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid().nullable() }).parse(i))
  .handler(async ({ data, context }) => {
    const { db } = await requireConfirmed(context);
    const { data: n, error } = await db.rpc("two_step_trust_forget", {
      _uid: context.userId,
      _id: data.id,
    });
    if (error) throw new Error(`Couldn't forget it: ${error.message}`);
    return { forgotten: Number(n ?? 0) };
  });

export const removeTwoStepMethod = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ kind: z.enum(["sms", "passkey", "totp"]), id: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { s, db } = await requireConfirmed(context);
    const uid = context.userId;
    const { required } = await s.requireTeam(db, uid);
    const methods = await s.methodsFor(db, uid);
    const target = methods.find((m) => m.kind === data.kind && m.id === data.id);
    if (!target) throw new Error("That's already gone.");
    if (required && methods.length <= 1) {
      throw new Error(
        "Your login needs a way to confirm. Add another one first, then remove this.",
      );
    }
    // Removing an authenticator app drops Supabase's aal2 from the sessions it
    // confirmed: mark this one first so it stays confirmed.
    if ((context.claims as any)?.aal === "aal2")
      await s.markSession(db, uid, s.sessionIdOf(context.claims as any), "totp");
    if (data.kind === "totp") {
      const { error } = await db.auth.admin.mfa.deleteFactor({ id: data.id, userId: uid });
      if (error) throw new Error(`Couldn't remove it: ${error.message}`);
    } else {
      const { error } = await db
        .from("two_step_methods")
        .update({ removed_at: new Date().toISOString() })
        .eq("id", data.id)
        .eq("user_id", uid)
        .is("removed_at", null);
      if (error) throw new Error(`Couldn't remove it: ${error.message}`);
    }
    await s.recordEvent(db, uid, "method_removed");
    const left = methods.filter((m) => !(m.kind === data.kind && m.id === data.id));
    const pref = await s.preferredOf(db, uid);
    if (pref && !left.some((m) => m.kind === pref)) {
      if (left[0]) await s.setPreferred(db, uid, left[0].kind);
      // The row also keeps their email-backup choice: clear only the preferred way.
      else await db.from("two_step_settings").update({ preferred: null }).eq("user_id", uid);
    }
    await s.tellTwoStep(
      db,
      uid,
      {
        title: `${KIND_TITLE[data.kind]} was removed from your two-step sign-in`,
        body: "If this wasn't you, change your password now.",
      },
      null,
      uid,
    );
    return { ok: true as const };
  });

export const setTwoStepPreferred = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ kind: z.enum(["sms", "passkey", "totp"]) }).parse(i))
  .handler(async ({ data, context }) => {
    const { s, db } = await requireConfirmed(context);
    const methods = await s.methodsFor(db, context.userId);
    if (!methods.some((m) => m.kind === data.kind)) throw new Error("Set that way up first.");
    await s.setPreferred(db, context.userId, data.kind);
    return { ok: true as const };
  });

/** Codes by email, on or off (the backup). On saves the login's email as it is now. */
export const setTwoStepEmailBackup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ on: z.boolean() }).parse(i))
  .handler(async ({ data, context }): Promise<EmailBackup | null> => {
    const { s, db } = await requireConfirmed(context);
    const before = await s.emailBackupOf(db, context.userId);
    const { data: state, error } = await db.rpc("two_step_email_backup_set", {
      _uid: context.userId,
      _on: data.on,
      _only_if_unset: false,
    });
    if (error) throw new Error(`Couldn't save that: ${error.message}`);
    const { emailBackupFrom } = await import("@/lib/two-step");
    const after = emailBackupFrom(state);
    if (data.on && !(before?.on && before.why !== "changed") && after?.to) {
      await s.tellTwoStep(
        db,
        context.userId,
        {
          title: "Sign-in codes can now be emailed",
          body: `To ${after.to}. If this wasn't you, change your password now.`,
        },
        null,
        context.userId,
      );
    }
    return after;
  });
