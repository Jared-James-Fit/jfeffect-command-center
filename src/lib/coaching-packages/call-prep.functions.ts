import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { bookingWords, buildCallPrep, type CallPrep } from "./call-prep";

/**
 * The coach's side of a call with a client: the overview before it
 * (getCallPrep) and the action items after it (saveCallReview), all read and
 * written with the coach's own login (RLS: an admin, or the client's own
 * coach). The coach's private note stays the session sheet's own note
 * (session-coach-notes.ts); action items reach the client only when the coach
 * sends them in the chat (markCallReviewShared records that).
 */

export type CallPrepResult = CallPrep & {
  sessionId: string;
  clientId: string;
  clientName: string | null;
  firstName: string | null;
  when: string | null;
  sessionDate: string;
  /** This call's own action items and priorities (after the call). */
  review: { actionItems: string[]; nextPriorities: string | null; sharedAt: string | null } | null;
};

export const getCallPrep = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sessionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<CallPrepResult> => {
    const { supabase } = context as any;
    const { data: s, error } = await supabase
      .from("pt_sessions")
      .select("id, client_id, session_date, starts_at, notes, booking_card_id, status")
      .eq("id", data.sessionId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!s) throw new Error("You can't see this call.");
    const clientId: string = s.client_id;
    const { data: c } = await supabase
      .from("clients")
      .select("full_name, first_name, preferred_name, timezone")
      .eq("id", clientId)
      .maybeSingle();
    const tz = (c as any)?.timezone || "America/Winnipeg";
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const safe = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
      try {
        return await fn();
      } catch {
        return null;
      }
    };
    const { loadClientPrepRecords, previousReview } = await import("./call-prep.server");
    const [records, topics, usage] = await Promise.all([
      loadClientPrepRecords(supabase, clientId, today),
      safe(async () => {
        const { data: t } = await supabase.from("coaching_call_topics").select("topics").eq("pt_session_id", s.id).maybeSingle();
        return ((t as any)?.topics as string | undefined) ?? null;
      }),
      safe(async () => {
        if (!s.booking_card_id) return null;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: u } = await (supabaseAdmin as any).rpc("coaching_call_usage", {
          _client: clientId,
          _card: s.booking_card_id,
          _on: s.session_date,
        });
        return u as any;
      }),
    ]);
    const ownReview = records.reviews.find((r) => r.ptSessionId === s.id) ?? null;
    const { reviews: _reviews, unit: _unit, ...facts } = records;
    const prep = buildCallPrep({
      ...facts,
      today,
      topics: topics ?? null,
      bookingNote: bookingWords(s.notes),
      previous: previousReview(records.reviews, s.session_date, s.id),
      calls: usage ? { used: Number(usage.used), included: Number(usage.included), periodEnd: String(usage.period_end) } : null,
    });

    const first = (c as any)?.preferred_name || (c as any)?.first_name || String((c as any)?.full_name ?? "").split(/\s+/)[0] || null;
    return {
      ...prep,
      sessionId: s.id,
      clientId,
      clientName: (c as any)?.full_name ?? null,
      firstName: first,
      when: s.starts_at ?? null,
      sessionDate: s.session_date,
      review: ownReview
        ? { actionItems: ownReview.actionItems, nextPriorities: ownReview.nextPriorities, sharedAt: ownReview.sharedAt }
        : null,
    };
  });

/** The coach's action items and next priorities after a call (staff only; the client sees them only once sent). */
export const saveCallReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        sessionId: z.string().uuid(),
        actionItems: z.array(z.string().trim().max(300)).max(12),
        nextPriorities: z.string().trim().max(1000).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context as any;
    const items = data.actionItems.map((a) => a.trim()).filter(Boolean);
    const { data: saved, error } = await supabase
      .from("coaching_call_reviews")
      .upsert({ pt_session_id: data.sessionId, action_items: items, next_priorities: data.nextPriorities || null })
      .select("pt_session_id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!saved) throw new Error("You can't change this call's notes.");
    return { ok: true };
  });

/** After the coach sent the action items in the chat: which message, and when. */
export const markCallReviewShared = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sessionId: z.string().uuid(), messageId: z.string().uuid().nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: saved, error } = await supabase
      .from("coaching_call_reviews")
      .update({ shared_at: new Date().toISOString(), shared_by: userId, shared_message_id: data.messageId })
      .eq("pt_session_id", data.sessionId)
      .select("pt_session_id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!saved) throw new Error("Save the action items first.");
    return { ok: true };
  });
