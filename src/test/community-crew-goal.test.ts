import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { crewGoalStatus, type CrewGoal } from "@/lib/community";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const sql = read("supabase/migrations/20261023120000_community_crew_goal.sql");
const card = read("src/components/community/crew-goal.tsx");
const screen = read("src/components/community/community-screen.tsx");
const entry = read("src/components/community/community-entry.tsx");
const recap = read("src/components/community/recap-post.tsx");
const queries = read("src/lib/community.queries.ts");

const goal = (over: Partial<CrewGoal> = {}): CrewGoal => ({
  week_of: "2026-10-05", ends_at: "2026-10-12T05:00:00Z", target: 40, done: 29, hit_at: null, hit_by: null,
  people: 12, contributors: [], mine: 3, last_week: { target: 40, done: 41, hit: true }, ...over,
});

describe("where the goal stands", () => {
  it("on the way: how many to go and the days left", () => {
    const s = crewGoalStatus(goal(), { now: new Date("2026-10-09T14:00:00Z") });
    expect(s).toMatchObject({ pct: 73, left: 11, hit: false, line: "11 to go · 3 days left" });
    expect(crewGoalStatus(goal(), { now: new Date("2026-10-11T20:00:00Z") }).line).toBe("11 to go · last day");
  });
  it("hit: who closed it out (you, or their first name); the bar stops at full", () => {
    const vicky = { user_id: "v", name: "Vicky Smith", avatar_url: null, is_coach: false };
    const s = crewGoalStatus(goal({ done: 43, hit_at: "2026-10-08T23:00:00Z", hit_by: vicky }), { me: "x" });
    expect(s.hit).toBe(true);
    expect(s.pct).toBe(100);
    expect(s.line).toMatch(/^Goal hit \w+ 🎉 · Vicky closed it out$/);
    expect(crewGoalStatus(goal({ done: 40, hit_by: vicky }), { me: "v" }).line).toContain("you closed it out");
  });
});

describe("the goal on the server", () => {
  it("the crew's week (Mon-Sun, Winnipeg), the active-client roster", () => {
    expect(sql).toContain("date_trunc('week', coalesce(_at, now()) AT TIME ZONE tz)::date");
    expect(sql).toContain("coalesce(cl.portal_access_disabled, false) = false");
  });
  it("a stretch on the last four weeks: x1.08, up to the next 5, at least 10", () => {
    expect(sql).toContain("greatest(10, (ceil(coalesce(avg(w.n), 0) * 1.08 / 5) * 5)::int)");
    expect(sql).toContain("generate_series(1, 4)");
  });
  it("community members only; the helpers aren't callable from the app", () => {
    expect(sql).toContain("IF NOT public.can_view_community() THEN RAISE EXCEPTION 'Not allowed'");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.community_crew_roster() FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.community_crew_target(date, uuid[]) FROM PUBLIC, anon, authenticated;");
  });
  it("nobody's ranked or called out: faces of who trained, no counts; nothing pushes", () => {
    expect(sql).toContain("jsonb_agg(public.community_author(x.user_id) ORDER BY x.last_at DESC)");
    expect(sql).not.toMatch(/app_event|send_push|net\.http_post/);
    expect(card).toContain("Nobody is ever shown as missing.");
  });
});

describe("where it shows", () => {
  it("leads the League tab, sits on Home's community card, and greets you after a workout", () => {
    expect(read("src/components/community/league-hub.tsx")).toContain("<CrewGoalCard />");
    expect(screen).not.toContain("<CrewGoalCard />");
    expect(entry).toContain('<CrewGoalStrip className="mt-2" />');
    expect(recap).toContain('<CrewGoalAfterWorkout className="mb-2.5" />');
  });
  it("after a workout it's fresh (this session counted); posting refreshes it too", () => {
    expect(card).toContain("useCrewGoal(true, { fresh: true })");
    expect(queries).toContain('qc.invalidateQueries({ queryKey: ["community-crew-goal"] });');
  });
});
