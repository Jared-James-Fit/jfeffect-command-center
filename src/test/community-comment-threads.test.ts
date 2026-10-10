import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { likesLabel, threadComments, type CommunityComment } from "@/lib/community";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const sql = read("supabase/migrations/20261019090000_community_comment_threads.sql");
const sheet = read("src/components/community/comments-sheet.tsx");
const queries = read("src/lib/community.queries.ts");
const card = read("src/components/community/post-card.tsx");
const screen = read("src/components/community/community-screen.tsx");

/** The body of one SQL function in the migration. */
function fn(name: string): string {
  const start = sql.indexOf(`FUNCTION public.${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  return sql.slice(start, sql.indexOf("$$;", start));
}

const author = { user_id: "u", name: "Fionna", avatar_url: null, is_coach: false };
const c = (id: string, parent_id: string | null = null): CommunityComment => ({ id, parent_id, body: id, created_at: "2026-10-09T12:00:00Z", author, can_delete: false });

describe("comment threads", () => {
  it("puts replies under the comment they belong to, in order", () => {
    const t = threadComments([c("a"), c("b"), c("a1", "a"), c("b1", "b"), c("a2", "a")]);
    expect(t.map((x) => x.comment.id)).toEqual(["a", "b"]);
    expect(t[0].replies.map((r) => r.id)).toEqual(["a1", "a2"]);
    expect(t[1].replies.map((r) => r.id)).toEqual(["b1"]);
  });

  it("drops replies whose comment isn't in the list (hidden / deleted)", () => {
    expect(threadComments([c("a"), c("x1", "x")]).flatMap((t) => [t.comment.id, ...t.replies.map((r) => r.id)])).toEqual(["a"]);
  });

  it("labels likes", () => {
    expect(likesLabel(0)).toBeNull();
    expect(likesLabel(undefined)).toBeNull();
    expect(likesLabel(1)).toBe("1 like");
    expect(likesLabel(12)).toBe("12 likes");
  });
});

describe("who can do what (server)", () => {
  it("delete: the writer, the post's owner and staff; anyone else is refused", () => {
    const del = fn("community_delete_comment");
    expect(del).toMatch(/community_main_account\(c\.author_user_id\) = v_me/);
    expect(del).toMatch(/is_community_staff\(\)/);
    expect(del).toMatch(/p\.author_user_id = v_me/);
    expect(del).toMatch(/You can only delete your own comments/);
  });

  it("hide: the post's owner and staff, never on their own comment", () => {
    const hide = fn("community_hide_comment");
    expect(hide).toMatch(/community_main_account\(c\.author_user_id\) <> v_me/);
    expect(hide).toMatch(/is_community_staff\(\)/);
    expect(hide).toMatch(/p\.author_user_id = v_me/);
  });

  it("a hidden comment still shows to its writer, the post's owner and staff, and only they're told it's hidden", () => {
    const readable = fn("community_comment_readable");
    expect(readable).toMatch(/_hidden_at IS NULL/);
    expect(readable).toMatch(/community_main_account\(_author\) = public\.community_main_account\(auth\.uid\(\)\)/);
    const json = fn("community_comment_json");
    expect(json).toMatch(/'hidden', c\.hidden_at IS NOT NULL AND \(_owner = public\.community_main_account\(_viewer\) OR _staff\)/);
    // the table itself never exposes when / who hid it
    const grant = sql.slice(sql.indexOf("GRANT SELECT ("), sql.indexOf("ON public.community_comments TO authenticated"));
    expect(grant).not.toMatch(/hidden_at|hidden_by/);
  });

  it("share: once per person per comment, community posts only, never a hidden comment", () => {
    const share = fn("community_share_comment");
    expect(share).toMatch(/c\.hidden_at IS NOT NULL/);
    expect(share).toMatch(/visibility = 'community'/);
    expect(share).toMatch(/shared_comment_id = c\.id/);
    expect(sql).toMatch(/community_posts_one_share_each/);
    expect(sql).toMatch(/shared_comment_id uuid REFERENCES public\.community_comments\(id\) ON DELETE CASCADE/);
  });

  it("replies are one level deep and media must be the commenter's own upload", () => {
    const add = fn("community_add_comment");
    expect(add).toMatch(/v_top := coalesce\(v_parent\.parent_id, v_parent\.id\)/);
    expect(add).toMatch(/split_part\(v_path, '\/', 1\) <> uid::text/);
    expect(add).toMatch(/'image', 'video'/);
  });

  it("comments and comment likes stream live", () => {
    expect(sql).toMatch(/ADD TABLE public\.community_comments;/);
    expect(sql).toMatch(/ADD TABLE public\.community_comment_likes;/);
  });
});

describe("comments UI", () => {
  it("the hold menu only offers what the server allows", () => {
    expect(sheet).toMatch(/c\.can_share && <MenuRow icon=\{Share2\}/);
    expect(sheet).toMatch(/c\.can_hide && \(/);
    expect(sheet).toMatch(/c\.can_delete && <MenuRow icon=\{Trash2\}/);
    // no always-visible trash button on other people's comments any more
    expect(sheet).not.toMatch(/aria-label="Delete comment"/);
  });

  it("holding a comment opens its options (touch, mouse, keyboard)", () => {
    expect(sheet).toMatch(/const HOLD_MS = 450/);
    expect(sheet).toMatch(/onContextMenu/);
    expect(sheet).toMatch(/WebkitTouchCallout: "none"/);
  });

  it("listens live on both tables, deletes unfiltered, and pings after a hide", () => {
    expect(queries).toMatch(/table: "community_comments", filter: `post_id=eq\.\$\{postId\}`/);
    expect(queries).toMatch(/event: "DELETE", schema: "public", table: "community_comments" \}/);
    expect(queries).toMatch(/table: "community_comment_likes", filter: `post_id=eq\.\$\{postId\}`/);
    expect(queries).toMatch(/\.on\("broadcast", \{ event: "sync" \}/);
    expect(sheet).toMatch(/\.then\(\(\) => \{\s*sync\(\);/);
  });

  it("shares and hides never send a push; a like only goes through crew activity (grouped, rate limited)", () => {
    for (const hook of ["useShareComment", "useHideComment"]) {
      const start = queries.indexOf(`export function ${hook}(`);
      const body = queries.slice(start, queries.indexOf("\nexport ", start + 10));
      expect(body, hook).not.toMatch(/fireAppEvent/);
    }
    const start = queries.indexOf("export function useLikeComment(");
    const like = queries.slice(start, queries.indexOf("\nexport ", start + 10));
    expect(like).toContain('if (liked) fireAppEvent("community_activity", id);');
    expect(like).not.toContain("community_coach_recognition");
  });

  it("a shared comment shows on its post and opens the original", () => {
    expect(card).toMatch(/post\.shared_comment\) return <SharedCommentCard/);
    expect(screen).toMatch(/window\.addEventListener\(OPEN_POST_EVENT/);
  });
});
