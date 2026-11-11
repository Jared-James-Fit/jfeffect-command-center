// Server-only: "Book ahead" for one client (see session-prebook.ts for the
// rules). Reads their sessions, packages and the coach's Google Calendar, and
// books: a day the coach already has a Google appointment for is linked
// (import_calendar_pt_session, no second Google event); any other day becomes
// a booked session that holds a credit, which the Google sync then adds.
// Booked past the credits they have, a session holds nothing yet and goes on
// their next package (a renewal they pay later) the moment it's added.
import type { SupabaseClient } from "@supabase/supabase-js";
import { planPrebook, type GoogleSlot, type PatternOverride, type PrebookPlan } from "@/lib/session-prebook";
import { latestPackage } from "@/lib/client-owed";
import { addDaysISO, localDateISO, DEFAULT_TZ } from "@/lib/schedule-time";

type Admin = SupabaseClient<any, any, any>;

export type PrebookPreview = PrebookPlan & {
  googleNote: string | null;
  /** What the planner books when the coach doesn't say: what's left on their packages, else the rest of the next one. */
  defaultCount: number;
  /** Most it may book: what's left plus two of their packages. */
  maxCount: number;
  /** The package their next one renews (null: no priced package, so nothing past their credits). */
  renewal: { size: number; priceCents: number; name: string } | null;
  /** Sessions already trained or booked past every package (on the next one). */
  pastPackages: number;
};

export type PrebookResult = { booked: number; linked: number; created: number; errors: string[] };

export type PrebookOptions = { count?: number | null; pattern?: PatternOverride | null };

/** `admin` reads everything; `staff` is the signed-in coach (session_balance answers only a staff login). */
type Db = { admin: Admin; staff: Admin };

/** Hard cap on one run (and the double-booking check's limit). */
export const PREBOOK_MAX = 48;

const SALE_COLS =
  "id, offer_name, sessions_purchased, contract_value_cents, full_payable_amount, installment_amount, number_of_payments, amount_paid_cents, amount_paid, amount_tax_paid_cents, payment_status, is_recurring, currency, purchased_at, created_at, archived_at";

async function readClient(db: Db, clientId: string, today: string) {
  const [sessionsRes, balanceRes, salesRes, looseRes] = await Promise.all([
    db.admin.from("pt_sessions").select("session_date, start_time, end_time, status, location, title, timezone, booking_card_id, session_type").eq("client_id", clientId),
    (db.staff as any).rpc("session_balance", { _client_id: clientId }),
    db.admin.from("purchase_records").select(SALE_COLS).eq("client_id", clientId).gt("sessions_purchased", 0),
    db.admin.from("session_ledger_events").select("session_count").eq("client_id", clientId).is("purchase_id", null),
  ]);
  for (const r of [sessionsRes, balanceRes, salesRes, looseRes]) if (r.error) throw new Error(r.error.message);
  const open = ((balanceRes.data ?? []) as Array<{ remaining: number | null; expires_at: string | null }>).filter(
    (b) => Number(b.remaining ?? 0) > 0 && (!b.expires_at || String(b.expires_at).slice(0, 10) >= today),
  );
  // Free sessions given with no package count too (their net is what's left of them).
  const looseNet = ((looseRes.data ?? []) as Array<{ session_count: number | null }>).reduce((t, e) => t + Number(e.session_count ?? 0), 0);
  const available = open.reduce((n, b) => n + Number(b.remaining ?? 0), 0) + Math.max(0, looseNet);
  // Every package with room expires: the last of those days is the last a credit can go on.
  const until = open.length && looseNet <= 0 && open.every((b) => b.expires_at) ? open.map((b) => String(b.expires_at).slice(0, 10)).sort().pop()! : null;
  const pkg = latestPackage((salesRes.data ?? []) as any[]);
  const renewal = pkg ? { size: pkg.size, priceCents: pkg.priceCents, name: pkg.sale.offer_name ?? "Session package" } : null;
  const pastPackages = Math.max(0, -looseNet);
  // Booked ahead with nothing left: the rest of the next package (a whole one when none is started).
  const defaultCount = available > 0 ? available : renewal ? renewal.size - (pastPackages % renewal.size) : 0;
  const maxCount = Math.min(PREBOOK_MAX, available + (renewal ? renewal.size * 2 : 0));
  return {
    sessions: (sessionsRes.data ?? []) as any[],
    available,
    until,
    renewal,
    pastPackages,
    defaultCount: Math.min(defaultCount, maxCount),
    maxCount,
  };
}

function countFor(opts: PrebookOptions, info: { defaultCount: number; maxCount: number }): number {
  if (opts.count == null) return info.defaultCount;
  return Math.max(0, Math.min(info.maxCount, Math.floor(opts.count)));
}

export async function previewPrebook(db: Db, clientId: string, opts: PrebookOptions = {}): Promise<PrebookPreview> {
  const today = localDateISO(new Date(), DEFAULT_TZ);
  const admin = db.admin;
  const info = await readClient(db, clientId, today);
  const count = countFor(opts, info);
  const extra = { defaultCount: info.defaultCount, maxCount: info.maxCount, renewal: info.renewal, pastPackages: info.pastPackages };
  const args = { sessions: info.sessions, available: info.available, count, today, until: info.until, pattern: opts.pattern ?? null };
  const base = planPrebook(args);
  if (!base.slots.length) return { ...base, ...extra, googleNote: null };

  // The coach often has the series in Google already: use those appointments.
  let google: GoogleSlot[] = [];
  let googleNote: string | null = null;
  try {
    const { workspaceCalendarConfigured } = await import("@/lib/google-cal.server");
    if (workspaceCalendarConfigured()) {
      const { previewGoogleImport } = await import("@/lib/gcal-session-import.server");
      const p = await previewGoogleImport(admin, {
        clientIds: [clientId],
        from: base.slots[0].date,
        to: addDaysISO(base.slots[base.slots.length - 1].date, 14),
      });
      google = p.candidates
        .filter((c) => !c.past && c.clientId === clientId)
        .map((c) => ({ date: c.date, start: c.start, end: c.end, eventId: c.eventId, calendarId: c.calendarId, summary: c.summary, location: c.location, timezone: c.timezone }));
    }
  } catch (e: any) {
    googleNote = `Couldn't read Google Calendar (${e?.message ?? "error"}), so every session will be added to it as new.`;
  }
  return { ...planPrebook({ ...args, google }), ...extra, googleNote };
}

export async function applyPrebook(db: Db, clientId: string, dates: string[], opts: PrebookOptions = {}): Promise<PrebookResult> {
  const admin = db.admin;
  const plan = await previewPrebook(db, clientId, opts);
  const wanted = new Set(dates);
  const chosen = plan.slots.filter((s) => wanted.has(s.date));
  const out: PrebookResult = { booked: 0, linked: 0, created: 0, errors: [] };

  const linked = chosen.filter((s) => s.google);
  if (linked.length) {
    const { applyGoogleImport } = await import("@/lib/gcal-session-import.server");
    const r = await applyGoogleImport(
      admin,
      linked.map((s) => ({
        eventId: s.google!.eventId,
        calendarId: s.google!.calendarId,
        clientId,
        summary: s.google!.summary,
        date: s.date,
        start: s.start,
        end: s.end,
        timezone: s.timezone,
        location: s.location,
        past: false,
        training: true,
      })),
    );
    out.linked = r.created + r.linked;
    out.errors.push(...r.errors);
  }

  const fresh = chosen.filter((s) => !s.google);
  if (fresh.length) {
    // The same kind of session as their last one (its booking type), at their usual place.
    const { data: last } = await admin
      .from("pt_sessions")
      .select("booking_card_id, session_type")
      .eq("client_id", clientId)
      .in("status", ["Scheduled", "Completed", "Missed"])
      .order("session_date", { ascending: false })
      .order("start_time", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data: client } = await admin.from("clients").select("default_session_location").eq("id", clientId).maybeSingle();
    // One at a time, oldest first, so each holds its credit (or goes on the next package) in date order.
    for (const s of fresh) {
      const { error } = await admin.from("pt_sessions").insert({
        client_id: clientId,
        title: s.title,
        session_date: s.date,
        start_time: s.start,
        end_time: s.end,
        timezone: s.timezone || DEFAULT_TZ,
        location: s.location || (client as { default_session_location?: string | null } | null)?.default_session_location || undefined,
        status: "Scheduled",
        uses_credit: true,
        visible_to_client: true,
        // One "Booked N sessions" message in their chat for the whole batch (session-booked.server.ts).
        send_confirmation_email: true,
        reminders_enabled: true,
        ...((last as any)?.booking_card_id ? { booking_card_id: (last as any).booking_card_id } : {}),
        ...((last as any)?.session_type ? { session_type: (last as any).session_type } : {}),
      });
      if (error) out.errors.push(`${s.date}: ${error.message}`);
      else out.created += 1;
    }
  }
  out.booked = out.linked + out.created;
  return out;
}
