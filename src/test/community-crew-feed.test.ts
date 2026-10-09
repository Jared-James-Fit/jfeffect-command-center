import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ENGAGED_AT, HOME_CREW_POSTS, SHARE_NUDGE_EVERY_DAYS, engagementLine, homeCrewPosts, isEngaged, shareNudgeKey } from "@/lib/community";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const entry = read("src/components/community/community-entry.tsx");
const tile = read("src/components/community/post-tile.tsx");
const pop = read("src/components/community/engagement-pop.tsx");
const nudge = read("src/components/community/share-nudge.tsx");
const card = read("src/components/community/post-card.tsx");
const screen = read("src/components/community/community-screen.tsx");
const css = read("src/styles.css");

const NOW = new Date("2026-10-09T16:00:00Z").getTime();
const at = (h: number) => new Date(NOW - h * 3600e3).toISOString();
const post = (id: string, h: number) => ({ id, created_at: at(h) });

describe("Home's Crew feed: newest first, a few, then the feed", () => {
  it("newest first, yours included (it used to put Dwayne's 15h post ahead of your 4h one)", () => {
    const { shown } = homeCrewPosts([post("dwayne", 15), post("mine", 4), post("vicky", 30)], NOW);
    expect(shown.map((p) => p.id)).toEqual(["mine", "dwayne", "vicky"]);
  });
  it(`shows ${HOME_CREW_POSTS}, and counts the rest for the card that opens the feed`, () => {
    const posts = Array.from({ length: 8 }, (_, i) => post(`p${i}`, i + 1));
    const { shown, more } = homeCrewPosts(posts, NOW);
    expect(shown).toHaveLength(5);
    expect(more).toBe(3);
  });
  it("only the last two weeks, so it never looks stale", () => {
    const { shown, more } = homeCrewPosts([post("new", 2), post("old", 15 * 24)], NOW);
    expect(shown.map((p) => p.id)).toEqual(["new"]);
    expect(more).toBe(0);
  });
  it("the swipe always ends on the card that opens the feed (never every post)", () => {
    expect(entry).toContain('<SeeMoreCard posts={feed.data?.pages[0]?.posts ?? []} shown={shown} more={more} onOpen={() => openAt()} />');
    expect(entry).toContain('{more > 0 ? `${more} more in the feed` : "Open the feed"}');
  });
  it("a carousel shows its first slide only: nothing inside a card swipes, so the Home swipe always works", () => {
    expect(entry).not.toMatch(/<PostCarousel|<PostMedia\b/);
    expect(tile).not.toMatch(/PostCarousel|overflow-x-auto|snap-x/);
    expect(tile).toContain('aria-label="Carousel"');
    expect(entry).toContain("snap-x snap-mandatory gap-2.5 overflow-x-auto overscroll-x-contain");
  });
  it("posting is one tap: + Post in the header", () => {
    expect(entry).toContain('label="Post"');
  });
  it("is called Crew feed, and the menu entry is League & Crew", () => {
    expect(entry).toContain(">Crew feed</span>");
    expect(entry).not.toMatch(/>\s*Community\s*</);
    expect(read("src/lib/admin-nav.ts")).toContain('label: "League & Crew"');
  });
});

describe("the engagement pop", () => {
  const p = (reactions: number, comments: number, names: string[] = []) => ({
    reaction_count: reactions,
    reactions: { heart: reactions },
    reactors: names.map((name, i) => ({ user_id: `u${i}`, name, avatar_url: null, is_coach: false, is_me: name === "You" })),
    comment_count: comments,
  });
  it(`only for posts people are paying attention to (${ENGAGED_AT}+ reactions and comments)`, () => {
    expect(isEngaged(p(1, 1))).toBe(false);
    expect(isEngaged(p(2, 1))).toBe(true);
    expect(isEngaged(p(0, 3))).toBe(true);
  });
  it("says who, briefly", () => {
    expect(engagementLine(p(1, 0, ["Nicole Y"]))).toBe("Nicole");
    expect(engagementLine(p(2, 0, ["Nicole Y", "Marc A"]))).toBe("Nicole & Marc");
    expect(engagementLine(p(5, 2, ["Nicole Y", "You"]))).toBe("You +4 · 💬 2");
    expect(engagementLine(p(0, 3))).toBe("💬 3");
  });
  it("once per post per app session, a beat after it settles on screen", () => {
    expect(pop).toContain("const popped = new Set<string>();");
    expect(pop).toContain("if (!e.isIntersecting || e.intersectionRatio < 0.6) return;");
    expect(pop).toContain("}, 500);");
  });
  it("in the feed it never covers the post: the reactions rise out of the heart and who reacted pops", () => {
    expect(card).toContain('{on && <ReactionsRise kinds={kinds.length ? kinds : ["💬"]} className="bottom-1/2 left-5" />}');
    expect(card).toContain('on && "engage-chip"');
    expect(card).not.toContain("<EngagementPop");
    // Home's cards get the capsule
    expect(entry).toContain("<EngagementPop post={post} />");
  });
  it("taps go straight through, and reduced motion just fades", () => {
    expect(pop).toContain("pointer-events-none absolute inset-0 z-10");
    expect(css).toContain(".engage-pop { animation: engage-pop-calm 3.6s linear forwards; }");
    expect(css).toContain(".engage-float { display: none; }");
  });
});

describe("the share nudge", () => {
  it(`comes back at most every ${SHARE_NUDGE_EVERY_DAYS} days (one account hint per window, local days)`, () => {
    const d = (s: string) => new Date(s);
    const keys = ["2026-10-09T09:00", "2026-10-09T23:00", "2026-10-10T08:00", "2026-10-11T08:00", "2026-10-12T08:00", "2026-10-13T08:00"].map((s) => shareNudgeKey(d(s)));
    expect(new Set(keys).size).toBeLessThanOrEqual(3);
    expect(keys[0]).toBe(keys[1]);
    const days = Array.from({ length: 12 }, (_, i) => shareNudgeKey(d(`2026-10-${String(9 + i).padStart(2, "0")}T12:00`)));
    const runs = days.reduce<number[]>((acc, k, i) => (i && k === days[i - 1] ? (acc[acc.length - 1]++, acc) : [...acc, 1]), []);
    expect(runs.slice(1, -1).every((n) => n === SHARE_NUDGE_EVERY_DAYS)).toBe(true);
  });
  it("never again once they've posted (remembered on the account, even if the post goes)", () => {
    expect(nudge).toContain("const posted = (me.data?.posts ?? 0) + (me.data?.archived ?? 0) > 0;");
    expect(nudge).toContain("if (posted && hints.isSuccess && !done && !isImpersonating) markHint(SHARE_NUDGE_DONE);");
    expect(nudge).toContain("&& !posted && !done");
  });
  it("one place per window (Home or the feed), easy to pass on, and a coach's View as never spends it", () => {
    expect(nudge).toContain("claim.surface === surface && !claim.dismissed");
    expect(nudge).toContain('aria-label="Not now"');
    expect(nudge).toContain("if (!isImpersonating) markHint(key);");
  });
  it("lock in when there's a session today, else share one; clients only", () => {
    expect(nudge).toContain('const title = lock ? "Lock in today\'s session" : "Share a session with the crew";');
    expect(nudge).toContain('const eligible = role === "client" || isImpersonating;');
  });
  it("sits second in Home's swipe and after the second post in the feed", () => {
    expect(entry).toContain("cards.splice(Math.min(1, cards.length), 0, nudge);");
    expect(screen).toContain('{canShare && i === Math.min(1, posts.length - 1) && <ShareNudge surface="feed" unit={unit} />}');
  });
});
