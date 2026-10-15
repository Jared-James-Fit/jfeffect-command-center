import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { disciplineLabel, feedSuggestionsHidden, followedByLabel, isStrongReason, isValidUsername, mutualsLabel, reasonLabel, searchTerm } from "@/lib/community-discover";
import { shouldPersistQueryKey } from "@/lib/query-persister";

const read = (f: string) => readFileSync(f, "utf8");
const sql = read("supabase/migrations/20261203090000_crew_discover.sql");
const round2 = read("supabase/migrations/20261205090000_crew_discover_mutuals_follow_back.sql");

describe("why someone is suggested", () => {
  it("says it in a few words", () => {
    expect(reasonLabel({ kind: "coach" })).toBe("Your coach");
    expect(reasonLabel({ kind: "follows_you" })).toBe("Follows you");
    expect(reasonLabel({ kind: "followed_by", names: ["Nicole"], count: 1 })).toBe("Followed by Nicole");
    expect(reasonLabel({ kind: "followed_by", names: ["Nicole", "Vicky"], count: 4 })).toBe("Followed by Nicole + 3 more");
    expect(reasonLabel({ kind: "gym", label: "Iron Temple" })).toBe("Trains at Iron Temple");
    expect(reasonLabel({ kind: "new" })).toBe("New to the Crew");
    expect(reasonLabel({ kind: "discipline", label: "powerlifting" })).toBe("Also into powerlifting");
    expect(reasonLabel({ kind: "popular" })).toBe("Popular in Crew");
    expect(reasonLabel(undefined)).toBe("In the Crew");
  });

  it("only real reasons earn a card in the feed", () => {
    expect(isStrongReason({ kind: "coach" })).toBe(true);
    expect(isStrongReason({ kind: "followed_by", names: ["A"] })).toBe(true);
    expect(isStrongReason({ kind: "gym", label: "X" })).toBe(true);
    expect(isStrongReason({ kind: "active" })).toBe(false);
    expect(isStrongReason({ kind: "popular" })).toBe(false);
    expect(isStrongReason({ kind: "crew" })).toBe(false);
  });

  it("names people you follow who follow them, on a profile", () => {
    expect(followedByLabel(null)).toBeNull();
    expect(followedByLabel({ count: 0, names: [] })).toBeNull();
    expect(followedByLabel({ count: 1, names: ["Nicole"] })).toBe("Followed by Nicole");
    expect(followedByLabel({ count: 2, names: ["Nicole", "Vicky"] })).toBe("Followed by Nicole and Vicky");
    expect(followedByLabel({ count: 5, names: ["Nicole", "Vicky"] })).toBe("Followed by Nicole, Vicky + 3 more");
  });

  it("labels what people train", () => {
    expect(disciplineLabel("powerlifting")).toBe("Powerlifting");
    expect(disciplineLabel("glutes")).toBe("Glute training");
  });
});

describe("usernames and search", () => {
  it("allows the same usernames the database does", () => {
    for (const ok of ["nicole", "fionna.lifts", "jared_m", "abc", "a1b2c3"]) expect(isValidUsername(ok)).toBe(true);
    for (const bad of ["ab", ".nicole", "nicole.", "_x_", "a..b", "Nicole", "with space", "x".repeat(25)]) expect(isValidUsername(bad)).toBe(false);
    // the database checks the same shape
    expect(sql).toContain("username::text ~ '^[a-z0-9._]{3,24}$'");
    expect(sql).toContain("username::text !~ '^[._]|[._]$|\\.\\.'");
  });

  it("searches without the @, trimmed and lowercase", () => {
    expect(searchTerm("  @Nic ")).toBe("nic");
    expect(searchTerm("@@vicky")).toBe("vicky");
    expect(searchTerm("   ")).toBe("");
  });

  it("never parses a lookbehind regex (older iPhones can't, and the whole screen would fail to load)", () => {
    for (const f of ["src/lib/community-discover.ts", "src/components/community/discover.tsx", "src/components/community/profile-edit.tsx"]) {
      expect(read(f)).not.toMatch(/\(\?<[=!]/);
    }
  });

  it("keeps suggestions and searches off the phone's saved cache", () => {
    expect(shouldPersistQueryKey(["community-suggestions", "all", 12])).toBe(false);
    expect(shouldPersistQueryKey(["community-people-search", "nic"])).toBe(false);
    expect(shouldPersistQueryKey(["community-username-check", "nic"])).toBe(false);
  });
});

describe("privacy in the database", () => {
  it("matches the name people see (a client's first name), never a last name", () => {
    expect(sql).toContain("FROM public.community_member_directory() d");
    expect(sql).not.toMatch(/full_name/);
  });

  it("leaves out blocks either way, you, linked logins and people who turned suggestions off", () => {
    expect(sql).toContain("AND NOT public.chat_has_blocked(_viewer, d.user_id)");
    expect(sql).toContain("AND NOT public.chat_has_blocked(d.user_id, _viewer)");
    expect(sql).toContain("AND public.community_main_account(d.user_id) <> _viewer");
    expect(sql).toContain("WHERE (p.suggestable OR p.connected)");
    expect(sql).toContain("(coalesce(cp.discoverable, true) OR public.community_is_coach(d.user_id)) AS suggestable");
    expect(sql).toContain("RAISE EXCEPTION 'Coach accounts stay findable'");
  });

  it("blocking hides each other's posts in the feed, the new-posts count, the members list and profiles (staff still see all)", () => {
    expect(sql.match(/p\.author_user_id NOT IN \(SELECT public\.community_blocked_authors\(\)\)/g)?.length).toBe(2);
    expect(sql).toContain("m.user_id NOT IN (SELECT public.community_blocked_authors())");
    expect(sql).toContain("'can_see', public.community_can_see_account(v_them) AND NOT v_blocked");
    // a blocked person can't follow (quietly)
    expect(sql).toContain("AND (public.chat_has_blocked(v_them, v_me) OR public.chat_has_blocked(v_me, v_them)) THEN\n    RETURN public.community_follow_state();");
  });

  it("only the public functions are callable, by signed-in people", () => {
    for (const fn of ["community_people_search(text, integer)", "community_suggestions(uuid, integer)", "community_set_username(text)", "community_set_training(text[], text)", "community_set_discoverable(boolean)", "community_hide_suggestion(uuid, boolean)"]) {
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.${fn} TO authenticated;`);
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC, anon;`);
    }
    for (const internal of ["community_findable_people(uuid)", "community_blocked_authors()", "community_person_json(uuid, uuid)", "community_ensure_username(uuid)"]) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${internal} FROM PUBLIC, anon, authenticated;`);
    }
    expect(sql).toContain("REVOKE ALL ON public.community_suggestion_hides FROM anon, authenticated;");
  });

  it("gives everyone in the Crew a username without ever blocking the write that added them", () => {
    expect(sql).toContain("CREATE TRIGGER community_username_on_client AFTER INSERT OR UPDATE OF user_id ON public.clients");
    expect(sql).toContain("EXCEPTION WHEN OTHERS THEN NULL;");
    expect(sql).toContain("FOR r IN SELECT d.user_id FROM public.community_member_directory() d ORDER BY d.user_id LOOP");
  });
});

describe("follow from anywhere", () => {
  it("finds people from the Crew's top bar (and Activity, and the coach's Crew page)", () => {
    const screen = read("src/components/community/community-screen.tsx");
    expect(screen).toContain('aria-label="Find athletes"');
    expect(screen).toContain("onClick={() => openDiscover(tab, true)}");
    expect(screen).toContain('onFindPeople={() => openDiscover("activity", true)}');
    expect(screen).toContain("window.addEventListener(OPEN_DISCOVER_EVENT, open);");
    expect(read("src/components/community/admin-community-hub.tsx")).toContain("openCommunityDiscover");
    const page = read("src/components/community/discover.tsx");
    expect(page).toContain('placeholder="Search name or @username"');
    expect(page).toContain("<SuggestedList onOpen={onOpen} />");
  });

  it("puts Follow on posts, stories, comments and the reactions list", () => {
    expect(read("src/components/community/post-card.tsx")).toContain("trailing={!post.is_mine && onOpenAuthor ? <InlineFollow userId={post.author.user_id} name={post.author.name} /> : null}");
    expect(read("src/components/community/post-detail.tsx")).toContain("<InlineFollow userId={post.author.user_id}");
    expect(read("src/components/community/crew-stories.tsx")).toContain('<InlineFollow userId={who.user_id} name={who.name} tone="story" />');
    expect(read("src/components/community/comments-sheet.tsx")).toContain("{!c.is_mine && <FollowMenuRow author={c.author} onDone={onClose} />}");
    expect(read("src/components/community/reactors-sheet.tsx")).toContain("{!r.is_me && <FollowButton userId={r.author.user_id}");
    // never for coaches, a view-only login, or a coach viewing as a client
    const fb = read("src/components/community/follow-button.tsx");
    expect(fb).toContain("const hidden = staff || viewOnly || isImpersonating || !user || userId === user.id || userId === myId;");
  });

  it("suggests in the feed only for real reasons, and similar athletes right after you follow someone", () => {
    expect(read("src/components/community/community-screen.tsx")).toContain('<SuggestedAthletes onOpen={openAuthor} strongOnly hideable onSeeAll={() => openDiscover("feed")} />');
    expect(read("src/components/community/suggested-athletes.tsx")).toContain("if (hiddenFromFeed || people.length < (strongOnly ? 2 : 1)) return null;");
    const profile = read("src/components/community/profile-view.tsx");
    expect(profile).toContain("<SuggestedAthletes context={profile.author.user_id}");
    expect(profile).toContain("if (wasFollowed.current === false && followed) setSimilar(true);");
  });

  it("shows @username, training and gym on profiles, edits them in one sheet, and blocks from •••", () => {
    const profile = read("src/components/community/profile-view.tsx");
    expect(profile).toContain("@{profile.username}");
    expect(profile).toContain("<ProfileFacts disciplines={profile.disciplines} gym={profile.home_gym} />");
    expect(profile).toContain("data-edit-profile");
    expect(profile).toContain("{!viewerIsStaff && !isImpersonating && !profile.author.is_coach && <ProfileMore author={profile.author} />}");
    const edit = read("src/components/community/profile-edit.tsx");
    expect(edit).toContain("Suggest my account");
    expect(edit).toContain("Blocked accounts");
    expect(edit).toContain("lazyWithRetry");
  });
});

describe("Discover people, round two", () => {
  it("names mutuals the way Instagram does, and only when there are some", () => {
    expect(mutualsLabel(undefined)).toBeNull();
    expect(mutualsLabel({ count: 0, faces: [] })).toBeNull();
    expect(mutualsLabel({ count: 1, faces: [{ user_id: "j", name: "Jared", avatar_url: null }] })).toBe("Followed by Jared");
    expect(mutualsLabel({ count: 10, faces: [{ user_id: "a", name: "Alyssa", avatar_url: null }, { user_id: "b", name: "Bri", avatar_url: null }] })).toBe("Followed by Alyssa, Bri + 8 more");
  });

  it("mutuals are people you follow who follow them: members only, never blocked either way, 3 newest faces", () => {
    expect(round2).toContain("WHERE f1.follower_id = _viewer AND f2.followee_id = _them");
    expect(round2).toContain("AND NOT public.chat_has_blocked(_viewer, f2.follower_id)");
    expect(round2).toContain("AND NOT public.chat_has_blocked(f2.follower_id, _viewer)");
    expect(round2).toContain("AND public.community_is_member(f2.follower_id)");
    expect(round2).toContain("ORDER BY m.at DESC LIMIT 3");
    expect(round2).toContain("'mutuals', public.community_mutuals(_viewer, _user_id))");
    expect(round2).toContain("REVOKE ALL ON FUNCTION public.community_mutuals(uuid, uuid) FROM PUBLIC, anon, authenticated;");
    // faces are photos only: initials at 18px read as garbled letters
    expect(read("src/components/community/discover.tsx")).toContain("const faces = (m?.faces ?? []).filter((f) => !!f.avatar_url);");
  });

  it("Follow back is everyone who follows you that you don't follow (or asked to), from the same findable set as search", () => {
    expect(round2).toContain("FROM public.community_findable_people(v_me) p");
    expect(round2).toContain("JOIN public.community_follows f ON f.follower_id = p.user_id AND f.followee_id = v_me");
    expect(round2).toContain("NOT EXISTS (SELECT 1 FROM public.community_follow_requests r WHERE r.requester_id = v_me AND r.target_id = p.user_id)");
    expect(round2).toContain("GRANT EXECUTE ON FUNCTION public.community_follow_back(integer) TO authenticated;");
    const page = read("src/components/community/discover.tsx");
    expect(page).toContain("<FollowBackList onOpen={onOpen} />");
    // nobody shows twice: suggestions skip anyone already in Follow back
    expect(page).toContain(".filter((p) => !back.has(p.user_id))");
    expect(shouldPersistQueryKey(["community-follow-back"])).toBe(false);
  });

  it("Hide on the feed row lasts 30 days on the account (every device), and Find athletes still shows everyone", () => {
    expect(round2).toContain("now() + interval '30 days'");
    expect(round2).toContain("AND cp.feed_suggestions_hidden_until > now()))");
    expect(feedSuggestionsHidden(undefined)).toBe(false);
    expect(feedSuggestionsHidden({ auto_share_workouts: true, private_views: false, feed_suggestions_hidden_until: new Date(Date.now() + 86_400_000).toISOString() })).toBe(true);
    expect(feedSuggestionsHidden({ auto_share_workouts: true, private_views: false, feed_suggestions_hidden_until: new Date(Date.now() - 1000).toISOString() })).toBe(false);
    // the row waits for the setting, so a hidden row never flashes in
    expect(read("src/components/community/suggested-athletes.tsx")).toContain("settings.data === undefined ? !settings.isError : feedSuggestionsHidden(settings.data)");
  });

  it("Invite friends shares the public membership link, and never while a coach views as a client", () => {
    expect(read("src/lib/community-discover.ts")).toContain('export const INVITE_URL = "https://jfeffect.com/join";');
    expect(read("src/components/community/community-screen.tsx")).toContain("canInvite={!previewOnly}");
  });
});

describe("where suggestions sit in the feed", () => {
  it("right after the first post (most visits never reach the third), and the end of the feed points to Find athletes", () => {
    const screen = read("src/components/community/community-screen.tsx");
    expect(screen).toContain("{!hideTabs && !previewOnly && !following && i === 0 && (");
    expect(screen).not.toContain("i === Math.min(2, feedPosts.length - 1)");
    expect(screen).toContain("data-caught-up-discover");
    expect(read("src/components/community/feed-motion.tsx")).toContain("{more && <div");
  });
});
