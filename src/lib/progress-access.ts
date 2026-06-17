/**
 * Progress review eligibility.
 *
 * - Coaching clients: always allowed to submit progress for review.
 * - Members: only when an active `client_access_entitlements` row grants
 *   a tier that includes reviews ('coaching', 'reviews', 'premium').
 */
import { supabase } from "@/integrations/supabase/client";

const REVIEW_TIERS = new Set(["coaching", "reviews", "premium", "pro"]);

export async function canRequestProgressReviewForMember(memberClientId: string | null): Promise<{
  allowed: boolean;
  source: "entitlement" | "none";
  tier?: string | null;
}> {
  if (!memberClientId) return { allowed: false, source: "none" };
  const { data, error } = await supabase
    .from("client_access_entitlements")
    .select("access_tier, status, effective_start, effective_end")
    .eq("client_id", memberClientId)
    .eq("status", "active")
    .order("effective_start", { ascending: false })
    .limit(10);
  if (error) return { allowed: false, source: "none" };
  const now = Date.now();
  for (const row of (data ?? []) as Array<{ access_tier: string | null; effective_start: string | null; effective_end: string | null }>) {
    const tier = (row.access_tier ?? "").toLowerCase();
    if (!REVIEW_TIERS.has(tier)) continue;
    const startOk = !row.effective_start || new Date(row.effective_start).getTime() <= now;
    const endOk = !row.effective_end || new Date(row.effective_end).getTime() >= now;
    if (startOk && endOk) return { allowed: true, source: "entitlement", tier };
  }
  return { allowed: false, source: "none" };
}