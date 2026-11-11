/**
 * Server-only: tells clients about sessions booked for them (session-booked.ts
 * has the rules and wording). Run by the session-bookings-tick hook, which the
 * database calls the moment a booking is inserted (`pt_sessions_booked_kick`)
 * and pg_cron calls every minute while one waits.
 *
 * Each session is claimed (`confirmation_sent_at`) before anything is sent, so
 * two runs can never announce it twice; a message that fails to save gives the
 * claim back for the next run. Never throws past one client: one client's
 * problem never holds back another's message.
 */
import {
  BOOKED_LOOKBACK_MS,
  bookedCard,
  bookedMessageBody,
  quietWaitMs,
  shouldAnnounceBooking,
  type BookedSessionRow,
} from "@/lib/session-booked";

type Db = any;

const COLUMNS =
  "id, client_id, title, session_type, session_date, start_time, end_time, starts_at, created_at, status, location, wants_meet, booked_via, visible_to_client, send_confirmation_email, confirmation_sent_at";

export type AnnounceResult = {
  announced: number;
  messages: number;
  skipped: Array<{ clientId: string; reason: string }>;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pendingBookings(db: Db, now: Date): Promise<BookedSessionRow[]> {
  const { data, error } = await db
    .from("pt_sessions")
    .select(COLUMNS)
    .is("confirmation_sent_at", null)
    .eq("status", "Scheduled")
    .gt("starts_at", now.toISOString())
    .gt("created_at", new Date(now.getTime() - BOOKED_LOOKBACK_MS).toISOString())
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) throw new Error(error.message);
  return ((data ?? []) as BookedSessionRow[]).filter((s) => shouldAnnounceBooking(s, now));
}

/** Who it's from: the client's coach, else an admin. */
async function senderFor(db: Db, assignedCoachId: string | null): Promise<string | null> {
  if (assignedCoachId) {
    const { data: coach } = await db.from("coaches").select("user_id").eq("id", assignedCoachId).maybeSingle();
    if (coach?.user_id) return coach.user_id as string;
  }
  const { data: admin } = await db.from("user_roles").select("user_id").eq("role", "admin").limit(1).maybeSingle();
  return (admin?.user_id as string) ?? null;
}

async function announceForClient(db: Db, clientId: string, ids: string[], now: Date): Promise<{ announced: number; reason?: string }> {
  // Claim first, re-checked: a session cancelled or announced since the read is left out.
  const { data: claimed, error } = await db
    .from("pt_sessions")
    .update({ confirmation_sent_at: now.toISOString() })
    .in("id", ids)
    .is("confirmation_sent_at", null)
    .eq("status", "Scheduled")
    .select(COLUMNS);
  if (error) return { announced: 0, reason: error.message };
  const sessions = ((claimed ?? []) as BookedSessionRow[]).filter((s) => Date.parse(s.starts_at) > now.getTime());
  if (!sessions.length) return { announced: 0, reason: "already_claimed" };

  const { data: client } = await db
    .from("clients")
    .select("id, user_id, assigned_coach_id")
    .eq("id", clientId)
    .maybeSingle();
  // No login: there's no chat for them to read (the claim stays, so it's never sent late).
  if (!client?.user_id) return { announced: 0, reason: "no_login" };

  const giveBack = () =>
    db.from("pt_sessions").update({ confirmation_sent_at: null }).in("id", sessions.map((s) => s.id));

  const sender = await senderFor(db, client.assigned_coach_id ?? null);
  if (!sender) {
    await giveBack();
    return { announced: 0, reason: "no_sender" };
  }

  const at = now.toISOString();
  const { data: msg, error: msgErr } = await db
    .from("messages")
    .insert({
      client_id: clientId,
      sender_id: sender,
      sender_role: "admin",
      body: bookedMessageBody(sessions),
      attachments: [bookedCard(sessions)],
      message_type: "Scheduling",
      is_internal_note: false,
      // Automated: never counts as the coach replying, and never earns an "unread message" text.
      is_automated: true,
      delivery_status: "sent",
      sent_at: at,
      read_by_admin_at: at,
    })
    .select("id")
    .single();
  if (msgErr || !msg) {
    await giveBack();
    return { announced: 0, reason: msgErr?.message ?? "message_failed" };
  }

  try {
    const { notifyAppEvent } = await import("@/lib/push/app-events.server");
    await notifyAppEvent(db, "session_booked", { clientId, sourceId: msg.id, actorUserId: sender });
  } catch {
    /* the chat message is the record; the push is a courtesy */
  }
  return { announced: sessions.length };
}

/**
 * Announce every booking that's waiting, one message per client. Waits for a
 * booking spree to finish first (`quietWaitMs`), so Book ahead's sessions,
 * written one at a time, go out as one message.
 */
export async function announceBookedSessions(
  db: Db,
  opts: { now?: () => Date; wait?: (ms: number) => Promise<void> } = {},
): Promise<AnnounceResult> {
  const clock = opts.now ?? (() => new Date());
  const wait = opts.wait ?? sleep;
  const result: AnnounceResult = { announced: 0, messages: 0, skipped: [] };

  let waited = 0;
  let pending = await pendingBookings(db, clock());
  for (;;) {
    const ms = quietWaitMs(pending.map((s) => s.created_at), clock(), waited);
    if (ms <= 0) break;
    await wait(ms);
    waited += ms;
    pending = await pendingBookings(db, clock());
  }
  if (!pending.length) return result;

  const byClient = new Map<string, string[]>();
  for (const s of pending) byClient.set(s.client_id, [...(byClient.get(s.client_id) ?? []), s.id]);

  for (const [clientId, ids] of byClient) {
    try {
      const r = await announceForClient(db, clientId, ids, clock());
      if (r.announced) {
        result.announced += r.announced;
        result.messages += 1;
      } else if (r.reason && r.reason !== "already_claimed") {
        result.skipped.push({ clientId, reason: r.reason });
      }
    } catch (e: any) {
      result.skipped.push({ clientId, reason: String(e?.message ?? e).slice(0, 200) });
    }
  }
  return result;
}
