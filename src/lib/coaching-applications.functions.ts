import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { upsertApplicantClient, normalizeEmail, normalizePhone } from "./crm.functions";

/* ─────────── Quick-Apply Quiz schema (v2) ─────────── */

const submitSchema = z.object({
  // Contact (required)
  first_name: z.string().trim().min(1).max(60),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().min(5).max(40),
  instagram: z.string().trim().max(80).optional().default(""),
  location_timezone: z.string().trim().max(120).optional().default(""),

  // Goal + result
  main_goal: z.string().trim().min(1).max(80),
  target_outcome: z.string().trim().max(250).optional().default(""),

  // Obstacle
  obstacle: z.string().trim().max(80).optional().default(""),
  obstacle_other: z.string().trim().max(80).optional().default(""),

  // Training
  training_location: z.string().trim().max(80).optional().default(""),
  days_per_week: z.coerce.number().int().min(0).max(14).optional(),
  timeline: z.string().trim().max(80).optional().default(""),

  // Coaching fit
  coaching_interest: z.string().trim().max(80).optional().default(""),
  readiness: z.string().trim().max(80).optional().default(""),
  tracking_willingness: z.string().trim().max(80).optional().default(""),
  investment_readiness: z.string().trim().max(80).optional().default(""),

  // Why now
  why_now: z.string().trim().max(250).optional().default(""),
  why_now_tags: z.array(z.string().trim().max(60)).max(10).optional().default([]),

  // Contact preferences + consent
  preferred_contact: z.enum(["text", "phone", "email", "instagram"]).optional(),
  best_time: z.enum(["morning", "afternoon", "evening", "flexible"]).optional(),
  consent_contact: z.boolean(),

  // Bot trap
  honeypot: z.string().max(0).optional().default(""),

  // Legacy fields still accepted for back-compat but ignored
  last_name: z.string().trim().max(60).optional().default(""),
}).refine((d) => d.consent_contact === true, { message: "Consent required", path: ["consent_contact"] })
  .refine((d) => !d.honeypot, { message: "Spam detected", path: ["honeypot"] });

type Submission = z.infer<typeof submitSchema>;

/* ─────────── Category scoring (0–100) ─────────── */

function scoreApplication(d: Submission) {
  const breakdown: Record<string, { score: number; max: number; reason: string }> = {};

  // Goal / service fit — 0–20
  {
    let s = 0; let reason = "no goal selected";
    if (d.main_goal) { s = 14; reason = `clear goal: ${d.main_goal}`; }
    if (d.coaching_interest && d.coaching_interest !== "help_me_choose") {
      s += 6; reason += `; service: ${d.coaching_interest}`;
    } else if (d.coaching_interest === "help_me_choose") {
      s += 3; reason += `; wants help choosing service`;
    }
    breakdown.goal_service_fit = { score: Math.min(20, s), max: 20, reason };
  }
  // Readiness — 0–20
  {
    let s = 0; let reason = "no readiness selected";
    switch (d.readiness) {
      case "fully_ready": s = 20; reason = "fully ready"; break;
      case "ready_accountability": s = 16; reason = "ready, needs accountability"; break;
      case "unsure": s = 8; reason = "unsure"; break;
      case "researching": s = 4; reason = "mostly researching"; break;
    }
    breakdown.readiness = { score: s, max: 20, reason };
  }
  // Willingness to follow process — 0–20
  {
    let s = 0; let reason = "tracking willingness unknown";
    switch (d.tracking_willingness) {
      case "yes": s = 20; reason = "will track everything"; break;
      case "most": s = 14; reason = "will track most"; break;
      case "not_sure": s = 6; reason = "not sure about tracking"; break;
      case "no": s = 0; reason = "will not track"; break;
    }
    breakdown.willingness = { score: s, max: 20, reason };
  }
  // Investment / offer fit — 0–20
  {
    let s = 0; let reason = "investment unknown";
    switch (d.investment_readiness) {
      case "premium": s = 20; reason = "ready for premium"; break;
      case "full_online": s = 16; reason = "ready for full online"; break;
      case "lower_cost": s = 10; reason = "needs lower-cost option"; break;
      case "explain_options": s = 8; reason = "needs to understand options"; break;
      case "not_ready": s = 2; reason = "not ready to invest"; break;
    }
    breakdown.investment = { score: s, max: 20, reason };
  }
  // Urgency / reason for applying — 0–15
  {
    let s = 0; let reason = "no timeline";
    switch (d.timeline) {
      case "asap": s = 12; reason = "starting ASAP"; break;
      case "two_weeks": s = 10; reason = "within 2 weeks"; break;
      case "thirty_days": s = 7; reason = "within 30 days"; break;
      case "one_three_months": s = 4; reason = "within 1–3 months"; break;
      case "exploring": s = 1; reason = "just exploring"; break;
    }
    if ((d.why_now || "").trim().length >= 40 || (d.why_now_tags?.length ?? 0) > 0) {
      s += 3; reason += "; clear why-now";
    }
    breakdown.urgency = { score: Math.min(15, s), max: 15, reason };
  }
  // Contact completeness — 0–5
  {
    let s = 0;
    if (d.email) s += 2;
    if (d.phone) s += 2;
    if (d.preferred_contact) s += 1;
    breakdown.contact = { score: Math.min(5, s), max: 5, reason: "contact fields filled" };
  }

  const total = Object.values(breakdown).reduce((acc, b) => acc + b.score, 0);
  const score = Math.max(0, Math.min(100, total));

  let qualification_label = "Low Readiness";
  if (score >= 80) qualification_label = "Priority Lead";
  else if (score >= 60) qualification_label = "Strong Lead";
  else if (score >= 40) qualification_label = "Needs Review";

  let temperature: "hot" | "warm" | "cold" = "cold";
  if (score >= 70) temperature = "hot";
  else if (score >= 40) temperature = "warm";

  // Recommended offer heuristic
  let recommended_offer = "Coaching Discovery Call";
  const g = (d.main_goal || "").toLowerCase();
  if (g.includes("powerlift")) recommended_offer = "Powerlifting Coaching";
  else if (g.includes("muscle") || g.includes("build")) recommended_offer = "Hypertrophy Coaching";
  else if (g.includes("fat") || g.includes("lose")) recommended_offer = "Fat Loss Coaching";
  else if (g.includes("strong") || g.includes("strength")) recommended_offer = "Strength Coaching";
  if (d.coaching_interest === "membership") recommended_offer = "App Membership";

  const summary = [
    `${d.main_goal} goal`,
    d.timeline ? `start ${d.timeline.replace(/_/g, " ")}` : null,
    d.coaching_interest ? `interest ${d.coaching_interest.replace(/_/g, " ")}` : null,
    `${qualification_label} (${score}/100)`,
  ].filter(Boolean).join(" · ");

  return {
    score, temperature, recommended_offer, summary,
    qualification_label,
    scoring: { version: "v2", total: score, breakdown, scored_at: new Date().toISOString() },
  };
}

/* ─────────── Public submit endpoint ─────────── */

export const submitCoachingApplication = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => submitSchema.parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const scored = scoreApplication(data);
    const full_name = data.first_name + (data.last_name ? " " + data.last_name : "");

    // Booking link configured by admin?
    const { data: settingsRows } = await supabaseAdmin
      .from("app_settings").select("key, value")
      .in("key", ["coaching_apply.booking_link_slug", "coaching_apply.allow_cold_booking"]);
    const settings = Object.fromEntries((settingsRows ?? []).map((r: any) => [r.key, r.value]));
    const bookingSlug = (settings["coaching_apply.booking_link_slug"] || "").trim() || null;
    const allowCold = (settings["coaching_apply.allow_cold_booking"] || "false").toLowerCase() === "true";

    // CRM client (single source of truth)
    const upsert = await upsertApplicantClient(supabaseAdmin, {
      first_name: data.first_name,
      last_name: data.last_name || "",
      email: data.email,
      phone: data.phone || null,
      instagram: data.instagram || null,
      source: "coaching_application",
      lead_score: scored.score,
      lead_temperature: scored.temperature,
      recommended_offer: scored.recommended_offer,
    });

    const { data: inserted, error } = await supabaseAdmin
      .from("coaching_applications")
      .insert({
        client_id: upsert.client_id,
        first_name: data.first_name,
        last_name: data.last_name || null,
        full_name,
        email: data.email,
        phone: data.phone || null,
        instagram: data.instagram || null,
        location_timezone: data.location_timezone || null,
        main_goal: data.main_goal,
        why_now: data.why_now || null,
        target_outcome: data.target_outcome || null,
        timeline: data.timeline || null,
        days_per_week: data.days_per_week ?? null,
        // New quiz fields
        obstacle: data.obstacle || null,
        obstacle_other: data.obstacle_other || null,
        training_location: data.training_location || null,
        coaching_interest: data.coaching_interest || null,
        readiness: data.readiness || null,
        tracking_willingness: data.tracking_willingness || null,
        investment_readiness: data.investment_readiness || null,
        preferred_contact: data.preferred_contact || null,
        best_time: data.best_time || null,
        why_now_tags: data.why_now_tags?.length ? data.why_now_tags : null,
        consent_contact_at: new Date().toISOString(),
        application_source: "quick_apply_v1",
        // Scoring
        lead_score: scored.score,
        lead_temperature: scored.temperature,
        qualification_label: scored.qualification_label,
        scoring: scored.scoring,
        recommended_offer: scored.recommended_offer,
        summary: scored.summary,
        application_status: "submitted",
        call_status: "not_booked",
        booking_link_slug: bookingSlug,
        source: "coaching_application",
        status: upsert.conflict ? "Needs Review" : "New",
        submitted_at: new Date().toISOString(),
        // Legacy back-compat
        goals: [data.main_goal, data.why_now, data.target_outcome].filter(Boolean).join("\n\n") || null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    // CRM activity log (dedup-keyed by application id)
    const activityType = upsert.is_active_client
      ? "active_client_reapplied"
      : upsert.created
        ? "application_submitted"
        : "reapplied";
    await supabaseAdmin.from("client_crm_activities").upsert(
      {
        client_id: upsert.client_id,
        activity_type: activityType,
        title: upsert.created ? "Application submitted" : "Reapplied",
        details: {
          application_id: inserted.id,
          lead_score: scored.score,
          qualification_label: scored.qualification_label,
          recommended_offer: scored.recommended_offer,
          conflict: upsert.conflict,
          normalized_email: normalizeEmail(data.email),
          normalized_phone: normalizePhone(data.phone),
        },
        source: "public_form",
        application_id: inserted.id,
        dedupe_key: `application:${inserted.id}`,
      },
      { onConflict: "client_id,dedupe_key", ignoreDuplicates: true } as any,
    );

    // Fire admin notifications (best-effort — never throws out)
    try {
      const { notifyCoachingAppRecipients } = await import("./coaching-app-notify.server");
      const isPriority = scored.qualification_label === "Priority Lead";
      const reviewLink = `https://jfeffect.com/admin/forms?tab=coaching-applications`;
      const startLabel = (data.timeline || "no timeline").replace(/_/g, " ");
      const smsBody = `New JF Effect application: ${data.first_name} — ${scored.qualification_label}, score ${scored.score}. Goal: ${data.main_goal}. Start: ${startLabel}. Review: ${reviewLink}`;
      const emailBody = [
        `Name: ${full_name}`,
        `Score: ${scored.score} (${scored.qualification_label})`,
        `Goal: ${data.main_goal}`,
        `Start: ${startLabel}`,
        `Coaching interest: ${data.coaching_interest || "not specified"}`,
        `Preferred contact: ${data.preferred_contact || "not specified"}`,
        `Phone: ${data.phone}`,
        `Email: ${data.email}`,
        `Review: ${reviewLink}`,
      ].join("\n");
      await notifyCoachingAppRecipients(supabaseAdmin, {
        kind: "coaching_app_submit",
        event_key: inserted.id,
        priority: isPriority,
        smsBody,
        emailSubject: `New Coaching Application — ${data.first_name} — ${scored.qualification_label}`,
        emailBody,
      });
    } catch (e) {
      console.warn("[coaching-app] notify failed", e);
    }

    const canBook = !!bookingSlug && (scored.temperature !== "cold" || allowCold);
    return {
      ok: true,
      id: inserted.id,
      client_id: upsert.client_id,
      conflict: upsert.conflict,
      lead_score: scored.score,
      lead_temperature: scored.temperature,
      qualification_label: scored.qualification_label,
      recommended_offer: scored.recommended_offer,
      booking_slug: canBook ? bookingSlug : null,
      first_name: data.first_name,
      email: data.email,
      phone: data.phone,
    };
  });

/* ─────────── Admin endpoints ─────────── */

async function assertAdmin(ctx: any) {
  const { data } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  if (!data) throw new Error("Admin required");
}

export const listCoachingApplications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("coaching_applications").select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { applications: data ?? [] };
  });

export const updateCoachingApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      id: z.string().uuid(),
      status: z.enum(["New","Contacted","Approved","Rejected","Needs Review"]).optional(),
      call_status: z.enum(["not_offered","booking_available","not_booked","booked","completed","rescheduled","cancelled","no_show"]).optional(),
      notes_admin: z.string().max(4000).optional(),
      follow_up_at: z.string().optional().nullable(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { id, ...rest } = data;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("coaching_applications").update(rest).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** CSV export — admin only. Returns rows ready to be CSV-encoded on the client. */
export const exportCoachingApplicationsCsv = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("coaching_applications").select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const columns = [
      "created_at","status","call_status","lead_score","qualification_label",
      "first_name","last_name","email","phone","instagram",
      "main_goal","target_outcome","obstacle","training_location","days_per_week",
      "timeline","coaching_interest","readiness","tracking_willingness","investment_readiness",
      "why_now","preferred_contact","best_time",
    ];
    const esc = (v: any) => {
      if (v === null || v === undefined) return "";
      const s = typeof v === "string" ? v : Array.isArray(v) ? v.join("; ") : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = columns.join(",");
    const rows = (data ?? []).map((r: any) => columns.map((c) => esc(r[c])).join(","));
    return { csv: [header, ...rows].join("\n"), count: rows.length };
  });
