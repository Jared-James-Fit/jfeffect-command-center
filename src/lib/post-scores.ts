/**
 * Post scores (community_post_scores): how well a feed post kept the crew
 * interested, for coaches. Each post is ranked against the coach's other
 * feed posts on reach (who saw it, of the crew in Crew that week),
 * engagement (likes, comments, saves, shares, votes per person who saw it)
 * and attention (stopped on it, kept scrolling after, time on it: recorded
 * from when tracking started). Coaches are never counted.
 */
import { SERIES_LABEL, type CommunitySeries } from "@/lib/community";
import { LESSON_TRACK, isLessonTrack } from "@/lib/lessons";

export type PostScore = {
  post_id: string;
  created_at: string;
  kind_key: string;
  by_coach: boolean;
  /** The author's first name (who a workout or photo is). */
  author_name?: string | null;
  title: string;
  media_type: "image" | "video" | null;
  /** Up less than a day: still counting. */
  early: boolean;
  score: number;
  audience: number;
  viewers: number;
  reactors: number;
  commenters: number;
  savers: number;
  sharers: number;
  voters: number;
  engaged: number;
  reach: number | null;
  rate: number;
  attention: { reached: number; stopped: number; kept: number; median_ms: number | null } | null;
  /** Where it ranks on each, 0 (lowest) to 1 (highest) of the window's posts. */
  pct: { reach: number | null; engagement: number | null; attention: number | null };
  kind_avg: number;
  kind_n: number;
  /** Feed posts scored in the window, and when attention recording started (from the call, on each post). */
  total?: number;
  attention_since?: string | null;
};

export type PostScores = { days: number; total: number; attention_since: string | null; posts: PostScore[] };

export type ScoreTone = "top" | "good" | "mid" | "low" | "early";

/** What the number means, in a word or two. */
export function scoreBand(s: Pick<PostScore, "score" | "early">): { label: string; tone: ScoreTone } {
  if (s.early) return { label: "Early", tone: "early" };
  if (s.score >= 80) return { label: "Top post", tone: "top" };
  if (s.score >= 60) return { label: "Strong", tone: "good" };
  if (s.score >= 40) return { label: "Average", tone: "mid" };
  return { label: "Below average", tone: "low" };
}

const OTHER_KINDS: Record<string, string> = {
  coach: "Your posts",
  member_workout: "Members' workouts",
  member_post: "Members' posts",
  holiday: "Holidays",
};

/** "Lesson · Strength science", "Wednesday Wins", "Your posts", "Members' workouts". */
export function kindLabel(kindKey: string): string {
  if (kindKey.startsWith("lesson:")) {
    const t = kindKey.slice(7);
    return isLessonTrack(t) ? `Lesson · ${LESSON_TRACK[t].name}` : "Lesson";
  }
  if (kindKey in SERIES_LABEL) return SERIES_LABEL[kindKey as CommunitySeries].name;
  return OTHER_KINDS[kindKey] ?? kindKey.replace(/_/g, " ");
}

/** A post's name in a list: its title or first line, else what it is and whose ("Nicole's workout", "Your photo"). */
export function scoreTitle(s: Pick<PostScore, "title" | "kind_key" | "media_type" | "by_coach"> & { author_name?: string | null }): string {
  const t = s.title.trim();
  if (t) return t;
  const what = s.kind_key === "member_workout" ? "workout" : s.media_type === "video" ? "clip" : s.media_type === "image" ? "photo" : "post";
  if (s.by_coach) return `Your ${what}`;
  const who = s.author_name?.trim();
  return who ? `${who}'s ${what}` : `A ${what}`;
}

/** Where it ranks on one part, said plainly: "Highest of your posts", "Higher than 72% of posts". */
export function rankLine(pct: number | null): string {
  if (pct == null) return "Not measured";
  const p = Math.round(pct * 100);
  if (p >= 100) return "Highest of your posts";
  if (p <= 0) return "Lowest of your posts";
  return `Higher than ${p}% of posts`;
}

/** "3.4s" / "12s" */
export function seconds(ms: number | null | undefined): string {
  const s = Math.max(0, (ms ?? 0) / 1000);
  return s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The plain lines under each part of the score. */
export function scoreLines(s: PostScore): { reach: string; engagement: string; attention: string | null } {
  const reach =
    s.audience > 0
      ? `Seen by ${s.viewers} of the ${s.audience} ${s.audience === 1 ? "person" : "people"} in Crew the week it went up`
      : s.viewers > 0
        ? `Seen by ${plural(s.viewers, "person", "people")}`
        : "Nobody in the crew has seen it yet";
  const bits = [
    s.reactors && plural(s.reactors, "like"),
    s.commenters && plural(s.commenters, "comment"),
    s.savers && plural(s.savers, "save"),
    s.sharers && plural(s.sharers, "share"),
    s.voters && plural(s.voters, "vote"),
  ].filter(Boolean) as string[];
  const engagement = bits.length
    ? `${bits.join(" · ")} from ${plural(Math.max(s.viewers, s.engaged), "person", "people")} who saw it`
    : s.viewers > 0
      ? "No likes, comments, saves or shares yet"
      : "Nothing yet";
  const a = s.attention;
  const attention =
    a && a.reached > 0
      ? `${a.stopped} of ${a.reached} stopped on it · ${a.kept} of ${a.reached} kept scrolling after · ${seconds(a.median_ms)} typical time on it`
      : null;
  return { reach, engagement, attention };
}

export type ScorePart = "reach" | "engagement" | "attention";
export const PART_LABEL: Record<ScorePart, string> = { reach: "Reach", engagement: "Engagement", attention: "Attention" };

/** What carried it and what held it back: its best and worst part against the other posts (only when they differ enough to say). */
export function scoreDrivers(s: Pick<PostScore, "pct">): { carried: ScorePart | null; heldBack: ScorePart | null } {
  const parts = (Object.entries(s.pct) as [ScorePart, number | null][]).filter((p): p is [ScorePart, number] => p[1] != null);
  if (parts.length < 2) return { carried: null, heldBack: null };
  parts.sort((a, b) => b[1] - a[1]);
  const [best, worst] = [parts[0], parts[parts.length - 1]];
  if (best[1] - worst[1] < 0.25) return { carried: null, heldBack: null };
  return { carried: best[1] >= 0.6 ? best[0] : null, heldBack: worst[1] <= 0.4 ? worst[0] : null };
}

/** Average score by kind of post (settled posts only), best first. */
export function kindAverages(posts: PostScore[]): { kind_key: string; label: string; avg: number; n: number }[] {
  const by = new Map<string, number[]>();
  for (const p of posts) {
    if (p.early) continue;
    const list = by.get(p.kind_key) ?? [];
    list.push(p.score);
    by.set(p.kind_key, list);
  }
  return [...by.entries()]
    .map(([kind_key, xs]) => ({ kind_key, label: kindLabel(kind_key), avg: Math.round(xs.reduce((a, b) => a + b, 0) / xs.length), n: xs.length }))
    .sort((a, b) => b.avg - a.avg || b.n - a.n);
}
