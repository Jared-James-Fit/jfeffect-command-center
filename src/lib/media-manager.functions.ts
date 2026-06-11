import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function genToken(len = 32) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function assertAdmin(ctx: any) {
  const { supabase, userId } = ctx;
  const { data } = await supabase
    .from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
  if (!data) throw new Error("Admin required");
}

async function assertMediaOrAdmin(ctx: any) {
  const { supabase, userId } = ctx;
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const roles = (data ?? []).map((r: any) => r.role);
  if (!roles.includes("admin") && !roles.includes("media_manager")) {
    throw new Error("Forbidden");
  }
  return { roles, isAdmin: roles.includes("admin") };
}

function getOrigin() {
  return process.env.PUBLIC_APP_URL || process.env.SITE_URL || "";
}

/* ---------- Staff invites ---------- */

export const listStaff = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: invites } = await supabaseAdmin
      .from("staff_invites").select("*").order("created_at", { ascending: false });
    const { data: mmRoles } = await supabaseAdmin
      .from("user_roles").select("user_id, created_at").eq("role", "media_manager");
    const ids = (mmRoles ?? []).map((r: any) => r.user_id);
    const { data: profiles } = ids.length
      ? await supabaseAdmin.from("profiles").select("id, email, full_name").in("id", ids)
      : { data: [] as any[] };
    const members = (mmRoles ?? []).map((r: any) => ({
      user_id: r.user_id,
      created_at: r.created_at,
      profile: (profiles ?? []).find((p: any) => p.id === r.user_id) || null,
    }));
    return { invites: invites ?? [], members };
  });

const InviteInput = z.object({
  email: z.string().email(),
  first_name: z.string().min(1).max(100),
  last_name: z.string().min(1).max(100),
  phone: z.string().nullable().optional(),
});

export const inviteMediaManager = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => InviteInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const setup_token = genToken();
    const setup_token_expires_at = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    const { data: row, error } = await supabaseAdmin
      .from("staff_invites").insert({
        email: data.email,
        first_name: data.first_name,
        last_name: data.last_name,
        phone: data.phone ?? null,
        role: "media_manager",
        setup_token,
        setup_token_expires_at,
        created_by: context.userId,
      }).select("*").single();
    if (error) throw new Error(error.message);
    const origin = getOrigin();
    const link = `${origin}/staff-setup?token=${setup_token}`;
    return { invite: row, link };
  });

export const resendStaffInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { inviteId: string }) => z.object({ inviteId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const setup_token = genToken();
    const setup_token_expires_at = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    const { data: row, error } = await supabaseAdmin
      .from("staff_invites").update({ setup_token, setup_token_expires_at, status: "pending" })
      .eq("id", data.inviteId).select("email").single();
    if (error) throw new Error(error.message);
    return { link: `${getOrigin()}/staff-setup?token=${setup_token}`, email: row.email };
  });

export const revokeStaffInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { inviteId: string }) => z.object({ inviteId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("staff_invites")
      .update({ status: "revoked", setup_token: null }).eq("id", data.inviteId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deactivateMediaManager = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { userId: string }) => z.object({ userId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("user_roles")
      .delete().eq("user_id", data.userId).eq("role", "media_manager");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---------- Public: redeem staff invite ---------- */

const RedeemInput = z.object({
  token: z.string().min(20).max(128),
  password: z.string().min(8).max(72),
});

export const redeemStaffInvite = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => RedeemInput.parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: invite, error } = await supabaseAdmin
      .from("staff_invites").select("*").eq("setup_token", data.token).maybeSingle();
    if (error || !invite) throw new Error("Invalid setup link");
    if (invite.status === "revoked") throw new Error("This invite has been revoked");
    if (invite.setup_token_expires_at && new Date(invite.setup_token_expires_at) < new Date()) {
      throw new Error("Setup link expired — ask the admin for a new one");
    }

    let userId: string | null = null;
    const { data: list } = await supabaseAdmin.auth.admin.listUsers();
    const existing = list.users.find((u: any) => (u.email || "").toLowerCase() === invite.email.toLowerCase());
    if (existing) {
      userId = existing.id;
      await supabaseAdmin.auth.admin.updateUserById(existing.id, { password: data.password });
    } else {
      const { data: created, error: cErr } = await supabaseAdmin.auth.admin.createUser({
        email: invite.email, password: data.password, email_confirm: true,
        user_metadata: { full_name: `${invite.first_name ?? ""} ${invite.last_name ?? ""}`.trim() },
      });
      if (cErr) throw new Error(cErr.message);
      userId = created.user.id;
    }

    await supabaseAdmin.from("user_roles")
      .upsert({ user_id: userId, role: invite.role }, { onConflict: "user_id,role" });

    await supabaseAdmin.from("staff_invites").update({
      status: "redeemed", redeemed_user_id: userId, redeemed_at: new Date().toISOString(),
      setup_token: null,
    }).eq("id", invite.id);

    return { ok: true, email: invite.email };
  });

/* ---------- Approval workflow ---------- */

const KindEnum = z.enum(["broadcast", "event", "sales_page"]);
type Kind = z.infer<typeof KindEnum>;

const tableFor = (kind: Kind) =>
  kind === "broadcast" ? "broadcasts"
  : kind === "event" ? "events"
  : "sales_pages";

export const submitForReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ kind: KindEnum, id: z.string() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertMediaOrAdmin(context);
    const { supabase, userId } = context;
    if (data.kind === "sales_page") {
      const { error } = await supabase.from("sales_pages")
        .update({ draft_status: "needs_review", draft_submitted_by: userId, draft_submitted_at: new Date().toISOString() })
        .eq("page_key", data.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase.from(tableFor(data.kind))
        .update({ review_status: "needs_review", submitted_by: userId, submitted_at: new Date().toISOString() })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const approveItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ kind: KindEnum, id: z.string(), notes: z.string().optional() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.kind === "sales_page") {
      const { data: page } = await supabaseAdmin.from("sales_pages").select("draft_payload").eq("page_key", data.id).maybeSingle();
      const patch: any = { draft_status: "approved", draft_reviewed_by: context.userId, draft_reviewed_at: new Date().toISOString(), draft_notes: data.notes ?? null };
      if (page?.draft_payload) Object.assign(patch, page.draft_payload, { draft_payload: null, draft_status: "published" });
      const { error } = await supabaseAdmin.from("sales_pages").update(patch).eq("page_key", data.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin.from(tableFor(data.kind))
        .update({ review_status: "approved", reviewed_by: context.userId, reviewed_at: new Date().toISOString(), review_notes: data.notes ?? null })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const rejectItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ kind: KindEnum, id: z.string(), notes: z.string().min(1) }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.kind === "sales_page") {
      const { error } = await supabaseAdmin.from("sales_pages")
        .update({ draft_status: "draft", draft_reviewed_by: context.userId, draft_reviewed_at: new Date().toISOString(), draft_notes: data.notes })
        .eq("page_key", data.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin.from(tableFor(data.kind))
        .update({ review_status: "draft", reviewed_by: context.userId, reviewed_at: new Date().toISOString(), review_notes: data.notes })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const listApprovalQueue = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [b, e, s] = await Promise.all([
      supabaseAdmin.from("broadcasts").select("id, title, review_status, submitted_at, submitted_by").eq("review_status", "needs_review"),
      supabaseAdmin.from("events").select("id, name, review_status, submitted_at, submitted_by").eq("review_status", "needs_review"),
      supabaseAdmin.from("sales_pages").select("page_key, draft_status, draft_submitted_at, draft_submitted_by, draft_payload").eq("draft_status", "needs_review"),
    ]);
    return {
      broadcasts: b.data ?? [],
      events: e.data ?? [],
      sales_pages: s.data ?? [],
    };
  });

export const mediaDashboardSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertMediaOrAdmin(context);
    const { supabase, userId } = context;
    const [myDrafts, needsReview, upcomingEvents, recentMedia] = await Promise.all([
      supabase.from("broadcasts").select("id, title, review_status, updated_at").eq("submitted_by", userId).in("review_status", ["draft", "needs_review"]).order("updated_at", { ascending: false }).limit(10),
      supabase.from("broadcasts").select("id, title, review_status").eq("review_status", "needs_review").limit(20),
      supabase.from("events").select("id, name, event_date").gte("event_date", new Date().toISOString().slice(0, 10)).order("event_date").limit(10),
      supabase.from("media_items").select("id, file_name, media_type, created_at, thumbnail_url").in("marketing_visibility", ["marketing", "public"]).order("created_at", { ascending: false }).limit(10),
    ]);
    return {
      myDrafts: myDrafts.data ?? [],
      needsReview: needsReview.data ?? [],
      upcomingEvents: upcomingEvents.data ?? [],
      recentMedia: recentMedia.data ?? [],
    };
  });

/* ---------- Draft creation (Media Manager) ---------- */

export const createBroadcastDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({
    title: z.string().min(1).max(200),
    body: z.string().optional(),
    audience_scope: z.enum(["everyone","coaching_clients","app_members","program_members","selected_clients"]).default("everyone"),
  }).parse(i))
  .handler(async ({ data, context }) => {
    await assertMediaOrAdmin(context);
    const { supabase, userId } = context;
    const { data: row, error } = await supabase.from("broadcasts").insert({
      title: data.title,
      body: data.body ?? "",
      audience_scope: data.audience_scope,
      status: "Draft",
      review_status: "draft",
      submitted_by: userId,
    }).select("id").single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const updateBroadcastDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({
    id: z.string().uuid(),
    title: z.string().optional(),
    body: z.string().optional(),
    audience_scope: z.string().optional(),
  }).parse(i))
  .handler(async ({ data, context }) => {
    await assertMediaOrAdmin(context);
    const { id, ...patch } = data;
    const { error } = await context.supabase.from("broadcasts").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listMyDrafts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { kind: "broadcast" | "event" } | undefined) => i ?? { kind: "broadcast" as const })
  .handler(async ({ data, context }) => {
    await assertMediaOrAdmin(context);
    const table = data.kind === "event" ? "events" : "broadcasts";
    const { data: rows, error } = await context.supabase
      .from(table).select("*").eq("submitted_by", context.userId)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { items: rows ?? [] };
  });