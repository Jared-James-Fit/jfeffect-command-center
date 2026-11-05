import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { caughtUpAt, feedCursorOf, uniquePosts, type CommunityFeedPage } from "@/lib/community";
import { RESUME_NEW_VISIT_MS, feedAnchor, isNewVisit, rollFeedAnchor } from "@/lib/feed-anchor";

const sql = readFileSync("supabase/migrations/20270131090000_feed_new_first.sql", "utf8");
const code = sql.replace(/--.*$/gm, "");
const screen = readFileSync("src/components/community/community-screen.tsx", "utf8");
const motion = readFileSync("src/components/community/feed-motion.tsx", "utf8");
const queries = readFileSync("src/lib/community.queries.ts", "utf8");

describe("the Crew feed leads with what's new to you", () => {
  it("'You're all caught up' sits before the first post you'd seen, only after new ones", () => {
    expect(caughtUpAt([{ fresh: true }, { fresh: true }, { fresh: false }, { fresh: false }])).toBe(2);
    // nothing new: no line at the top
    expect(caughtUpAt([{ fresh: false }, { fresh: false }])).toBeNull();
    // the new ones haven't run out yet
    expect(caughtUpAt([{ fresh: true }, { fresh: true }])).toBeNull();
    expect(caughtUpAt([])).toBeNull();
    // posts from the time-ordered feed (no flag) never get one
    expect(caughtUpAt([{}, {}, {}])).toBeNull();
  });

  it("each post once, and the next page only while there's more", () => {
    expect(uniquePosts([{ id: "a" }, { id: "b" }, { id: "a" }, { id: "c" }]).map((p) => p.id)).toEqual(["a", "b", "c"]);
    const cursor = { phase: "fresh" as const, seen_before: "2026-11-05T21:00:00Z", score: -0.5, id: "b" };
    const page = (has_more: boolean, c: CommunityFeedPage["cursor"]): CommunityFeedPage => ({ posts: [], has_more, cursor: c });
    expect(feedCursorOf(page(true, cursor))).toEqual(cursor);
    expect(feedCursorOf(page(false, cursor))).toBeNull();
    expect(feedCursorOf(page(true, null))).toBeNull();
  });

  it("one moment per visit: kept while you scroll, new after 30 minutes away or when you ask for the newest", () => {
    rollFeedAnchor(Date.parse("2026-11-05T20:00:00Z"));
    expect(feedAnchor(Date.parse("2026-11-05T20:20:00Z"))).toBe("2026-11-05T20:00:00.000Z");
    rollFeedAnchor(Date.parse("2026-11-05T20:25:00Z"));
    expect(feedAnchor()).toBe("2026-11-05T20:25:00.000Z");
    expect(isNewVisit(null, Date.now())).toBe(false);
    expect(isNewVisit(1_000, 1_000 + RESUME_NEW_VISIT_MS - 1)).toBe(false);
    expect(isNewVisit(1_000, 1_000 + RESUME_NEW_VISIT_MS)).toBe(true);
    expect(motion).toContain("rollFeedAnchor();");
  });

  it("the server: new to you against the visit's moment, ranked, then the rest by time", () => {
    // a read: no temp tables or writes, so any login (view-only included) can call it
    expect(code).toContain("LANGUAGE plpgsql STABLE SECURITY DEFINER");
    expect(code).not.toMatch(/\b(INSERT|UPDATE|DELETE|CREATE TEMP|TRUNCATE)\b/);
    // never a story or a Pulse (the story rail's)
    expect(code).toContain("AND NOT p.story_only");
    expect(code).toContain("AND NOT coalesce(p.auto_shared, false)");
    // seen = on your screen before the visit started; the last 7 days; your own from the last 12 hours
    expect(code).toContain("v.post_id = c.id AND v.viewer_user_id = v_me AND v.viewed_at < v_seen");
    expect(code).toContain("ELSE c.at > v_seen - interval '7 days'");
    expect(code).toContain("THEN c.at > v_seen - interval '12 hours'");
    // the moment rides in every cursor, and never runs ahead of the server
    expect(code).toContain("least(coalesce(nullif(_cursor->>'seen_before', '')::timestamptz, _seen_before, now()), now())");
    expect(code.match(/'seen_before', v_seen/g)?.length).toBeGreaterThanOrEqual(4);
    // someone's own post over an automated one, more when you follow each other
    expect(code).toContain("+ CASE WHEN m.series IS NULL THEN 1 ELSE 0 END");
    expect(code).toContain("m.author_user_id IN (SELECT id FROM followed) OR m.author_user_id IN (SELECT id FROM fans)");
    // signed-in people only
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.community_feed_ranked(integer, jsonb, timestamptz) FROM PUBLIC, anon;");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.community_feed_ranked(integer, jsonb, timestamptz) TO authenticated;");
  });

  it("the Crew screen scrolls the ranked feed; the story rail keeps the crew's last day in time order", () => {
    expect(queries).toContain('queryKey: [...communityKeys.feed(null), "ranked"] as const');
    expect(queries).toContain("{ _limit: FIRST_FEED_PAGE, _seen_before: feedAnchor() }");
    expect(screen).toContain("const ownPosts = useMemo(() => rankedPosts.filter(inFeed), [rankedPosts]);");
    expect(screen).toMatch(/<StoryRail\s+posts=\{posts\}/);
    expect(screen).toContain("{i === caughtUp && (");
    expect(screen).toContain("!hasNextPage && feedPosts.length > 1 && caughtUp === null");
  });
});
