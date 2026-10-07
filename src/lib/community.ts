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

export type CommunityVisibility = "community" | "coach" | "private";

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
  coach_reactions: { name: string; emoji: ReactionKey }[];
  comment_count: number;
  coach_commented: boolean;
};

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
  training_since: string | null;
};

export type CommunityActivity = { enabled: boolean; unseen: number; seen_at: string | null };

export const BIO_MAX = 150;

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
    workoutTitle: s.workout_title || i.workoutTitle || "Workout",
    dateLabel: i.dateLabel,
    lift: lift ? { name: lift.name, detail: formatTopSet(lift.detail, i.unit), prLabel: lift.pr ? SCOPE_WORD[lift.pr].toUpperCase() : null } : null,
    stats: pickCardStats(s, i.unit),
    isPr: isPrMoment(s),
    exercises,
    volume: s.tonnage_kg > 0 ? formatTonnage(s.tonnage_kg, i.unit) : null,
    sessionLine: sessionLine(s),
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
