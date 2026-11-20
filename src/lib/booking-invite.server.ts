// Server-only: personal booking links (booking-invite.ts has the rules).
//
// The coach mints a link for one client and one booking type; the token is
// 24 random bytes and only its SHA-256 is stored (booking_invites), so the
// URL names nobody and a database read can't rebuild a working link. Every
// write here runs with the service role after the caller's staff check.
//
// Links minted before Nov 20 2026 were "<client uuid>.<expiry>.<hmac>": they
// still book as their client until they run out (at most 45 days), are never
// minted again, and can't be cancelled (they had no row).
import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  INVITE_DAYS,
  INVITE_TOKEN_RE,
  LEGACY_INVITE_RE,
  inviteState,
  type InviteState,
} from "@/lib/booking-invite";

type Admin = SupabaseClient<any, any, any>;

export function newInviteToken(): string {
  return randomBytes(24).toString("base64url");
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** What a link resolves to on the server; never sent to the browser as is. */
export type ResolvedInvite = {
  state: InviteState;
  /** null for a legacy link (no row). */
  id: string | null;
  clientId: string | null;
  /** The booking type it's for; null = any (a legacy link). */
  bookingCardId: string | null;
  /** The length the coach picked; null = the type's own (or the booker's pick). */
  durationMin: number | null;
  bookedSessionId: string | null;
  expiresAt: string | null;
};

export async function mintBookingInvite(
  admin: Admin,
  o: {
    clientId: string;
    bookingCardId: string;
    durationMin: number | null;
    createdBy: string;
    now?: Date;
  },
): Promise<{ id: string; token: string; expiresAt: string }> {
  const now = o.now ?? new Date();
  const token = newInviteToken();
  const expiresAt = new Date(now.getTime() + INVITE_DAYS * 86_400_000).toISOString();
  const { data, error } = await admin
    .from("booking_invites" as any)
    .insert({
      token_hash: hashInviteToken(token),
      client_id: o.clientId,
      booking_card_id: o.bookingCardId,
      duration_minutes: o.durationMin,
      created_by: o.createdBy,
      expires_at: expiresAt,
    } as any)
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Couldn't make the link.");
  return { id: (data as any).id as string, token, expiresAt };
}

/** The link a token names, and where it stands; null when it isn't a link at all. */
export async function resolveBookingInvite(
  admin: Admin,
  token: string | null | undefined,
  now = new Date(),
): Promise<ResolvedInvite | null> {
  const t = String(token ?? "").trim();
  if (!t) return null;
  if (LEGACY_INVITE_RE.test(t)) {
    const clientId = verifyLegacyInvite(t, now.getTime());
    const active = clientId ? await clientActive(admin, clientId) : false;
    const ranOut = Number(t.split(".")[1]) * 1000 < now.getTime();
    return {
      state: !clientId ? (ranOut ? "expired" : "invalid") : active ? "ok" : "revoked",
      id: null,
      clientId: active ? clientId : null,
      bookingCardId: null,
      durationMin: null,
      bookedSessionId: null,
      expiresAt: null,
    };
  }
  if (!INVITE_TOKEN_RE.test(t)) return null;
  const { data: row } = await admin
    .from("booking_invites" as any)
    .select(
      "id, client_id, booking_card_id, duration_minutes, expires_at, revoked_at, booked_session_id",
    )
    .eq("token_hash", hashInviteToken(t))
    .maybeSingle();
  if (!row)
    return {
      state: "invalid",
      id: null,
      clientId: null,
      bookingCardId: null,
      durationMin: null,
      bookedSessionId: null,
      expiresAt: null,
    };
  const r = row as any;
  const [active, booked] = await Promise.all([
    clientActive(admin, r.client_id),
    r.booked_session_id
      ? admin.from("pt_sessions").select("status").eq("id", r.booked_session_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const state = inviteState(r, {
    clientActive: active,
    bookedStatus: (booked as any)?.data?.status ?? null,
    now,
  });
  return {
    state,
    id: r.id,
    clientId: r.client_id,
    bookingCardId: r.booking_card_id,
    durationMin: r.duration_minutes ?? null,
    bookedSessionId: r.booked_session_id ?? null,
    expiresAt: r.expires_at,
  };
}

async function clientActive(admin: Admin, clientId: string): Promise<boolean> {
  const { data } = await admin.from("clients").select("archived").eq("id", clientId).maybeSingle();
  return !!data && !(data as any).archived;
}

/** Someone opened it (not staff): the coach's card says so. Never fails the page. */
export async function noteInviteOpened(
  admin: Admin,
  inviteId: string,
  now = new Date(),
): Promise<void> {
  try {
    const at = now.toISOString();
    await admin
      .from("booking_invites" as any)
      .update({ last_opened_at: at } as any)
      .eq("id", inviteId);
    await admin
      .from("booking_invites" as any)
      .update({ first_opened_at: at } as any)
      .eq("id", inviteId)
      .is("first_opened_at", null);
  } catch {
    /* only a signal */
  }
}

/** Hold the link for one booking ('ok'), or why it can't book. */
export async function claimInvite(admin: Admin, inviteId: string): Promise<InviteState | "busy"> {
  const { data, error } = await admin.rpc(
    "booking_invite_claim" as any,
    { _invite: inviteId } as any,
  );
  if (error) throw new Error(error.message);
  const s = String(data ?? "invalid");
  return (["ok", "booked", "expired", "revoked", "invalid", "busy"].includes(s) ? s : "invalid") as
    | InviteState
    | "busy";
}

/** Let go of the hold; with a session, keep it as the link's booking. */
export async function finishInvite(
  admin: Admin,
  inviteId: string,
  sessionId: string | null,
  now = new Date(),
): Promise<void> {
  await admin
    .from("booking_invites" as any)
    .update(
      (sessionId
        ? { booked_session_id: sessionId, booked_at: now.toISOString(), claimed_at: null }
        : { claimed_at: null }) as any,
    )
    .eq("id", inviteId);
}

// ── Legacy links (read only) ─────────────────────────────────────────────────

const LEGACY_PREFIX = "booking-invite:v1:";

function legacySecret(): string | null {
  return process.env.BOOKING_INVITE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || null;
}

/** The client a pre-Nov 20 link names, while it's unexpired and genuine; null for anything else. */
export function verifyLegacyInvite(token: string, now = Date.now()): string | null {
  if (!LEGACY_INVITE_RE.test(token)) return null;
  const [clientId, expRaw, sig] = token.split(".");
  if (Number(expRaw) * 1000 < now) return null;
  const secret = legacySecret();
  if (!secret) return null;
  const expected = createHmac("sha256", secret)
    .update(`${LEGACY_PREFIX}${clientId}.${expRaw}`)
    .digest("hex")
    .slice(0, 32);
  const a = Buffer.from(sig.toLowerCase(), "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b) ? clientId : null;
}
