import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pickWorkoutWin } from "@/lib/community";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const sql = read("supabase/migrations/20261029120000_community_pulse.sql");
const base = { prs: [], pr_count: 0, month_sessions: 2, week_sessions: 1, top_lift: null, working_sets: 14, duration_min: 39 } as any;

describe("Pulse: a finished workout posts itself, with its real win", () => {
  it("a PR leads (the best, and how many)", () => {
    const w = pickWorkoutWin({ ...base, pr_count: 2, prs: [{ exercise_name: "Hip Thrust", reps: 8, load_kg: 102, scope: "atpr" }] }, "lb");
    expect(w).toMatchObject({ kind: "pr", label: "All-time PR · 2 PRs", headline: "Hip Thrust", detail: "225 lb × 8" });
  });
  it("then a monthly milestone, then 3+ sessions this week, then the top set, else the work done; never made up", () => {
    expect(pickWorkoutWin({ ...base, month_sessions: 10 }, "lb")).toMatchObject({ kind: "month", headline: "10th session this month" });
    expect(pickWorkoutWin({ ...base, month_sessions: 7, week_sessions: 3 }, "lb")).toMatchObject({ kind: "week", headline: "3rd session this week" });
    expect(pickWorkoutWin({ ...base, top_lift: { exercise_name: "Squat", reps: 5, load_kg: 140 } }, "kg")).toMatchObject({ kind: "top", headline: "Squat", detail: "140 kg × 5" });
    expect(pickWorkoutWin(base, "lb")).toMatchObject({ kind: "done", headline: "14 working sets" });
    expect(pickWorkoutWin({ ...base, month_sessions: 11, week_sessions: 2 }, "lb").kind).toBe("done");
  });
  it("one post per session: it fills the session's finish slot (sharing later fills that same post in)", () => {
    expect(sql).toContain("IF EXISTS (SELECT 1 FROM public.community_posts p WHERE p.completion_id = NEW.id) THEN RETURN NULL; END IF;");
    expect(sql).toContain("ON CONFLICT DO NOTHING;");
    expect(sql).toContain("IF NEW.completed_at IS NULL OR (TG_OP = 'UPDATE' AND OLD.completed_at IS NOT NULL) THEN RETURN NULL; END IF;");
    expect(sql).toContain("auto_shared = false,");
  });
  it("respects privacy: the client's switch, members only, recent sessions only, their hide-weights choice", () => {
    expect(sql).toContain("IF NOT coalesce((SELECT cp.auto_share_workouts FROM public.community_profiles cp WHERE cp.user_id = c.user_id), true) THEN RETURN NULL; END IF;");
    expect(sql).toContain("AND coalesce(cl.portal_access_disabled, false) = false;");
    expect(sql).toContain("IF NEW.completed_at < now() - interval '2 days' THEN RETURN NULL; END IF;");
    expect(sql).toContain("coalesce(v_hide, false)");
    expect(read("src/components/community/profile-view.tsx")).toContain("Post my finished workouts to the crew automatically");
  });
  it("no share points for a post nobody shared; never blocks finishing a workout", () => {
    expect(sql).toContain("and not cp.auto_shared");
    expect(sql).toContain("RAISE WARNING 'community_pulse_on_completion: %', sqlerrm;");
  });
  it("the crew celebrates it with the heart under it, like any post (not your own)", () => {
    const card = read("src/components/community/post-card.tsx");
    expect(card).toContain("<PulseHero post={post} stats={s} unit={unit} />");
    expect(card).not.toContain("const canProps");
    const strip = read("src/components/community/pulse-strip.tsx");
    // yours: who celebrated it; theirs: the heart
    expect(strip).toContain("{post.is_mine ? (");
    expect(strip).toContain('title="Celebrated by"');
  });
});

import { ACTIVITY_PREVIEW_ROWS, HOME_CREW_PULSES, activityDay, activityNeedsMore, activityPreview, activityWeekSummary, homeCrewPosts, isPulsePost } from "@/lib/community";
describe("Activity: one section at the top of the feed", () => {
  const now = Date.UTC(2026, 9, 10, 21);
  const at = (h: number) => new Date(now - h * 3600e3).toISOString();
  const pulse = (id: string, h: number, prs = 0) => ({ id, created_at: at(h), auto: true, stats: { pr_count: prs } });
  const own = (id: string, h: number) => ({ id, created_at: at(h), auto: false, stats: {} });
  it("only automatic posts are Activity; one someone made their own (caption / photo) is a regular post", () => {
    expect(isPulsePost(pulse("p", 1))).toBe(true);
    expect(isPulsePost(own("claimed", 1))).toBe(false);
  });
  it("leads with the week's real wins, with the week's sessions and PRs", () => {
    expect(ACTIVITY_PREVIEW_ROWS).toBe(3);
    const win = (id: string, h: number, o: object) => ({ id, created_at: new Date(now - h * 3600e3).toISOString(), auto: true, stats: { prs: [], pr_count: 0, month_sessions: 2, week_sessions: 1, top_lift: { exercise_name: "Squat", reps: 5, load_kg: 100 }, working_sets: 10, duration_min: 40, ...o } });
    const posts = [win("routine1", 1, {}), win("pr", 2, { prs: [{ exercise_name: "Squat", reps: 3, load_kg: 140, scope: "atpr" }], pr_count: 1 }), win("routine2", 3, {}), win("streak", 5, { week_sessions: 4 }), win("tenth", 30, { month_sessions: 10 }), win("oldpr", 24 * 9, { prs: [{ exercise_name: "Bench", reps: 1, load_kg: 100, scope: "atpr" }], pr_count: 1 })];
    expect(activityPreview(posts, 3, now).rows.map((p) => p.id)).toEqual(["pr", "streak", "tenth"]);
    // a quiet week with no wins still shows the latest sessions
    expect(activityPreview([win("a", 1, {}), win("b", 2, {})], 3, now).rows.map((p) => p.id)).toEqual(["a", "b"]);
    expect(activityDay(new Date(now - 3600e3).toISOString(), new Date(now))).toBe("Today");
    expect(activityDay(new Date(now - 26 * 3600e3).toISOString(), new Date(now))).toBe("Yesterday");
    expect(activityWeekSummary([pulse("a", 1, 2), pulse("b", 30), pulse("old", 24 * 8, 5)], now)).toEqual({ sessions: 2, prs: 2 });
  });
  it("reads on until the last 7 days are loaded (bounded), so the section is complete", () => {
    expect(activityNeedsMore([own("a", 1)], true, 1, now)).toBe(true);
    expect(activityNeedsMore([own("a", 1), own("b", 24 * 8)], true, 1, now)).toBe(false);
    expect(activityNeedsMore([own("a", 1)], false, 1, now)).toBe(false);
    expect(activityNeedsMore([own("a", 1)], true, 5, now)).toBe(false);
  });
  it("the feed puts Activity first, then the posts people made, newest first", () => {
    const screen = readFileSync("src/components/community/community-screen.tsx", "utf8");
    expect(screen).toContain("const ownPosts = useMemo(() => posts.filter((p) => !isPulsePost(p)), [posts]);");
    expect(screen.indexOf("<ActivitySection")).toBeLessThan(screen.indexOf("{feedPosts.map((p, i) => ("));
    // Following narrows the posts to people you follow (Activity is the whole crew, so it steps aside)
    expect(screen).toContain("{activity.length > 0 && !following && (");
  });
});
describe("Home shows a couple of Pulses at most", () => {
  const at = (h: number) => new Date(Date.UTC(2026, 9, 10, h)).toISOString();
  const pulse = (id: string, h: number) => ({ id, created_at: at(h), auto: true, stats: {} });
  const own = (id: string, h: number) => ({ id, created_at: at(h), auto: false, stats: {} });
  it("Home shows a couple of Pulses at most", () => {
    const now = Date.UTC(2026, 9, 10, 21);
    const { shown } = homeCrewPosts([pulse("p1", 20), pulse("p2", 19), pulse("p3", 18), own("a", 17), own("b", 16)], now);
    expect(shown.filter((p) => p.auto).length).toBe(HOME_CREW_PULSES);
    expect(shown.map((p) => p.id)).toEqual(["p1", "p2", "a", "b"]);
  });
});

import { homeCrewDeck, homeDeckNeedsMore, HOME_DECK_PAGES } from "@/lib/community";
describe("Home's Crew feed deck", () => {
  const now = Date.UTC(2026, 9, 10, 21);
  const at = (h: number) => new Date(now - h * 3600e3).toISOString();
  const pulse = (id: string, h: number, prs = 0) => ({ id, created_at: at(h), auto: true, stats: { pr_count: prs } });
  const post = (id: string, h: number) => ({ id, created_at: at(h), auto: false, stats: null });
  it("the Crew Pulse card lists the 3 newest sessions; Pulses never sit among the posts", () => {
    const d = homeCrewDeck([pulse("p1", 1), pulse("p2", 3, 2), post("a", 2), post("b", 5), pulse("p3", 30), pulse("p4", 72, 5), pulse("ancient", 24 * 20)], now);
    expect(d.pulses.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
    expect(d.shown.map((p) => p.id)).toEqual(["a", "b"]);
    expect(d.more).toBe(0);
  });
  it("no recent Pulse: just the posts", () => {
    expect(homeCrewDeck([post("a", 2), pulse("old", 24 * 20)], now).pulses).toEqual([]);
  });
});

describe("Home deck: Pulse, three posts, then the rest", () => {
  const now = Date.UTC(2026, 9, 10, 21);
  const at = (h: number) => new Date(now - h * 3600e3).toISOString();
  const post = (id: string, h: number) => ({ id, created_at: at(h), auto: false, stats: null });
  it("three newest posts, how many more there are, and the More card always at the end", () => {
    const d = homeCrewDeck([post("a", 1), post("b", 2), post("c", 3), post("d", 4), post("e", 5)], now);
    expect(d.shown.map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(d.more).toBe(2);
    expect(homeCrewDeck([post("a", 1)], now).more).toBe(0);
    const entry = readFileSync(new URL("../components/community/community-entry.tsx", import.meta.url), "utf8");
    expect(entry).toContain("<SeeMoreCard posts=");
    expect(entry).not.toContain("{more > 0 && <SeeMoreCard");
    // a day of only Pulses: they stay in the Pulse card, and More doesn't count them
    const pulse = (id: string, h: number) => ({ id, created_at: at(h), auto: true, stats: { pr_count: 0 } });
    const quiet = homeCrewDeck([pulse("x", 1), pulse("y", 2), pulse("z", 3), pulse("w", 4)], now);
    expect(quiet.shown).toEqual([]);
    expect(quiet.more).toBe(0);
    expect(entry).toContain('hash: `post=${postId}`');
  });
});

describe("Home reads on until it has 3 posts people made", () => {
  const now = Date.UTC(2026, 9, 11, 7);
  const at = (h: number) => new Date(now - h * 3600e3).toISOString();
  const pulse = (id: string, h: number) => ({ id, created_at: at(h), auto: true, stats: { pr_count: 0 } });
  // a member's own workout post (photo, caption) is a regular post even though it has stats
  const own = (id: string, h: number, stats: { pr_count: number } | null = null) => ({ id, created_at: at(h), auto: false, stats });
  it("a first page of only Pulses asks for more; three member posts (workout ones too) are enough", () => {
    const firstPage = [pulse("a", 1), pulse("b", 4), pulse("c", 5), pulse("d", 7), pulse("e", 10)];
    expect(homeDeckNeedsMore(firstPage, true, 1, now)).toBe(true);
    const more = [...firstPage, own("note", 16), own("photo-workout", 38, { pr_count: 1 }), own("w2", 50, { pr_count: 0 })];
    expect(homeDeckNeedsMore(more, true, 2, now)).toBe(false);
    const d = homeCrewDeck(more, now);
    expect(d.shown.map((p) => p.id)).toEqual(["note", "photo-workout", "w2"]);
    expect(d.pulses.map((p) => p.id)).toEqual(["a", "b", "c"]);
  });
  it("stops at the end of the feed, after a few pages, or past two weeks", () => {
    expect(homeDeckNeedsMore([pulse("a", 1)], false, 1, now)).toBe(false);
    expect(homeDeckNeedsMore([pulse("a", 1)], true, HOME_DECK_PAGES, now)).toBe(false);
    expect(homeDeckNeedsMore([pulse("a", 1), pulse("old", 24 * 15)], true, 2, now)).toBe(false);
  });
  it("Home reads every loaded page, not just the first", () => {
    const entry = readFileSync(new URL("../components/community/community-entry.tsx", import.meta.url), "utf8");
    expect(entry).toContain("feed.data?.pages.flatMap((pg) => pg.posts)");
    expect(entry).toContain("void feed.fetchNextPage()");
  });
});
