import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const APPT_TYPES = [
  "Coaching Call","Check-In Call","Onboarding Call","Strategy Call",
  "Consultation","In-Person Session","Assessment","Nutrition Review",
  "Program Review","Custom",
] as const;

function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || `link-${Date.now()}`;
}

const BookingLinkInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(1000).optional().nullable(),
  appointment_type: z.enum(APPT_TYPES),
  host_coach_id: z.string().uuid().optional(),
  duration_minutes: z.number().int().min(5).max(480).default(30),
  buffer_before_minutes: z.number().int().min(0).max(240).default(0),
  buffer_after_minutes: z.number().int().min(0).max(240).default(0),
  max_per_day: z.number().int().min(0).max(50).optional().nullable(),
  min_notice_hours: z.number().int().min(0).max(720).default(2),
  max_advance_days: z.number().int().min(1).max(365).default(60),
  timezone: z.string().default("America/New_York"),
  meet_enabled: z.boolean().default(true),
  collect_phone: z.boolean().default(true),
  collect_notes: z.boolean().default(true),
  sms_reminders_enabled: z.boolean().default(true),
  allow_reschedule: z.boolean().default(true),
  allow_cancel: z.boolean().default(true),
  active: z.boolean().default(true),
  availability: z.array(z.object({
    day_of_week: z.number().int().min(0).max(6),
    start_time: z.string(), // HH:MM
    end_time: z.string(),
  })).default([]),
});

export const listBookingLinks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context as any;
    const { data, error } = await supabase.from("booking_links")
      .select("*, host_coach:coaches!booking_links_host_coach_id_fkey(id, full_name), availability:booking_link_availability(*)")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertBookingLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => BookingLinkInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    let coachId = data.host_coach_id;
    if (!coachId) {
      const { data: c } = await supabase.from("coaches").select("id").eq("user_id", userId).maybeSingle();
      coachId = c?.id;
    }
    if (!coachId) throw new Error("Host coach required");

    const slug = data.id
      ? undefined
      : await uniqueSlug(supabase, slugify(data.name));

    const payload: any = {
      name: data.name,
      description: data.description ?? null,
      appointment_type: data.appointment_type,
      host_coach_id: coachId,
      duration_minutes: data.duration_minutes,
      buffer_before_minutes: data.buffer_before_minutes,
      buffer_after_minutes: data.buffer_after_minutes,
      max_per_day: data.max_per_day ?? null,
      min_notice_hours: data.min_notice_hours,
      max_advance_days: data.max_advance_days,
      timezone: data.timezone,
      meet_enabled: data.meet_enabled,
      collect_phone: data.collect_phone,
      collect_notes: data.collect_notes,
      sms_reminders_enabled: data.sms_reminders_enabled,
      allow_reschedule: data.allow_reschedule,
      allow_cancel: data.allow_cancel,
      active: data.active,
    };
    if (!data.id) payload.slug = slug;
    if (!data.id) payload.created_by = userId;

    let row;
    if (data.id) {
      const { data: updated, error } = await supabase.from("booking_links").update(payload).eq("id", data.id).select("*").single();
      if (error) throw new Error(error.message);
      row = updated;
      await supabase.from("booking_link_availability").delete().eq("booking_link_id", data.id);
    } else {
      const { data: inserted, error } = await supabase.from("booking_links").insert(payload).select("*").single();
      if (error) throw new Error(error.message);
      row = inserted;
    }
    if (data.availability.length) {
      await supabase.from("booking_link_availability").insert(
        data.availability.map((a) => ({ booking_link_id: row.id, ...a }))
      );
    }
    return row;
  });

async function uniqueSlug(supabase: any, base: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const { data } = await supabase.from("booking_links").select("id").eq("slug", candidate).maybeSingle();
    if (!data) return candidate;
  }
  return `${base}-${Date.now()}`;
}

export const deleteBookingLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context as any;
    const { error } = await supabase.from("booking_links").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// PUBLIC — no auth required, uses service role
export const getBookingLinkPublic = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ slug: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: link } = await supabaseAdmin.from("booking_links")
      .select("id, slug, name, description, appointment_type, duration_minutes, buffer_before_minutes, buffer_after_minutes, max_per_day, min_notice_hours, max_advance_days, timezone, meet_enabled, collect_phone, collect_notes, active, host_coach_id")
      .eq("slug", data.slug).eq("active", true).maybeSingle();
    if (!link) return null;
    const { data: coach } = await supabaseAdmin.from("coaches").select("id, full_name").eq("id", link.host_coach_id).maybeSingle();
    const { data: availability } = await supabaseAdmin.from("booking_link_availability").select("day_of_week, start_time, end_time").eq("booking_link_id", link.id);
    return { link, coach, availability: availability ?? [] };
  });

// Compute free slots for a date (YYYY-MM-DD in link timezone) — simple, treats stored times as local to link timezone.
export const computeAvailableSlots = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ slug: z.string(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: link } = await supabaseAdmin.from("booking_links")
      .select("*, availability:booking_link_availability(*)")
      .eq("slug", data.slug).eq("active", true).maybeSingle();
    if (!link) return { slots: [] };

    const [y, m, d] = data.date.split("-").map(Number);
    const dayDate = new Date(Date.UTC(y, m - 1, d));
    const dow = dayDate.getUTCDay();
    const windows = (link.availability as any[]).filter((a) => a.day_of_week === dow);
    if (!windows.length) return { slots: [] };

    const dur = link.duration_minutes;
    const bufBefore = link.buffer_before_minutes || 0;
    const bufAfter = link.buffer_after_minutes || 0;
    const minNoticeMs = (link.min_notice_hours || 0) * 60 * 60 * 1000;
    const earliest = Date.now() + minNoticeMs;

    // Build candidate slots as ISO strings (UTC); assume link timezone is the local time entered.
    // For v1: use naïve mapping where the date+time strings are interpreted in UTC and shifted by the timezone offset
    // computed via Intl. This avoids extra dependencies. Good enough for typical US timezones.
    function toZonedISO(dateStr: string, hhmm: string, tz: string): string {
      // Build wall clock date in tz: compute offset for that instant
      const [hh, mm] = hhmm.split(":").map(Number);
      // Start with a UTC guess
      const guess = new Date(`${dateStr}T${hhmm}:00Z`).getTime();
      const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
      const parts = fmt.formatToParts(new Date(guess));
      const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
      const tzTime = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
      const offset = guess - tzTime;
      return new Date(guess + offset).toISOString();
    }

    const candidates: { startISO: string; endISO: string; label: string }[] = [];
    for (const w of windows) {
      const [sh, sm] = String(w.start_time).slice(0, 5).split(":").map(Number);
      const [eh, em] = String(w.end_time).slice(0, 5).split(":").map(Number);
      let cur = sh * 60 + sm;
      const end = eh * 60 + em;
      while (cur + dur <= end) {
        const hh = String(Math.floor(cur / 60)).padStart(2, "0");
        const mm = String(cur % 60).padStart(2, "0");
        const startISO = toZonedISO(data.date, `${hh}:${mm}`, link.timezone);
        const endISO = new Date(new Date(startISO).getTime() + dur * 60_000).toISOString();
        candidates.push({ startISO, endISO, label: `${hh}:${mm}` });
        cur += dur;
      }
    }

    // Filter by min notice + existing appointments + Google busy
    const dayStart = new Date(`${data.date}T00:00:00Z`).toISOString();
    const dayEnd = new Date(`${data.date}T23:59:59Z`).toISOString();
    const { data: existing } = await supabaseAdmin.from("appointments")
      .select("starts_at, ends_at, status")
      .eq("host_coach_id", link.host_coach_id)
      .gte("starts_at", dayStart).lte("starts_at", dayEnd)
      .neq("status", "Cancelled");

    let googleBusy: Array<{ start: string; end: string }> = [];
    try {
      const { gcalFreeBusy } = await import("./google-cal.server");
      googleBusy = await gcalFreeBusy(link.host_coach_id, dayStart, dayEnd);
    } catch { /* ignore */ }

    function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number) {
      return aStart < bEnd && bStart < aEnd;
    }
    const filtered = candidates.filter((c) => {
      const startMs = new Date(c.startISO).getTime();
      const endMs = new Date(c.endISO).getTime();
      if (startMs < earliest) return false;
      const occupiedStart = startMs - bufBefore * 60_000;
      const occupiedEnd = endMs + bufAfter * 60_000;
      for (const ex of existing ?? []) {
        if (overlaps(occupiedStart, occupiedEnd, new Date(ex.starts_at).getTime(), new Date(ex.ends_at).getTime())) return false;
      }
      for (const b of googleBusy) {
        if (overlaps(occupiedStart, occupiedEnd, new Date(b.start).getTime(), new Date(b.end).getTime())) return false;
      }
      return true;
    });

    // Enforce max per day
    if (link.max_per_day) {
      const { count } = await supabaseAdmin.from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("host_coach_id", link.host_coach_id)
        .eq("booking_link_id", link.id)
        .gte("starts_at", dayStart).lte("starts_at", dayEnd)
        .neq("status","Cancelled");
      if ((count ?? 0) >= link.max_per_day) return { slots: [] };
    }

    return { slots: filtered };
  });

// PUBLIC booking
export const bookSlotPublic = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({
    slug: z.string(),
    starts_at: z.string(),
    name: z.string().trim().min(1).max(200),
    email: z.string().trim().email(),
    phone: z.string().trim().max(40).optional().nullable(),
    notes: z.string().trim().max(2000).optional().nullable(),
  }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: link } = await supabaseAdmin.from("booking_links").select("*").eq("slug", data.slug).eq("active", true).maybeSingle();
    if (!link) throw new Error("Booking link not found");
    const startMs = new Date(data.starts_at).getTime();
    if (Number.isNaN(startMs)) throw new Error("Invalid start time");
    const endMs = startMs + link.duration_minutes * 60_000;

    // Re-verify availability
    const { data: clash } = await supabaseAdmin.from("appointments")
      .select("id").eq("host_coach_id", link.host_coach_id)
      .lt("starts_at", new Date(endMs + link.buffer_after_minutes * 60_000).toISOString())
      .gt("ends_at", new Date(startMs - link.buffer_before_minutes * 60_000).toISOString())
      .neq("status","Cancelled");
    if (clash && clash.length) throw new Error("That time was just taken. Please pick another slot.");

    // Try to match an existing client by email
    let clientId: string | null = null;
    const { data: matched } = await supabaseAdmin.from("clients").select("id, phone, full_name").ilike("email", data.email).maybeSingle();
    if (matched) clientId = matched.id;

    const title = `${link.appointment_type} with ${data.name}`;
    const { data: appt, error } = await supabaseAdmin.from("appointments").insert({
      host_coach_id: link.host_coach_id,
      client_id: clientId,
      external_name: clientId ? null : data.name,
      external_email: clientId ? null : data.email,
      external_phone: clientId ? null : (data.phone || null),
      appointment_type: link.appointment_type,
      title,
      starts_at: new Date(startMs).toISOString(),
      ends_at: new Date(endMs).toISOString(),
      timezone: link.timezone,
      attendee_notes: data.notes || null,
      sms_reminders_enabled: link.sms_reminders_enabled,
      source: "booking_link",
      booking_link_id: link.id,
    }).select("*").single();
    if (error) throw new Error(error.message);

    let meetLink: string | null = null;
    try {
      const { gcalCreateEvent } = await import("./google-cal.server");
      const created = await gcalCreateEvent(link.host_coach_id, {
        summary: title,
        description: data.notes || undefined,
        startISO: appt.starts_at,
        endISO: appt.ends_at,
        timezone: link.timezone,
        attendees: [{ email: data.email, displayName: data.name }],
        meet: link.meet_enabled,
      });
      if (created) {
        meetLink = created.meetLink ?? null;
        await supabaseAdmin.from("appointments").update({ google_event_id: created.id, meet_link: meetLink }).eq("id", appt.id);
      }
    } catch (e: any) {
      await supabaseAdmin.from("appointment_audit_log").insert({
        appointment_id: appt.id, action: "google_sync_failed",
        details: { source: "public_booking", error: String(e?.message ?? e) },
      });
    }

    if (link.sms_reminders_enabled) {
      const offsets: number[] = (link.reminder_offsets_minutes as any) || [1440, 120];
      const rows: any[] = [];
      for (const off of offsets) {
        const scheduledFor = new Date(startMs - off * 60_000).toISOString();
        if (data.phone) rows.push({ appointment_id: appt.id, audience: "attendee", offset_minutes: off, scheduled_for: scheduledFor });
        rows.push({ appointment_id: appt.id, audience: "host", offset_minutes: off, scheduled_for: scheduledFor });
      }
      if (rows.length) await supabaseAdmin.from("appointment_reminders").insert(rows);
    }

    return { id: appt.id, starts_at: appt.starts_at, meet_link: meetLink };
  });