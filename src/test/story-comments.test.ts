import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { commentCountWords, isStickerText, peekComments, STORY_PEEK_MAX } from "@/lib/story-comments";
import type { CommentPreview, CommunityComment } from "@/lib/community";

const read = (f: string) => readFileSync(f, "utf8");
const a = (id: string, name: string) => ({ user_id: id, name, avatar_url: null, is_coach: false });

const comment = (id: string, at: string, x: Partial<CommunityComment> = {}): CommunityComment => ({
  id,
  body: `words ${id}`,
  created_at: at,
  author: a(`u-${id}`, `Person ${id}`),
  can_delete: false,
  ...x,
});

describe("the comments floating over a story (peekComments)", () => {
  it("shows the newest few top-level comments, oldest first so the newest sits lowest", () => {
    const live = [
      comment("1", "2026-11-26T10:00:00Z"),
      comment("2", "2026-11-26T10:05:00Z"),
      comment("r", "2026-11-26T10:06:00Z", { parent_id: "1" }),
      comment("3", "2026-11-26T10:10:00Z"),
    ];
    expect(STORY_PEEK_MAX).toBe(2);
    expect(peekComments(null, live).map((c) => c.id)).toEqual(["2", "3"]);
    // under a sticker only one floats
    expect(peekComments(null, live, 1).map((c) => c.id)).toEqual(["3"]);
  });

  it("never shows a hidden comment; shows a just-sent one (pending) at once; says what a media comment is", () => {
    const live = [
      comment("1", "2026-11-26T10:00:00Z", { hidden: true }),
      comment("2", "2026-11-26T10:05:00Z", { body: "", media: { path: "x", thumb: null, type: "gif", width: null, height: null } }),
      comment("pending-1", "2026-11-26T10:06:00Z", { pending: true }),
    ];
    const out = peekComments(null, live);
    expect(out.map((c) => c.id)).toEqual(["2", "pending-1"]);
    expect(out[0].media).toBe("a GIF");
    expect(out[1].pending).toBe(true);
  });

  it("before the live thread loads, reads the preview that came with the story (no fetch to wait on)", () => {
    const preview: CommentPreview[] = [
      { id: "p", body: "pinned one", author: a("u1", "Marc"), pinned: true, media: false, created_at: "2026-11-26T09:00:00Z" },
      { id: "n", body: "newest", author: a("u2", "Vicky"), pinned: false, media: false, created_at: "2026-11-26T11:00:00Z" },
    ];
    expect(peekComments(preview, undefined).map((c) => c.id)).toEqual(["p", "n"]);
    expect(peekComments([], undefined)).toEqual([]);
    expect(peekComments(undefined, undefined)).toEqual([]);
  });
});

describe("a comment that's only emoji reads as a sticker", () => {
  it("one to three emoji (with skin tones and joins) are a sticker; words, numbers or four emoji aren't", () => {
    expect(isStickerText("🔥")).toBe(true);
    expect(isStickerText(" 💪🏽 ")).toBe(true);
    expect(isStickerText("🔥🔥🔥")).toBe(true);
    expect(isStickerText("👨‍👩‍👧")).toBe(true);
    expect(isStickerText("🔥🔥🔥🔥")).toBe(false);
    expect(isStickerText("nice 🔥")).toBe(false);
    expect(isStickerText("100")).toBe(false);
    expect(isStickerText("#1")).toBe(false);
    expect(isStickerText("")).toBe(false);
    expect(isStickerText(null)).toBe(false);
  });

  it("counts comments in words", () => {
    expect(commentCountWords(0)).toBe("Comments");
    expect(commentCountWords(1)).toBe("1 comment");
    expect(commentCountWords(12)).toBe("12 comments");
  });
});

describe("the story viewer keeps its comments in the story (Nov 26 2026)", () => {
  const viewer = read("src/components/community/crew-stories.tsx");
  const panel = read("src/components/community/story-comments.tsx");
  const peek = read("src/components/community/story-comments-peek.tsx");

  it("never opens the feed's comment sheet, a page or a second story from a story's comments", () => {
    expect(viewer).not.toContain("<CommentsSheet");
    expect(viewer).toContain("<StoryCommentsPanel key={post.id} post={post} open={commentsOpen}");
    // the panel is the story's own: no Sheet / Dialog of its own, no feed comment thread
    expect(panel).not.toContain("<Sheet ");
    expect(panel).not.toContain("<CommentThread");
    // a commenter's photo opens their profile, never their story on top of this one
    expect(panel).not.toContain("StoryAvatar");
    // a swipe up opens the comments, never the post's page
    expect(viewer).toContain("if (post.is_mine) return setAskActivity((n) => n + 1);\n      return openComments();");
    expect(viewer).not.toContain("storyLinkLabel(post) ? onOpenPost(storyTarget(post)) : ");
  });

  it("pauses while its comments are open and carries on from the same spot (never reset)", () => {
    expect(viewer).toContain("const waiting = composing || commentsOpen;");
    expect(viewer).toContain("if (!frameKey || paused || end || waiting || clipDrives) return;");
    expect(viewer).toContain("paused: paused || !!end || waiting,");
    // Esc closes the comments, not the stories
    expect(viewer).toContain("if (commentsOpen) {\n            e.preventDefault();");
  });

  it("renders the panel outside the story's own gestures, with a scrim that only closes it", () => {
    const at = viewer.indexOf("<StoryCommentsPanel");
    const gestures = viewer.indexOf("data-story-viewer\n");
    expect(at).toBeGreaterThan(gestures);
    expect(panel).toContain("data-story-comments-scrim");
    expect(panel).toContain("onClick={close}");
    expect(panel).toContain("useSwipeDownToClose(panelEl, open && !focused, close);");
  });

  it("public comments and private replies read differently", () => {
    expect(panel).toContain("data-story-comments-public");
    expect(panel).toContain('aria-label={replyTo ? "Write a public reply" : "Add a public comment"}');
    expect(viewer).toContain("Private · only {first} sees it");
    expect(viewer).toContain(': "Message…"}');
    expect(viewer).toContain('<Lock className="mr-2 h-3.5 w-3.5 shrink-0 text-white/70" aria-hidden />');
    expect(viewer).not.toContain("To say something everyone can see, tap the speech bubble.");
  });

  it("floats the newest comments over the story and keeps them live (realtime, counts in step)", () => {
    expect(viewer).toContain("<StoryCommentsPeek post={post} live={liveComments} onOpen={onOpenComments}");
    expect(peek).toContain("useCommentsRealtime(id, on);");
    expect(peek).toContain("useSyncCommentCount(id, on ? list.data : undefined);");
    // the pills take a tap; the space around them never does
    expect(peek).toContain('"pointer-events-none flex flex-col items-start gap-1.5"');
  });

  it("posts, likes and deletes show at once and put themselves back on failure", () => {
    expect(panel).toContain("add\n      .mutateAsync({");
    expect(panel).toContain('toast.error(e?.message ?? "Couldn\'t post that comment");');
    expect(panel).toContain("setText((t) => t || words);");
    const q = read("src/lib/community.queries.ts");
    expect(q).toContain("onError: (_e, c) => {\n      setComments(qc, postId, (l) => l.filter((x) => x.id !== c.tempId));");
  });

  it("supports text, sticker emoji, GIFs, a photo or clip and a voice memo", () => {
    expect(panel).toContain("STORY_COMMENT_STICKERS.map");
    expect(panel).toContain("<GifPicker");
    expect(panel).toContain('accept="image/*,video/*"');
    expect(panel).toContain("useVoiceMemoRecorder");
    expect(panel).toContain("data-story-comment-sticker");
  });
});
