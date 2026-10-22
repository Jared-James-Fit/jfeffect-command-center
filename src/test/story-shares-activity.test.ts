import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { activityNote, activityPeople, canShareToStory, storyTarget, type ActivityPerson, type CommunityPost } from "@/lib/community";
import { shareCardWords } from "@/lib/story-reply";

const read = (f: string) => readFileSync(f, "utf8");
const sql = read("supabase/migrations/20261212090000_story_shares_activity.sql");
const named = read("supabase/migrations/20261224090000_views_always_named.sql");

const who = (user_id: string, x: Partial<ActivityPerson> = {}): ActivityPerson => ({ user_id, name: user_id, avatar_url: null, is_coach: false, ...x });
const post = (x: Partial<CommunityPost>) =>
  ({ id: "p1", is_mine: false, story: false, auto: false, archived_at: null, visibility: "community", caption: null, series: null, stats: null, media_type: null, gif_url: null, author: { user_id: "a", name: "Kayla Smith", avatar_url: null, is_coach: false }, ...x }) as unknown as CommunityPost;

describe("Add to your story: what can be shared", () => {
  it("your own post, or anyone's crew-wide post; never a story, an automatic workout story or an archived post", () => {
    expect(canShareToStory(post({}))).toBe(true);
    expect(canShareToStory(post({ is_mine: true, visibility: "followers" }))).toBe(true);
    expect(canShareToStory(post({ visibility: "followers" }))).toBe(false);
    expect(canShareToStory(post({ visibility: "close_friends" }))).toBe(false);
    expect(canShareToStory(post({ story: true }))).toBe(false);
    expect(canShareToStory(post({ auto: true, is_mine: true }))).toBe(false);
    expect(canShareToStory(post({ archived_at: "2026-10-20T10:00:00Z" }))).toBe(false);
  });

  it("the database refuses the same things, in order, and checks the post is one you can see", () => {
    expect(sql).toContain("WHEN p.id IS NULL OR p.archived_at IS NOT NULL THEN 'Post not found'");
    expect(sql).toContain("WHEN coalesce(p.story_only, false) OR coalesce(p.auto_shared, false) THEN 'A story can''t be added to another story'");
    expect(sql).toContain("WHEN p.author_user_id = public.community_main_account(_viewer) THEN NULL");
    expect(sql).toContain("WHEN p.visibility <> 'community' THEN 'Only posts shared with the whole crew can be added to your story'");
    expect(sql).toContain("IF NOT coalesce(_story, false) THEN RAISE EXCEPTION 'A post is shared to your story'; END IF;");
    expect(sql).toContain("AND (public.community_is_staff(uid) OR p.author_user_id NOT IN (SELECT public.community_blocked_authors()))) THEN");
    // internal helpers: nobody signed in can call them with someone else's id
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.community_share_refusal(uuid, uuid) FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.community_shared_post_json(uuid) FROM PUBLIC, anon, authenticated;");
    // one community_create_post, so a call never has two to pick from
    expect(sql).toContain("DROP FUNCTION IF EXISTS public.community_create_post(text, jsonb, text, boolean);");
  });

  it("View post on a shared story opens the post it shares (only for people who may see it), else the story itself", () => {
    expect(storyTarget(post({ id: "story", shared_post: { id: "orig", author: who("a"), kind: "note", series: null } }))).toBe("orig");
    expect(storyTarget(post({ id: "story", shared_post: null }))).toBe("story");
    expect(sql).toContain("AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id)");
    expect(sql).toContain("''shared_post'', public.community_shared_post_json(n.shared_post_id))");
    const stories = read("src/components/community/crew-stories.tsx");
    expect(stories).toContain("onOpen={() => onOpenPost(storyTarget(post))}");
  });

  it("only sends the shared post with a story, and only while its card is still on the story", () => {
    const q = read("src/lib/community.queries.ts");
    expect(q).toContain("...(i.story && i.sharedPostId ? { _shared_post_id: i.sharedPostId } : {}),");
    const studio = read("src/components/community/share-studio.tsx");
    expect(studio).toContain("const sharedPostId = share && items.some((i) => i.id === SHARE_CARD_ID) ? share.postId : null;");
    // a share never saves over (or restores) the studio's draft
    expect(studio).toContain("if (!open || !post || reply || share || restoredFor.current === post.key) return;");
  });

  it("is offered only where the story camera can open, never in a coach's View as client", () => {
    const card = read("src/components/community/post-card.tsx");
    expect(card).toContain("const canStory = useStoryShareReady() && !isImpersonating && canShareToStory(post);");
    expect(read("src/components/community/story-reply-host.tsx")).toContain("useEffect(() => registerStoryShareHost(), []);");
    expect(read("src/components/community/community-screen.tsx")).toContain("{!previewOnly && <StoryReplyHost unit={unit} />}");
    expect(read("src/components/community/crew-stories.tsx")).toContain("shareReady && !isImpersonating && canShareToStory(post)");
  });
});

describe("the shared post's card", () => {
  it("a photo: its caption under it; a words post: its words; a workout: the win in your unit; never a program name", () => {
    expect(shareCardWords(post({ media_type: "image", caption: "new gym who dis" }), "lb")).toEqual({ title: null, body: "new gym who dis" });
    expect(shareCardWords(post({ caption: "deload week. sleep, eat, walk" }), "kg")).toEqual({ title: "deload week. sleep, eat, walk", body: null });
    const win = shareCardWords(
      post({ stats: { workout_title: "Block 5 · Week 1", prs: [{ exercise_name: "Competition Squat", reps: 3, load_kg: 182.5, scope: "atpr" }], pr_count: 1 } as never }),
      "lb",
    );
    expect(win.title).toContain("Competition Squat PR");
    expect(win.title).toContain("lb");
    expect(win.title).not.toContain("Block 5");
  });
});

describe("Activity: views, likes, shares and reposts, for the poster only", () => {
  const people = [
    who("nicole", { viewed_at: "t3", shared_at: "t4", share_id: "s1", reaction: "heart", reacted_at: "t3" }),
    who("marc", { viewed_at: "t2", reposted_at: "t2" }),
    who("dwayne", { viewed_at: "t1", reaction: "fire", reacted_at: "t1" }),
    who("reecey", { viewed_at: "t0" }),
  ];

  it("tabs, Instagram's icons: likes = reacted, shares = added it to their story, reposts = reposted it", () => {
    expect(activityPeople(people, "all").map((p) => p.user_id)).toEqual(["nicole", "marc", "dwayne", "reecey"]);
    expect(activityPeople(people, "likes").map((p) => p.user_id)).toEqual(["nicole", "dwayne"]);
    expect(activityPeople(people, "shares").map((p) => p.user_id)).toEqual(["nicole"]);
    expect(activityPeople(people, "reposts").map((p) => p.user_id)).toEqual(["marc"]);
  });

  it("a like is the badge on their photo; the line under a name only says they shared or reposted it", () => {
    expect(activityNote(people[0])).toBe("Shared to their story");
    expect(activityNote(people[1])).toBe("Reposted");
    expect(activityNote(people[2])).toBeNull();
    expect(activityNote(people[3])).toBeNull();
  });

  it("only the poster can open it; everyone who viewed is named; you're never on your own list", () => {
    expect(named).toContain("IF NOT EXISTS (SELECT 1 FROM public.community_posts p WHERE p.id = _post_id AND p.author_user_id = v_me) THEN");
    expect(named).toContain("WHERE public.community_main_account(u.user_id) IS DISTINCT FROM v_me");
    // a share is named only when its story is one the poster may see
    expect(named).toContain("AND public.community_post_visible(sp.visibility, sp.author_user_id, sp.client_id)");
    expect(named).toContain("REVOKE ALL ON FUNCTION public.community_post_activity(uuid) FROM PUBLIC, anon;");
    expect(named).not.toContain("'private_count', (SELECT count(*) FROM public.community_post_views x");
  });

  it("no viewing privately: the switch is gone for good, and only views made while it was on stay nameless", () => {
    expect(named).toContain("ADD COLUMN IF NOT EXISTS anonymous boolean NOT NULL DEFAULT false;");
    expect(named).toContain("WHERE cp.user_id = v.viewer_user_id AND cp.private_views AND NOT v.anonymous;");
    expect(named).toContain("UPDATE public.community_profiles SET private_views = false WHERE private_views;");
    expect(named).toContain("ADD CONSTRAINT community_profiles_views_named CHECK (NOT private_views);");
    expect(named).toContain("DROP FUNCTION IF EXISTS public.community_set_private_views(boolean);");
    expect(named).toContain("WHERE v.post_id = _post_id AND NOT v.anonymous");
    const ui = read("src/components/community/post-activity.tsx");
    expect(ui).not.toContain("View posts privately");
    expect(ui).not.toContain("community_set_private_views");
  });

  it("your story: Seen by, the hearts or a swipe up shrink it to the top over its viewers (Instagram's)", () => {
    const stories = read("src/components/community/crew-stories.tsx");
    expect(stories).toContain("return post.is_mine ? setAskActivity((n) => n + 1) : onOpenPost(storyTarget(post));");
    expect(stories).toContain("<StoryViewersPanel");
    expect(stories).toContain("renderPreview={(m) => <StoryFrame post={m} unit={unit} />}");
    // a swipe from before this bar was on screen never opens it
    expect(stories).toContain("if (ask === asked.current) return;");
    const ui = read("src/components/community/post-activity.tsx");
    // story gestures leave it alone; tap the story at the top to go back to it
    expect(ui).toContain("data-story-interactive data-story-viewers");
    expect(ui).toContain("onClick={() => (on ? onClose() : onPick(m.id))}");
    // only a story made in the camera can be deleted from here
    expect(ui).toContain("const canDelete = !!post.story && !post.auto && !!onDeleted;");
    expect(read("src/components/community/post-views.tsx")).toContain("<PostActivitySheet postId={open ? post.id : null}");
  });

  it("people you follow get no Follow button (no column of Following); under a name, what they did, else their @username", () => {
    const ui = read("src/components/community/post-activity.tsx");
    expect(ui).toContain("{note ?? `@${p.username}`}");
    expect(ui).toContain('if (!state || label === "Following" || label === "Requested") return null;');
  });
});
