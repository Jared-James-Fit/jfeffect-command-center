import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { likedByLine, reactorsSeenAs } from "@/lib/community";

const read = (p: string) => readFileSync(p, "utf8");

/**
 * Nov 19 2026: the coach wanted crew posts to show who liked them, like
 * Instagram. The list was there for anyone who can see a post, but on the
 * paged feed (where nearly everyone reads Crew) nothing opened it: the
 * number under the heart was part of the like button.
 */
describe("who liked a post, Instagram's way", () => {
  const p = (n: number, names: [string, boolean?][]) => ({
    reaction_count: n,
    reactions: { heart: n },
    reactors: names.map(([name, me]) => ({ user_id: name, name, avatar_url: null, is_coach: false, is_me: !!me })),
  });

  it("reads 'Liked by …' in plain words, you lowercase after it", () => {
    expect(likedByLine(p(0, []))).toBeNull();
    expect(likedByLine(p(1, [["Marc"]]))).toEqual({ lead: "Liked by", who: "Marc" });
    expect(likedByLine(p(2, [["Marc"], ["Jared", true]]))).toEqual({ lead: "Liked by", who: "you and Marc" });
    expect(likedByLine(p(13, [["Marc"], ["Devin"], ["Fionna"]]))).toEqual({ lead: "Liked by", who: "Marc, Devin and 11 others" });
    // nobody named yet (an older cached post): the number
    expect(likedByLine(p(4, []))).toEqual({ lead: "Liked by", who: "4 people" });
  });

  it("View as client: you are the client being previewed, never the coach", () => {
    const people = [
      { user_id: "coach", is_me: true },
      { user_id: "client", is_me: false },
    ];
    expect(reactorsSeenAs(people, null, (r) => r.user_id)).toBe(people);
    expect(reactorsSeenAs(people, "client", (r) => r.user_id).map((r) => r.is_me)).toEqual([false, true]);
    // a client with no login: nobody is "you"
    expect(reactorsSeenAs(people, "", (r) => r.user_id).map((r) => r.is_me)).toEqual([false, false]);
  });

  it("the number by the heart is its own tap that opens the Likes (Reels' and Instagram's), the heart still likes", () => {
    const btn = read("src/components/community/reaction-button.tsx");
    expect(btn).toContain("const split = !!onCount && total > 0;");
    expect(btn).toContain("onClick={onCount}");
    expect(btn).toContain("data-like-count");
    expect(btn).toContain('stacked ? "-mt-2 h-7 min-w-11 px-1.5" : "-ml-2 h-11 min-w-8 px-1.5 hover:bg-muted"');
    const card = read("src/components/community/post-card.tsx");
    // a post's own screen (the paged feed) and the card row alike
    expect(card).toContain('<ReactionButton post={post} onReact={onReact} align="right" stacked onCount={openLikes} />');
    expect(card).toContain("<ReactionButton post={post} onReact={onReact} onCount={openLikes} />");
    expect(card).toContain('<LikedBy post={post} onOpen={openLikes} highlight={on} className="-mt-0.5" />');
  });

  it("a post's sheet says who liked it under its words and opens the Likes over the sheet", () => {
    const sheet = read("src/components/community/post-sheet.tsx");
    expect(sheet).toContain('{likes && <LikedBy post={post} onOpen={onOpenLikes} className="-ml-1.5 mt-1.5" />}');
    expect(sheet).toContain("<ReactorsSheet postId={likesFor} onClose={() => setLikesFor(null)} onOpenAuthor={openAuthor} />");
    // a post with no words still shows who liked it
    expect(sheet).toContain("data-post-sheet-likes");
  });

  it("the Likes sheet: a grip that swipes down, Follow on each, a ❤️ never badged (it's the like itself)", () => {
    const likes = read("src/components/community/reactors-sheet.tsx");
    expect(likes).toContain('<SheetContent side="bottom" swipeToClose hideCloseButton');
    expect(likes).toContain('title = "Likes"');
    expect(likes).toContain("const other = r.emoji && r.emoji !== REACTION.key ? reactionEmoji(r.emoji) : null;");
    expect(likes).toContain("{!r.is_me && <FollowButton userId={r.author.user_id}");
    expect(likes).toContain("const rows = data ? reactorsSeenAs(data, pov, (r) => r.author.user_id) : undefined;");
  });

  it("anyone who can see the post sees the list: you, people you follow, then the rest, never a block or a closed account", () => {
    const sql = read("supabase/migrations/20270414090000_post_likes_list.sql");
    expect(sql).toContain("public.community_post_visible(p.visibility, p.author_user_id, p.client_id)");
    expect(sql).toContain("WITH blocked AS MATERIALIZED (SELECT b AS id FROM public.community_blocked_authors() b WHERE b IS NOT NULL)");
    expect(sql).toContain("WHERE l.user_id NOT IN (SELECT id FROM blocked)");
    expect(sql).toMatch(/ORDER BY \(l\.main = me\) DESC,\s+\(l\.main IN \(SELECT id FROM followed\)/);
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.community_post_reactors(uuid) TO authenticated;");
  });
});
