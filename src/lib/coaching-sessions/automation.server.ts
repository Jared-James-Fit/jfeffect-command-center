/**
 * Appointment automation for calls (server only, run from the 5-minute
 * schedule tick before the push reminders): one day-before message per call,
 * never more.
 *
 * A day before a call (24h, until 3h before), in the client's coach chat, one
 * automated message (`is_automated`, from their coach, Scheduling) carrying:
 *  - the confirmation request (Confirm · Change time · Can't make it) when
 *    they haven't confirmed (a call they booked themselves is confirmed);
 *  - the meeting's preparation questions only when they'd tell the coach
 *    something the records can't (questionnaireFor: 1–3 questions, plus an
 *    optional note), as the "Before our call" form, worded for them.
 * One push goes with it (the chat's own). Nothing goes when there's nothing to
 * ask: the push reminder engine then sends its plain day-before reminder.
 * Stamped first (pt_sessions.confirmation_requested_at), so it's never sent
 * twice; a move clears the stamp and the next day-before message goes for the
 * new time. A call booked within a day of its start isn't asked to confirm.
 */
import { isTrainingSessionType } from "@/lib/booking-types";
import { fmtClock, fmtDayLabel } from "@/lib/schedule-time";
import { relativeDayWord } from "@/lib/pt-session-reminders";
import {
  confirmationDue,
  SELF_BOOKED_VIA,
  CONFIRM_LEAD_MIN,
  CONFIRM_MIN_LEAD_MIN,
  LATE_BOOKING_MIN,
} from "./lifecycle";
import { PRE_CALL_FORM_ID } from "./questionnaire";

type Admin = any;
const DEFAULT_TZ = "America/Winnipeg";

/** The day-before message's words: short, conversational, and plainly automatic. */
export function dayBeforeWords(x: {
  coachFirst: string | null;
  day: string;
  time: string;
  confirm: boolean;
  questions: number;
  minutes: number;
}): string {
  const who = x.coachFirst ? ` with ${x.coachFirst}` : "";
  if (x.confirm && x.questions)
    return `Your call${who} is ${x.day} at ${x.time}. Tap Confirm if you're still good, and if you have a minute, ${x.questions === 1 ? "one quick question" : `${x.questions} quick questions`} so we can make the most of it.`;
  if (x.confirm)
    return `Your call${who} is ${x.day} at ${x.time}. Still good? Tap Confirm, or pick another time.`;
  return `Looking forward to our call ${x.day} at ${x.time}. ${x.questions === 1 ? "One quick question" : `${x.questions} quick questions`} before then (about ${x.minutes} min), so we can make the most of it.`;
}

export async function runMeetingAutomation(admin: Admin, now: Date = new Date()) {
  const db = admin as any;
  const from = new Date(now.getTime() + CONFIRM_MIN_LEAD_MIN * 60_000).toISOString();
  const to = new Date(now.getTime() + CONFIRM_LEAD_MIN * 60_000).toISOString();
  const { data: rows, error } = await db
    .from("pt_sessions")
    .select(
      "id, client_id, title, session_type, status, starts_at, timezone, created_at, time_set_at, booked_via, client_confirmed_at, confirmation_requested_at, visible_to_client",
    )
    .eq("status", "Scheduled")
    .is("confirmation_requested_at", null)
    .gte("starts_at", from)
    .lte("starts_at", to)
    .limit(60);
  if (error) throw new Error(error.message);
  const calls = ((rows ?? []) as any[]).filter((r) => !isTrainingSessionType(r.session_type));
  if (!calls.length) return { considered: 0, sent: 0 };
  const ids = [...new Set(calls.map((c) => c.client_id))];
  const { data: clients } = await db
    .from("clients")
    .select("id, user_id, archived, assigned_coach_id, service_tier")
    .in("id", ids);
  const byId = new Map(((clients ?? []) as any[]).map((c) => [c.id, c]));
  const coachIds = [
    ...new Set(((clients ?? []) as any[]).map((c) => c.assigned_coach_id).filter(Boolean)),
  ];
  const { data: coaches } = coachIds.length
    ? await db.from("coaches").select("id, user_id, full_name").in("id", coachIds)
    : { data: [] };
  const coachBy = new Map(((coaches ?? []) as any[]).map((c) => [c.id, c]));
  let sent = 0;
  const out: Array<{ id: string; confirm: boolean; questions: number }> = [];
  for (const call of calls) {
    const c = byId.get(call.client_id);
    if (!c || c.archived || !c.user_id) continue;
    const coach = c.assigned_coach_id ? coachBy.get(c.assigned_coach_id) : null;
    if (!coach?.user_id) continue;
    const selfBooked = SELF_BOOKED_VIA.has(String(call.booked_via ?? ""));
    const start = Date.parse(call.starts_at);
    const arranged = Date.parse(call.time_set_at ?? call.created_at ?? "");
    const late = Number.isFinite(arranged) && (start - arranged) / 60_000 < LATE_BOOKING_MIN;
    if (late) continue;
    const confirm = confirmationDue(
      {
        status: call.status,
        startsAt: call.starts_at,
        createdAt: call.created_at,
        timeSetAt: call.time_set_at,
        clientConfirmedAt: call.client_confirmed_at,
        confirmationRequestedAt: call.confirmation_requested_at,
        bookedByClient: selfBooked,
        hasApp: true,
        visibleToClient: call.visible_to_client !== false,
      },
      now,
    );
    // the meeting's preparation questions, only when they'd help
    let q: {
      keys: string[];
      labels: Record<string, string>;
      minutes: number;
      reasons: string[];
      useful: boolean;
    } | null = null;
    const { data: meeting } = await db
      .from("coaching_sessions")
      .select("id, event, questionnaire, status")
      .eq("pt_session_id", call.id)
      .maybeSingle();
    if (
      meeting &&
      !(meeting as any).questionnaire?.sent_at &&
      (meeting as any).status !== "cancelled"
    ) {
      try {
        const { loadSessionContext, questionsFor } = await import("./sessions.server");
        const ctx = await loadSessionContext(db, call.client_id);
        const { data: t } = await db
          .from("coaching_call_topics")
          .select("topics")
          .eq("pt_session_id", call.id)
          .maybeSingle();
        const ev = (meeting as any).event?.title ? (meeting as any).event : null;
        q = (await questionsFor(ctx, ev, !!(t as any)?.topics?.trim())) as any;
      } catch (e) {
        console.warn("[meetings] questions", call.id, e);
      }
    }
    const asks = q?.useful
      ? q.keys.filter((k) => k !== "topics" && k !== "pain_details").length
      : 0;
    if (!confirm && !asks) continue;
    // claim first: never twice
    const { data: claimed } = await db
      .from("pt_sessions")
      .update({ confirmation_requested_at: now.toISOString() })
      .eq("id", call.id)
      .is("confirmation_requested_at", null)
      .select("id");
    if (!claimed?.length) continue;
    const tz = call.timezone || DEFAULT_TZ;
    const at = new Date(call.starts_at);
    const day = relativeDayWord(at, now, tz) ?? `on ${fmtDayLabel(at, tz)}`;
    const body = dayBeforeWords({
      coachFirst: coach.full_name ? String(coach.full_name).split(" ")[0] : null,
      day,
      time: fmtClock(at, tz),
      confirm,
      questions: asks,
      minutes: q?.minutes ?? 1,
    });
    const attachments: any[] = [
      {
        kind: "session_confirm",
        type: "file",
        url: "",
        pt_session_id: call.id,
        ask_confirm: confirm,
      },
    ];
    const nowIso = now.toISOString();
    if (asks && q) {
      const { data: existing } = await db
        .from("nf_assignments")
        .select("settings")
        .eq("form_id", PRE_CALL_FORM_ID)
        .eq("client_id", call.client_id)
        .maybeSingle();
      const settings = {
        ...(((existing as any)?.settings ?? {}) as Record<string, unknown>),
        ask_keys: q.keys,
        ask_labels: q.labels,
        session_id: (meeting as any).id,
      };
      const { error: aErr } = await db
        .from("nf_assignments")
        .upsert(
          {
            form_id: PRE_CALL_FORM_ID,
            client_id: call.client_id,
            last_sent_by: coach.user_id,
            last_sent_at: nowIso,
            settings,
          },
          { onConflict: "form_id,client_id" },
        );
      if (!aErr) {
        const { data: form } = await db
          .from("nf_forms")
          .select("id, title, active, archived")
          .eq("id", PRE_CALL_FORM_ID)
          .maybeSingle();
        if (form && !(form as any).archived) {
          if (!(form as any).active)
            await db.from("nf_forms").update({ active: true }).eq("id", PRE_CALL_FORM_ID);
          attachments.push({
            kind: "form_request",
            type: "link",
            url: `/portal/check-ins/${PRE_CALL_FORM_ID}`,
            form_id: PRE_CALL_FORM_ID,
            assignment_client_ids: [call.client_id],
            request_title: (form as any).title,
          });
        }
      }
    }
    const { data: msg, error: mErr } = await db
      .from("messages")
      .insert({
        client_id: call.client_id,
        sender_id: coach.user_id,
        sender_role: "admin",
        body,
        message_type: "Scheduling",
        is_automated: true,
        is_internal_note: false,
        delivery_status: "sent",
        sent_at: nowIso,
        read_by_admin_at: nowIso,
        attachments,
      })
      .select("id")
      .single();
    if (mErr) {
      // give the claim back: the next tick tries again
      await db.from("pt_sessions").update({ confirmation_requested_at: null }).eq("id", call.id);
      console.warn("[meetings] day-before message", call.id, mErr.message);
      continue;
    }
    if (asks && q && meeting)
      await db
        .from("coaching_sessions")
        .update({
          questionnaire: {
            sent_at: nowIso,
            keys: q.keys,
            labels: q.labels,
            minutes: q.minutes,
            reasons: q.reasons,
            message_id: msg.id,
            answers: {},
            auto: true,
          },
        })
        .eq("id", (meeting as any).id);
    try {
      const { pushNewMessage } = await import("@/lib/push/message-push.server");
      await pushNewMessage(db, {
        id: msg.id,
        client_id: call.client_id,
        sender_id: coach.user_id,
        sender_role: "admin",
        is_internal_note: false,
        body,
        attachments: [],
      } as any);
    } catch (e) {
      console.warn("[meetings] day-before push", e);
    }
    if (meeting)
      await db
        .from("coaching_session_events")
        .insert({
          session_id: (meeting as any).id,
          client_id: call.client_id,
          actor: "system",
          action: "day_before_sent",
          detail: { confirm, questions: asks, message_id: msg.id },
        });
    sent++;
    out.push({ id: call.id, confirm, questions: asks });
  }
  return { considered: calls.length, sent, out };
}
