import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { groupReplies, lastLookedLabel, whenLabel } from "@/components/community/admin-community-hub";

const read = (f: string) => readFileSync(f, "utf8");
const sql = read("supabase/migrations/20261018090000_community_admin_pulse.sql");
const hub = read("src/components/community/admin-community-hub.tsx");
const dash = read("src/routes/_authenticated/admin/index.tsx");

describe("the coach's community, in one place", () => {
  it("the League page is the hub: League / Feed / Daily / Birthdays, what needs you, and + Post", () => {
    expect(read("src/routes/_authenticated/admin/community.tsx")).toContain("component: AdminCommunityHub,");
    expect(hub).toContain('{ key: "league", label: "League" }');
    expect(hub).toContain('{ key: "feed", label: "Feed" }');
    expect(hub).toContain('{ key: "daily", label: "Daily" }');
    expect(hub).toContain('{ key: "birthdays", label: "Birthdays" }');
    expect(hub).toContain("<StaffLeagueTab tools={!viewOnly} />");
    // the week at a glance heads the feed; anything waiting shows on every other tab
    expect(hub).toContain("{!viewOnly && <PulsePanel onGo={setTab} />}");
    expect(hub).toContain('{tab !== "feed" && !viewOnly && <NeedsYouStrip onGo={setTab} />}');
    // links to a post land on the feed
    expect(hub).toContain('if (/tab=feed/.test(h) || /post=/.test(h)) return "feed";');
    expect(hub).toContain("<CommunityScreen hideTabs />");
    expect(hub).toContain("<UpcomingBirthdaysWidget windowDays={30} />");
    expect(hub).toContain('await act.mutateAsync({ kind: "note", body, poll, media });');
    // the composer lives on the page now, not at the bottom of the schedule
    expect(read("src/components/community/coach-weekly-posts.tsx")).not.toContain("Write a post for the crew");
  });
  it("the dashboard has no community card: it's one tap away on the League button (a birthday draft to approve still shows)", () => {
    expect(dash).not.toContain("CommunityPulseCard");
    expect(dash).toContain("<BirthdayPostsCard actionableOnly />");
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
