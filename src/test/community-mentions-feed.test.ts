import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FIRST_FEED_PAGE, mentionQuery, splitMentions, suggestMentions, withHandles, type CommunityMention } from "@/lib/community";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const sql = read("supabase/migrations/20261022090000_community_mentions.sql");
const card = read("src/components/community/post-card.tsx");
const screen = read("src/components/community/community-screen.tsx");
const motion = read("src/components/community/feed-motion.tsx");

const who = (name: string, text: string | null): CommunityMention => ({ user_id: name, name, avatar_url: null, is_coach: false, text });

describe("mentions in a caption", () => {
  it("names become tappable, whole words only, case doesn't matter", () => {
    const parts = splitMentions("happy birthday Amanda! amanda's day. Amandas no", [who("Alyssa Amanda", "Amanda")]);
    expect(parts.filter((p) => p.mention).map((p) => p.text)).toEqual(["Amanda", "amanda"]);
  });
  it("@mentions as typed; the longer name wins", () => {
    const parts = splitMentions("legs with @Alyssa Amanda and @Vicky", [who("Alyssa", "@Alyssa"), who("Alyssa Amanda", "@Alyssa Amanda"), who("Vicky", "@Vicky")]);
    expect(parts.filter((p) => p.mention).map((p) => p.mention!.name)).toEqual(["Alyssa Amanda", "Vicky"]);
    expect(parts.map((p) => p.text).join("")).toBe("legs with @Alyssa Amanda and @Vicky");
  });
  it("no mentions, the text as is", () => {
    expect(splitMentions("just text", [])).toEqual([{ text: "just text" }]);
    expect(splitMentions("Nicolas hit a PR", [who("Nicole", "Nicole")]).some((p) => p.mention)).toBe(false);
  });
});

describe("tags read as @usernames (Instagram's)", () => {
  const at = (name: string, text: string | null, username: string | null): CommunityMention => ({ ...who(name, text), username });
  it("whatever the caption typed, the crew reads @username, still tappable", () => {
    const marc = at("Marc", "Marc", "marc.lifts");
    const shaina = at("Shaina", "Shaina", "shaina_s");
    const out = withHandles("Marc just hit 90lbs x 12. new all time PR for Shaina on comp bench. Marc's 6th PR", [marc, shaina]);
    expect(out.text).toBe("@marc.lifts just hit 90lbs x 12. new all time PR for @shaina_s on comp bench. @marc.lifts's 6th PR");
    const tapped = splitMentions(out.text, out.mentions).filter((p) => p.mention);
    expect(tapped.map((p) => p.text)).toEqual(["@marc.lifts", "@shaina_s", "@marc.lifts"]);
    expect(tapped.map((p) => p.mention!.name)).toEqual(["Marc", "Shaina", "Marc"]);
  });
  it("@Name typed before usernames existed becomes the @username too; running it twice changes nothing", () => {
    const once = withHandles("legs with @Dwayne", [at("Dwayne", "@Dwayne", "dwayne")]);
    expect(once.text).toBe("legs with @dwayne");
    expect(withHandles(once.text, once.mentions)).toEqual(once);
  });
  it("no username: the words the caption used; no tags: the caption as is", () => {
    expect(withHandles("great week Jen", [at("Jen", "Jen", null)]).text).toBe("great week Jen");
    expect(withHandles("just text", null)).toEqual({ text: "just text", mentions: [] });
  });
  it("every caption shows them this way, and the feed's cut-off measures it as shown", () => {
    expect(read("src/components/community/mentions.tsx")).toContain("const shown = withHandles(text, mentions);");
    expect(read("src/components/community/note-caption.tsx")).toContain("useMemo(() => withHandles(typed, typedMentions), [typed, typedMentions])");
  });
});

describe("typing @", () => {
  it("knows when the caret is in a mention (names can have a space)", () => {
    expect(mentionQuery("legs with @Dw", 13)).toEqual({ query: "Dw", start: 10 });
    expect(mentionQuery("@Alyssa Am", 10)).toEqual({ query: "Alyssa Am", start: 0 });
    expect(mentionQuery("email me@x", 10)).toBeNull();
    expect(mentionQuery("done @Vicky and more", 20)).toBeNull();
  });
  it("suggests names that start with it first, then any word", () => {
    const people = [{ name: "Alyssa Amanda" }, { name: "Amanda K" }, { name: "Vicky" }];
    expect(suggestMentions(people, "am").map((p) => p.name)).toEqual(["Amanda K", "Alyssa Amanda"]);
    expect(suggestMentions(people, "").length).toBe(3);
  });
  it("finds people by username too, and a pick puts in their @username", () => {
    const people = [{ name: "Marc", username: "marc.lifts" }, { name: "Jen", username: "iron_jen" }];
    expect(suggestMentions(people, "iron").map((p) => p.name)).toEqual(["Jen"]);
    expect(read("src/components/community/mentions.tsx")).toContain("const handle = a.username || a.name;");
  });
});

describe("usernames on the server", () => {
  const u = read("supabase/migrations/20261222090000_mention_usernames.sql");
  it("every person card carries the username, from the profile row it already reads", () => {
    expect(u).toContain("'username', cp.username)");
    expect(u).toContain("LEFT JOIN public.community_profiles cp ON cp.user_id = me.uid");
  });
  it("a caption tags @username as well as @Name; a tie goes to the username", () => {
    expect(u).toContain("regexp_instr(cap.c, '@' || replace(lower(h.name), '.', '[.]') || '(?![a-z0-9_]|[.][a-z0-9_])')");
    expect(u).toContain("(h2.len > h.len OR (h2.len = h.len AND h2.rank > h.rank))");
    expect(u).toContain("REVOKE ALL ON FUNCTION public.community_caption_mentions(text, uuid, boolean) FROM PUBLIC, anon, authenticated;");
  });
});

describe("collabs on the server", () => {
  it("1-3 people named is a collab, more is a shout-out, community posts only", () => {
    expect(sql).toMatch(/CASE WHEN count\(\*\) BETWEEN 1 AND 3 THEN array_agg/);
    expect(sql).toMatch(/p\.visibility = 'community'/);
  });
  it("mentions follow the caption, names two people share are skipped, never yourself", () => {
    expect(sql).toMatch(/strpos\(cap, lower\(m\.text\)\) = 0/);
    expect(sql).toMatch(/HAVING count\(\*\) = 1/);
    expect(sql).toMatch(/a\.user_id <> public\.community_main_account\(_author\)/);
  });
  it("profiles show their collabs; anyone named can take themselves off", () => {
    expect(sql).toMatch(/OR _author_user_id = ANY \(public\.community_post_collab_ids\(p\.id\)\)/);
    expect(sql).toMatch(/FUNCTION public\.community_leave_post/);
  });
  it("a birthday post has its person on it; recaps name people without @", () => {
    expect(sql).toMatch(/AFTER UPDATE OF post_id ON public\.community_birthday_posts/);
    expect(sql).toMatch(/IF NEW\.series IN \('wednesday_wins', 'sunday_recap'\) THEN/);
  });
  it("no new pushes", () => {
    expect(sql).not.toMatch(/app_event|send_push|net\.http_post/);
  });
});

describe("collab header", () => {
  it("'Jared McIntyre and Dwayne' / 'and N others', each tappable", () => {
    expect(card).toMatch(/collabs\.length === 1 \?/);
    expect(card).toMatch(/\{collabs\.length\} others/);
    expect(card).toMatch(/collaborators=\{post\.collaborators\}\s+onOpenPerson=\{onOpenAuthor\}/);
  });
});

describe("feed that builds as you scroll", () => {
  it("smaller first page, next pages fetched well before the end", () => {
    expect(FIRST_FEED_PAGE).toBe(5);
    expect(screen).toMatch(/rootMargin: "1400px 0px"/);
  });
  it("posts ease in as they arrive; a post-shaped placeholder while loading; a caught-up card at the end", () => {
    // the first post is the first thing in the feed (Activity is a bubble in the story row)
    expect(screen).toMatch(/<Fragment key=\{p\.id\}>\s*<FeedItem index=\{i\}/);
    expect(screen).toMatch(/\{isFetchingNextPage && \(\s*<div[^>]*data-feed-more>\s*<ActivitySpinner size=\{24\} \/>/);
    expect(screen).toMatch(/<CaughtUp\s/);
    expect(card).toMatch(/className="media-fade relative h-full w-full object-cover"/);
  });
  it("new posts from others: a pill when you're down the feed, slide in at the top", () => {
    expect(motion).toMatch(/if \(!row\?\.id \|\| row\.author_user_id === mine\.current\) return;/);
    expect(motion).toMatch(/if \(window\.scrollY < 300\) void qc\.invalidateQueries/);
    expect(sql).toMatch(/ADD TABLE public\.community_posts;/);
  });
});
