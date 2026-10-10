import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VIEW_DWELL_MS, VIEW_VISIBLE } from "@/components/community/post-views";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const sql = read("supabase/migrations/20261029090000_community_post_views.sql");
const ui = read("src/components/community/post-views.tsx");

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
  it("who viewed is the author's alone: the feed carries views only on your own posts; the list refuses anyone else", () => {
    expect(sql).toContain("'views', CASE WHEN n.author_user_id = public.community_main_account(_viewer) THEN public.community_post_views_summary(n.id) END,");
    expect(sql).toContain("IF NOT EXISTS (SELECT 1 FROM public.community_posts p WHERE p.id = _post_id AND p.author_user_id = v_me) THEN");
    expect(sql).toContain("ALTER TABLE public.community_post_views ENABLE ROW LEVEL SECURITY;");
    expect(ui).toContain("if (!post.is_mine || !v || v.count <= 0) return null;");
  });
  it("you can view privately: still counted, never named", () => {
    expect(sql).toContain("AND NOT coalesce(cp.private_views, false)");
    expect(ui).toContain("View posts privately");
  });
});
