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
    const { data: conn } = await supabase.from("google_calendar_connections").select("*").eq("coach_id", coach.id).maybeSingle();
    return {
      isCoach: true,
      mode: "workspace" as const,
      coachId: coach.id,
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
  .handler(async ({ data, context }) => {
    // Workspace mode: per-coach OAuth is disabled; the workspace Google
    // Calendar connector is shared across all coaches.
    throw new Error("Google Calendar is connected at the workspace level via the Lovable connector. Manage it in Project Settings → Connectors.");
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
    try {
      return await gcalListCalendars();
    } catch {
      return [];
    }
  });

export const setSelectedCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ calendar_id: z.string(), calendar_name: z.string().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: coach } = await supabase.from("coaches").select("id").eq("user_id", userId).maybeSingle();
    if (!coach) throw new Error("Not a coach");
    await supabase.from("google_calendar_connections").upsert({
      coach_id: coach.id,
      user_id: userId,
      selected_calendar_id: data.calendar_id,
      selected_calendar_name: data.calendar_name ?? null,
      status: "connected",
      last_synced_at: new Date().toISOString(),
      last_error: null,
    }, { onConflict: "coach_id" });
    return { ok: true };
  });