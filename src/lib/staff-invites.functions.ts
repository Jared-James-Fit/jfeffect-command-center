/**
 * Staff access: the Team page's list, invites and removals, plus the public
 * setup-link preview and redeem.
 *
 * A staff invite always creates a brand-new, staff-only login with its own
 * email (never a client's or member's account) and only for roles in
 * INVITABLE_ROLES. Admin is never granted by a link; coaches are set up from
 * People, where they also get their clients.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { INVITABLE_ROLES, INVITE_TTL_DAYS, STAFF_ROLE_INFO, isInvitableRole, type InviteDelivery } from "@/lib/staff-roles";
import { assertAdminView } from "@/lib/permissions.server";

async function assertAdmin(ctx: any) {
  const { data } = await ctx.supabase
    .from("user_roles").select("role").eq("user_id", ctx.userId).eq("role", "admin").maybeSingle();
  if (!data) throw new Error("Admin required");
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

const TEAM_ROLES = ["admin", "coach", "finance", "media_manager"];

export type TeamMember = {
  user_id: string;
  name: string | null;
  email: string | null;
  roles: string[];
  owner: boolean;
  since: string | null;
  /** Their own client account, if the owner linked this login to it (calendar, Google sync). */
  client: { id: string; name: string } | null;
};

export type TeamInvite = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  role: string;
  status: string;
  created_at: string;
  expires_at: string | null;
  delivery_method: InviteDelivery | null;
  delivery_client_name: string | null;
  delivered_at: string | null;
};

export const listTeam = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdminView(context as any);
    const sb = await admin();
    const [{ data: roleRows }, { data: owners }, { data: invites }] = await Promise.all([
      sb.from("user_roles").select("user_id, role, created_at").in("role", TEAM_ROLES),
      sb.from("business_owners").select("user_id"),
      sb.from("staff_invites").select("*").eq("status", "pending").order("created_at", { ascending: false }),
    ]);
    const byUser = new Map<string, { roles: string[]; since: string | null }>();
    for (const r of (roleRows ?? []) as any[]) {
      const cur = byUser.get(r.user_id) ?? { roles: [] as string[], since: (r.created_at as string | null) ?? null };
      cur.roles.push(r.role);
      if (r.created_at && (!cur.since || r.created_at < cur.since)) cur.since = r.created_at;
      byUser.set(r.user_id, cur);
    }
    const ids = [...byUser.keys()];
    const { data: profiles } = ids.length
      ? await sb.from("profiles").select("id, email, full_name").in("id", ids)
      : { data: [] as any[] };
    const ownerIds = new Set(((owners ?? []) as any[]).map((o) => o.user_id));
    // Logins linked to the person's client account (community_profiles.same_person_as).
    const { data: links } = ids.length
      ? await sb.from("community_profiles").select("user_id, same_person_as").in("user_id", ids).not("same_person_as", "is", null)
      : { data: [] as any[] };
    const linkedUids = ((links ?? []) as any[]).map((l) => l.same_person_as);
    const { data: linkedClients } = linkedUids.length
      ? await sb.from("clients").select("id, user_id, full_name, first_name").in("user_id", linkedUids)
      : { data: [] as any[] };
    const clientFor = (id: string) => {
      const uid = ((links ?? []) as any[]).find((l) => l.user_id === id)?.same_person_as;
      const c = uid ? ((linkedClients ?? []) as any[]).find((x) => x.user_id === uid) : null;
      return c ? { id: c.id as string, name: ((c.full_name || c.first_name || "Client") as string).trim() } : null;
    };
    const members: TeamMember[] = ids.map((id) => {
      const p = ((profiles ?? []) as any[]).find((x) => x.id === id);
      const v = byUser.get(id)!;
      return { user_id: id, name: p?.full_name ?? null, email: p?.email ?? null, roles: v.roles, owner: ownerIds.has(id), since: v.since, client: clientFor(id) };
    });

    const clientIds = [...new Set(((invites ?? []) as any[]).map((i) => i.delivery_client_id).filter(Boolean))];
    const { data: clients } = clientIds.length
      ? await sb.from("clients").select("id, full_name").in("id", clientIds)
      : { data: [] as any[] };
    const clientName = new Map(((clients ?? []) as any[]).map((c) => [c.id, c.full_name]));
    const pending: TeamInvite[] = ((invites ?? []) as any[]).map((i) => ({
      id: i.id,
      first_name: i.first_name,
      last_name: i.last_name,
      email: i.email,
      role: i.role,
      status: i.status,
      created_at: i.created_at,
      expires_at: i.setup_token_expires_at,
      delivery_method: i.delivery_method ?? null,
      delivery_client_name: i.delivery_client_id ? clientName.get(i.delivery_client_id) ?? null : null,
      delivered_at: i.delivered_at ?? null,
    }));
    return { members, invites: pending };
  });

/** Client accounts the admin can send the setup card to in Messenger. */
export const searchInviteRecipients = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ q: z.string().trim().min(1).max(100) }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const term = data.q.replace(/[%_,()]/g, " ").trim();
    if (!term) return { clients: [] };
    const { data: rows } = await context.supabase
      .from("clients")
      .select("id, full_name, email, user_id")
      .not("user_id", "is", null)
      .or(`full_name.ilike.%${term}%,email.ilike.%${term}%`)
      .order("full_name")
      .limit(8);
    return {
      clients: ((rows ?? []) as any[]).map((c) => ({ id: c.id as string, name: (c.full_name as string) ?? "", email: (c.email as string) ?? "" })),
    };
  });

const DeliveryInput = z.discriminatedUnion("method", [
  z.object({ method: z.literal("messenger"), clientId: z.string().uuid() }),
  z.object({ method: z.literal("sms"), phone: z.string().trim().min(7).max(30) }),
  z.object({ method: z.literal("link") }),
]);

const InviteInput = z.object({
  role: z.enum(INVITABLE_ROLES),
  first_name: z.string().trim().min(1).max(100),
  last_name: z.string().trim().max(100).default(""),
  email: z.string().trim().toLowerCase().email(),
  delivery: DeliveryInput,
});

async function deliver(
  context: any,
  invite: { id: string; email: string; first_name: string | null; role: string; setup_token: string; setup_token_expires_at: string; phone?: string | null },
  delivery: z.infer<typeof DeliveryInput>,
) {
  const { appOrigin, setupPath, sendInviteInMessenger, sendInviteSms } = await import("@/lib/staff-invites.server");
  const role = invite.role as (typeof INVITABLE_ROLES)[number];
  const link = `${appOrigin()}${setupPath(invite.setup_token)}`;
  let result: { sent: boolean; reason?: string } = { sent: false, reason: "link_only" };
  if (delivery.method === "messenger") {
    result = await sendInviteInMessenger({
      adminSupabase: context.supabase,
      adminUserId: context.userId,
      clientId: delivery.clientId,
      firstName: invite.first_name ?? "",
      role,
      email: invite.email,
      token: invite.setup_token,
      expiresAt: invite.setup_token_expires_at,
    });
  } else if (delivery.method === "sms") {
    result = await sendInviteSms({ toPhone: delivery.phone, firstName: invite.first_name, role, link });
  }
  const sb = await admin();
  await sb.from("staff_invites").update({
    delivery_method: delivery.method,
    delivery_client_id: delivery.method === "messenger" ? delivery.clientId : null,
    phone: delivery.method === "sms" ? delivery.phone : invite.phone ?? null,
    delivered_at: result.sent ? new Date().toISOString() : null,
  }).eq("id", invite.id);
  return { link, delivery: { method: delivery.method, ...result } };
}

export const inviteStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => InviteInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const sb = await admin();
    const { assertEmailFreeForStaffInvite } = await import("@/lib/setup-link-guard.server");
    // A brand-new staff login needs an email with no account of any kind.
    await assertEmailFreeForStaffInvite(sb, data.email);
    const { data: pendingSame } = await sb
      .from("staff_invites").select("id").eq("status", "pending").ilike("email", data.email).limit(1);
    if (pendingSame?.length) throw new Error("There's already a pending invite for that email. Resend or revoke it below.");
    if (data.delivery.method === "messenger") {
      const { data: c } = await sb.from("clients").select("id, user_id").eq("id", data.delivery.clientId).maybeSingle();
      if (!c?.user_id) throw new Error("That client has no app login to receive a Messenger message. Send by text or copy the link.");
    }

    const { genSetupToken } = await import("@/lib/staff-invites.server");
    const setup_token = genSetupToken();
    const setup_token_expires_at = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 3600 * 1000).toISOString();
    const { data: row, error } = await sb.from("staff_invites").insert({
      email: data.email,
      first_name: data.first_name,
      last_name: data.last_name || null,
      role: data.role,
      setup_token,
      setup_token_expires_at,
      created_by: context.userId,
    }).select("*").single();
    if (error) throw new Error(error.message);
    return deliver(context, row, data.delivery);
  });

export const resendStaffInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ inviteId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const sb = await admin();
    const { data: inv } = await sb.from("staff_invites").select("*").eq("id", data.inviteId).maybeSingle();
    if (!inv || inv.status !== "pending") throw new Error("That invite isn't pending anymore.");
    if (!isInvitableRole(inv.role)) throw new Error("That role can't be invited anymore. Revoke this invite.");
    const { genSetupToken } = await import("@/lib/staff-invites.server");
    const setup_token = genSetupToken();
    const setup_token_expires_at = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 3600 * 1000).toISOString();
    const { data: row, error } = await sb.from("staff_invites")
      .update({ setup_token, setup_token_expires_at }).eq("id", inv.id).select("*").single();
    if (error) throw new Error(error.message);
    const delivery =
      row.delivery_method === "messenger" && row.delivery_client_id ? { method: "messenger" as const, clientId: row.delivery_client_id as string }
      : row.delivery_method === "sms" && row.phone ? { method: "sms" as const, phone: row.phone as string }
      : { method: "link" as const };
    return deliver(context, row, delivery);
  });

/** The current setup link for a pending invite (no new token, nothing sent). */
export const getStaffInviteLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ inviteId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const sb = await admin();
    const { data: inv } = await sb.from("staff_invites").select("status, setup_token").eq("id", data.inviteId).maybeSingle();
    if (!inv || inv.status !== "pending" || !inv.setup_token) throw new Error("That invite isn't pending anymore.");
    const { appOrigin, setupPath } = await import("@/lib/staff-invites.server");
    return { link: `${appOrigin()}${setupPath(inv.setup_token)}` };
  });

export const revokeStaffInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ inviteId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const sb = await admin();
    const { error } = await sb.from("staff_invites")
      .update({ status: "revoked", setup_token: null }).eq("id", data.inviteId).eq("status", "pending");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Take a finance or media manager role away. Admin and coach are managed elsewhere. */
export const removeStaffRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ userId: z.string().uuid(), role: z.enum(["finance", "media_manager"]) }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.userId === context.userId) throw new Error("You can't remove your own access.");
    const sb = await admin();
    const { error } = await sb.from("user_roles").delete().eq("user_id", data.userId).eq("role", data.role);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Link a team member's login to their own client account (or unlink it), so
 * their staff home shows their sessions and their calendar subscription
 * carries them. The link is community_profiles.same_person_as, the same
 * "same person" link the community already follows.
 */
export const linkTeamMemberClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ userId: z.string().uuid(), clientId: z.string().uuid().nullable() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const sb = await admin();
    const { data: roles } = await sb.from("user_roles").select("role").eq("user_id", data.userId).in("role", TEAM_ROLES);
    if (!roles?.length) throw new Error("Not a team member.");
    if (!data.clientId) {
      const { error } = await sb.from("community_profiles").update({ same_person_as: null, updated_at: new Date().toISOString() }).eq("user_id", data.userId);
      if (error) throw new Error(error.message);
      return { ok: true };
    }
    const { data: client } = await sb.from("clients").select("user_id").eq("id", data.clientId).maybeSingle();
    if (!client?.user_id) throw new Error("That client hasn't set up their login yet.");
    if (client.user_id === data.userId) throw new Error("That's already this login's own client account.");
    // One hop only: the client account must be the person's main account.
    const { data: main } = await sb.from("community_profiles").select("same_person_as").eq("user_id", client.user_id).maybeSingle();
    if (main?.same_person_as) throw new Error("That client account is itself linked to another login.");
    const { error } = await sb.from("community_profiles").upsert(
      { user_id: data.userId, same_person_as: client.user_id, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---------- Public: the setup link ---------- */

const TokenInput = z.object({ token: z.string().min(20).max(128) });

/** What the setup page shows before anyone types a password. */
export const getStaffInvitePreview = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => TokenInput.parse(i))
  .handler(async ({ data }) => {
    const sb = await admin();
    const { data: inv } = await sb
      .from("staff_invites").select("first_name, email, role, status, setup_token_expires_at")
      .eq("setup_token", data.token).maybeSingle();
    if (!inv) return { valid: false as const, reason: "This setup link isn't valid anymore. Ask for a new one." };
    if (inv.status !== "pending") return { valid: false as const, reason: "This invite was already used or revoked." };
    if (inv.setup_token_expires_at && Date.parse(inv.setup_token_expires_at) < Date.now()) {
      return { valid: false as const, reason: "This setup link expired. Ask for a new one." };
    }
    const info = STAFF_ROLE_INFO[inv.role as keyof typeof STAFF_ROLE_INFO];
    return {
      valid: true as const,
      firstName: (inv.first_name as string | null) ?? null,
      email: inv.email as string,
      role: inv.role as string,
      roleLabel: info?.label ?? "Staff",
      welcome: info?.welcome ?? null,
      requiresAuthenticator: !!info?.requiresAuthenticator,
    };
  });

const RedeemInput = z.object({
  token: z.string().min(20).max(128),
  password: z.string().min(8).max(72),
});

export const redeemStaffInvite = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => RedeemInput.parse(i))
  .handler(async ({ data }) => {
    const sb = await admin();
    const { assertInviteRoleRedeemable, assertEmailFreeForStaffInvite, finalizeStaffOnlyUser } =
      await import("@/lib/setup-link-guard.server");
    const { data: invite, error } = await sb
      .from("staff_invites").select("*").eq("setup_token", data.token).maybeSingle();
    if (error || !invite) throw new Error("This setup link isn't valid anymore. Ask for a new one.");
    assertInviteRoleRedeemable(invite.role);
    if (invite.status !== "pending") throw new Error("This invite was already used or revoked.");
    if (invite.setup_token_expires_at && new Date(invite.setup_token_expires_at) < new Date()) {
      throw new Error("This setup link expired. Ask for a new one.");
    }

    // Staff accounts are separate from personal ones: an invite always
    // creates a brand-new staff-only login, never reuses an existing one.
    await assertEmailFreeForStaffInvite(sb, invite.email);
    const { data: created, error: cErr } = await sb.auth.admin.createUser({
      email: invite.email, password: data.password, email_confirm: true,
      app_metadata: { account_kind: "staff" },
      user_metadata: { full_name: `${invite.first_name ?? ""} ${invite.last_name ?? ""}`.trim() },
    });
    if (cErr) throw new Error(cErr.message);
    await finalizeStaffOnlyUser(sb, created.user.id, invite.role);

    await sb.from("staff_invites").update({
      status: "redeemed", redeemed_user_id: created.user.id, redeemed_at: new Date().toISOString(),
      setup_token: null,
    }).eq("id", invite.id);

    return { ok: true, email: invite.email as string, role: invite.role as string };
  });
