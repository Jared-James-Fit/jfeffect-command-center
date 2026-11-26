import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { storyLinkLabel, type CommunityPost } from "@/lib/community";
import { feedCopyPath, feedMedia, storyFeedVerdict, storyFilesToCopy } from "@/lib/story-feed";

const read = (f: string) => readFileSync(f, "utf8");
const viewer = read("src/components/community/crew-stories.tsx");

const me = { user_id: "me", name: "Kayla Smith", avatar_url: null, is_coach: false };
const post = (x: Partial<CommunityPost>) =>
  ({
    id: "s1",
    is_mine: true,
    story: true,
    auto: false,
    kind: "note",
    series: null,
    stats: null,
    visibility: "community",
    archived_at: null,
    media_path: "me/1-a.jpg",
    media_thumb_path: "me/1-a-thumb.jpg",
    media_type: "image",
    media_width: 1080,
    media_height: 1920,
    media_focus: null,
    extra_media: [],
    gif_url: null,
    caption: "leg day",
    shared_post: null,
    author: me,
    ...x,
  }) as unknown as CommunityPost;

describe("a story has no page of its own", () => {
  it("only a workout's win and a story that shares a post keep a link", () => {
    expect(storyLinkLabel(post({}))).toBeNull();
    expect(storyLinkLabel(post({ media_path: null, media_type: null, stats: { pr_count: 1 } as any, auto: true }))).toBe("View workout");
    const other = { user_id: "marc", name: "Marc Dupont", avatar_url: null, is_coach: false };
    expect(storyLinkLabel(post({ shared_post: { id: "p9", author: other, kind: "note", series: null } }))).toBe("View Marc's post");
    expect(storyLinkLabel(post({ shared_post: { id: "p9", author: me, kind: "note", series: null } }))).toBe("View post");
  });

  it("the viewer never draws a bare Post / View post button; swipe up always goes to its comments, never a page", () => {
    expect(viewer).not.toMatch(/"Post"\} <ChevronRight/);
    expect(viewer).not.toContain('"View post"}');
    expect(viewer).toContain("if (post.is_mine) return setAskActivity((n) => n + 1);\n      return openComments();");
  });
});

describe("the interaction bar", () => {
  it("has a private message field, heart, comments and share, in that order", () => {
    const heart = viewer.indexOf("data-story-heart");
    const comment = viewer.indexOf("data-story-comment", heart);
    const share = viewer.indexOf("data-story-share", comment);
    expect(heart).toBeGreaterThan(0);
    expect(comment).toBeGreaterThan(heart);
    expect(share).toBeGreaterThan(comment);
    expect(viewer).toContain('placeholder={full ? `You can message ${first} again once they reply` : "Message…"}');
    expect(viewer).toContain('aria-label={mine ? "Unlike" : "Like"}');
    expect(viewer).not.toContain('win ? "Celebrate" : "Like"');
  });

  it("a message goes through the existing direct path with its request rules; a comment is the post's own thread, in the story's panel", () => {
    expect(viewer).toContain("await send.mutateAsync({ postId: post.id, body: b, story: true, media: media ? mediaAttachment(media) : null });");
    expect(viewer).toContain("const full = !!thread?.outgoing && thread.left === 0;");
    expect(viewer).toContain("<StoryCommentsPanel key={post.id} post={post} open={commentsOpen}");
    expect(read("src/components/community/story-comments.tsx")).toContain("const list = useComments(post.id, open);");
    expect(viewer).toContain("Private · only {first} sees it");
  });

  it("the story waits while typing or while the comments, the share sheet, the menu or the viewers are open", () => {
    expect(viewer).toContain("onComposing(focused || text.trim().length > 0 || sheetOpen);");
    expect(viewer).toContain("onHold(viewers || sticker || menuBusy || sharingOpen);");
    expect(viewer).toContain("const waiting = composing || commentsOpen;");
    expect(viewer).toContain("<PostShareSheet");
  });

  it("your own story shows who saw it, the likes, the comments and a share; the rest is in the ⋯", () => {
    const mine = viewer.slice(viewer.indexOf("function MyStoryBar"), viewer.indexOf("type ClipControl"));
    for (const id of ["data-story-activity", "data-story-likes", "data-story-comment", "data-story-share"]) expect(mine).toContain(id);
    expect(mine).not.toContain("data-story-add-sticker");
    expect(viewer).toContain("data-story-more");
    expect(read("src/components/community/story-menu.tsx")).toContain("data-story-share-feed");
  });
});

describe("Share to feed", () => {
  it("is for your own camera story with a picture, for the crew or a private account's followers", () => {
    expect(storyFeedVerdict(post({}))).toEqual({ ok: true, audience: "community" });
    expect(storyFeedVerdict(post({ visibility: "followers" }))).toEqual({ ok: true, audience: "followers" });
  });

  it("never someone else's, a Close friends story, a lesson, a workout card, a story that only shows a post, or one with no picture", () => {
    const no = (x: Partial<CommunityPost>) => storyFeedVerdict(post(x)).ok;
    expect(no({ is_mine: false })).toBe(false);
    expect(no({ visibility: "close_friends" })).toBe(false);
    expect(no({ series: "lesson", story: false })).toBe(false);
    expect(no({ auto: true, kind: "workout", story: false })).toBe(false);
    expect(no({ kind: "workout" })).toBe(false);
    expect(no({ shared_post: { id: "p9", author: me, kind: "note", series: null } })).toBe(false);
    expect(no({ media_path: null, media_type: null })).toBe(false);
    expect(no({ archived_at: "2026-11-25T10:00:00Z" })).toBe(false);
    expect(no({ story: false })).toBe(false);
  });

  it("says why, in words the athlete can act on", () => {
    const v = storyFeedVerdict(post({ auto: true, kind: "workout" }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain("workout card on its own stays on your story");
  });

  it("the feed gets its own files under the poster's folder, keeping the extension", () => {
    expect(feedCopyPath("me/1-a.jpg", "me", 99, "ab12")).toBe("me/99-ab12-feed.jpg");
    expect(feedCopyPath("other/v.MP4", "me", 99, "ab12")).toBe("me/99-ab12-feed.mp4");
    expect(feedCopyPath("me/noext", "me", 99, "ab12")).toBe("me/99-ab12-feed");
    expect(feedCopyPath("me.dir/noext", "me", 99, "ab12")).toBe("me/99-ab12-feed");
  });

  it("copies every file once and keeps the slides' order, shape and framing", () => {
    const p = post({
      media_type: "video",
      media_focus: { x: 0.5, y: 0.2 } as any,
      extra_media: [{ path: "me/2-b.jpg", thumb: null, type: "image", width: 1080, height: 1350 }] as any,
    });
    const files = storyFilesToCopy([
      { path: "me/1-a.jpg", thumb: "me/1-a-thumb.jpg", type: "video", width: 1080, height: 1920 },
      { path: "me/2-b.jpg", thumb: null, type: "image", width: 1080, height: 1350 },
      { path: "me/2-b.jpg", thumb: null, type: "image", width: 1080, height: 1350 },
    ]);
    expect(files).toEqual(["me/1-a.jpg", "me/1-a-thumb.jpg", "me/2-b.jpg"]);
    const copies = new Map(files.map((f, i) => [f, `me/new-${i}.jpg`]));
    const media = feedMedia(p, copies);
    expect(media.map((m) => m.path)).toEqual(["me/new-0.jpg", "me/new-2.jpg"]);
    expect(media[0].thumb).toBe("me/new-1.jpg");
    expect(media[0].focus).toEqual({ x: 0.5, y: 0.2 });
    expect([media[0].width, media[0].height]).toEqual([1080, 1920]);
    expect(media[1].thumb).toBeNull();
  });

  it("posts through community_create_post as a feed post (no story flag), never an automatic one", () => {
    const q = read("src/lib/story-feed.queries.ts");
    expect(q).toContain('db.rpc("community_create_post"');
    expect(q).not.toContain("_story");
    expect(q).toContain(".copy(from, to)");
    expect(read("src/components/community/story-menu.tsx")).toContain("Your story stays up for its 24 hours.");
  });
});
