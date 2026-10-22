// Server-only: "Book the rest" for one client (see session-prebook.ts for the
// rules). Reads their sessions, credits and the coach's Google Calendar, and
// books: a day the coach already has a Google appointment for is linked
// (import_calendar_pt_session, no second Google event); any other day becomes
// a booked session that holds a credit, which the Google sync then adds.
import type { SupabaseClient } from "@supabase/supabase-js";
import { planPrebook, type GoogleSlot, type PrebookPlan } from "@/lib/session-prebook";
import { addDaysISO, localDateISO, DEFAULT_TZ } from "@/lib/schedule-time";

type Admin = SupabaseClient<any, any, any>;

export type PrebookPreview = PrebookPlan & { googleNote: string | null };

export type PrebookResult = { booked: number; linked: number; created: number; errors: string[] };

/** `admin` reads everything; `staff` is the signed-in coach (session_balance answers only a staff login). */
type Db = { admin: Admin; staff: Admin };

async function readClient(db: Db, clientId: string, today: string) {
  const [{ data: sessions, error: sErr }, { data: balance, error: bErr }] = await Promise.all([
    db.admin.from("pt_sessions").select("session_date, start_time, end_time, status, location, title, timezone").eq("client_id", clientId),
    (db.staff as any).rpc("session_balance", { _client_id: clientId }),
  ]);
  if (sErr) throw new Error(sErr.message);
  if (bErr) throw new Error(bErr.message);
  const open = ((balance ?? []) as Array<{ remaining: number | null; expires_at: string | null }>).filter(
    (b) => Number(b.remaining ?? 0) > 0 && (!b.expires_at || String(b.expires_at).slice(0, 10) >= today),
  );
  const available = open.reduce((n, b) => n + Number(b.remaining ?? 0), 0);
  // Every package with room expires: the last of those days is the last a credit can go on.
  const until = open.length && open.every((b) => b.expires_at) ? open.map((b) => String(b.expires_at).slice(0, 10)).sort().pop()! : null;
  return { sessions: (sessions ?? []) as any[], available, until };
}

export async function previewPrebook(db: Db, clientId: string): Promise<PrebookPreview> {
  const today = localDateISO(new Date(), DEFAULT_TZ);
  const admin = db.admin;
  const { sessions, available, until } = await readClient(db, clientId, today);
  const base = planPrebook({ sessions, available, today, until });
  if (!base.slots.length) return { ...base, googleNote: null };

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
  return { ...planPrebook({ sessions, available, today, until, google }), googleNote };
}

export async function applyPrebook(db: Db, clientId: string, dates: string[]): Promise<PrebookResult> {
  const admin = db.admin;
  const plan = await previewPrebook(db, clientId);
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
    // Oldest first, so the credits are held in the order the sessions come.
    const { error } = await admin.from("pt_sessions").insert(
      fresh.map((s) => ({
        client_id: clientId,
        title: s.title,
        session_date: s.date,
        start_time: s.start,
        end_time: s.end,
        timezone: s.timezone || DEFAULT_TZ,
        location: s.location || "Iron Image Gym",
        status: "Scheduled",
        uses_credit: true,
        visible_to_client: true,
        send_confirmation_email: false,
        reminders_enabled: true,
      })),
    );
    if (error) out.errors.push(error.message);
    else out.created = fresh.length;
  }
  out.booked = out.linked + out.created;
  return out;
}
