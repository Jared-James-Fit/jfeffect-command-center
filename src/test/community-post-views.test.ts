import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VIEW_DWELL_MS, VIEW_VISIBLE } from "@/components/community/post-views";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const sql = read("supabase/migrations/20261029090000_community_post_views.sql");
const ui = read("src/components/community/post-views.tsx");
const everywhere = read("supabase/migrations/20261030120000_community_views_everywhere.sql");

describe("post views", () => {
  it("a view = half the post on screen for two seconds, or opening it", () => {
    expect(VIEW_VISIBLE).toBe(0.5);
    expect(VIEW_DWELL_MS).toBe(2000);
    expect(read("src/components/community/post-card.tsx")).toContain("usePostViewTracker(articleRef, post);");
    expect(read("src/components/community/community-entry.tsx")).toContain("usePostViewTracker(ref, post);");
    expect(read("src/components/community/post-detail.tsx")).toContain("useViewOnOpen(post);");
  });
  it("one per person per post (a coach's two logins are one person); never your own; only posts you can see", () => {
    expect(sql).toContain("PRIMARY KEY (post_id, viewer_user_id)");
    expect(sql).toContain("ON CONFLICT (post_id, viewer_user_id) DO NOTHING;");
    expect(sql).toContain("v_me := public.community_main_account(uid);");
    expect(sql).toContain("AND p.author_user_id IS DISTINCT FROM v_me");
    expect(sql).toContain("AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id)");
  });
  it("a coach viewing as a client never counts, and nothing is sent twice in a session", () => {
    expect(ui).toContain("const skip = post.is_mine || isImpersonating;");
    expect(ui).toContain("if (sent.has(postId)) return;");
  });
  it("every post shows its count; who viewed (faces, the list) is the author's alone", () => {
    expect(everywhere).toContain("ELSE jsonb_build_object('count', (SELECT count(*) FROM public.community_post_views v WHERE v.post_id = n.id), 'faces', '[]'::jsonb) END,");
    expect(sql).toContain("IF NOT EXISTS (SELECT 1 FROM public.community_posts p WHERE p.id = _post_id AND p.author_user_id = v_me) THEN");
    expect(sql).toContain("ALTER TABLE public.community_post_views ENABLE ROW LEVEL SECURITY;");
    expect(ui).toContain("if (!v || v.count <= 0) return null;");
    expect(ui).toContain("// someone else's post: just the number");
  });
  it("older posts: only people who certainly saw them (reacted, commented, liked a comment, voted), never the author", () => {
    expect(everywhere).toContain("FROM public.community_poll_votes v");
    expect(everywhere).toContain("WHERE x.viewer IS NOT NULL AND x.viewer IS DISTINCT FROM p.author_user_id");
  });
  it("you can view privately: still counted, never named", () => {
    expect(sql).toContain("AND NOT coalesce(cp.private_views, false)");
    expect(ui).toContain("View posts privately");
  });
});
