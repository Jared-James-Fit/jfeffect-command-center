import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertMemberCanReadProtected } from "@/lib/jf-access.server";

async function assertAdmin(ctx: any) {
  const { supabase, userId } = ctx;
  const { data } = await supabase
    .from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
  if (!data) throw new Error("Admin required");
}

function countWorkouts(payload: any): number {
  let n = 0;
  const weeks = payload?.weeks_data ?? [];
  for (const w of weeks) for (const d of (w?.days ?? [])) {
    if (Array.isArray(d?.rows) && d.rows.length > 0) n++; else n++;
  }
  return n;
}

/* ---------- Admin: linked listing for a program template ---------- */

export const getLinkedLibraryPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ templateId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: plan } = await supabaseAdmin
      .from("member_plans").select("*")
      .eq("source_template_id", data.templateId)
      .order("created_at", { ascending: false })
      .limit(1).maybeSingle();
    if (!plan) return { plan: null, template_revision: null };
    const { data: t } = await supabaseAdmin
      .from("pl_templates").select("payload_revision").eq("id", data.templateId).maybeSingle();
    return { plan, template_revision: (t as any)?.payload_revision ?? null };
  });

const ListingMetadata = z.object({
  name: z.string().min(1).max(200),
  public_title: z.string().max(200).optional().nullable(),
  description: z.string().max(4000).optional().nullable(),
  cover_image_url: z.string().url().nullable().optional(),
  difficulty: z.enum(["Beginner","Intermediate","Advanced","All Levels"]).default("All Levels"),
  goal: z.string().nullable().optional(),
  training_style: z.string().default("custom"),
  tags: z.array(z.string()).default([]),
  equipment_needed: z.array(z.string()).default([]),
  est_minutes_per_workout: z.number().int().nullable().optional(),
  required_access_level: z.string().default("app_membership"),
  audience_mode: z.enum(["all_active","access_level","plans"]).default("access_level"),
  eligible_plan_ids: z.array(z.string().uuid()).default([]),
  allow_full_program: z.boolean().default(true),
  allow_partial_imports: z.boolean().default(false),
  allow_pdf_download: z.boolean().default(true),
  notify_on_publish: z.boolean().default(false),
  change_notes: z.string().max(2000).nullable().optional(),
});

export const upsertLibraryListing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({
    templateId: z.string().uuid(),
    planId: z.string().uuid().nullable().optional(),
    metadata: ListingMetadata,
  }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: t, error: te } = await supabaseAdmin
      .from("pl_templates").select("*").eq("id", data.templateId).maybeSingle();
    if (te || !t) throw new Error("Template not found");
    const payload: any = (t as any).payload ?? { weeks_data: [] };
    const weeks = (t as any).weeks ?? (payload?.weeks_data?.length ?? 4);
    const days  = (t as any).days_per_week ?? (payload?.weeks_data?.[0]?.days?.length ?? 3);
    const workouts_total = countWorkouts(payload);
    const base = {
      ...data.metadata,
      weeks, days_per_week: days, workouts_total,
      source_template_id: t.id,
      published_payload: payload,
    };
    let planId = data.planId ?? null;
    if (planId) {
      const { error } = await supabaseAdmin
        .from("member_plans").update(base as any).eq("id", planId);
      if (error) throw new Error(error.message);
    } else {
      const { data: row, error } = await supabaseAdmin
        .from("member_plans").insert({ ...base, status: "Draft", membership_status: "private" } as any)
        .select("id").single();
      if (error) throw new Error(error.message);
      planId = row.id as string;
      await supabaseAdmin.from("member_plan_audit").insert({
        plan_id: planId, action: "create", actor_user_id: context.userId,
      } as any);
    }
    await supabaseAdmin.from("member_plan_audit").insert({
      plan_id: planId, action: "metadata_edit", actor_user_id: context.userId,
    } as any);
    return { planId };
  });

export const publishLibraryListing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({
    planId: z.string().uuid(), isUpdate: z.boolean().default(false),
  }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: plan } = await supabaseAdmin
      .from("member_plans").select("*").eq("id", data.planId).maybeSingle();
    if (!plan) throw new Error("Listing not found");
    let nextPayload = (plan as any).published_payload;
    let templateRevision: number | null = (plan as any).last_published_version ?? null;
    if ((plan as any).source_template_id) {
      const { data: t } = await supabaseAdmin
        .from("pl_templates").select("payload,payload_revision,weeks,days_per_week")
        .eq("id", (plan as any).source_template_id).maybeSingle();
      if (t) {
        nextPayload = (t as any).payload ?? nextPayload;
        templateRevision = (t as any).payload_revision ?? templateRevision;
      }
    }
    const nextVersion = ((plan as any).published_version ?? 0) + 1;
    const { error } = await supabaseAdmin.from("member_plans").update({
      status: "Published",
      membership_status: "live",
      published_payload: nextPayload,
      published_version: nextVersion,
      last_published_version: templateRevision,
      published_by: context.userId,
      published_at: new Date().toISOString(),
      unpublished_at: null,
      unpublish_reason: null,
      workouts_total: countWorkouts(nextPayload),
    } as any).eq("id", data.planId);
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("member_plan_audit").insert({
      plan_id: data.planId, action: data.isUpdate ? "update_publish" : "publish",
      version: nextVersion, actor_user_id: context.userId,
    } as any);
    await supabaseAdmin.from("member_plan_events").insert({
      plan_id: data.planId, actor_user_id: context.userId,
      event_type: data.isUpdate ? "update_publish" : "publish",
    } as any);

    // Admin-owned programs go straight to the Membership Library — no review
    // queue. Record this as a `membership` share with status="shared" so
    // destination badges show "Shared" instead of the misleading
    // "Pending Approval — Membership" pill. Also auto-resolve any legacy
    // `membership_submission` row so it no longer lingers in the inbox.
    if ((plan as any).source_template_id) {
      const templateId = (plan as any).source_template_id as string;
      const nowIso = new Date().toISOString();
      await supabaseAdmin
        .from("pl_template_shares")
        .upsert(
          {
            template_id: templateId,
            destination: "membership",
            target_coach_id: null,
            permission: "read",
            status: "shared",
            shared_version: templateRevision,
            reviewed_by: context.userId,
            reviewed_at: nowIso,
            removed_at: null,
            review_notes: "Admin-owned program — published directly",
          } as any,
          { onConflict: "template_id,destination,target_coach_id" } as any,
        );
      // Auto-resolve any lingering legacy submission row for the same template.
      await supabaseAdmin
        .from("pl_template_shares")
        .update({
          status: "approved",
          reviewed_by: context.userId,
          reviewed_at: nowIso,
          review_notes: "Auto-approved: admin-owned program",
        })
        .eq("template_id", templateId)
        .eq("destination", "membership_submission")
        .in("status", ["pending", "changes_requested"]);
    }

    return { ok: true, version: nextVersion };
  });

export const unpublishLibraryListing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({
    planId: z.string().uuid(), reason: z.string().max(500).optional().nullable(),
  }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: plan } = await supabaseAdmin
      .from("member_plans").select("source_template_id").eq("id", data.planId).maybeSingle();
    const { error } = await supabaseAdmin.from("member_plans").update({
      status: "Draft",
      membership_status: "unpublished",
      unpublished_at: new Date().toISOString(),
      unpublish_reason: data.reason ?? null,
    } as any).eq("id", data.planId);
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("member_plan_audit").insert({
      plan_id: data.planId, action: "unpublish", actor_user_id: context.userId, notes: data.reason ?? null,
    } as any);
    await supabaseAdmin.from("member_plan_events").insert({
      plan_id: data.planId, actor_user_id: context.userId, event_type: "unpublish",
    } as any);

    // Mirror the lifecycle on pl_template_shares so destination badges
    // (which read from shares) flip back to "not published".
    if ((plan as any)?.source_template_id) {
      await supabaseAdmin
        .from("pl_template_shares")
        .update({ status: "removed", removed_at: new Date().toISOString() })
        .eq("template_id", (plan as any).source_template_id)
        .in("destination", ["membership", "membership_submission"])
        .not("status", "in", "(removed,rejected)");
    }

    return { ok: true };
  });

export const listAdminLibrary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: plans } = await supabaseAdmin
      .from("member_plans").select("*").order("updated_at", { ascending: false });
    return { plans: plans ?? [] };
  });

export const getListingAnalytics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ planId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [previews, downloads, imports, audit] = await Promise.all([
      supabaseAdmin.from("member_plan_events").select("id", { count: "exact", head: true }).eq("plan_id", data.planId).eq("event_type","preview"),
      supabaseAdmin.from("member_plan_events").select("id", { count: "exact", head: true }).eq("plan_id", data.planId).eq("event_type","pdf_download"),
      supabaseAdmin.from("member_plan_enrollments").select("id, member_id, started_at, status", { count: "exact" }).eq("plan_id", data.planId).order("started_at", { ascending: false }).limit(50),
      supabaseAdmin.from("member_plan_audit").select("*").eq("plan_id", data.planId).order("created_at",{ ascending: false}).limit(20),
    ]);
    return {
      previews_count: previews.count ?? 0,
      pdf_downloads_count: downloads.count ?? 0,
      imports_count: imports.count ?? 0,
      recent_imports: imports.data ?? [],
      audit: audit.data ?? [],
    };
  });

/* ---------- Member: preview, save, pdf, import-with-schedule ---------- */

/**
 * List programs in the Membership Library that the current member can see.
 * Driven by pl_template_shares rows where destination='membership' and
 * status='shared', joined to the live member_plans listing and filtered by
 * the member's active access levels (or audience_mode='all_active').
 */
export const listMembershipLibrary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertMemberCanReadProtected(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: member } = await supabaseAdmin
      .from("app_members").select("id").eq("user_id", userId).maybeSingle();
    if (!member) return { plans: [] };
    // member_plans IS the source of truth for the Membership Library listing.
    // status='Published' + membership_status='live' means the admin has
    // published it. (Older listings predate the pl_template_shares mirror,
    // so we no longer require a matching share row to surface a plan.)
    const [{ data: plans }, { data: access }] = await Promise.all([
      supabaseAdmin
        .from("member_plans")
        .select(
          "id, name, public_title, description, cover_image_url, training_style, difficulty, goal, weeks, days_per_week, workouts_total, est_minutes_per_workout, equipment_needed, required_access_level, audience_mode, allow_full_program, allow_pdf_download, featured, status, membership_status",
        )
        .eq("status", "Published")
        .eq("membership_status", "live"),
      supabaseAdmin
        .from("member_access")
        .select("access_level_key")
        .eq("member_id", (member as any).id)
        .eq("active", true),
    ]);
    const keys = new Set((access ?? []).map((a: any) => a.access_level_key));
    const visible = (plans ?? []).filter((p: any) =>
      p.audience_mode === "all_active" || keys.has(p.required_access_level),
    );
    visible.sort((a: any, b: any) =>
      (b.featured ? 1 : 0) - (a.featured ? 1 : 0)
      || String(a.name).localeCompare(String(b.name)),
    );
    return { plans: visible };
  });

async function memberAccessGate(supabase: any, userId: string, planId: string) {
  const [{ data: member }, { data: plan }] = await Promise.all([
    supabase.from("app_members").select("id").eq("user_id", userId).maybeSingle(),
    supabase.from("member_plans").select("*").eq("id", planId).maybeSingle(),
  ]);
  if (!member) throw new Error("Not a member");
  if (!plan) throw new Error("Plan not found");
  if (plan.status !== "Published") throw new Error("Plan not available");
  if (plan.audience_mode === "all_active") return { member, plan };
  const { data: access } = await supabase
    .from("member_access").select("access_level_key").eq("member_id", member.id).eq("active", true);
  const keys = new Set((access ?? []).map((a: any) => a.access_level_key));
  if (!keys.has(plan.required_access_level)) throw new Error("You don't have access to this plan");
  return { member, plan };
}

export const recordPreviewEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ planId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMemberCanReadProtected(supabase, userId);
    const { member } = await memberAccessGate(supabase, userId, data.planId);
    await supabase.from("member_plan_events").insert({
      plan_id: data.planId, member_id: member.id, event_type: "preview",
    });
    return { ok: true };
  });

export const savePlanForLater = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ planId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMemberCanReadProtected(supabase, userId);
    const { member } = await memberAccessGate(supabase, userId, data.planId);
    await supabase.from("member_plan_saved").upsert({
      member_id: member.id, plan_id: data.planId,
    }, { onConflict: "member_id,plan_id" });
    await supabase.from("member_plan_events").insert({
      plan_id: data.planId, member_id: member.id, event_type: "save",
    });
    return { ok: true };
  });

export const unsavePlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ planId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: member } = await supabase.from("app_members").select("id").eq("user_id", userId).maybeSingle();
    if (!member) throw new Error("Not a member");
    await supabase.from("member_plan_saved").delete()
      .eq("member_id", member.id).eq("plan_id", data.planId);
    return { ok: true };
  });

export const listSavedPlans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: member } = await supabase.from("app_members").select("id").eq("user_id", userId).maybeSingle();
    if (!member) return { ids: [] };
    const { data } = await supabase.from("member_plan_saved").select("plan_id").eq("member_id", member.id);
    return { ids: (data ?? []).map((r: any) => r.plan_id as string) };
  });

export const enrollLibraryPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({
    planId: z.string().uuid(),
    startDate: z.string().nullable().optional(),
    trainingDays: z.array(z.string()).default([]),
    importMode: z.enum(["full","partial"]).default("full"),
    selection: z.any().optional(),
    confirmReplace: z.boolean().optional(),
  }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMemberCanReadProtected(supabase, userId);
    const { member, plan } = await memberAccessGate(supabase, userId, data.planId);
    const { data: active } = await supabase
      .from("member_plan_enrollments")
      .select("*").eq("member_id", member.id).eq("status","Active").maybeSingle();
    if (active && !data.confirmReplace) {
      return { conflict: true, activeEnrollmentId: active.id, activePlanId: active.plan_id };
    }
    if (active && data.confirmReplace) {
      await supabase.from("member_plan_enrollments").update({ status: "Abandoned" }).eq("id", active.id);
    }
    const { data: row, error } = await supabase.from("member_plan_enrollments").insert({
      member_id: member.id,
      plan_id: plan.id,
      status: "Active",
      current_week: 1,
      workouts_completed: 0,
      workouts_total: plan.workouts_total ?? 0,
      source_version: plan.published_version ?? null,
      start_date: data.startDate ?? null,
      training_days: data.trainingDays ?? [],
      import_mode: data.importMode,
      selection_json: data.selection ?? null,
    }).select("*").single();
    if (error) throw new Error(error.message);
    await supabase.from("member_plan_events").insert({
      plan_id: plan.id, member_id: member.id, event_type: "import",
      metadata: { import_mode: data.importMode, version: plan.published_version ?? null },
    });
    // bump imports_count (best-effort, via admin to bypass RLS)
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin
        .from("member_plans")
        .update({ imports_count: (plan.imports_count ?? 0) + 1 } as any)
        .eq("id", plan.id);
    } catch { /* counter increment is best-effort */ }
    return { conflict: false, enrollmentId: row.id };
  });

export const checkForUpdates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: member } = await supabase.from("app_members").select("id").eq("user_id", userId).maybeSingle();
    if (!member) return { updates: [] };
    const { data: enrollments } = await supabase
      .from("member_plan_enrollments")
      .select("id, plan_id, source_version, status, member_plans(published_version, name)")
      .eq("member_id", member.id);
    const updates = (enrollments ?? []).filter((e: any) => {
      const pv = e.member_plans?.published_version ?? null;
      return pv != null && e.source_version != null && pv > e.source_version;
    }).map((e: any) => ({
      enrollmentId: e.id, planId: e.plan_id,
      name: e.member_plans?.name, currentVersion: e.source_version,
      latestVersion: e.member_plans?.published_version,
    }));
    return { updates };
  });

/* ---------- PDF download ---------- */

export const downloadLibraryPdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ planId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMemberCanReadProtected(supabase, userId);
    const { member, plan } = await memberAccessGate(supabase, userId, data.planId);
    if (!plan.allow_pdf_download) throw new Error("PDF download is not enabled for this program");
    const { generateLibraryPdf } = await import("./membership-library-pdf.server");
    const bytes = await generateLibraryPdf(plan);
    await supabase.from("member_plan_events").insert({
      plan_id: plan.id, member_id: member.id, event_type: "pdf_download",
    });
    return {
      filename: `${(plan.public_title || plan.name).replace(/[^a-z0-9-_ ]/gi,"").slice(0,80)}.pdf`,
      base64: Buffer.from(bytes).toString("base64"),
    };
  });