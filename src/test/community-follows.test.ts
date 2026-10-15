import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyFollow, isPartner, suggestAthletes } from "@/lib/community-social";
import { AUDIENCES, storyWorthy } from "@/lib/community";
import { crewStories } from "@/lib/community";
import { shouldPersistQueryKey } from "@/lib/query-persister";
import { communityNoticeText, type CommunityNotice } from "@/lib/community-notifications";
import type { CommunityMember } from "@/lib/community";

const member = (id: string, extra: Partial<CommunityMember> = {}): CommunityMember =>
  ({ author: { user_id: id, name: id, avatar_url: null, is_coach: false }, week_days: [], trained_at: null, ...extra }) as CommunityMember;

describe("follow", () => {
  it("follows to the front and unfollows cleanly, never duplicating", () => {
    const s = { following: ["a", "b"], followers: ["c"], partners: [] as string[] };
    expect(applyFollow(s, "b", true).following).toEqual(["b", "a"]);
    expect(applyFollow(s, "a", false).following).toEqual(["b"]);
    expect(applyFollow(s, "z", false)).toEqual({ following: ["a", "b"], followers: ["c"], partners: [] });
    expect(applyFollow(s, "a", true).followers).toEqual(["c"]);
  });

  it("suggests people you don't follow: your followers first, then who's training", () => {
    const members = [
      member("idle"),
      member("busy", { week_days: [1, 2, 3] as any, trained_at: "2026-10-12T10:00:00Z" }),
      member("fan"),
      member("followed", { week_days: [1, 2, 3, 4] as any }),
    ];
    const out = suggestAthletes(members, { following: ["followed"], followers: ["fan"], partners: [] }).map((m) => m.author.user_id);
    expect(out).toEqual(["fan", "busy", "idle"]);
    expect(suggestAthletes(members, undefined, 2)).toHaveLength(2);
  });
});

describe("training partners", () => {
  it("following someone who follows you makes you partners; unfollowing ends it", () => {
    const s = { following: [], followers: ["fan"], partners: [] as string[] };
    const on = applyFollow(s, "fan", true);
    expect(on.partners).toEqual(["fan"]);
    expect(isPartner(on, "fan")).toBe(true);
    expect(applyFollow(s, "stranger", true).partners).toEqual([]);
    expect(applyFollow(on, "fan", false).partners).toEqual([]);
    expect(isPartner(undefined, "fan")).toBe(false);
  });

  it("Partners is a post audience, shows in Stories, and is labelled on the post", () => {
    expect(AUDIENCES.map((a) => a.key)).toEqual(["community", "partners", "coach", "private"]);
    expect(storyWorthy({ visibility: "partners" })).toBe(true);
    expect(storyWorthy({ visibility: "coach" })).toBe(false);
    expect(readFileSync("src/components/community/post-card.tsx", "utf8")).toContain('post.visibility === "partners") parts.push(post.is_mine ? "Training partners" : "Training partners only")');
  });

  it("the database decides who's a partner, in one rule", () => {
    const sql = readFileSync("supabase/migrations/20261130090000_crew_training_partners.sql", "utf8");
    expect(sql).toContain("CHECK (visibility IN ('community', 'coach', 'partners', 'private'))");
    expect(sql).toContain("OR (_visibility = 'partners' AND public.can_view_community()");
    expect(sql).toContain("CASE WHEN v_partners THEN 'active' ELSE 'request' END");
    expect(sql).toContain("'partners', coalesce((SELECT jsonb_agg(x ORDER BY x) FROM public.community_partner_ids() x)");
  });
});

describe("Crew Stories order", () => {
  it("new first; among new, people you follow; then the most recent", () => {
    const now = Date.UTC(2026, 9, 13, 20);
    const post = (id: string, who: string, h: number, seen = false) =>
      ({ id, created_at: new Date(now - h * 3600e3).toISOString(), auto: false, stats: null, visibility: "community", is_mine: false, seen, author: { user_id: who, name: who, avatar_url: null, is_coach: false } }) as any;
    const posts = [post("a", "ann", 1), post("b", "bob", 3), post("c", "cat", 2, true)];
    expect(crewStories(posts, now).map((g) => g.author.user_id)).toEqual(["ann", "bob", "cat"]);
    expect(crewStories(posts, now, new Set(["bob"])).map((g) => g.author.user_id)).toEqual(["bob", "ann", "cat"]);
    expect(readFileSync("src/components/community/crew-stories.tsx", "utf8")).toContain("crewStories(posts, Date.now(), new Set(follows?.following ?? []))");
  });
});

describe("saved query copies", () => {
  it("keeps per-person follow state in memory only", () => {
    expect(shouldPersistQueryKey(["community-follows"])).toBe(false);
  });
});

describe("follow notices", () => {
  it("say who followed you and carry no post", () => {
    const n: CommunityNotice = { key: "f:x", kind: "follow", anchor: "x", post_id: null, comment_id: null, count: 1, at: "2026-10-13T10:00:00Z", actors: [{ user_id: "x", name: "Vicky", avatar_url: null, is_coach: false }], emojis: [], snippet: null, media_type: null, post_kind: "post" };
    expect(communityNoticeText(n).title).toBe("Vicky started following you");
    const bell = readFileSync("src/components/notification-bell.tsx", "utf8");
    expect(bell).toContain("personId: n.anchor");
    expect(bell).toContain("`person=${it.personId}`");
    expect(bell).toContain("openCommunityPerson(it.personId!)");
  });
});

describe("crew screen wiring", () => {
  const screen = readFileSync("src/components/community/community-screen.tsx", "utf8");
  const post = readFileSync("src/components/community/post-card.tsx", "utf8");
  const sql = readFileSync("supabase/migrations/20261122090000_community_follows.sql", "utf8");

  it("full-width posts on phones, with Following as a filter (never a gate) and suggestions in the feed", () => {
    expect(screen).toContain("<SuggestedAthletes");
    expect(screen).toContain('aria-label="Show posts from"');
    expect(screen).toContain("OPEN_PERSON_EVENT");
    expect(post).toMatch(/-mx-3 overflow-hidden border-b[^"]*sm:rounded-3xl/);
  });

  it("keeps follows private: no table access, only the functions", () => {
    expect(sql).toMatch(/REVOKE ALL ON public\.community_follows FROM anon, authenticated/);
    expect(sql).not.toMatch(/CREATE POLICY/);
    expect(sql).toContain("IF v_rows > 0 AND NOT EXISTS");
  });

  it("puts Follow on profiles, members and suggestions", () => {
    expect(readFileSync("src/components/community/profile-view.tsx", "utf8")).toContain("<FollowButton");
    expect(readFileSync("src/components/community/crew-list.tsx", "utf8")).toContain("<FollowButton");
    expect(readFileSync("src/components/community/suggested-athletes.tsx", "utf8")).toContain("Only you see who you follow");
  });
});

describe("posting reliability", () => {
  const queries = readFileSync("src/lib/community.queries.ts", "utf8");
  const studio = readFileSync("src/components/community/share-studio.tsx", "utf8");
  const upload = readFileSync("src/lib/lift-video-storage-upload.ts", "utf8");

  it("a GIF / voice memo that misses never undoes a saved post's photos", () => {
    expect(queries).toContain("class PostedButAttachFailed");
    // member posts (Post mode) too
    expect(queries).toContain("throw new PostedButAttachFailed((e as any)?.message);");
    expect(queries.indexOf("if (attachError) throw attachError")).toBeGreaterThan(queries.indexOf("removeCommunityFiles(gone)"));
    expect(studio).toMatch(/if \(e\?\.posted\) \{\s*\/\/[^\n]*\n\s*tray\.commit\(\);\s*void clearDraft\(\);/);
  });

  it("editing without a new photo keeps the post's cover", () => {
    expect(studio).toContain("if (!shot && post?.hasCover) return null;");
    expect(readFileSync("src/components/community/use-workout-studio.ts", "utf8")).toContain("target && existing !== undefined && built");
  });

  it("the camera comes back after switching apps, and a tap while it starts does nothing", () => {
    expect(studio).toContain('document.addEventListener("visibilitychange", wake)');
    expect(studio).toContain('if (status === "starting") return;');
  });

  it("direct uploads retry a dropped connection", () => {
    expect(upload).toContain("uploadDirectWithRetry");
    expect(upload).toContain("RetryableUploadError");
  });
});
