import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// A like belongs to the person, never the login (Nov 25 2026): a coach's staff
// login and own athlete login liked the same post, and the Likes list named
// "You @jared" twice.
const sql = readFileSync("supabase/migrations/20270527090000_likes_belong_to_the_person.sql", "utf8");
const queries = readFileSync("src/lib/community.queries.ts", "utf8");

describe("likes belong to the person", () => {
  it("stores every post and comment like under the person, whatever wrote it", () => {
    expect(sql).toMatch(/NEW\.user_id := public\.community_main_account\(NEW\.user_id\)/);
    expect(sql).toMatch(/BEFORE INSERT OR UPDATE OF user_id ON public\.community_reactions/);
    expect(sql).toMatch(/BEFORE INSERT OR UPDATE OF user_id ON public\.community_comment_likes/);
  });

  it("merges linked logins' likes into the person, backed up, keeping the earlier like and its notification", () => {
    expect(sql).toMatch(/INSERT INTO public\.community_likes_person_backup/);
    expect(sql).toMatch(/least\(m\.created_at, d\.created_at\)/);
    expect(sql).toMatch(/set_config\('jf\.likes_merging', 'on', true\)/);
    expect(sql.match(/current_setting\('jf\.likes_merging', true\) = 'on' THEN RETURN NULL/g)?.length).toBe(2);
    // a login linked later is moved the moment it's linked
    expect(sql).toMatch(/AFTER INSERT OR UPDATE OF same_person_as ON public\.community_profiles/);
  });

  it("likes and unlikes as the person, as a state (never a toggle)", () => {
    expect(sql).toMatch(/me uuid := public\.community_main_account\(auth\.uid\(\)\)/);
    expect(sql).toMatch(/VALUES \(_post_id, me, v\)\s+ON CONFLICT \(post_id, user_id\)/);
    expect(sql).toMatch(/VALUES \(c\.id, c\.post_id, me\) ON CONFLICT DO NOTHING/);
  });

  it("'did I like this' reads the person, like the count and the Likes list", () => {
    expect(sql).toMatch(/'my_reaction', \(SELECT r\.emoji FROM public\.community_reactions r WHERE r\.post_id = n\.id AND r\.user_id = public\.community_main_account\(_viewer\)\)/);
    expect(sql).toMatch(/'liked', EXISTS \(SELECT 1 FROM public\.community_comment_likes l WHERE l\.comment_id = c\.id AND l\.user_id = public\.community_main_account\(_viewer\)\)/);
  });

  it("sends one post's likes to the server in tap order", () => {
    expect(queries).toContain("scope: { id: `community-react:${post.id}` }");
    expect(queries).toContain("scope: { id: `community-like-comment:${postId}` }");
  });
});

// Your own post's Activity lists your own like (Nov 25 2026): it left the
// poster out entirely, so "Likes 4" listed three people.
describe("Activity shows your own like", () => {
  const activity = readFileSync("supabase/migrations/20270528090000_activity_shows_your_own_like.sql", "utf8");
  it("puts you in the list exactly when you reacted, as one person per row", () => {
    expect(activity).toMatch(/WHERE u\.user_id IS DISTINCT FROM v_me\s+UNION\s+SELECT r\.user_id FROM r WHERE r\.user_id = v_me/);
    expect(activity).toMatch(/'is_me', CASE WHEN pe\.user_id = v_me THEN true END/);
    expect(activity).toMatch(/public\.community_main_account\(v\.viewer_user_id\) AS user_id/);
    expect(activity).toMatch(/public\.community_main_account\(r\.user_id\) AS user_id/);
    expect(activity).toMatch(/'likes', \(SELECT count\(\*\) FROM r\)/);
  });
  it("names you as you, with no Follow button, and refreshes after a like", async () => {
    const { activityNote } = await import("@/lib/community");
    expect(activityNote({ user_id: "a", name: "Jared", avatar_url: null, is_coach: true, username: "jared", reaction: "heart", is_me: true })).toBe("@jared · You");
    expect(readFileSync("src/components/community/post-activity.tsx", "utf8")).toContain("{follow && !p.is_me && <FollowIfNot p={p} />}");
    expect(queries).toContain('queryKey: ["community-post-activity", post.id]');
  });
});
