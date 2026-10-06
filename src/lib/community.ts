/**
 * Community sharing — pure types and helpers (no network, no DOM).
 *
 * A community post only stores social data (caption, media, visibility). Every
 * workout number arrives as `WorkoutShareStats`, derived server-side from the
 * same records the recap uses (see migration 20261006090000_community_sharing).
 */
import { formatLoad, formatTonnage } from "@/lib/training-records";

export const CAPTION_MAX = 280;
export const COMMENT_MAX = 300;
export const FEED_PAGE_SIZE = 10;

/** Fixed, deliberately small set. One reaction per person per post. */
export const REACTIONS = [
  { key: "fire", emoji: "🔥", label: "Fire" },
  { key: "muscle", emoji: "💪", label: "Strong" },
  { key: "clap", emoji: "👏", label: "Nice work" },
  { key: "heart", emoji: "❤️", label: "Love it" },
] as const;
export type ReactionKey = (typeof REACTIONS)[number]["key"];

export function reactionEmoji(key: string | null | undefined): string | null {
  return REACTIONS.find((r) => r.key === key)?.emoji ?? null;
}

export type CommunityVisibility = "community" | "private";

export type RecordScope = "atpr" | "program_pr" | "block_pr";

export type WorkoutShareStats = {
  workout_title: string;
  completed_at: string;
  duration_min: number | null;
  working_sets: number;
  tonnage_kg: number;
  top_lift: { exercise_name: string; reps: number; load_kg: number } | null;
  pr_count: number;
  prs: { exercise_name: string; reps: number; load_kg: number; scope: RecordScope }[];
};

export type CommunityAuthor = {
  user_id: string;
  name: string;
  avatar_url: string | null;
  is_coach: boolean;
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
  completion_id: string;
  is_mine: boolean;
  author: CommunityAuthor;
  /** null when the workout was reopened — the post then shows photo + caption only. */
  stats: WorkoutShareStats | null;
  reactions: Partial<Record<ReactionKey, number>>;
  my_reaction: ReactionKey | null;
  coach_reactions: { name: string; emoji: ReactionKey }[];
  comment_count: number;
  coach_commented: boolean;
};

export type CommunityFeedPage = { posts: CommunityPost[]; has_more: boolean };

export type CommunityComment = {
  id: string;
  body: string;
  created_at: string;
  author: CommunityAuthor;
  can_delete: boolean;
};

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
export function formatTopSet(lift: { reps: number; load_kg: number }, unit: "kg" | "lb"): string {
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
  detail: { reps: number; load_kg: number };
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
