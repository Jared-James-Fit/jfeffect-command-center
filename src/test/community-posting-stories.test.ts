import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { crewStories, myStory, namesLine, storyEnd, storyWorthy, STORY_WINDOW_MS } from "@/lib/community";
import { holdsMapOrSet, shouldPersistQuery } from "@/lib/query-persister";
import { draftWorthKeeping } from "@/lib/post-draft";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

describe("the on-phone query cache never stores what JSON can't bring back", () => {
  it("a Map (the Hall of Strength's meet tiers) stays in memory; plain data still goes to disk", () => {
    const q = (data: unknown) => ({ queryKey: ["strength-board", "tiers"], state: { status: "success", data } });
    expect(holdsMapOrSet(new Map([["a", 1]]))).toBe(true);
    expect(holdsMapOrSet({ rows: [{ seen: new Set(["x"]) }] })).toBe(true);
    expect(shouldPersistQuery(q(new Map([["a", { top_level: "national" }]])))).toBe(false);
    expect(shouldPersistQuery(q([{ athlete_id: "a", top_level: "national" }]))).toBe(true);
    expect(read("src/lib/query-persister.ts")).toContain('export const QUERY_PERSIST_BUSTER = "v9";');
  });
});

describe("posting never strands people", () => {
  it("the studio is fetched early, fails full screen, and a crash in it is contained and reported", () => {
    const shell = read("src/components/community/studio-chunks.tsx");
    expect(shell).toContain("usePreloadStudio");
    expect(shell).toContain("requestIdleCallback");
    expect(shell).toContain('_route: `${window.location.pathname}#posting`');
    expect(shell).toContain("Couldn't open the camera");
    for (const f of ["share-workout-picker.tsx", "lock-in.tsx", "workout-share-studio.tsx"]) {
      expect(read(`src/components/community/${f}`)).toContain("StudioShell");
      expect(read(`src/components/community/${f}`)).not.toContain('import("@/components/community/share-studio")');
    }
    expect(read("src/components/workout-submission-summary.tsx")).toContain("WorkoutShareStudio.preload()");
  });
  it("a draft is kept while there's a photo or words, and the studio restores and clears it", () => {
    expect(draftWorthKeeping({ caption: "", photo: null })).toBe(false);
    expect(draftWorthKeeping({ caption: "  ", photo: null })).toBe(false);
    expect(draftWorthKeeping({ caption: "heavy day", photo: null })).toBe(true);
    expect(draftWorthKeeping({ caption: "", photo: new Blob(["x"]) })).toBe(true);
    const studio = read("src/components/community/share-studio.tsx");
    expect(studio).toContain("loadDraft(key)");
    expect(studio).toContain("void clearDraft();");
    // it comes back quietly (Nov 23 2026): no "Picked up where you left off / Start over" over the editor
    expect(studio).not.toContain("Picked up where you left off");
    expect(studio).not.toContain("Your caption is back");
  });
  it("big canvases give their memory back (iPhone's canvas cap)", () => {
    const studio = read("src/components/community/share-studio.tsx");
    expect(studio.match(/releaseCanvas\(/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
    expect(read("src/lib/image-compress.ts")).toContain("canvas.width = 0;");
  });
});

describe("members post anything, not only workouts", () => {
  it("the + is Instagram's New post (Nov 22 2026): the library in the same tap, Normal first, Write for words", () => {
    const btn = read("src/components/community/share-workout-picker.tsx");
    expect(read("src/components/community/crew-filters.ts")).toContain('const items: LookItem[] = [{ key: NORMAL_KEY, look: "plain", label: "Normal" }];');
    expect(btn).toContain("createCommunityPost(qc,");
    // a post and a story both start on Normal (mode null), never a card nobody picked
    expect(btn).toContain('const activeMode: Mode = mode === "lockin" && !today ? "post" : mode === "workout" && !target && !isLoading ? "post" : mode ?? "post";');
    expect(btn).toContain("if (pickNow) picker.library();");
    expect(btn).toContain("const begin = () => (story ? beginStory() : beginPost());");
    // Write: a words-only post is always a plain one
    expect(btn).toContain("plainPost={plainPost}");
    expect(read("src/components/community/post-composer.tsx")).toContain("const target = words ? (plainPost ?? post)! : post!;");
    expect(read("src/lib/community.queries.ts")).toContain('db.rpc("community_create_post"');
  });
  it("Story is the camera, Post the New post screen: each one's Post · Story moves to the other", () => {
    const btn = read("src/components/community/share-workout-picker.tsx");
    const studio = read("src/components/community/share-studio.tsx");
    expect(btn).toContain('startAs="story"');
    expect(btn).toContain("onPostFlow={() => beginPost(true, true)}");
    expect(btn).toContain('onStory={() => beginStory("post")}');
    expect(studio).toContain('if (k === "post" && onPostFlow) return onPostFlow();');
    // the camera still says which it's on as it opens and on every switch
    expect(studio).toContain("const [kind, setKind] = useState<ShareKind>(startAs);");
    expect(studio).toMatch(/useEffect\(\(\) => \{\s*if \(open\) onKindRef\.current\?\.\(kind\);\s*\}, \[open, kind\]\);/);
  });
  it("the database function: own media only, no points, a daily cap", () => {
    const sql = read("supabase/migrations/20261101100000_community_member_posts.sql");
    expect(sql).toContain("public.community_clean_media(_media, uid)");
    expect(sql).toContain("'note'");
    expect(sql).toContain(">= 25");
  });
});

describe("Crew Stories", () => {
  const now = Date.UTC(2026, 9, 13, 18);
  const at = (h: number) => new Date(now - h * 3600e3).toISOString();
  const author = (id: string) => ({ user_id: id, name: id[0].toUpperCase() + id.slice(1), avatar_url: null, is_coach: false });
  const stats = (o: object) => ({ prs: [], pr_count: 0, month_sessions: 2, week_sessions: 1, top_lift: { exercise_name: "Squat", reps: 5, load_kg: 100 }, working_sets: 12, duration_min: 50, ...o });
  const pulse = (id: string, who: string, h: number, o: object, seen = false) => ({ id, author: author(who), created_at: at(h), auto: true, stats: stats(o), visibility: "community", is_mine: false, seen }) as any;
  // a feed post (what the feed shows), and a story (what someone posted as one)
  const post = (id: string, who: string, h: number, seen = false, extra: object = {}) => ({ id, author: author(who), created_at: at(h), auto: false, stats: null, visibility: "community", is_mine: false, seen, ...extra }) as any;
  const story = (id: string, who: string, h: number, seen = false, extra: object = {}) => post(id, who, h, seen, { story: true, ...extra });

  it("only stories are stories (Nov 18 2026): what someone posted as one, the coach's lessons and a session that posted itself before automatic stories went; never a copy of a feed post, coach-only or private", () => {
    expect(storyWorthy(story("e", "marc", 1))).toBe(true);
    expect(storyWorthy(post("l", "coach", 1, false, { series: "lesson" }))).toBe(true);
    // older automatic sessions play out their 24 hours
    expect(storyWorthy(pulse("a", "vicky", 1, { prs: [{ exercise_name: "Squat", reps: 3, load_kg: 140, scope: "atpr" }], pr_count: 1 }))).toBe(true);
    // a post in the feed (a workout, a photo, the daily series) is never a story too
    expect(storyWorthy(post("w", "marc", 1, false, { stats: stats({}) }))).toBe(false);
    expect(storyWorthy(post("p", "marc", 1))).toBe(false);
    expect(storyWorthy(post("d", "coach", 1, false, { series: "wednesday_wins" }))).toBe(false);
    expect(storyWorthy(story("f", "marc", 1, false, { visibility: "coach" }))).toBe(false);
    expect(storyWorthy(story("g", "marc", 1, false, { visibility: "private" }))).toBe(false);
  });
  it("your own story: your last day of stories, oldest first, with nothing older and never your feed posts", () => {
    const g = myStory([story("me2", "jared", 2, false, { is_mine: true }), { ...pulse("me1", "jared", 5, {}), is_mine: true }, story("old", "jared", 30, false, { is_mine: true }), post("feed", "jared", 1, false, { is_mine: true }), story("x", "marc", 1)], now)!;
    expect(g.mine).toBe(true);
    expect(g.items.map((p) => p.id)).toEqual(["me1", "me2"]);
    expect(myStory([story("x", "marc", 1)], now)).toBeNull();
    expect(myStory([post("feed", "jared", 1, false, { is_mine: true })], now)).toBeNull();
  });
  it("one bubble a person, their last day in order, unseen first, never your own", () => {
    const g = crewStories([
      story("old", "marc", 30),
      story("m2", "marc", 2, true),
      story("m1", "marc", 5, true),
      pulse("v1", "vicky", 3, { week_sessions: 4 }),
      story("me", "jared", 1, false, { is_mine: true }),
      pulse("routine", "nicole", 1, {}),
      // Fionna's workout post is in the feed, not the stories
      post("fw", "fionna", 1, false, { stats: stats({}) }),
    ], now);
    expect(g.map((x) => x.author.user_id)).toEqual(["nicole", "vicky", "marc"]);
    expect(g[2].items.map((p) => p.id)).toEqual(["m1", "m2"]);
    expect(g[1].unseen).toBe(true);
    expect(g[2].unseen).toBe(false);
    expect(STORY_WINDOW_MS).toBe(24 * 3600e3);
  });
  it("sits at the top of the feed with your own + first; seen comes from the server", () => {
    const screen = read("src/components/community/community-screen.tsx");
    expect(screen).toContain("<StoryRail");
    // "Your story" leads with a + that opens the camera (Instagram's)
    expect(screen).toContain("addStory={canStory ? (t) => <ShareWorkoutButton unit={unit} previewOnly={previewOnly} trigger={t} story /> : undefined}");
    expect(read("src/components/community/crew-stories.tsx")).toContain("data-story-add");
    expect(read("src/components/community/crew-stories.tsx")).toContain("markPostViewed(post.id)");
    expect(read("supabase/migrations/20261101110000_community_post_seen.sql")).toContain("'seen', EXISTS");
  });

  describe("a PR, in the story of the athlete who set it (no separate crew Activity story)", () => {
    const pr = { prs: [{ exercise_name: "Squat", reps: 3, load_kg: 140, scope: "atpr" }], pr_count: 1 };
    it("a PR session is in that athlete's story for the day, its bubble tagged; earlier ones aren't replayed", () => {
      const feed = [pulse("today", "vicky", 2, pr), pulse("routine", "nicole", 3, {}), pulse("old", "marc", 30, pr)];
      const groups = crewStories(feed, now);
      expect(groups.map((g) => [g.author.user_id, g.prs])).toEqual([["vicky", 1], ["nicole", 0]]);
    });
    it("the end card names the people you watched and offers a heart for the wins you skipped", () => {
      const feed = [pulse("a", "vicky", 2, pr), pulse("b", "marc", 3, pr, true)];
      const groups = crewStories(feed, now);
      const end = storyEnd(groups, feed, new Set(["a", "b"]), now);
      expect(end.people.map((a) => a.user_id).sort()).toEqual(["marc", "vicky"]);
      expect(end.moments).toBe(2);
    });
    it("each moment is its athlete's; yours shows who saw it and never plays after someone else's", () => {
      const viewer = read("src/components/community/crew-stories.tsx");
      expect(viewer).toContain("const who = group.author;");
      expect(viewer).not.toContain("ActivityCoverFrame");
      expect(viewer).toContain("<MyStoryBar\n              post={post}\n              moments={group.items.map((it) => posts.find((p) => p.id === it.id) ?? it)}");
      expect(viewer).toContain("onOpen={() => onOpenPost(storyTarget(post))}\n              onHold={setComposing}\n              onOpenPerson={openPerson}");
      expect(viewer).toContain("const j = groups.findIndex((g, k) => k > gi && !g.mine && g.items.some(fresh));");
    });
  });

  describe("swipe down to close, as on Instagram", () => {
    const viewer = read("src/components/community/crew-stories.tsx");
    it("the story follows the finger down (smaller, the feed showing through), pausing while held", () => {
      expect(viewer).toContain("transform: `translate3d(0, ${drag.y}px, 0) scale(${1 - pull * 0.14})`,");
      expect(viewer).toContain("overlayStyle={drag ? { opacity: 1 - pull,");
      expect(read("src/components/ui/dialog.tsx")).toContain("<DialogOverlay style={overlayStyle} />");
    });
    it("let go far enough or flick and it slides away; otherwise it springs back", () => {
      expect(viewer).toContain("if (dy > 110 || (velocity.current > 0.45 && dy > 30)) close();");
      expect(viewer).toContain("else springBack();");
      // ✕, Esc and the end card leave the same way
      expect(viewer).toContain("<Dialog open onOpenChange={(o) => !o && close()}>");
    });
  });

  describe("replying to a story", () => {
    const viewer = read("src/components/community/crew-stories.tsx");
    const sql = read("supabase/migrations/20261102090000_community_story_reply.sql");
    it("a message field with two quick emoji and the heart, like Instagram / TikTok; eight more open with the keyboard", () => {
      expect(viewer).toContain('const QUICK_WIN = ["🔥", "💪", "👏", "🙌", "😤", "🐐", "💯", "🎉"];');
      expect(viewer).toContain("quick.slice(0, 2).map((e) =>");
      expect(viewer).toContain('placeholder={full ? `You can message ${first} again once they reply` : "Send a message…"}');
      expect(viewer).toContain("<StoryBar\n              post={post}\n              viewerIsStaff={viewerIsStaff}\n              onOpenPerson={openPerson}\n              onOpen={() => onOpenPost(storyTarget(post))}\n              onComposing={setComposing}");
    });
    it("the story waits while you write; a tap or Esc puts the keyboard away; swipe up opens its comments (on yours, its Activity)", () => {
      expect(viewer).toContain("if (!frameKey || paused || end || composing || clipDrives) return;");
      // a clip pauses the same way (its own clock)
      expect(viewer).toContain("paused: paused || !!end || composing,");
      expect(viewer).toContain("if (post.is_mine) return setAskActivity((n) => n + 1);");
      expect(viewer).toContain("return storyLinkLabel(post) ? onOpenPost(storyTarget(post)) : setAskComments((n) => n + 1);");
      expect(viewer).toContain("onEscapeKeyDown={(e) => {");
    });
    it("goes the same private way as Message on a post, tagged as a story; never as a client the coach is previewing", () => {
      expect(viewer).toContain("await send.mutateAsync({ postId: post.id, body: b, story: true });");
      expect(viewer).toContain("if (isImpersonating) return void toast.message(PREVIEW_ONLY_MESSAGE);");
      expect(viewer).toContain("const canMessage = !post.is_mine && !(post.author.is_coach && staff);");
      expect(read("src/lib/direct-chats.ts")).toContain("...(story ? { _story: true } : {})");
      expect(read("src/components/community/post-chat-card.tsx")).toContain('const what = att.story ? "story" : "post";');
    });
    it("the server: one function with an optional story flag (older apps still call it with two), the moment as the note", () => {
      expect(sql).toContain("'community_message_author(_post_id uuid, _body text, _story boolean DEFAULT false)'");
      expect(sql).toContain("DROP FUNCTION public.community_message_author(uuid, text);");
      expect(sql).toContain("CASE WHEN coalesce(_story, false) THEN nullif(p.win_label, '') END");
      expect(sql).toContain("REVOKE ALL ON FUNCTION public.community_message_author(uuid, text, boolean) FROM PUBLIC, anon;");
    });
  });

  describe("the end of the stories", () => {
    const pr = { prs: [{ exercise_name: "Squat", reps: 3, load_kg: 140, scope: "atpr" }], pr_count: 1 };
    const feed = [
      story("f1", "fionna", 2),
      pulse("v1", "vicky", 3, pr),
      story("m1", "marc", 5, false, { my_reaction: "heart" }),
      story("n1", "nicole", 4),
      post("older", "dwayne", 30), // a feed post, not seen: new in the feed
      post("seenfeed", "dwayne", 40, true),
      post("lastweek", "dwayne", 24 * 9),
      pulse("routine", "dwayne", 1, {}), // routine sessions never count as new posts
      story("mine", "jared", 2, false, { is_mine: true, views: { count: 9, faces: [] } }),
    ];
    const groups = crewStories(feed, now);

    it("names who you watched, offers the bubbles you didn't get to, and a heart for what you skipped (wins first)", () => {
      const watched = new Set(groups.filter((g) => g.author.user_id !== "nicole").flatMap((g) => g.items.map((p) => p.id)));
      const end = storyEnd(groups, feed, watched, now);
      // Dwayne's routine session is a story now too
      expect(end.moments).toBe(4);
      expect(end.people.map((a) => a.user_id).sort()).toEqual(["dwayne", "fionna", "marc", "vicky"]);
      expect(end.stillNew.map((i) => groups[i].author.user_id)).toEqual(["nicole"]);
      // Marc already has your heart
      expect(end.celebrate[0]).toBe("v1");
      expect([...end.celebrate].sort()).toEqual(["f1", "routine", "v1"]);
      expect(end.feedNew.map((p) => p.id)).toEqual(["older"]);
      expect(end.mine?.id).toBe("mine");
    });
    it("at most 3 hearts; with nothing of yours it offers Add yours", () => {
      const many = [1, 2, 3, 4, 5].map((i) => story(`p${i}`, `p${i}person`, i));
      const g = crewStories(many, now);
      const end = storyEnd(g, many, new Set(many.map((p) => p.id)), now);
      expect(end.celebrate).toHaveLength(3);
      expect(end.mine).toBeNull();
      expect(end.stillNew).toEqual([]);
    });
    it("names read naturally", () => {
      expect(namesLine([{ name: "Vicky Smith" }])).toBe("Vicky");
      expect(namesLine([{ name: "Vicky" }, { name: "Marc A" }])).toBe("Vicky and Marc");
      expect(namesLine([{ name: "Vicky" }, { name: "Marc" }, { name: "Fionna" }])).toBe("Vicky, Marc and 1 other");
      expect(namesLine([{ name: "Vicky" }, { name: "Marc" }, { name: "Fionna" }, { name: "Nicole" }])).toBe("Vicky, Marc and 2 others");
    });
    it("the last story leads to the end card, never a hard exit; it can take you on to the feed or into the camera", () => {
      const viewer = read("src/components/community/crew-stories.tsx");
      expect(viewer).toContain("setEnd(storyEnd(groups, posts, watched.current));");
      expect(viewer).not.toContain("} else onClose();");
      // the clock stops on it
      expect(viewer).toContain("if (!frameKey || paused || end || composing || clipDrives) return;");
      // swipe down closes it, but never from the camera opened on top of it
      expect(viewer).toContain("if (!e.currentTarget.contains(e.target as Node)) return;");
      const screen = read("src/components/community/community-screen.tsx");
      expect(screen).toContain("onJumpTo={setJumpTo}");
      expect(screen).toContain('addYours={canStory ? <ShareWorkoutButton unit={unit} label="Add yours" variant="block" previewOnly={previewOnly} story /> : null}');
    });
  });
});
