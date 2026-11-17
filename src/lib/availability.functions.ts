import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { addDaysISO, localDateISO, wallTimeToUtc } from "@/lib/schedule-time";

/**
 * Smart availability, the coach's side (Calendar → Booking → Availability).
 * Staff only: the caller's own login must be able to read the settings row
 * (RLS: coaches and admins), and only then does the server read the calendar
 * with the service role, the same way the booking page does, so the preview
 * is exactly what people can book.
 */

const DateISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const PreviewInput = z.object({
  weekStart: DateISO,
  typeId: z.string().uuid().optional().nullable(),
  /** Also read the last 8 weeks for recurring habits (the setup asks for this). */
  habits: z.boolean().optional(),
});

export type PreviewBusy = { start: number; end: number; kind: string; label: string };

export const getAvailabilityPreview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PreviewInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context as any;
    const { data: mine, error: denied } = await supabase.from("booking_availability").select("id").eq("id", true).maybeSingle();
    if (denied || !mine) throw new Error("Only coaches can see availability.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const {
      loadAvailabilitySettings,
      loadAvailabilityOverrides,
      smartPlan,
      loadBusy,
      bookingHost,
      BookingError,
    } = await import("@/lib/booking.server");
    const { learnFromOverrides, recurringBlocks } = await import("@/lib/smart-availability");

    const settings = await loadAvailabilitySettings(db);
    const tz = settings.timezone;
    const from = data.weekStart;
    const to = addDaysISO(from, 6);

    // The type to preview: the one asked for, else the first call type that follows it.
    const { data: types } = await db
      .from("booking_cards")
      .select("*")
      .eq("is_active", true)
      .order("sort_order");
    const smartTypes = ((types ?? []) as any[]).filter((t) => t.follows_smart);
    const picked = (data.typeId ? ((types ?? []) as any[]).find((t) => t.id === data.typeId) : null) ?? smartTypes[0] ?? null;
    const type = picked
      ? { ...picked, hours: [] }
      : {
          id: "preview",
          name: "30-min call",
          duration_minutes: 30,
          buffer_minutes: 0,
          min_notice_hours: 0,
          max_advance_days: 60,
          max_per_day: null,
          hours: [],
        };
    if (picked) {
      const { data: hours } = await db
        .from("booking_card_hours")
        .select("day_of_week, start_time, end_time")
        .eq("booking_card_id", picked.id);
      type.hours = ((hours ?? []) as any[]).map((h) => ({
        day_of_week: Number(h.day_of_week),
        start_time: String(h.start_time).slice(0, 5),
        end_time: String(h.end_time).slice(0, 5),
      }));
    }

    let plan;
    let calendarError: string | null = null;
    try {
      plan = await smartPlan(db, type as any, from, to, new Date(), settings);
    } catch (e) {
      if (e instanceof BookingError && e.code === "calendar_unavailable") {
        calendarError = "Google Calendar couldn't be read just now, so nothing would be offered. Try again in a minute.";
        plan = null;
      } else throw e;
    }

    // What's on, for the picture: who for sessions and appointments, "Busy" for Google (never its title).
    const fromISO = wallTimeToUtc(from, "00:00", tz).toISOString();
    const toISO = wallTimeToUtc(addDaysISO(to, 1), "00:00", tz).toISOString();
    const [sessions, appts] = await Promise.all([
      db
        .from("pt_sessions")
        .select("starts_at, ends_at, session_type, status, client:clients(full_name)")
        .in("status", ["Scheduled", "Completed"])
        .gte("starts_at", fromISO)
        .lt("starts_at", toISO),
      db
        .from("appointments")
        .select("starts_at, ends_at, title, external_name, status, client:clients(full_name)")
        .in("status", ["Scheduled", "Completed"])
        .gte("starts_at", fromISO)
        .lt("starts_at", toISO),
    ]);
    const first = (n: string | null | undefined) => (n ?? "").trim().split(/\s+/)[0] || null;
    const busy: PreviewBusy[] = [];
    for (const s of (sessions.data ?? []) as any[])
      busy.push({ start: Date.parse(s.starts_at), end: Date.parse(s.ends_at), kind: "session", label: first(s.client?.full_name) ?? s.session_type ?? "Session" });
    for (const a of (appts.data ?? []) as any[])
      busy.push({ start: Date.parse(a.starts_at), end: Date.parse(a.ends_at), kind: "appointment", label: first(a.client?.full_name) ?? first(a.external_name) ?? "Call" });
    let calendarBusy: Array<{ start: number; end: number; kind: string }> = [];
    let habits: ReturnType<typeof recurringBlocks> = [];
    const host = await bookingHost(db);
    try {
      calendarBusy = (await loadBusy(db, Date.parse(fromISO), Date.parse(toISO), tz, host.id)).filter(
        (b) => b.kind === "google" || b.kind === "event",
      );
      if (data.habits) {
        const back = addDaysISO(localDateISO(new Date(), tz), -56);
        const past = await loadBusy(db, wallTimeToUtc(back, "00:00", tz).getTime(), Date.now(), tz, host.id);
        habits = recurringBlocks(past, settings, 8);
      }
    } catch (e) {
      if (!(e instanceof BookingError)) throw e;
    }
    for (const b of calendarBusy) busy.push({ ...b, label: b.kind === "event" ? "Event" : "Busy" });

    const overrides = await loadAvailabilityOverrides(db, addDaysISO(from, -70), addDaysISO(to, 35));
    const learned = learnFromOverrides(overrides, settings, localDateISO(new Date(), tz));

    return {
      settings,
      type: picked ? { id: picked.id, name: picked.name, durationMin: picked.duration_minutes } : null,
      smartTypes: smartTypes.map((t) => ({ id: t.id, name: t.name, online: !!t.online_enabled })),
      from,
      to,
      days: plan
        ? plan.days.map((d) => ({
            date: d.date,
            how: d.how,
            windows: d.windows,
            suggested: d.suggested,
            reason: d.reason,
            protectedTimes: d.protectedTimes,
            slotCount: d.slots.length,
            callsBooked: d.callsBooked,
            closed: d.closed,
          }))
        : [],
      busy: busy.filter((b) => Number.isFinite(b.start) && Number.isFinite(b.end)),
      overrides: overrides.filter((o) => o.date >= from && o.date <= to),
      learned,
      habits,
      calendarError,
    };
  });

/** His Google calendars, for "also block these" (names and ids only). */
export const listBlockingCalendars = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context as any;
    const { data: mine } = await supabase.from("booking_availability").select("id").eq("id", true).maybeSingle();
    if (!mine) throw new Error("Only coaches can see availability.");
    const { gcalListCalendars, workspaceCalendarConfigured } = await import("@/lib/google-cal.server");
    if (!workspaceCalendarConfigured()) return [];
    try {
      const list = await gcalListCalendars();
      return list.map((c) => ({ id: c.id, name: c.summary, primary: !!c.primary }));
    } catch {
      return [];
    }
  });
