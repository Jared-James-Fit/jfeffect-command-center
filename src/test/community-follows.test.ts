import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EMPTY_FOLLOW_STATE, applyFollow, followLabel, suggestAthletes } from "@/lib/community-social";
import { AUDIENCES, isCrewAudience, pickerAudience, postPointsHint, storyWorthy } from "@/lib/community";
import { activityLine, matchesActivityFilter } from "@/lib/crew-activity";
import { crewStories } from "@/lib/community";
import { shouldPersistQueryKey } from "@/lib/query-persister";
import { communityNoticeText, type CommunityNotice } from "@/lib/community-notifications";
import type { CommunityMember } from "@/lib/community";

const member = (id: string, extra: Partial<CommunityMember> = {}): CommunityMember =>
  ({ author: { user_id: id, name: id, avatar_url: null, is_coach: false }, week_days: [], trained_at: null, ...extra }) as CommunityMember;

describe("follow", () => {
  it("follows to the front and unfollows cleanly, never duplicating", () => {
    const s = { ...EMPTY_FOLLOW_STATE, following: ["a", "b"], followers: ["c"] };
    expect(applyFollow(s, "b", true).following).toEqual(["b", "a"]);
    expect(applyFollow(s, "a", false).following).toEqual(["b"]);
    expect(applyFollow(s, "z", false)).toEqual({ ...EMPTY_FOLLOW_STATE, following: ["a", "b"], followers: ["c"] });
    expect(applyFollow(s, "a", true).followers).toEqual(["c"]);
  });

  it("suggests people you don't follow: your followers first, then who's training", () => {
    const members = [
      member("idle"),
      member("busy", { week_days: [1, 2, 3] as any, trained_at: "2026-10-12T10:00:00Z" }),
      member("fan"),
      member("followed", { week_days: [1, 2, 3, 4] as any }),
    ];
    const out = suggestAthletes(members, { ...EMPTY_FOLLOW_STATE, following: ["followed"], followers: ["fan"] }).map((m) => m.author.user_id);
    expect(out).toEqual(["fan", "busy", "idle"]);
    expect(suggestAthletes(members, undefined, 2)).toHaveLength(2);
  });
});

describe("private accounts and Close Friends", () => {
  it("following a private account is a request until they confirm; unfollowing cancels it", () => {
    const s = { ...EMPTY_FOLLOW_STATE, followers: ["fan"] };
    const asked = applyFollow(s, "priv", true, true);
    expect(asked.requested).toEqual(["priv"]);
    expect(asked.following).toEqual([]);
    expect(followLabel(asked, "priv")).toBe("Requested");
    expect(applyFollow(asked, "priv", false).requested).toEqual([]);
    expect(followLabel(s, "fan")).toBe("Follow back");
    expect(followLabel(applyFollow(s, "pub", true), "pub")).toBe("Following");
  });

  it("a private account's crew posts ('followers') act like crew posts everywhere", () => {
    expect(AUDIENCES.map((a) => a.key)).toEqual(["community", "close_friends", "coach", "private"]);
    expect(pickerAudience("followers")).toBe("community");
    expect(pickerAudience(null)).toBe("community");
    expect(pickerAudience("close_friends")).toBe("close_friends");
    expect(isCrewAudience("followers")).toBe(true);
    expect(isCrewAudience("close_friends")).toBe(false);
    expect(storyWorthy({ visibility: "followers" })).toBe(true);
    expect(storyWorthy({ visibility: "close_friends" })).toBe(true);
    expect(storyWorthy({ visibility: "coach" })).toBe(false);
    const status = { points: 15, today_earned: false, week_count: 0, week_cap: 2 } as any;
    expect(postPointsHint(status, "followers", false)?.tone).toBe("earn");
    expect(postPointsHint(status, "close_friends", false)?.tone).toBe("muted");
  });

  it("Close Friends stories ring green while something in them is new", () => {
    const now = Date.UTC(2026, 9, 13, 20);
    const post = (id: string, who: string, visibility: string, seen = false) =>
      ({ id, created_at: new Date(now - 3600e3).toISOString(), auto: false, stats: null, visibility, is_mine: false, seen, author: { user_id: who, name: who, avatar_url: null, is_coach: false } }) as any;
    const g = crewStories([post("a", "ann", "close_friends"), post("b", "bob", "community"), post("c", "cat", "close_friends", true)], now);
    expect(Object.fromEntries(g.map((x) => [x.author.user_id, !!x.closeFriends]))).toEqual({ ann: true, bob: false, cat: false });
    expect(readFileSync("src/components/community/crew-stories.tsx", "utf8")).toContain('g.closeFriends ? "bg-emerald-500"');
  });

  it("follow requests show in Activity under Follows", () => {
    const n = { key: "q:x", kind: "follow_request", anchor: "x", post_id: null, comment_id: null, count: 1, at: "2026-10-13T10:00:00Z", actors: [{ user_id: "x", name: "Vicky", avatar_url: null, is_coach: false }], emojis: [], snippet: null, media_type: null, post_kind: "post" } as CommunityNotice;
    expect(communityNoticeText(n).title).toBe("Vicky requested to follow you");
    expect(activityLine(n).action).toBe("requested to follow you");
    expect(matchesActivityFilter(n, "follows")).toBe(true);
  });

  it("the database decides who sees what, in one rule", () => {
    const sql = readFileSync("supabase/migrations/20261130090000_crew_private_accounts_close_friends.sql", "utf8");
    expect(sql).toContain("CHECK (visibility IN ('community', 'followers', 'close_friends', 'coach', 'private'))");
    expect(sql).toContain("OR (_visibility = 'followers' AND public.can_view_community()");
    expect(sql).toContain("NOT coalesce(NEW.auto_shared, false) AND public.community_is_private(NEW.author_user_id)");
    expect(sql).toContain("CASE WHEN v_open THEN 'active' ELSE 'request' END");
  });

  it("a block ends access, Close Friends on a private account still needs the follow, coaches stay public", () => {
    const sql = readFileSync("supabase/migrations/20261130090000_crew_private_accounts_close_friends.sql", "utf8");
    // the account owner blocking you ends "follows" (reads only: unblocking gives it back)
    expect(sql).toContain("AND NOT public.chat_has_blocked(public.community_main_account(_followee), public.community_main_account(_follower))");
    expect(sql).toMatch(/AND \(public\.community_follows_user\(auth\.uid\(\), _author\)\s+OR \(NOT public\.community_is_private\(_author\)/);
    // a coach (or a coach's linked athlete login) can't turn private on, and their posts never go followers-only
    expect(sql).toContain("IF coalesce(_on, false) AND (public.community_is_staff(auth.uid()) OR public.community_is_coach(v_me)) THEN");
    expect(sql).toContain("AND NOT public.community_is_coach(NEW.author_user_id)");
    // story / post replies go through chat_direct_open (one version, as live)
    expect(sql).toContain("DROP FUNCTION IF EXISTS public.community_message_author(uuid, text);");
    expect(sql).toContain("g := public.chat_direct_open(uid, p.author_user_id);");
  });

  it("the feed and the badge check the viewer once per query (set lookups, AGENTS.md)", () => {
    const sql = readFileSync("supabase/migrations/20261130090000_crew_private_accounts_close_friends.sql", "utf8");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.community_followed_authors()");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.community_close_friend_authors()");
    expect(sql).toContain("p.author_user_id IN (SELECT public.community_followed_authors())");
    expect(sql).toContain("(SELECT public.community_is_staff(uid))");
    expect(sql).not.toContain("p.visibility IN (''followers'', ''close_friends'') AND public.community_post_visible");
  });

  it("app: a coach's props still reach a private member; Close friends is labelled; unfollowing a private account asks first", () => {
    expect(readFileSync("src/lib/push/app-events.functions.ts", "utf8")).toContain('["community", "followers", "close_friends"].includes(p.visibility)');
    expect(readFileSync("src/components/community/share-composer.tsx", "utf8")).toContain('postedAs === "close_friends" ? "Sent to Close friends. Edit"');
    const btn = readFileSync("src/components/community/follow-button.tsx", "utf8");
    expect(btn).toContain('if (label === "Following" && isPrivate) setConfirm(true);');
    expect(btn).toContain("you'll have to request to follow");
    expect(readFileSync("src/components/community/audience-picker.tsx", "utf8")).toContain("Your Close friends list is empty.");
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
    const suggested = readFileSync("src/components/community/suggested-athletes.tsx", "utf8");
    expect(suggested).toContain("Suggested for you");
    // lists are visible on profiles now (Instagram-style), so the old promise is gone
    expect(suggested).not.toContain('text-muted-foreground">Only you see who you follow');
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
