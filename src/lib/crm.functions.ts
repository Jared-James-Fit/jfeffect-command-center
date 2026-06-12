import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/* ───── helpers ───── */

export function normalizeEmail(e?: string | null): string | null {
  if (!e) return null;
  const v = e.trim().toLowerCase();
  return v.length > 0 ? v : null;
}
export function normalizePhone(p?: string | null): string | null {
  if (!p) return null;
  const digits = p.replace(/\D+/g, "");
  return digits.length >= 7 ? digits : null;
}

async function assertAdmin(ctx: any) {
  const { data } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  if (!data) throw new Error("Admin required");
}

const PROSPECT_STAGES = ["lead", "applicant", "call_booked", "qualified", "follow_up"];
const WON_STAGES = ["won", "active_client"];
const LOST_STAGES = ["lost", "disqualified"];

/* ───── shared core: match-or-create client from an application ───── */

export type ApplicantUpsertInput = {
  first_name: string;
  last_name: string;
  email: string;
  phone?: string | null;
  instagram?: string | null;
  source?: string | null;
  lead_score?: number | null;
  lead_temperature?: "hot" | "warm" | "cold" | null;
  recommended_offer?: string | null;
};

export type ApplicantUpsertResult = {
  client_id: string;
  created: boolean;
  reapplied: boolean;
  conflict: boolean;
  is_active_client: boolean;
};

/**
 * Match-or-create a client from a coaching application.
 * Service-role only. Never overwrites non-empty client fields with blanks.
 * Never grants coaching access. Returns conflict=true when email/phone
 * point to different existing clients (no automatic merge).
 */
export async function upsertApplicantClient(
  admin: any,
  input: ApplicantUpsertInput,
): Promise<ApplicantUpsertResult> {
  const nEmail = normalizeEmail(input.email);
  const nPhone = normalizePhone(input.phone ?? null);

  let byEmail: any = null;
  if (nEmail) {
    const { data } = await admin
      .from("clients")
      .select("id, lifecycle_stage, user_id, archived, status, first_name, last_name, full_name, email, phone, instagram, source, lead_score, lead_temperature, recommended_offer, assigned_coach_id, applied_at, converted_to_client_at")
      .eq("normalized_email", nEmail)
      .limit(1)
      .maybeSingle();
    byEmail = data ?? null;
  }
  let byPhone: any = null;
  if (nPhone) {
    const { data } = await admin
      .from("clients")
      .select("id, lifecycle_stage, user_id, archived, status, first_name, last_name, full_name, email, phone, instagram, source, lead_score, lead_temperature, recommended_offer, assigned_coach_id, applied_at, converted_to_client_at")
      .eq("normalized_phone", nPhone)
      .limit(1)
      .maybeSingle();
    byPhone = data ?? null;
  }

  // Conflict: email and phone match different existing clients.
  let conflict = false;
  if (byEmail && byPhone && byEmail.id !== byPhone.id) {
    conflict = true;
  }

  const matched = byEmail ?? byPhone;

  const full_name = `${input.first_name} ${input.last_name}`.trim();

  // CREATE: no match → applicant row
  if (!matched) {
    const { data: created, error } = await admin
      .from("clients")
      .insert({
        first_name: input.first_name,
        last_name: input.last_name,
        full_name,
        email: input.email,
        phone: input.phone || null,
        instagram: input.instagram || null,
        lifecycle_stage: "applicant",
        source: input.source || "coaching_application",
        lead_score: input.lead_score ?? null,
        lead_temperature: input.lead_temperature ?? null,
        recommended_offer: input.recommended_offer ?? null,
        call_booked: false,
        applied_at: new Date().toISOString(),
        status: "Lead",
        archived: false,
      })
      .select("id, lifecycle_stage")
      .single();
    if (error) throw new Error(error.message);
    return {
      client_id: created.id,
      created: true,
      reapplied: false,
      conflict: false,
      is_active_client: false,
    };
  }

  // UPDATE: matched existing client. Preserve everything non-empty.
  const isActive =
    matched.lifecycle_stage === "active_client" ||
    (matched.user_id && matched.archived === false && matched.status === "Active");

  const patch: Record<string, any> = {};

  // Only set blanks → values; never overwrite existing data.
  if (!matched.first_name) patch.first_name = input.first_name;
  if (!matched.last_name) patch.last_name = input.last_name;
  if (!matched.full_name) patch.full_name = full_name;
  if (!matched.phone && input.phone) patch.phone = input.phone;
  if (!matched.instagram && input.instagram) patch.instagram = input.instagram;
  if (!matched.source && input.source) patch.source = input.source;

  // Lead intelligence is always refreshed for non-active clients (latest signal wins).
  if (!isActive) {
    if (typeof input.lead_score === "number") patch.lead_score = input.lead_score;
    if (input.lead_temperature) patch.lead_temperature = input.lead_temperature;
    if (input.recommended_offer) patch.recommended_offer = input.recommended_offer;
    patch.applied_at = new Date().toISOString();
    // Move forward to applicant unless already further along the funnel.
    const advanced = ["call_booked", "qualified", "won", "active_client"];
    if (!matched.lifecycle_stage || matched.lifecycle_stage === "lead") {
      patch.lifecycle_stage = "applicant";
    } else if (matched.lifecycle_stage === "lost" || matched.lifecycle_stage === "disqualified") {
      // Re-engaged: bring back as applicant (do not erase lost_at history).
      patch.lifecycle_stage = "applicant";
    } else if (!advanced.includes(matched.lifecycle_stage)) {
      patch.lifecycle_stage = "applicant";
    }
  }

  if (Object.keys(patch).length > 0) {
    const { error } = await admin.from("clients").update(patch).eq("id", matched.id);
    if (error) throw new Error(error.message);
  }

  return {
    client_id: matched.id,
    created: false,
    reapplied: true,
    conflict,
    is_active_client: !!isActive,
  };
}

/* ───── CRM dashboard ───── */

export const crmDashboardStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400_000).toISOString();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400_000).toISOString();

    async function count(filter: (q: any) => any) {
      const q = supabaseAdmin.from("clients").select("id", { count: "exact", head: true });
      const { count, error } = await filter(q);
      if (error) throw new Error(error.message);
      return count ?? 0;
    }

    const [
      total_prospects,
      new_applications_7d,
      hot_leads,
      warm_leads,
      follow_ups_due,
      calls_booked,
      won,
      lost_30d,
      active_clients,
    ] = await Promise.all([
      count((q) => q.in("lifecycle_stage", PROSPECT_STAGES).eq("archived", false)),
      count((q) => q.gte("applied_at", sevenDaysAgo)),
      count((q) => q.eq("lead_temperature", "hot").in("lifecycle_stage", PROSPECT_STAGES).eq("archived", false)),
      count((q) => q.eq("lead_temperature", "warm").in("lifecycle_stage", PROSPECT_STAGES).eq("archived", false)),
      count((q) => q.lte("next_follow_up_at", now.toISOString()).in("lifecycle_stage", PROSPECT_STAGES).eq("archived", false)),
      count((q) => q.eq("call_booked", true).in("lifecycle_stage", PROSPECT_STAGES).eq("archived", false)),
      count((q) => q.in("lifecycle_stage", WON_STAGES).gte("converted_to_client_at", thirtyDaysAgo)),
      count((q) => q.in("lifecycle_stage", LOST_STAGES).gte("lost_at", thirtyDaysAgo)),
      count((q) => q.eq("lifecycle_stage", "active_client").eq("archived", false)),
    ]);

    const wonAll = await count((q) => q.in("lifecycle_stage", WON_STAGES));
    const lostAll = await count((q) => q.in("lifecycle_stage", LOST_STAGES));
    const denom = wonAll + lostAll;
    const conversion_rate = denom > 0 ? Math.round((wonAll / denom) * 100) : 0;

    // Recent applications
    const { data: recentApps } = await supabaseAdmin
      .from("coaching_applications")
      .select("id, full_name, email, lead_temperature, lead_score, application_status, client_id, created_at")
      .order("created_at", { ascending: false })
      .limit(8);

    // Hot leads needing action
    const { data: hotList } = await supabaseAdmin
      .from("clients")
      .select("id, full_name, email, lead_temperature, lead_score, lifecycle_stage, next_follow_up_at, applied_at")
      .eq("lead_temperature", "hot")
      .in("lifecycle_stage", PROSPECT_STAGES)
      .eq("archived", false)
      .order("lead_score", { ascending: false })
      .limit(8);

    // Follow-ups overdue
    const { data: overdue } = await supabaseAdmin
      .from("clients")
      .select("id, full_name, email, next_follow_up_at, lifecycle_stage, lead_temperature")
      .lte("next_follow_up_at", now.toISOString())
      .in("lifecycle_stage", PROSPECT_STAGES)
      .eq("archived", false)
      .order("next_follow_up_at", { ascending: true })
      .limit(8);

    // Recently converted
    const { data: converted } = await supabaseAdmin
      .from("clients")
      .select("id, full_name, email, converted_to_client_at")
      .not("converted_to_client_at", "is", null)
      .order("converted_to_client_at", { ascending: false })
      .limit(8);

    return {
      stats: {
        total_prospects,
        new_applications_7d,
        hot_leads,
        warm_leads,
        follow_ups_due,
        calls_booked,
        won_30d: won,
        lost_30d,
        active_clients,
        conversion_rate,
      },
      recent_applications: recentApps ?? [],
      hot_list: hotList ?? [],
      overdue: overdue ?? [],
      recently_converted: converted ?? [],
    };
  });

/* ───── CRM contacts list ───── */

const listSchema = z.object({
  search: z.string().trim().max(120).optional().default(""),
  lifecycle_stage: z.string().optional(),
  lead_temperature: z.enum(["hot","warm","cold"]).optional(),
  source: z.string().optional(),
  call_booked: z.enum(["true","false"]).optional(),
  assigned_coach_id: z.string().uuid().optional(),
  overdue: z.enum(["true","false"]).optional(),
  scope: z.enum(["all","prospects","active","applicants"]).optional().default("all"),
  applied_from: z.string().optional(),
  applied_to: z.string().optional(),
  limit: z.number().int().min(1).max(500).optional().default(200),
});

export const listCrmContacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => listSchema.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("clients")
      .select(`
        id, full_name, first_name, last_name, email, phone, instagram,
        lifecycle_stage, lead_temperature, lead_score, source, call_booked,
        next_follow_up_at, applied_at, converted_to_client_at,
        assigned_coach_id, archived, status, user_id, created_at
      `)
      .order("created_at", { ascending: false })
      .limit(data.limit);

    if (data.scope === "prospects") q = q.in("lifecycle_stage", PROSPECT_STAGES).eq("archived", false);
    else if (data.scope === "active") q = q.eq("lifecycle_stage", "active_client").eq("archived", false);
    else if (data.scope === "applicants") q = q.eq("lifecycle_stage", "applicant").eq("archived", false);

    if (data.lifecycle_stage) q = q.eq("lifecycle_stage", data.lifecycle_stage);
    if (data.lead_temperature) q = q.eq("lead_temperature", data.lead_temperature);
    if (data.source) q = q.eq("source", data.source);
    if (data.call_booked) q = q.eq("call_booked", data.call_booked === "true");
    if (data.assigned_coach_id) q = q.eq("assigned_coach_id", data.assigned_coach_id);
    if (data.overdue === "true") q = q.lte("next_follow_up_at", new Date().toISOString());
    if (data.applied_from) q = q.gte("applied_at", data.applied_from);
    if (data.applied_to) q = q.lte("applied_at", data.applied_to);

    if (data.search) {
      const s = data.search.replace(/[%_]/g, "\\$&");
      q = q.or(`full_name.ilike.%${s}%,email.ilike.%${s}%,phone.ilike.%${s}%,instagram.ilike.%${s}%`);
    }

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const list = rows ?? [];
    // Enrich with assigned coach name (no FK between clients and coaches).
    const coachIds = Array.from(new Set(list.map((r: any) => r.assigned_coach_id).filter(Boolean)));
    let coachMap: Record<string, string> = {};
    if (coachIds.length) {
      const { data: cs } = await supabaseAdmin.from("coaches").select("id, full_name").in("id", coachIds as string[]);
      coachMap = Object.fromEntries((cs ?? []).map((c: any) => [c.id, c.full_name]));
    }
    const enriched = list.map((r: any) => ({ ...r, coaches: r.assigned_coach_id ? { id: r.assigned_coach_id, full_name: coachMap[r.assigned_coach_id] ?? null } : null }));
    return { contacts: enriched };
  });

/* ───── CRM contact profile ───── */

export const getCrmContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: contact, error } = await supabaseAdmin
      .from("clients")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!contact) throw new Error("Contact not found");

    let coach: any = null;
    if ((contact as any).assigned_coach_id) {
      const { data: c } = await supabaseAdmin.from("coaches").select("id, full_name").eq("id", (contact as any).assigned_coach_id).maybeSingle();
      coach = c ?? null;
    }
    (contact as any).coaches = coach;

    const [apps, appts, acts] = await Promise.all([
      supabaseAdmin
        .from("coaching_applications")
        .select("*")
        .eq("client_id", data.id)
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("appointments")
        .select("id, title, appointment_type, starts_at, ends_at, status, meet_link, google_event_id, google_calendar_id, location")
        .eq("client_id", data.id)
        .order("starts_at", { ascending: false })
        .limit(50),
      supabaseAdmin
        .from("client_crm_activities")
        .select("*")
        .eq("client_id", data.id)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    return {
      contact,
      applications: apps.data ?? [],
      appointments: appts.data ?? [],
      activities: acts.data ?? [],
    };
  });

/* ───── update / actions ───── */

const updateSchema = z.object({
  id: z.string().uuid(),
  lifecycle_stage: z.string().optional(),
  lead_temperature: z.enum(["hot","warm","cold"]).optional().nullable(),
  next_follow_up_at: z.string().optional().nullable(),
  assigned_coach_id: z.string().uuid().optional().nullable(),
  source: z.string().optional().nullable(),
  recommended_offer: z.string().optional().nullable(),
  lost_reason: z.string().optional().nullable(),
  call_booked: z.boolean().optional(),
});

export const updateCrmContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => updateSchema.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { id, ...patch } = data;

    // Guard: do not let a stage change grant access. We only set lifecycle.
    // Conversion to active_client must go through convertCrmContact.
    if (patch.lifecycle_stage === "active_client") {
      throw new Error("Use Convert action to mark as active client");
    }

    // Stamp lost_at when moving to lost/disqualified.
    const finalPatch: Record<string, any> = { ...patch };
    if (patch.lifecycle_stage === "lost" || patch.lifecycle_stage === "disqualified") {
      finalPatch.lost_at = new Date().toISOString();
    }

    const { data: before } = await supabaseAdmin
      .from("clients").select("lifecycle_stage, lead_temperature, assigned_coach_id, next_follow_up_at, call_booked").eq("id", id).maybeSingle();

    const { error } = await supabaseAdmin.from("clients").update(finalPatch as any).eq("id", id);
    if (error) throw new Error(error.message);

    // Activity log for meaningful changes
    const changes: any = {};
    for (const k of Object.keys(patch)) {
      if ((before as any)?.[k] !== (patch as any)[k]) changes[k] = { from: (before as any)?.[k], to: (patch as any)[k] };
    }
    if (Object.keys(changes).length > 0) {
      await supabaseAdmin.from("client_crm_activities").insert({
        client_id: id,
        activity_type: "contact_updated",
        title: "Contact updated",
        details: changes,
        source: "admin",
        actor_user_id: context.userId,
      });
    }
    return { ok: true };
  });

export const addCrmNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ id: z.string().uuid(), note: z.string().trim().min(1).max(4000) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("client_crm_activities").insert({
      client_id: data.id,
      activity_type: "note_added",
      title: "Note",
      details: { note: data.note },
      source: "admin",
      actor_user_id: context.userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const convertCrmContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: c } = await supabaseAdmin
      .from("clients")
      .select("id, lifecycle_stage, converted_to_client_at")
      .eq("id", data.id)
      .maybeSingle();
    if (!c) throw new Error("Contact not found");

    const now = new Date().toISOString();
    const { error } = await supabaseAdmin
      .from("clients")
      .update({
        lifecycle_stage: "active_client",
        converted_to_client_at: c.converted_to_client_at ?? now,
        status: "Active",
        archived: false,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("client_crm_activities").insert({
      client_id: data.id,
      activity_type: "converted",
      title: "Converted to active client",
      details: { previous_stage: c.lifecycle_stage },
      source: "admin",
      actor_user_id: context.userId,
    });
    return { ok: true };
  });

/* ───── small helpers exposed for filter dropdowns ───── */

export const listCoachOptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("coaches")
      .select("id, full_name, status, archived")
      .eq("archived", false)
      .order("full_name", { ascending: true });
    return { coaches: (data ?? []).filter((c: any) => c.status === "Active") };
  });