import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { groupReplies, hubTabCounts, hubTabFromHash, lastLookedLabel, whenLabel } from "@/components/community/admin-community-hub";
import type { CommunityPulse } from "@/lib/community.queries";

const read = (f: string) => readFileSync(f, "utf8");
const sql = read("supabase/migrations/20261018090000_community_admin_pulse.sql");
const hub = read("src/components/community/admin-community-hub.tsx");
const dash = read("src/routes/_authenticated/admin/index.tsx");

describe("the coach's community, in one place", () => {
  it("the coach's Crew is the clients' Crew (their bar, stories and full-screen feed), with + and Manage in it (Nov 14 2026)", () => {
    expect(read("src/routes/_authenticated/admin/community.tsx")).toContain("component: AdminCommunityHub,");
    const screen = read("src/components/community/community-screen.tsx");
    // the same screen as the clients', with the coach's tools passed in
    expect(hub).toContain("<CommunityScreen\n        coach={{");
    expect(hub).toContain("onWrite: () => setWriting(true),");
    expect(hub).toContain('startTab: counts.needs > 0 ? "needs" : "posts",');
    expect(hub).toContain("manage: <CrewManage counts={counts} />,");
    // the shell's bar steps aside on Crew, like the clients' (not for the finance login)
    expect(read("src/routes/_authenticated/admin/route.tsx")).toContain('const CREW_OWN_BAR = ["/admin/community"] as const;');
    expect(read("src/routes/_authenticated/admin/route.tsx")).toContain("ownTopBarOn={viewOnly ? undefined : CREW_OWN_BAR}");
    expect(read("src/components/admin-top-bar.tsx")).toContain("if (isChatRoute || isCrew) return null;");
    // the bar: the coach's + (his composer), Manage in the trophy's place with a dot while something waits; the heart and photo as everyone's
    expect(screen).toContain('<BarButton label="Write a post" onClick={coach.onWrite} data-crew-write>');
    expect(screen).toContain("{canShare && !coach && (");
    expect(screen).toContain('<BarButton label={coach.waiting ? "Manage Crew, something\'s waiting on you" : "Manage Crew"} onClick={openManage} data-crew-manage>');
    expect(screen).toContain('<BarButton label="Rankings" onClick={openRankings} data-crew-rankings>');
    // Manage: a page with ‹ back to the same spot in the feed, the League the trophy on its bar
    expect(screen).toContain('const PARENT: Partial<Record<Tab, Tab>> = { activity: "feed", members: "feed", manage: "feed" };');
    expect(screen).toContain('<BarButton label="League" onClick={() => void navigate({ to: "/admin/league" })} data-crew-league>');
    expect(screen).toContain('void navigate({ to: ".", hash: `tab=${coach.startTab}`, replace: true, resetScroll: false });');
    expect(screen).toContain('if (k === "feed" && /^#(rankings|league|you|tab=)/.test(window.location.hash)) void navigate({ to: ".", hash: "", replace: true, resetScroll: false });');
    expect(screen).toContain("else if (coachPage && manageTabFromHash(`#${routeHash}`)) setScope({ kind: \"manage\" });");
    // the paged feed is everyone's: no card feed or League bubble for the coach, no people-to-follow screen either
    expect(screen).toContain("const paging = ownBar && scope.kind === \"feed\";");
    expect(screen).toContain("if (!previewOnly && !following && !coach && i === 0)");
    expect(hub).not.toContain("data-crew-hub-bar");
    // Manage's three tabs, the tab in the hash
    expect(read("src/lib/crew-manage.ts")).toContain('{ key: "needs", label: "Needs you" },\n  { key: "posts", label: "Posts" },\n  { key: "insights", label: "Insights" },');
    expect(hub).toContain('const setTab = (t: ManageTab) => void navigate({ to: ".", hash: `tab=${t}`, replace: true, resetScroll: false });');
    expect(hub).not.toContain("StaffLeagueTab");
    expect(hub).not.toContain("<h1");
    // Needs you: what's waiting, else one line that says so
    expect(hub).toContain("<NeedsYou onGo={setTab} />");
    expect(hub).toContain("Nothing's waiting on you in Crew.");
    // Posts: one schedule of everything going out, then Recently out and Manage (posts-schedule.test.ts)
    expect(hub).toContain("<CoachPostsTab />");
    // Insights: the week in numbers, then each post's score (and each post's score on its own screen)
    expect(hub).toContain("<WeekCard />\n          <PostScoreBoard />");
    expect(read("src/components/community/post-card.tsx")).toContain("{viewerIsStaff && <PostScoreChip post={post} />}");
    // the finance login: the feed alone
    expect(hub).toContain("<CommunityScreen hideTabs />");
    // old League links go to the League page
    expect(hub).toContain('if (hubTabFromHash(`#${routeHash}`) === "league") void navigate({ to: "/admin/league", replace: true });');
    expect(read("src/routes/_authenticated/admin/league.tsx")).toContain("component: AdminLeaguePage,");
    expect(read("src/routes/_authenticated/admin/athlete-records.tsx")).toContain('backTo="/admin/league" backLabel="League"');
    expect(hub).toContain('await act.mutateAsync({ kind: "note", body, poll, media });');
    // the composer lives on the page now, not at the bottom of the schedule
    expect(read("src/components/community/coach-weekly-posts.tsx")).not.toContain("Write a post for the crew");
    // every daily series starts closed (a full Recap preview opening on its own tripled the page)
    expect(read("src/components/community/coach-weekly-posts.tsx")).toContain("const [open, setOpen] = useState<DailySeries | null>(() => (focus && ORDER.includes(focus as DailySeries) ? (focus as DailySeries) : null));");
  });
  it("reads a link's tab: old Daily / Birthdays links open Posts, old League links the League page", () => {
    expect(hubTabFromHash("")).toBe("feed");
    expect(hubTabFromHash("#post=abc")).toBe("feed");
    expect(hubTabFromHash("#you")).toBe("feed");
    expect(hubTabFromHash("#tab=posts")).toBe("posts");
    expect(hubTabFromHash("#tab=daily")).toBe("posts");
    expect(hubTabFromHash("#tab=birthdays")).toBe("posts");
    expect(hubTabFromHash("#birthday=6f9619ff-8b86-d011-b42d-00cf4fc964ff")).toBe("posts");
    expect(hubTabFromHash("#tab=insights")).toBe("insights");
    expect(hubTabFromHash("#tab=needs")).toBe("needs");
    // the Posts tab's own pages stay on Posts
    expect(hubTabFromHash("#tab=posts&manage=lessons")).toBe("posts");
    expect(hubTabFromHash("#tab=league")).toBe("league");
    expect(hubTabFromHash("#rankings")).toBe("league");
  });
  it("a tab shows a dot only for what's waiting there, and Manage while anything is", () => {
    const base = { to_reply: [], waiting_props: 0, lessons_review: 0, birthday_review: 0, paused: false } as unknown as CommunityPulse;
    expect(hubTabCounts(undefined)).toEqual({ needs: 0, posts: 0, insights: 0 });
    expect(hubTabCounts(base)).toEqual({ needs: 0, posts: 0, insights: 0 });
    const replies = [
      { post_id: "a", comment_id: "1", created_at: "", body: "x", name: "Fionna", avatar_url: null },
      { post_id: "a", comment_id: "2", created_at: "", body: "y", name: "Alyssa", avatar_url: null },
    ];
    // two comments on one post is one reply to make
    expect(hubTabCounts({ ...base, to_reply: replies, waiting_props: 2 }).needs).toBe(1);
    // workouts waiting on props are listed, never counted (there's nearly always a week of them)
    expect(hubTabCounts({ ...base, waiting_props: 27 }).needs).toBe(0);
    // the crew's reports wait there too
    expect(hubTabCounts(base, 2).needs).toBe(2);
    // a lesson or birthday post waiting for an OK: on Needs you and Posts
    expect(hubTabCounts({ ...base, lessons_review: 2, birthday_review: 1 })).toEqual({ needs: 3, posts: 3, insights: 0 });
    expect(hubTabCounts({ ...base, paused: true } as CommunityPulse).needs).toBe(1);
  });
  it("the League is its own page: the trophy on Manage's bar (the finance login's feed keeps the bubble)", () => {
    const nav = read("src/lib/internal-nav.ts");
    expect(read("src/components/community/community-screen.tsx")).toContain('? { label: "League", onOpen: () => void navigate({ to: "/admin/league" }) }');
    expect(read("src/components/community/admin-league-page.tsx")).toContain("<StaffLeagueTab tools={!viewOnly} />");
    // findable in the sidebar and the search
    expect(nav).toContain('{ to: "/admin/league", label: "League", icon: Trophy, group: "Crew",');
    expect(read("src/lib/admin-route-registry.ts")).toContain('{ id: "league", label: "League", to: "/admin/league",');
  });
  it("the dashboard has no community card: it's one tap away on the Crew button (a birthday draft to approve is in Crew's Needs you)", () => {
    expect(dash).not.toContain("CommunityPulseCard");
    expect(dash).not.toContain("BirthdayPostsCard");
    expect(dash).not.toContain("CommunityCoachCard");
    expect(dash).not.toContain("UpcomingBirthdaysWidget");
    expect(read("src/components/community/community-entry.tsx")).not.toContain("Nothing shared this week yet");
  });
});

describe("the numbers are the crew's, never the coach's", () => {
  it("coaches are left out of every count, and it's staff-only", () => {
    expect(sql).toContain("IF NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;");
    expect(sql).toContain("AND NOT coalesce((a.j->>'is_coach')::boolean, false);");
    expect(sql).toContain("WHERE r.created_at >= v_since AND NOT public.community_is_coach(r.user_id)");
    expect(sql).toContain("WHERE c.created_at >= v_since AND NOT public.community_is_coach(c.author_user_id)");
  });
  it("comments to answer = a client comment with no coach comment after it on that post", () => {
    expect(sql).toContain("WHERE k.post_id = c.post_id AND k.created_at > c.created_at AND public.community_is_coach(k.author_user_id)");
  });
  it("what goes out next skips anything already posted this week and today's slot once its window closes", () => {
    expect(sql).toContain("CONTINUE WHEN EXISTS (SELECT 1 FROM public.community_series_runs r WHERE r.series_key = v_series || ':' || to_char(v_day, 'IYYY-\"W\"IW'));");
    expect(sql).toContain("CONTINUE WHEN i = 0 AND v_local::time >= CASE WHEN v_time >= time '19:00' THEN time '23:59:59' ELSE v_time + interval '5 hours' END;");
  });
});

describe("reads like a person wrote it", () => {
  const now = new Date(2026, 9, 9, 10, 0);
  it("when things go out", () => {
    expect(whenLabel(new Date(2026, 9, 9, 19, 0).toISOString(), now)).toBe("Today 7:00 pm");
    expect(whenLabel(new Date(2026, 9, 10, 9, 0).toISOString(), now)).toBe("Tomorrow 9:00 am");
    expect(whenLabel(new Date(2026, 9, 12, 8, 0).toISOString(), now)).toBe("Mon 8:00 am");
  });
  it("who hasn't looked", () => {
    expect(lastLookedLabel(null, now)).toBe("Never opened it");
    expect(lastLookedLabel(new Date(2026, 8, 27, 10, 0).toISOString(), now)).toBe("Last looked 12 days ago");
  });
  it("comments group by post: 'Fionna & Alyssa Amanda'", () => {
    const g = groupReplies([
      { post_id: "p1", comment_id: "c2", created_at: "2026-10-08T23:26:00Z", body: "Happy birthday queen Amanda!! 💓", name: "Fionna", avatar_url: null },
      { post_id: "p1", comment_id: "c1", created_at: "2026-10-08T18:37:00Z", body: "Thanks Coach!", name: "Alyssa Amanda", avatar_url: null },
      { post_id: "p2", comment_id: "c3", created_at: "2026-10-07T12:00:00Z", body: "lets go", name: "Vicky", avatar_url: null },
    ]);
    expect(g.map((x) => [x.post_id, x.who, x.body])).toEqual([
      ["p1", "Fionna & Alyssa Amanda", "Happy birthday queen Amanda!! 💓"],
      ["p2", "Vicky", "lets go"],
    ]);
  });
});
