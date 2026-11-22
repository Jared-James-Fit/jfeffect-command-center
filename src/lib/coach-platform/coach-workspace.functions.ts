/**
 * Coach workspace server functions. Every read goes through the caller's own
 * login (RLS and the tenant fence decide); every write is a definer function
 * that checks the caller's role in that business itself. The service role is
 * used only after assertOrgAccess passed, and only for what RLS can't do:
 * Stripe (test mode) and the AI meter's state.
 *
 * Off in production: the pilot switch is off and no workspace exists, so
 * every call here answers "not available" until the owner creates one.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { monthlyCredits } from "./ai-allowance";
import { billingLine, rowPricing, writeAccess, type BillingRow } from "./coach-billing";
import { seatSummary } from "./seat-pricing";
import {
  CLIENT_CONSENT_VERSION,
  INVITE_TOKEN_BYTES,
  type InvitePeek,
  type RosterRow,
  TOKEN_RE,
  clientConsentText,
  inviteLink,
  sortRoster,
} from "./workspace";

async function admin(): Promise<any> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

function anon(): any {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Not configured");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

const SITE = /^https:\/\/([a-z0-9-]+\.)*(jfeffect\.com|lovable\.app)$|^http:\/\/localhost(:\d+)?$/;
function siteOrigin(): string {
  const o = getRequestHeader("origin") ?? "";
  return SITE.test(o) ? o : "https://jfeffect.com";
}

/** May the signed-in person use this key in this business (and reach this client)? Asked through their own login. */
export async function assertOrgAccess(ctx: any, orgId: string, key: string, clientId?: string | null): Promise<void> {
  const { data: ok, error } = await ctx.supabase.rpc("has_org_permission", { _org: orgId, _key: key });
  if (error || !ok) throw new Error("Not available");
  if (clientId) {
    const { data, error: e2 } = await ctx.supabase.from("organization_clients").select("client_id").eq("org_id", orgId).eq("client_id", clientId).maybeSingle();
    if (e2 || !data) throw new Error("Not available");
  }
}

async function isMember(ctx: any, orgId: string): Promise<{ role: string } | null> {
  const { data } = await ctx.supabase
    .from("organization_members")
    .select("role, status")
    .eq("org_id", orgId)
    .eq("user_id", ctx.userId)
    .eq("status", "active")
    .maybeSingle();
  return data ? { role: data.role } : null;
}

function token(): { token: string; hash: Promise<string> } {
  const bytes = new Uint8Array(INVITE_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  const t = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const hash = crypto.subtle
    .digest("SHA-256", new TextEncoder().encode(t))
    .then((b) => Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join(""));
  return { token: t, hash };
}

/* ───────────────────────── the coach ───────────────────────── */

export type MyWorkspace = { id: string; name: string; role: string; status: string };

/** The workspaces the signed-in person works in (independent businesses only). */
export const listMyWorkspaces = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MyWorkspace[]> => {
    const { data, error } = await (context as any).supabase
      .from("organization_members")
      .select("role, status, organizations!inner(id, name, kind, status)")
      .eq("user_id", (context as any).userId)
      .eq("status", "active");
    if (error) return [];
    return (data ?? [])
      .filter((m: any) => m.organizations?.kind === "independent")
      .map((m: any) => ({ id: m.organizations.id, name: m.organizations.name, role: m.role, status: m.organizations.status }));
  });

export type WorkspaceOverview = {
  id: string;
  name: string;
  role: string;
  roster: RosterRow[];
  invitations: Array<{ id: string; kind: string; email: string; role: string | null; expires_at: string; created_at: string }>;
  team: Array<{ user_id: string; role: string }>;
  billing: null | {
    state: BillingRow["state"];
    line: string;
    canWrite: boolean;
    seats: ReturnType<typeof seatSummary>;
    aiCredits: number;
    aiUsed: number;
    aiPurchasedLeft: number;
  };
};

export const getWorkspaceOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ orgId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<WorkspaceOverview> => {
    const ctx = context as any;
    const me = await isMember(ctx, data.orgId);
    if (!me) throw new Error("Not available");
    const sb = ctx.supabase;
    const [{ data: org }, { data: rels }, { data: invs }, { data: team }, { data: bill }] = await Promise.all([
      sb.from("organizations").select("id, name").eq("id", data.orgId).maybeSingle(),
      sb.from("organization_clients").select("client_id, status, assigned_user_id, started_at").eq("org_id", data.orgId),
      sb.from("organization_invitations").select("id, kind, email, role, expires_at, created_at, accepted_at, revoked_at").eq("org_id", data.orgId).order("created_at", { ascending: false }).limit(100),
      sb.from("organization_members").select("user_id, role, status").eq("org_id", data.orgId).eq("status", "active"),
      sb.from("organization_billing").select("*").eq("org_id", data.orgId).maybeSingle(),
    ]);
    if (!org) throw new Error("Not available");
    const ids = (rels ?? []).map((r: any) => r.client_id);
    const { data: people } = ids.length ? await sb.from("clients").select("id, full_name, email").in("id", ids) : { data: [] };
    const byId = new Map((people ?? []).map((p: any) => [p.id, p]));
    const roster = sortRoster(
      (rels ?? []).map((r: any) => ({
        client_id: r.client_id,
        full_name: (byId.get(r.client_id) as any)?.full_name ?? null,
        email: (byId.get(r.client_id) as any)?.email ?? null,
        status: r.status,
        assigned_user_id: r.assigned_user_id,
        started_at: r.started_at,
      })),
    );
    let billing: WorkspaceOverview["billing"] = null;
    if (bill) {
      const row = bill as BillingRow;
      const pricing = rowPricing(row);
      const { data: ai } = await (await admin()).rpc("org_ai_state", { _org: data.orgId });
      billing = {
        state: row.state,
        line: billingLine(row),
        canWrite: writeAccess(row).canWrite,
        seats: seatSummary(row.seats, pricing),
        aiCredits: monthlyCredits(row.seats, pricing),
        aiUsed: Number(ai?.used ?? 0),
        aiPurchasedLeft: Math.max(0, Number(ai?.purchased_left ?? 0)),
      };
    }
    return {
      id: org.id,
      name: org.name,
      role: me.role,
      roster,
      invitations: (invs ?? []).filter((i: any) => !i.accepted_at && !i.revoked_at),
      team: team ?? [],
      billing,
    };
  });

/** Invite a client or a teammate; the link is shown once to copy or send. */
export const inviteToWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        orgId: z.string().uuid(),
        kind: z.enum(["client", "member"]),
        email: z.string().trim().toLowerCase().email().max(254),
        role: z.enum(["admin", "coach"]).optional(),
        assignTo: z.string().uuid().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<{ link: string; expiresInDays: number }> => {
    const t = token();
    const { error } = await (context as any).supabase.rpc("org_invite", {
      _org: data.orgId,
      _kind: data.kind,
      _email: data.email,
      _token_hash: await t.hash,
      _role: data.kind === "member" ? data.role ?? "coach" : null,
      _assign_to: data.assignTo ?? null,
    });
    if (error) throw new Error(error.message);
    return { link: inviteLink(siteOrigin(), t.token), expiresInDays: 14 };
  });

export const revokeWorkspaceInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await (context as any).supabase.rpc("org_invitation_revoke", { _id: data.id });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Pause, resume or end a client (the database checks clients.manage, or that it's the client leaving). */
export const setWorkspaceClientStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ orgId: z.string().uuid(), clientId: z.string().uuid(), status: z.enum(["active", "paused", "ended"]) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { error } = await (context as any).supabase.rpc("org_client_set_status", {
      _org: data.orgId, _client: data.clientId, _status: data.status, _reason: null,
    });
    if (error) throw new Error(error.message);
    await syncSeatsQuietly(data.orgId);
    return { ok: true };
  });

/** Set up seat billing (test mode only): the owner, once there's a paid client. */
export const startWorkspaceBilling = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ orgId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<{ url: string }> => {
    await assertOrgAccess(context, data.orgId, "billing.manage");
    const { data: u } = await (context as any).supabase.auth.getUser();
    const { startSeatCheckout } = await import("./coach-billing.server");
    return startSeatCheckout(data.orgId, { email: u?.user?.email ?? null, origin: siteOrigin() });
  });

async function syncSeatsQuietly(orgId: string) {
  try {
    const { syncSeats } = await import("./coach-billing.server");
    await syncSeats(orgId);
  } catch (e) {
    // the nightly reconciliation catches up; a client change never fails on Stripe
    console.warn("[coach-billing] seat sync deferred", orgId, (e as Error)?.message);
  }
}

/* ───────────────────────── the client ───────────────────────── */

/** What an invitation link shows, signed in or not. */
export const peekWorkspaceInvitation = createServerFn({ method: "GET" })
  .inputValidator((i: unknown) => z.object({ token: z.string() }).parse(i))
  .handler(async ({ data }): Promise<InvitePeek & { consent?: string; consentVersion?: string }> => {
    if (!TOKEN_RE.test(data.token)) return { state: "invalid" };
    const { data: peek, error } = await anon().rpc("org_invitation_peek", { _token: data.token });
    if (error || !peek) return { state: "invalid" };
    const p = peek as InvitePeek;
    return p.kind === "client" && p.state === "open"
      ? { ...p, consent: clientConsentText(p.business ?? ""), consentVersion: CLIENT_CONSENT_VERSION }
      : p;
  });

/** Accept, as the signed-in person, with the consent the page showed. */
export const acceptWorkspaceInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ token: z.string().regex(TOKEN_RE) }).parse(i))
  .handler(async ({ data, context }): Promise<{ ok: boolean; reason?: string; business?: string; kind?: string }> => {
    const peek = await anon().rpc("org_invitation_peek", { _token: data.token });
    const business = (peek.data as InvitePeek | null)?.business ?? "";
    const { data: res, error } = await (context as any).supabase.rpc("org_invitation_accept", {
      _token: data.token,
      _consent_version: CLIENT_CONSENT_VERSION,
      _consent_text: clientConsentText(business),
    });
    if (error) throw new Error(error.message);
    if (res?.ok && res.kind === "client" && res.org_id) await syncSeatsQuietly(res.org_id);
    return { ok: !!res?.ok, reason: res?.reason, business: res?.business, kind: res?.kind };
  });

/* ─────────────── a new client makes their login from the invitation ─────────────── */

async function openInvitation(sb: any, tok: string) {
  if (!TOKEN_RE.test(tok)) return null;
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(tok))))
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
  const { data } = await sb.from("organization_invitations").select("*").eq("token_hash", hash).maybeSingle();
  if (!data || data.accepted_at || data.revoked_at || new Date(data.expires_at).getTime() <= Date.now() || data.failed_tries >= 5) return null;
  return data as any;
}

async function loginExists(sb: any, email: string): Promise<boolean> {
  const { data } = await sb.rpc("auth_user_id_for_email", { _email: email });
  return !!data;
}

/**
 * Send a 6-digit code to the invited email (the link proves they have the
 * invitation; the code proves they have the inbox). An email that already has
 * a login is told to sign in instead. Limited per connection and per invitation.
 */
export const sendInviteSignupCode = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => z.object({ token: z.string() }).parse(i))
  .handler(async ({ data }): Promise<{ sent: boolean; signIn?: boolean; emailHint?: string }> => {
    const sb = await admin();
    const { callerIp, allRatesOk } = await import("@/lib/public-rate-limit.server");
    const { ipHash, newCode, codeHash, CODE_MINUTES, CODE_RESEND_SECONDS } = await import("@/lib/membership-activation.server");
    const ip = ipHash(callerIp());
    if (!(await allRatesOk(sb, [{ key: ip ? `ws_invite_code:ip:${ip}` : null, max: 10, window: "1 hour" }]))) {
      throw new Error("Too many tries from here. Try again in an hour.");
    }
    const inv = await openInvitation(sb, data.token);
    if (!inv) throw new Error("This invitation can't be used any more.");
    const hint = inv.email.replace(/^(.).*(@.*)$/, "$1•••$2");
    if (await loginExists(sb, inv.email)) return { sent: false, signIn: true, emailHint: hint };
    if (inv.signup_code_sent_at && Date.now() - new Date(inv.signup_code_sent_at).getTime() < CODE_RESEND_SECONDS * 1000) {
      return { sent: true, emailHint: hint };
    }
    const code = newCode();
    await sb.from("organization_invitations").update({
      signup_code_hash: codeHash(`wsinv:${inv.id}`, code),
      signup_code_expires_at: new Date(Date.now() + CODE_MINUTES * 60_000).toISOString(),
      signup_code_tries: 0,
      signup_code_sent_at: new Date().toISOString(),
    }).eq("id", inv.id);
    const { sendTemplateEmail } = await import("@/lib/transactional-email.server");
    await sendTemplateEmail(sb, { template: "membership-code", to: inv.email, data: { first_name: "", code }, sensitive: true });
    return { sent: true, emailHint: hint };
  });

/**
 * Make the login with the code and a password. Made unconfirmed, then
 * confirmed (as /activate does): confirmed at creation, the new-login trigger
 * would hand it any JF Effect record with this email. It never joins JF
 * Effect as a member; accepting the invitation is the next step, signed in.
 */
export const finishInviteSignup = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({ token: z.string(), code: z.string().regex(/^\d{6}$/), password: z.string().min(8).max(200), fullName: z.string().trim().min(2).max(120) }).parse(i),
  )
  .handler(async ({ data }): Promise<{ ok: true; email: string }> => {
    const sb = await admin();
    const { codeHash, CODE_MAX_ATTEMPTS } = await import("@/lib/membership-activation.server");
    const inv = await openInvitation(sb, data.token);
    if (!inv || !inv.signup_code_hash) throw new Error("Ask for a new code.");
    if (inv.signup_code_tries >= CODE_MAX_ATTEMPTS || new Date(inv.signup_code_expires_at).getTime() < Date.now()) {
      throw new Error("That code has run out. Ask for a new one.");
    }
    if (codeHash(`wsinv:${inv.id}`, data.code) !== inv.signup_code_hash) {
      await sb.from("organization_invitations").update({ signup_code_tries: inv.signup_code_tries + 1 }).eq("id", inv.id);
      throw new Error("That code isn't right.");
    }
    if (await loginExists(sb, inv.email)) throw new Error("You already have an account. Sign in instead.");
    const { data: made, error } = await sb.auth.admin.createUser({
      email: inv.email,
      password: data.password,
      email_confirm: false,
      user_metadata: { full_name: data.fullName, workspace_invitation_id: inv.id },
    });
    if (error || !made?.user) throw new Error("Couldn't make your account. Try again.");
    const { error: cErr } = await sb.auth.admin.updateUserById(made.user.id, { email_confirm: true });
    if (cErr) throw new Error("Couldn't finish making your account. Try again.");
    await sb.from("organization_invitations").update({ signup_code_hash: null }).eq("id", inv.id);
    return { ok: true, email: inv.email };
  });
