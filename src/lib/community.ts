/**
 * Community sharing — pure types and helpers (no network, no DOM).
 *
 * A community post only stores social data (caption, media, visibility). Every
 * workout number arrives as `WorkoutShareStats`, derived server-side from the
 * same records the recap uses (see migration 20261006090000_community_sharing).
 */
import { formatLoad, formatTonnage } from "@/lib/training-records";
import type { ShareCardData, ShareTemplate } from "@/lib/workout-share-card";
import { dayScheduledDate, type WorkoutItem } from "@/lib/workout-today";

/** Longest workout caption (Instagram's limit). Matches community_posts_caption_check. */
export const CAPTION_MAX = 2200;
export const COMMENT_MAX = 300;
export const FEED_PAGE_SIZE = 10;
/** The first page is smaller: the top of the feed shows sooner, the rest loads as you scroll. */
export const FIRST_FEED_PAGE = 5;

/**
 * Reactions: ❤️ is the one-tap default (tap the heart, or double-tap the
 * post); hold the heart for the other four. One per person per post, and a
 * post shows one number with faces, not split counts.
 */
export const REACTION = { key: "heart", emoji: "❤️", label: "Love it" } as const;
export const REACTIONS = [
  { key: "heart", emoji: "❤️", label: "Love it" },
  { key: "thumbs", emoji: "👍", label: "Like" },
  { key: "bang", emoji: "‼️", label: "Big" },
  { key: "fire", emoji: "🔥", label: "Fire" },
  { key: "laugh", emoji: "😂", label: "Haha" },
] as const;
export type ReactionKey = (typeof REACTIONS)[number]["key"];

export function reactionEmoji(key: string | null | undefined): string | null {
  return REACTIONS.find((r) => r.key === key)?.emoji ?? null;
}

export type CommunityVisibility = "community" | "coach" | "private";

/** Shown when a coach taps a post button while viewing as a client. */
export const PREVIEW_ONLY_MESSAGE = "Preview only. This is what they see, but you can't post as them.";

/** Who a post is for. "JF crew" = every active JF Effect client + coaches, never the public. */
export const AUDIENCES: { key: CommunityVisibility; label: string; hint: string }[] = [
  { key: "community", label: "JF crew", hint: "Only JF Effect clients and coaches see it" },
  { key: "coach", label: "My coach", hint: "Just you and your coach" },
  { key: "private", label: "Only me", hint: "Saved to your profile, nobody else sees it" },
];

export type RecordScope = "atpr" | "program_pr" | "block_pr";

export type WorkoutShareStats = {
  workout_title: string;
  completed_at: string;
  duration_min: number | null;
  working_sets: number;
  tonnage_kg: number;
  /** load_kg is null when the athlete hid their weights. */
  top_lift: { exercise_name: string; reps: number; load_kg: number | null } | null;
  pr_count: number;
  prs: { exercise_name: string; reps: number; load_kg: number | null; scope: RecordScope }[];
  /** Completed sessions in the same local month / week, up to and including this one. */
  month_sessions?: number;
  week_sessions?: number;
  /** Present on the composer preview and the post detail (not in the feed). */
  exercises?: CommunityExercise[];
  /* Composer preview only (community_completion_extras): the athlete's own workout. */
  /** The workout's local date, YYYY-MM-DD, in the athlete's time zone. */
  local_date?: string;
  total_reps?: number;
  /** "Workout #71" — every finished session up to this one. */
  lifetime_sessions?: number;
  /** Weeks in a row with at least one workout, this one included. */
  streak_weeks?: number;
  /** Local days trained in the 4 Mon–Sun weeks ending this week. */
  days_trained?: string[];
  /** The same workout (same day name) the last time they did it. */
  prev?: { completed_at: string; tonnage_kg: number; working_sets: number; top_lift: { exercise_name: string; reps: number; load_kg: number | null } | null } | null;
};

/** One line of the workout breakdown (rows of the same lift merged). */
export type CommunityExercise = {
  name: string;
  sets: number;
  best_load_kg: number | null;
  best_reps: number | null;
  max_reps: number | null;
  max_seconds: number | null;
  pr: RecordScope | null;
};

export type CommunityAuthor = {
  user_id: string;
  name: string;
  avatar_url: string | null;
  is_coach: boolean;
  /** Coaches: "Coach · JF Effect". */
  title?: string | null;
};

export type CommunitySeries =
  | "monday_motivation"
  | "tuesday_tips"
  | "wednesday_wins"
  | "try_it_thursday"
  | "finish_strong_friday"
  | "saturday_spirit"
  | "sunday_recap";

/** The daily coach posts, Monday first: name + the one-line idea behind each. */
export const SERIES_LABEL: Record<CommunitySeries, { name: string; tagline: string; short: string }> = {
  monday_motivation: { name: "Monday Motivation", tagline: "Set the standard", short: "Mon" },
  tuesday_tips: { name: "Tuesday Tips & Tricks", tagline: "Worth testing", short: "Tue" },
  wednesday_wins: { name: "Wednesday Wins", tagline: "Last week's work", short: "Wed" },
  try_it_thursday: { name: "Try it Thursday", tagline: "Try a feature", short: "Thu" },
  finish_strong_friday: { name: "Finish Strong Friday", tagline: "Finish what you started", short: "Fri" },
  saturday_spirit: { name: "Saturday Spirit", tagline: "Trust the process", short: "Sat" },
  sunday_recap: { name: "Sunday Recap", tagline: "How the week went", short: "Sun" },
};

/** Tuesday's kinds of tip, as the little tag on the post. */
export const TIP_KIND_LABEL: Record<string, string> = {
  cue: "Cue to test",
  habit: "Workout habit",
  mindset: "Mindset",
  externals: "Control what you can",
};

export type CommunityPost = {
  id: string;
  created_at: string;
  visibility: CommunityVisibility;
  caption: string | null;
  media_path: string | null;
  media_thumb_path: string | null;
  media_type: "image" | "video" | null;
  media_width: number | null;
  media_height: number | null;
  /** Slides 2..10 of a carousel, in order (the cover is media_*). Missing / null = one. */
  extra_media?: PostSlide[] | null;
  /** null for coach notes (no workout behind them). */
  completion_id: string | null;
  /** "workout" (a session) or "note" (a coach's text post). Missing = workout. */
  kind?: "workout" | "note";
  series?: CommunitySeries | null;
  /** A featured quote on a note: always from the verified library. */
  quote?: string | null;
  quote_author?: string | null;
  quote_source?: string | null;
  /** Wednesday Wins / Sunday Recap: the crew's numbers for the week, shown as a card. */
  series_data?: WinsStats | RecapStats | null;
  /** Tuesday / Thursday / Saturday: what the post shows besides its words. */
  series_extra?: SeriesExtra | null;
  /** A note that is someone's comment, shared to the feed. */
  shared_comment?: SharedComment | null;
  edited_at?: string | null;
  /** Set when the post was made while the session was still open ("Locked in"). */
  locked_in_at?: string | null;
  /** The session hasn't been finished yet (a lock-in waiting on its numbers). */
  live?: boolean;
  /** The day's title, available before any stats exist. */
  session_title?: string | null;
  /** The author hid their weights (loads are already removed for everyone else). */
  hide_loads?: boolean;
  is_mine: boolean;
  author: CommunityAuthor;
  /** null when the workout was reopened — the post then shows photo + caption only. */
  stats: WorkoutShareStats | null;
  reactions: Partial<Record<ReactionKey, number>>;
  my_reaction: ReactionKey | null;
  /** Set while the author has it archived (only they can see it, in Archived). */
  archived_at?: string | null;
  /** Who an archived post goes back to when restored. */
  archived_from?: CommunityVisibility | null;
  /** Everyone who reacted (any key). Missing on older cached posts. */
  reaction_count?: number;
  /** The first few people who gave it 🔥: coaches first, then newest. */
  reactors?: Reactor[];
  coach_reactions: { name: string; emoji: ReactionKey }[];
  /** Everyone the caption names (tappable), in caption order. */
  mentions?: CommunityMention[];
  /** A community post about 1-3 people: shown with the author ("Jared and Dwayne"), on their profiles too. */
  collaborators?: CommunityAuthor[];
  comment_count: number;
  coach_commented: boolean;
  /** The comment the post's author pinned (shown first, in the feed and the sheet). */
  pinned_comment_id?: string | null;
  /** Up to 2 comments for the feed: the pinned one first, then the newest. */
  comment_preview?: CommentPreview[];
};

/** A comment line under a post in the feed (Instagram style). */
export type CommentPreview = {
  id: string;
  body: string;
  author: CommunityAuthor;
  pinned: boolean;
  /** It has a photo / video (the feed says so instead of showing it). */
  media: boolean;
  created_at: string;
};

export const COMMENT_PREVIEW_MAX = 2;

/**
 * The feed's comment preview from a full thread: visible top-level comments, the pinned
 * one first, then the newest. Mirrors community_comment_preview() so the feed updates the
 * moment you comment or pin, without a refetch.
 */
export function buildCommentPreview(
  comments: Array<Pick<CommunityComment, "id" | "parent_id" | "hidden" | "body" | "author" | "media" | "created_at">>,
  pinnedId: string | null | undefined,
): CommentPreview[] {
  return comments
    .filter((c) => !c.parent_id && !c.hidden)
    .sort((a, b) => Number(b.id === pinnedId) - Number(a.id === pinnedId) || b.created_at.localeCompare(a.created_at))
    .slice(0, COMMENT_PREVIEW_MAX)
    .map((c) => ({ id: c.id, body: (c.body ?? "").slice(0, 160), author: c.author, pinned: c.id === pinnedId, media: !!c.media, created_at: c.created_at }));
}

/** Top-level threads with the pinned one moved to the top (the rest keep their order). */
export function pinnedFirst<T extends { comment: { id: string } }>(threads: T[], pinnedId: string | null | undefined): T[] {
  if (!pinnedId) return threads;
  const i = threads.findIndex((t) => t.comment.id === pinnedId);
  return i <= 0 ? threads : [threads[i], ...threads.slice(0, i), ...threads.slice(i + 1)];
}

export type Reactor = CommunityAuthor & { is_me?: boolean };

/** Someone a caption names: tappable there. `text` is how it names them ("@Dwayne", "Dwayne"). */
export type CommunityMention = CommunityAuthor & { text: string | null };

export type MentionSegment = { text: string; mention?: CommunityMention };

const WORD = /[\p{L}\p{N}_]/u;

/**
 * A caption cut into plain text and the names it mentions (case-insensitive,
 * whole words only, every time they appear; the longer name wins where two
 * start at the same spot).
 */
export function splitMentions(text: string, mentions: CommunityMention[] | null | undefined): MentionSegment[] {
  const list = (mentions ?? []).filter((m) => m.text && m.text.trim());
  if (!text || !list.length) return [{ text }];
  const lower = text.toLowerCase();
  const hits: { start: number; end: number; m: CommunityMention }[] = [];
  for (const m of list) {
    const needle = m.text!.toLowerCase();
    for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, at + 1)) {
      const before = at > 0 ? text[at - 1] : "";
      const after = text[at + needle.length] ?? "";
      if ((needle.startsWith("@") || !before || !WORD.test(before)) && !(before === "@" && !needle.startsWith("@")) && (!after || !WORD.test(after))) {
        hits.push({ start: at, end: at + needle.length, m });
      }
    }
  }
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: MentionSegment[] = [];
  let i = 0;
  for (const h of hits) {
    if (h.start < i) continue; // inside one already taken
    if (h.start > i) out.push({ text: text.slice(i, h.start) });
    out.push({ text: text.slice(h.start, h.end), mention: h.m });
    i = h.end;
  }
  if (i < text.length) out.push({ text: text.slice(i) });
  return out;
}

/**
 * The "@…" being typed right before the caret, if any (a name can have one
 * space: "@Alyssa Am"). null when the caret isn't in a mention.
 */
export function mentionQuery(value: string, caret: number): { query: string; start: number } | null {
  const before = value.slice(0, Math.max(0, caret));
  const m = /(^|[\s(])@([^\s@]{0,24}(?: [^\s@]{0,24})?)$/u.exec(before);
  if (!m) return null;
  return { query: m[2], start: before.length - m[2].length - 1 };
}

/** People whose name fits what's typed after "@", best first (name starts with it, then any word does). */
export function suggestMentions<T extends { name: string }>(people: T[], query: string, max = 6): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return people.slice(0, max);
  const starts = people.filter((p) => p.name.toLowerCase().startsWith(q));
  const words = people.filter((p) => !starts.includes(p) && p.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)));
  return [...starts, ...words].slice(0, max);
}

/** The kinds a post got, most given first (for the little ❤️🔥😂 beside the names). */
export function reactionKinds(post: Pick<CommunityPost, "reactions">, max = 3): string[] {
  return Object.entries(post.reactions ?? {})
    .filter(([, n]) => (n ?? 0) > 0)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .map(([k]) => reactionEmoji(k))
    .filter((e): e is string => !!e)
    .slice(0, max);
}

export function reactionTotal(post: Pick<CommunityPost, "reaction_count" | "reactions">): number {
  if (typeof post.reaction_count === "number") return post.reaction_count;
  return Object.values(post.reactions ?? {}).reduce((a, b) => a + (b ?? 0), 0);
}

/**
 * "Nicole" · "You and Nicole" · "Jared, Vicky and Nicole" ·
 * "Jared, Vicky and 3 others". You always come first.
 */
export function reactorsLine(post: Pick<CommunityPost, "reaction_count" | "reactions" | "reactors">): string | null {
  const total = reactionTotal(post);
  if (total <= 0) return null;
  const people = [...(post.reactors ?? [])].sort((a, b) => Number(!!b.is_me) - Number(!!a.is_me));
  const names = people.map((r) => (r.is_me ? "You" : r.name));
  if (names.length === 0) return `${total} ${total === 1 ? "person" : "people"}`;
  if (total === 1) return names[0];
  if (total === 2 && names.length >= 2) return `${names[0]} and ${names[1]}`;
  if (total === 3 && names.length >= 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  const shown = names.slice(0, 2);
  const rest = total - shown.length;
  return `${shown.join(", ")} and ${rest} ${rest === 1 ? "other" : "others"}`;
}

/** Someone in the crew (Crew tab). Counts only include posts you can see. */
export type CommunityMember = {
  author: CommunityAuthor;
  bio: string | null;
  posts: number;
  last_post_at: string | null;
  live: boolean;
};

export type CommunityPostDetail = CommunityPost & { exercises: CommunityExercise[] };

export type CommunityProfile = {
  author: CommunityAuthor;
  bio: string | null;
  is_me: boolean;
  posts: number;
  /** Your own profile only: how many posts you have archived. */
  archived?: number | null;
  training_since: string | null;
};

export type CommunityActivity = { enabled: boolean; unseen: number; seen_at: string | null };

export const BIO_MAX = 150;

export type CommunityFeedPage = { posts: CommunityPost[]; has_more: boolean };

export type CommentMedia = {
  path: string;
  thumb: string | null;
  type: "image" | "video";
  width: number | null;
  height: number | null;
};

export type CommunityComment = {
  id: string;
  /** The top-level comment this replies to (replies are one level deep). */
  parent_id?: string | null;
  body: string;
  created_at: string;
  author: CommunityAuthor;
  /** Who a reply is to, when it isn't the writer replying to themself. */
  reply_to?: string | null;
  media?: CommentMedia | null;
  likes?: number;
  liked?: boolean;
  /** Hidden by the post's owner / a coach. Only they are told. */
  hidden?: boolean;
  is_mine?: boolean;
  /** The writer, the post's owner and coaches. */
  can_delete: boolean;
  /** The post's owner and coaches, on other people's comments. */
  can_hide?: boolean;
  /** Comments on community posts can be shared as their own post. */
  can_share?: boolean;
  /** Still sending (optimistic): shown dimmed, no actions yet. */
  pending?: boolean;
  /** A local preview while the photo / video uploads. */
  local_preview?: string | null;
};

/** A comment someone shared as its own post. `gone` once it's deleted or hidden. */
export type SharedComment =
  | {
      id: string;
      post_id: string;
      body: string;
      created_at: string;
      author: CommunityAuthor;
      /** Whose post it was on. */
      post_author: string | null;
      media: CommentMedia | null;
      gone?: undefined;
    }
  | { gone: true };

/** A top-level comment followed by its replies, oldest first (how the thread reads). */
export function threadComments(list: CommunityComment[]): { comment: CommunityComment; replies: CommunityComment[] }[] {
  const tops: { comment: CommunityComment; replies: CommunityComment[] }[] = [];
  const byId = new Map<string, { comment: CommunityComment; replies: CommunityComment[] }>();
  for (const c of list) {
    if (c.parent_id) continue;
    const t = { comment: c, replies: [] as CommunityComment[] };
    tops.push(t);
    byId.set(c.id, t);
  }
  for (const c of list) {
    if (!c.parent_id) continue;
    const t = byId.get(c.parent_id);
    if (t) t.replies.push(c);
  }
  return tops;
}

/** "1 like" / "12 likes" / null for none. */
export function likesLabel(n: number | null | undefined): string | null {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v) || v <= 0) return null;
  return v === 1 ? "1 like" : `${v} likes`;
}

/* ------------------------------------------------------------------ */
/*  What a card shows                                                  */
/* ------------------------------------------------------------------ */

export type CardStat = { value: string; label: string };

/** "1h 14m" / "48m" — never "0m". */
export function formatWorkoutDuration(min: number | null | undefined): string | null {
  const m = Math.round(Number(min ?? 0));
  if (!Number.isFinite(m) || m <= 0) return null;
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r}m`;
  return r === 0 ? `${h}h` : `${h}h ${r}m`;
}

/** "220 kg × 3" — unit is the viewer's / athlete's own preference. */
export function formatTopSet(lift: { reps: number; load_kg: number | null }, unit: "kg" | "lb"): string {
  if (lift.load_kg == null || lift.load_kg <= 0) return `${lift.reps} ${lift.reps === 1 ? "rep" : "reps"}`;
  return `${formatLoad(lift.load_kg, unit)} × ${lift.reps}`;
}

/**
 * The 2–4 numbers a card is allowed to show, most meaningful first:
 * duration, working sets, PRs. Tonnage is only a fallback when duration is
 * missing, so a card never reads like a spreadsheet.
 */
export function pickCardStats(s: WorkoutShareStats, unit: "kg" | "lb"): CardStat[] {
  const out: CardStat[] = [];
  const dur = formatWorkoutDuration(s.duration_min);
  if (dur) out.push({ value: dur, label: "Time" });
  if (s.working_sets > 0) out.push({ value: String(s.working_sets), label: s.working_sets === 1 ? "Working set" : "Working sets" });
  if (s.pr_count > 0) out.push({ value: String(s.pr_count), label: s.pr_count === 1 ? "PR" : "PRs" });
  if (!dur && s.tonnage_kg > 0 && out.length < 3) out.push({ value: formatTonnage(s.tonnage_kg, unit), label: "Volume" });
  return out.slice(0, 3);
}

export const SCOPE_WORD: Record<RecordScope, string> = {
  atpr: "All-time PR",
  program_pr: "Program PR",
  block_pr: "Block PR",
};

/**
 * The one lift the card features. A PR always wins (it is the story);
 * otherwise the session's primary lift.
 */
export function featuredLift(s: WorkoutShareStats): {
  name: string;
  detail: { reps: number; load_kg: number | null };
  pr: RecordScope | null;
} | null {
  const pr = s.prs[0];
  if (pr) return { name: pr.exercise_name, detail: { reps: pr.reps, load_kg: pr.load_kg }, pr: pr.scope };
  if (s.top_lift) return { name: s.top_lift.exercise_name, detail: { reps: s.top_lift.reps, load_kg: s.top_lift.load_kg }, pr: null };
  return null;
}

/** Share-card variant: a PR session gets the PR treatment automatically. */
export function isPrMoment(s: WorkoutShareStats | null | undefined): boolean {
  return !!s && s.prs.length > 0;
}

/* ------------------------------------------------------------------ */
/*  Media rules                                                        */
/* ------------------------------------------------------------------ */

export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
export const MAX_VIDEO_SECONDS = 45;

export type MediaCheck = { ok: true; kind: "image" | "video" } | { ok: false; reason: string };

/** Cheap pre-flight (type + size). Duration is checked after metadata loads. */
export function checkMediaFile(file: { type: string; size: number }): MediaCheck {
  if (file.type.startsWith("image/")) return { ok: true, kind: "image" };
  if (file.type.startsWith("video/")) {
    if (file.size > MAX_VIDEO_BYTES) return { ok: false, reason: "Keep videos under 50 MB — a short clip works best." };
    return { ok: true, kind: "video" };
  }
  return { ok: false, reason: "Choose a photo or a short video." };
}

export function checkVideoDuration(seconds: number): MediaCheck {
  if (Number.isFinite(seconds) && seconds > MAX_VIDEO_SECONDS) {
    return { ok: false, reason: `Keep videos under ${MAX_VIDEO_SECONDS} seconds.` };
  }
  return { ok: true, kind: "video" };
}

/**
 * Carousels: up to 10 photos / videos on a post, at most 3 of them videos.
 * Photos are ~300 KB once resized, so 10 go up in seconds; three 45-second
 * clips is already a lot of upload on a phone connection.
 */
export const MAX_SLIDES = 10;
export const MAX_SLIDE_VIDEOS = 3;

export type PostSlide = { path: string; thumb: string | null; type: "image" | "video"; width: number | null; height: number | null };

/** Every slide of a post, cover first. [] when it has no photo. */
export function postSlides(post: Pick<CommunityPost, "media_path" | "media_thumb_path" | "media_type" | "media_width" | "media_height" | "extra_media">): PostSlide[] {
  if (!post.media_path || !post.media_type) return [];
  return [
    { path: post.media_path, thumb: post.media_thumb_path, type: post.media_type, width: post.media_width, height: post.media_height },
    ...(post.extra_media ?? []).filter((s) => !!s?.path),
  ];
}

/** What to show small: the thumbnail, else the photo itself. */
export function slideThumbPath(s: Pick<PostSlide, "path" | "thumb" | "type">): string | null {
  return s.thumb ?? (s.type === "image" ? s.path : null);
}

/** Every file a post points at (for tidying up after a delete or a replace). */
export function postFiles(post: Pick<CommunityPost, "media_path" | "media_thumb_path" | "extra_media">): string[] {
  return [post.media_path, post.media_thumb_path, ...(post.extra_media ?? []).flatMap((s) => [s.path, s.thumb])].filter((p): p is string => !!p);
}

/**
 * Of what was just picked, what still fits after `current`: in order, up to
 * 10 in all and 3 videos. `reason` says why anything was left out.
 */
export function fitSlides<T extends { kind: "image" | "video" }>(
  current: { kind: "image" | "video" }[],
  picked: T[],
  max = MAX_SLIDES,
  maxVideos = MAX_SLIDE_VIDEOS,
): { take: T[]; dropped: number; reason: string | null } {
  let slots = max - current.length;
  let videos = maxVideos - current.filter((c) => c.kind === "video").length;
  const take: T[] = [];
  let full = false;
  let tooManyVideos = false;
  for (const p of picked) {
    if (slots <= 0) {
      full = true;
      continue;
    }
    if (p.kind === "video" && videos <= 0) {
      tooManyVideos = true;
      continue;
    }
    take.push(p);
    slots -= 1;
    if (p.kind === "video") videos -= 1;
  }
  const dropped = picked.length - take.length;
  const reason = !dropped ? null : full ? `Up to ${max} photos and videos on a post` : tooManyVideos ? `Up to ${maxVideos} videos on a post` : null;
  return { take, dropped, reason };
}

/* ------------------------------------------------------------------ */
/*  Time                                                               */
/* ------------------------------------------------------------------ */

/** "now", "12m", "3h", "Yesterday", "Oct 4". Compact, Strava-like. */
export function postTimeLabel(iso: string, now: Date = new Date()): string {
  const t = new Date(iso);
  if (Number.isNaN(+t)) return "";
  const diffMin = Math.floor((+now - +t) / 60_000);
  if (diffMin < 1) return "now";
  if (diffMin < 60) return `${diffMin}m`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h`;
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(t)) / 86_400_000);
  if (days === 1) return "Yesterday";
  return t.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(t.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}

/** Cursor for the next feed page (keyset on created_at + id). */
export function nextFeedCursor(page: CommunityFeedPage): { at: string; id: string } | null {
  if (!page.has_more || page.posts.length === 0) return null;
  const last = page.posts[page.posts.length - 1];
  return { at: last.created_at, id: last.id };
}

/* ------------------------------------------------------------------ */
/*  Exercise lines + share-card data                                   */
/* ------------------------------------------------------------------ */

/** "220 kg × 3", "12 reps", "1:00" — whatever best describes the lift. */
export function formatExerciseBest(e: CommunityExercise, unit: "kg" | "lb"): string {
  if (e.best_load_kg != null && e.best_reps != null && e.best_load_kg > 0) return formatTopSet({ load_kg: e.best_load_kg, reps: e.best_reps }, unit);
  if (e.max_reps != null && e.max_reps > 0) return `${e.max_reps} reps`;
  if (e.max_seconds != null && e.max_seconds > 0) {
    const m = Math.floor(e.max_seconds / 60);
    const sec = e.max_seconds % 60;
    return m > 0 ? `${m}:${String(sec).padStart(2, "0")}` : `${sec}s`;
  }
  return `${e.sets} ${e.sets === 1 ? "set" : "sets"}`;
}

/** "Session 12 this month" — only once it means something (2+). */
export function sessionLine(s: Pick<WorkoutShareStats, "month_sessions">): string | null {
  const n = s.month_sessions ?? 0;
  if (n < 2) return null;
  return `Session ${n} this month`;
}

export type ShareCardInput = {
  stats: WorkoutShareStats;
  unit: "kg" | "lb";
  athleteName: string | null;
  workoutTitle?: string | null;
  dateLabel: string | null;
};

/** Everything a share card prints, derived once from the canonical stats. */
export function buildShareCardFields(i: ShareCardInput) {
  const s = i.stats;
  const lift = featuredLift(s);
  const exercises = (s.exercises ?? [])
    .filter((e) => e.sets > 0)
    .map((e) => ({ name: e.name, detail: formatExerciseBest(e, i.unit), pr: !!e.pr }));
  return {
    athleteName: i.athleteName,
    // The program's weekday ("Tuesday — ") clashes with the real date on the card.
    workoutTitle: sessionDisplayTitle(s.workout_title || i.workoutTitle || "Workout"),
    dateLabel: i.dateLabel,
    lift: lift ? { name: lift.name, detail: formatTopSet(lift.detail, i.unit), prLabel: lift.pr ? SCOPE_WORD[lift.pr].toUpperCase() : null } : null,
    stats: pickCardStats(s, i.unit),
    isPr: isPrMoment(s),
    exercises,
    volume: s.tonnage_kg > 0 ? formatTonnage(s.tonnage_kg, i.unit) : null,
    sessionLine: sessionLine(s),
    extras: buildCardExtras(s, i.unit),
  };
}

/** "6:42 PM" — when someone locked in. */
export function lockInTimeLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(+d)) return null;
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** A lock-in is "training now" while the session is open and recent. */
export function isTrainingNow(p: Pick<CommunityPost, "live" | "locked_in_at">, now = Date.now()): boolean {
  if (!p.live || !p.locked_in_at) return false;
  const at = new Date(p.locked_in_at).getTime();
  return now - at < 3 * 3600_000 && now >= at - 60_000;
}

/** One-tap captions for a lock-in. Short, no hashtags, no hype words. */
export const LOCK_IN_CAPTIONS = ["Locked in.", "Showed up.", "No days off.", "Who's training today?", "Your move."] as const;

/** "Training since Jun 2026" */
export function trainingSinceLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(+d)) return null;
  return `Training since ${d.toLocaleDateString(undefined, { month: "short", year: "numeric" })}`;
}

/* ---- Wednesday Wins: the crew's week in numbers ----------------------- */

/** Saved on the post when it goes out. Counts only; nobody singled out. */
export type WinsStats = {
  week_of: string;
  roster: number;
  opened: number;
  trained: number;
  sessions: number;
  sessions_prev: number;
  prs: number;
  pr_people: number;
  volume_kg: number;
  reps: number;
  streaks: number;
  bodyweight: number;
  checkins: number;
  busiest_day: string | null;
  /** Added with the history-aware card; missing on the first post. */
  volume_prev_kg?: number;
  /** 1 = the most the crew has lifted in any week on record. */
  volume_rank?: number;
  sessions_rank?: number;
  weeks_tracked?: number;
  history?: { wk: string; sessions: number }[];
};

/* ---- Sunday Recap: the week's report card ------------------------------ */

/** Wednesday's numbers plus the plan, the days, logging, the top 3 and one thing to work on. */
export type RecapStats = WinsStats & {
  kind: "recap";
  /** Sessions a week everyone training committed to, and how many got done (each person up to their own target). */
  planned: number;
  planned_done: number;
  /** People who hit their own target, out of everyone training right now. */
  hit: number;
  active: number;
  /** Workouts finished each day, Monday first. */
  days: number[];
  completed: number;
  fully_logged: number;
  top: { name: string; type: string; text: string }[];
  improve: { kind: "plan" | "logging" | "checkins" | "day"; text: string } | null;
};

export function isRecapStats(s: unknown): s is RecapStats {
  return !!s && typeof s === "object" && (s as { kind?: unknown }).kind === "recap" && Array.isArray((s as { days?: unknown }).days);
}

export function isWinsStats(s: unknown): s is WinsStats {
  return !!s && typeof s === "object" && typeof (s as { sessions?: unknown }).sessions === "number" && typeof (s as { week_of?: unknown }).week_of === "string";
}

const DAY_LETTER = ["M", "T", "W", "T", "F", "S", "S"];

/** The week's report card, said so anyone gets it. */
export function recapSummary(s: RecapStats) {
  const planPct = s.planned > 0 ? Math.round((s.planned_done / s.planned) * 100) : null;
  const logPct = s.completed > 0 ? Math.round((s.fully_logged / s.completed) * 100) : null;
  const maxDay = Math.max(1, ...s.days);
  const best = s.days.indexOf(Math.max(...s.days));
  const days = s.days.map((n, i) => ({ letter: DAY_LETTER[i], n, share: n / maxDay, best: i === best && n > 0 }));
  const more = s.sessions - s.sessions_prev;
  const vsLast =
    s.sessions_prev > 0 ? (more > 0 ? `${more} more than last week` : more === 0 ? "Same as last week" : `${-more} fewer than last week`) : null;
  return { planPct, logPct, days, vsLast };
}

/** 🥇🥈🥉 for the top 3. */
export const MEDALS = ["🥇", "🥈", "🥉"];

/* ---- Tuesday / Thursday / Saturday: what rides along with the words ----- */

/** Habit vs no habit: a outnumbered by b people, x vs y on the outcome. */
export type CrewCompare = { habit: string; outcome: "spw" | "prs" | "rating"; a: number; b: number; x: number; y: number; people?: number };

export type SeriesExtra =
  /** Saturday: one of the illustrated scenes. */
  | { scene: string }
  /** Tuesday from the library: what kind of tip it is. */
  | { kind: string }
  /** Tuesday from the crew's own data. */
  | (CrewCompare & { observation: "frequency" | "consistency" | "sleep" })
  /** Thursday: the feature, where to find it, and (when it says something) how the people who use it train. */
  | { feature: string; title: string; where: string[]; stat?: CrewCompare | null };

export function extraScene(e: SeriesExtra | null | undefined): string | null {
  return e && "scene" in e && typeof e.scene === "string" ? e.scene : null;
}
export function extraFeature(e: SeriesExtra | null | undefined) {
  return e && "feature" in e && typeof e.feature === "string" && Array.isArray((e as { where?: unknown }).where)
    ? (e as { feature: string; title: string; where: string[]; stat?: CrewCompare | null })
    : null;
}
export function extraObservation(e: SeriesExtra | null | undefined) {
  return e && "observation" in e && typeof e.x === "number" && typeof e.y === "number" ? (e as CrewCompare & { observation: string }) : null;
}
export function extraTipKind(e: SeriesExtra | null | undefined): string | null {
  return e && "kind" in e && typeof e.kind === "string" ? TIP_KIND_LABEL[e.kind] ?? null : null;
}

/**
 * The two bars on a data post, labelled in plain words. Bars are scaled to
 * the bigger number; ratings are out of 5 so the bars are too.
 */
export function compareBars(c: CrewCompare) {
  const fmt = (v: number) => (c.outcome === "prs" ? `${Math.round(v)} PRs` : c.outcome === "rating" ? `${v.toFixed(1)} / 5` : `${v.toFixed(1)}x a week`);
  const top = c.outcome === "rating" ? 5 : Math.max(c.x, c.y, 0.1);
  const label =
    c.habit === "sessions"
      ? { a: "3+ sessions a week", b: "Fewer" }
      : c.habit === "weeks"
        ? { a: "Trained 7–8 of 8 weeks", b: "Missed 2+ weeks" }
        : c.habit === "sleep"
          ? { a: "Under 5h sleep", b: "5h or more" }
          : { a: "Use it", b: "Everyone else" };
  const count = (n: number) => (c.habit === "sleep" ? `${n} sessions` : `${n} ${n === 1 ? "person" : "people"}`);
  return [
    { label: label.a, count: count(c.a), value: fmt(c.x), share: c.x / top, lead: c.x >= c.y },
    { label: label.b, count: count(c.b), value: fmt(c.y), share: c.y / top, lead: c.y > c.x },
  ];
}

/** "Sep 28 – Oct 4" for the Monday the week starts on. */
export function winsWeekLabel(weekOf: string): string {
  const [y, m, d] = weekOf.split("-").map(Number);
  const start = new Date(y, m - 1, d);
  const end = new Date(y, m - 1, d + 6);
  const f = (x: Date) => x.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${f(start)} – ${f(end)}`;
}

export function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/** 6,015 · 45.2K · 450K · 1.2M */
export function compactNumber(n: number): string {
  if (n < 10_000) return Math.round(n).toLocaleString("en-US");
  if (n < 100_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}K`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

/**
 * Everyday things that weigh about this much (lbs), for "that's about the
 * weight of 90 pickup trucks". Rotates week to week so it stays fresh.
 */
const WEIGHT_OF = [
  { one: "pickup truck", many: "pickup trucks", lb: 5000 },
  { one: "elephant", many: "elephants", lb: 13000 },
  { one: "car", many: "cars", lb: 4000 },
  { one: "school bus", many: "school buses", lb: 25000 },
] as const;

function weekIndex(weekOf: string): number {
  const [y, m, d] = weekOf.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / (7 * 86_400_000));
}

const ORDINAL = ["", "", "2nd", "3rd"];

/**
 * The big number on the card, said so anyone gets it: everything the crew
 * lifted together last week, in the viewer's unit, with an everyday
 * comparison, a "biggest week ever" badge when it's earned, and how it beat
 * the week before (only when it did).
 */
export function winsHero(s: WinsStats, unit: "kg" | "lb") {
  const lb = s.volume_kg * 2.20462;
  const raw = unit === "kg" ? s.volume_kg : lb;
  const amount = raw >= 10_000_000 ? compactNumber(raw) : Math.round(raw).toLocaleString("en-US");
  const start = weekIndex(s.week_of) % WEIGHT_OF.length;
  let compare: string | null = null;
  for (let k = 0; k < WEIGHT_OF.length && !compare; k++) {
    const o = WEIGHT_OF[(start + k) % WEIGHT_OF.length];
    const n = Math.round(lb / o.lb);
    if (n >= 3 && n <= 300) compare = `That's about the weight of ${n} ${o.many}`;
  }
  const rank = s.volume_rank ?? null;
  const badge =
    rank != null && rank <= 3 && (s.weeks_tracked ?? 0) >= 6
      ? rank === 1
        ? "Biggest week the crew has ever had"
        : `${ORDINAL[rank]} biggest week the crew has ever had`
      : null;
  const up = s.volume_prev_kg && s.volume_prev_kg > 0 ? Math.round((s.volume_kg / s.volume_prev_kg - 1) * 100) : 0;
  return { amount, unit: unit === "kg" ? "kg" : "lbs", compare, badge, change: up >= 3 ? `${up}% more than the week before` : null };
}

/**
 * Four plain numbers under the big one. Nothing a non-lifter has to decode:
 * people, workouts, personal records, and who hasn't missed a week.
 */
export function winsTiles(s: WinsStats) {
  const more = s.sessions - s.sessions_prev;
  const tiles: { value: string; label: string; sub?: string }[] = [
    { value: `${s.trained} of ${s.roster}`, label: "people trained", sub: `${pct(s.trained, s.roster)}% of the crew` },
    {
      value: s.sessions.toLocaleString("en-US"),
      label: s.sessions === 1 ? "workout finished" : "workouts finished",
      sub: s.sessions_prev > 0 && more > 0 ? `${more} more than the week before` : s.sessions_prev > 0 && more === 0 ? "same as the week before" : undefined,
    },
    {
      value: s.prs.toLocaleString("en-US"),
      label: s.prs === 1 ? "new personal record" : "new personal records",
      sub: s.pr_people > 1 ? `set by ${s.pr_people} different people` : undefined,
    },
  ];
  if (s.streaks > 0)
    tiles.push({ value: String(s.streaks), label: s.streaks === 1 ? "person hasn't missed a week" : "people haven't missed a week", sub: "in a month or more" });
  else if (s.reps > 0) tiles.push({ value: s.reps.toLocaleString("en-US"), label: "reps done" });
  return tiles;
}

/** Workouts per week for the last 8 weeks, this week last. Empty on older posts. */
export function winsChart(s: WinsStats) {
  const h = s.history ?? [];
  const max = Math.max(1, ...h.map((x) => x.sessions));
  return h.map((x) => ({ ...x, label: winsWeekLabel(x.wk).split(" – ")[0], share: x.sessions / max, current: x.wk === s.week_of }));
}

/** Something to chase this week. */
export function winsChallenge(s: WinsStats): string {
  if (s.sessions_rank === 1 && (s.weeks_tracked ?? 0) >= 6) return "Most workouts the crew has ever done in a week. Run it back";
  return `This week's goal: beat ${s.sessions} workouts`;
}

/* ---- Lock in: today's plan on the card ---------------------------------- */

export type PlanRow = { sets: number | null; reps_text: string | null; duration_seconds: number | null; name: string };

function fmtSeconds(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m}:${String(r).padStart(2, "0")}` : `${m} min`;
}

/** "4 × 5" · "3 × 8-10" · "3 × 45s" · "AMRAP" — how the plan reads on a card. */
export function planDetail(r: Pick<PlanRow, "sets" | "reps_text" | "duration_seconds">): string {
  const reps = r.reps_text?.trim() || null;
  const sets = r.sets && r.sets > 0 ? r.sets : null;
  if (sets && reps) return `${sets} × ${reps}`;
  if (sets && r.duration_seconds) return `${sets} × ${fmtSeconds(r.duration_seconds)}`;
  if (reps) return reps;
  if (r.duration_seconds) return fmtSeconds(r.duration_seconds);
  return sets ? `${sets} sets` : "";
}

/* ---- Share: picking which session ---------------------------------------- */

const WEEKDAY_PREFIX = /^(mon|tues|wednes|thurs|fri|satur|sun)day\s*[—–-]\s*/i;

/** "Tuesday — Secondary Deadlift" → "Secondary Deadlift": the program's day
 *  name, not the day it was trained, so it only confuses in a list of dates. */
export function sessionDisplayTitle(title: string): string {
  const t = (title ?? "").trim();
  return t.replace(WEEKDAY_PREFIX, "").trim() || t || "Workout";
}

export type SessionGroupKey = "today" | "yesterday" | "week" | "earlier";
export const SESSION_GROUP_LABEL: Record<SessionGroupKey, string> = { today: "Today", yesterday: "Yesterday", week: "This week", earlier: "Earlier" };

/** "Finished 11 min ago" · "Yesterday, 7:12 PM" · "Sat, Oct 3", in the phone's own time zone. */
export function sessionWhen(iso: string, now: Date = new Date()): { group: SessionGroupKey; when: string } {
  const t = new Date(iso);
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(t)) / 86_400_000);
  const clock = t.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (days <= 0) {
    const min = Math.max(0, Math.floor((+now - +t) / 60_000));
    return { group: "today", when: min < 1 ? "Finished just now" : min < 60 ? `Finished ${min} min ago` : `Finished at ${clock}` };
  }
  if (days === 1) return { group: "yesterday", when: `Yesterday, ${clock}` };
  const date = t.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  return { group: days < 7 ? "week" : "earlier", when: date };
}

/** Newest first, bucketed Today / Yesterday / This week / Earlier (empty buckets dropped). */
export function groupSessions<T extends { completed_at: string }>(sessions: T[], now: Date = new Date()) {
  const order: SessionGroupKey[] = ["today", "yesterday", "week", "earlier"];
  const out = new Map<SessionGroupKey, { session: T; when: string }[]>();
  for (const s of [...sessions].sort((a, b) => +new Date(b.completed_at) - +new Date(a.completed_at))) {
    const { group, when } = sessionWhen(s.completed_at, now);
    out.set(group, [...(out.get(group) ?? []), { session: s, when }]);
  }
  return order.filter((k) => out.has(k)).map((k) => ({ key: k, label: SESSION_GROUP_LABEL[k], items: out.get(k)! }));
}

/* ---- Share cards anyone can read (receipt, streak, vs last time) -------- */

/** Everyday things a single workout weighs about as much as (lb). */
const SOLO_WEIGHT_OF = [
  { one: "grand piano", many: "grand pianos", lb: 1000 },
  { one: "car", many: "cars", lb: 4000 },
  { one: "pickup truck", many: "pickup trucks", lb: 5000 },
  { one: "elephant", many: "elephants", lb: 13000 },
  { one: "school bus", many: "school buses", lb: 25000 },
] as const;

/** "≈ the weight of 3 pickup trucks". Rotates with `seed` so it stays fresh. */
export function everydayWeight(kg: number, seed = 0): string | null {
  const lb = kg * 2.20462;
  if (!(lb >= 800)) return null;
  const n = SOLO_WEIGHT_OF.length;
  for (let k = 0; k < n; k++) {
    const o = SOLO_WEIGHT_OF[(Math.abs(seed) + k) % n];
    const count = Math.round(lb / o.lb);
    if (count === 1 && lb / o.lb >= 0.8) return `≈ the weight of a ${o.one}`;
    if (count >= 2 && count <= 25) return `≈ the weight of ${count} ${o.many}`;
  }
  return null;
}

export type StreakCell = { date: string; state: "trained" | "rest" | "future"; today: boolean };

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Four Mon–Sun weeks ending with the workout's week, oldest first (28 cells). */
export function streakGrid(days: string[], localDate: string): { cells: StreakCell[]; trained: number } {
  const [y, m, d] = localDate.split("-").map(Number);
  const today = new Date(Date.UTC(y, m - 1, d));
  const monday = new Date(today);
  monday.setUTCDate(today.getUTCDate() - ((today.getUTCDay() + 6) % 7));
  const start = new Date(monday);
  start.setUTCDate(monday.getUTCDate() - 21);
  const set = new Set(days);
  const cells: StreakCell[] = [];
  let trained = 0;
  for (let i = 0; i < 28; i++) {
    const c = new Date(start);
    c.setUTCDate(start.getUTCDate() + i);
    const key = isoDay(c);
    const state = key > localDate ? "future" : set.has(key) ? "trained" : "rest";
    if (state === "trained") trained++;
    cells.push({ date: key, state, today: key === localDate });
  }
  return { cells, trained };
}

export type ShareCardExtras = {
  /** When it was finished, "9:17 PM". */
  timeLabel: string | null;
  sets: number;
  reps: number;
  duration: string | null;
  workoutNumber: number | null;
  compare: string | null;
  receipt: { name: string; sets: number; detail: string; pr: boolean }[];
  streak: { weeks: number; trained: number; cells: StreakCell[] } | null;
  progress: {
    headline: string;
    sub: string;
    bars: { label: string; value: string; share: number; today: boolean }[];
    lift: string | null;
  } | null;
};

/**
 * Today vs the last time they did this same workout, said plainly. Only when
 * it went up: more total weight moved, or a heavier (or longer) top lift.
 */
export function progressVsLast(s: WorkoutShareStats, unit: "kg" | "lb"): ShareCardExtras["progress"] {
  const p = s.prev;
  if (!p) return null;
  const when = new Date(p.completed_at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  let lift: string | null = null;
  let liftHead: { headline: string; sub: string } | null = null;
  const a = p.top_lift;
  const b = s.top_lift;
  if (a && b && a.exercise_name === b.exercise_name && a.load_kg != null && b.load_kg != null) {
    if (b.load_kg > a.load_kg + 0.01) {
      lift = `${b.exercise_name}: ${formatLoad(a.load_kg, unit)} → ${formatLoad(b.load_kg, unit)}`;
      const diff = formatLoad(b.load_kg - a.load_kg, unit);
      liftHead = { headline: `+${diff}`, sub: `heavier on ${b.exercise_name}` };
    } else if (Math.abs(b.load_kg - a.load_kg) <= 0.01 && b.reps > a.reps) {
      lift = `${b.exercise_name}: ${a.reps} → ${b.reps} reps at ${formatLoad(b.load_kg, unit)}`;
      liftHead = { headline: `+${b.reps - a.reps} ${b.reps - a.reps === 1 ? "rep" : "reps"}`, sub: `on ${b.exercise_name}` };
    }
  }
  const pct = p.tonnage_kg > 0 && s.tonnage_kg > 0 ? Math.round((s.tonnage_kg / p.tonnage_kg - 1) * 100) : 0;
  const head = pct >= 1 ? { headline: `+${Math.min(pct, 999)}%`, sub: "more weight moved than last time" } : liftHead;
  if (!head) return null;
  const max = Math.max(p.tonnage_kg, s.tonnage_kg, 1);
  const bars =
    p.tonnage_kg > 0 && s.tonnage_kg > 0
      ? [
          { label: `Last time · ${when}`, value: formatTonnage(p.tonnage_kg, unit), share: p.tonnage_kg / max, today: false },
          { label: "Today", value: formatTonnage(s.tonnage_kg, unit), share: s.tonnage_kg / max, today: true },
        ]
      : [];
  return { ...head, bars, lift: pct >= 1 ? lift : null };
}

/** Everything the receipt / streak / progress / volume cards print. */
export function buildCardExtras(s: WorkoutShareStats, unit: "kg" | "lb"): ShareCardExtras {
  const grid = s.days_trained && s.local_date ? streakGrid(s.days_trained, s.local_date) : null;
  return {
    timeLabel: lockInTimeLabel(s.completed_at),
    sets: s.working_sets,
    reps: s.total_reps ?? 0,
    duration: formatWorkoutDuration(s.duration_min),
    workoutNumber: s.lifetime_sessions && s.lifetime_sessions > 0 ? s.lifetime_sessions : null,
    compare: s.tonnage_kg > 0 ? everydayWeight(s.tonnage_kg, s.lifetime_sessions ?? 0) : null,
    receipt: (s.exercises ?? []).filter((e) => e.sets > 0).map((e) => ({ name: e.name, sets: e.sets, detail: formatExerciseBest(e, unit), pr: !!e.pr })),
    streak: grid && grid.trained >= 2 ? { weeks: s.streak_weeks ?? 0, trained: grid.trained, cells: grid.cells } : null,
    progress: progressVsLast(s, unit),
  };
}

/* ---- The camera's live card ------------------------------------------- */

export type CameraCardBase = Omit<ShareCardData, "media" | "template">;
const first = (full?: string | null) => (full ?? "").trim().split(/\s+/)[0] || null;

/** Lock in on the camera: Locked in · Clock · Today's plan, the clock ticking live. */
export function lockInCameraCard(i: { workoutTitle: string; athleteName: string | null; plan: { name: string; detail: string }[]; now?: Date }): { data: CameraCardBase; looks: ShareTemplate[] } {
  const now = i.now ?? new Date();
  return {
    data: {
      format: "story",
      athleteName: first(i.athleteName),
      workoutTitle: sessionDisplayTitle(i.workoutTitle || "Workout"),
      dateLabel: now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }),
      lift: null,
      stats: [],
      isPr: false,
      exercises: i.plan.map((p) => ({ name: p.name, detail: p.detail, pr: false })),
      volume: null,
      sessionLine: null,
      lockedIn: { time: lockInTimeLabel(now.toISOString()) ?? "", live: true },
    },
    // "plain" last: post just the photo, no filter
    looks: i.plan.length ? ["lockin", "lockclock", "lockplan", "plain"] : ["lockin", "lockclock", "plain"],
  };
}

/**
 * The session Lock in should attach to: one started in the last 12 hours
 * (really in progress), else the unfinished one scheduled for today. Never an
 * old session someone started weeks ago and didn't finish.
 */
export function pickLockInSession(items: WorkoutItem[], now: Date = new Date()): WorkoutItem | null {
  const open = items.filter((it) => !it.completion?.completed_at && it.day?.id);
  const fresh = open.find((it) => {
    const t = it.completion?.started_at ?? it.completion?.in_progress_at;
    const ms = t ? +now - Date.parse(t) : Infinity;
    return ms >= -60_000 && ms < 12 * 3600_000;
  });
  if (fresh) return fresh;
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  return (
    open.find((it) => {
      const sd = dayScheduledDate(it);
      return !!sd && sd.getFullYear() === y && sd.getMonth() === m && sd.getDate() === d;
    }) ?? null
  );
}

/* ---- league points for posting -------------------------------------- */

/** community_post_points_status(): null when the account isn't an athlete. */
export type PostPointsStatus = { points: number; week_cap: number; today_earned: boolean; week_count: number };

/** Only workouts completed within this many days of the post earn (DB: community_post_xp_sync). */
export const POST_POINTS_RECENT_DAYS = 7;

/**
 * The line under the audience picker that tells an athlete what posting earns.
 * Mirrors the DB rule: +15 for a Community post of a recent workout, 1 a day, 2 a week.
 * A lock-in post earns once the session is finished, so it says so.
 */
export function postPointsHint(
  status: PostPointsStatus | null | undefined,
  visibility: CommunityVisibility,
  alreadyInFeed: boolean,
  opts: { completedAt?: string | null; lockIn?: boolean; now?: Date } = {},
): { tone: "earn" | "muted"; text: string } | null {
  if (!status || alreadyInFeed) return null;
  const now = opts.now ?? new Date();
  const done = opts.completedAt ? new Date(opts.completedAt).getTime() : NaN;
  if (Number.isFinite(done) && now.getTime() - done > POST_POINTS_RECENT_DAYS * 86_400_000)
    return { tone: "muted", text: `Post points are for workouts from the last ${POST_POINTS_RECENT_DAYS} days.` };
  if (visibility !== "community") return { tone: "muted", text: `Post to Community to earn +${status.points} league points.` };
  if (status.today_earned) return { tone: "muted", text: "Today's post points are banked. Post anyway, the crew wants to see it." };
  if (status.week_count >= status.week_cap)
    return { tone: "muted", text: `Post points maxed this week (${status.week_cap}/${status.week_cap}). They reset Monday.` };
  return { tone: "earn", text: opts.lockIn ? `+${status.points} league points when you finish 🔥` : `+${status.points} league points for posting 🔥` };
}
