import { supabase } from "@/integrations/supabase/client";

const db = supabase as any;

export type ManualReviewSource = "native" | "fillout" | "external" | "manual";

export type ManualCheckInReview = {
  id: string;
  client_id: string;
  coach_user_id: string;
  source: ManualReviewSource;
  check_in_date: string | null;
  title: string;
  message: string;
  action_items: string | null;
  priority: string | null;
  internal_notes: string | null;
  external_link: string | null;
  notify_client: boolean;
  seen_at: string | null;
  read_at: string | null;
  dismissed_at: string | null;
  created_at: string;
  updated_at: string;
};

export async function createManualReview(input: {
  clientId: string;
  coachUserId: string;
  source: ManualReviewSource;
  checkInDate?: string | null;
  title: string;
  message: string;
  actionItems?: string | null;
  priority?: string | null;
  internalNotes?: string | null;
  externalLink?: string | null;
  notifyClient?: boolean;
}) {
  const { data, error } = await db
    .from("manual_check_in_reviews")
    .insert({
      client_id: input.clientId,
      coach_user_id: input.coachUserId,
      source: input.source,
      check_in_date: input.checkInDate ?? null,
      title: input.title,
      message: input.message,
      action_items: input.actionItems ?? null,
      priority: input.priority ?? null,
      internal_notes: input.internalNotes ?? null,
      external_link: input.externalLink ?? null,
      notify_client: input.notifyClient ?? true,
    })
    .select()
    .single();
  if (error) throw error;
  return data as ManualCheckInReview;
}

export async function listManualReviewsForClient(clientId: string) {
  const { data, error } = await db
    .from("manual_check_in_reviews")
    .select("*")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ManualCheckInReview[];
}

export async function listAllManualReviews(opts: { onlyUnread?: boolean } = {}) {
  let q = db.from("manual_check_in_reviews").select("*, client:clients(id, full_name, email)").order("created_at", { ascending: false });
  if (opts.onlyUnread) q = q.is("read_at", null);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as (ManualCheckInReview & { client: { id: string; full_name: string | null; email: string | null } | null })[];
}

export async function listUnreadForClientUser(clientId: string) {
  const { data, error } = await db
    .from("manual_check_in_reviews")
    .select("*")
    .eq("client_id", clientId)
    .is("read_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  // Session-only "view later" dismissals — clears on tab reload / app re-entry.
  const suppressed = getSessionDismissed();
  return ((data ?? []) as ManualCheckInReview[]).filter((r) => !suppressed.has(r.id));
}

export async function markReviewSeen(id: string) {
  await db.from("manual_check_in_reviews").update({ seen_at: new Date().toISOString() }).eq("id", id).is("seen_at", null);
}

export async function markReviewRead(id: string) {
  const now = new Date().toISOString();
  const { error } = await db.from("manual_check_in_reviews").update({ read_at: now, dismissed_at: now }).eq("id", id);
  if (error) throw error;
}

/**
 * Suppress this review for the current browser session only. The DB is not
 * touched, so when the client re-enters the app it will pop up again until
 * they tap "Got it" (which calls markReviewRead).
 */
export async function dismissReviewForNow(id: string) {
  const set = getSessionDismissed();
  set.add(id);
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(Array.from(set)));
  } catch {}
}

const SESSION_KEY = "manual-check-in-reviews:session-dismissed";
function getSessionDismissed(): Set<string> {
  if (typeof sessionStorage === "undefined") return new Set();
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

/**
 * Resend a manual review — clears read/seen/dismissed timestamps and bumps
 * updated_at so it shows back up in the client's unread pop-up.
 */
export async function resendManualReview(id: string) {
  const { error } = await db
    .from("manual_check_in_reviews")
    .update({
      read_at: null,
      seen_at: null,
      dismissed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteManualReview(id: string) {
  const { error } = await db.from("manual_check_in_reviews").delete().eq("id", id);
  if (error) throw error;
}

export function sourceLabel(s: ManualReviewSource) {
  return s === "fillout" ? "Fillout" : s === "external" ? "External" : s === "native" ? "Native" : "Manual";
}

export function reviewStatus(r: Pick<ManualCheckInReview, "read_at" | "seen_at">) {
  if (r.read_at) return { label: "Read", tone: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" } as const;
  if (r.seen_at) return { label: "Seen · Unread", tone: "bg-amber-500/15 text-amber-300 border-amber-500/30" } as const;
  return { label: "Sent · Unread", tone: "bg-blue-500/15 text-blue-300 border-blue-500/30" } as const;
}