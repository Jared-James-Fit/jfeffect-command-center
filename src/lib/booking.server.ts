// Server-only: online booking (public booking page and signed-in clients).
// Never import from client code; load inside server function handlers.
//
// What's open = the type's weekly hours, minus anything busy: scheduled
// sessions, live appointments, timed events, and the coach's Google calendars
// (the one the app writes to + their main one). The final booking holds the
// time (booking_slot_claims), re-runs the same check for that exact time, then
// writes, so a slot that filled meanwhile is refused and two people can't take
// the same one.
//
// Who books decides what is created:
//   * a client we can trust is them (signed in, or a personal link the coach
//     sent) -> a session: their credits, their app, evening-before text
//   * anyone else, including someone typing a client's email -> an
//     appointment (no credits touched; it's linked to the client the email
//     matches so it still shows in their app)
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  bookableDays,
  computeSlots,
  isOpenSlot,
  type BookingRules,
  type BusyInterval,
  type Slot,
} from "@/lib/booking-slots";
import {
  audienceAllows,
  bookedLocation,
  isTrainingSessionType,
  locationLabel,
  type BookingType,
} from "@/lib/booking-types";
import {
  isHardOpen,
  planAvailability,
  sanitizeAvailability,
  type AvailabilityOverride,
  type AvailabilityPlan,
  type AvailabilitySettings,
  type BusyItem,
} from "@/lib/smart-availability";
import { googleBusyForBooking } from "@/lib/session-conflicts";
import { INVITE_DAYS } from "@/lib/booking-invite";
import {
  addDaysISO,
  DEFAULT_TZ,
  fmtClock,
  fmtDayLabel,
  localDateISO,
  localTimeHM,
  wallTimeToUtc,
} from "@/lib/schedule-time";

type Admin = SupabaseClient<any, any, any>;

export class BookingError extends Error {
  constructor(
    public code: "not_found" | "taken" | "calendar_unavailable" | "too_many" | "invalid" | "busy",
    message: string,
  ) {
    super(message);
  }
}

/** Most open bookings one email can hold on one type through the public link. */
const PUBLIC_OPEN_LIMIT = 3;
/** Most public-link bookings across everything in an hour (stops a flood). */
const PUBLIC_HOURLY_LIMIT = 20;
/** Widest range one slots request may cover. */
export const MAX_RANGE_DAYS = 45;
/** A hold older than this is a leftover from a failed request. */
const CLAIM_STALE_MS = 2 * 60_000;

export function rulesOf(t: BookingType): BookingRules {
  return {
    durationMin: t.duration_minutes,
    timezone: t.timezone || DEFAULT_TZ,
    minNoticeHours: t.min_notice_hours ?? 12,
    maxAdvanceDays: t.max_advance_days ?? 60,
    bufferMin: t.buffer_minutes ?? 0,
    maxPerDay: t.max_per_day ?? null,
  };
}

/** A live booking type by its link (null when missing, paused or not online). */
export async function loadBookingType(admin: Admin, slug: string): Promise<BookingType | null> {
  const clean = String(slug || "")
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(clean)) return null;
  const { data } = await admin.from("booking_cards").select("*").eq("slug", clean).maybeSingle();
  return liveType(admin, data);
}

/** A live booking type by its id (a personal link names its type by id, so a renamed link still works). */
export async function loadBookingTypeById(admin: Admin, id: string): Promise<BookingType | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await admin.from("booking_cards").select("*").eq("id", id).maybeSingle();
  return liveType(admin, data);
}

async function liveType(admin: Admin, data: unknown): Promise<BookingType | null> {
  if (!data || !(data as any).is_active || !(data as any).online_enabled || !(data as any).slug) return null;
  const [{ data: hours }, settings] = await Promise.all([
    admin
      .from("booking_card_hours" as any)
      .select("day_of_week, start_time, end_time")
      .eq("booking_card_id", (data as any).id),
    (data as any).follows_smart ? loadAvailabilitySettings(admin) : Promise.resolve(null),
  ]);
  const smart = !!settings?.confirmedAt;
  return {
    ...(data as any),
    // A type that follows his availability is shown and worked out in his zone.
    timezone: smart ? settings!.timezone : (data as any).timezone,
    smart,
    hours: ((hours ?? []) as any[]).map((h) => ({
      day_of_week: Number(h.day_of_week),
      start_time: String(h.start_time).slice(0, 5),
      end_time: String(h.end_time).slice(0, 5),
    })),
  } as BookingType;
}

// ── Smart availability ───────────────────────────────────────────────────────

/** The coach's availability settings (defaults when the row is missing or unreadable). */
export async function loadAvailabilitySettings(admin: Admin): Promise<AvailabilitySettings> {
  const { data } = await admin.from("booking_availability" as any).select("settings").eq("id", true).maybeSingle();
  return sanitizeAvailability((data as any)?.settings ?? {});
}

/** His changes for single dates in [from, to]. */
export async function loadAvailabilityOverrides(admin: Admin, from: string, to: string): Promise<AvailabilityOverride[]> {
  const { data, error } = await admin
    .from("booking_availability_overrides" as any)
    .select("id, date, kind, start_time, end_time, note, created_at")
    .gte("date", from)
    .lte("date", to)
    .order("created_at");
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).map((o) => ({
    id: o.id,
    date: String(o.date),
    kind: o.kind,
    start: o.start_time ? String(o.start_time).slice(0, 5) : null,
    end: o.end_time ? String(o.end_time).slice(0, 5) : null,
    note: o.note ?? null,
    created_at: o.created_at ?? null,
  }));
}

/** Monday of a yyyy-mm-dd week. */
function mondayOf(date: string): string {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDaysISO(date, -((dow + 6) % 7));
}

/**
 * Calls already booked in [from, to] (his zone): every live appointment and
 * every session that isn't training. They count toward the daily and weekly
 * call limits.
 */
export async function loadBookedCalls(
  admin: Admin,
  from: string,
  to: string,
  tz: string,
): Promise<Array<{ start: number; end: number; typeId: string | null }>> {
  const fromISO = wallTimeToUtc(from, "00:00", tz).toISOString();
  const toISO = wallTimeToUtc(addDaysISO(to, 1), "00:00", tz).toISOString();
  const [sessions, appts] = await Promise.all([
    admin
      .from("pt_sessions")
      .select("starts_at, ends_at, session_type, booking_card_id")
      .in("status", ["Scheduled", "Completed"])
      .gte("starts_at", fromISO)
      .lt("starts_at", toISO),
    admin
      .from("appointments")
      .select("starts_at, ends_at, booking_card_id")
      .in("status", ["Scheduled", "Completed"])
      .gte("starts_at", fromISO)
      .lt("starts_at", toISO),
  ]);
  for (const r of [sessions, appts]) if (r.error) throw new Error(r.error.message);
  const out: Array<{ start: number; end: number; typeId: string | null }> = [];
  for (const s of (sessions.data ?? []) as any[]) {
    if (isTrainingSessionType(s.session_type)) continue;
    out.push({ start: Date.parse(s.starts_at), end: Date.parse(s.ends_at), typeId: s.booking_card_id ?? null });
  }
  for (const a of (appts.data ?? []) as any[])
    out.push({ start: Date.parse(a.starts_at), end: Date.parse(a.ends_at), typeId: a.booking_card_id ?? null });
  return out.filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end));
}

/**
 * The smart plan for a type between two days in his zone: his settings and
 * date changes, everything busy (Google read on every calendar, or nothing is
 * offered), and the calls already booked across the whole weeks touched (for
 * the weekly limit).
 */
export async function smartPlan(
  admin: Admin,
  type: BookingType,
  from: string,
  to: string,
  now = new Date(),
  settingsIn?: AvailabilitySettings,
): Promise<AvailabilityPlan> {
  const settings = settingsIn ?? (await loadAvailabilitySettings(admin));
  const tz = settings.timezone;
  const weekFrom = mondayOf(from);
  const weekTo = addDaysISO(mondayOf(to), 6);
  const fromMs = wallTimeToUtc(addDaysISO(from, -1), "00:00", tz).getTime();
  const toMs = wallTimeToUtc(addDaysISO(to, 2), "00:00", tz).getTime();
  const host = await bookingHost(admin);
  const [busy, overrides, calls] = await Promise.all([
    loadBusy(admin, fromMs, toMs, tz, host.id),
    loadAvailabilityOverrides(admin, weekFrom, weekTo),
    loadBookedCalls(admin, weekFrom, weekTo, tz),
  ]);
  const typeCallsPerDay: Record<string, number> = {};
  for (const c of calls) {
    if (c.typeId !== type.id) continue;
    const d = localDateISO(new Date(c.start), tz);
    typeCallsPerDay[d] = (typeCallsPerDay[d] ?? 0) + 1;
  }
  return planAvailability({
    settings,
    overrides,
    type: {
      durationMin: type.duration_minutes,
      bufferMin: type.buffer_minutes ?? 0,
      minNoticeHours: type.min_notice_hours ?? 0,
      maxAdvanceDays: type.max_advance_days ?? 60,
      maxPerDay: type.max_per_day ?? null,
      hours: type.hours ?? [],
    },
    busy,
    calls,
    typeCallsPerDay,
    from,
    to,
    now,
  });
}

/** The coach whose Google calendars and name stand behind online bookings. */
export async function bookingHost(admin: Admin): Promise<{ id: string | null; name: string }> {
  const { data: conn } = await admin
    .from("google_calendar_connections")
    .select("coach_id")
    .not("selected_calendar_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  let coachId: string | null = (conn as any)?.coach_id ?? null;
  if (!coachId) {
    const { data: admins } = await admin.from("user_roles").select("user_id").eq("role", "admin");
    const ids = ((admins ?? []) as any[]).map((r) => r.user_id);
    if (ids.length) {
      const { data: c } = await admin
        .from("coaches")
        .select("id")
        .in("user_id", ids)
        .limit(1)
        .maybeSingle();
      coachId = (c as any)?.id ?? null;
    }
  }
  if (!coachId) {
    const { data: c } = await admin.from("coaches").select("id").limit(1).maybeSingle();
    coachId = (c as any)?.id ?? null;
  }
  if (!coachId) return { id: null, name: "JF Effect" };
  const { data: coach } = await admin
    .from("coaches")
    .select("full_name")
    .eq("id", coachId)
    .maybeSingle();
  return { id: coachId, name: (coach as any)?.full_name || "JF Effect" };
}

async function googleBusy(
  hostCoachId: string | null,
  fromISO: string,
  toISO: string,
  tz: string,
  extraCalendars: string[] = [],
): Promise<BusyInterval[]> {
  const { gcalListEvents, scheduleCalendarIds, workspaceCalendarConfigured } = await import("@/lib/google-cal.server");
  if (!workspaceCalendarConfigured()) return [];
  let events;
  try {
    // The app's calendar and his main one always; any others he ticked only add busy time.
    const ids = extraCalendars.length
      ? Array.from(new Set([...(await scheduleCalendarIds(hostCoachId)), ...extraCalendars]))
      : undefined;
    events = await gcalListEvents(hostCoachId, fromISO, toISO, ids, { requireAll: true });
  } catch {
    // Never offer times we couldn't check: a "free" slot here could double-book.
    throw new BookingError(
      "calendar_unavailable",
      "We couldn't check the calendar just now. Try again in a minute.",
    );
  }
  const midnight = (d: string) => wallTimeToUtc(d, "00:00", tz).getTime();
  return events
    .map((e) => googleBusyForBooking(e.raw as any, midnight))
    .filter((b): b is BusyInterval => !!b);
}

/** Everything that takes the coach's time in [fromMs, toMs). */
export async function loadBusy(
  admin: Admin,
  fromMs: number,
  toMs: number,
  tz: string,
  hostCoachId: string | null,
): Promise<BusyItem[]> {
  const fromISO = new Date(fromMs).toISOString();
  const toISO = new Date(toMs).toISOString();
  const [sessions, appts, events, google] = await Promise.all([
    admin
      .from("pt_sessions")
      .select("starts_at, ends_at")
      .eq("status", "Scheduled")
      .lt("starts_at", toISO)
      .gt("ends_at", fromISO),
    admin
      .from("appointments")
      .select("starts_at, ends_at")
      .eq("status", "Scheduled")
      .lt("starts_at", toISO)
      .gt("ends_at", fromISO),
    admin
      .from("events")
      .select("event_date, start_time, end_time, timezone")
      .eq("status", "Active")
      .not("start_time", "is", null)
      .not("end_time", "is", null)
      .gte("event_date", localDateISO(new Date(fromMs), tz))
      .lte("event_date", localDateISO(new Date(toMs), tz)),
    loadAvailabilitySettings(admin).then((s) => googleBusy(hostCoachId, fromISO, toISO, tz, s.extraCalendars)),
  ]);
  // A query that failed must not read as "free".
  for (const r of [sessions, appts, events]) if (r.error) throw new Error(r.error.message);
  const busy: BusyItem[] = [];
  for (const s of (sessions.data ?? []) as any[])
    busy.push({ start: Date.parse(s.starts_at), end: Date.parse(s.ends_at), kind: "session" });
  for (const a of (appts.data ?? []) as any[])
    busy.push({ start: Date.parse(a.starts_at), end: Date.parse(a.ends_at), kind: "appointment" });
  for (const e of (events.data ?? []) as any[]) {
    const zone = e.timezone || tz;
    const start = wallTimeToUtc(e.event_date, String(e.start_time).slice(0, 5), zone).getTime();
    const end = wallTimeToUtc(e.event_date, String(e.end_time).slice(0, 5), zone).getTime();
    if (end > start) busy.push({ start, end, kind: "event" });
  }
  busy.push(...google.map((g) => ({ ...g, kind: "google" as const })));
  return busy.filter((b) => Number.isFinite(b.start) && Number.isFinite(b.end) && b.end > b.start);
}

/** Bookings of this type already on each day (type's zone), for "max per day". */
async function bookedPerDay(
  admin: Admin,
  typeId: string,
  from: string,
  to: string,
  tz: string,
): Promise<Record<string, number>> {
  const fromISO = wallTimeToUtc(from, "00:00", tz).toISOString();
  const toISO = wallTimeToUtc(addDaysISO(to, 1), "00:00", tz).toISOString();
  const [sessions, appts] = await Promise.all([
    admin
      .from("pt_sessions")
      .select("starts_at")
      .eq("booking_card_id", typeId)
      .in("status", ["Scheduled", "Completed"])
      .gte("starts_at", fromISO)
      .lt("starts_at", toISO),
    admin
      .from("appointments")
      .select("starts_at")
      .eq("booking_card_id", typeId)
      .in("status", ["Scheduled", "Completed"])
      .gte("starts_at", fromISO)
      .lt("starts_at", toISO),
  ]);
  const out: Record<string, number> = {};
  for (const r of [...((sessions.data ?? []) as any[]), ...((appts.data ?? []) as any[])]) {
    const d = localDateISO(new Date(r.starts_at), tz);
    out[d] = (out[d] ?? 0) + 1;
  }
  return out;
}

/** Open start times for a type between two days (type's zone, inclusive). */
export async function openSlots(
  admin: Admin,
  type: BookingType,
  from: string,
  to: string,
  now = new Date(),
): Promise<Slot[]> {
  if (type.smart) return (await smartPlan(admin, type, from, to, now)).slots;
  const rules = rulesOf(type);
  const { first, last } = bookableDays(rules, now);
  const start = from > first ? from : first;
  const end = to < last ? to : last;
  if (start > end || !(type.hours ?? []).length) return [];
  const tz = rules.timezone;
  // A day either side covers buffers and events that start before midnight.
  const fromMs = wallTimeToUtc(addDaysISO(start, -1), "00:00", tz).getTime();
  const toMs = wallTimeToUtc(addDaysISO(end, 2), "00:00", tz).getTime();
  const host = await bookingHost(admin);
  const [busy, perDay] = await Promise.all([
    loadBusy(admin, fromMs, toMs, tz, host.id),
    rules.maxPerDay ? bookedPerDay(admin, type.id, start, end, tz) : Promise.resolve({}),
  ]);
  return computeSlots({
    hours: type.hours ?? [],
    rules,
    busy,
    bookedPerDay: perDay,
    from: start,
    to: end,
    now,
  });
}

// ── Booking ───────────────────────────────────────────────────────────────────

export type Booker = { name: string; email: string; phone?: string | null; notes?: string | null };
export type BookingClient = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  /** 'coaching' or 'self_serve' (a JF member, no coach). */
  service_tier?: string | null;
  /** Their login: a call they book shows in their coach chat, from them. */
  user_id?: string | null;
};

export type BookingResult = {
  kind: "session" | "appointment";
  id: string;
  start: string;
  end: string;
  timezone: string;
  title: string;
  where: string;
  meetLink: string | null;
  durationMin: number;
  /** Trusted clients only: whether this booking used one of their sessions. */
  usedCredit?: boolean;
  /** Trusted clients only: booked with no prepaid session left. */
  noCreditLeft?: boolean;
};

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** The one active client with this email, if exactly one (leads included). */
export async function clientIdByEmail(admin: Admin, email: string): Promise<string | null> {
  const { data } = await admin
    .from("clients")
    .select("id, archived")
    .ilike("email", escapeLike(email.trim()))
    .limit(2);
  const rows = ((data ?? []) as any[]).filter((c) => !c.archived);
  return rows.length === 1 ? (rows[0].id as string) : null;
}

/**
 * Who's signed in, when someone is (the page's server calls carry their token):
 * staff or not, and their own client record (null for a coach with no athlete
 * account, a JF member still waiting on approval, or anyone archived).
 */
export async function loadBookingViewer(
  admin: Admin,
  userId: string,
): Promise<{ userId: string; staff: boolean; client: BookingClient | null }> {
  const [{ data: roles }, { data: c }] = await Promise.all([
    admin.from("user_roles").select("role").eq("user_id", userId),
    admin
      .from("clients")
      .select("id, full_name, email, phone, archived, service_tier, user_id")
      .eq("user_id", userId)
      .limit(2),
  ]);
  const staff = ((roles ?? []) as any[]).some((r) => r.role === "admin" || r.role === "coach");
  const rows = ((c ?? []) as any[]).filter((r) => !r.archived);
  return { userId, staff, client: rows.length === 1 ? (rows[0] as BookingClient) : null };
}

export async function loadBookingClient(
  admin: Admin,
  clientId: string,
): Promise<BookingClient | null> {
  const { data } = await admin
    .from("clients")
    .select("id, full_name, email, phone, archived, service_tier, user_id")
    .eq("id", clientId)
    .maybeSingle();
  return data && !(data as any).archived ? (data as BookingClient) : null;
}

function firstName(name: string | null | undefined): string {
  return (
    String(name ?? "")
      .trim()
      .split(/\s+/)[0] || ""
  );
}

function joinNotes(
  defaultNotes: string | null,
  bookerNotes: string | null | undefined,
  who: string,
): string | null {
  const parts = [
    defaultNotes?.trim() || null,
    bookerNotes?.trim() ? `Note from ${who || "client"}: ${bookerNotes.trim()}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join("\n\n") : null;
}

/** appointments.appointment_type is a fixed list; pick the closest. */
function appointmentTypeFor(t: BookingType): string {
  switch (t.session_type) {
    case "Consultation":
      return "Consultation";
    case "Check-In Session":
      return "Check-In Call";
    case "Assessment Session":
      return "Assessment";
    default:
      return t.location_mode === "in_person" ? "In-Person Session" : "Coaching Call";
  }
}

/** Hold [start, end) for this request; false when someone else holds an overlapping time. */
async function claimTime(admin: Admin, startMs: number, endMs: number): Promise<string | null> {
  await admin
    .from("booking_slot_claims" as any)
    .delete()
    .lt("created_at", new Date(Date.now() - CLAIM_STALE_MS).toISOString());
  const { data, error } = await admin
    .from("booking_slot_claims" as any)
    .insert({ starts_at: new Date(startMs).toISOString(), ends_at: new Date(endMs).toISOString() })
    .select("id")
    .single();
  if (error) {
    if ((error as any).code === "23P01") return null; // overlapping hold: someone's booking it right now
    throw new Error(error.message);
  }
  return (data as any).id as string;
}

export async function createOnlineBooking(
  admin: Admin,
  opts: {
    type: BookingType;
    startISO: string;
    /** client_app = signed in; booking_page = public link (with or without a personal invite). */
    via: "client_app" | "booking_page";
    /** Set only when we know it's them: signed in, or a valid personal invite. */
    trustedClient: BookingClient | null;
    booker: Booker;
    applicationId?: string | null;
    now?: Date;
  },
): Promise<BookingResult> {
  const { type, booker, trustedClient } = opts;
  const now = opts.now ?? new Date();
  const tz = type.timezone || DEFAULT_TZ;
  const when = new Date(opts.startISO);
  if (Number.isNaN(when.getTime())) throw new BookingError("invalid", "Pick a time first.");
  // A clients-only type (General Call) is never booked by the public or a JF member,
  // whichever way the request came in.
  if (!audienceAllows(type, trustedClient ? { serviceTier: trustedClient.service_tier } : null)) {
    throw new BookingError("invalid", "This booking is for JF Effect coaching clients. Sign in with your client account to book it.");
  }
  // A package's included call (Coaching Plus): only a client on it, only with a call left in
  // that billing period. The pt_sessions guard checks it again under a lock.
  const included = await includedCallCheck(admin, type, trustedClient, when, tz);

  if (!trustedClient) {
    // A shared link can't be used to fill the calendar.
    const hourAgo = new Date(now.getTime() - 3_600_000).toISOString();
    const [{ count: recent }, { count: mine }] = await Promise.all([
      admin
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("source", "booking_link")
        .gt("created_at", hourAgo),
      admin
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .ilike("external_email", escapeLike(booker.email.trim()))
        .eq("booking_card_id", type.id)
        .eq("status", "Scheduled")
        .gt("starts_at", now.toISOString()),
    ]);
    if ((recent ?? 0) >= PUBLIC_HOURLY_LIMIT) {
      throw new BookingError("busy", "Lots of bookings right now. Try again in a little while.");
    }
    if ((mine ?? 0) >= PUBLIC_OPEN_LIMIT) {
      throw new BookingError(
        "too_many",
        `You already have ${PUBLIC_OPEN_LIMIT} upcoming bookings for this. Reply to your confirmation if you need to change one.`,
      );
    }
  }

  // Hold the time (plus buffer, or his call gap for a smart type), then check it's really open, then write.
  const gapMin = type.smart ? (await loadAvailabilitySettings(admin)).gapMin : 0;
  const bufferMs = Math.max(type.buffer_minutes ?? 0, gapMin) * 60_000;
  const startMs = when.getTime();
  const claimId = await claimTime(
    admin,
    startMs - bufferMs,
    startMs + type.duration_minutes * 60_000 + bufferMs,
  );
  if (!claimId) throw new BookingError("taken", "That time was just taken. Pick another one.");
  let result: BookingResult;
  try {
    const day = localDateISO(when, tz);
    // A smart type re-checks the hard rules for that exact time (free, inside his boundaries,
    // under the limits), not the smart picks, which can shift as the day fills.
    const slot = type.smart
      ? isHardOpen(await smartPlan(admin, type, day, day, now), opts.startISO, type.duration_minutes)
      : isOpenSlot(await openSlots(admin, type, day, day, now), opts.startISO);
    if (!slot) throw new BookingError("taken", "That time was just taken. Pick another one.");
    const host = await bookingHost(admin);
    result = trustedClient
      ? await bookSession(admin, { type, slot, client: trustedClient, booker, via: opts.via, tz })
      : await bookAppointment(admin, {
          type,
          slot,
          booker,
          tz,
          hostCoachId: host.id,
          clientId: await clientIdByEmail(admin, booker.email),
          applicationId: opts.applicationId ?? null,
        });
  } finally {
    await admin
      .from("booking_slot_claims" as any)
      .delete()
      .eq("id", claimId);
  }

  // What they want to cover, kept where the coach's call prep reads it (and they can change it).
  if (included && trustedClient && result.kind === "session" && booker.notes?.trim()) {
    await admin
      .from("coaching_call_topics")
      .upsert({ pt_session_id: result.id, client_id: trustedClient.id, topics: booker.notes.trim().slice(0, 1500) })
      .then(
        () => {},
        () => {},
      );
  }

  // A call a client booked, or anything booked from the coach's personal link (a text or an
  // email reaches no chat), shows in their coach chat, unless the coach's invite card already does.
  const inChat =
    !!trustedClient &&
    result.kind === "session" &&
    (!isTrainingSessionType(type.session_type) || opts.via === "booking_page")
      ? await postSelfBookedCall(admin, { client: trustedClient, type, sessionId: result.id, now })
      : false;

  await notifyCoaches(admin, {
    who: trustedClient?.full_name || booker.name,
    typeName: type.name,
    start: new Date(result.start),
    tz,
    noCredit: !!result.noCreditLeft,
    url: trustedClient
      ? inChat
        ? `/admin/messages?client=${trustedClient.id}`
        : `/admin/clients/${trustedClient.id}`
      : "/admin/calendar?tab=upcoming",
    eventKey: `booking:${result.id}`,
  });
  return result;
}

/** Is this booking type a package's included call? (coaching_packages.call_booking_card_id) */
export async function isIncludedCallType(admin: Admin, typeId: string): Promise<boolean> {
  const { data } = await admin
    .from("coaching_packages" as any)
    .select("id")
    .eq("call_booking_card_id", typeId)
    .limit(1);
  return ((data ?? []) as any[]).length > 0;
}

/** The booking types a client's package gives them calls on (empty for everyone else). */
export async function includedCallTypesFor(admin: Admin, clientId: string): Promise<Set<string>> {
  const { data } = await admin
    .from("coaching_package_enrollments" as any)
    .select("included_calls, coaching_packages!inner(included_calls, call_booking_card_id)")
    .eq("client_id", clientId)
    .eq("status", "active");
  const out = new Set<string>();
  for (const e of (data ?? []) as any[]) {
    const p = e.coaching_packages;
    const calls = e.included_calls ?? p?.included_calls ?? 0;
    if (p?.call_booking_card_id && calls > 0) out.add(p.call_booking_card_id);
  }
  return out;
}

/**
 * Before booking an included call: they're on the package and have a call
 * left in the billing period it falls in. True when it is one (false for any
 * other type). Throws the reason in words.
 */
async function includedCallCheck(
  admin: Admin,
  type: BookingType,
  client: BookingClient | null,
  when: Date,
  tz: string,
): Promise<boolean> {
  if (!(await isIncludedCallType(admin, type.id))) return false;
  if (!client) {
    throw new BookingError("invalid", "This call is included with coaching. Sign in with your client account to book it.");
  }
  const { data: u, error } = await admin.rpc("coaching_call_usage" as any, {
    _client: client.id,
    _card: type.id,
    _on: localDateISO(when, tz),
  });
  if (error) throw new Error(error.message);
  if (!u) {
    throw new BookingError("invalid", "This call is included with a coaching package you're not on. Ask your coach about adding it.");
  }
  const usage = u as any;
  if (Number(usage.left) <= 0) {
    const end = new Date(`${String(usage.period_end)}T12:00:00Z`);
    end.setUTCDate(end.getUTCDate() - 1);
    const until = end.toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });
    throw new BookingError(
      "too_many",
      `You've booked all ${usage.included} of your included calls for this billing period (it ends ${until}). Pick a day after that.`,
    );
  }
  return true;
}

async function bookSession(
  admin: Admin,
  o: {
    type: BookingType;
    slot: Slot;
    client: BookingClient;
    booker: Booker;
    via: "client_app" | "booking_page";
    tz: string;
  },
): Promise<BookingResult> {
  const { type, slot, client, booker, tz } = o;
  const start = new Date(slot.start);
  const end = new Date(slot.end);
  const phone = booker.phone || client.phone;
  const { data: s, error } = await admin
    .from("pt_sessions")
    .insert({
      client_id: client.id,
      title: type.name,
      session_type: type.session_type,
      custom_type: type.session_type === "Custom Session" ? type.custom_type : null,
      session_date: slot.date,
      start_time: localTimeHM(start, tz),
      end_time: localTimeHM(end, tz),
      timezone: tz,
      location: bookedLocation(type, phone),
      notes: joinNotes(
        type.default_notes,
        booker.notes,
        firstName(client.full_name || booker.name),
      ),
      client_visible_notes: type.client_visible_notes,
      // They booked it, so it's always on their calendar.
      visible_to_client: true,
      reminders_enabled: type.reminders_enabled,
      send_confirmation_email: type.send_confirmation_email,
      uses_credit: type.uses_credit,
      booking_card_id: type.id,
      status: "Scheduled",
      booked_via: o.via,
      wants_meet: type.location_mode === "video",
    } as any)
    .select("id")
    .single();
  if (error || !s) throw new Error(error?.message ?? "Couldn't save the booking.");
  const sessionId = (s as any).id as string;

  // Into Google now (and a Meet link for video calls), not on the next tick.
  let meetLink: string | null = null;
  try {
    const { syncPtSessionsToGoogle } = await import("@/lib/pt-session-gcal.server");
    await syncPtSessionsToGoogle(admin, 4);
    const { data: synced } = await admin
      .from("pt_sessions")
      .select("meet_link")
      .eq("id", sessionId)
      .maybeSingle();
    meetLink = (synced as any)?.meet_link ?? null;
  } catch {
    /* the 5-minute tick picks it up */
  }

  let noCreditLeft = false;
  if (type.uses_credit) {
    const { data: held } = await admin
      .from("session_ledger_events")
      .select("purchase_id")
      .eq("pt_session_id", sessionId)
      .eq("event_type", "reserved")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    noCreditLeft = !!held && !(held as any).purchase_id;
  }

  return {
    kind: "session",
    id: sessionId,
    start: slot.start,
    end: slot.end,
    timezone: tz,
    title: type.name,
    where: type.location_mode === "phone" ? "Phone call" : locationLabel(type),
    meetLink,
    durationMin: type.duration_minutes,
    usedCredit: type.uses_credit,
    noCreditLeft,
  };
}

async function bookAppointment(
  admin: Admin,
  o: {
    type: BookingType;
    slot: Slot;
    booker: Booker;
    tz: string;
    hostCoachId: string | null;
    clientId: string | null;
    applicationId: string | null;
  },
): Promise<BookingResult> {
  const { type, slot, booker, tz } = o;
  if (!o.hostCoachId) throw new Error("Booking isn't set up yet: no coach account to book with.");
  const name = booker.name.trim();
  const title = `${type.name} · ${name}`;
  const { data: appt, error } = await admin
    .from("appointments")
    .insert({
      host_coach_id: o.hostCoachId,
      // Linked so it shows in their app if the email is a client's. Never their credits:
      // anyone can type an email.
      client_id: o.clientId,
      external_name: name,
      external_email: booker.email.trim(),
      external_phone: booker.phone?.trim() || null,
      appointment_type: appointmentTypeFor(type),
      title,
      starts_at: slot.start,
      ends_at: slot.end,
      timezone: tz,
      location: bookedLocation(type, booker.phone),
      attendee_notes: booker.notes?.trim() || null,
      sms_reminders_enabled: type.reminders_enabled && !!booker.phone?.trim(),
      source: "booking_link",
      booking_card_id: type.id,
      application_id: o.applicationId,
      status: "Scheduled",
    } as any)
    .select("id")
    .single();
  if (error || !appt) {
    console.error("[booking] appointment insert failed", error);
    throw new Error("Couldn't save the booking. Try again, or message us.");
  }
  const apptId = (appt as any).id as string;

  if (o.applicationId) await linkApplication(admin, o.applicationId, apptId, slot.start, tz);

  // Google: on the coach's calendar, with an invite (and Meet link) to the booker.
  let meetLink: string | null = null;
  try {
    const { gcalCreateEvent } = await import("@/lib/google-cal.server");
    const created = await gcalCreateEvent(o.hostCoachId, {
      summary: title,
      description: [
        booker.notes?.trim() ? `Note: ${booker.notes.trim()}` : null,
        booker.phone ? `Phone: ${booker.phone}` : null,
        `Email: ${booker.email}`,
      ]
        .filter(Boolean)
        .join("\n"),
      startISO: slot.start,
      endISO: slot.end,
      timezone: tz,
      location: type.location_mode === "in_person" ? (type.location ?? undefined) : undefined,
      attendees: [{ email: booker.email.trim(), displayName: name }],
      meet: type.location_mode === "video",
    });
    if (created) {
      meetLink = created.meetLink ?? null;
      await admin
        .from("appointments")
        .update({ google_event_id: created.id, meet_link: meetLink } as any)
        .eq("id", apptId);
    }
  } catch (e: any) {
    await admin.from("appointment_audit_log").insert({
      appointment_id: apptId,
      action: "google_sync_failed",
      details: { source: "booking_page", error: String(e?.message ?? e).slice(0, 500) },
    } as any);
  }

  // One reminder text, two hours before, when they left a number and there's time for it.
  if (type.reminders_enabled && booker.phone?.trim()) {
    const at = Date.parse(slot.start) - 120 * 60_000;
    if (at > Date.now() + 15 * 60_000) {
      await admin.from("appointment_reminders").insert({
        appointment_id: apptId,
        audience: "attendee",
        offset_minutes: 120,
        scheduled_for: new Date(at).toISOString(),
      } as any);
    }
  }

  return {
    kind: "appointment",
    id: apptId,
    start: slot.start,
    end: slot.end,
    timezone: tz,
    title: type.name,
    where: locationLabel(type),
    meetLink,
    durationMin: type.duration_minutes,
  };
}

/**
 * A call a client booked themselves (their app, or a personal link) goes in
 * their coach chat as a message from them with the call as a card, read live,
 * so the coach sees it where they talk. Skipped when it came from the coach's
 * booking invite: that card already shows it as booked. Never fails the
 * booking (it's saved; the coach's push still goes). True when it posted.
 */
async function postSelfBookedCall(
  admin: Admin,
  o: { client: BookingClient; type: BookingType; sessionId: string; now: Date },
): Promise<boolean> {
  try {
    const { client, type, sessionId, now } = o;
    if (!client.user_id) return false; // no login, no chat
    const { selfBookedMessageBody, bookedCard, inviteCoversBooking } = await import("@/lib/session-booked");
    const { data: invites } = await admin
      .from("messages")
      .select("attachments, created_at")
      .eq("client_id", client.id)
      // JSON text, never a JS array: supabase-js sends an array as a Postgres array literal, which jsonb refuses (HTTP 400)
      .contains("attachments", JSON.stringify([{ kind: "booking_invite", booking_card_id: type.id }]))
      .gt("created_at", new Date(now.getTime() - INVITE_CARD_DAYS * 86_400_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(1);
    const invite = ((invites ?? []) as any[])[0];
    const sentAt: string | null =
      ((invite?.attachments ?? []) as any[]).find(
        (a) => a?.kind === "booking_invite" && a?.booking_card_id === type.id,
      )?.sent_at ?? invite?.created_at ?? null;
    if (sentAt) {
      // The invite card shows the first booking of this type made after it was sent.
      const [s, a] = await Promise.all([
        admin
          .from("pt_sessions")
          .select("id, created_at")
          .eq("client_id", client.id)
          .eq("booking_card_id", type.id)
          .gte("created_at", sentAt),
        admin
          .from("appointments")
          .select("id, created_at")
          .eq("client_id", client.id)
          .eq("booking_card_id", type.id)
          .gte("created_at", sentAt),
      ]);
      const since = [...((s.data ?? []) as any[]), ...((a.data ?? []) as any[])];
      if (inviteCoversBooking(sessionId, since)) return false;
    }

    const { data: row } = await admin
      .from("pt_sessions")
      .select("id, title, session_type, session_date, start_time, end_time, location, wants_meet")
      .eq("id", sessionId)
      .maybeSingle();
    if (!row) return false;
    const at = now.toISOString();
    const { error } = await admin.from("messages").insert({
      client_id: client.id,
      sender_id: client.user_id,
      sender_role: "client",
      body: selfBookedMessageBody(row as any),
      attachments: [{ ...bookedCard([row as any]), booked_by: "client" }],
      message_type: "Scheduling",
      is_internal_note: false,
      delivery_status: "sent",
      sent_at: at,
      read_by_client_at: at,
    } as any);
    if (error) {
      console.warn("[booking] chat message failed", error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.warn("[booking] chat message failed", e);
    return false;
  }
}

/** A booking invite older than this (a personal link's life) no longer stands in for the chat message. */
const INVITE_CARD_DAYS = INVITE_DAYS;

/** Coaching application flow: tie the booked call back to the application. */
async function linkApplication(
  admin: Admin,
  applicationId: string,
  appointmentId: string,
  startISO: string,
  tz: string,
) {
  try {
    const { data: app } = await admin
      .from("coaching_applications")
      .select("id, client_id, first_name, full_name, lead_score, qualification_label")
      .eq("id", applicationId)
      .maybeSingle();
    if (!app) return;
    await admin
      .from("coaching_applications")
      .update({ appointment_id: appointmentId, call_status: "booked" } as any)
      .eq("id", (app as any).id);
    if ((app as any).client_id) {
      await admin
        .from("clients")
        .update({ lifecycle_stage: "call_booked", call_booked: true } as any)
        .eq("id", (app as any).client_id);
    }
    const { notifyCoachingAppRecipients } = await import("@/lib/coaching-app-notify.server");
    const whenLabel = `${fmtDayLabel(new Date(startISO), tz)}, ${fmtClock(new Date(startISO), tz)}`;
    const who = (app as any).first_name ?? (app as any).full_name ?? "Lead";
    const reviewLink = "https://jfeffect.com/admin/forms?tab=coaching-applications";
    await notifyCoachingAppRecipients(admin, {
      kind: "coaching_app_booked",
      event_key: appointmentId,
      priority: String((app as any).qualification_label ?? "").includes("Priority"),
      smsBody: `JF Effect call booked: ${who} — ${whenLabel}. Score ${(app as any).lead_score ?? "?"}. Review: ${reviewLink}`,
      emailSubject: `Coaching call booked — ${who} — ${whenLabel}`,
      emailBody: `${who}\nWhen: ${whenLabel}\nReview: ${reviewLink}`,
    } as any);
  } catch (e) {
    console.warn("[booking] application linking failed", e);
  }
}

/** A push to each admin: who booked what, and when. */
async function notifyCoaches(
  admin: Admin,
  o: {
    who: string;
    typeName: string;
    start: Date;
    tz: string;
    noCredit: boolean;
    url: string;
    eventKey: string;
  },
) {
  try {
    const { sendWebPushToUser } = await import("@/lib/push/push.server");
    const { data: admins } = await admin.from("user_roles").select("user_id").eq("role", "admin");
    const when = `${fmtDayLabel(o.start, o.tz)}, ${fmtClock(o.start, o.tz)}`;
    const body = `${o.who} · ${o.typeName} · ${when}${o.noCredit ? " · no sessions left on their package" : ""}`;
    await Promise.all(
      ((admins ?? []) as any[]).map((r) =>
        sendWebPushToUser(
          admin,
          r.user_id,
          { title: "New booking", body, url: o.url, tag: o.eventKey },
          { eventKey: o.eventKey, priority: "urgent" },
        ),
      ),
    );
  } catch (e) {
    console.warn("[booking] coach notification failed", e);
  }
}
