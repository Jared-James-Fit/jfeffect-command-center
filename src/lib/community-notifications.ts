import { supabase } from "@/integrations/supabase/client";
import { reactionEmoji, type CommunityAuthor } from "@/lib/community";

/** One line in the bell: a post's reactions, one comment / reply, a comment's likes, or a new follower. */
export type CommunityNotice = {
  key: string;
  kind: "reaction" | "comment" | "reply" | "comment_like" | "follow";
  /** The post (reactions), the comment, or the follower (follow) the line is about: what read state hangs on. */
  anchor: string;
  /** null for a follow */
  post_id: string | null;
  comment_id: string | null;
  count: number;
  at: string;
  actors: CommunityAuthor[] | null;
  emojis: string[];
  snippet: string | null;
  media_type: string | null;
  post_kind: "workout" | "lockin" | "post";
  /** What the post was about ("Belt Squat PR", "10th session this month"), when it was a real moment. */
  win?: string | null;
  /** The post's photo (a storage path the app signs), for the thumbnail beside the line. */
  post_thumb?: string | null;
  post_media?: string | null;
  /** A words-only post: its first few words, for the thumbnail. */
  post_text?: string | null;
};

/** Open a post from anywhere: the community screen, when it's up, listens for this. */
export const OPEN_POST_EVENT = "community:open-post";
export function openCommunityPost(postId: string) {
  window.dispatchEvent(new CustomEvent(OPEN_POST_EVENT, { detail: postId }));
}

/** Open someone's profile from anywhere (a follow notice): the community screen listens for this. */
export const OPEN_PERSON_EVENT = "community:open-person";
export function openCommunityPerson(userId: string) {
  window.dispatchEvent(new CustomEvent(OPEN_PERSON_EVENT, { detail: userId }));
}

const THING = { workout: "workout", lockin: "lock-in", post: "post" } as const;

/** "Vicky", "Vicky and Nicole", "Vicky and 3 others". */
export function crowdName(actors: { name: string }[], count: number): string {
  const first = actors[0]?.name ?? "Someone";
  const rest = Math.max(0, count - 1);
  if (rest === 0) return first;
  if (rest === 1 && actors[1]) return `${first} and ${actors[1].name}`;
  return `${first} and ${rest} others`;
}

/** What the bell says. */
export function communityNoticeText(n: CommunityNotice): { title: string; body: string } {
  const who = crowdName(n.actors ?? [], n.count);
  const thing = THING[n.post_kind] ?? "post";
  const said = n.snippet?.trim()
    ? `“${n.snippet.trim()}”`
    : n.media_type === "audio" ? "🎤 Voice memo" : n.media_type === "gif" ? "GIF" : n.media_type ? "Photo" : "";
  switch (n.kind) {
    case "reaction": {
      // just hearts reads as a like; a PR or milestone reads as what it was for
      const onlyHearts = n.emojis.every((e) => e === "heart");
      const faces = onlyHearts ? "" : n.emojis.map((e) => reactionEmoji(e)).filter(Boolean).slice(0, 3).join("");
      if (n.win) return { title: `${who} celebrated your ${n.win}${faces ? ` ${faces}` : ""}`, body: "" };
      return { title: onlyHearts ? `${who} liked your ${thing}` : `${who} reacted ${faces} to your ${thing}`, body: "" };
    }
    case "comment":
      return { title: `${who} commented on your ${thing}`, body: said };
    case "reply":
      return { title: `${who} replied to your comment`, body: said };
    case "comment_like":
      return { title: `${who} liked your comment`, body: said };
    case "follow":
      return { title: `${who} started following you`, body: "" };
  }
}

/** The signed-in person's crew activity (last 30 days, grouped). Empty when they're not in the community. */
export async function fetchCommunityNotices(): Promise<CommunityNotice[]> {
  try {
    const { data, error } = await (supabase as any).rpc("community_my_notifications");
    if (error) return [];
    return (data ?? []) as CommunityNotice[];
  } catch {
    return [];
  }
}
