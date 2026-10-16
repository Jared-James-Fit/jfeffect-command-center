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
    // the switch lives in Edit profile → Privacy
    const privacy = read("src/components/community/privacy-settings.tsx");
    expect(privacy).toContain("Finished workouts post to your story for 24 hours with the session's best win.");
    expect(read("src/components/community/profile-edit.tsx")).toContain("<ShareWorkoutsRow />");
  });
  it("no share points for a post nobody shared; never blocks finishing a workout", () => {
    expect(sql).toContain("and not cp.auto_shared");
    expect(sql).toContain("RAISE WARNING 'community_pulse_on_completion: %', sqlerrm;");
  });
  it("the crew celebrates it with the heart, in the story and on the post, like any post (not your own)", () => {
    const card = read("src/components/community/post-card.tsx");
    expect(card).toContain("<PulseHero post={post} stats={s} unit={unit} />");
    expect(card).not.toContain("const canProps");
    const stories = read("src/components/community/crew-stories.tsx");
    expect(stories).toContain('aria-label={mine ? "Take it back" : isPulsePost(post) ? "Celebrate" : "Like"}');
  });
});

import { STORY_READ_PAGES, crewStories, isPulsePost, myStory, storiesNeedMore, storyPrs } from "@/lib/community";
import { existsSync } from "node:fs";
describe("No Activity bubble: a finished session is the athlete's own story", () => {
  const now = Date.UTC(2026, 9, 10, 21);
  const at = (h: number) => new Date(now - h * 3600e3).toISOString();
  const pulse = (id: string, h: number, prs = 0) => ({ id, created_at: at(h), auto: true, stats: { pr_count: prs } });
  const own = (id: string, h: number) => ({ id, created_at: at(h), auto: false, stats: {} });
  it("only automatic posts are Pulses; one someone made their own (caption / photo) is a regular post", () => {
    expect(isPulsePost(pulse("p", 1))).toBe(true);
    expect(isPulsePost(own("claimed", 1))).toBe(false);
  });
  it("the Activity bubble, its story, its week cover and its list are gone; the feed is the posts people made", () => {
    expect(existsSync("src/components/community/pulse-strip.tsx")).toBe(false);
    const screen = read("src/components/community/community-screen.tsx");
    expect(screen).toContain("const ownPosts = useMemo(() => posts.filter((p) => !isPulsePost(p)), [posts]);");
    expect(screen).not.toMatch(/ActivitySheet|activityNeedsMore|activity=\{/);
    const rail = read("src/components/community/crew-stories.tsx");
    expect(rail).not.toMatch(/ActivityBubble|ActivityGlyph|ActivityCoverFrame|activityStoryGroup|onActivityList|group\.activity|data-story-activity-all/);
    // your story (with its +) first, then the people; a quiet day with nothing to add has no row
    expect(rail.indexOf("{addStory ? (")).toBeLessThan(rail.indexOf("{groups.map((g, i) => ("));
    expect(rail).toContain("if (!groups.length && !mine && !addStory) return null;");
    const lib = read("src/lib/community.ts");
    expect(lib).not.toMatch(/activityStory|ACTIVITY_STORY|activityWeekSummary|activityPreview|activityFaces|activityDay|ActivityCover/);
  });
  it("reads on only until the story rail holds the last day (not a whole week), a few pages at most", () => {
    expect(storiesNeedMore([own("a", 1)], true, 1, now)).toBe(true);
    expect(storiesNeedMore([own("a", 1), own("b", 25)], true, 1, now)).toBe(false);
    expect(storiesNeedMore([own("a", 1)], false, 1, now)).toBe(false);
    expect(storiesNeedMore([own("a", 1)], true, STORY_READ_PAGES, now)).toBe(false);
    expect(read("src/components/community/community-screen.tsx")).toContain("storiesNeedMore(posts, !!hasNextPage, feed.data?.pages.length ?? 0)");
  });
  it("a PR rides on the athlete's own bubble (a small tag), and a PR story comes before a routine one", () => {
    const author = (id: string) => ({ user_id: id, name: id, avatar_url: null, is_coach: false });
    const story = (id: string, who: string, h: number, prs = 0, extra: object = {}) => ({ id, created_at: at(h), auto: true, stats: { pr_count: prs }, visibility: "community" as const, is_mine: false, seen: false, author: author(who), ...extra }) as any;
    expect(storyPrs([story("a", "x", 1, 2), story("b", "x", 2, 1), { stats: null }])).toBe(3);
    const groups = crewStories([story("r", "routine", 1), story("p", "lifter", 3, 1)], now);
    expect(groups.map((g) => [g.author.user_id, g.prs])).toEqual([["lifter", 1], ["routine", 0]]);
    const mine = myStory([story("m", "me", 2, 2, { is_mine: true })], now)!;
    expect(mine.prs).toBe(2);
    const rail = read("src/components/community/crew-stories.tsx");
    expect(rail).toContain("<PrTag prs={g.prs} />");
    expect(rail).toContain("<PrTag prs={mine.prs} />");
    expect(rail).toContain('return n > 1 ? `${n} PRs` : "PR";');
  });
  it("the Crew's \"N new\" badge counts posts people made, not sessions that posted themselves", () => {
    const badge = read("supabase/migrations/20261127090000_crew_badge_counts_people_posts.sql");
    expect(badge).toContain("AND NOT coalesce(p.auto_shared, false)");
    expect(badge).toContain("anchor not found exactly once");
  });
});

import { homeCrewDeck, homeDeckNeedsMore, HOME_DECK_PAGES } from "@/lib/community";
describe("Home's Crew feed deck", () => {
  const now = Date.UTC(2026, 9, 10, 21);
  const at = (h: number) => new Date(now - h * 3600e3).toISOString();
  const pulse = (id: string, h: number, prs = 0) => ({ id, created_at: at(h), auto: true, stats: { pr_count: prs } });
  const post = (id: string, h: number) => ({ id, created_at: at(h), auto: false, stats: null });
  it("Pulses never sit among the posts (they're in the athlete's story); only the last two weeks", () => {
    const d = homeCrewDeck([pulse("p1", 1), pulse("p2", 3, 2), post("a", 2), post("b", 5), pulse("p3", 30), post("ancient", 24 * 20)], now);
    expect(d.shown.map((p) => p.id)).toEqual(["a", "b"]);
    expect(d.more).toBe(0);
    expect(Object.keys(d).sort()).toEqual(["more", "shown"]);
  });
});

describe("Home deck: three posts, then the rest", () => {
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
    // a day of only Pulses: they're in stories, and More doesn't count them
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

describe("after a workout: the session's story post, one tap from the feed", () => {
  const footer = read("src/components/community/recap-post.tsx");
  it("says where it actually is (their story, not a crew Activity), and sharing upgrades that same post", () => {
    expect(footer).toContain("On your story for 24 hours");
    expect(footer).not.toMatch(/Crew Activity|as Activity/);
    expect(footer).toContain("const unshared = !justPosted && (!existing || auto || hidden);");
  });
  it("Undo is only for a post the footer made (it would delete the session's story post too)", () => {
    expect(footer).toContain("const made = !existing;");
    expect(footer).toContain("{justPosted === postId && undoable && (");
  });
  it("the PR leads what they'd share (the same headline win as the post), and Done always skips it", () => {
    expect(footer).toContain("pickWorkoutWin(stats, unit)");
    expect(footer).toContain('<Button type="button" variant="outline" className="h-12 rounded-xl text-sm font-bold" onClick={onDone}>');
  });
});
