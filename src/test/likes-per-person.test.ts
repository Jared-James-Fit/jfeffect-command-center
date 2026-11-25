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
