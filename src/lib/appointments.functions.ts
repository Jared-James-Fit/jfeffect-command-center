import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const APPT_TYPES = [
  "Coaching Call","Check-In Call","Onboarding Call","Strategy Call",
  "Consultation","In-Person Session","Assessment","Nutrition Review",
  "Program Review","Custom",
] as const;

function defaultReminderOffsets(meetEnabled: boolean): number[] {
  return meetEnabled ? [1440, 120, 15] : [1440, 120];
}

async function getCoachIdForUser(supabase: any, userId: string): Promise<string | null> {
  const { data } = await supabase.from("coaches").select("id").eq("user_id", userId).maybeSingle();
  return data?.id ?? null;
}

async function isAdmin(supabase: any, userId: string): Promise<boolean> {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  return (data ?? []).some((r: any) => r.role === "admin");
}

async function scheduleReminders(opts: {
  appointmentId: string;
  startsAt: string;
  offsetsMinutes: number[];
  hasAttendee: boolean;
  hasHostPhone: boolean;
}) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const rows: any[] = [];
  const startMs = new Date(opts.startsAt).getTime();
  for (const off of opts.offsetsMinutes) {
    const scheduledFor = new Date(startMs - off * 60_000).toISOString();
    if (opts.hasAttendee) rows.push({ appointment_id: opts.appointmentId, audience: "attendee", offset_minutes: off, scheduled_for: scheduledFor });
    if (opts.hasHostPhone) rows.push({ appointment_id: opts.appointmentId, audience: "host", offset_minutes: off, scheduled_for: scheduledFor });
  }
  if (rows.length) await supabaseAdmin.from("appointment_reminders").insert(rows);
}

async function clearPendingReminders(appointmentId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("appointment_reminders").delete().eq("appointment_id", appointmentId).eq("status", "pending");
}

export const listAppointments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    range: z.enum(["today","upcoming","past","all"]).default("upcoming"),
    coachId: z.string().uuid().optional(),
  }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase } = context as any;
    let q = supabase.from("appointments")
      .select("*, host_coach:coaches!appointments_host_coach_id_fkey(id, full_name), client:clients(id, full_name, phone)")
      .order("starts_at", { ascending: true });
    const now = new Date().toISOString();
    if (data.range === "today") {
      const start = new Date(); start.setHours(0,0,0,0);
      const end = new Date(); end.setHours(23,59,59,999);
      q = q.gte("starts_at", start.toISOString()).lte("starts_at", end.toISOString());
    } else if (data.range === "upcoming") {
      q = q.gte("starts_at", now).neq("status","Cancelled");
    } else if (data.range === "past") {
      q = q.lt("starts_at", now).order("starts_at", { ascending: false });
    }
    if (data.coachId) q = q.eq("host_coach_id", data.coachId);
    const { data: rows, error } = await q.limit(200);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const getAppointment = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context as any;
    const { data: row, error } = await supabase
      .from("appointments")
      .select("*, host_coach:coaches!appointments_host_coach_id_fkey(id, full_name, phone), client:clients(id, full_name, phone, email)")
      .eq("id", data.id).maybeSingle();
    if (error) throw new Error(error.message);
    return row;
  });

const CreateInput = z.object({
  host_coach_id: z.string().uuid().optional(),
  client_id: z.string().uuid().nullable().optional(),
  external_name: z.string().trim().max(200).optional().nullable(),
  external_email: z.string().trim().email().optional().nullable().or(z.literal("")),
  external_phone: z.string().trim().max(40).optional().nullable(),
  appointment_type: z.enum(APPT_TYPES),
  title: z.string().trim().min(1).max(200),
  starts_at: z.string(),
  ends_at: z.string(),
  timezone: z.string().default("America/New_York"),
  location: z.string().trim().max(300).optional().nullable(),
  meet_enabled: z.boolean().default(false),
  attendee_notes: z.string().trim().max(2000).optional().nullable(),
  internal_notes: z.string().trim().max(2000).optional().nullable(),
  sms_reminders_enabled: z.boolean().default(true),
  reminder_offsets_minutes: z.array(z.number().int().positive()).optional(),
});

export const createAppointment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CreateInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    let coachId = data.host_coach_id ?? (await getCoachIdForUser(supabase, userId));
    if (!coachId) throw new Error("No host coach selected");

    // Resolve attendee info
    let attendeeEmail = data.external_email || null;
    let attendeeName = data.external_name || null;
    let attendeePhone = data.external_phone || null;
    if (data.client_id) {
      const { data: client } = await supabase.from("clients").select("full_name, email, phone").eq("id", data.client_id).maybeSingle();
      if (client) {
        attendeeName = attendeeName || client.full_name;
        attendeeEmail = attendeeEmail || client.email;
        attendeePhone = attendeePhone || client.phone;
      }
    }

    // Insert local appointment
    const { data: inserted, error } = await supabase.from("appointments").insert({
      host_coach_id: coachId,
      client_id: data.client_id || null,
      external_name: data.client_id ? null : attendeeName,
      external_email: data.client_id ? null : attendeeEmail,
      external_phone: data.client_id ? null : attendeePhone,
      appointment_type: data.appointment_type,
      title: data.title,
      starts_at: data.starts_at,
      ends_at: data.ends_at,
      timezone: data.timezone,
      location: data.location || null,
      attendee_notes: data.attendee_notes || null,
      internal_notes: data.internal_notes || null,
      sms_reminders_enabled: data.sms_reminders_enabled,
      source: "manual",
      created_by: userId,
    }).select("*").single();
    if (error) throw new Error(error.message);

    // Try to sync to Google
    let meetLink: string | null = null;
    let googleEventId: string | null = null;
    try {
      const { gcalCreateEvent } = await import("./google-cal.server");
      const created = await gcalCreateEvent(coachId, {
        summary: data.title,
        description: [data.attendee_notes, data.location ? `Location: ${data.location}` : null].filter(Boolean).join("\n\n") || undefined,
        startISO: data.starts_at,
        endISO: data.ends_at,
        timezone: data.timezone,
        location: data.location || undefined,
        attendees: attendeeEmail ? [{ email: attendeeEmail, displayName: attendeeName || undefined }] : undefined,
        meet: data.meet_enabled,
      });
      if (created) {
        googleEventId = created.id;
        meetLink = created.meetLink ?? null;
        await supabase.from("appointments").update({ google_event_id: googleEventId, meet_link: meetLink }).eq("id", inserted.id);
      }
    } catch (e: any) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("appointment_audit_log").insert({
        appointment_id: inserted.id, actor_user_id: userId, action: "google_sync_failed",
        details: { error: String(e?.message ?? e) },
      });
    }

    // Schedule reminders
    if (data.sms_reminders_enabled) {
      const offsets = data.reminder_offsets_minutes && data.reminder_offsets_minutes.length
        ? data.reminder_offsets_minutes
        : defaultReminderOffsets(data.meet_enabled);
      await scheduleReminders({
        appointmentId: inserted.id,
        startsAt: data.starts_at,
        offsetsMinutes: offsets,
        hasAttendee: !!attendeePhone,
        hasHostPhone: true, // attempt host reminder if coach has a phone; cron will skip if missing
      });
    }

    return { ...inserted, google_event_id: googleEventId, meet_link: meetLink };
  });

export const updateAppointment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CreateInput.partial().extend({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { id, ...patch } = data as any;
    const { data: existing } = await supabase.from("appointments").select("*").eq("id", id).maybeSingle();
    if (!existing) throw new Error("Appointment not found");
    const update: any = { ...patch };
    delete update.meet_enabled;
    delete update.reminder_offsets_minutes;
    const { data: updated, error } = await supabase.from("appointments").update(update).eq("id", id).select("*").single();
    if (error) throw new Error(error.message);

    if (existing.google_event_id) {
      try {
        const { gcalUpdateEvent } = await import("./google-cal.server");
        await gcalUpdateEvent(existing.host_coach_id, existing.google_event_id, {
          summary: updated.title,
          location: updated.location,
          start: { dateTime: updated.starts_at, timeZone: updated.timezone },
          end: { dateTime: updated.ends_at, timeZone: updated.timezone },
        });
      } catch (e: any) {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        await supabaseAdmin.from("appointment_audit_log").insert({
          appointment_id: id, actor_user_id: userId, action: "google_sync_failed",
          details: { phase: "update", error: String(e?.message ?? e) },
        });
      }
    }

    if (patch.starts_at && patch.starts_at !== existing.starts_at) {
      await clearPendingReminders(id);
      if (updated.sms_reminders_enabled) {
        await scheduleReminders({
          appointmentId: id,
          startsAt: updated.starts_at,
          offsetsMinutes: defaultReminderOffsets(!!updated.meet_link),
          hasAttendee: !!(updated.external_phone || updated.client_id),
          hasHostPhone: true,
        });
      }
    }
    return updated;
  });

export const cancelAppointment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), reason: z.string().max(500).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: existing } = await supabase.from("appointments").select("*").eq("id", data.id).maybeSingle();
    if (!existing) throw new Error("Appointment not found");
    const { error } = await supabase.from("appointments").update({
      status: "Cancelled",
      cancelled_at: new Date().toISOString(),
      cancelled_reason: data.reason || null,
    }).eq("id", data.id);
    if (error) throw new Error(error.message);
    if (existing.google_event_id) {
      try {
        const { gcalDeleteEvent } = await import("./google-cal.server");
        await gcalDeleteEvent(existing.host_coach_id, existing.google_event_id);
      } catch { /* logged below */ }
    }
    await clearPendingReminders(data.id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("appointment_audit_log").insert({
      appointment_id: data.id, actor_user_id: userId, action: "cancelled",
      details: { reason: data.reason || null },
    });
    return { ok: true };
  });

export const markAppointmentStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    id: z.string().uuid(),
    status: z.enum(["Scheduled","Completed","Cancelled","NoShow"]),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context as any;
    const { error } = await supabase.from("appointments").update({ status: data.status }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listMyPortalAppointments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { data: client } = await supabase.from("clients").select("id").eq("user_id", userId).maybeSingle();
    if (!client) return { upcoming: [], past: [] };
    const now = new Date().toISOString();
    const [{ data: upcoming }, { data: past }] = await Promise.all([
      supabase.from("appointments")
        .select("*, host_coach:coaches!appointments_host_coach_id_fkey(id, full_name)")
        .eq("client_id", client.id).gte("starts_at", now).neq("status","Cancelled").order("starts_at"),
      supabase.from("appointments")
        .select("*, host_coach:coaches!appointments_host_coach_id_fkey(id, full_name)")
        .eq("client_id", client.id).lt("starts_at", now).order("starts_at", { ascending: false }).limit(20),
    ]);
    return { upcoming: upcoming ?? [], past: past ?? [] };
  });

export { APPT_TYPES };

export const rescheduleAppointment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    id: z.string().uuid(),
    starts_at: z.string(),
    ends_at: z.string(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: existing } = await supabase.from("appointments").select("*").eq("id", data.id).maybeSingle();
    if (!existing) throw new Error("Appointment not found");

    // Permission: host coach, admin, or the client themselves (RLS will catch others, but be explicit)
    const { data: client } = await supabase.from("clients").select("id").eq("user_id", userId).maybeSingle();
    const isClientOwner = client && existing.client_id === client.id;
    const { data: coach } = await supabase.from("coaches").select("id").eq("user_id", userId).maybeSingle();
    const isCoach = coach && existing.host_coach_id === coach.id;
    const adminFlag = await isAdmin(supabase, userId);
    if (!isClientOwner && !isCoach && !adminFlag) throw new Error("Not allowed");

    const { data: updated, error } = await supabase.from("appointments").update({
      starts_at: data.starts_at,
      ends_at: data.ends_at,
      rescheduled_at: new Date().toISOString(),
      rescheduled_by: userId,
    }).eq("id", data.id).select("*").single();
    if (error) throw new Error(error.message);

    if (existing.google_event_id) {
      try {
        const { gcalUpdateEvent } = await import("./google-cal.server");
        await gcalUpdateEvent(existing.host_coach_id, existing.google_event_id, {
          start: { dateTime: data.starts_at, timeZone: existing.timezone },
          end: { dateTime: data.ends_at, timeZone: existing.timezone },
        });
      } catch (e: any) {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        await supabaseAdmin.from("appointment_audit_log").insert({
          appointment_id: data.id, actor_user_id: userId, action: "google_sync_failed",
          details: { phase: "reschedule", error: String(e?.message ?? e) },
        });
      }
    }

    await clearPendingReminders(data.id);
    if (updated.sms_reminders_enabled) {
      await scheduleReminders({
        appointmentId: data.id,
        startsAt: data.starts_at,
        offsetsMinutes: defaultReminderOffsets(!!updated.meet_link),
        hasAttendee: !!(updated.external_phone || updated.client_id),
        hasHostPhone: true,
      });
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("appointment_audit_log").insert({
      appointment_id: data.id, actor_user_id: userId, action: "rescheduled",
      details: { from: existing.starts_at, to: data.starts_at, by_role: isClientOwner ? "client" : isCoach ? "coach" : "admin" },
    });
    return updated;
  });

/** Upcoming appointments for the bell (next 24h). */
export const listUpcomingForBell = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context as any;
    const now = new Date();
    const end = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const { data } = await supabase.from("appointments")
      .select("id, title, starts_at, meet_link, status, host_coach:coaches!appointments_host_coach_id_fkey(full_name), client:clients(full_name)")
      .gte("starts_at", now.toISOString())
      .lte("starts_at", end.toISOString())
      .neq("status", "Cancelled")
      .order("starts_at")
      .limit(10);
    return data ?? [];
  });