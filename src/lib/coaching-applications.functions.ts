import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { upsertApplicantClient, normalizeEmail, normalizePhone } from "./crm.functions";
import { resolveAttribution, DEFAULT_QUICK_APPLY_SOURCE } from "./application-attribution";
import { toLeadScore5 } from "./lead-score-display";

/* ─────────── Quick-Apply Quiz schema (v2) ─────────── */

const HELP_CATEGORIES = ["powerlifting", "fat_loss", "build_muscle", "general_fitness", "other"] as const;
const START_WINDOWS = ["asap", "this_month", "one_three_months", "exploring"] as const;

export function normalizeInstagramHandle(value: string): string {
  const handle = value.trim().replace(/^@+/, "");
  if (!/^[A-Za-z0-9._]{1,30}$/.test(handle)) {
    throw new Error("Enter a valid Instagram handle, with or without @.");
  }
  return `@${handle}`;
}

export const publicCoachingApplicationSchema = z.object({
  // The public application deliberately collects only lead-stage essentials.
  full_name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().min(5).max(40),
  instagram: z.string().trim().min(1, "Instagram is required").max(80).transform(normalizeInstagramHandle),
  main_goal: z.enum(HELP_CATEGORIES),
  target_outcome: z.string().trim().min(1).max(250),
  timeline: z.enum(START_WINDOWS),

  // Bot trap and automatic attribution only; neither is shown as a prospect question.
  honeypot: z.string().max(0).optional().default(""),
  source_page: z.string().trim().max(80).optional().default(""),
  page_url: z.string().trim().max(500).optional().default(""),
  referrer: z.string().trim().max(500).optional().default(""),
  form_name: z.string().trim().max(120).optional().default(""),
  is_test: z.boolean().optional().default(false),
}).refine((d) => !d.honeypot, { message: "Spam detected", path: ["honeypot"] });

type Submission = z.infer<typeof publicCoachingApplicationSchema>;

/* ─────────── Category scoring (0–100) ─────────── */

export function scoreApplication(d: Submission) {
  const breakdown: Record<string, { score: number; max: number; reason: string }> = {};

  // Score only information that the concise prospect form actually collects.
  const goalScores: Record<(typeof HELP_CATEGORIES)[number], number> = {
    powerlifting: 30, fat_loss: 28, build_muscle: 28, general_fitness: 24, other: 20,
  };
  breakdown.goal_fit = {
    score: goalScores[d.main_goal], max: 30,
    reason: `clear coaching focus: ${d.main_goal.replace(/_/g, " ")}`,
  };

  const urgencyScores: Record<(typeof START_WINDOWS)[number], [number, string]> = {
    asap: [40, "starting ASAP"],
    this_month: [30, "starting this month"],
    one_three_months: [18, "starting in 1–3 months"],
    exploring: [8, "just exploring"],
  };
  const [urgencyScore, urgencyReason] = urgencyScores[d.timeline];
  breakdown.start_window = { score: urgencyScore, max: 40, reason: urgencyReason };
  breakdown.contact = { score: 20, max: 20, reason: "email, phone, and Instagram supplied" };

  const score = Object.values(breakdown).reduce((acc, item) => acc + item.score, 0);
  let qualification_label = "Needs Review";
  if (score >= 80) qualification_label = "Priority Lead";
  else if (score >= 60) qualification_label = "Strong Lead";

  const temperature: "hot" | "warm" | "cold" = score >= 80 ? "hot" : score >= 50 ? "warm" : "cold";
  const recommendedByGoal: Record<(typeof HELP_CATEGORIES)[number], string> = {
    powerlifting: "Powerlifting Coaching",
    fat_loss: "Fat Loss Coaching",
    build_muscle: "Hypertrophy Coaching",
    general_fitness: "General Fitness Coaching",
    other: "Coaching Discovery Call",
  };
  const recommended_offer = recommendedByGoal[d.main_goal];
  const summary = [
    d.main_goal.replace(/_/g, " "),
    `target: ${d.target_outcome}`,
    `start: ${d.timeline.replace(/_/g, " ")}`,
    `${qualification_label} (${score}/100)`,
  ].join(" · ");

  return {
    score, temperature, recommended_offer, summary,
    qualification_label,
    scoring: { version: "v3_concise_lead", total: score, breakdown, scored_at: new Date().toISOString() },
  };
}

/* ─────────── Public submit endpoint ─────────── */

export const submitCoachingApplication = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => publicCoachingApplicationSchema.parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const scored = scoreApplication(data);
    const attribution = resolveAttribution({
      from: data.source_page || null,
      page_url: data.page_url || null,
      referrer: data.referrer || null,
      form_name: data.form_name || "Quick Apply",
      default_source_label: DEFAULT_QUICK_APPLY_SOURCE,
    });
    const full_name = data.full_name.trim();
    const [first_name, ...lastNameParts] = full_name.split(/\s+/);
    const last_name = lastNameParts.join(" ");

    // Booking link configured by admin?
    const { data: settingsRows } = await supabaseAdmin
      .from("app_settings").select("key, value")
      .in("key", ["coaching_apply.booking_link_slug", "coaching_apply.allow_cold_booking"]);
    const settings = Object.fromEntries((settingsRows ?? []).map((r: any) => [r.key, r.value]));
    const bookingSlug = (settings["coaching_apply.booking_link_slug"] || "").trim() || null;
    const allowCold = (settings["coaching_apply.allow_cold_booking"] || "false").toLowerCase() === "true";

    // CRM client (single source of truth)
    const upsert = await upsertApplicantClient(supabaseAdmin, {
      first_name: first_name,
      last_name: last_name || "",
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
        first_name: first_name,
        last_name: last_name || null,
        full_name,
        email: data.email,
        phone: data.phone || null,
        instagram: data.instagram || null,
        location_timezone: null,
        main_goal: data.main_goal,
        why_now: null,
        target_outcome: data.target_outcome,
        timeline: data.timeline,
        days_per_week: null,
        obstacle: null,
        obstacle_other: null,
        training_location: null,
        coaching_interest: null,
        readiness: null,
        tracking_willingness: null,
        investment_readiness: null,
        preferred_contact: null,
        best_time: null,
        why_now_tags: null,
        consent_contact_at: null,
        application_source: "quick_apply_v2",
        // Attribution (additive — legacy rows stay null and display as Unknown)
        source_label: attribution.source_label,
        form_name: attribution.form_name,
        page_path: attribution.page_path,
        page_url: attribution.page_url,
        referrer: attribution.referrer,
        utm_source: attribution.utm_source,
        utm_medium: attribution.utm_medium,
        utm_campaign: attribution.utm_campaign,
        is_test: data.is_test === true,
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
        goals: [data.main_goal, data.target_outcome].filter(Boolean).join("\n\n") || null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    // CRM activity log (dedup-keyed by application id). The existing database
    // uniqueness guard is a partial index, which PostgreSQL cannot target with
    // ON CONFLICT (...) in an upsert. Insert directly and treat only the
    // duplicate-key race as idempotent; all other errors are surfaced.
    const activityType = upsert.is_active_client
      ? "active_client_reapplied"
      : upsert.created
        ? "application_submitted"
        : "reapplied";
    const { error: activityError } = await supabaseAdmin.from("client_crm_activities").insert({
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
    });
    if (activityError && activityError.code !== "23505") {
      throw new Error(`Could not record CRM application activity: ${activityError.message}`);
    }

    // Admin alert for NEW applications — fixed allowlist recipients only.
    // Best-effort: failures are logged and never roll back the saved
    // application or the CRM records written above.
    try {
      const { notifyNewApplicationFixedRecipients } = await import("./coaching-app-notify.server");
      const adminLink = `https://jfeffect.com/admin/forms?tab=applications`;
      const crmLink = `https://jfeffect.com/admin/clients/${upsert.client_id}`;
      const startLabel = (data.timeline || "no timeline").replace(/_/g, " ");
      const submittedAtStr = new Date().toLocaleString("en-CA", {
        timeZone: "America/Winnipeg", dateStyle: "medium", timeStyle: "short",
      }) + " CT";
      const sourceLabel = attribution.source_label ?? "Unknown";
      const serviceLabel = (data.main_goal || "—").replace(/_/g, " ");
      const score5 = toLeadScore5(scored.score);

      const smsBody =
        `New JF Effect application: ${full_name}. ` +
        `Goal/service: ${serviceLabel}. Source: ${sourceLabel}. ` +
        `Phone: ${data.phone}. IG: ${data.instagram || "—"}. ` +
        `Lead Score ${score5 ?? "?"}/5. ${adminLink}`;

      const answers: Array<[string, unknown]> = [
        ["Full name", full_name],
        ["Email", data.email],
        ["Phone", data.phone],
        ["Instagram handle", data.instagram],
        ["Looking for help with", data.main_goal.replace(/_/g, " ")],
        ["Result wanted", data.target_outcome],
        ["When to start", startLabel],
      ];

      const emailBody = [
        `New coaching application received.`,
        ``,
        `Submitted: ${submittedAtStr}`,
        `Source: ${sourceLabel}`,
        `Form: ${attribution.form_name ?? "Unknown"}`,
        `Page: ${attribution.page_path ?? attribution.page_url ?? "Unknown"}`,
        `Referrer: ${attribution.referrer ?? "Unknown"}`,
        `Campaign: ${[attribution.utm_source, attribution.utm_medium, attribution.utm_campaign].filter(Boolean).join(" / ") || "Unknown"}`,
        ``,
        `── Answers ──`,
        ...answers.map(([q, a]) => `${q}: ${a === null || a === undefined || a === "" ? "—" : String(a)}`),
        ``,
        `── Lead Score ──`,
        `Lead Score: ${score5 ?? "—"}/5 (internal score ${scored.score}/100 — ${scored.qualification_label})`,
        `Lead Score is a prioritization aid, not a judgment of the applicant.`,
        `Recommended offer: ${scored.recommended_offer}`,
        ``,
        `Review application: ${adminLink}`,
        `CRM client record: ${crmLink}`,
      ].join("\n");

      await notifyNewApplicationFixedRecipients(supabaseAdmin, {
        event_key: inserted.id,
        smsBody,
        emailSubject: `New Coaching Application — ${full_name} — Lead Score ${score5 ?? "?"}/5`,
        emailBody,
      });
    } catch (e) {
      console.warn("[coaching-app] admin alert failed", e);
    }

    // Send confirmation email to applicant (best-effort)
    try {
      const { sendApplicantConfirmationEmail } = await import("./coaching-app-notify.server");
      await sendApplicantConfirmationEmail(supabaseAdmin, {
        to: data.email,
        firstName: first_name,
        applicationId: inserted.id,
        submittedAtStr: new Date().toLocaleString("en-CA", {
          timeZone: "America/Winnipeg", dateStyle: "medium", timeStyle: "short",
        }) + " CT",
        sourcePage: data.source_page || "coaching/apply",
        mainGoal: data.main_goal,
      });
    } catch (e) {
      console.warn("[coaching-app] applicant confirmation failed", e);
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
      first_name: first_name,
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

/** Lightweight dashboard metrics — admin only. */
export const getCoachingApplicationsMetrics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabaseAdmin
      .from("coaching_applications")
      .select("id,created_at,status,call_status,lead_score,qualification_label")
      .eq("is_test", false)
      .gte("created_at", since);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    const total = rows.length;
    const newCount = rows.filter((r: any) => r.status === "New").length;
    const booked = rows.filter((r: any) => r.call_status === "booked" || r.call_status === "completed").length;
    const hot = rows.filter((r: any) => (r.lead_score ?? 0) >= 80).length;
    const conversionRate = total ? Math.round((booked / total) * 100) : 0;
    return { total, newCount, booked, hot, conversionRate };
  });

export const updateCoachingApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      id: z.string().uuid(),
      status: z.enum(["New","Contacted","Approved","Rejected","Needs Review"]).optional(),
      call_status: z.enum(["not_offered","booking_available","not_booked","booked","completed","rescheduled","cancelled","no_show"]).optional(),
      notes_admin: z.string().max(4000).optional(),
      is_test: z.boolean().optional(),
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

/**
 * Website form stats for the admin Forms workspace: submission count and
 * last submission per public form. Test submissions are counted separately
 * so they never inflate lead metrics.
 */
export const getWebsiteFormStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("coaching_applications")
      .select("form_name,page_path,created_at,is_test")
      .order("created_at", { ascending: false })
      .limit(5000);
    if (error) throw new Error(error.message);
    const stats: Record<string, { count: number; test_count: number; last_at: string | null; paths: string[] }> = {};
    for (const r of data ?? []) {
      const key = (r as any).form_name || "Unknown";
      const s = (stats[key] ||= { count: 0, test_count: 0, last_at: null, paths: [] });
      if ((r as any).is_test) s.test_count++; else s.count++;
      if (!s.last_at) s.last_at = (r as any).created_at;
      const p = (r as any).page_path;
      if (p && !s.paths.includes(p)) s.paths.push(p);
    }
    return { stats };
  });
