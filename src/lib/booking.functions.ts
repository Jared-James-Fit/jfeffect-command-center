import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { PovInput, resolvePovClientId } from "@/lib/client-pov.server";
import { addDaysISO } from "@/lib/schedule-time";
import { locationLabel, type BookingType } from "@/lib/booking-types";

/**
 * Online booking server functions.
 *   Public (no sign-in): the booking page, its open times, and booking. A
 *     public booking is an appointment; it never touches anyone's credits.
 *   Personal link (?i=…, minted by staff for one client): books as that client.
 *   Signed-in client: book as yourself (no form), and the types you can book in the app.
 * All database work runs with the service role inside booking.server.ts, after
 * the type has been checked live (active + online).
 */

const SlugInput = z.object({ slug: z.string().trim().min(1).max(80) });
const InviteInput = z.string().trim().max(120).optional().nullable();

/** The client a personal link names (valid, unexpired, still a client), or null. */
async function inviteClient(db: any, invite: string | null | undefined) {
  if (!invite) return null;
  const { verifyBookingInvite } = await import("@/lib/booking-invite.server");
  const clientId = verifyBookingInvite(invite);
  if (!clientId) return null;
  const { loadBookingClient } = await import("@/lib/booking.server");
  return loadBookingClient(db, clientId);
}
const DateISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

/** What the booking page shows about a type (nothing internal). */
function publicView(t: BookingType, hostName: string) {
  return {
    slug: t.slug!,
    name: t.name,
    description: t.description,
    durationMin: t.duration_minutes,
    locationMode: t.location_mode,
    where: locationLabel(t),
    timezone: t.timezone,
    collectPhone: t.collect_phone,
    collectNotes: t.collect_notes,
    maxAdvanceDays: t.max_advance_days,
    usesCredit: t.uses_credit,
    color: t.color,
    hostName,
    hasHours: (t.hours ?? []).length > 0,
  };
}
export type PublicBookingType = ReturnType<typeof publicView>;

export const getBookingPage = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => SlugInput.extend({ invite: InviteInput }).parse(d))
  .handler(async ({ data }) => {
    const { loadBookingType, bookingHost } = await import("@/lib/booking.server");
    const db = await admin();
    const type = await loadBookingType(db, data.slug);
    if (!type) return null;
    const [host, invitee] = await Promise.all([bookingHost(db), inviteClient(db, data.invite)]);
    return {
      ...publicView(type, host.name),
      // Only the first name: the link's holder already knows who it's for.
      invitee: invitee
        ? { firstName: (invitee.full_name ?? "").trim().split(/\s+/)[0] || "you" }
        : null,
    };
  });

/** Open times between two days (the type's zone). */
export const getBookingSlots = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => SlugInput.extend({ from: DateISO, to: DateISO }).parse(d))
  .handler(async ({ data }) => {
    const { loadBookingType, openSlots, BookingError, MAX_RANGE_DAYS } =
      await import("@/lib/booking.server");
    const db = await admin();
    const type = await loadBookingType(db, data.slug);
    if (!type) return { slots: [], error: "not_found" as const };
    const to =
      data.to < addDaysISO(data.from, MAX_RANGE_DAYS)
        ? data.to
        : addDaysISO(data.from, MAX_RANGE_DAYS);
    try {
      const slots = await openSlots(db, type, data.from, to);
      return { slots, error: null };
    } catch (e) {
      if (e instanceof BookingError && e.code === "calendar_unavailable")
        return { slots: [], error: "calendar_unavailable" as const };
      throw e;
    }
  });

const PublicBookInput = SlugInput.extend({
  start: z.string().min(10).max(40),
  name: z.string().trim().max(120).optional().nullable(),
  email: z.string().trim().max(200).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  notes: z.string().trim().max(1500).optional().nullable(),
  applicationId: z.string().uuid().optional().nullable(),
  invite: InviteInput,
});

/**
 * Booking from the link. With a valid personal link it books as that client
 * (a session, their credits). Otherwise it's an appointment for whoever filled
 * in the form; typing a client's email never books against their package.
 */
export const bookOnline = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => PublicBookInput.parse(d))
  .handler(async ({ data }) => {
    const { loadBookingType, createOnlineBooking, BookingError } =
      await import("@/lib/booking.server");
    const db = await admin();
    const type = await loadBookingType(db, data.slug);
    if (!type) throw new Error("This booking page isn't taking bookings right now.");
    const invitee = await inviteClient(db, data.invite);
    const name = data.name?.trim() || invitee?.full_name || "";
    const email = data.email?.trim() || invitee?.email || "";
    if (!invitee) {
      if (!name) throw new Error("Add your name.");
      if (!z.string().email().safeParse(email).success) throw new Error("Add a valid email.");
    }
    const phone = data.phone?.trim() || invitee?.phone || null;
    if (type.location_mode === "phone" && !phone) {
      throw new Error("Add a phone number so we can call you.");
    }
    try {
      const result = await createOnlineBooking(db, {
        type,
        startISO: data.start,
        via: "booking_page",
        trustedClient: invitee,
        booker: { name, email, phone, notes: data.notes },
        applicationId: invitee ? null : (data.applicationId ?? null),
      });
      return result;
    } catch (e) {
      if (e instanceof BookingError) throw new Error(e.message);
      throw e;
    }
  });

/**
 * Staff: a personal booking link for one client. They book as themselves
 * (their sessions and calendar) without signing in.
 */
export const getClientBookingLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clientId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const staff = ((roles ?? []) as any[]).some((r) => r.role === "admin" || r.role === "coach");
    if (!staff) throw new Error("Only coaches can send personal booking links.");
    // RLS: the coach must be able to see this client.
    const { data: c } = await supabase
      .from("clients")
      .select("id")
      .eq("id", data.clientId)
      .maybeSingle();
    if (!c) throw new Error("Client not found.");
    const { signBookingInvite } = await import("@/lib/booking-invite.server");
    return { invite: signBookingInvite(data.clientId) };
  });

async function myClient(supabase: any, userId: string) {
  const { data } = await supabase
    .from("clients")
    .select("id, full_name, email, phone, archived")
    .eq("user_id", userId)
    .maybeSingle();
  return data && !data.archived
    ? (data as { id: string; full_name: string | null; email: string | null; phone: string | null })
    : null;
}

/** Signed-in client: book as yourself. No form, their sessions and credits. */
export const bookOnlineAsMe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    SlugInput.extend({
      start: z.string().min(10).max(40),
      notes: z.string().trim().max(1500).optional().nullable(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const me = await myClient(supabase, userId);
    if (!me) throw new Error("Sign in with your client account to book here.");
    const { loadBookingType, createOnlineBooking, BookingError } =
      await import("@/lib/booking.server");
    const db = await admin();
    const type = await loadBookingType(db, data.slug);
    if (!type) throw new Error("This booking page isn't taking bookings right now.");
    try {
      return await createOnlineBooking(db, {
        type,
        startISO: data.start,
        via: "client_app",
        trustedClient: me,
        booker: {
          name: me.full_name ?? "",
          email: me.email ?? "",
          phone: me.phone,
          notes: data.notes,
        },
      });
    } catch (e) {
      if (e instanceof BookingError) throw new Error(e.message);
      throw e;
    }
  });

/** Who's booking, when signed in as a client (null for everyone else). */
export const getMyBookingIdentity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const me = await myClient(supabase, userId);
    return me ? { name: me.full_name ?? "", email: me.email ?? "" } : null;
  });

/**
 * Types a client can book from their app. In-person types only show to
 * clients who train in person (they've had a session or hold session credits),
 * so online-only clients never see a gym booking they can't use.
 */
export const listMyBookingTypes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PovInput.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const clientId = await resolvePovClientId(supabase, userId, data);
    if (!clientId) return [];
    const db = await admin();
    const { data: types } = await db
      .from("booking_cards")
      .select(
        "id, slug, name, duration_minutes, location_mode, location, uses_credit, color, sort_order",
      )
      .eq("is_active", true)
      .eq("online_enabled", true)
      .eq("show_in_app", true)
      .not("slug", "is", null)
      .order("sort_order", { ascending: true });
    const rows = (types ?? []) as any[];
    if (!rows.length) return [];
    let trainsInPerson = false;
    if (rows.some((t) => t.location_mode === "in_person")) {
      const [{ count: sessions }, { count: credits }, { data: c }] = await Promise.all([
        db
          .from("pt_sessions")
          .select("id", { count: "exact", head: true })
          .eq("client_id", clientId),
        db
          .from("session_ledger_events")
          .select("id", { count: "exact", head: true })
          .eq("client_id", clientId),
        db.from("clients").select("package_tracking_enabled").eq("id", clientId).maybeSingle(),
      ]);
      trainsInPerson =
        (sessions ?? 0) > 0 || (credits ?? 0) > 0 || !!(c as any)?.package_tracking_enabled;
    }
    return rows
      .filter((t) => t.location_mode !== "in_person" || trainsInPerson)
      .map((t) => ({
        slug: t.slug as string,
        name: t.name as string,
        durationMin: t.duration_minutes as number,
        where: locationLabel(t),
        usesCredit: !!t.uses_credit,
        color: t.color as string | null,
      }));
  });
