import { supabase } from "@/integrations/supabase/client";

/**
 * One-time feature moments (announcements, "try it" nudges): seen / tried
 * state lives server-side in feature_announcement_views so it never replays
 * on another device.
 */
// feature_announcement_views isn't in the generated types.
const db = supabase as any;

export async function hasSeenFeature(userId: string, key: string): Promise<boolean> {
  const { data, error } = await db
    .from("feature_announcement_views")
    .select("feature_key")
    .eq("user_id", userId)
    .eq("feature_key", key)
    .maybeSingle();
  if (error) return true; // don't nag if the check fails
  return !!data;
}

export async function markFeatureSeen(userId: string, key: string, attempts = 4) {
  for (let i = 0; i < attempts; i++) {
    const { error } = await db.from("feature_announcement_views").upsert(
      { user_id: userId, feature_key: key },
      { onConflict: "user_id,feature_key", ignoreDuplicates: true },
    );
    if (!error) return true;
    await new Promise((r) => setTimeout(r, 800 * 2 ** i));
  }
  return false;
}

