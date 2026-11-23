/**
 * Server-only helpers for two-step sign-in (two-step.ts, two-step.functions.ts,
 * mfa-recovery.functions.ts: the owner's reset). Everything here reads and writes as the server:
 * the tables are the server's only (20270512090000_two_step_sms_passkeys.sql),
 * and every caller passes the signed-in login it already checked.
 *
 * Never import this from client code or the top level of a .functions.ts file.
 */
import { MFA_REQUIRED_ROLES } from "@/lib/mfa-rules";
import {
  emailBackupFrom,
  isTeamRole,
  maskPhone,
  twoStepPhone,
  TRUST_DAYS,
  type EmailBackup,
  type TwoStepKind,
  type TwoStepMethod,
  type TwoStepStatus,
} from "@/lib/two-step";
import { toB64url } from "@/lib/webauthn";

export type Db = any;

export async function admin(): Promise<Db> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as Db;
}

export type Claims = Record<string, any> | null | undefined;

/** The session id in the access token (signed: requireSupabaseAuth checked it). */
export function sessionIdOf(claims: Claims): string {
  const sid = claims?.session_id;
  if (typeof sid !== "string" || !/^[0-9a-f-]{36}$/i.test(sid)) {
    throw new Error("Sign in again, then confirm it's you.");
  }
  return sid;
}

export async function rolesOf(db: Db, userId: string): Promise<string[]> {
  const { data, error } = await db.from("user_roles").select("role").eq("user_id", userId);
  if (error) throw new Error(`Couldn't read your login: ${error.message}`);
  return (data ?? []).map((r: any) => String(r.role));
}

export function teamOf(roles: string[]): { team: boolean; required: boolean } {
  return { team: roles.some(isTeamRole), required: roles.some((r) => MFA_REQUIRED_ROLES.has(r)) };
}

/** Two-step is for team logins only (it texts, and nobody else is checked). */
export async function requireTeam(
  db: Db,
  userId: string,
): Promise<{ team: true; required: boolean; roles: string[] }> {
  const roles = await rolesOf(db, userId);
  const t = teamOf(roles);
  if (!t.team) throw new Error("Two-step sign-in is for team logins.");
  return { team: true, required: t.required, roles };
}

export type TotpRow = { id: string; name: string; createdAt: string | null };

export async function totpFactors(db: Db, userId: string): Promise<TotpRow[]> {
  const { data, error } = await db.auth.admin.mfa.listFactors({ userId });
  if (error) throw new Error(`Couldn't read the authenticator apps: ${error.message}`);
  return (((data as any)?.factors ?? []) as any[])
    .filter((f) => f.status === "verified" && (f.factor_type ?? "totp") === "totp")
    .map((f) => ({
      id: String(f.id),
      name: String(f.friendly_name || "Authenticator app"),
      createdAt: f.created_at ?? null,
    }));
}

export type MethodRow = {
  id: string;
  kind: "sms" | "passkey";
  label: string;
  phone: string | null;
  credential_id: string | null;
  public_key: any;
  alg: number | null;
  rp_id: string | null;
  sign_count: number;
  transports: string[];
  created_at: string;
  last_used_at: string | null;
};

export async function activeMethods(db: Db, userId: string): Promise<MethodRow[]> {
  const { data, error } = await db
    .from("two_step_methods")
    .select(
      "id, kind, label, phone, credential_id, public_key, alg, rp_id, sign_count, transports, created_at, last_used_at",
    )
    .eq("user_id", userId)
    .is("removed_at", null)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Couldn't read your ways to confirm: ${error.message}`);
  return (data ?? []) as MethodRow[];
}

/** Every way to confirm, as the app shows it (a phone masked, never a key). */
export async function methodsFor(db: Db, userId: string): Promise<TwoStepMethod[]> {
  const [own, totp] = await Promise.all([activeMethods(db, userId), totpFactors(db, userId)]);
  return [
    ...own.map((m) => ({
      id: m.id,
      kind: m.kind as TwoStepKind,
      label: m.kind === "sms" ? `Text to ${maskPhone(m.phone)}` : m.label,
      createdAt: m.created_at,
      lastUsedAt: m.last_used_at,
    })),
    ...totp.map((f) => ({
      id: f.id,
      kind: "totp" as const,
      label: f.name.replace(/ · \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, "") || "Authenticator app",
      createdAt: f.createdAt,
      lastUsedAt: null,
    })),
  ];
}

/** Whether this request's session has been confirmed (aal2, or marked and still live). */
export async function sessionConfirmed(db: Db, userId: string, claims: Claims): Promise<boolean> {
  if (claims?.aal === "aal2") return true;
  const sid = claims?.session_id;
  if (typeof sid !== "string") return false;
  const { data, error } = await db.rpc("two_step_session_live", { _uid: userId, _session: sid });
  if (error) throw new Error(`Couldn't check this sign-in: ${error.message}`);
  return data === true;
}

export async function markSession(
  db: Db,
  userId: string,
  sessionId: string,
  method: string,
): Promise<void> {
  const { data, error } = await db.rpc("two_step_session_mark", {
    _uid: userId,
    _session: sessionId,
    _method: method,
  });
  if (error) throw new Error(`Couldn't confirm this sign-in: ${error.message}`);
  if (data !== true) throw new Error("This sign-in has ended. Sign in again.");
}

export async function preferredOf(db: Db, userId: string): Promise<TwoStepKind | null> {
  const { data } = await db
    .from("two_step_settings")
    .select("preferred")
    .eq("user_id", userId)
    .maybeSingle();
  const p = data?.preferred;
  return p === "sms" || p === "passkey" || p === "totp" ? p : null;
}

export async function setPreferred(db: Db, userId: string, kind: TwoStepKind): Promise<void> {
  const { error } = await db
    .from("two_step_settings")
    .upsert(
      { user_id: userId, preferred: kind, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
  if (error) throw new Error(`Couldn't save your choice: ${error.message}`);
}

/** Make a kind preferred only when nothing is yet (the first way set up). */
export async function preferIfNone(db: Db, userId: string, kind: TwoStepKind): Promise<void> {
  if (!(await preferredOf(db, userId))) await setPreferred(db, userId, kind);
}

/** Their own phone on file, to offer when they add text messages. */
async function phoneOnFile(db: Db, userId: string): Promise<string | null> {
  try {
    const { data } = await db.from("profiles").select("phone").eq("id", userId).maybeSingle();
    return twoStepPhone(data?.phone ?? null);
  } catch {
    return null;
  }
}

/**
 * Codes by email (20270515090000_two_step_email_backup.sql). Never fails the
 * status: a database without it, or a read that fails, is "no email backup".
 * `ensure` turns it on for a login that never chose (its first way is in
 * place and this session is confirmed): on by default, then theirs.
 */
export async function emailBackupOf(
  db: Db,
  userId: string,
  opts: { ensure?: boolean } = {},
): Promise<EmailBackup | null> {
  try {
    const { data, error } = await db.rpc("two_step_email_backup_state", { _uid: userId });
    if (error) throw error;
    if (opts.ensure && data && data.chosen !== true) {
      const set = await db.rpc("two_step_email_backup_set", {
        _uid: userId,
        _on: true,
        _only_if_unset: true,
      });
      if (!set.error) return emailBackupFrom(set.data);
    }
    return emailBackupFrom(data);
  } catch (e) {
    console.warn("[two-step] email backup unreadable", (e as any)?.message ?? e);
    return null;
  }
}

export async function statusFor(db: Db, userId: string, claims: Claims): Promise<TwoStepStatus> {
  const roles = await rolesOf(db, userId);
  const { team, required } = teamOf(roles);
  const methods = await methodsFor(db, userId);
  if (!team && methods.length === 0) {
    return {
      team,
      required,
      verified: true,
      methods,
      preferred: null,
      suggestedPhone: null,
      emailBackup: null,
    };
  }
  const [verified, preferred] = await Promise.all([
    sessionConfirmed(db, userId, claims),
    preferredOf(db, userId),
  ]);
  const hasSms = methods.some((m) => m.kind === "sms");
  const emailBackup = methods.length ? await emailBackupOf(db, userId, { ensure: verified }) : null;
  return {
    team,
    required,
    verified,
    methods,
    preferred:
      preferred && methods.some((m) => m.kind === preferred)
        ? preferred
        : (methods[0]?.kind ?? null),
    suggestedPhone: team && !hasSms ? await phoneOnFile(db, userId) : null,
    emailBackup,
  };
}

/** A device token: 32 random bytes; only its hash is kept. */
export async function trustTokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`jf-2step-device:${token}`),
  );
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function mintTrust(
  db: Db,
  userId: string,
  label: string | null | undefined,
): Promise<{ id: string; token: string; until: string }> {
  const token = toB64url(crypto.getRandomValues(new Uint8Array(32)));
  const { data, error } = await db.rpc("two_step_trust_add", {
    _uid: userId,
    _hash: await trustTokenHash(token),
    _label: String(label ?? "").slice(0, 80) || "This device",
    _days: TRUST_DAYS,
  });
  if (error) throw new Error(`Couldn't remember this device: ${error.message}`);
  return {
    id: String(data),
    token,
    until: new Date(Date.now() + TRUST_DAYS * 86_400_000).toISOString(),
  };
}

export async function recordEvent(
  db: Db,
  userId: string,
  kind: string,
  actorId?: string | null,
): Promise<void> {
  await db.from("staff_mfa_events").insert({ user_id: userId, kind, actor_id: actorId ?? userId });
}

/**
 * One push to the person (and, when `owner` is given, one to each admin who
 * isn't them or whoever did it). Never fails the change it's about.
 */
export async function tellTwoStep(
  db: Db,
  userId: string,
  self: { title: string; body: string },
  owner: { title: string; body: string } | null,
  actorId: string,
): Promise<void> {
  try {
    const { sendWebPushToUser } = await import("@/lib/push/push.server");
    const stamp = Date.now();
    await sendWebPushToUser(
      db,
      userId,
      { ...self, url: "/admin/account", tag: "two_step", data: { kind: "two_step" } },
      {
        category: "messages",
        eventKey: `two_step:${userId}:${stamp}`,
        priority: "urgent",
      },
    );
    if (!owner) return;
    const { data: admins } = await db.from("user_roles").select("user_id").eq("role", "admin");
    for (const a of admins ?? []) {
      if (!a?.user_id || a.user_id === userId || a.user_id === actorId) continue;
      await sendWebPushToUser(
        db,
        a.user_id,
        { ...owner, url: "/admin/team", tag: "two_step", data: { kind: "two_step" } },
        {
          category: "messages",
          eventKey: `two_step:${userId}:${stamp}:${a.user_id}`,
          priority: "urgent",
        },
      );
    }
  } catch (e) {
    console.warn("[two-step] push failed", e);
  }
}

export async function firstNameOf(db: Db, userId: string): Promise<string> {
  try {
    const { data } = await db.from("profiles").select("full_name").eq("id", userId).maybeSingle();
    const name = String(data?.full_name || "")
      .trim()
      .split(/\s+/)[0];
    return name || "A team member";
  } catch {
    return "A team member";
  }
}

/** The page's origin, from the request (passkeys are tied to the site). */
export async function requestOrigin(): Promise<string | null> {
  const { getRequest } = await import("@tanstack/react-start/server");
  const h = getRequest()?.headers;
  const origin = h?.get("origin");
  if (origin) return origin;
  const ref = h?.get("referer");
  if (ref) {
    try {
      return new URL(ref).origin;
    } catch {
      return null;
    }
  }
  return null;
}
