import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SaveEventSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1),
  event_type: z.string(),
  event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start_time: z.string().nullable().optional(),
  end_time: z.string().nullable().optional(),
  timezone: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  client_facing_notes: z.string().nullable().optional(),
  internal_notes: z.string().nullable().optional(),
  importance: z.string(),
  status: z.string(),
  audience_scope: z.string(),
  google_calendar_transparency: z.enum(["transparent", "opaque"]).default("transparent"),
});

function nextDate(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function addOneHour(date: string, time: string) {
  const [h, m] = time.split(":").map((v) => Number(v));
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0);
  d.setUTCHours(d.getUTCHours() + 1);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

function gcalPayloadForEvent(event: z.infer<typeof SaveEventSchema>) {
  const timezone = event.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Toronto";
  const description = [event.description, event.client_facing_notes].filter(Boolean).join("\n\n") || undefined;
  if (event.start_time) {
    const endTime = event.end_time || addOneHour(event.event_date, event.start_time);
    return {
      summary: event.name,
      description,
      startISO: `${event.event_date}T${event.start_time.slice(0, 5)}:00`,
      endISO: `${event.event_date}T${endTime.slice(0, 5)}:00`,
      timezone,
      location: event.location || undefined,
      transparency: event.google_calendar_transparency,
    };
  }
  return {
    summary: event.name,
    description,
    startDate: event.event_date,
    endDate: nextDate(event.event_date),
    location: event.location || undefined,
    transparency: event.google_calendar_transparency,
  };
}

async function currentCoachId(supabase: any, userId: string): Promise<string | null> {
  const { data: coach } = await supabase
    .from("coaches")
    .select("id")
    .eq("user_id", userId)
    .eq("archived", false)
    .maybeSingle();
  return coach?.id ?? null;
}

export const createEventDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from("events")
      .insert({
        name: "New Event",
        event_date: today,
        status: "Draft",
        created_by: userId,
        google_calendar_transparency: "transparent",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: data.id as string };
  });

export const saveEventAndSyncCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SaveEventSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const patch = {
      name: data.name,
      event_type: data.event_type,
      event_date: data.event_date,
      start_time: data.start_time || null,
      end_time: data.end_time || null,
      timezone: data.timezone || null,
      location: data.location || null,
      description: data.description || null,
      client_facing_notes: data.client_facing_notes || null,
      internal_notes: data.internal_notes || null,
      importance: data.importance,
      status: data.status,
      audience_scope: data.audience_scope,
      google_calendar_transparency: data.google_calendar_transparency,
    };
    const { data: saved, error } = await supabase
      .from("events")
      .update(patch)
      .eq("id", data.id)
      .select("google_event_id")
      .single();
    if (error) throw new Error(error.message);

    try {
      const { gcalCreateEvent, gcalUpdateEvent } = await import("./google-cal.server");
      const coachId = await currentCoachId(supabase, userId);
      const payload = gcalPayloadForEvent(data);
      if (saved?.google_event_id) {
        const updated = await gcalUpdateEvent(coachId, saved.google_event_id, payload as any);
        await supabase.from("events").update({
          google_event_link: updated?.htmlLink ?? null,
          google_synced_at: new Date().toISOString(),
          google_sync_error: null,
        }).eq("id", data.id);
      } else {
        const created = await gcalCreateEvent(coachId, payload as any);
        if (created?.id) {
          await supabase.from("events").update({
            google_event_id: created.id,
            google_event_link: created.htmlLink ?? null,
            google_synced_at: new Date().toISOString(),
            google_sync_error: null,
          }).eq("id", data.id);
        }
      }
      return { ok: true, calendarSynced: true };
    } catch (e: any) {
      await supabase.from("events").update({
        google_sync_error: String(e?.message ?? e),
      }).eq("id", data.id);
      return { ok: true, calendarSynced: false, calendarError: String(e?.message ?? e) };
    }
  });

export const deleteEventAndCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: event } = await supabase.from("events").select("google_event_id").eq("id", data.id).maybeSingle();
    if (event?.google_event_id) {
      try {
        const { gcalDeleteEvent } = await import("./google-cal.server");
        await gcalDeleteEvent(await currentCoachId(supabase, userId), event.google_event_id);
      } catch {}
    }
    const { error } = await supabase.from("events").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });