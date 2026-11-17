// Who a password-recovery request is for, and where its text may go.
//
// The rule: find the login first, exactly (an email is the login's own email,
// a phone is one saved on that login's own records), and only ever text a
// phone saved on that login's own records. A phone on a record that merely
// shares the email (an application, a lead, a client record not linked to
// the login) is never used: anyone can submit an application with any email
// and their own phone, and before Nov 17 2026 that was enough to have
// someone else's reset link texted to them (the admin's included).
//
// Staff logins (any role but "client") recover by email only. A text is the
// weaker channel, and a login that can see every client's records must never
// be one text away.

import { normalizePhoneE164 } from "./account-recovery.constants";

export const STAFF_ROLES = ["admin", "coach", "finance", "media_manager"] as const;

export type RecoveryTarget = {
  userId: string | null;
  email: string | null;
  phoneE164: string | null;
};

const NONE: RecoveryTarget = { userId: null, email: null, phoneE164: null };

/** The parts of a Supabase service client this module uses (so tests can stand in for it). */
export type RecoveryDb = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
  from: (table: string) => any;
  auth: { admin: { getUserById: (id: string) => PromiseLike<{ data: { user: { email?: string | null } | null } | null; error: unknown }> } };
};

function lastTen(digits: string): string {
  return digits.replace(/\D/g, "").slice(-10);
}

/**
 * The login with exactly this email, or null (never a prefix, wildcard or near
 * match). auth_user_id_for_email reads auth.users; until that migration is in
 * (20270402090000_security_hardening.sql) it falls back to the login's
 * profiles row, matched exactly (profiles.email follows the login's email).
 */
export async function loginForEmail(db: RecoveryDb, email: string): Promise<string | null> {
  const wanted = email.trim().toLowerCase();
  if (!wanted) return null;
  const { data, error } = await db.rpc("auth_user_id_for_email", { _email: wanted });
  if (!error) return typeof data === "string" && data ? data : null;
  try {
    const { data: rows } = await db
      .from("profiles")
      .select("id, email")
      .ilike("email", wanted.replace(/[\\%_]/g, (c) => `\\${c}`))
      .limit(5);
    const exact = (rows ?? []).filter((r: any) => String(r?.email ?? "").trim().toLowerCase() === wanted);
    return exact.length === 1 ? String(exact[0].id) : null;
  } catch {
    return null;
  }
}

async function emailOfLogin(db: RecoveryDb, userId: string): Promise<string | null> {
  try {
    const { data } = await db.auth.admin.getUserById(userId);
    const email = (data?.user?.email ?? "").trim().toLowerCase();
    return email || null;
  } catch {
    return null;
  }
}

/** The first phone saved on this login's own records (member, client, coach, profile). */
export async function phoneOfLogin(db: RecoveryDb, userId: string): Promise<string | null> {
  const sources: Array<() => PromiseLike<{ data: any }>> = [
    () => db.from("app_members").select("phone").eq("user_id", userId).limit(1),
    () =>
      db
        .from("clients")
        .select("phone")
        .eq("user_id", userId)
        .order("archived", { ascending: true })
        .order("created_at", { ascending: true })
        .limit(1),
    () => db.from("coaches").select("phone").eq("user_id", userId).limit(1),
    () => db.from("profiles").select("phone").eq("id", userId).limit(1),
  ];
  for (const read of sources) {
    try {
      const { data } = await read();
      const row = Array.isArray(data) ? data[0] : data;
      const phone = normalizePhoneE164(row?.phone ?? null);
      if (phone) return phone;
    } catch {
      /* a source that can't be read is skipped, never guessed */
    }
  }
  return null;
}

/**
 * The one login whose own records carry this phone, or null when none or
 * more than one do (never a guess between people).
 */
export async function loginForPhone(db: RecoveryDb, phoneE164: string): Promise<string | null> {
  const digits = phoneE164.replace(/\D/g, "");
  const ten = lastTen(digits);
  if (ten.length < 10) return null;
  const found = new Set<string>();
  const add = (rows: any, key = "user_id") => {
    for (const r of Array.isArray(rows) ? rows : rows ? [rows] : []) {
      const id = r?.[key];
      if (typeof id === "string" && id) {
        // The match must really be this phone, not just contain its digits.
        if (r.phone !== undefined && lastTen(String(r.phone ?? "")) !== ten) continue;
        found.add(id);
      }
    }
  };
  const reads: Array<[() => PromiseLike<{ data: any }>, string?]> = [
    [() => db.from("clients").select("user_id").eq("normalized_phone", digits).not("user_id", "is", null).limit(5)],
    [() => db.from("app_members").select("user_id, phone").ilike("phone", `%${ten}%`).not("user_id", "is", null).limit(5)],
    [() => db.from("coaches").select("user_id, phone").ilike("phone", `%${ten}%`).not("user_id", "is", null).limit(5)],
    [() => db.from("profiles").select("id, phone").ilike("phone", `%${ten}%`).limit(5), "id"],
  ];
  for (const [read, key] of reads) {
    try {
      const { data } = await read();
      add(data, key);
    } catch {
      /* skipped */
    }
  }
  return found.size === 1 ? [...found][0] : null;
}

export async function isStaffLogin(db: RecoveryDb, userId: string): Promise<boolean> {
  try {
    const { data } = await db.from("user_roles").select("role").eq("user_id", userId).in("role", [...STAFF_ROLES]).limit(1);
    return Array.isArray(data) ? data.length > 0 : !!data;
  } catch {
    // Can't tell: treat as staff, so the reset goes by email only.
    return true;
  }
}

/**
 * Resolve a recovery request. Never throws; a request that matches nobody
 * returns nulls, and the caller answers the same way either way.
 */
export async function lookupRecoveryTarget(db: RecoveryDb, identifier: string, isEmail: boolean): Promise<RecoveryTarget> {
  let userId: string | null = null;
  let email: string | null = null;
  let phoneE164: string | null = null;

  if (isEmail) {
    email = identifier.trim().toLowerCase();
    userId = await loginForEmail(db, email);
    if (!userId) return NONE;
    phoneE164 = await phoneOfLogin(db, userId);
  } else {
    const typed = normalizePhoneE164(identifier);
    if (!typed) return NONE;
    userId = await loginForPhone(db, typed);
    if (!userId) return NONE;
    phoneE164 = typed;
    email = await emailOfLogin(db, userId);
  }

  if (phoneE164 && (await isStaffLogin(db, userId))) phoneE164 = null;
  return { userId, email, phoneE164 };
}
