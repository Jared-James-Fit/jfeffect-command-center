import { reactionEmoji } from "@/lib/community";
import type { CommunityNotice } from "@/lib/community-notifications";

/**
 * Crew Activity, Instagram style: who liked, commented on, replied to or
 * followed you, newest first, in New / Today / Yesterday / This week /
 * Earlier. Read state is the bell's (notification_state, kind "community"),
 * so reading it here clears the bell too and the other way round.
 */
export type ActivityItem = CommunityNotice & { unread: boolean };
export type ActivityFilter = "all" | "comments" | "likes" | "follows";

export const ACTIVITY_FILTERS: { key: ActivityFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "comments", label: "Comments" },
  { key: "likes", label: "Likes" },
  { key: "follows", label: "Follows" },
];

export function matchesActivityFilter(n: Pick<CommunityNotice, "kind">, f: ActivityFilter): boolean {
  switch (f) {
    case "all":
      return true;
    case "comments":
      return n.kind === "comment" || n.kind === "reply";
    case "likes":
      return n.kind === "reaction" || n.kind === "comment_like";
    case "follows":
      return n.kind === "follow" || n.kind === "follow_request";
  }
}

export type ActivitySection<T> = { key: string; label: string; items: T[] };

/**
 * New (unread when the page opened) on top, then by day like Instagram. A
 * line is in one section only.
 */
export function activitySections<T extends Pick<CommunityNotice, "at"> & { key: string }>(
  items: T[],
  newKeys: ReadonlySet<string>,
  now = new Date(),
): ActivitySection<T>[] {
  const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const DAY = 86_400_000;
  const buckets: ActivitySection<T>[] = [
    { key: "new", label: "New", items: [] },
    { key: "today", label: "Today", items: [] },
    { key: "yesterday", label: "Yesterday", items: [] },
    { key: "week", label: "This week", items: [] },
    { key: "earlier", label: "Earlier", items: [] },
  ];
  const sorted = [...items].sort((a, b) => b.at.localeCompare(a.at));
  for (const it of sorted) {
    const t = new Date(it.at).getTime();
    const b = newKeys.has(it.key) ? 0 : t >= day0 ? 1 : t >= day0 - DAY ? 2 : t >= day0 - 6 * DAY ? 3 : 4;
    buckets[b].items.push(it);
  }
  return buckets.filter((b) => b.items.length > 0);
}

const THING = { workout: "workout", lockin: "lock-in", post: "post" } as const;

/**
 * One line, in parts so the names can be bold: "Vicky, Nicole and 3 others"
 * + "liked your workout" (+ what they said, for a comment).
 */
export function activityLine(n: CommunityNotice): { names: string[]; others: number; action: string; quote: string | null } {
  const actors = n.actors ?? [];
  const count = Math.max(n.count, actors.length, 1);
  const names = actors.slice(0, count >= 2 ? 2 : 1).map((a) => a.name);
  if (!names.length) names.push("Someone");
  const others = Math.max(0, count - names.length);
  const thing = THING[n.post_kind] ?? "post";
  const said = n.snippet?.trim() ? n.snippet.trim() : n.media_type === "audio" ? "🎤 Voice memo" : n.media_type === "gif" ? "GIF" : n.media_type ? "📷 Photo" : null;
  switch (n.kind) {
    case "reaction": {
      const onlyHearts = n.emojis.every((e) => e === "heart");
      const faces = onlyHearts ? "" : n.emojis.map((e) => reactionEmoji(e)).filter(Boolean).slice(0, 3).join("");
      if (n.win) return { names, others, action: `celebrated your ${n.win}${faces ? ` ${faces}` : ""}`, quote: null };
      return { names, others, action: onlyHearts ? `liked your ${thing}` : `reacted ${faces} to your ${thing}`, quote: null };
    }
    case "comment":
      return { names, others, action: said ? "commented:" : `commented on your ${thing}`, quote: said };
    case "reply":
      return { names, others, action: said ? "replied:" : "replied to your comment", quote: said };
    case "comment_like":
      return { names, others, action: said ? "liked your comment:" : "liked your comment", quote: said };
    case "follow":
      return { names, others, action: "started following you", quote: null };
    case "follow_request":
      return { names, others, action: "requested to follow you", quote: null };
  }
}

/** "now", "5m", "3h", "2d", "1w": Instagram's short times. */
export function activityAge(at: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(at).getTime()) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)}d`;
  return `${Math.floor(s / (7 * 86_400))}w`;
}

/**
 * The heart's bubble: what's new since it last showed, by kind (Instagram's
 * ♥ 3 · 💬 1 · 👤 2). Only unread lines, and only their notifications that came
 * after the last bubble (`fresh`, worked out on the server), so a line that
 * got one more like counts 1, not every like it ever had.
 */
export type ActivityBubbleCounts = { likes: number; comments: number; follows: number; total: number };

export function activityBubbleCounts(items: readonly Pick<ActivityItem, "kind" | "unread" | "fresh">[] | undefined | null): ActivityBubbleCounts {
  const out: ActivityBubbleCounts = { likes: 0, comments: 0, follows: 0, total: 0 };
  for (const it of items ?? []) {
    const n = it.unread ? Math.max(0, Math.floor(it.fresh ?? 0)) : 0;
    if (!n) continue;
    if (matchesActivityFilter(it, "likes")) out.likes += n;
    else if (matchesActivityFilter(it, "comments")) out.comments += n;
    else out.follows += n;
    out.total += n;
  }
  return out;
}

/** "3 new likes, 1 new comment" for screen readers. */
export function activityBubbleLabel(c: ActivityBubbleCounts): string {
  const part = (n: number, one: string, many: string) => (n ? `${n} new ${n === 1 ? one : many}` : null);
  return [part(c.likes, "like", "likes"), part(c.comments, "comment", "comments"), part(c.follows, "follower", "followers")]
    .filter(Boolean)
    .join(", ");
}

/** A count in the bubble: 99+ past two digits. */
export function bubbleCount(n: number): string {
  return n > 99 ? "99+" : String(n);
}

/** Where "the bubble last showed" is kept: one notification_state row per login (read_at = when). */
export const ACTIVITY_PREVIEW_STATE = { kind: "crew_preview", source_id: "activity" } as const;

/** Open Activity from outside the Crew screen (the coach's Crew header): the screen, when it's up, listens. */
export const OPEN_ACTIVITY_EVENT = "community:open-activity";

export function openCrewActivity() {
  try {
    window.dispatchEvent(new CustomEvent(OPEN_ACTIVITY_EVENT));
  } catch {
    /* no window */
  }
}
