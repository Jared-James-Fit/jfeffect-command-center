import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { PovInput, resolvePovClientId } from "@/lib/client-pov.server";
import { addDaysISO } from "@/lib/schedule-time";
import {
  audienceAllows,
  clientsOnly,
  durationChoices,
  durationLabel,
  isCallType,
  locationLabel,
  withDuration,
  type BookingType,
} from "@/lib/booking-types";

/** What anyone who isn't a coaching client hears on a clients-only type. */
const CLIENTS_ONLY_MESSAGE = "This booking is for JF Effect coaching clients. Sign in with your client account to book it.";

/**
 * Online booking server functions.
 *   Public (no sign-in): the booking page, its open times, and booking. A
 *     public booking is an appointment; it never touches anyone's credits.
 *   Personal link (/b/<token>, minted by staff for one client and one type):
 *     books as that client with no sign-in; the server resolves the token
 *     (booking-invite.server.ts) and decides who's booking (pickBookingIdentity).
 *   Signed in as a client: books as themselves (their sessions and credits).
 * All database work runs with the service role inside booking.server.ts, after
 * the type has been checked live (active + online).
 */

const SlugInput = z.object({ slug: z.string().trim().min(1).max(80) });
const OptionalSlug = z.string().trim().min(1).max(80).optional().nullable();
const InviteInput = z.string().trim().max(120).optional().nullable();

/** The signed-in user's id when the call carries a valid token; null when signed out (never an error). */
async function viewerUserId(): Promise<string | null> {
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    const h = getRequest()?.headers.get("authorization") ?? "";
    if (!h.startsWith("Bearer ")) return null;
    const token = h.slice(7).trim();
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!token || !url || !key) return null;
    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, storage: undefined } });
    const { data, error } = await sb.auth.getClaims(token);
    return !error && data?.claims?.sub ? String(data.claims.sub) : null;
  } catch {
    return null;
  }
}

/**
 * Everything a booking request needs to know, worked out on the server: the
 * type (a personal link names its own; else the page's slug), the link and
 * where it stands, who's signed in, and so who the booking is for.
 */
async function bookingContext(
  db: any,
  input: { slug?: string | null; invite?: string | null; applicationId?: string | null },
) {
  const S = await import("@/lib/booking.server");
  const { resolveBookingInvite } = await import("@/lib/booking-invite.server");
  const { pickBookingIdentity } = await import("@/lib/booking-invite");
  // A coaching application's call is always the public kind (an appointment tied to the
  // application), whoever happens to be signed in, as it was before personal links.
  const publicOnly = !!input.applicationId && !input.invite;
  const [invite, uid] = await Promise.all([
    input.invite ? resolveBookingInvite(db, input.invite) : Promise.resolve(null),
    publicOnly ? Promise.resolve(null) : viewerUserId(),
  ]);
  const viewer = uid ? await S.loadBookingViewer(db, uid) : null;
  let type = invite?.bookingCardId ? await S.loadBookingTypeById(db, invite.bookingCardId) : null;
  if (!type && input.slug) type = await S.loadBookingType(db, input.slug);
  const identity = pickBookingIdentity({
    invite: invite ? { state: invite.state, clientId: invite.clientId } : null,
    signedIn: viewer ? { clientId: viewer.client?.id ?? null, staff: viewer.staff } : null,
  });
  const client =
    identity.clientId == null
      ? null
      : viewer?.client?.id === identity.clientId
        ? viewer.client
        : await S.loadBookingClient(db, identity.clientId);
  return { type, invite, viewer, identity, client };
}

/** Why a link can't book right now, in words. */
function blockedMessage(state: string): string {
  switch (state) {
    case "booked":
      return "This link already has a booking. Change it in your JF Effect app, or ask your coach for a new link.";
    case "busy":
      return "That booking is already going through. Give it a moment.";
    case "expired":
      return "This booking link has expired. Ask your coach for a new one.";
    case "revoked":
      return "This booking link isn't active anymore. Ask your coach for a new one.";
    default:
      return "This booking link doesn't work. Ask your coach for a new one.";
  }
}
const DateISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** A length the booker picked (minutes); the type decides whether it's one it offers. */
const DurationInput = z.coerce.number().int().min(5).max(480).optional().nullable();

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
    /** The lengths they pick between (one = a fixed length). */
    durationOptions: durationChoices(t),
    /** Only coaching clients can book it (signed in, or a personal link). */
    clientsOnly: clientsOnly(t),
    isCall: isCallType(t),
    locationMode: t.location_mode,
    where: locationLabel(t),
    timezone: t.timezone,
    collectPhone: t.collect_phone,
    collectNotes: t.collect_notes,
    maxAdvanceDays: t.max_advance_days,
    usesCredit: t.uses_credit,
    color: t.color,
    hostName,
    hasHours: !!t.smart || (t.hours ?? []).length > 0,
  };
}
export type PublicBookingType = ReturnType<typeof publicView>;

export const getBookingPage = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z.object({ slug: OptionalSlug, invite: InviteInput, applicationId: z.string().uuid().optional().nullable() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { bookingHost } = await import("@/lib/booking.server");
    const db = await admin();
    const { type, invite, viewer, identity, client } = await bookingContext(db, data);
    // Nothing bookable: no such page, a paused type, or a link that names nothing at all.
    if (!type) return null;
    const host = await bookingHost(db);
    // Someone opened the link (never the coach himself): his card says so.
    if (identity.inviteApplies && invite?.id && !viewer?.staff) {
      const { noteInviteOpened } = await import("@/lib/booking-invite.server");
      await noteInviteOpened(db, invite.id);
    }
    // The booking the link already has, while it stands (only to someone the link books for).
    let booked: { start: string; end: string; timezone: string | null; done: boolean } | null = null;
    if (identity.blockedBy === "booked" && invite?.bookedSessionId) {
      const { data: s } = await db
        .from("pt_sessions")
        .select("starts_at, ends_at, timezone, status")
        .eq("id", invite.bookedSessionId)
        .maybeSingle();
      if (s) booked = { start: s.starts_at, end: s.ends_at, timezone: s.timezone ?? null, done: s.status !== "Scheduled" };
    }
    const who = client
      ? {
          // Only the first name: the link's holder already knows who it's for.
          firstName: (client.full_name ?? "").trim().split(/\s+/)[0] || "you",
          canBook: audienceAllows(type, { serviceTier: client.service_tier }),
          signedIn: identity.via === "client_app",
        }
      : null;
    return {
      ...publicView(type, host.name),
      who,
      /** Older pages read this. */
      invitee: who ? { firstName: who.firstName, canBook: who.canBook } : null,
      /** The length the coach picked for this link (set, not a choice). */
      fixedDuration: identity.inviteApplies ? (invite?.durationMin ?? null) : null,
      /** The link's state when it can't book (and nobody signed in can instead). */
      linkState: identity.blockedBy,
      booked,
    };
  });

/** Open times between two days (the type's zone). */
export const getBookingSlots = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    SlugInput.extend({ from: DateISO, to: DateISO, duration: DurationInput }).parse(d),
  )
  .handler(async ({ data }) => {
    const { loadBookingType, openSlots, BookingError, MAX_RANGE_DAYS } =
      await import("@/lib/booking.server");
    const db = await admin();
    const loaded = await loadBookingType(db, data.slug);
    if (!loaded) return { slots: [], error: "not_found" as const };
    // At the length they picked, when the type offers it (else its own).
    const type = withDuration(loaded, data.duration);
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

const PublicBookInput = z.object({
  slug: OptionalSlug,
  start: z.string().min(10).max(40),
  name: z.string().trim().max(120).optional().nullable(),
  email: z.string().trim().max(200).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  notes: z.string().trim().max(1500).optional().nullable(),
  applicationId: z.string().uuid().optional().nullable(),
  invite: InviteInput,
  duration: DurationInput,
});

/** Public bookings (no known client) one connection can make in an hour. */
const PUBLIC_BOOKINGS_PER_IP_PER_HOUR = 4;

/**
 * Booking from the page. Who it's for is the server's call (bookingContext):
 * signed in as a client, they book as themselves; with a personal link that
 * works, as its client (a session, their credits), held one booking at a time;
 * anyone else gets an appointment for whoever filled in the form, and typing a
 * client's email never books against their package.
 */

export const bookOnline = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => PublicBookInput.parse(d))
  .handler(async ({ data }) => {
    const { createOnlineBooking, BookingError } = await import("@/lib/booking.server");
    const db = await admin();
    const { type: loaded, invite, identity, client } = await bookingContext(db, data);
    if (!loaded) throw new Error(invite ? blockedMessage(invite.state) : "This booking page isn't taking bookings right now.");
    if (identity.blockedBy) throw new Error(blockedMessage(identity.blockedBy));
    // The coach's length for this link wins over anything the page sends.
    const type = withDuration(loaded, identity.inviteApplies && invite?.durationMin ? invite.durationMin : data.duration);
    // A clients-only type (General Call) takes a coaching client we know is them; never the public.
    if (!audienceAllows(type, client ? { serviceTier: client.service_tier } : null)) {
      throw new Error(CLIENTS_ONLY_MESSAGE);
    }
    const name = data.name?.trim() || client?.full_name || "";
    const email = data.email?.trim() || client?.email || "";
    if (!client) {
      if (!name) throw new Error("Add your name.");
      if (!z.string().email().safeParse(email).success) throw new Error("Add a valid email.");
    }
    const phone = data.phone?.trim() || client?.phone || null;
    if (type.location_mode === "phone" && !phone) {
      throw new Error("Add a phone number so we can call you.");
    }
    // A public booking sends a calendar invitation from the coach's Google and
    // texts a reminder: a few per connection, so one caller can't fill the
    // calendar or use up the page's hourly allowance for everyone. (A known
    // client, signed in or on their personal link, books one at a time per link.)
    if (!client) {
      const { rateOk, callerIp } = await import("@/lib/public-rate-limit.server");
      const ip = callerIp();
      if (ip && !(await rateOk(db as any, `book:ip:${ip}`, PUBLIC_BOOKINGS_PER_IP_PER_HOUR, "1 hour"))) {
        throw new Error("Too many bookings from this connection. Try again in a little while.");
      }
    }
    const { claimInvite, finishInvite } = await import("@/lib/booking-invite.server");
    const inviteId = identity.inviteApplies && invite?.id ? invite.id : null;
    if (inviteId) {
      const claim = await claimInvite(db, inviteId);
      if (claim !== "ok") throw new Error(blockedMessage(claim));
    }
    try {
      const result = await createOnlineBooking(db, {
        type,
        startISO: data.start,
        via: identity.via,
        trustedClient: client,
        booker: { name, email, phone, notes: data.notes },
        applicationId: client ? null : (data.applicationId ?? null),
      });
      if (inviteId) await finishInvite(db, inviteId, result.kind === "session" ? result.id : null);
      return result;
    } catch (e) {
      if (inviteId) await finishInvite(db, inviteId, null).catch(() => {});
      if (e instanceof BookingError) throw new Error(e.message);
      throw e;
    }
  });

/** Staff only, and only for a client their own login can see (RLS). */
async function assertStaffFor(supabase: any, userId: string, clientId: string) {
  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const staff = ((roles ?? []) as any[]).some((r) => r.role === "admin" || r.role === "coach");
  if (!staff) throw new Error("Only coaches can send personal booking links.");
  const { data: c } = await supabase.from("clients").select("id, archived").eq("id", clientId).maybeSingle();
  if (!c) throw new Error("Client not found.");
  if ((c as any).archived) throw new Error("This client's account isn't active.");
}

/**
 * Staff: a personal booking link for one client and one booking type
 * (jfeffect.com/b/<token>). They open it anywhere, signed in or not, and pick
 * a time; it books as them. The token names nobody, runs out after
 * INVITE_DAYS and can be cancelled.
 */
export const createBookingInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ clientId: z.string().uuid(), bookingCardId: z.string().uuid(), duration: DurationInput }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertStaffFor(supabase, userId, data.clientId);
    const db = await admin();
    const { loadBookingTypeById } = await import("@/lib/booking.server");
    const type = await loadBookingTypeById(db, data.bookingCardId);
    if (!type) throw new Error("That booking type isn't taking online bookings.");
    const choices = durationChoices(type);
    const durationMin = choices.length > 1 && data.duration && choices.includes(data.duration) ? data.duration : null;
    const { mintBookingInvite } = await import("@/lib/booking-invite.server");
    const { invitePath } = await import("@/lib/booking-invite");
    const minted = await mintBookingInvite(db, {
      clientId: data.clientId,
      bookingCardId: type.id,
      durationMin,
      createdBy: userId,
    });
    return {
      inviteId: minted.id,
      path: invitePath(minted.token),
      expiresAt: minted.expiresAt,
      durationMin: durationMin ?? type.duration_minutes,
    };
  });

/** Staff: cancel a personal link (it stops booking at once; a booking it made stays). */
export const revokeBookingInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ inviteId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    // RLS: only staff who can see this client's links read the row.
    const { data: row } = await supabase
      .from("booking_invites")
      .select("id, client_id, revoked_at")
      .eq("id", data.inviteId)
      .maybeSingle();
    if (!row) throw new Error("Link not found.");
    await assertStaffFor(supabase, userId, (row as any).client_id);
    if ((row as any).revoked_at) return { ok: true };
    const db = await admin();
    const { error } = await db
      .from("booking_invites")
      .update({ revoked_at: new Date().toISOString(), revoked_by: userId })
      .eq("id", data.inviteId)
      .is("revoked_at", null);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

async function myClient(supabase: any, userId: string) {
  const { data } = await supabase
    .from("clients")
    .select("id, full_name, email, phone, archived, service_tier, user_id")
    .eq("user_id", userId)
    .maybeSingle();
  return data && !data.archived
    ? (data as {
        id: string;
        full_name: string | null;
        email: string | null;
        phone: string | null;
        service_tier: string | null;
        user_id: string | null;
      })
    : null;
}

/** Signed-in client: book as yourself. No form, their sessions and credits. */
export const bookOnlineAsMe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    SlugInput.extend({
      start: z.string().min(10).max(40),
      notes: z.string().trim().max(1500).optional().nullable(),
      duration: DurationInput,
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const me = await myClient(supabase, userId);
    if (!me) throw new Error("Sign in with your client account to book here.");
    const { loadBookingType, createOnlineBooking, BookingError } =
      await import("@/lib/booking.server");
    const db = await admin();
    const loaded = await loadBookingType(db, data.slug);
    if (!loaded) throw new Error("This booking page isn't taking bookings right now.");
    const type = withDuration(loaded, data.duration);
    // A JF member has no coach to call: a clients-only type isn't theirs.
    if (!audienceAllows(type, { serviceTier: me.service_tier })) throw new Error(CLIENTS_ONLY_MESSAGE);
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
    return me
      ? {
          name: me.full_name ?? "",
          email: me.email ?? "",
          // A coaching client (a JF member has no coach): can book clients-only types.
          coaching: me.service_tier !== "self_serve",
        }
      : null;
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
        "id, slug, name, session_type, duration_minutes, duration_options, audience, location_mode, location, uses_credit, color, sort_order",
      )
      .eq("is_active", true)
      .eq("online_enabled", true)
      .eq("show_in_app", true)
      .not("slug", "is", null)
      .order("sort_order", { ascending: true });
    let rows = (types ?? []) as any[];
    if (!rows.length) return [];
    // Clients-only types (General Call) are for coaching clients; a JF member has no coach to call.
    if (rows.some((t) => clientsOnly(t))) {
      const { data: c } = await db.from("clients").select("service_tier").eq("id", clientId).maybeSingle();
      const tier = (c as any)?.service_tier ?? null;
      rows = rows.filter((t) => audienceAllows(t, { serviceTier: tier }));
    }
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
        /** "30 min", or "15–60 min" when they pick the length. */
        duration: durationLabel(t),
        /** A call or meeting, not training: Home offers it as "Book a call". */
        isCall: isCallType(t),
        where: locationLabel(t),
        usesCredit: !!t.uses_credit,
        color: t.color as string | null,
      }));
  });
