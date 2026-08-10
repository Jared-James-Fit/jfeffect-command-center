import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getGoogleConnectionStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { data: coach } = await supabase.from("coaches").select("id, full_name").eq("user_id", userId).maybeSingle();
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const isAdmin = (roles ?? []).some((r: any) => r.role === "admin");
    if (!coach && !isAdmin) return { connected: false, isCoach: false } as any;
    const workspaceConnected = !!(process.env.LOVABLE_API_KEY && process.env.GOOGLE_CALENDAR_API_KEY);
    const { data: conn } = coach?.id
      ? await supabase.from("google_calendar_connections").select("*").eq("coach_id", coach.id).maybeSingle()
      : { data: null as any };
    return {
      isCoach: true,
      mode: "workspace" as const,
      coachId: coach?.id ?? null,
      connected: workspaceConnected,
      status: workspaceConnected ? "connected" : "not_configured",
      email: conn?.google_account_email ?? "Workspace Google account",
      calendarId: conn?.selected_calendar_id ?? null,
      calendarName: conn?.selected_calendar_name ?? null,
      lastSyncedAt: conn?.last_synced_at ?? null,
      lastError: conn?.last_error ?? null,
    };
  });

export const beginGoogleConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ origin: z.string().url() }).parse(d))
  .handler(async () => {
    // Workspace mode: per-coach OAuth is disabled; the workspace Google
    // Calendar connector is shared across all coaches.
    return {
      mode: "workspace" as const,
      message:
        "Google Calendar is connected at the workspace level. No per-coach setup needed.",
    };
  });

export const assignGoogleEventToClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        googleEventId: z.string().min(1),
        googleEventTitle: z.string().min(1),
        googleEventStartsAt: z.string().min(1),
        googleEventEndsAt: z.string().min(1),
        clientId: z.string().uuid(),
        coachId: z.string().uuid().optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;

    // Resolve coach: explicit > current user's coach > any coach (admin-safe fallback)
    let coachId = data.coachId ?? null;
    if (!coachId) {
      const { data: c } = await supabase
        .from("coaches")
        .select("id")
        .eq("user_id", userId)
        .maybeSingle();
      coachId = c?.id ?? null;
    }
    if (!coachId) {
      const { data: anyCoach } = await supabase
        .from("coaches")
        .select("id")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      coachId = anyCoach?.id ?? null;
    }
    if (!coachId) throw new Error("No coach available to host this appointment.");

    const { data: existing } = await supabase
      .from("appointments")
      .select("id")
      .eq("google_event_id", data.googleEventId)
      .maybeSingle();

    if (existing?.id) {
      const { error } = await supabase
        .from("appointments")
        .update({ client_id: data.clientId })
        .eq("id", existing.id);
      if (error) throw error;
      return { id: existing.id as string, created: false };
    }

    const { data: inserted, error: insertErr } = await supabase
      .from("appointments")
      .insert({
        host_coach_id: coachId,
        client_id: data.clientId,
        appointment_type: "Coaching Call",
        title: data.googleEventTitle,
        starts_at: data.googleEventStartsAt,
        ends_at: data.googleEventEndsAt,
        status: "Scheduled",
        source: "external",
        google_event_id: data.googleEventId,
      })
      .select("id")
      .single();
    if (insertErr) throw insertErr;
    return { id: inserted!.id as string, created: true };
  });

export const disconnectGoogle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { data: coach } = await supabase.from("coaches").select("id").eq("user_id", userId).maybeSingle();
    if (!coach) throw new Error("Not a coach");
    await supabase.from("google_calendar_connections").delete().eq("coach_id", coach.id);
    return { ok: true };
  });

export const listMyCalendars = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { gcalListCalendars } = await import("./google-cal.server");
    // Let failures propagate so the UI can distinguish "list failed to load"
    // from "saved calendar is genuinely missing from the account".
    return await gcalListCalendars();
  });

export const setSelectedCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ calendar_id: z.string(), calendar_name: z.string().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: coach } = await supabase.from("coaches").select("id").eq("user_id", userId).maybeSingle();
    if (!coach) throw new Error("No coach profile is linked to your account, so the calendar selection can't be saved.");
    // Verified caller (own coach row). The table has UPDATE/SELECT/DELETE
    // policies but no INSERT policy, so first-time selections can only be
    // written with the service role; scope the write to the caller's own row.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("google_calendar_connections").upsert({
      coach_id: coach.id,
      user_id: userId,
      selected_calendar_id: data.calendar_id,
      selected_calendar_name: data.calendar_name ?? null,
      status: "connected",
      last_synced_at: new Date().toISOString(),
      last_error: null,
    }, { onConflict: "coach_id" });
    if (error) throw error;
    return { ok: true };
  });

export const listGoogleEventsRange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    timeMin: z.string(),
    timeMax: z.string(),
    coach_id: z.string().uuid().optional().nullable(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    let coachId = data.coach_id ?? null;
    if (!coachId) {
      const { data: c } = await supabase.from("coaches").select("id").eq("user_id", userId).maybeSingle();
      coachId = c?.id ?? null;
    }
    const { gcalListEvents } = await import("./google-cal.server");
    try {
      return await gcalListEvents(coachId, data.timeMin, data.timeMax);
    } catch {
      return [];
    }
  });

export const getGoogleBusy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    timeMin: z.string(),
    timeMax: z.string(),
    coach_id: z.string().uuid().optional().nullable(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    let coachId = data.coach_id ?? null;
    if (!coachId) {
      const { data: c } = await supabase.from("coaches").select("id").eq("user_id", userId).maybeSingle();
      coachId = c?.id ?? null;
    }
    const { gcalFreeBusy } = await import("./google-cal.server");
    try {
      return await gcalFreeBusy(coachId ?? "", data.timeMin, data.timeMax);
    } catch {
      return [];
    }
  });