import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const submitSchema = z.object({
  first_name: z.string().trim().min(1).max(60),
  last_name: z.string().trim().min(1).max(60),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().max(40).optional().default(""),
  instagram: z.string().trim().max(80).optional().default(""),
  location_timezone: z.string().trim().max(120).optional().default(""),

  main_goal: z.string().trim().max(80).optional().default(""),
  why_now: z.string().trim().max(2000).optional().default(""),
  tried_before: z.string().trim().max(2000).optional().default(""),
  biggest_struggle: z.string().trim().max(2000).optional().default(""),
  current_weight: z.string().trim().max(40).optional().default(""),
  target_outcome: z.string().trim().max(2000).optional().default(""),
  timeline: z.string().trim().max(80).optional().default(""),

  seriousness: z.coerce.number().int().min(1).max(10).optional(),
  ready_to_invest: z.boolean().optional().default(false),
  monthly_investment: z.string().trim().max(80).optional().default(""),
  can_follow_plan: z.boolean().optional().default(false),
  days_per_week: z.coerce.number().int().min(0).max(14).optional(),
  gym_access: z.string().trim().max(80).optional().default(""),
  injuries: z.string().trim().max(2000).optional().default(""),
  win_90_days: z.string().trim().max(2000).optional().default(""),
});

function scoreLead(d: z.infer<typeof submitSchema>) {
  let score = 0;
  // Seriousness 1-10 → up to 25
  if (typeof d.seriousness === "number") score += Math.round((d.seriousness / 10) * 25);
  // Ready to invest → 25
  if (d.ready_to_invest) score += 25;
  // Budget tier from monthly_investment string
  const inv = (d.monthly_investment || "").toLowerCase();
  if (/\$?5\d{2,}|1[0-9]{3}|2[0-9]{3}|3[0-9]{3}|\bpremium\b|\bhigh\b/.test(inv)) score += 20;
  else if (/\$?3\d{2}|\$?4\d{2}|\bmid\b|\bmedium\b/.test(inv)) score += 12;
  else if (/\$?1\d{2}|\$?2\d{2}|\blow\b|\bbudget\b/.test(inv)) score += 5;
  // Plan + structure + urgency
  if (d.can_follow_plan) score += 10;
  if ((d.days_per_week ?? 0) >= 3) score += 5;
  if (d.gym_access && !/none|no\b/i.test(d.gym_access)) score += 5;
  // Quality of answers (length signals seriousness)
  const longAnswers = [d.why_now, d.target_outcome, d.win_90_days].filter((s) => (s || "").length >= 40).length;
  score += longAnswers * 3;
  // Urgency from timeline
  if (/asap|now|immediate|this month|1-?2 month/i.test(d.timeline || "")) score += 5;

  score = Math.max(0, Math.min(100, score));
  let temperature: "hot" | "warm" | "cold";
  if (score >= 70) temperature = "hot";
  else if (score >= 40) temperature = "warm";
  else temperature = "cold";

  // Recommended offer heuristic
  let recommended_offer = "Coaching Discovery Call";
  if (/powerlift|strength|compet/i.test(d.main_goal || "")) recommended_offer = "Powerlifting Coaching";
  else if (/glute|muscle|build/i.test(d.main_goal || "")) recommended_offer = "Hypertrophy Coaching";
  else if (/fat\s*loss|lose|cut/i.test(d.main_goal || "")) recommended_offer = "Fat Loss Coaching";

  const summary = [
    `${d.main_goal || "General"} goal`,
    typeof d.seriousness === "number" ? `seriousness ${d.seriousness}/10` : null,
    d.monthly_investment ? `budget ${d.monthly_investment}` : null,
    d.timeline ? `timeline ${d.timeline}` : null,
    `${temperature.toUpperCase()} lead (${score}/100)`,
  ].filter(Boolean).join(" · ");

  return { score, temperature, recommended_offer, summary };
}

/** Public: submit a coaching application from /coaching/apply. */
export const submitCoachingApplication = createServerFn({ method: "POST" })
  .inputValidator((i: z.infer<typeof submitSchema>) => submitSchema.parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const scored = scoreLead(data);
    const full_name = `${data.first_name} ${data.last_name}`.trim();

    // Load admin settings for post-submit booking step
    const { data: settingsRows } = await supabaseAdmin
      .from("app_settings")
      .select("key, value")
      .in("key", ["coaching_apply.booking_link_slug", "coaching_apply.allow_cold_booking"]);
    const settings = Object.fromEntries((settingsRows ?? []).map((r) => [r.key, r.value]));
    const bookingSlug = (settings["coaching_apply.booking_link_slug"] || "").trim() || null;
    const allowCold = (settings["coaching_apply.allow_cold_booking"] || "false").toLowerCase() === "true";

    const { data: inserted, error } = await supabaseAdmin
      .from("coaching_applications")
      .insert({
        first_name: data.first_name,
        last_name: data.last_name,
        full_name,
        email: data.email,
        phone: data.phone || null,
        instagram: data.instagram || null,
        location_timezone: data.location_timezone || null,
        main_goal: data.main_goal || null,
        why_now: data.why_now || null,
        tried_before: data.tried_before || null,
        biggest_struggle: data.biggest_struggle || null,
        current_weight: data.current_weight || null,
        target_outcome: data.target_outcome || null,
        timeline: data.timeline || null,
        seriousness: data.seriousness ?? null,
        ready_to_invest: data.ready_to_invest,
        monthly_investment: data.monthly_investment || null,
        can_follow_plan: data.can_follow_plan,
        days_per_week: data.days_per_week ?? null,
        gym_access: data.gym_access || null,
        injuries: data.injuries || null,
        win_90_days: data.win_90_days || null,
        // Legacy columns retained for back-compat with admin views
        goals: [data.main_goal, data.why_now, data.target_outcome].filter(Boolean).join("\n\n") || null,
        training_history: data.tried_before || null,
        budget_range: data.monthly_investment || null,
        lead_score: scored.score,
        lead_temperature: scored.temperature,
        application_status: "submitted",
        recommended_offer: scored.recommended_offer,
        summary: scored.summary,
        booking_link_slug: bookingSlug,
        source: "coaching_application",
        status: "New",
        submitted_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const canBook = !!bookingSlug && (scored.temperature !== "cold" || allowCold);
    return {
      ok: true,
      id: inserted.id,
      lead_score: scored.score,
      lead_temperature: scored.temperature,
      recommended_offer: scored.recommended_offer,
      booking_slug: canBook ? bookingSlug : null,
    };
  });

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
      .from("coaching_applications")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { applications: data ?? [] };
  });

export const updateCoachingApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string; status?: string; notes_admin?: string }) =>
    z.object({
      id: z.string().uuid(),
      status: z.enum(["New","Contacted","Approved","Rejected"]).optional(),
      notes_admin: z.string().max(4000).optional(),
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