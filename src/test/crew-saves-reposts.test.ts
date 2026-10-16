import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  REPOST_NOTE_MAX,
  cleanRepostNote,
  fitRepostNoteDraft,
  noteLineCount,
  REPOST_NOTE_MAX_LINES,
  floatingNote,
  inFollowingFeed,
  isEmojiOnly,
  nextFeedCursor,
  repostedLine,
  showRepostButton,
  type CommunityPost,
  type Reposter,
} from "@/lib/community";
import { profileTabs } from "@/components/community/profile-view";
import { activityBubbleCounts, activityLine } from "@/lib/crew-activity";
import { communityNoticeText, type CommunityNotice } from "@/lib/community-notifications";
import { communityPushCopy, type ClaimedPush } from "@/lib/push/community-push.server";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const sql = read("supabase/migrations/20261207090000_crew_saves_reposts.sql");
const who = (user_id: string, name: string, note: string | null = null, is_me = false): Reposter => ({ user_id, name, avatar_url: null, is_coach: false, note, at: "2026-10-16T00:00:00Z", is_me });
const author = { user_id: "kayla", name: "Kayla", avatar_url: null, is_coach: false };

describe("a repost's note", () => {
  it("keeps its line breaks, trimmed, at most 6 lines and 60 characters (the database does the same)", () => {
    expect(REPOST_NOTE_MAX).toBe(60);
    expect(REPOST_NOTE_MAX_LINES).toBe(6);
    // the same cases were run through community_repost_note_clean on the database (Oct 16)
    expect(cleanRepostNote("  🔥🔥   this one \n ")).toBe("🔥🔥 this one");
    expect(cleanRepostNote("   \n\n  ")).toBeNull();
    expect(cleanRepostNote(null)).toBeNull();
    expect(cleanRepostNote("x".repeat(80))).toBe("x".repeat(60));
    expect(cleanRepostNote("\n\nfirst  line\r\n\nthird\n\n")).toBe("first line\n\nthird");
    expect(cleanRepostNote("a\nb\nc\nd\ne\nf\ng")).toBe("a\nb\nc\nd\ne\nf g");
    expect(cleanRepostNote(`${"y".repeat(59)}\nz`)).toBe("y".repeat(59));
    expect(cleanRepostNote("💪".repeat(70))).toBe("💪".repeat(60));
    expect(noteLineCount("a\n\nb")).toBe(3);
    expect(noteLineCount("")).toBe(1);
    const lines = read("supabase/migrations/20261211090000_repost_note_lines.sql");
    expect(lines).toContain("CREATE OR REPLACE FUNCTION public.community_repost_note_clean(_note text)");
    expect(lines).toContain("IF v_n > 6 THEN");
    expect(lines).toContain("left(array_to_string(v_lines, E'\\n'), 60)");
    expect(sql).toContain("CONSTRAINT community_reposts_note_len CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 60)");
  });

  it("while you write it: Return stops at 6 lines, a pasted 7th joins the 6th, and it stops at 60 characters", () => {
    const six = "a\nb\nc\nd\ne\nf";
    expect(fitRepostNoteDraft(six, `${six}\n`)).toBe(six);
    expect(fitRepostNoteDraft("a", "a\nb\nc\nd\ne\nf\ng\nh")).toBe("a\nb\nc\nd\ne\nf g h");
    expect(fitRepostNoteDraft("", "line\r\nnext")).toBe("line\nnext");
    expect(fitRepostNoteDraft("x".repeat(60), `${"x".repeat(60)}y`)).toBe("x".repeat(60));
    expect([...fitRepostNoteDraft("", "🔥".repeat(61))].length).toBe(60);
    // spaces and blank lines stay while typing (they're tidied when it's saved)
    expect(fitRepostNoteDraft("hi", "hi \n\n")).toBe("hi \n\n");
  });

  it("is written Instagram's way: full screen, typed straight into the bubble, pinned above the keyboard, asks before throwing it away", () => {
    const ed = read("src/components/community/repost-note-editor.tsx");
    const card = read("src/components/community/repost-save.tsx");
    expect(ed).toContain("useVisualViewportBox(true)");
    expect(ed).toContain("style={{ top: keyboard ? view!.top : 0, height: keyboard ? view!.height : \"100%\" }}");
    expect(ed).toContain("fitRepostNoteDraft(text, e.target.value)");
    expect(ed).toContain('enterKeyHint="enter"');
    expect(ed).toContain("Discard note?");
    expect(ed).toContain("Keep editing");
    expect(ed).toContain("const dirty = cleanRepostNote(text) !== cleanRepostNote(saved);");
    // the phone-wide 16px text-box rule must not make the box wrap unlike its sizing copy
    expect(ed).toContain('style={{ font: "inherit", letterSpacing: "inherit" }}');
    expect(ed).not.toContain("<input");
    expect(card).not.toContain("RepostNoteSheet");
    expect(card).toContain("<RepostNoteEditor post={post} onClose={() => setEditing(false)} preview={opts.preview ?? null} />");
    // the stamp shows its lines
    expect(card).toContain("line-clamp-6 whitespace-pre-line break-words");
  });

  it("shows big when it's only emoji, like Instagram's notes", () => {
    expect(isEmojiOnly("🔥🔥🔥")).toBe(true);
    expect(isEmojiOnly("💪")).toBe(true);
    expect(isEmojiOnly("🔥 nice")).toBe(false);
    expect(isEmojiOnly("🔥🔥🔥🔥")).toBe(false);
    expect(isEmojiOnly("")).toBe(false);
  });

  it("the first reposter (in feed order) who wrote one floats on the post", () => {
    expect(floatingNote({ reposted_by: [who("dwayne", "Dwayne"), who("marc", "Marc", "🔥")] })?.name).toBe("Marc");
    expect(floatingNote({ reposted_by: [who("dwayne", "Dwayne")] })).toBeNull();
    expect(floatingNote({ reposted_by: null })).toBeNull();
    // yours shows from my_repost, never as someone else's
    expect(floatingNote({ reposted_by: [who("me", "Jared", "mine", true), who("marc", "Marc", "🔥")] })?.name).toBe("Marc");
  });
});

describe("who reposted it", () => {
  it("reads like Instagram, you as 'You'", () => {
    expect(repostedLine({ reposted_by: [who("v", "Vicky")], reposters_count: 1 })).toBe("Vicky reposted");
    expect(repostedLine({ reposted_by: [who("v", "Vicky"), who("d", "Dwayne")], reposters_count: 2 })).toBe("Vicky and Dwayne reposted");
    expect(repostedLine({ reposted_by: [who("v", "Vicky"), who("d", "Dwayne"), who("m", "Marc")], reposters_count: 4 })).toBe("Vicky and 3 others reposted");
    expect(repostedLine({ reposted_by: [who("me", "Jared", null, true)], reposters_count: 1 })).toBe("You reposted");
    expect(repostedLine({ reposted_by: [], reposters_count: 0 })).toBeNull();
  });

  it("the button only where you can repost (or take yours back)", () => {
    expect(showRepostButton({ can_repost: true, my_repost: null })).toBe(true);
    expect(showRepostButton({ can_repost: false, my_repost: { note: null, at: "x" } })).toBe(true);
    expect(showRepostButton({ can_repost: false, my_repost: null })).toBe(false);
  });

  it("Following includes what the people you follow reposted", () => {
    const base = { is_mine: false, author, collaborators: [], reposted_by: null, my_repost: null };
    const follows = new Set(["marc"]);
    expect(inFollowingFeed(base, follows)).toBe(false);
    expect(inFollowingFeed({ ...base, reposted_by: [who("marc", "Marc")] }, follows)).toBe(true);
    expect(inFollowingFeed({ ...base, my_repost: { note: null, at: "x" } }, follows)).toBe(true);
    expect(inFollowingFeed({ ...base, author: { ...author, user_id: "marc" } }, follows)).toBe(true);
  });

  it("the feed pages by where a post sits (a repost moves it up), not when it was posted", () => {
    const post = { id: "p1", created_at: "2026-10-13T17:00:00Z", feed_at: "2026-10-16T03:37:05Z" } as CommunityPost;
    expect(nextFeedCursor({ posts: [post], has_more: true })).toEqual({ at: "2026-10-16T03:37:05Z", id: "p1" });
    expect(nextFeedCursor({ posts: [{ ...post, feed_at: undefined }], has_more: true })).toEqual({ at: "2026-10-13T17:00:00Z", id: "p1" });
  });
});

describe("the database: private saves, albums, reposts", () => {
  it("everything goes through the RPCs: the tables are closed to clients", () => {
    for (const t of ["community_saves", "community_save_albums", "community_save_album_posts", "community_reposts"]) {
      expect(sql).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
      expect(sql).toContain(`REVOKE ALL ON public.${t} FROM anon, authenticated;`);
    }
    for (const fn of ["community_save(uuid, boolean, uuid)", "community_album_posts(uuid, uuid[], boolean)", "community_album_create(text, uuid[])", "community_repost(uuid, boolean, text, boolean)", "community_user_reposts(uuid, integer, timestamptz, uuid)", "community_saved_posts(uuid, integer, timestamptz, uuid)"]) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC, anon;`);
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.${fn} TO authenticated;`);
    }
  });

  it("an album only holds saved posts: unsaving takes it out of every album, and Undo learns which", () => {
    expect(sql).toContain("FOREIGN KEY (user_id, post_id) REFERENCES public.community_saves (user_id, post_id) ON DELETE CASCADE");
    expect(sql).toContain("RETURN jsonb_build_object('saved', false, 'albums', '[]'::jsonb, 'removed_from', v_was);");
    // putting a post in an album saves it
    expect(sql).toContain("INSERT INTO public.community_saves (user_id, post_id) VALUES (v_me, v_id) ON CONFLICT DO NOTHING;");
  });

  it("only crew-wide posts can be reposted: never yours, never an automatic story", () => {
    expect(sql).toContain("THEN 'That''s already on your profile'");
    expect(sql).toContain("WHEN coalesce(p.auto_shared, false) THEN 'Automatic workout stories can''t be reposted'");
    expect(sql).toContain("WHEN p.visibility <> 'community' THEN 'Only posts shared with the whole crew can be reposted'");
  });

  it("in the feed a post moves up to its latest repost you may see: private accounts only for followers, never across a block", () => {
    expect(sql).toContain("AND (r.user_id = v_me OR v_staff OR NOT coalesce(cp.is_private, false) OR r.user_id IN (SELECT id FROM followed))");
    expect(sql).toContain("AND NOT public.chat_has_blocked(rp.author_user_id, r.user_id)");
    expect(sql).toContain("SELECT p.id, greatest(p.created_at, coalesce(b.at, p.created_at)) AS at FROM public.community_posts p");
    // a profile's own grid stays in posting order
    expect(sql).toContain("WHERE _author_user_id IS NULL");
  });

  it("the author hears about it like a like; the post JSON gains its fields without passing 100 arguments", () => {
    expect(sql).toContain("'follow_request'::text, 'repost'::text]");
    expect(sql).toContain("PERFORM public.community_notify(v_author, NEW.user_id, 'repost', NEW.post_id, NULL, NULL);");
    expect(sql).toContain("(A second object: the first is at jsonb_build_object's 100-argument limit.)");
    expect(sql).toContain("'  || jsonb_build_object(' || E'\\n    '");
  });
});

describe("the account's side", () => {
  it("profile tabs: Saved only on yours, Reposts once there are some, Archived while it has something", () => {
    expect(profileTabs({ isMe: true, reposts: 0, archived: 0, current: "posts", blocked: false }).map((t) => t.key)).toEqual(["posts", "reposts", "saved"]);
    expect(profileTabs({ isMe: false, reposts: 0, archived: 0, current: "posts", blocked: false }).map((t) => t.key)).toEqual(["posts"]);
    expect(profileTabs({ isMe: false, reposts: 2, archived: 0, current: "posts", blocked: false }).map((t) => t.key)).toEqual(["posts", "reposts"]);
    expect(profileTabs({ isMe: true, reposts: 0, archived: 3, current: "posts", blocked: false }).map((t) => t.key)).toEqual(["posts", "reposts", "saved", "archived"]);
    expect(profileTabs({ isMe: false, reposts: 5, archived: 0, current: "posts", blocked: true }).map((t) => t.key)).toEqual(["posts"]);
  });

  it("Activity, the bubble and the lockscreen say who reposted (the note only in the app)", () => {
    const n = { key: "p:1", kind: "repost", anchor: "1", post_id: "1", comment_id: null, count: 3, at: "2026-10-16T00:00:00Z", actors: [{ ...author, name: "Vicky" }, { ...author, name: "Marc" }], emojis: [], snippet: "🔥🔥", media_type: null, post_kind: "post" } as CommunityNotice;
    expect(activityLine(n)).toEqual({ names: ["Vicky", "Marc"], others: 1, action: "reposted your post:", quote: "🔥🔥" });
    expect(communityNoticeText(n).title).toBe("Vicky and 2 others reposted your post");
    expect(activityBubbleCounts([{ kind: "repost", unread: true, fresh: 2 }]).reposts).toBe(2);
    const push = { id: "x", recipient: "r", kind: "repost", post_id: "1", comment_id: null, emoji: null, actor_name: "Vicky", actor_is_staff: false, others: 0, media_type: null, post_kind: "workout" } as ClaimedPush;
    expect(communityPushCopy(push)).toEqual({ title: "Vicky reposted your workout", body: "Tap to see it." });
  });

  it("the row is Instagram's, and saving says it's private the first time", () => {
    const card = read("src/components/community/post-card.tsx");
    expect(card).toContain("<RepostButton post={post} onReposted={onReposted} />");
    expect(card).toContain("<SaveButton post={post} />");
    expect(card).toContain("<RepostedHeader post={post} onOpenAuthor={onOpenAuthor} />");
    const rs = read("src/components/community/repost-save.tsx");
    expect(rs).toContain('description: first ? "Only you can see what you save. Find it on your profile." : undefined');
    // sheets with a text box sit on the iPhone keyboard
    expect(rs).toContain('const KEYBOARD_SAFE = { bottom: "var(--keyboard-inset, 0px)" } as const;');
    // never reload the feed under you after a repost (the post would jump)
    expect(read("src/lib/community-saves.ts")).toContain('void qc.invalidateQueries({ queryKey: ["community-user-reposts"] });');
  });
});
