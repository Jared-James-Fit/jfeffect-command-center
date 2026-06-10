import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_calendar/calendar/v3";

async function ensureCoachOrAdmin(supabase: any, userId: string) {
  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const isAdmin = (roles ?? []).some((r: any) => r.role === "admin");
  if (isAdmin) return;
  const { data: coach } = await supabase
    .from("coaches")
    .select("id")
    .eq("user_id", userId)
    .eq("archived", false)
    .eq("status", "Active")
    .maybeSingle();
  if (!coach) throw new Error("Only coaches or admins can create Google Meet links.");
}

export const createMeetLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { summary?: string; durationMinutes?: number }) =>
    z.object({
      summary: z.string().trim().max(200).optional(),
      durationMinutes: z.number().int().min(15).max(240).optional(),
    }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await ensureCoachOrAdmin(supabase, userId);

    const lovableKey = process.env.LOVABLE_API_KEY;
    const calendarKey = process.env.GOOGLE_CALENDAR_API_KEY;
    if (!lovableKey) throw new Error("LOVABLE_API_KEY missing");
    if (!calendarKey) throw new Error("Google Calendar is not connected.");

    const startsAt = new Date(Date.now() + 60_000);
    const endsAt = new Date(startsAt.getTime() + (data.durationMinutes ?? 30) * 60_000);
    const requestId = (globalThis.crypto?.randomUUID?.() ?? `req-${Date.now()}-${Math.random()}`);

    const url = `${GATEWAY_URL}/calendars/primary/events?conferenceDataVersion=1&sendUpdates=none`;
    const body = {
      summary: data.summary?.trim() || "Quick Google Meet",
      description: "Generated from chat.",
      start: { dateTime: startsAt.toISOString(), timeZone: "UTC" },
      end: { dateTime: endsAt.toISOString(), timeZone: "UTC" },
      conferenceData: {
        createRequest: {
          requestId,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
      reminders: { useDefault: false },
      visibility: "private",
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": calendarKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const out: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(out?.error?.message || `Google Calendar error (${res.status})`);
    }
    const meetUrl: string | undefined =
      out?.hangoutLink ||
      out?.conferenceData?.entryPoints?.find?.((e: any) => e?.entryPointType === "video")?.uri;
    if (!meetUrl) throw new Error("Google did not return a Meet link. Try again.");
    return { meetUrl, eventId: out?.id as string | undefined };
  });