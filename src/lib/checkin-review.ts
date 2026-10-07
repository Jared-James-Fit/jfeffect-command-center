/**
 * "Reviewed" state for chat check-ins and the Clients page's Review Due badge.
 *
 * A staff reply in the chat closes a client's open check-ins automatically (database
 * trigger). These helpers are the manual one-tap paths: the card's "Mark reviewed",
 * "Use reply", and the Clients badge's "Mark reviewed".
 */
import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ReviewedVia = "reply" | "use_reply" | "manual" | "backfill" | null | undefined;

/** Short phrase for how a check-in got closed. */
export function reviewedViaLabel(via: ReviewedVia): string {
  switch (via) {
    case "reply": return "you replied";
    case "use_reply": return "reply used";
    case "backfill": return "already replied";
    default: return "marked reviewed";
  }
}

export async function markCheckinReviewed(checkinId: string, via: "manual" | "use_reply" = "manual"): Promise<boolean> {
  const { data, error } = await (supabase as any).rpc("mark_checkin_reviewed", { _checkin_id: checkinId, _via: via });
  if (error) throw new Error(error.message);
  return !!data;
}

export async function reopenCheckinReview(checkinId: string): Promise<boolean> {
  const { data, error } = await (supabase as any).rpc("reopen_checkin_review", { _checkin_id: checkinId });
  if (error) throw new Error(error.message);
  return !!data;
}

/** Closes everything "Review Due" counts for this client. Returns how many items it closed. */
export async function markClientReviewsReviewed(clientId: string): Promise<number> {
  const { data, error } = await (supabase as any).rpc("mark_client_reviews_reviewed", { _client_id: clientId });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

/** Refresh every list that shows review state (Clients badge, Messages inbox, the card itself). */
export function refreshReviewQueries(qc: QueryClient, checkinId?: string) {
  if (checkinId) qc.invalidateQueries({ queryKey: ["messenger-checkin", checkinId] });
  for (const k of ["clients-directory", "message-form-checkin-inbox", "admin-nav-badges", "staff-inbox-state"]) {
    qc.invalidateQueries({ queryKey: [k] });
  }
}
