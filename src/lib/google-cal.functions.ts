import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getGoogleConnectionStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { data: coach } = await supabase.from("coaches").select("id, full_name").eq("user_id", userId).maybeSingle();
    if (!coach) return { connected: false, isCoach: false } as any;
    const { data: conn } = await supabase.from("google_calendar_connections").select("*").eq("coach_id", coach.id).maybeSingle();
    return {
      isCoach: true,
      coachId: coach.id,
      connected: conn?.status === "connected",
      status: conn?.status ?? "disconnected",
      email: conn?.google_account_email ?? null,
      calendarId: conn?.selected_calendar_id ?? null,
      calendarName: conn?.selected_calendar_name ?? null,
      lastSyncedAt: conn?.last_synced_at ?? null,
      lastError: conn?.last_error ?? null,
    };
  });

export const beginGoogleConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ origin: z.string().url() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: coach } = await supabase.from("coaches").select("id").eq("user_id", userId).maybeSingle();
    if (!coach) throw new Error("Only coaches/admins can connect a Google calendar");
    const { signOAuthState, buildAuthorizeUrl } = await import("./google-cal.server");
    if (!process.env.GOOGLE_OAUTH_CLIENT_ID) throw new Error("Google OAuth not configured");
    const state = signOAuthState({ coach_id: coach.id, user_id: userId });
    return { url: buildAuthorizeUrl(data.origin, state) };
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
    const { supabase, userId } = context as any;
    const { data: coach } = await supabase.from("coaches").select("id").eq("user_id", userId).maybeSingle();
    if (!coach) return [];
    const { getValidAccessTokenForCoach, gcalListCalendars } = await import("./google-cal.server");
    const cred = await getValidAccessTokenForCoach(coach.id);
    if (!cred) return [];
    return await gcalListCalendars(cred.token);
  });

export const setSelectedCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ calendar_id: z.string(), calendar_name: z.string().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: coach } = await supabase.from("coaches").select("id").eq("user_id", userId).maybeSingle();
    if (!coach) throw new Error("Not a coach");
    await supabase.from("google_calendar_connections").update({
      selected_calendar_id: data.calendar_id,
      selected_calendar_name: data.calendar_name ?? null,
      last_synced_at: new Date().toISOString(),
    }).eq("coach_id", coach.id);
    return { ok: true };
  });