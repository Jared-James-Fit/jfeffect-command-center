/**
 * The Team page's specialists (game day coaches, performance specialists):
 * invites, which athletes each one sees and in which categories, suspend,
 * reactivate, remove, and footage kept from them. The organization's owner
 * or an admin only (is_org_admin, with their two-step sign-in), checked with
 * the caller's own login before the service role writes anything.
 *
 * An invite waits as a draft until it has an email. Sending one emails the
 * setup link (which proves the email is theirs), texts it, or hands back a
 * link to copy (the invitee then confirms their email with a code). Access
 * only starts once the login exists and, for any athlete but the owner's own
 * athlete account, once that athlete agrees in their app.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { INVITE_TTL_DAYS } from "@/lib/staff-roles";
import type { CategoryFlags, SpecialistPreset } from "@/lib/team-access/presets";

const Uuid = z.string().uuid();
const Flags = z.object({ footage: z.boolean(), training: z.boolean(), performance: z.boolean() });
const AccessInput = z.array(Flags.extend({ client_id: Uuid })).max(25);
const PresetInput = z.enum(["game_day_coach", "performance_specialist"]);

async function assertOrgAdmin(ctx: any): Promise<void> {
  const { data, error } = await ctx.supabase.rpc("is_org_admin", {
    _org: "f0f0f0f0-0000-4000-8000-000000000001",
  });
  if (error || data !== true) throw new Error("Only the owner or an admin manages the team.");
}

async function db(): Promise<any> {
  const { serviceDb } = await import("@/lib/team-access/access.server");
  return serviceDb();
}

export type SpecialistAccessRow = {
  id: string;
  clientId: string;
  athleteName: string;
  athleteHasLogin: boolean;
  status: "active" | "revoked";
  /** the athlete agreed (or it's the owner's own athlete account) */
  agreed: boolean;
  agreedBy: "athlete" | "self" | null;
  withdrawn: boolean;
} & CategoryFlags;

export type TeamSpecialist = {
  userId: string;
  email: string | null;
  name: string;
  title: string;
  preset: SpecialistPreset;
  status: "active" | "suspended" | "removed";
  phone: string | null;
  timeZone: string | null;
  headshotUrl: string | null;
  profileComplete: boolean;
  joinedAt: string;
  access: SpecialistAccessRow[];
};

export type SpecialistInvite = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  title: string;
  preset: SpecialistPreset;
  status: "draft" | "pending";
  expiresAt: string | null;
  deliveryMethod: string | null;
  deliveredAt: string | null;
  access: Array<{ clientId: string; athleteName: string } & CategoryFlags>;
};

async function athleteNames(
  sb: any,
  ids: string[],
): Promise<Map<string, { name: string; hasLogin: boolean }>> {
  const out = new Map<string, { name: string; hasLogin: boolean }>();
  if (!ids.length) return out;
  const { data } = await sb
    .from("clients")
    .select("id, full_name, first_name, user_id")
    .in("id", [...new Set(ids)]);
  for (const c of (data ?? []) as any[]) {
    out.set(c.id, {
      name: (c.full_name || c.first_name || "Athlete").trim(),
      hasLogin: !!c.user_id,
    });
  }
  return out;
}

export const listSpecialists = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({
      context,
    }): Promise<{ specialists: TeamSpecialist[]; invites: SpecialistInvite[] }> => {
      await assertOrgAdmin(context);
      const sb = await db();
      const [{ data: specs }, { data: invites }, { data: roles }] = await Promise.all([
        sb.from("team_specialists").select("*").order("created_at", { ascending: true }),
        sb
          .from("staff_invites")
          .select("*")
          .eq("role", "specialist")
          .in("status", ["draft", "pending"])
          .order("created_at", { ascending: false }),
        sb.from("user_roles").select("user_id").eq("role", "specialist"),
      ]);
      const withRole = new Set(((roles ?? []) as any[]).map((r) => r.user_id));
      const uids = ((specs ?? []) as any[]).map((s) => s.user_id);
      const { data: access } = uids.length
        ? await sb.from("specialist_access").select("*").in("specialist_user_id", uids)
        : { data: [] as any[] };
      const { data: profiles } = uids.length
        ? await sb.from("profiles").select("id, email, full_name").in("id", uids)
        : { data: [] as any[] };
      const clientIds = [
        ...((access ?? []) as any[]).map((a) => a.client_id),
        ...((invites ?? []) as any[]).flatMap((i) =>
          Array.isArray(i.access) ? i.access.map((a: any) => a.client_id) : [],
        ),
      ];
      const names = await athleteNames(sb, clientIds);
      const heads = ((specs ?? []) as any[]).map((s) => s.headshot_path).filter(Boolean);
      const signed = new Map<string, string>();
      if (heads.length) {
        const { data: urls } = await sb.storage.from("avatars").createSignedUrls(heads, 3600);
        for (const u of (urls ?? []) as any[])
          if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl);
      }
      const specialists: TeamSpecialist[] = ((specs ?? []) as any[]).map((s) => {
        const p = ((profiles ?? []) as any[]).find((x) => x.id === s.user_id);
        const mine = ((access ?? []) as any[]).filter((a) => a.specialist_user_id === s.user_id);
        return {
          userId: s.user_id,
          email: p?.email ?? null,
          name: (s.display_name || p?.full_name || p?.email || "Specialist").trim(),
          title: s.title,
          preset: s.preset,
          status: withRole.has(s.user_id) ? s.status : "removed",
          phone: s.phone,
          timeZone: s.time_zone,
          headshotUrl: s.headshot_path ? (signed.get(s.headshot_path) ?? null) : null,
          profileComplete: !!s.profile_completed_at && !!s.confidentiality_at,
          joinedAt: s.created_at,
          access: mine.map((a) => ({
            id: a.id,
            clientId: a.client_id,
            athleteName: names.get(a.client_id)?.name ?? "Athlete",
            athleteHasLogin: names.get(a.client_id)?.hasLogin ?? false,
            status: a.status,
            agreed: !!a.athlete_ok_at,
            agreedBy: a.athlete_ok_by ?? null,
            withdrawn: !!a.athlete_withdrew_at,
            footage: a.footage,
            training: a.training,
            performance: a.performance,
          })),
        };
      });
      const pending: SpecialistInvite[] = ((invites ?? []) as any[]).map((i) => ({
        id: i.id,
        firstName: i.first_name,
        lastName: i.last_name,
        email: i.email,
        title: i.title ?? "Specialist",
        preset: i.preset,
        status: i.status,
        expiresAt: i.status === "pending" ? i.setup_token_expires_at : null,
        deliveryMethod: i.delivery_method ?? null,
        deliveredAt: i.delivered_at ?? null,
        access: (Array.isArray(i.access) ? i.access : []).map((a: any) => ({
          clientId: a.client_id,
          athleteName: names.get(a.client_id)?.name ?? "Athlete",
          footage: a.footage !== false,
          training: a.training !== false,
          performance: a.performance !== false,
        })),
      }));
      return { specialists, invites: pending };
    },
  );

/** Athletes with an app login, to give a specialist (by name or email). */
export const searchSpecialistAthletes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ q: z.string().trim().max(100) }).parse(i))
  .handler(async ({ data, context }) => {
    await assertOrgAdmin(context);
    const sb = await db();
    const term = data.q.replace(/[%_,()]/g, " ").trim();
    let q = sb
      .from("clients")
      .select("id, full_name, email, user_id, archived, status")
      .not("user_id", "is", null)
      .eq("archived", false)
      .order("full_name")
      .limit(10);
    if (term) q = q.or(`full_name.ilike.%${term}%,email.ilike.%${term}%`);
    const { data: rows } = await q;
    // the owner's own athlete account first: the usual first athlete for a specialist
    const { data: me } = await sb
      .from("community_profiles")
      .select("same_person_as")
      .eq("user_id", (context as any).userId)
      .maybeSingle();
    return {
      athletes: ((rows ?? []) as any[])
        .filter((c) => !["Deactivated", "Deleted"].includes(String(c.status ?? "")))
        .map((c) => ({
          id: c.id as string,
          name: (c.full_name as string) ?? "Athlete",
          email: (c.email as string) ?? "",
          yours: !!me?.same_person_as && c.user_id === me.same_person_as,
        }))
        .sort((a, b) => Number(b.yours) - Number(a.yours)),
    };
  });

const InviteSave = z.object({
  id: Uuid.optional(),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().max(100).default(""),
  /** empty keeps it a draft */
  email: z.union([z.string().trim().toLowerCase().email(), z.literal("")]).default(""),
  preset: PresetInput,
  title: z.string().trim().min(1).max(60),
  access: AccessInput,
});

/** Create or change a specialist invite. It stays a draft until it's sent. */
export const saveSpecialistInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => InviteSave.parse(i))
  .handler(async ({ data, context }) => {
    const ctx = context as any;
    await assertOrgAdmin(ctx);
    const sb = await db();
    const { cleanAccess } = await import("@/lib/team-access/presets");
    const access = cleanAccess(data.access);
    if (data.email) {
      const { assertEmailFreeForStaffInvite } = await import("@/lib/setup-link-guard.server");
      await assertEmailFreeForStaffInvite(sb, data.email);
      const { data: same } = await sb
        .from("staff_invites")
        .select("id")
        .in("status", ["draft", "pending"])
        .ilike("email", data.email)
        .neq("id", data.id ?? "00000000-0000-0000-0000-000000000000")
        .limit(1);
      if (same?.length) throw new Error("There's already an invite for that email.");
    }
    const row = {
      first_name: data.firstName,
      last_name: data.lastName || null,
      email: data.email || null,
      role: "specialist",
      preset: data.preset,
      title: data.title,
      access,
    };
    if (data.id) {
      const { data: cur } = await sb
        .from("staff_invites")
        .select("status, role, email")
        .eq("id", data.id)
        .maybeSingle();
      if (!cur || cur.role !== "specialist" || !["draft", "pending"].includes(cur.status))
        throw new Error("That invite can't be changed anymore.");
      // a pending invite with a new email must be sent again (the link names the old one)
      const patch: Record<string, unknown> = { ...row };
      if (cur.status === "pending" && (cur.email ?? "") !== (data.email ?? "")) {
        Object.assign(patch, {
          status: "draft",
          setup_token_hash: null,
          setup_token: null,
          code_hash: null,
          delivered_at: null,
        });
      }
      if (!data.email)
        Object.assign(patch, { status: "draft", setup_token_hash: null, setup_token: null });
      const { error } = await sb.from("staff_invites").update(patch).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: created, error } = await sb
      .from("staff_invites")
      .insert({ ...row, status: "draft", created_by: ctx.userId })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: created.id as string };
  });

const SendInput = z.object({
  inviteId: Uuid,
  method: z.enum(["email", "sms", "link"]),
  phone: z.string().trim().min(7).max(30).optional(),
});

/**
 * Send a specialist invite (or send it again): a new link every time, the old
 * one stops working. Email carries the proof the address is theirs; a texted
 * or copied link asks them for a code first.
 */
export const sendSpecialistInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => SendInput.parse(i))
  .handler(async ({ data, context }) => {
    const ctx = context as any;
    await assertOrgAdmin(ctx);
    const sb = await db();
    const { data: inv } = await sb
      .from("staff_invites")
      .select("*")
      .eq("id", data.inviteId)
      .maybeSingle();
    if (!inv || inv.role !== "specialist" || !["draft", "pending"].includes(inv.status))
      throw new Error("That invite can't be sent anymore.");
    if (!inv.email) throw new Error("Add their email first. It's the email they'll sign in with.");
    const { cleanAccess } = await import("@/lib/team-access/presets");
    if (!cleanAccess(inv.access).length) throw new Error("Give them at least one athlete first.");
    const m = await import("@/lib/staff-invites.server");
    const token = m.genSetupToken();
    const expires = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000).toISOString();
    const { error } = await sb
      .from("staff_invites")
      .update({
        status: "pending",
        setup_token: null,
        setup_token_hash: m.hashSetupToken(token),
        setup_token_expires_at: expires,
        code_hash: null,
        code_attempts: 0,
        delivery_method: data.method === "email" ? "link" : data.method,
        phone: data.method === "sms" ? (data.phone ?? null) : (inv.phone ?? null),
        delivered_at: null,
      })
      .eq("id", inv.id);
    if (error) throw new Error(error.message);
    const link = `${m.appOrigin()}${m.setupPath(token)}`;
    let sent = false;
    let reason: string | undefined;
    if (data.method === "email") {
      const names = await athleteNames(
        sb,
        cleanAccess(inv.access).map((a) => a.client_id),
      );
      const first = [...names.values()][0]?.name.split(" ")[0];
      const { sendTemplateEmail } = await import("@/lib/transactional-email.server");
      const r = await sendTemplateEmail(sb, {
        template: "team-invite",
        to: inv.email,
        // the emailed link carries the proof: opening it shows the inbox is theirs
        data: {
          first_name: inv.first_name ?? "",
          title: inv.title,
          athlete: names.size === 1 ? first : undefined,
          setup_url: `${link}&p=${m.inviteEmailProof(inv.id, inv.email)}`,
          days: INVITE_TTL_DAYS,
        },
        sensitive: true,
      });
      sent = r.sent;
      reason = r.sent ? undefined : (r as any).reason;
    } else if (data.method === "sms") {
      const r = await m.sendInviteSms({
        toPhone: data.phone,
        firstName: inv.first_name,
        role: "specialist",
        title: inv.title,
        link,
      });
      sent = r.sent;
      reason = r.reason;
    }
    if (sent)
      await sb
        .from("staff_invites")
        .update({ delivered_at: new Date().toISOString() })
        .eq("id", inv.id);
    return { link: data.method === "link" ? link : null, sent, reason: reason ?? null };
  });

export const revokeSpecialistInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ inviteId: Uuid }).parse(i))
  .handler(async ({ data, context }) => {
    await assertOrgAdmin(context);
    const sb = await db();
    const { error } = await sb
      .from("staff_invites")
      .update({ status: "revoked", setup_token: null, setup_token_hash: null, code_hash: null })
      .eq("id", data.inviteId)
      .eq("role", "specialist")
      .in("status", ["draft", "pending"]);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Which athletes a specialist sees, and what of each. Athletes left out lose access at once. */
export const setSpecialistAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ userId: Uuid, access: AccessInput }).parse(i))
  .handler(async ({ data, context }) => {
    const ctx = context as any;
    await assertOrgAdmin(ctx);
    const sb = await db();
    const { data: spec } = await sb
      .from("team_specialists")
      .select("user_id")
      .eq("user_id", data.userId)
      .maybeSingle();
    if (!spec) throw new Error("That isn't a specialist.");
    const { cleanAccess } = await import("@/lib/team-access/presets");
    const want = cleanAccess(data.access);
    const { data: cur } = await sb
      .from("specialist_access")
      .select("id, client_id, status")
      .eq("specialist_user_id", data.userId);
    const keep = new Set(want.map((w) => w.client_id));
    for (const row of (cur ?? []) as any[]) {
      if (!keep.has(row.client_id) && row.status === "active") {
        await sb.from("specialist_access").update({ status: "revoked" }).eq("id", row.id);
      }
    }
    for (const w of want) {
      const existing = ((cur ?? []) as any[]).find((r) => r.client_id === w.client_id);
      if (existing) {
        const { error } = await sb
          .from("specialist_access")
          .update({
            footage: w.footage,
            training: w.training,
            performance: w.performance,
            status: "active",
            granted_by: existing.status === "active" ? undefined : ctx.userId,
          })
          .eq("id", existing.id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await sb
          .from("specialist_access")
          .insert({ ...w, specialist_user_id: data.userId, granted_by: ctx.userId });
        if (error) throw new Error(error.message);
      }
    }
    return { ok: true };
  });

/** Suspend (keeps everything, sees nothing) or reactivate. */
export const setSpecialistStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ userId: Uuid, status: z.enum(["active", "suspended"]) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertOrgAdmin(context);
    const sb = await db();
    const { error } = await sb
      .from("team_specialists")
      .update({ status: data.status })
      .eq("user_id", data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Rename the role ("Game Day Coach" → "Meet Handler") or change its kind. */
export const setSpecialistTitle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({ userId: Uuid, title: z.string().trim().min(1).max(60), preset: PresetInput })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertOrgAdmin(context);
    const sb = await db();
    const { error } = await sb
      .from("team_specialists")
      .update({ title: data.title, preset: data.preset })
      .eq("user_id", data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Remove a specialist: their login loses the role (and with it the team
 * membership) and every athlete at once. The record and the access history
 * stay; their own notes stay theirs.
 */
export const removeSpecialist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ userId: Uuid }).parse(i))
  .handler(async ({ data, context }) => {
    const ctx = context as any;
    await assertOrgAdmin(ctx);
    if (data.userId === ctx.userId) throw new Error("You can't remove your own access.");
    const sb = await db();
    await sb
      .from("specialist_access")
      .update({ status: "revoked" })
      .eq("specialist_user_id", data.userId)
      .eq("status", "active");
    await sb.from("team_specialists").update({ status: "suspended" }).eq("user_id", data.userId);
    const { error } = await sb
      .from("user_roles")
      .delete()
      .eq("user_id", data.userId)
      .eq("role", "specialist");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** An athlete's set videos with whether specialists may see each one. */
export const listFootageVisibility = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ clientId: Uuid }).parse(i))
  .handler(async ({ data, context }) => {
    await assertOrgAdmin(context);
    const sb = await db();
    const [{ data: vids }, { data: hidden }] = await Promise.all([
      sb
        .from("pl_set_videos")
        .select("id, created_at, exercise_name, label, set_index, warmup_id")
        .eq("client_id", data.clientId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(300),
      sb.from("specialist_hidden_videos").select("set_video_id").eq("client_id", data.clientId),
    ]);
    const off = new Set(((hidden ?? []) as any[]).map((h) => h.set_video_id));
    return {
      videos: ((vids ?? []) as any[]).map((v) => ({
        id: v.id as string,
        day: String(v.created_at).slice(0, 10),
        exercise: (v.exercise_name as string) || "Exercise",
        set: v.warmup_id || v.set_index === 0 ? "Warm-up" : `Set ${v.set_index ?? 1}`,
        hidden: off.has(v.id),
      })),
    };
  });

export const setFootageHidden = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ videoId: Uuid, hidden: z.boolean() }).parse(i))
  .handler(async ({ data, context }) => {
    const ctx = context as any;
    await assertOrgAdmin(ctx);
    const sb = await db();
    if (data.hidden) {
      const { data: v } = await sb
        .from("pl_set_videos")
        .select("client_id")
        .eq("id", data.videoId)
        .maybeSingle();
      if (!v) throw new Error("That clip is gone.");
      const { error } = await sb
        .from("specialist_hidden_videos")
        .upsert(
          { set_video_id: data.videoId, client_id: v.client_id, hidden_by: ctx.userId },
          { onConflict: "set_video_id" },
        );
      if (error) throw new Error(error.message);
    } else {
      await sb.from("specialist_hidden_videos").delete().eq("set_video_id", data.videoId);
    }
    return { ok: true };
  });
