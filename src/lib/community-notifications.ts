import { supabase } from "@/integrations/supabase/client";
import { reactionEmoji, type CommunityAuthor } from "@/lib/community";

/** One line in the bell: a post's reactions, one comment / reply, or a comment's likes. */
export type CommunityNotice = {
  key: string;
  kind: "reaction" | "comment" | "reply" | "comment_like";
  /** The post (reactions) or the comment the line is about: what read state hangs on. */
  anchor: string;
  post_id: string;
  comment_id: string | null;
  count: number;
  at: string;
  actors: CommunityAuthor[] | null;
  emojis: string[];
  snippet: string | null;
  media_type: string | null;
  post_kind: "workout" | "lockin" | "post";
};

/** Open a post from anywhere: the community screen, when it's up, listens for this. */
export const OPEN_POST_EVENT = "community:open-post";
export function openCommunityPost(postId: string) {
  window.dispatchEvent(new CustomEvent(OPEN_POST_EVENT, { detail: postId }));
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
      const faces = n.emojis.map((e) => reactionEmoji(e)).filter(Boolean).slice(0, 3).join("");
      return { title: `${who} reacted${faces ? ` ${faces}` : ""} to your ${thing}`, body: "" };
    }
    case "comment":
      return { title: `${who} commented on your ${thing}`, body: said };
    case "reply":
      return { title: `${who} replied to your comment`, body: said };
    case "comment_like":
      return { title: `${who} liked your comment`, body: said };
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
