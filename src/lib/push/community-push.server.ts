// Server-only: pushes for crew activity on your posts (reactions, comments,
// replies, comment likes). The rows are written by database triggers; this
// claims the ones the signed-in person just caused (each pushes once) and
// sends them, grouped and rate limited so a busy post is one alert, not ten:
//   - reactions: one per post an hour ("Vicky and 3 others reacted…")
//   - comments / replies: one per post / comment every 5 minutes
//   - comment likes: one per comment every 3 hours
//   - at most COMMUNITY_DAILY_CAP a day per person, so the crew never
//     crowds out what the coach sends
// Lockscreen copy says who and what, never the comment itself.
import type { SupabaseClient } from "@supabase/supabase-js";
import { safeDisplayName } from "@/lib/push/notification-payload";

export const COMMUNITY_DAILY_CAP = 5;

const EMOJI: Record<string, string> = { heart: "❤️", thumbs: "👍", bang: "‼️", fire: "🔥", laugh: "😂" };
const THING: Record<string, string> = { workout: "workout", lockin: "lock-in", post: "post" };
const RATE_MINUTES: Record<string, number> = { reaction: 60, comment: 5, reply: 5, comment_like: 180 };

export type ClaimedPush = {
  id: string;
  recipient: string;
  kind: "reaction" | "comment" | "reply" | "comment_like";
  post_id: string;
  comment_id: string | null;
  emoji: string | null;
  actor_name: string | null;
  actor_is_staff: boolean;
  others: number;
  media_type: string | null;
  post_kind: "workout" | "lockin" | "post";
};

/** The words on the lockscreen. */
export function communityPushCopy(n: ClaimedPush): { title: string; body: string } {
  const name = safeDisplayName(n.actor_name ?? "", "Someone");
  const thing = THING[n.post_kind] ?? "post";
  const crowd = n.others > 0 ? `${name} and ${n.others} ${n.others === 1 ? "other" : "others"}` : name;
  switch (n.kind) {
    case "reaction":
      return { title: n.others > 0 ? `${crowd} reacted to your ${thing}` : `${name} reacted ${EMOJI[n.emoji ?? ""] ?? "❤️"} to your ${thing}`, body: "Tap to see it." };
    case "comment":
      return {
        title: n.media_type === "audio" ? `${name} left a voice memo on your ${thing}` : n.media_type === "gif" ? `${name} sent a GIF on your ${thing}` : `${name} commented on your ${thing}`,
        body: "Tap to read it and reply.",
      };
    case "reply":
      return { title: `${name} replied to your comment`, body: n.media_type === "audio" ? "Tap to listen." : "Tap to read it." };
    case "comment_like":
      return { title: `${crowd} liked your comment`, body: "Tap to see it." };
  }
}

/**
 * Coach props on a client's workout already go out as "Props from your
 * coach" (community_coach_recognition); don't send it twice.
 */
export function coveredByCoachRecognition(n: ClaimedPush) {
  return n.actor_is_staff && (n.kind === "reaction" || n.kind === "comment") && n.post_kind !== "post";
}

/** Every login that is this person (a coach's staff login reads the same posts). */
async function loginsFor(admin: SupabaseClient, mainUserId: string): Promise<string[]> {
  const { data } = await (admin as any).from("community_profiles").select("user_id").eq("same_person_as", mainUserId);
  return [mainUserId, ...((data ?? []) as { user_id: string }[]).map((r) => r.user_id)];
}

async function isStaffLogin(admin: SupabaseClient, uid: string) {
  const { data } = await (admin as any).from("user_roles").select("role").eq("user_id", uid).in("role", ["admin", "coach"]).limit(1);
  return (data ?? []).length > 0;
}

/** Room left today in the crew's own cap (UTC day). */
async function takeCommunitySlot(admin: SupabaseClient, uid: string) {
  const day = new Date().toISOString().slice(0, 10);
  for (let n = 1; n <= COMMUNITY_DAILY_CAP; n++) {
    const { error } = await (admin as any).from("push_notification_dedupe").insert({ user_id: uid, event_key: `ccap:${day}:${n}` });
    if (!error) return true;
    if (error.code !== "23505") return true;
  }
  return false;
}

/** Send what `actorUserId` just caused. Never throws. */
export async function pushCommunityActivity(admin: SupabaseClient, actorUserId: string) {
  try {
    const { data, error } = await (admin as any).rpc("community_claim_pushes", { _actor: actorUserId });
    if (error) throw error;
    const claimed = (data ?? []) as ClaimedPush[];
    if (!claimed.length) return { sent: 0 };
    const { sendWebPushToUser } = await import("@/lib/push/push.server");
    let sent = 0;
    for (const n of claimed) {
      if (coveredByCoachRecognition(n)) continue;
      const copy = communityPushCopy(n);
      const anchor = n.kind === "reaction" || n.kind === "comment" ? n.post_id : n.comment_id ?? n.post_id;
      for (const uid of await loginsFor(admin, n.recipient)) {
        if (uid === actorUserId) continue;
        const { data: prefs } = await (admin as any).from("push_notification_preferences").select("master_enabled, community").eq("user_id", uid).maybeSingle();
        if (prefs && (prefs.master_enabled === false || prefs.community === false)) continue;
        if (!(await takeCommunitySlot(admin, uid))) continue;
        const base = (await isStaffLogin(admin, uid)) ? "/admin/community" : "/portal/community";
        const r = await sendWebPushToUser(
          admin,
          uid,
          { ...copy, url: `${base}#post=${n.post_id}`, tag: `community:${n.kind}:${anchor}`, data: { kind: "community_activity", postId: n.post_id } },
          {
            category: "community",
            eventKey: `community:${n.id}:${uid}`,
            rateKey: `community:${n.kind === "reply" ? "comment" : n.kind}:${anchor}`,
            rateWindowMinutes: RATE_MINUTES[n.kind] ?? 60,
            priority: "normal",
          },
        );
        sent += r.sent;
      }
    }
    return { sent };
  } catch (e) {
    console.warn("[push] community activity failed", e);
    return { sent: 0 };
  }
}
