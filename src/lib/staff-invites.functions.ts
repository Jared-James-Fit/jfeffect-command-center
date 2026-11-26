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
      sb.from("staff_invites").select("*").eq("status", "pending").neq("role", "specialist").order("created_at", { ascending: false }),
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
  invite: { id: string; email: string; first_name: string | null; role: string; setup_token_expires_at: string; phone?: string | null },
  token: string,
  delivery: z.infer<typeof DeliveryInput>,
) {
  const { appOrigin, setupPath, sendInviteInMessenger, sendInviteSms } = await import("@/lib/staff-invites.server");
  const role = invite.role as (typeof INVITABLE_ROLES)[number];
  const link = `${appOrigin()}${setupPath(token)}`;
  let result: { sent: boolean; reason?: string } = { sent: false, reason: "link_only" };
  if (delivery.method === "messenger") {
    result = await sendInviteInMessenger({
      adminSupabase: context.supabase,
      adminUserId: context.userId,
      clientId: delivery.clientId,
      firstName: invite.first_name ?? "",
      role,
      email: invite.email,
      token,
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

    const { genSetupToken, hashSetupToken } = await import("@/lib/staff-invites.server");
    const token = genSetupToken();
    const setup_token_expires_at = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 3600 * 1000).toISOString();
    const { data: row, error } = await sb.from("staff_invites").insert({
      email: data.email,
      first_name: data.first_name,
      last_name: data.last_name || null,
      role: data.role,
      setup_token_hash: hashSetupToken(token),
      setup_token_expires_at,
      created_by: context.userId,
    }).select("*").single();
    if (error) throw new Error(error.message);
    return deliver(context, row, token, data.delivery);
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
    const { genSetupToken, hashSetupToken } = await import("@/lib/staff-invites.server");
    const token = genSetupToken();
    const setup_token_expires_at = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 3600 * 1000).toISOString();
    const { data: row, error } = await sb.from("staff_invites")
      .update({ setup_token: null, setup_token_hash: hashSetupToken(token), setup_token_expires_at, code_hash: null, code_attempts: 0 })
      .eq("id", inv.id).select("*").single();
    if (error) throw new Error(error.message);
    const delivery =
      row.delivery_method === "messenger" && row.delivery_client_id ? { method: "messenger" as const, clientId: row.delivery_client_id as string }
      : row.delivery_method === "sms" && row.phone ? { method: "sms" as const, phone: row.phone as string }
      : { method: "link" as const };
    return deliver(context, row, token, delivery);
  });

/**
 * A fresh setup link for a pending invite, to copy. Only a link's hash is
 * kept, so the old one can't be shown again: this makes a new one and the
 * old one stops working. Nothing is sent.
 */
export const getStaffInviteLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ inviteId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const sb = await admin();
    const { data: inv } = await sb.from("staff_invites").select("status, role").eq("id", data.inviteId).maybeSingle();
    if (!inv || inv.status !== "pending") throw new Error("That invite isn't pending anymore.");
    const { appOrigin, setupPath, genSetupToken, hashSetupToken } = await import("@/lib/staff-invites.server");
    const token = genSetupToken();
    const { error } = await sb.from("staff_invites").update({
      setup_token: null,
      setup_token_hash: hashSetupToken(token),
      setup_token_expires_at: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 3600 * 1000).toISOString(),
    }).eq("id", data.inviteId).eq("status", "pending");
    if (error) throw new Error(error.message);
    return { link: `${appOrigin()}${setupPath(token)}` };
  });

export const revokeStaffInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ inviteId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const sb = await admin();
    const { error } = await sb.from("staff_invites")
      .update({ status: "revoked", setup_token: null, setup_token_hash: null, code_hash: null })
      .eq("id", data.inviteId).in("status", ["pending", "draft"]);
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

const TokenInput = z.object({ token: z.string().min(20).max(128), proof: z.string().max(80).optional() });

/** The invite a link names: by its hash (a link from before hashing by its token). */
async function inviteForToken(sb: any, token: string): Promise<any | null> {
  const { hashSetupToken } = await import("@/lib/staff-invites.server");
  const { data: byHash } = await sb.from("staff_invites").select("*").eq("setup_token_hash", hashSetupToken(token)).maybeSingle();
  if (byHash) return byHash;
  const { data: legacy } = await sb.from("staff_invites").select("*").eq("setup_token", token).maybeSingle();
  return legacy ?? null;
}

function linkProblem(inv: any): string | null {
  if (!inv) return "This setup link isn't valid anymore. Ask for a new one.";
  if (inv.status !== "pending" || !inv.email) return "This invite was already used or revoked.";
  if (inv.setup_token_expires_at && Date.parse(inv.setup_token_expires_at) < Date.now()) {
    return "This setup link expired. Ask for a new one.";
  }
  return null;
}

/** What the setup page shows before anyone types anything. The email shows in full only once it's proven theirs. */
export const getStaffInvitePreview = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => TokenInput.parse(i))
  .handler(async ({ data }) => {
    const sb = await admin();
    const inv = await inviteForToken(sb, data.token);
    const problem = linkProblem(inv);
    if (problem) return { valid: false as const, reason: problem };
    const { inviteProofOk, maskInviteEmail, inviteRoleLabel } = await import("@/lib/staff-invites.server");
    const proven = inviteProofOk(inv.id, inv.email, data.proof);
    const info = STAFF_ROLE_INFO[inv.role as keyof typeof STAFF_ROLE_INFO];
    return {
      valid: true as const,
      firstName: (inv.first_name as string | null) ?? null,
      email: proven ? (inv.email as string) : null,
      emailHint: maskInviteEmail(inv.email as string),
      proven,
      role: inv.role as string,
      roleLabel: inviteRoleLabel(inv.role, inv.title),
      welcome:
        inv.role === "specialist"
          ? "It's view-only: footage, training and performance for the athletes you're given. Nothing you do changes anyone's training."
          : info?.welcome ?? null,
    };
  });

/** Email a 6-digit code to the invite's email (a texted or copied link). */
export const sendStaffInviteCode = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => TokenInput.parse(i))
  .handler(async ({ data }) => {
    const sb = await admin();
    const inv = await inviteForToken(sb, data.token);
    const problem = linkProblem(inv);
    if (problem) throw new Error(problem);
    const m = await import("@/lib/staff-invites.server");
    if (inv.code_sent_at && Date.now() - Date.parse(inv.code_sent_at) < m.INVITE_CODE_RESEND_SECONDS * 1000) {
      return { sentTo: m.maskInviteEmail(inv.email), waitSeconds: m.INVITE_CODE_RESEND_SECONDS };
    }
    const code = m.newInviteCode();
    const { error } = await sb.from("staff_invites").update({
      code_hash: m.inviteCodeHash(inv.id, code),
      code_expires_at: new Date(Date.now() + m.INVITE_CODE_MINUTES * 60_000).toISOString(),
      code_attempts: 0,
      code_sent_at: new Date().toISOString(),
    }).eq("id", inv.id);
    if (error) throw new Error("Couldn't send the code. Try again.");
    const { sendTemplateEmail } = await import("@/lib/transactional-email.server");
    const sent = await sendTemplateEmail(sb, {
      template: "team-code",
      to: inv.email,
      data: { first_name: inv.first_name ?? "", code },
      sensitive: true,
    });
    if (!sent.sent) throw new Error("Couldn't email the code. Try again in a minute.");
    return { sentTo: m.maskInviteEmail(inv.email), waitSeconds: m.INVITE_CODE_RESEND_SECONDS };
  });

/** The code from the email: proves the inbox is theirs. Returns the proof the emailed link carries. */
export const verifyStaffInviteCode = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    TokenInput.extend({ code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code from the email.") }).parse(i),
  )
  .handler(async ({ data }) => {
    const sb = await admin();
    const inv = await inviteForToken(sb, data.token);
    const problem = linkProblem(inv);
    if (problem) throw new Error(problem);
    const m = await import("@/lib/staff-invites.server");
    if (!inv.code_hash || !inv.code_expires_at || Date.parse(inv.code_expires_at) < Date.now()) {
      throw new Error("That code has expired. Tap Send a new code.");
    }
    if ((inv.code_attempts ?? 0) >= m.INVITE_CODE_MAX_ATTEMPTS) throw new Error("Too many tries. Tap Send a new code.");
    if (m.inviteCodeHash(inv.id, data.code) !== inv.code_hash) {
      await sb.from("staff_invites").update({ code_attempts: (inv.code_attempts ?? 0) + 1 }).eq("id", inv.id);
      throw new Error("That code didn't work. Check it, or tap Send a new code.");
    }
    await sb.from("staff_invites").update({ code_hash: null, code_expires_at: null, code_attempts: 0 }).eq("id", inv.id);
    return { proof: m.inviteEmailProof(inv.id, inv.email), email: inv.email as string };
  });

const RedeemInput = z.object({
  token: z.string().min(20).max(128),
  password: z.string().min(8).max(72),
  /** from the emailed link or the code: the email is theirs */
  proof: z.string().max(80).optional(),
});

export const redeemStaffInvite = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => RedeemInput.parse(i))
  .handler(async ({ data }) => {
    const sb = await admin();
    const { assertInviteRoleRedeemable, assertEmailFreeForStaffInvite, finalizeStaffOnlyUser } =
      await import("@/lib/setup-link-guard.server");
    const invite = await inviteForToken(sb, data.token);
    const problem = linkProblem(invite);
    if (problem) throw new Error(problem);
    assertInviteRoleRedeemable(invite.role);
    const { inviteProofOk } = await import("@/lib/staff-invites.server");
    // nobody gets a login on an email they haven't shown is theirs
    if (!inviteProofOk(invite.id, invite.email, data.proof)) {
      throw new Error("Confirm your email first: enter the code we sent you.");
    }
    // claim the invite first, so a second tap can't make a second login
    const { data: claimed } = await sb.from("staff_invites")
      .update({ status: "redeemed", redeemed_at: new Date().toISOString(), setup_token: null, setup_token_hash: null, code_hash: null })
      .eq("id", invite.id).eq("status", "pending").select("id");
    if (!claimed?.length) throw new Error("This invite was already used or revoked.");

    let uid: string | null = null;
    try {
      // Staff accounts are separate from personal ones: an invite always
      // creates a brand-new staff-only login, never reuses an existing one.
      await assertEmailFreeForStaffInvite(sb, invite.email);
      const { data: created, error: cErr } = await sb.auth.admin.createUser({
        email: invite.email, password: data.password, email_confirm: true,
        app_metadata: { account_kind: "staff" },
        user_metadata: { full_name: `${invite.first_name ?? ""} ${invite.last_name ?? ""}`.trim() },
      });
      if (cErr) throw new Error(cErr.message);
      uid = created.user.id as string;
      if (invite.role === "specialist") {
        // the specialist record and their athletes first, then the role that makes them count
        const { cleanAccess } = await import("@/lib/team-access/presets");
        const { error: sErr } = await sb.from("team_specialists").insert({
          user_id: uid,
          preset: invite.preset,
          title: invite.title,
          display_name: invite.first_name ?? null,
          invite_id: invite.id,
          invited_by: invite.created_by ?? null,
        });
        if (sErr) throw new Error(sErr.message);
        const access = cleanAccess(invite.access);
        if (access.length) {
          const { error: aErr } = await sb.from("specialist_access").insert(
            access.map((a) => ({ ...a, specialist_user_id: uid, granted_by: invite.created_by ?? null })),
          );
          if (aErr) throw new Error(aErr.message);
        }
      }
      await finalizeStaffOnlyUser(sb, uid, invite.role);
      await sb.from("staff_invites").update({ redeemed_user_id: uid }).eq("id", invite.id);
    } catch (e) {
      // undo the half-made login and put the invite back so the link works again
      if (uid) await sb.auth.admin.deleteUser(uid).catch(() => undefined);
      await sb.from("staff_invites").update({ status: "pending", redeemed_at: null }).eq("id", invite.id).eq("status", "redeemed");
      throw e;
    }
    return { ok: true, email: invite.email as string, role: invite.role as string };
  });
