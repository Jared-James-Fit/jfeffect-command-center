import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { onNewVisit, rollFeedAnchor } from "@/lib/feed-anchor";
import { inFollowingFeed } from "@/lib/community";

const read = (p: string) => readFileSync(p, "utf8");

/**
 * Nov 17 2026: the coach wanted the Following system to do more, TikTok's way:
 * a switch at the top between the whole crew and just the people you follow,
 * with the feed always going back to the crew. It used to be a ⌄ on the JF
 * Effect name that only showed once you followed someone.
 */
describe("Crew · Following tabs", () => {
  const screen = read("src/components/community/community-screen.tsx");
  const bar = read("src/components/community/crew-header.tsx");
  const css = read("src/styles.css");
  const queries = read("src/lib/community.queries.ts");
  const sql = read("supabase/migrations/20270402092000_crew_following_feed.sql");

  it("are two tabs in the middle of Crew's bar, the one you're on underlined", () => {
    expect(bar).toContain('role="tablist" aria-label="Feed"');
    expect(bar).toContain('role="tab"');
    expect(bar).toContain("aria-selected={on}");
    expect(bar).toContain('on ? "scale-x-100 opacity-100" : "scale-x-0 opacity-0"');
    // both bold, so picking one never shifts the other
    expect(bar).toContain("text-[17px] font-bold");
    // neutral, never the brand red
    expect(bar).not.toMatch(/data-crew-feed-tab[\s\S]{0,400}text-primary/);
    // over the paged feed's posts they get the icons' soft shadow
    expect(css).toContain(".crew-bar[data-overlay] :is(svg, [data-crew-feed-tab])");
  });

  it("always open on Crew, and a new visit puts them back there", () => {
    expect(screen).toContain('const [feedTab, setFeedTab] = useState<CrewFeedTab>("crew");');
    expect(screen).toContain('useEffect(() => onNewVisit(() => setFeedTab("crew")), []);');
    // never remembered on the phone or the account
    expect(screen).not.toMatch(/localStorage[^\n]*feedTab|feedTab[^\n]*localStorage/);
  });

  it("a new visit tells whoever's listening (a tap on Crew, the New posts pill, 30 minutes away)", () => {
    const fn = vi.fn();
    const off = onNewVisit(fn);
    rollFeedAnchor();
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    rollFeedAnchor();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("Following is people's own posts from the ones you follow, read on the server; following nobody shows the way to people", () => {
    expect(screen).toContain("const followsNobody = following && followingIds.size === 0;");
    expect(screen).toContain(
      "useRankedFeed(following && !followsNobody && !previewOnly, { follows: followKey })",
    );
    expect(screen).toContain("const activeFeed = following ? followingFeed : ranked;");
    expect(screen).toContain(
      "const { hasNextPage, isFetchingNextPage, fetchNextPage } = activeFeed;",
    );
    expect(screen).toContain('title="Follow people to fill this feed"');
    expect(screen).toContain("looking={followingFeed.isPending} failed={followingFeed.isError}");
    // the crew feed asks exactly as before; only Following sends `_following`
    expect(queries).toContain("const only = following ? { _following: true } : {};");
    expect(queries).toContain(
      '[...communityKeys.feed(null), "ranked", "following", following.follows]',
    );
  });

  it("the server's rule: same feed, people's own posts only, the old signature dropped so PostgREST sees one function", () => {
    expect(sql).toContain(
      "DROP FUNCTION IF EXISTS public.community_feed_ranked(integer, jsonb, timestamptz);",
    );
    expect(sql).toContain("_following boolean DEFAULT false");
    expect(sql).toContain("OR (p.series IS NULL AND p.series_data -> 'birthday' IS NULL");
    expect(sql).toContain("OR p.id IN (SELECT post_id FROM followed_collabs)");
    expect(sql).toContain("WHERE sr.user_id = v_me OR sr.user_id IN (SELECT id FROM followed)");
    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION public.community_feed_ranked(integer, jsonb, timestamptz, boolean) FROM PUBLIC, anon;",
    );
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.community_feed_ranked(integer, jsonb, timestamptz, boolean) TO authenticated, service_role;",
    );
  });

  it("the app's mirror of it (the Following tab's story rail): never an automated post", () => {
    const author = { user_id: "coach", name: "Jared", avatar_url: null, is_coach: true } as never;
    const base = {
      is_mine: false,
      author,
      collaborators: [],
      reposted_by: null,
      my_repost: null,
      series: null,
      series_data: null,
    };
    const follows = new Set(["coach"]);
    expect(inFollowingFeed(base, follows)).toBe(true);
    expect(inFollowingFeed({ ...base, series: "lesson" } as never, follows)).toBe(false);
    expect(
      inFollowingFeed({ ...base, series_data: { birthday: { name: "Amanda" } } } as never, follows),
    ).toBe(false);
    expect(
      inFollowingFeed(
        { ...base, author: { ...(author as object), user_id: "someone" } as never },
        follows,
      ),
    ).toBe(false);
  });

  it("a tap on the tab you're on goes to its top; a preview never shows the coach's own follows", () => {
    expect(screen).toContain(
      'if (t === feedTab) return window.scrollTo({ top: 0, behavior: "smooth" });',
    );
    expect(screen).toContain('if (t === "following" && previewOnly) return void toast(');
  });
});
