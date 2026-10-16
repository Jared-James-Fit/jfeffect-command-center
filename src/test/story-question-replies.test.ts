import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { seenAs, type CommunityPost } from "@/lib/community";
import { questionResponses, type PostSticker, type StickerAnswer } from "@/lib/lessons";

const read = (f: string) => readFileSync(f, "utf8");
const sql = read("supabase/migrations/20261211090000_story_question_replies.sql");

const author = (user_id: string) => ({ user_id, name: "Jared McIntyre", avatar_url: null, is_coach: true });
const answer = (user_id: string, body: string, at: string, answered = false): StickerAnswer => ({
  user_id,
  name: user_id,
  avatar_url: null,
  is_coach: false,
  body,
  at,
  ...(answered ? { answered_post_id: "story-2", answered_at: at } : {}),
});
const question = (over: Partial<PostSticker> = {}): PostSticker =>
  ({ type: "question", q: "whats one cue that actually clicked?", total: 2, is_mine: true, answers: [answer("nicole", "push the floor away", "2026-10-16T10:00:00Z")], ...over }) as PostSticker;
const post = (authorId: string, isMine: boolean, sticker: PostSticker | null = null) =>
  ({ id: "p1", is_mine: isMine, author: author(authorId), sticker }) as unknown as CommunityPost;

describe("View as client: a story as the client sees it", () => {
  it("the coach's own story isn't the coach's any more: no Your story, no responses, the box to type in", () => {
    const p = seenAs(post("coach", true, question()), "nicole");
    expect(p.is_mine).toBe(false);
    expect(p.sticker?.is_mine).toBe(false);
    // who answered is only ever the poster's to see
    expect(p.sticker?.answers).toBeUndefined();
    // the coach's own answer isn't the client's
    expect(p.sticker?.mine).toBeNull();
  });

  it("the client's own posts are theirs, and a post with no sticker is left alone", () => {
    expect(seenAs(post("nicole", false), "nicole").is_mine).toBe(true);
    const other = post("vicky", false);
    expect(seenAs(other, "nicole")).toBe(other);
    // a client with no account yet: nothing is theirs
    expect(seenAs(post("coach", true), "").is_mine).toBe(false);
  });

  it("is applied to everything the crew screens load while a coach views as a client", () => {
    const q = read("src/lib/community.queries.ts");
    expect(q).toContain("select: pov === null ? undefined : asClient,\n    queryKey: communityKeys.feed(authorUserId),");
    expect(q).toContain("select: pov === null ? undefined : asClient,\n    queryKey: communityKeys.post(postId),");
    expect(q).toContain("if (!client || !user || client.user_id === user.id) return null;");
    // no coach extras in the client's screen, and their reply box on a coach's story
    expect(read("src/components/community/community-screen.tsx")).toContain('const viewerIsStaff = (role === "admin" || role === "coach") && !previewOnly;');
    expect(read("src/components/community/crew-stories.tsx")).toContain('const staff = (role === "admin" || role === "coach") && !isImpersonating;');
    // the client's own menu shows, but nothing in it acts as them
    const actions = read("src/components/community/post-actions.tsx");
    expect(actions).toContain("const act = (fn: () => void) => () => (isImpersonating ? void toast.message(PREVIEW_ONLY_MESSAGE) : fn());");
    expect(actions).toContain("onSelect={act(() => setConfirmDelete(true))}");
    expect(actions).not.toContain("onSelect={() =>");
  });
});

describe("answering question responses on your story (Instagram's Share response)", () => {
  it("lists responses not answered yet first, newest first in each", () => {
    const list = questionResponses([
      answer("a", "old open", "2026-10-15T10:00:00Z"),
      answer("b", "answered", "2026-10-16T12:00:00Z", true),
      answer("c", "new open", "2026-10-16T11:00:00Z"),
      { ...answer("d", "", "2026-10-16T13:00:00Z"), body: undefined },
    ]);
    expect(list.map((a) => a.user_id)).toEqual(["c", "a", "b"]);
  });

  it("only the poster marks a response answered, only with their own story; deleting that story un-answers it", () => {
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS answered_post_id uuid REFERENCES public.community_posts(id) ON DELETE SET NULL");
    expect(sql).toContain("''answered_at'', CASE WHEN a.answered_post_id IS NOT NULL THEN a.answered_at END, ''answered_post_id'', a.answered_post_id");
    expect(sql).toContain("RAISE EXCEPTION 'community_sticker_json: answers anchor not found'");
    const mark = sql.slice(sql.indexOf("FUNCTION public.community_sticker_mark_answered"));
    expect(mark).toContain("p.id = _post_id AND p.author_user_id = v_me AND p.sticker->>'type' = 'question'");
    expect(mark).toContain("p.id = _reply_post_id AND p.author_user_id = v_me AND p.story_only AND p.archived_at IS NULL");
    expect(mark).toContain("WHERE post_id = _post_id AND user_id = _user_id AND body IS NOT NULL;");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.community_sticker_mark_answered(uuid, uuid, uuid) FROM PUBLIC, anon;");
  });

  it("each response has Answer on your story (Answered once it's done), and the sender is told only the poster knows it was them", () => {
    const sticker = read("src/components/community/story-sticker.tsx");
    expect(sticker).toContain('{answered ? "Answer again" : "Answer on your story"}');
    expect(sticker).toContain("data-sticker-answered");
    expect(sticker).toContain("Only ${first} sees who sent it");
    // a coach viewing as a client can't answer as the poster
    expect(sticker).toContain("if (blocked()) return;\n                  setSheet(false);\n                  onReply(a);");
  });

  it("the story camera opens on a backdrop with the response card and the keyboard up, and posting marks it answered", () => {
    const stories = read("src/components/community/crew-stories.tsx");
    expect(stories).toContain("window.setTimeout(() => openStoryReply(r), 240);");
    expect(read("src/components/community/community-screen.tsx")).toContain("{!previewOnly && <StoryReplyHost />}");
    const studio = read("src/components/community/share-studio.tsx");
    expect(studio).toContain('const shooting = open && phase === "shoot" && !reply;');
    expect(studio).toContain("freeze({ src: paintReplyBackdrop(0), file: null, live: false, at: new Date() });\n      setItems([responseCardItem(reply.question, reply.answer)]);\n      setRequest({ kind: \"text\", n: Date.now() });");
    expect(studio).toContain("await reply.onPosted(id);");
    // a reply never reopens on an old draft (its card would be lost)
    expect(studio).toContain("if (!open || !post || reply || restoredFor.current === post.key) return;");
    expect(read("src/components/community/story-reply-host.tsx")).toContain("await markStickerAnswered(qc, { postId: reply.postId, userId: reply.userId, replyPostId: id });");
    // the card: the question and what was sent, never who sent it
    const layer = read("src/components/community/sticker-layer.tsx");
    expect(layer).toContain("function responseCard(question: string, answer: string): Bitmap {");
  });

  it("anyone posting a story can put Questions, Poll or Slider on it from the sticker tray", () => {
    const layer = read("src/components/community/sticker-layer.tsx");
    expect(layer).toContain('{ type: "question", label: "Questions", icon: "❓" },');
    expect(layer).toContain("data-tray-interactive");
    const studio = read("src/components/community/share-studio.tsx");
    expect(studio).toContain("interactive={story && shot ? { onPick: (type) => setLiveForm(live?.type === type ? live : blankSticker(type)) } : undefined}");
    expect(studio).toContain("await setPostSticker(id, live);");
    expect(studio).toContain("onMove(Math.min(STICKER_Y_MAX, Math.max(STICKER_Y_MIN, d.at0 + dy / height)));");
  });
});
